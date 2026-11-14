import assert from "node:assert/strict";
import test from "node:test";

import { rankGrowthCandidates } from "../functions/lib/radar-growth.js";

function equity(code, trend, change, activity, extra = {}) {
  return {
    code, id: "美股:" + code, market: "美股",
    metrics: { return60d: trend, return10d: trend / 2, changePct: change, amplitude: 4, volumeRatio: activity,
      turnoverRate: activity, amount: 100_000, marketCap: 10_000_000, ...extra },
  };
}

function universe() {
  return [
    equity("A", -5, -3, 0.5), equity("B", 0, -1, 0.6), equity("C", 2, 0, 0.7),
    equity("D", 4, 1, 0.8), equity("E", 16, 2, 1.3), equity("F", 30, 4, 2.1),
  ];
}

test("ranks all eligible stocks before capping and discloses its score and actual evidence", () => {
  const rows = universe();
  Object.assign(rows.at(-1).metrics, { pe: -40, pb: 9, marketCap: 100_000 });
  Object.assign(rows[0].metrics, { pe: 2, pb: 0.5, marketCap: 1e12 });
  const original = structuredClone(rows);
  const ranked = rankGrowthCandidates(rows);
  assert.deepEqual(ranked.map((row) => row.code), ["F", "E"]);
  assert.deepEqual(ranked[0].growthComponents, { momentum10d: 40, momentum60d: 20, latestChange: 5, activity: 35 });
  assert.equal(ranked[0].growthScore, 100);
  assert.equal(ranked[1].growthScore, 80);
  assert.match(ranked[0].growthReasons.join(" "), /量比 2.10倍/);
  assert.match(ranked[0].growthRisks.join(" "), /尚无两周收益验证/);
  assert.deepEqual(rows, original);
});

test("one activity measure per market, at least two thirds coverage, never fills an individual missing value", () => {
  const rows = universe();
  rows.at(-1).metrics.volumeRatio = null;
  rows[0].metrics.volumeRatio = null;
  assert.deepEqual(rankGrowthCandidates(rows).map((row) => row.code), ["E"]);
  rows[1].metrics.volumeRatio = null;
  const fallback = rankGrowthCandidates(rows);
  assert.deepEqual(fallback.map((row) => row.code), ["F", "E"]);
  assert.ok(fallback.every((row) => row.growthActivityMetric === "turnoverRate"));
  assert.match(fallback[0].growthRisks.join(" "), /无法确认较平日放量/);
  for (let index = 0; index < rows.length; index++) {
    rows[index].metrics.turnoverRate = null;
    rows[index].metrics.amount = 100 * (index + 1);
  }
  const proxy = rankGrowthCandidates(rows);
  assert.equal(proxy[0].growthActivityMetric, "amountToMarketCap");
  for (const row of rows) row.metrics.marketCap = null;
  assert.deepEqual(rankGrowthCandidates(rows), []);
});

test("requires positive absolute evidence and excludes incomplete or overheated quotes", () => {
  for (const patch of [
    { return10d: 0 }, { return10d: null }, { return60d: 0 }, { return60d: 60 }, { changePct: 0 }, { changePct: 7 },
    { amplitude: 8 }, { amplitude: -1 }, { amplitude: null }, { volumeRatio: 0.99 },
    { return60d: null }, { changePct: null }, { volumeRatio: 0 },
  ]) {
    const rows = universe();
    Object.assign(rows.at(-1).metrics, patch);
    assert.ok(!rankGrowthCandidates(rows).some((row) => row.code === "F"), JSON.stringify(patch));
  }
  assert.deepEqual(rankGrowthCandidates(universe().map((row) => ({
    ...row, metrics: { ...row.metrics, return60d: -0.01 },
  }))), []);
});

test("ties share a midpoint percentile and never gain an advantage from input order", () => {
  const rows = universe();
  rows.at(-1).metrics = { ...rows.at(-2).metrics };
  const ranked = rankGrowthCandidates(rows);
  assert.deepEqual(ranked.map((row) => [row.code, row.growthScore]), [["E", 90], ["F", 90]]);
  assert.deepEqual(ranked, rankGrowthCandidates(rows.reverse()));
});
