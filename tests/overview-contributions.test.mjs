import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
const policy = await readFile(new URL("../assets/holding-cost-policy.js", import.meta.url), "utf8");
function dashboard(input, expression, globals = {}) {
  const context = vm.createContext({ input, location: { hash: "" }, ...globals });
  vm.runInContext(policy, context);
  vm.runInContext(app.slice(0, app.lastIndexOf("\nstart().catch")), context);
  return vm.runInContext(expression, context);
}

test("daily attribution uses only quoted securities and links to the exact holding", () => {
  const stock = { market: "美股", code: "T", name: "Test", hasTodayQuote: true };
  const daily = [
    { ...stock, todayPnlCny: -100 },
    { ...stock, code: "GAIN", name: "<gain>", todayPnlCny: 55 },
    { ...stock, code: "GAP", name: "缺价", todayPnlCny: null },
    { ...stock, code: "OLD", name: "过期", hasTodayQuote: false, todayPnlCny: 2000 }
  ];
  const html = dashboard(daily, "overviewContributions({soldRows: []}, input)");
  assert.match(html, /当日行情覆盖 2\/4 只持仓/);
  assert.match(html, /#actions\/US\/GAIN.*&lt;gain&gt;.*\+¥55\.00/);
  assert.match(html, /#actions\/US\/T.*-¥100\.00/);
  assert.doesNotMatch(html, /缺价|过期/);
  assert.match(dashboard([{ ...stock, todayPnlCny: 0 }], "overviewContributions({soldRows: []}, input)"), /均为零/);
});

test("weekend uses only the latest quoted session, converts currencies and keeps today's KPI pending", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  class Saturday extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const fresh = "2026-11-21T11:50:00Z";
  const row = (code, day, change, extra = {}) => ({
    market: "美股", currency: "USD", code, sina: code, name: code, qty: 10,
    quote: { date: day, price: 20, change }, fetchedAt: fresh, ...extra
  });
  const positions = [
    row("THU", "2026-11-19", 100), row("UP", "2026-11-20", 2),
    row("DOWN", "2026-11-20", null, { market: "港股", currency: "HKD", quote: { date: "2026/11/20", price: 18, prevClose: 20 } }),
    row("NULL", "2026-11-20", null), row("FUTURE", "2026-11-24", 130),
    row("STALE", "2026-11-02", 200), row("EXPIRED", "2026-11-20", 300, { fetchedAt: "2026-11-10T12:00:00Z" })
  ];
  const render = (rows) => dashboard(rows, `(() => {
    state.rates = { CNY:1, USD:7, HKD:.9 }; state.rows = input;
    for (const row of input) state.quoteMeta[row.sina] = row.fetchedAt;
    return { html:overviewContributions({soldRows:[]}, input), today:summary().today };
  })()`, { Date: Saturday });
  const { html, today } = render(positions);
  assert.match(html, /最近交易日盈亏贡献/);
  assert.match(html, /2026-11-20 · 覆盖 2\/7 只持仓/);
  assert.match(html, /当前持仓量和汇率估算（人民币）/);
  assert.match(html, /#actions\/US\/UP.*\+¥140\.00/);
  assert.match(html, /#actions\/HK\/DOWN.*-¥18\.00/);
  assert.doesNotMatch(html, /THU|FUTURE|STALE|EXPIRED|NULL/);
  assert.ok(Number.isNaN(today));
  assert.match(render([positions[1], positions[0]]).html, /覆盖 1\/2 只持仓/);
  assert.match(render([row("FLAT", "2026-11-20", 0)]).html, /均为零/);
  assert.equal(render(positions.slice(3)).html, "");
  assert.match(render([...positions, {...positions[0], hasTodayQuote:true, todayPnlCny:1}]).html, /今日盈亏贡献/);
});

test("absent daily quotes fall back to cumulative realized contributions by security", () => {
  const trade = { market: "港股", code: "00700", name: "腾讯" };
  const sold = [
    { ...trade, pnlCny: -13000 }, { ...trade, pnlCny: 8000 },
    { ...trade, code: "A", name: "正值", pnlCny: 700 },
    { ...trade, code: "B", name: "无金额", pnlCny: null }
  ];
  const html = dashboard(sold, "overviewContributions({soldRows: input}, [{ hasTodayQuote: false }])");
  assert.match(html, /已实现盈亏贡献/);
  assert.match(html, /腾讯.*-¥5,000\.00/);
  assert.match(html, /当日行情待更新/);
  assert.match(html, /href="#trades"/);
  assert.match(html, /href="#trades\/HK\/00700"/);
  assert.doesNotMatch(html, /无金额/);
  assert.equal(dashboard({}, "overviewContributions({soldRows: []}, [])"), "");
});

test("account and market coverage exclude absent prices while retaining real zeroes", () => {
  for (const value of [null, "", NaN, 0]) {
    const result = dashboard(value, `(() => {
      state.rows = [{ market: "A股", code: "X", status: "holding", valueCny: input, hasTodayQuote: true, todayPnlCny: input, purchaseCostCny: 10 }];
      return [summary(), marketSummary("A股")].map(x => [x.valuationCount, x.todayCount, x.value, x.today]);
    })()`);
    for (const [valCount, dayCount, marketValue, todayPnl] of result) {
      assert.equal(valCount, value === 0 ? 1 : 0);
      assert.equal(dayCount, valCount);
      assert.equal(marketValue, value === 0 ? 0 : NaN);
      assert.equal(todayPnl, marketValue);
    }
  }
});

test("fresh quotes with missing daily change do not become unchanged performances", () => {
  for (const daily of [[null, 0], [0, ""], [0, 0]]) {
    const result = dashboard(daily, `(() => {
      const symbol = "sh600000";
      state.holdings = [{ market:"A股", sina:symbol, code:"600000", status:"holding", cost:10, currency:"CNY", qty:2 }];
      state.quoteMeta[symbol] = new Date().toISOString();
      state.quotes.set(symbol, {price:15, date:calendarDateInTimeZone("Asia/Shanghai"), change:input[0], changePct:input[1]});
      rebuildRows();
      return state.rows[0];
    })()`);
    assert.equal(result.hasTodayQuote, daily.every(value => value === 0));
    assert.equal(result.todayPnlCny, result.hasTodayQuote ? 0 : NaN);
    assert.equal(result.valueCny, 30);
  }
});

test("missing portfolio quotes use a dated snapshot with both configured cost adjustments", () => {
  const html = dashboard({
    costPolicy: { buyCny: 2000, sellCny: 1000 },
    source: { asOf: "2026-11-20", reconciliation: { sourcePnlCny: 9000, securityCount: 3, soldSecurityCount: 2 },
      valuationAsOfByMarket: { A: "2026-11-06", HK: "2026-11-20", US: "2026-11-19" } }
  }, `state.holdingsDocument = input; overviewPnlStatement({totalPnl:NaN})`);
  assert.match(html, /历史估值/);
  assert.match(html, /\+¥1,000\.00/);
  assert.match(html, /-¥8,000\.00/);
  assert.match(html, /2026-11-20 账本快照/);
  assert.match(html, /A股 2026-11-06，港股 2026-11-20，美股 2026-11-19/);
});

test("startup distinguishes unavailable ledgers from legitimate empty accounts across all sources", async () => {
  for (const source of ["offline", "github", "static", "local"]) {
    const result = await dashboard(source, `(async () => {
      const emptyBook = {version:2, lots:[]};
      eventHandlers = render = () => {};
      overviewPage = actionsPage = tradesPage = () => 'account';
      radarPage = () => 'radar';
      refreshData = () => Promise.resolve();
      readStorage = (key, fallback) => key === HOLDING_KEY && input === 'local' ? [] : fallback;
      getJson = (url, fallback) => Promise.resolve(
        url === '/api/holdings-sync' && input === 'github' ? {ok:true, document:emptyBook} :
        url === 'holdings.json' && input === 'static' ? emptyBook : fallback
      );
      await start();
      return ['overview', 'actions', 'trades', 'radar'].map(tab => {state.tab = tab; return activePageMarkup()});
    })()`);
    for (const page of result.slice(0, 3)) {
      if (source === "offline") assert.match(page, /重新读取账本/);
      else assert.equal(page, "account");
    }
    assert.equal(result[3], "radar");
  }
});
