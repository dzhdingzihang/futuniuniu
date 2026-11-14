import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRadarRow, scanRadarMarket, scoreRadarCandidates } from "../functions/api/radar.js";

function quote(index, change = 2) {
  return {
    f2: 20, f3: change, f6: 1e8, f7: 3, f12: String(index), f13: 116,
    f14: `测试公司 ${index}`, f20: 1e9, f24: 12,
  };
}

function pagedFeed(fourthPage) {
  const attempts = [0, 0, 0, 0, 0];
  async function fetcher(input, options) {
    const page = Number(new URL(input).searchParams.get("pn"));
    attempts[page - 1]++;
    if (page === 4) {
      const failure = await fourthPage(attempts[3], options);
      if (failure) return failure;
    }
    const diff = Array.from({ length: 100 }, (_, index) => quote(page * 100 + index));
    return Response.json({ data: { diff } });
  }
  return { attempts, fetcher };
}

test("a transient HTTP error on a single page recovers the full market scan", async () => {
  const feed = pagedFeed((attempt) => attempt === 1 ? new Response(null, { status: 502 }) : null);
  const result = await scanRadarMarket({ market: "港股", fetcher: feed.fetcher });
  assert.deepEqual(feed.attempts, [1, 1, 1, 2, 1]);
  assert.equal(result.rawSize, 500);
  assert.equal(result.eligibleSize, 500);
  assert.equal(result.poolSize, 240);
});

test("an aborted page can recover, and a persistent or definitive error never publishes partial coverage", async () => {
  const timedOut = pagedFeed((attempt, { signal }) => attempt === 1
    ? new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
    : null);
  const recovered = await scanRadarMarket({ market: "港股", fetcher: timedOut.fetcher, timeoutMs: 20 });
  assert.equal(recovered.eligibleSize, 500);
  assert.deepEqual(timedOut.attempts, [1, 1, 1, 2, 1]);
  for (const [status, expectedAttempts] of [[503, 2], [403, 1]]) {
    const feed = pagedFeed(() => new Response(null, { status }));
    await assert.rejects(scanRadarMarket({ market: "港股", fetcher: feed.fetcher }), new RegExp("第 4 页返回 HTTP " + status));
    assert.equal(feed.attempts[3], expectedAttempts);
  }
});

test("a missing daily change is excluded from the absolute-move percentile population", () => {
  const rows = [1, 2, 3].map((change) => normalizeRadarRow(quote(change, change), "港股"));
  const missing = normalizeRadarRow(quote(4, null), "港股");
  const riskByCode = (items) => Object.fromEntries(scoreRadarCandidates(items).map(row => [row.code, row.components.risk]));
  const known = riskByCode(rows);
  const withMissing = riskByCode([...rows, missing]);
  for (const row of rows) assert.equal(withMissing[row.code], known[row.code]);
  assert.equal(withMissing[missing.code], 6); // All amplitudes tie, and the missing change earns no points.
});

test("hot and volatile signals each reduce one component, never below zero, and incomplete candidates stay off the shortlist", () => {
  const base = { trend: 29, liquidity: 25, risk: 16, quality: 12 };
  const metrics = { changePct: 6.9, amplitude: 7.9, return60d: 59.9 };
  const assess = (changes, scores = base) => globalThis.PiggyRadarRisk.assess({ ...metrics, ...changes }, scores);
  assert.equal(assess({}).score, 82);
  assert.equal(assess({}).topEligible, true);
  assert.equal(assess({ changePct: -7 }).topEligible, false);
  assert.equal(assess({ amplitude: 8 }).riskAdjustment.riskPoints, 6);
  const hit = assess({ changePct: 7, amplitude: 9, return60d: 60 });
  assert.deepEqual(hit.components, { trend: 21, liquidity: 25, risk: 10, quality: 12 });
  assert.equal(hit.score, 68);
  assert.equal(hit.band, "watch");
  assert.equal(hit.topEligible, false);
  assert.equal(hit.riskAdjustment.reasons.length, 2);
  assert.deepEqual(assess({ amplitude: 9, return60d: 70 }, { ...base, trend: 3, risk: 1 }).components,
    { trend: 0, liquidity: 25, risk: 0, quality: 12 });
  for (const changes of [{ amplitude: null }, { amplitude: -1 }, { changePct: null }, { return60d: null }]) {
    assert.equal(assess(changes).topEligible, false);
  }
  const [row] = scoreRadarCandidates([normalizeRadarRow(quote(1, null), "港股")]);
  assert.equal(row.topEligible, false);
});
