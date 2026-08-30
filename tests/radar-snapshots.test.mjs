import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { onRequestGet as getRadar, scoreRadarCandidates } from "../functions/api/radar.js";
import {
  RADAR_SNAPSHOT_KEY,
  RADAR_SNAPSHOT_SCHEMA,
  readRadarSnapshotEnvelope,
  refreshRadarSnapshots,
} from "../functions/lib/radar-snapshot.js";
import { createRadarScheduler, runScheduledRadarRefresh } from "../workers/radar-scheduler/index.js";

const MARKET_ORDER = ["A股", "港股", "美股"];

function marketSnapshot(market, fetchedAt, suffix = "fresh") {
  return {
    market,
    modelVersion: "radar-v1.1",
    source: "测试行情",
    fetchedAt,
    rawSize: 500,
    eligibleSize: 300,
    poolSize: 1,
    candidates: [{ id: `${market}:${suffix}`, market, code: suffix, score: 70 }],
  };
}

function envelope(markets, publishedAt = "2026-08-29T00:10:00.000Z") {
  return {
    schema: RADAR_SNAPSHOT_SCHEMA,
    publishedAt,
    attemptedAt: publishedAt,
    markets,
    status: {
      freshMarkets: Object.keys(markets),
      staleMarkets: [],
      unavailableMarkets: MARKET_ORDER.filter((market) => !markets[market]),
    },
  };
}

function memoryKv(initial = null) {
  let value = initial === null ? null : JSON.stringify(initial);
  const calls = { get: [], put: [] };
  return {
    calls,
    async get(key) {
      calls.get.push(key);
      return value;
    },
    async put(key, nextValue) {
      calls.put.push([key, nextValue]);
      value = nextValue;
    },
    current() {
      return value === null ? null : JSON.parse(value);
    },
  };
}

test("radar percentile optimization preserves the exact legacy scores, ties, reasons, and ordering", () => {
  const values = [
    ["AAA", 1, 5, 1e9, 8e10, 20, 2, 3, 1],
    ["BBB", 1, 5, 1e9, 8e10, 20, 2, 3, 1],
    ["CCC", -2, null, 5e8, 3e10, -1, null, 9, 2],
    ["DDD", 7, 40, 2e9, 1e11, 40, 8, 1, 0.5],
    ["EEE", -8, -20, 2e8, 1e10, 12, 1, 15, 4],
    ["FFF", 0, 5, 1e9, 8e10, null, 18, null, 0],
  ];
  const candidates = values.map(([code, changePct, return60d, amount, marketCap, pe, pb, amplitude, turnoverRate]) => ({
    id: `美股:${code}`,
    market: "美股",
    code,
    name: code,
    currency: "USD",
    sina: `gb_${code.toLowerCase()}`,
    providerMarket: 105,
    quoteUpdatedAt: null,
    metrics: { price: 100, changePct, return60d, amount, marketCap, pe, pb, amplitude, turnoverRate },
  }));

  assert.deepEqual(
    scoreRadarCandidates(candidates).map(({ code, score, band, components, reasons, risks }) => ({ code, score, band, components, reasons, risks })),
    [
      { code: "DDD", score: 80.1, band: "priority", components: { trend: 35, liquidity: 30, risk: 13.6, quality: 1.5 }, reasons: ["成交活跃度位于本市场前列", "60日趋势与最近交易日动量位于本市场前列"], risks: ["最近交易日波动较大，避免把短期冲高当成确定性机会"] },
      { code: "AAA", score: 58.9, band: "watch", components: { trend: 19.5, liquidity: 18, risk: 13.1, quality: 8.3 }, reasons: ["60日趋势处于可继续研究区间"], risks: ["分数仅表示本市场内的研究优先级，不代表上涨概率"] },
      { code: "BBB", score: 58.9, band: "watch", components: { trend: 19.5, liquidity: 18, risk: 13.1, quality: 8.3 }, reasons: ["60日趋势处于可继续研究区间"], risks: ["分数仅表示本市场内的研究优先级，不代表上涨概率"] },
      { code: "FFF", score: 42.5, band: "reserve", components: { trend: 16.5, liquidity: 18, risk: 8, quality: 0 }, reasons: ["60日趋势处于可继续研究区间"], risks: ["市盈率缺失或为负，质量分不能代替基本面核查", "市净率处于较高水平，估值容错需要单独评估"] },
      { code: "EEE", score: 15, band: "reserve", components: { trend: 0, liquidity: 0, risk: 0, quality: 15 }, reasons: ["估值指标在本市场具有相对可比性"], risks: ["最近交易日波动较大，避免把短期冲高当成确定性机会"] },
      { code: "CCC", score: 14.2, band: "reserve", components: { trend: 2, liquidity: 6, risk: 6.2, quality: 0 }, reasons: ["核心行情数据完整，可纳入后续研究"], risks: ["最近交易日波动较大，避免把短期冲高当成确定性机会", "市盈率缺失或为负，质量分不能代替基本面核查"] },
    ],
  );
});

