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

const calendar = JSON.parse(await readFile(new URL("../assets/radar-calendar.json", import.meta.url), "utf8"));
const saturday = "2026-11-21T12:00:00Z", mondayAsianMorning = "2026-11-23T02:30:00Z";
function stock(code, day, change, { market = "美股", currency = "USD", price = 20, time = "16:00", ...extra } = {}) {
  return { market, currency, code, sina:code, name:code, qty:10, quote:{date:day, price, change, time}, ...extra };
}
function session(rows, timestamp = saturday, formula = "overviewSession(input.rows, now)") {
  return dashboard({ rows, timestamp, calendar }, `
    state.portfolioCalendar=input.calendar;
    state.rates={CNY:1, USD:7, HKD:.9};
    const now=new Date(input.timestamp);
    for (const row of input.rows) state.quoteMeta[row.sina]=row.fetchedAt||input.timestamp;
    ${formula}`);
}

test("weekend leads with dated portfolio movement, driver links and a return on prior market value", () => {
  const rows = [stock("GAIN","2026-11-20",2), stock("DOWN","2026-11-20",-2,{market:"港股", currency:"HKD"})];
  const focus = session(rows);
  assert.equal(focus.amount,122);
  assert.equal(focus.complete,true);
  assert.equal(focus.final,true);
  assert.ok(Math.abs(focus.rate - 122/(18*70+22*9)*100) < 1e-9);
  const html = session(rows,saturday,"overviewSessionStatement(overviewSession(input.rows, now))");
  assert.match(html,/最近收盘日盈亏/);
  assert.match(html,/2026-11-20/);
  assert.match(html,/覆盖 2\/2 只持仓/);
  assert.match(html,/组合估算/);
  assert.match(html,/按当日价差、当前持仓量和汇率估算/);
  assert.match(html,/#actions\/US\/GAIN.*\+¥140\.00/);
  assert.match(html,/#actions\/HK\/DOWN.*-¥18\.00/);
});

test("mixed market dates never inflate the aggregate or masquerade as full portfolio totals", () => {
  const rows = [stock("CN","2026-11-23",1,{market:"A股", currency:"CNY",time:"10:21"}),
    stock("US","2026-11-20",100), stock("NULL","2026-11-23",null,{market:"港股",currency:"HKD",time:"10:21"}),
    stock("OLD","2026-11-06",1), stock("FUTURE","2026-11-24",3),
    stock("EXPIRED","2026-11-23",3,{fetchedAt:"2026-11-10T02:00:00Z"}), stock("BEFORE","2026-11-23",300,{market:"A股",currency:"CNY",time:"08:30"})];
  const result = session(rows,mondayAsianMorning);
  assert.equal(result.amount,10);
  assert.equal(result.rows.length,1);
  assert.equal(result.complete,false);
  assert.equal(result.trading,true);
  const html = session(rows,mondayAsianMorning,"overviewSessionStatement(overviewSession(input.rows, now))");
  assert.match(html,/已覆盖持仓小计/);
  assert.match(html,/覆盖 1\/7/);
  assert.doesNotMatch(html,/组合估算|OLD|BEFORE|EXPIRED|FUTURE|NULL|#actions\/US/);
  const lagging = session([rows[1],stock("CN","2026-11-20",.1,{market:"A股",currency:"CNY",time:"15:00"})],mondayAsianMorning);
  assert.equal(lagging.date,"2026-11-20");
  assert.equal(lagging.trading,false);
  assert.equal(lagging.awaitingMarket,true);
  assert.match(session([rows[0],stock("FLAT","2026-11-23",0,{market:"港股",currency:"HKD",time:"10:22"})],mondayAsianMorning,"overviewSessionStatement(overviewSession([input.rows[1]],now))"),/均为零/);
});

test("signal day requires a verified quote or adjacent closes; closing history supersedes an unfinished quote", () => {
  const rows = [stock("BRK.B","2026-11-20",10,{time:"10:30",history:[{date:"2026-11-19",close:18},{date:"2026-11-20",close:19}]})];
  assert.equal(session(rows,saturday,'holdingSessionImpact(input.rows[0], now, "2026-11-20")').amount,70);
  assert.equal(session(rows,saturday,'holdingSessionImpact(input.rows[0], now, "2026-11-19")'),null);
  assert.equal(session([{...rows[0],history:[]}],saturday,'holdingSessionImpact(input.rows[0], now, "2026-11-20")'),null);
  assert.equal(session([{...rows[0],history:[{date:"2026-11-18",close:18},{date:"2026-11-20",close:19}]}],saturday,'holdingSessionImpact(input.rows[0], now, "2026-11-20")'),null);
  assert.equal(session([stock("NOQUOTE","2026-11-20",null)],saturday,'holdingSessionImpact(input.rows[0], now)'),null);
  const prev = stock("PREV","2026-11-20",null,{quote:{date:"2026-11-20",price:18,prevClose:20,time:"16:00"}});
  assert.equal(session([prev],saturday,'holdingSessionImpact(input.rows[0], now)').amount,-140);
  assert.equal(session([stock("HOL","2026-11-21",20)],saturday,'holdingSessionImpact(input.rows[0], now)'),null);
});

test("closed Asian markets do not masquerade as active US performance when US quotes are unavailable", () => {
  const rows = [stock("CN","2026-11-23",-1,{market:"A股",currency:"CNY",time:"15:00"}),
    stock("US","2026-11-20",1)];
  const focus=session(rows,"2026-11-23T15:30:00Z");
  assert.equal(focus.date,"2026-11-23");
  assert.equal(focus.final,true);
  assert.equal(focus.trading,false);
  assert.equal(focus.awaitingMarket,true);
  assert.equal(focus.awaitingMarkets.join(","),"美股");
  assert.equal(focus.complete,false);
  assert.equal(focus.amount,-10);
  const html=session(rows,"2026-11-23T15:30:00Z","overviewSessionStatement(overviewSession(input.rows,now))");
  assert.match(html,/最近收盘日盈亏/);
  assert.match(html,/已覆盖持仓小计/);
  assert.match(html,/美股仍有本交易时段的报价待更新/);
  assert.doesNotMatch(html,/交易中盈亏|组合估算/);
});

test("a split or provider discontinuity cannot become a one-day movement", () => {
  const row = stock("X","2026-11-20",null,{history:[{date:"2026-11-19",close:500},{date:"2026-11-20",close:50,startsNewHistory:true}]});
  assert.equal(session([row],saturday,'holdingSessionImpact(input.rows[0], now, "2026-11-20")'),null);
});

test("a quote one minute before the bell or in extended hours cannot confirm a closing signal", () => {
  const early = stock("ABC","2026-11-20",1,{time:"15:59"});
  const delayed = stock("POST","2026-11-20",8,{time:"16:04"});
  const extended = {...early, quote:{...early.quote,time:"16:00",session:"盘后"}};
  for (const row of [early, delayed, extended]) assert.equal(session([row],saturday,'holdingSessionImpact(input.rows[0],now,"2026-11-20")'),null);
  assert.equal(session([early]).final,false);
  assert.equal(session([delayed,extended]).rows.length,0);
});

test("exchange calendars handle holidays, half days and unknown coverage", () => {
  assert.equal(session([],"2026-11-26T16:00:00Z",'portfolioMarketClock("美股",now).phase'),"holiday");
  assert.equal(session([],"2026-11-27T18:10:00Z",'portfolioMarketClock("美股",now).phase'),"closed");
  assert.equal(session([],"2026-11-27T17:00:00Z",'previousPortfolioSession("美股","2026-11-27")'),"2026-11-25");
  assert.equal(session([],"2026-11-23T04:20:00Z",'portfolioMarketClock("港股",now).phase'),"break");
  assert.equal(session([],"2028-11-22T16:00:00Z",'portfolioMarketClock("美股",now).phase'),"unknown");
  assert.equal(session([],"2026-11-21T01:00:00Z",'portfolioMarketClock("美股",now).lastClosedDate'),"2026-11-20");
});

test("absent price movements and realized proceeds use distinct labels; sparkline declares the holdings basis", () => {
  const trade = { market: "港股", code: "00700", name: "腾讯" };
  const sold = [ { ...trade, pnlCny:-13000 }, { ...trade, pnlCny:8000 },
    { ...trade, code:"A", name:"正值", pnlCny:700 }, { ...trade, code:"B", name:"无金额", pnlCny:null } ];
  const html = dashboard(sold,"overviewRealizedContributions({soldRows:input})");
  assert.match(html,/已实现盈亏贡献/);
  assert.match(html,/腾讯.*-¥5,000\.00/);
  assert.match(html,/href="#trades\/HK\/00700"/);
  assert.doesNotMatch(html,/无金额/);
  assert.match(session([stock("GAP","2026-10-10",1)],saturday,"overviewSessionStatement(overviewSession(input.rows,now))"),/暂无可核对的近期涨跌/);
  assert.match(dashboard({}, 'statementSparkline([{value:1},{value:3}])'),/按当前持仓回算/);
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
