import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
const calendar = JSON.parse(await readFile(new URL("../assets/radar-calendar.json", import.meta.url), "utf8"));
const now = new Date("2026-11-21T06:00:00Z");

function stock(code, qty, closes, extra = {}) {
  const dates = [];
  const cursor = new Date("2026-11-20T12:00:00Z");
  while (dates.length < 75) {
    if (![0, 6].includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const history = dates.reverse().map((date, i) => {
    const close = i >= dates.length - closes.length ? closes[i - dates.length + closes.length] : 100 + Math.sin(i);
    return { date, close, open: close, high: close + 1, low: close - 1 };
  });
  return { market: "美股", code, name: code, sina: "gb_" + code.toLowerCase(), qty, currency: "USD", history,
    hasValuation: true, valueCny: 1000, holdingPct: 4, price: history.at(-1).close, priceAsOf: history.at(-1).date, ...extra };
}

function review(rows, expression, date = now, calendarData = calendar) {
  const context = vm.createContext({ rows, date, calendarData, location: { hash: "#actions" } });
  vm.runInContext(source.slice(0, source.lastIndexOf("\nstart().catch")), context);
  vm.runInContext('state.portfolioCalendar=calendarData; state.rates={USD:7,HKD:0.9,CNY:1};', context);
  return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

test("only a new same-rule close signal with an attributable impact is ranked, at most three stocks", () => {
  const rows = [stock("TINY", 1, [100, 90]), stock("FIRST", 100, [100, 90]), stock("THIRD", 5, [100, 90]),
    stock("SECOND", 50, [100, 90]), stock("CONTINUING", 10000, [100, 90, 80]),
    stock("SHORT", 10000, [100, 90]), stock("WEIGHT", 1000, [100, 100], { holdingPct: 25 })];
  rows[5].history = rows[5].history.slice(-60);
  const result = review(rows, `(() => { const checks=holdingReviewChecks(rows,date);
    return {picks:holdingFocusPicks(checks).map(item=>[item.row.code,item.impact.amount,item.signalDate]),
      states:Object.fromEntries(checks.map(item=>[item.row.code,item.when]))}; })()`);
  assert.deepEqual(result.picks, [["FIRST", -7000, "2026-11-20"], ["SECOND", -3500, "2026-11-20"], ["THIRD", -350, "2026-11-20"]]);
  assert.equal(result.states.CONTINUING, "ongoing");
  assert.equal(result.states.SHORT, "unverified");
  assert.equal(result.states.WEIGHT, "unverified");
});

test("missing preceding sessions, calendars and stale signals never appear as new", () => {
  const missing = stock("GAP", 1, [100, 90]);
  missing.history.splice(-2, 1);
  const older = stock("OLDER", 1, [100, 90, 90]);
  older.history.pop();
  const rows = [missing, older];
  const res = review(rows, `holdingReviewChecks(rows,date).map(item=>[item.row.code,item.when])`);
  assert.deepEqual(Object.fromEntries(res), { GAP: "unverified", OLDER: "older" });
  assert.deepEqual(review([stock("ONE", 1, [100, 90])], 'holdingFocusPicks(holdingReviewChecks(rows,date))', now, null), []);
});

test("a live move after the signal cannot replace that completed session's signed impact", () => {
  const row = stock("CLOSE", 4, [100, 90], {
    quote: {date: "2026-11-23", time:"10:00", price: 110, change:20}
  });
  row.history.push({date:"2026-11-23",open:100,close:110,low:90,high:110});
  const data = review([row], `state.quoteMeta.gb_close=date.toISOString();
    const pick=holdingFocusPicks(holdingReviewChecks(rows,date))[0]; [pick.signalDate,pick.impact.amount,pick.impact.source]`,
    new Date("2026-11-23T15:00:00Z"));
  assert.deepEqual(data, ["2026-11-20", -280, "history"]);
});

test("focus excludes unpriced changes and renders measurable gains as well as losses", () => {
  const row = stock("NOFX", 20, [100, 90], {currency:"ZZZ"});
  assert.deepEqual(review([row], `const checks=holdingReviewChecks(rows,date);
    [checks[0].when,checks[0].impact,holdingFocusPicks(checks).length,holdingCheckMarkup(checks).includes("影响待核算")]`),
    ["new", null, 0, true]);
  const example = (code, amount) => ({row:stock(code, 1, [100]), group:"review", when:"new", order:1,
    impact:{amount}, title:"两周走势偏弱", signalDate:"2026-11-20", level:100, levelLabel:"偏弱失效位"});
  const ranks=review([example("A", -5), example("B", 55)], `[holdingFocusPicks(rows).map(item=>item.row.code),
    holdingCheckRow(rows[1],true).includes("+¥55.00")]`);
  assert.deepEqual(ranks,[["B","A"],true]);
});

test("mixed trigger history shows a newly weak trend even when support was already broken", () => {
  const row = stock("BOTH", 10, [100, 90]);
  assert.deepEqual(review([row], `holdingTwoWeekAnalysis=(r,n,through)=>through
    ? {latestDate:"2026-11-19",priorDate:"2026-11-18",dataReady:true,supportBroken:true,status:"unknown"}
    : {latestDate:"2026-11-20",priorDate:"2026-11-19",dataReady:true,supportBroken:true,status:"down",invalidation:102};
    const check=holdingReviewChecks(rows,date)[0]; [check.when,check.order,check.title,holdingFocusPicks([check]).length]`),
    ["new",1,"两周走势偏弱",1]);
});