test("scheduled refresh scans markets sequentially and writes one unified fresh envelope", async () => {
  const kv = memoryKv();
  const calls = [];
  let active = 0;
  const result = await refreshRadarSnapshots({
    kv,
    now: () => new Date("2026-08-30T00:10:00.000Z"),
    scanMarket: async (market) => {
      assert.equal(active, 0, "markets must not overlap");
      active += 1;
      calls.push(market);
      await Promise.resolve();
      active -= 1;
      return marketSnapshot(market, "2026-08-30T00:10:00.000Z", market);
    },
  });

  assert.deepEqual(calls, MARKET_ORDER);
  assert.equal(result.written, true);
  assert.equal(kv.calls.put.length, 1);
  assert.equal(kv.calls.put[0][0], RADAR_SNAPSHOT_KEY);
  assert.deepEqual(kv.current(), {
    schema: "radar-snapshot-v2",
    publishedAt: "2026-08-30T00:10:00.000Z",
    attemptedAt: "2026-08-30T00:10:00.000Z",
    markets: Object.fromEntries(MARKET_ORDER.map((market) => [market, {
      ...marketSnapshot(market, "2026-08-30T00:10:00.000Z", market),
      loadState: "fresh",
      stale: false,
      error: null,
    }])),
    status: { freshMarkets: MARKET_ORDER, staleMarkets: [], unavailableMarkets: [] },
  });
});

test("partial refresh inherits an old market as stale and never invents freshness for a first failure", async () => {
  const previousHongKong = { ...marketSnapshot("港股", "2026-08-29T00:10:00.000Z", "old-hk"), loadState: "fresh", stale: false, error: null };
  const kv = memoryKv(envelope({ "港股": previousHongKong }));
  const result = await refreshRadarSnapshots({
    kv,
    now: () => new Date("2026-08-30T00:10:00.000Z"),
    scanMarket: async (market) => {
      if (market === "美股") return marketSnapshot(market, "2026-08-30T00:10:00.000Z", "new-us");
      throw Object.assign(new Error(`${market} unavailable`), { code: "TEST_UPSTREAM" });
    },
  });

  assert.equal(result.written, true);
  assert.equal(kv.calls.put.length, 1);
  const saved = kv.current();
  assert.equal(saved.markets["港股"].fetchedAt, "2026-08-29T00:10:00.000Z");
  assert.equal(saved.markets["港股"].loadState, "stale");
  assert.equal(saved.markets["港股"].stale, true);
  assert.deepEqual(saved.markets["港股"].error, { code: "TEST_UPSTREAM", message: "港股 unavailable", at: "2026-08-30T00:10:00.000Z" });
  assert.equal(Object.hasOwn(saved.markets, "A股"), false, "a first failure must not create a fake market snapshot");
  assert.equal(saved.markets["美股"].loadState, "fresh");
  assert.deepEqual(saved.status, { freshMarkets: ["美股"], staleMarkets: ["港股"], unavailableMarkets: ["A股"] });
});

test("an all-market failure does not overwrite either an old envelope or an empty namespace", async () => {
  const old = envelope({ "A股": { ...marketSnapshot("A股", "2026-08-29T00:10:00.000Z"), loadState: "fresh", stale: false, error: null } });
  for (const initial of [old, null]) {
    const kv = memoryKv(initial);
    const result = await refreshRadarSnapshots({
      kv,
      now: () => new Date("2026-08-30T00:10:00.000Z"),
      scanMarket: async (market) => { throw new Error(`${market} failed`); },
    });
    assert.equal(result.written, false);
    assert.equal(kv.calls.put.length, 0);
    assert.deepEqual(kv.current(), initial);
    assert.deepEqual(result.failedMarkets, MARKET_ORDER);
    assert.deepEqual(result.envelope, initial);
  }
});

test("snapshot reader rejects malformed or obsolete records", async () => {
  assert.equal(await readRadarSnapshotEnvelope({ get: async () => null }), null);
  assert.equal(await readRadarSnapshotEnvelope({ get: async () => "not-json" }), null);
  assert.equal(await readRadarSnapshotEnvelope({ get: async () => JSON.stringify({ schema: "radar-snapshot-v1", markets: {} }) }), null);
  const valid = envelope({});
  assert.deepEqual(await readRadarSnapshotEnvelope({ get: async () => JSON.stringify(valid) }), valid);
});

