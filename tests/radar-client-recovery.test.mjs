import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const asset = name => readFile(new URL("../assets/" + name, import.meta.url), "utf8");
const [app, policy] = await Promise.all([asset("app.js"), asset("radar-risk-policy.js")]);
function dashboard() {
  const context = vm.createContext({ location: { hash: "#radar" }, localStorage: { getItem: () => null },
    AbortController, window: { setTimeout: () => 1, clearTimeout: () => {} } });
  vm.runInContext(policy, context);
  vm.runInContext(app.slice(0, app.lastIndexOf("\nstart().catch")), context);
  return source => vm.runInContext(source, context);
}

test("a previous snapshot is rescored once and overheated stocks remain in the pool", () => {
  const run = dashboard();
  const result = run(`(() => {
    const base = {market:"美股", code:"TEST", metrics:{return60d:61,amplitude:8,changePct:8},
      components:{trend:33,risk:15,quality:12,liquidity:25}};
    const snapshots = {"美股":{modelVersion:RADAR_PREVIOUS_MODEL,candidates:[base]}};
    const [updated] = radarRowsFromSnapshots(snapshots);
    const [again] = radarRowsFromSnapshots({"美股":{modelVersion:RADAR_MODEL_VERSION,candidates:[updated]}});
    state.radarRows = [updated];
    return [updated.score, again.score, updated.topEligible, radarRowsBeforeFilters().length, radarTopThreeByMarket("美股").length];
  })()`);
  assert.deepEqual(Array.from(result), [71,71,false,1,0]);
});

test("changing the visible page releases canceled history requests for immediate retry", () => {
  const run = dashboard();
  const result = run(`(() => {
    state.tab = "radar";
    radarPageWindow = () => ({pageRows:[{sina:"gb_a"}, {sina:"gb_new"}]});
    state.radarVisibleFingerprint = "gb_a,gb_old";
    state.radarHistoryStatus = {gb_a:{state:"loading"},gb_old:{state:"loading"},gb_ready:{state:"ready"}};
    const previous = new AbortController();
    state.radarHistoryController = previous;
    scheduleVisibleRadarHistoryLoad();
    return [previous.signal.aborted, radarHistoryTimer > 0, Object.keys(state.radarHistoryStatus), state.radarVisibleFingerprint];
  })()`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [true,true,["gb_ready"],"gb_a,gb_new"]);
});

test("growth boards keep their own ranks, counts, history and scores after excluding holdings", () => {
  const run = dashboard();
  const data = run(`(() => {
    const today = new Date().toISOString();
    const rows = ["OWN", "SMALL", "LARGE", "NEXT", "AFTER"].map((code, i) => ({
      market:"美股", code, name:code, id:"美股:"+code, sina:"gb_"+code.toLowerCase(), currency:"USD",
      score:90-i, topEligible:true, components:{momentum10d:38, momentum60d:17, latestChange:4, activity:31-i},
      metrics:{price:10+i, amount:i*10000, return10d:2+i, return60d:8+i}, reasons:["60日动量", "最近交易日上涨", "量比 2 倍"], risks:["波动风险"]
    }));
    rows[2].score = rows[1].score;
    const segment = {fetchedAt:today, loadState:"fresh", scope:"已核实范围", total:128, quotedCount:100, scoredCount:77, qualifiedCount:5, candidates:rows};
    state.radarMarkets = {"美股":{segment}};
    state.radarRows = [Object.assign({}, rows[1], {score:62})];
    state.radarSegmentRows = radarSegmentRowsFromSnapshots(state.radarMarkets);
    state.holdings = [{sina:rows[0].sina, name:rows[0].name}];
    const broadNames = radarTopThreeByMarket("美股").map(x => x.code);
    state.radarScope = "growth"; state.radarBand = "all"; state.radarSort = "score";
    const saved = state.radarSegmentRows[1];
    state.saved = normalizeWatchlist([saved]);
    const grouped = radarTopThreeMarket("美股"), page = radarPage();
    return {broadNames, top:radarTopThreeByMarket("美股").map(x=>x.code), history:radarHistoryTargets([saved]).map(x=>x.code),
      markup:grouped, aside:radarWatchAside(), page, legacy:radarTopThreeMarket("A股")};
  })()`);
  const plain = JSON.parse(JSON.stringify(data));
  assert.deepEqual(plain.broadNames, ["SMALL"]);
  assert.deepEqual(plain.top, ["SMALL", "LARGE", "NEXT"]);
  assert.deepEqual(plain.history, plain.top);
  assert.match(plain.markup, /纳斯达克 Top 3/);
  for (const number of [128,100,77,5]) assert.match(plain.markup, new RegExp(number + " 只"));
  assert.match(plain.markup, /量比 2 倍/);
  assert.match(plain.page, /成长动量分/);
  assert.match(plain.page, /60 日趋势/);
  assert.match(plain.markup, /近 10 个交易日实际涨跌 \+3.00%/);
  assert.match(plain.markup, /未来10日参考上沿/);
  assert.match(plain.page, /近 10 日实际涨跌占 40 分，60 日趋势占 20 分，最近交易日涨跌占 5 分，交易活跃度占 35 分/);
  assert.match(plain.page, /value="growth10d"/);
  assert.equal(run('radarBandLabel({radarScope:"growth", score:68}).key'), "watch");
  assert.equal(run('radarBandLabel({radarScope:"growth", score:70}).key'), "priority");
  assert.doesNotMatch(plain.page, /同市场评分|波动稳定度（高到低）/);
  assert.match(plain.aside, /89.0/);
  assert.doesNotMatch(plain.aside, /62.0/);
  assert.match(plain.legacy, /尚未包含这个板块/);
  assert.doesNotMatch(plain.legacy, /范围内标的/);
});

test("broad and growth data retain the newest independent scan and distinguish unavailable from no qualifiers", () => {
  const run = dashboard();
  const result = run(`(() => {
    const today = new Date().toISOString(), yesterday = new Date(Date.now()-86400000).toISOString();
    const emptySuccess = {loadState:"fresh", fetchedAt:today, candidates:[], total:12, quotedCount:9, scoredCount:8, qualifiedCount:0};
    const previous = {market:"美股", fetchedAt:today, loadState:"fresh", candidates:[{}],
      segment:{loadState:"stale", fetchedAt:yesterday, candidates:[{}]}};
    const incoming = {market:"美股", fetchedAt:yesterday, loadState:"stale", candidates:[{}], segment:emptySuccess};
    const joined = mergeRadarMarket(previous, incoming, "envelope");
    const missing = {market:"美股", modelVersion:RADAR_MODEL_VERSION, loadState:"unavailable", candidates:[], segment:emptySuccess};
    const preserved = mergeRadarMarket(joined, {...missing,segment:{loadState:"unavailable",error:"暂缺",candidates:[]}}, "live");
    state.radarScope="growth"; state.radarMarkets={"美股":joined};
    const empty = radarTopThreeMarket("美股");
    state.radarMarkets = {"美股":{segment:{loadState:"unavailable",error:"上游缺报价",candidates:[]}}};
    return [isRadarSnapshot(missing,"美股"), joined.fetchedAt===today, joined.segment.fetchedAt===today, preserved.loadState,
      preserved.segment.loadState, preserved.segment.fetchedAt===today, empty, radarTopThreeMarket("美股")];
  })()`);
  assert.deepEqual(Array.from(result).slice(0,6), [true, true, true, "stale", "stale", true]);
  assert.match(result[6], /暂无符合入榜条件的股票/);
  assert.match(result[7], /上游缺报价/);
  assert.doesNotMatch(result[7], /达到门槛/);
});
