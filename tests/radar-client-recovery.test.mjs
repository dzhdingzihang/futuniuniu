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