test("Pages GET returns a unified KV envelope without a market and keeps the legacy market response", async () => {
  const cachedA = { ...marketSnapshot("A股", "2026-08-30T00:10:00.000Z"), loadState: "fresh", stale: false, error: null };
  const cachedEnvelope = envelope({ "A股": cachedA }, "2026-08-30T00:10:00.000Z");
  const kv = memoryKv(cachedEnvelope);
  let fetchCalls = 0;

  const unified = await getRadar({
    request: new Request("https://example.test/api/radar"),
    env: { RADAR_SNAPSHOTS: kv },
    fetcher: async () => { fetchCalls += 1; throw new Error("must not fetch"); },
  });
  assert.equal(unified.status, 200);
  assert.equal(unified.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await unified.json(), cachedEnvelope);
  assert.equal(fetchCalls, 0);

  const legacy = await getRadar({
    request: new Request("https://example.test/api/radar?market=%E7%BE%8E%E8%82%A1"),
    env: { RADAR_SNAPSHOTS: kv },
    now: () => new Date("2026-08-30T00:10:00.000Z"),
    fetcher: async (input) => {
      fetchCalls += 1;
      const page = Number(new URL(input).searchParams.get("pn"));
      const rows = Array.from({ length: 100 }, (_, offset) => {
        const index = (page - 1) * 100 + offset;
        return { f2: 20, f3: 1, f6: 5e9 - index, f7: 2, f8: 1, f9: 20, f12: `T${index}`, f13: 105, f14: `Test ${index}`, f20: 5e10 - index, f23: 2, f24: 5, f124: 1788048000 };
      });
      return Response.json({ rc: 0, data: { diff: rows } });
    },
  });
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json()).market, "美股");
  assert.equal(fetchCalls, 5);
});

test("Pages GET reports missing unified data clearly and falls back to KV for a failed legacy scan", async () => {
  const noBinding = await getRadar({ request: new Request("https://example.test/api/radar") });
  assert.equal(noBinding.status, 503);
  assert.deepEqual(await noBinding.json(), { error: "机会雷达快照尚未配置", code: "RADAR_SNAPSHOT_UNAVAILABLE" });

  const empty = await getRadar({ request: new Request("https://example.test/api/radar"), env: { RADAR_SNAPSHOTS: memoryKv() } });
  assert.equal(empty.status, 503);
  assert.deepEqual(await empty.json(), { error: "机会雷达快照尚未生成", code: "RADAR_SNAPSHOT_UNAVAILABLE" });

  const cachedHongKong = { ...marketSnapshot("港股", "2026-08-29T00:10:00.000Z", "cached"), loadState: "fresh", stale: false, error: null };
  const failedLive = await getRadar({
    request: new Request("https://example.test/api/radar?market=%E6%B8%AF%E8%82%A1"),
    env: { RADAR_SNAPSHOTS: memoryKv(envelope({ "港股": cachedHongKong })) },
    now: () => new Date("2026-08-30T01:00:00.000Z"),
    fetcher: async () => new Response("unavailable", { status: 503 }),
  });
  assert.equal(failedLive.status, 200);
  const fallback = await failedLive.json();
  assert.equal(fallback.market, "港股");
  assert.equal(fallback.fetchedAt, "2026-08-29T00:10:00.000Z");
  assert.equal(fallback.loadState, "stale");
  assert.equal(fallback.stale, true);
  assert.equal(fallback.error.code, "RADAR_UPSTREAM_ERROR");
});

test("scheduler delegates one refresh to waitUntil and wrangler declares the daily cron plus shared binding", async () => {
  const kv = memoryKv();
  const direct = await runScheduledRadarRefresh({
    env: { RADAR_SNAPSHOTS: kv },
    now: () => new Date("2026-08-30T00:10:00.000Z"),
    scanMarket: async (market) => marketSnapshot(market, "2026-08-30T00:10:00.000Z"),
  });
  assert.equal(direct.written, true);

  let scheduledPromise = null;
  const scheduledCalls = [];
  const radarScheduler = createRadarScheduler(async (options) => {
    scheduledCalls.push(options);
    return { written: true };
  });
  radarScheduler.scheduled(
    { scheduledTime: Date.parse("2026-08-30T00:10:00.000Z"), cron: "10 0 * * *" },
    { RADAR_SNAPSHOTS: memoryKv() },
    { waitUntil(promise) { scheduledPromise = promise; } },
  );
  assert.ok(scheduledPromise instanceof Promise);
  await scheduledPromise;
  assert.equal(scheduledCalls.length, 1);
  assert.equal(scheduledCalls[0].now().toISOString(), "2026-08-30T00:10:00.000Z");

  const configText = await readFile(new URL("../workers/radar-scheduler/wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(configText.replace(/^\s*\/\/.*$/gm, ""));
  assert.deepEqual(config.triggers.crons, ["10 0 * * *"]);
  assert.equal(config.kv_namespaces[0].binding, "RADAR_SNAPSHOTS");

  const pagesConfig = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(pagesConfig, /name\s*=\s*"futuniuniu"/);
  assert.match(pagesConfig, /pages_build_output_dir\s*=\s*"\/"/);
  assert.match(pagesConfig, /\[\[env\.production\.kv_namespaces\]\]/);
  assert.match(pagesConfig, /binding\s*=\s*"RADAR_SNAPSHOTS"/);
  assert.match(pagesConfig, /id\s*=\s*"ef5aab4de2784bf59b61c4d0f59d6861"/);
});
