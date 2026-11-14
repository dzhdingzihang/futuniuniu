import test from "node:test";
import assert from "node:assert/strict";
import { fetchTencentGrowthQuotes } from "../functions/lib/radar-tencent-quotes.js";

function quote(symbol, slots) {
  const fields = Array(82).fill("");
  for (const [index, value] of Object.entries(slots)) fields[index] = String(value);
  return `v_${symbol}="${fields.join("~")}";`;
}

// Market-specific fields sampled from the 2026-11-13 session. Returns were
// independently recomputed from each market's adjusted daily closes.
const mainland = { 1: "宁德时代", 2: "300750", 3: 237.70, 30: "20261113161445", 32: -0.96,
  35: "237.70/302995/7244224356", 37: 724422, 38: 0.71, 39: 12.54, 43: 2.38, 45: 10998.97,
  46: 2.84, 49: 0.71, 63: -6.50, 69: 2.05, 70: -14.19, 71: -40.02 };
const hongkong = { 1: "腾讯控股", 2: "00700", 3: 386.6, 30: "2026/11/13 16:08:22", 32: -3.06,
  37: 12251162809.622, 38: 0, 39: 14.12, 43: 2.41, 45: 35152.1649, 50: 1.45, 58: 2.70,
  59: 0.35, 62: -7.91, 66: 0.78, 67: -7.47, 68: -13.55 };
const nasdaq = { 1: "英伟达", 2: "NVDA.OQ", 3: 162.85, 30: "2026-11-13 16:00:01", 32: -2.01,
  37: 59248648156, 38: 1.51, 39: 20.59, 43: 6.99, 45: 39323.38950, 51: 17.17,
  55: -12.75, 59: -20.42, 60: -23.95, 61: -24.82, 64: 0.85 };

for (const [market, symbol, slots, expected] of [
  ["A股", "sz300750", mainland,
    [0, 237.70, -0.96, 7244224356, 1099897000000, 2.38, 0.71, 0.71, 12.54, 2.84,
      -6.50, 2.05, -14.19, -40.02, "2026-11-13T08:14:45.000Z"]],
  ["港股", "hk00700", hongkong,
    [116, 386.6, -3.06, 12251162809.622, 3515216490000, 2.41, 0.35, 1.45, 14.12, 2.70,
      -7.91, 0.78, -7.47, -13.55, "2026-11-13T08:08:22.000Z"]],
  ["美股", "usNVDA", nasdaq,
    [105, 162.85, -2.01, 59248648156, 3932338950000, 6.99, 1.51, 0.85, 20.59, 17.17,
      -12.75, -20.42, -23.95, -24.82, "2026-11-13T21:00:01.000Z"]],
]) {
  test(`${market} retains date, native amount, turnover, volume ratio and all return horizons`, async () => {
    const code = symbol.slice(2);
    const [row] = await fetchTencentGrowthQuotes({ market, codes: [code], fetcher: async (url) => {
      assert.equal(url.href, "https://qt.gtimg.cn/utf8/q=" + symbol);
      return new Response(quote(symbol, slots));
    } });
    assert.equal(row.f12, code);
    assert.equal(row.f14, slots[1]);
    assert.deepEqual([row.f13, row.f2, row.f3, row.f6, row.f20, row.f7, row.f8, row.f10, row.f9, row.f23,
      row.return5d, row.return10d, row.return20d, row.f24, new Date(row.f124 * 1000).toISOString()], expected);
  });
}

test("matches holdings by identifier, excludes duplicates, and distinguishes US exchanges and DST", async () => {
  const sample = (code, fields = {}) => quote("us" + code, { ...nasdaq, 2: code + ".OQ", ...fields });
  const batch = [sample("NOPE"), sample("MSFT", { 2: "OTHER.OQ" }), sample("NVDA"),
    sample("BRK.B", { 2: "BRK.B.N", 30: "2026-07-10 16:01:12", 64: "-" }), sample("NVDA")].join("\n");
  let calls = 0;
  const rows = await fetchTencentGrowthQuotes({ market: "美股", codes: ["NVDA", "BRK.B", "MSFT", "NVDA", "x&inject"],
    fetcher: async url => {
      calls++;
      assert.match(url.href, /q=usNVDA,usBRK.B,usMSFT$/);
      return new Response(batch);
    } });
  assert.equal(calls, 1);
  assert.deepEqual(rows.map(r => r.f12), ["NVDA", "BRK.B"]);
  assert.equal(rows[1].f13, 106);
  assert.equal(rows[1].f10, null);
  assert.equal(new Date(rows[1].f124 * 1000).toISOString(), "2026-07-10T20:01:12.000Z");
});

test("missing values stay missing and Mainland rounded amount can supply RMB", async () => {
  const [row] = await fetchTencentGrowthQuotes({ market: "A股", codes: ["302132"], fetcher: async () =>
    new Response(quote("sz302132", { ...mainland, 2: "302132", 35: "", 37: 1234, 45: "-",
      49: "", 63: "-", 69: "", 70: "0", 71: "N/A" })) });
  assert.equal(row.f6, 12340000);
  assert.deepEqual([row.f20, row.f10, row.return5d, row.return10d, row.return20d, row.f24],
    [null, null, null, null, 0, null]);
});

test("withholds Tencent's since-listing returns substituted for longer windows", async () => {
  const lines = [quote("sz301718", { ...mainland, 2: "301718", 62: 88.24, 69: 12.44, 70: 88.24, 71: 88.24 }),
    quote("sz301716", { ...mainland, 2: "301716", 62: 342.58, 70: -33.57, 71: 342.58 }),
    quote("sz300001", { ...mainland, 2: "300001", 30: "20260313161445", 62: 7, 70: 3, 71: 7 })];
  const rows = await fetchTencentGrowthQuotes({ market: "A股", codes: ["301718", "301716", "300001"],
    fetcher: async () => new Response(lines.join("\n")) });
  assert.deepEqual(rows.map(row => row.f24), [null, null, 7]);
});

test("reports HTTP errors and aborts a timed-out request without retrying", async () => {
  await assert.rejects(fetchTencentGrowthQuotes({ market: "港股", codes: ["00700"],
    fetcher: async () => new Response("", { status: 503 }) }), /503/);
  let count = 0;
  await assert.rejects(fetchTencentGrowthQuotes({ market: "美股", codes: ["NVDA"], timeoutMs: 10,
    fetcher: async (url, { signal }) => new Promise((resolve, reject) => {
      count++;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }) }), { name: "AbortError" });
  assert.equal(count, 1);
});
