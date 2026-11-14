import assert from "node:assert/strict";
import test from "node:test";
import { isEligibleRadarCandidate, normalizeRadarRow, scanRadarWithSegment } from "../functions/api/radar.js";
import { refreshRadarSnapshots } from "../functions/lib/radar-snapshot.js";
import { scanGrowthSegment } from "../functions/lib/radar-segment.js";

const market = "A股";
const codes = Array.from({ length: 450 }, (_, i) => String(300001 + i));
const directory = { [market]: { asOf: "2026-11-13", codes } };
const now = () => new Date("2026-11-14T00:10:00Z");
const setup = { market, directory, now, normalize: normalizeRadarRow, isEligible: isEligibleRadarCandidate };
const close = Date.parse("2026-11-13T07:05:00Z") / 1000;

function quote(code, index = 0) {
  return { f2: 10, f3: 2, f6: 1e8, f7: 4, f8: 1, f10: 1.3, f12: code, f13: 0,
    f14: "测试公司" + code, f20: 3e9, return10d: 1 + index / 100, f24: 12, f124: close };
}

test("growth uses official members across batches, checks exchange, liquidity, quote date and counts actual qualifiers", async () => {
  const batches = [];
  const scan = await scanGrowthSegment({ ...setup, batchQuotes: async ({ codes: part }) => {
    batches.push(part.length);
    return [...part.map(code => {
      const row = quote(code, codes.indexOf(code));
      if (code === codes[0]) row.f124 -= 86400;
      if (code === codes[1]) row.f13 = 1;
      if (code === codes[2]) row.f6 = 1e5;
      if (code === codes[3]) row.return10d = null;
      return row;
    }), quote("600001"), quote(codes[10],10)];
  } });
  assert.equal(batches.reduce((a,b) => a+b),codes.length);
  assert.equal(scan.total,450);
  assert.equal(scan.quotedCount,448);
  assert.equal(scan.scoredCount,446);
  assert.equal(scan.quoteDate,"2026-11-13");
  assert.ok(scan.qualifiedCount > 3);
  assert.ok(scan.candidates.every(row => row.metrics.return10d > 0 && row.code.startsWith("30") && row.score >= 65));
});

test("incomplete quote coverage cannot silently replace a previous complete segment", async () => {
  const previous = { market, candidates: [{code:"old"}], fetchedAt: "2026-11-13T00:10:00Z",
    segment: { key:"chinext", fetchedAt:"2026-11-13T00:10:00Z", candidates:[], quotedCount:420 } };
  const fresh = await scanRadarWithSegment({ ...setup,
    fetcher: async input => {
      const page = Number(new URL(input).searchParams.get("pn"));
      return Response.json({rc:0,data:{diff:codes.slice((page-1)*90,page*90).map(code => quote(code))}});
    }, batchQuotes: async () => [quote(codes[2])] }, previous);
  assert.equal(fresh.loadState,"fresh");
  assert.equal(fresh.segment.loadState,"stale");
  assert.equal(fresh.segment.quotedCount,420);
  assert.equal(fresh.segment.fetchedAt,previous.segment.fetchedAt);

  const growthOnly = await scanRadarWithSegment({ ...setup,
    fetcher: async () => new Response(null,{status:403}),
    batchQuotes: async ({codes:part}) => part.map(code => quote(code,codes.indexOf(code))) });
  assert.equal(growthOnly.loadState,"unavailable");
  assert.equal(growthOnly.segment.loadState,"fresh");
});

test("fresh segment advances the publication when the broad feed is stale and scans finish later", async () => {
  const result = await refreshRadarSnapshots({
    kv: {get: async () => null, put: async () => {}}, now,
    scanMarket: async market => ({
      market, candidates: [], loadState: "unavailable", fetchedAt: null, error: {message:"wide down"},
      segment: {loadState:"fresh", fetchedAt:"2026-11-14T00:10:05Z", candidates:[]}
    })
  });
  assert.equal(result.envelope.publishedAt, now().toISOString());
});
