import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createHoldingsDocument, readGitHubHoldings, sanitizeHoldings, syncHoldingsToGitHub } from "../functions/lib/github-holdings.js";
import { normalizeSecurityInput, parseSinaQuote } from "../functions/lib/security-lookup.js";
import { onRequestGet, onRequestPost } from "../functions/api/holdings-sync.js";
import { onRequestGet as getHistory } from "../functions/api/history.js";
import { parseQuote as parseMarketQuote } from "../functions/api/quotes.js";
import { isEligibleRadarCandidate, normalizeRadarRow, onRequestGet as getRadar, scanRadarMarket, scoreRadarCandidates } from "../functions/api/radar.js";
import { onRequestGet as getRates } from "../functions/api/rates.js";
import { onRequest as authMiddleware } from "../functions/_middleware.js";

const holding = { market: "美股", code: "NVDA", name: "英伟达", status: "holding", cost: 200, qty: 3, currency: "USD", sina: "gb_nvda", buyFeeUsd: 20 };
const authEnv = { BASIC_AUTH_USER: "我的花名", BASIC_AUTH_PASSWORD: "test-password" };

function passwordRequest(url, password) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

function requestCookie(setCookie) {
  return setCookie.split(";", 1)[0];
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function signedSessionCookie(user, password, expiresAt) {
  const payload = base64Url(JSON.stringify({ u: user, exp: expiresAt }));
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `piggy_session=${payload}.${base64Url(signature)}`;
}

test("rates API returns live FX metadata with the provider market date", async () => {
  const response = await getRates({
    fetcher: async () => Response.json({
      date: "2026-08-15",
      rates: { USD: 1 / 7.22, HKD: 1 / 0.92 },
    }),
    now: () => new Date("2026-08-16T06:32:00.000Z"),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    rates: { USD_CNY: 7.22, HKD_CNY: 0.92 },
    asOf: "2026-08-15",
    fetchedAt: "2026-08-16T06:32:00.000Z",
    source: "Frankfurter",
    fallback: false,
  });
});

test("quote parser exposes the provider trading date for all three markets", () => {
  const aShare = Array(32).fill("");
  aShare[1] = "67"; aShare[2] = "66.19"; aShare[3] = "68.23"; aShare[4] = "68.5"; aShare[5] = "66.43";
  aShare[30] = "2026-08-17"; aShare[31] = "15:34:58";
  const hk = Array(19).fill("");
  hk[2] = "25.8"; hk[4] = "26.24"; hk[5] = "25.8"; hk[6] = "25.88"; hk[7] = "0.26"; hk[8] = "1.015";
  hk[17] = "2026/08/17"; hk[18] = "16:08";
  const us = ["英伟达", "227.08", "0.85", "2026-08-17 22:46:03", "1.92"];

  assert.deepEqual({ date: parseMarketQuote("sh601138", aShare.join(",")).date, time: parseMarketQuote("sh601138", aShare.join(",")).time }, { date: "2026-08-17", time: "15:34:58" });
  assert.deepEqual({ date: parseMarketQuote("hk01810", hk.join(",")).date, time: parseMarketQuote("hk01810", hk.join(",")).time }, { date: "2026-08-17", time: "16:08" });
  assert.deepEqual({ date: parseMarketQuote("gb_nvda", us.join(",")).date, time: parseMarketQuote("gb_nvda", us.join(",")).time }, { date: "2026-08-17", time: "22:46:03" });
});

test("rates API labels fixed fallback rates without claiming a market date", async () => {
  const response = await getRates({
    fetcher: async () => Response.json({
      date: "2026-08-15",
      rates: { USD: 0, HKD: null },
    }),
    now: () => new Date("2026-08-16T06:33:00.000Z"),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    rates: { USD_CNY: 7.22, HKD_CNY: 0.92 },
    asOf: null,
    fetchedAt: "2026-08-16T06:33:00.000Z",
    source: "固定参考汇率",
    fallback: true,
  });
});

test("history API returns 90 daily points from a six-month Yahoo request", async () => {
  const timestamps = Array.from({ length: 100 }, (_, index) => Date.UTC(2026, 0, index + 1) / 1000);
  const closes = timestamps.map((_, index) => 100 + index);
  const requests = [];
  const response = await getHistory({
    request: new Request("https://example.test/api/history?symbols=gb_nvda&days=90"),
    fetcher: async (url) => {
      requests.push(String(url));
      return Response.json({
        chart: {
          result: [{
            timestamp: timestamps,
            indicators: {
              quote: [{
                close: closes,
                open: closes.map((value) => value - 1),
                high: closes.map((value) => value + 1),
                low: closes.map((value) => value - 2),
              }],
            },
          }],
        },
      });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/NVDA\?range=6mo&interval=1d$/);
  const payload = await response.json();
  assert.equal(payload.days, 90);
  assert.equal(payload.histories.gb_nvda.length, 90);
  assert.deepEqual(payload.histories.gb_nvda[0], {
    date: "2026-01-11",
    time: "",
    open: 109,
    high: 111,
    low: 108,
    close: 110,
  });
  assert.equal(payload.histories.gb_nvda.at(-1).close, 199);
});

test("history API accepts the three portfolio benchmark aliases", async () => {
  const requestedSecids = [];
  const response = await getHistory({
    request: new Request("https://example.test/api/history?symbols=idx_csi300,idx_hsi,idx_sp500,idx_unknown,__proto__&days=10"),
    fetcher: async (url) => {
      const requestUrl = new URL(url);
      requestedSecids.push(requestUrl.searchParams.get("secid"));
      return Response.json({
        data: {
          klines: Array.from({ length: 10 }, (_, index) => {
            const date = new Date(Date.UTC(2026, 7, index + 1)).toISOString().slice(0, 10);
            return `${date},${100 + index},${101 + index},${102 + index},${99 + index}`;
          }),
        },
      });
    },
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.days, 10);
  assert.deepEqual(Object.keys(payload.histories).sort(), ["idx_csi300", "idx_hsi", "idx_sp500"]);
  assert.deepEqual(requestedSecids.sort(), ["1.000300", "100.HSI", "100.SPX"]);
  assert.equal(payload.histories.idx_csi300.length, 10);
  assert.equal(payload.histories.idx_hsi.at(-1).close, 110);
  assert.equal(payload.histories.idx_sp500[0].open, 100);
});

test("benchmark history aliases keep their Yahoo fallback symbols", async () => {
  const yahooPaths = [];
  const timestamp = Date.UTC(2026, 7, 15) / 1000;
  const response = await getHistory({
    request: new Request("https://example.test/api/history?symbols=idx_csi300,idx_hsi,idx_sp500&days=5"),
    fetcher: async (url) => {
      const requestUrl = new URL(url);
      if (requestUrl.hostname === "push2his.eastmoney.com") return Response.json({ data: null });
      yahooPaths.push(decodeURIComponent(requestUrl.pathname));
      return Response.json({
        chart: {
          result: [{
            timestamp: [timestamp],
            indicators: { quote: [{ open: [100], high: [102], low: [99], close: [101] }] },
          }],
        },
      });
    },
  });

  const payload = await response.json();
  assert.deepEqual(Object.keys(payload.histories).sort(), ["idx_csi300", "idx_hsi", "idx_sp500"]);
  assert.deepEqual(yahooPaths.sort(), [
    "/v8/finance/chart/000300.SS",
    "/v8/finance/chart/^GSPC",
    "/v8/finance/chart/^HSI",
  ]);
});

test("history API clamps long requests to 120 daily points", async () => {
  let requestedLimit = "";
  const klines = Array.from({ length: 135 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    return `${date},${100 + index},${101 + index},${102 + index},${99 + index}`;
  });
  const response = await getHistory({
    request: new Request("https://example.test/api/history?symbols=idx_csi300&days=999"),
    fetcher: async (url) => {
      requestedLimit = new URL(url).searchParams.get("lmt");
      return Response.json({ data: { klines } });
    },
  });

  const payload = await response.json();
  assert.equal(payload.days, 120);
  assert.equal(requestedLimit, "130");
  assert.equal(payload.histories.idx_csi300.length, 120);
  assert.equal(payload.histories.idx_csi300[0].date, klines.at(-120).slice(0, 10));
  assert.equal(payload.histories.idx_csi300.at(-1).close, 235);
});

function tencentDailyRows(count, start = 100) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10);
    const open = start + index;
    const close = open + 0.5;
    return [date, String(open), String(close), String(close + 1), String(open - 1)];
  });
}

test("history API falls back to Tencent qfq daily bars with direct A-share and HK keys", async () => {
  const tencentKeys = [];
  const response = await getHistory({
    request: new Request("https://example.test/api/history?symbols=sh601138,hk01810&days=65"),
    fetcher: async (input) => {
      const url = new URL(input);
      if (url.hostname === "push2his.eastmoney.com") return Response.json({ data: null });
      if (url.hostname === "query1.finance.yahoo.com") return new Response("Forbidden", { status: 403 });
      assert.equal(url.hostname, "web.ifzq.gtimg.cn");
      const [key, period, , , limit, adjustment] = url.searchParams.get("param").split(",");
      tencentKeys.push(key);
      assert.equal(period, "day");
      assert.equal(limit, "80");
      assert.equal(adjustment, "qfq");
      const rows = tencentDailyRows(66, key === "hk01810" ? 200 : 100);
      rows[3] = [rows[3][0], "103", "104", "103.5", "102"];
      return Response.json({
        code: 0,
        data: {
          [key]: key === "sh601138" ? { qfqday: rows } : { day: rows },
        },
      });
    },
  });

  const payload = await response.json();
  assert.deepEqual(tencentKeys.sort(), ["hk01810", "sh601138"]);
  assert.equal(payload.histories.sh601138.length, 65);
  assert.equal(payload.histories.hk01810.length, 65);
  assert.deepEqual(payload.histories.sh601138[0], {
    date: "2025-01-01",
    time: "",
    open: 100,
    high: 101.5,
    low: 99,
    close: 100.5,
  });
  assert.equal(payload.histories.sh601138.some((point) => point.date === "2025-01-04"), false);
  assert.deepEqual(payload.histories.hk01810.at(-1), {
    date: "2025-03-07",
    time: "",
    open: 265,
    high: 266.5,
    low: 264,
    close: 265.5,
  });
});

test("US Tencent fallback tries OQ then N and stops once 61 valid bars are available", async () => {
  const tencentKeys = [];
  const response = await getHistory({
    request: new Request("https://example.test/api/history?symbols=gb_nvda&days=90"),
    fetcher: async (input) => {
      const url = new URL(input);
      if (url.hostname === "query1.finance.yahoo.com") return new Response("Forbidden", { status: 403 });
      if (url.hostname === "push2his.eastmoney.com") return Response.json({ data: null });
      const key = url.searchParams.get("param").split(",", 1)[0];
      tencentKeys.push(key);
      const count = key.endsWith(".OQ") ? 20 : 62;
      return Response.json({ data: { [key]: { qfqday: tencentDailyRows(count, 300) } } });
    },
  });

  const payload = await response.json();
  assert.deepEqual(tencentKeys, ["usNVDA.OQ", "usNVDA.N"]);
  assert.equal(payload.histories.gb_nvda.length, 62);
  assert.equal(payload.histories.gb_nvda[0].open, 300);
  assert.equal(payload.histories.gb_nvda.at(-1).close, 361.5);
});

test("US Tencent fallback tries all suffixes and keeps the longest incomplete history", async () => {
  const tencentKeys = [];
  const lengths = { "usAMD.OQ": 20, "usAMD.N": 45, "usAMD.A": 30 };
  const response = await getHistory({
    request: new Request("https://example.test/api/history?symbols=gb_amd&days=90"),
    fetcher: async (input) => {
      const url = new URL(input);
      if (url.hostname === "query1.finance.yahoo.com") return new Response("Forbidden", { status: 403 });
      if (url.hostname === "push2his.eastmoney.com") return Response.json({ data: null });
      const key = url.searchParams.get("param").split(",", 1)[0];
      tencentKeys.push(key);
      return Response.json({ data: { [key]: { day: tencentDailyRows(lengths[key], 400) } } });
    },
  });

  const payload = await response.json();
  assert.deepEqual(tencentKeys, ["usAMD.OQ", "usAMD.N", "usAMD.A"]);
  assert.equal(payload.histories.gb_amd.length, 45);
  assert.equal(payload.histories.gb_amd.at(-1).close, 444.5);
});

test("local server mirrors benchmark aliases and the 120-day history cap", async () => {
  const source = await readFile(new URL("../server.py", import.meta.url), "utf8");
  assert.match(source, /"idx_csi300": \{"eastmoney": \["1\.000300"\], "yahoo": "000300\.SS"\}/);
  assert.match(source, /"idx_hsi": \{"eastmoney": \["100\.HSI"\], "yahoo": "\^HSI"\}/);
  assert.match(source, /"idx_sp500": \{"eastmoney": \["100\.SPX"\], "yahoo": "\^GSPC"\}/);
  assert.match(source, /days = max\(5, min\(days, 120\)\)/);
  assert.match(source, /def fetch_yahoo_history\(symbol, days, range_value="6mo", interval="1d"\):/);
});

test("normalizes security codes for all supported markets", () => {
  assert.deepEqual(normalizeSecurityInput("A股", "SH.601138"), { market: "A股", code: "601138", sina: "sh601138", currency: "CNY" });
  assert.deepEqual(normalizeSecurityInput("港股", "1810"), { market: "港股", code: "01810", sina: "hk01810", currency: "HKD" });
  assert.deepEqual(normalizeSecurityInput("美股", "$nvda"), { market: "美股", code: "NVDA", sina: "gb_nvda", currency: "USD" });
});

test("parses names from Sina quote payloads", () => {
  assert.equal(parseSinaQuote('var hq_str_sh601138="工业富联,65.600,65.230,66.190";', normalizeSecurityInput("A股", "601138")).name, "工业富联");
  assert.equal(parseSinaQuote('var hq_str_hk01810="XIAOMI-W,小米集团-W,25.860,25.880,26.120,25.440,25.620";', normalizeSecurityInput("港股", "1810")).name, "小米集团-W");
  assert.equal(parseSinaQuote('var hq_str_gb_nvda="英伟达,225.1600,-0.06";', normalizeSecurityInput("美股", "NVDA")).name, "英伟达");
});

test("sanitizes holdings before synchronization", () => {
  assert.deepEqual(sanitizeHoldings([{ ...holding, ignored: "never-upload" }]), [holding]);
});

test("reads the simplified v2 document and expands a partial sale", () => {
  const rows = sanitizeHoldings({
    version: 2,
    lots: [{ market: "US", code: "NVDA", name: "英伟达", buy: { price: 200, qty: 10 }, sell: { price: 210, qty: 4, date: "2026-08-16" }, fees: { buy: 20, sell: 20 } }],
  });
  assert.deepEqual(rows.map(({ status, qty, buyFeeUsd, sellFeeUsd }) => ({ status, qty, buyFeeUsd, sellFeeUsd })), [
    { status: "holding", qty: 6, buyFeeUsd: 12, sellFeeUsd: undefined },
    { status: "sold", qty: 4, buyFeeUsd: 8, sellFeeUsd: 20 },
  ]);
});

test("applies default v2 fees once while splitting a partial sale", () => {
  const rows = sanitizeHoldings({
    version: 2,
    lots: [
      { market: "US", code: "AAA", name: "AAA", buy: { price: 100, qty: 10 } },
      { market: "US", code: "BBB", name: "BBB", buy: { price: 50, qty: 10 }, sell: { price: 60, qty: 4, date: "2026-08-16" } },
    ],
  });

  assert.deepEqual(rows.map(({ code, status, qty, buyFeeUsd, sellFeeUsd }) => ({ code, status, qty, buyFeeUsd, sellFeeUsd })), [
    { code: "AAA", status: "holding", qty: 10, buyFeeUsd: 20, sellFeeUsd: undefined },
    { code: "BBB", status: "holding", qty: 6, buyFeeUsd: 12, sellFeeUsd: undefined },
    { code: "BBB", status: "sold", qty: 4, buyFeeUsd: 8, sellFeeUsd: 20 },
  ]);
  assert.equal(rows.reduce((total, row) => total + (row.buyFeeUsd || 0), 0), 40);
  assert.equal(rows.reduce((total, row) => total + (row.sellFeeUsd || 0), 0), 20);
});

test("honors declared v2 fee defaults and explicit zero-fee overrides", () => {
  const rows = sanitizeHoldings({
    version: 2,
    newTradeFeeUsd: { buy: 11, sell: 13 },
    lots: [
      { market: "US", code: "AAA", name: "AAA", buy: { price: 100, qty: 1 }, sell: { price: 110, qty: 1, date: "2026-08-16" } },
      { market: "US", code: "BBB", name: "BBB", buy: { price: 100, qty: 1 }, sell: { price: 110, qty: 1, date: "2026-08-16" }, fees: { buy: 0, sell: 0 } },
    ],
  });

  assert.deepEqual(rows.map(({ code, buyFeeUsd, sellFeeUsd }) => ({ code, buyFeeUsd, sellFeeUsd })), [
    { code: "AAA", buyFeeUsd: 11, sellFeeUsd: 13 },
    { code: "BBB", buyFeeUsd: 0, sellFeeUsd: 0 },
  ]);
});

test("round-trips expanded partial-sale fees without double counting", () => {
  const first = sanitizeHoldings({
    version: 2,
    lots: [{ market: "US", code: "AAA", name: "AAA", buy: { price: 100, qty: 10 }, sell: { price: 110, qty: 4, date: "2026-08-16" } }],
  });
  const second = sanitizeHoldings(createHoldingsDocument(first));
  const accountingShape = (rows) => rows.map(({ status, qty, buyFeeUsd, sellFeeUsd }) => ({ status, qty, buyFeeUsd, sellFeeUsd }));

  assert.deepEqual(accountingShape(second), accountingShape(first));
  assert.equal(second.reduce((total, row) => total + (row.buyFeeUsd || 0), 0), 20);
  assert.equal(second.reduce((total, row) => total + (row.sellFeeUsd || 0), 0), 20);
});

test("writes the readable v2 schema", () => {
  const document = createHoldingsDocument([holding]);
  assert.equal(document.version, 2);
  assert.deepEqual(document.lots, [{ market: "US", code: "NVDA", name: "英伟达", buy: { price: 200, qty: 3 }, fees: { buy: 20 } }]);
});

test("reads and sanitizes the current GitHub holdings document", async () => {
  const content = Buffer.from(JSON.stringify(createHoldingsDocument([holding])), "utf8").toString("base64");
  const calls = [];
  const result = await readGitHubHoldings({ token: "test-token", owner: "example", repo: "piggy", branch: "main" }, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ sha: "current-file-sha", encoding: "base64", content, html_url: "https://example.test/holdings.json" });
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/contents\/holdings\.json\?ref=main$/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(result.holdings, [holding]);
  assert.deepEqual(result.document, createHoldingsDocument([holding]));
  assert.equal(result.fileSha, "current-file-sha");
});

test("GET holdings sync returns current holdings without exposing its token", async () => {
  const secret = "server-only-token";
  const content = Buffer.from(JSON.stringify([holding]), "utf8").toString("base64");
  const response = await onRequestGet({
    env: { BASIC_AUTH_USER: "我的花名", BASIC_AUTH_PASSWORD: "test-password", PIGGY_GITHUB_TOKEN: secret },
    fetcher: async () => Response.json({ sha: "file-sha", encoding: "base64", content }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.holdings, [holding]);
  assert.deepEqual(payload.document, createHoldingsDocument([holding]));
  assert.equal(JSON.stringify(payload).includes(secret), false);
});

test("updates GitHub using the current file SHA", async () => {
  const calls = [];
  const result = await syncHoldingsToGitHub([holding], { token: "test-token", owner: "example", repo: "piggy" }, async (url, options) => {
    calls.push({ url, options });
    if (!options.method) return Response.json({ sha: "old-sha" });
    return Response.json({ commit: { sha: "commit-sha" }, content: { sha: "file-sha", html_url: "https://example.test/holdings.json" } });
  });
  assert.equal(calls.length, 2);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.sha, "old-sha");
  assert.deepEqual(JSON.parse(Buffer.from(body.content, "base64").toString("utf8")), createHoldingsDocument([holding]));
  assert.deepEqual(result, { commitSha: "commit-sha", fileSha: "file-sha", fileUrl: "https://example.test/holdings.json", alreadyCurrent: false });
});

test("accepts an identical GitHub file without creating another commit", async () => {
  const content = Buffer.from(JSON.stringify(createHoldingsDocument([holding]), null, 2) + "\n").toString("base64");
  let calls = 0;
  const result = await syncHoldingsToGitHub([holding], { token: "test-token" }, async () => {
    calls += 1;
    return Response.json({ sha: "same-sha", content, html_url: "https://example.test/holdings.json" });
  });
  assert.equal(calls, 1);
  assert.equal(result.alreadyCurrent, true);
  assert.equal(result.fileSha, "same-sha");
});

test("refuses writes when site authentication is not configured", async () => {
  const response = await onRequestPost({
    request: new Request("https://example.test/api/holdings-sync", { method: "POST", body: JSON.stringify({ holdings: [holding] }) }),
    env: {},
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

test("renders a self-contained black-gold password-only login page", async () => {
  const customResponse = await authMiddleware({
    request: new Request("https://example.test/login?next=%2Fholdings%3Fview%3Dactive"),
    env: { BASIC_AUTH_USER: "小猪 <管理员>", BASIC_AUTH_PASSWORD: "never-render-this-secret" },
    next: async () => new Response("should not run"),
  });
  assert.equal(customResponse.status, 200);
  assert.equal(customResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(customResponse.headers.has("www-authenticate"), false);
  assert.equal(customResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(customResponse.headers.get("referrer-policy"), "no-referrer");
  assert.match(customResponse.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(customResponse.headers.get("content-security-policy"), /style-src 'unsafe-inline'/);
  assert.match(customResponse.headers.get("content-security-policy"), /script-src 'unsafe-inline'/);
  assert.match(customResponse.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.match(customResponse.headers.get("content-security-policy"), /form-action 'self'/);
  assert.match(customResponse.headers.get("content-security-policy"), /base-uri 'none'/);
  assert.match(customResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const html = await customResponse.text();
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /密码提示/);
  assert.match(html, /小猪 &lt;管理员&gt;/);
  assert.match(html, /action="\/api\/login\?next=%2Fholdings%3Fview%3Dactive"/);
  assert.equal((html.match(/<input\b/gi) || []).length, 1);
  assert.match(html, /<input[^>]+type="password"/i);
  assert.match(html, /"Content-Type":"application\/json"/);
  assert.equal(html.includes("never-render-this-secret"), false);
  assert.match(html, /#d6a84b/i);

  const defaultResponse = await authMiddleware({
    request: new Request("https://example.test/login"),
    env: { BASIC_AUTH_PASSWORD: "test-password" },
    next: async () => new Response("should not run"),
  });
  assert.match(await defaultResponse.text(), /我的花名/);
});

test("rejects an incorrect password without creating a session", async () => {
  const response = await authMiddleware({
    request: passwordRequest("https://example.test/api/login?next=%2Foverview", "wrong-password"),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(response.headers.has("www-authenticate"), false);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "密码错误", code: "INVALID_PASSWORD" });
});

test("login accepts only bounded JSON password requests", async () => {
  const unsupported = await authMiddleware({
    request: new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=test-password",
    }),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  assert.equal(unsupported.status, 415);
  assert.deepEqual(await unsupported.json(), { error: "仅支持 JSON 登录请求", code: "UNSUPPORTED_MEDIA_TYPE" });

  const oversizedBody = await authMiddleware({
    request: new Request("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "5000" },
      body: JSON.stringify({ password: "test-password" }),
    }),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  assert.equal(oversizedBody.status, 413);
  assert.deepEqual(await oversizedBody.json(), { error: "登录请求过大", code: "REQUEST_TOO_LARGE" });

  const oversizedPassword = await authMiddleware({
    request: passwordRequest("https://example.test/api/login", "x".repeat(257)),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  assert.equal(oversizedPassword.status, 413);
  assert.deepEqual(await oversizedPassword.json(), { error: "密码长度超出限制", code: "PASSWORD_TOO_LONG" });
});

test("creates a seven-day signed session and allows protected content", async () => {
  const login = await authMiddleware({
    request: passwordRequest("https://example.test/api/login?next=%2Fholdings%3Fview%3Dactive", "test-password"),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.clone().json(), { ok: true, redirect: "/holdings?view=active" });
  assert.equal(login.headers.get("cache-control"), "private, no-store");
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /^piggy_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
  assert.match(setCookie, /Max-Age=604800/i);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//i);
  assert.equal(setCookie.includes("test-password"), false);

  let nextCalls = 0;
  const allowed = await authMiddleware({
    request: new Request("https://example.test/assets/app.js", { headers: { cookie: requestCookie(setCookie) } }),
    env: authEnv,
    next: async () => { nextCalls += 1; return new Response("protected asset"); },
  });
  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), "protected asset");
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  assert.match(allowed.headers.get("vary"), /Cookie/i);
  assert.equal(nextCalls, 1);

  const loginPageWhileSignedIn = await authMiddleware({
    request: new Request("https://example.test/login?next=%2Fmarket%3Fperiod%3D2w", { headers: { cookie: requestCookie(setCookie) } }),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  assert.equal(loginPageWhileSignedIn.status, 302);
  assert.equal(loginPageWhileSignedIn.headers.get("location"), "/market?period=2w");
});

test("redirects unsigned pages safely while unauthenticated APIs return JSON", async () => {
  let nextCalls = 0;
  const page = await authMiddleware({
    request: new Request("https://example.test/holdings?view=active"),
    env: authEnv,
    next: async () => { nextCalls += 1; return new Response("should not run"); },
  });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/login?next=%2Fholdings%3Fview%3Dactive");
  assert.equal(page.headers.has("www-authenticate"), false);

  const api = await authMiddleware({
    request: new Request("https://example.test/api/security-lookup"),
    env: authEnv,
    next: async () => { nextCalls += 1; return new Response("should not run"); },
  });
  assert.equal(api.status, 401);
  assert.equal(api.headers.has("www-authenticate"), false);
  assert.deepEqual(await api.json(), { error: "请先登录", code: "AUTH_REQUIRED" });
  assert.equal(nextCalls, 0);

  const unsafeLogin = await authMiddleware({
    request: passwordRequest("https://example.test/api/login?next=https%3A%2F%2Fevil.example", "test-password"),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  assert.deepEqual(await unsafeLogin.json(), { ok: true, redirect: "/" });
});

test("rejects tampered and expired session cookies", async () => {
  const login = await authMiddleware({
    request: passwordRequest("https://example.test/api/login", "test-password"),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  const validCookie = requestCookie(login.headers.get("set-cookie"));
  const tamperedCookie = validCookie.slice(0, -1) + (validCookie.endsWith("a") ? "b" : "a");
  const tampered = await authMiddleware({
    request: new Request("https://example.test/", { headers: { cookie: tamperedCookie } }),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  assert.equal(tampered.status, 302);

  const expiredCookie = await signedSessionCookie("我的花名", "test-password", Math.floor(Date.now() / 1000) - 1);
  const expired = await authMiddleware({
    request: new Request("https://example.test/api/holdings-sync", { headers: { cookie: expiredCookie } }),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  assert.equal(expired.status, 401);
  assert.deepEqual(await expired.json(), { error: "请先登录", code: "AUTH_REQUIRED" });
});

test("logs out by clearing the signed session cookie", async () => {
  const response = await authMiddleware({
    request: new Request("https://example.test/api/logout", { method: "POST" }),
    env: authEnv,
    next: async () => new Response("should not run"),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.clone().json(), { ok: true, redirect: "/login" });
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /^piggy_session=;/);
  assert.match(setCookie, /Max-Age=0/i);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//i);
});

test("fails closed when the Pages password is not configured", async () => {
  let nextCalls = 0;
  const page = await authMiddleware({
    request: new Request("https://example.test/login"),
    env: { BASIC_AUTH_USER: "我的花名" },
    next: async () => { nextCalls += 1; return new Response("should not run"); },
  });
  assert.equal(page.status, 503);
  assert.equal(page.headers.has("www-authenticate"), false);
  assert.equal(await page.text(), "网站登录尚未配置");

  const api = await authMiddleware({
    request: new Request("https://example.test/api/holdings-sync"),
    env: {},
    next: async () => { nextCalls += 1; return new Response("should not run"); },
  });
  assert.equal(api.status, 503);
  assert.deepEqual(await api.json(), { error: "网站登录尚未配置", code: "AUTH_NOT_CONFIGURED" });
  assert.equal(nextCalls, 0);
});

test("client adopts local holdings only after GitHub confirms the write", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const syncIndex = source.indexOf("await syncHoldingsToGitHubClient(nextHoldings)");
  const localIndex = source.indexOf("state.holdings = nextHoldings", syncIndex);
  assert.ok(syncIndex > 0);
  assert.ok(localIndex > syncIndex);
  assert.match(source, /GitHub 同步失败，本次未保存/);
});

test("startup paints local holdings before background authority checks", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const runnable = source.replace(/\nstart\(\)\.catch\(function \(error\) \{[\s\S]*?\n\}\);\s*$/, "\n");
  assert.notEqual(runnable, source);
  const context = vm.createContext({ location: { hash: "" }, localStorage: { getItem: () => null, setItem: () => {} } });
  new vm.Script(runnable).runInContext(context);
  const select = vm.runInContext("selectStartupHoldingsDocument", context);
  const plain = (value) => JSON.parse(JSON.stringify(value));

  assert.deepEqual(plain(select({ ok: true, holdings: [] }, [{ source: "static" }], [{ source: "local" }])), { source: "github", document: [] });
  assert.deepEqual(plain(select(null, [{ source: "static" }], [{ source: "local" }])), { source: "static", document: [{ source: "static" }] });
  assert.deepEqual(plain(select(null, null, [{ source: "local" }])), { source: "local", document: [{ source: "local" }] });
  assert.deepEqual(plain(select(null, null, null)), { source: "empty", document: [] });
  assert.match(source, /getJson\("\/api\/holdings-sync", null, 8000\)/);
  const localPaint = source.indexOf("if (isHoldingsDocument(linked))");
  const staticWait = source.indexOf("const staticResult = await staticRequest");
  const syncWait = source.indexOf("const syncPayload = await syncRequest");
  assert.ok(localPaint > 0 && localPaint < staticWait);
  assert.ok(staticWait > 0 && staticWait < syncWait);
  assert.match(source, /interactiveSnapshot === startupStateFingerprint\(\)/);
  assert.match(source, /readMarketCache\(\);\s+readRadarCache\(\);\s+rebuildRows\(\);/);
  assert.match(source, /const historyRequest = getJson\("\/api\/history/);
  assert.ok(source.indexOf("const historyRequest = getJson") < source.indexOf("const result = await Promise.all"));
});

test("overview client uses consistent fees, return ratios, 90-day history, and market ranking", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const runnable = source.replace(/\nstart\(\)\.catch\(function \(error\) \{[\s\S]*?\n\}\);\s*$/, "\n");
  const context = vm.createContext({ location: { hash: "" }, localStorage: { getItem: () => null, setItem: () => {} } });
  new vm.Script(runnable).runInContext(context);
  const plain = (value) => JSON.parse(JSON.stringify(value));

  const feeRows = plain(vm.runInContext(`holdingsFromDocument({
    version: 2,
    lots: [{ market: "US", code: "AAA", name: "AAA", buy: { price: 100, qty: 10 }, sell: { price: 110, qty: 4, date: "2026-08-16" } }]
  }).map(({ status, qty, buyFeeUsd, sellFeeUsd }) => ({ status, qty, buyFeeUsd, sellFeeUsd }))`, context));
  assert.deepEqual(feeRows, [
    { status: "holding", qty: 6, buyFeeUsd: 12, sellFeeUsd: null },
    { status: "sold", qty: 4, buyFeeUsd: 8, sellFeeUsd: 20 },
  ]);

  const account = plain(vm.runInContext(`state.rows = [
    { market: "美股", code: "AAA", status: "holding", purchaseCostCny: 1000, saleProceedsCny: 0, valueCny: 1200, pnlCny: 200, todayPnlCny: 100, hasTodayQuote: true, buyFeeUsd: 20, sellFeeUsd: NaN },
    { market: "美股", code: "BBB", status: "sold", purchaseCostCny: 500, saleProceedsCny: 600, valueCny: 0, pnlCny: 100, todayPnlCny: 0, buyFeeUsd: 20, sellFeeUsd: 20 }
  ]; summary()`, context));
  assert.equal(account.netInvested, 900);
  assert.equal(account.totalPnl, 300);
  assert.ok(Math.abs(account.totalRate - 33.33333333333333) < 1e-9);
  assert.ok(Math.abs(account.todayRate - 9.090909090909092) < 1e-9);
  assert.ok(Math.abs(account.totalFees - 433.2) < 1e-9);
  assert.equal(account.holdingCount, 1);

  const incomplete = plain(vm.runInContext(`state.rows = [
    { market: "美股", code: "MISS", status: "holding", purchaseCostCny: 1000, saleProceedsCny: 0, valueCny: NaN, pnlCny: NaN, todayPnlCny: NaN, hasTodayQuote: false }
  ]; summary()`, context));
  assert.equal(incomplete.valuationCount, 0);
  assert.equal(incomplete.valuationTotal, 1);
  assert.equal(incomplete.value, null);
  assert.equal(incomplete.totalPnl, null);
  assert.equal(incomplete.today, null);

  const staleQuote = plain(vm.runInContext(`(() => {
    state.holdings = [{ market: "美股", code: "STALE", name: "旧行情", status: "holding", cost: 100, qty: 2, currency: "USD", sina: "gb_stale", buyFeeUsd: 20 }];
    state.quotes = new Map([["gb_stale", { price: 150, change: 3, changePct: 2, date: calendarDateInTimeZone("America/New_York"), time: "16:00" }]]);
    state.quoteMeta = { gb_stale: new Date(Date.now() - 30 * 86400000).toISOString() };
    state.histories = {};
    rebuildRows();
    const row = state.rows[0], data = summary();
    return { priceSource: row.priceSource, valueCny: row.valueCny, hasTodayQuote: row.hasTodayQuote, valuationCount: data.valuationCount, value: data.value };
  })()`, context));
  assert.deepEqual(staleQuote, { priceSource: "cache", valueCny: null, hasTodayQuote: false, valuationCount: 0, value: null });

  const oldTradingDay = plain(vm.runInContext(`(() => {
    state.holdings = [{ market: "美股", code: "OLD", name: "旧交易日", status: "holding", cost: 100, qty: 2, currency: "USD", sina: "gb_old", buyFeeUsd: 20 }];
    state.quotes = new Map([["gb_old", { price: 150, change: 3, changePct: 2, date: "2026-07-01", time: "16:00" }]]);
    state.quoteMeta = { gb_old: new Date().toISOString() };
    state.histories = {};
    rebuildRows();
    return { hasLivePrice: state.rows[0].hasLivePrice, hasTodayQuote: state.rows[0].hasTodayQuote, futureAge: historyAgeDays("2099-01-01") };
  })()`, context));
  assert.deepEqual(oldTradingDay, { hasLivePrice: false, hasTodayQuote: false, futureAge: null });

  const historyWithStaleChange = plain(vm.runInContext(`(() => {
    const today = calendarDateInTimeZone("Asia/Shanghai");
    state.holdings = [{ market: "A股", code: "000001", name: "历史估值", status: "holding", cost: 100, qty: 100, currency: "CNY", sina: "sz000001", buyFeeUsd: 20 }];
    state.quotes = new Map([["sz000001", { price: 90, change: -9, changePct: -9, date: "2026-07-01", time: "15:00" }]]);
    state.quoteMeta = { sz000001: new Date(Date.now() - 30 * 86400000).toISOString() };
    state.histories = { sz000001: [{ date: today, open: 104, high: 106, low: 103, close: 105 }] };
    rebuildRows();
    return { source: state.rows[0].priceSource, hasTodayQuote: state.rows[0].hasTodayQuote, changePct: state.rows[0].changePct, action: state.rows[0].analysis.action };
  })()`, context));
  assert.deepEqual(historyWithStaleChange, { source: "history", hasTodayQuote: false, changePct: null, action: "持有" });

  const chartFallback = plain(vm.runInContext(`state.rates = { CNY: 1, HKD: 0.92, USD: 7.22 };
    state.rows = [{ market: "A股", code: "000001", status: "holding", sina: "sz000001", currency: "CNY", qty: 10, price: 120, valueCny: 1200 }];
    state.histories = {};
    portfolioValueSeries(30)`, context));
  assert.deepEqual(chartFallback, [{ date: "当前", value: 1200 }]);
  const chartHistory = plain(vm.runInContext(`state.histories = { sz000001: [{ date: "2026-08-14", close: 100 }, { date: "2026-08-15", close: 110 }] };
    portfolioValueSeries(30)`, context));
  assert.deepEqual(chartHistory, [{ date: "2026-08-14", value: 1000 }, { date: "2026-08-15", value: 1100 }, { date: "当前", value: 1200 }]);
  assert.deepEqual(plain(vm.runInContext("state.rows = []; portfolioValueSeries(30)", context)), []);

  const incompleteOverview = vm.runInContext(`state.rows = [{ market: "美股", code: "MISS", name: "缺行情", status: "holding", currency: "USD", qty: 1, cost: 10, purchaseCostCny: 216.6, valueCny: NaN, pnlCny: NaN, todayPnlCny: NaN, hasTodayQuote: false, analysis: { text: "等待行情" } }]; rankCard()`, context);
  assert.match(incompleteOverview, /1 只待估值/);
  const staleAction = plain(vm.runInContext(`analysisFor({ status: "holding", price: 100, cost: 120, pnlRate: -20, changePct: -6, priceSource: "cache", currency: "CNY" })`, context));
  assert.equal(staleAction.action, "等待行情");
  assert.match(staleAction.text, /等待当前或最近有效行情/);
  assert.match(source, /\/api\/history\?symbols=.*&days=90/);
  assert.match(source, /\[7, 30, 90\]/);
  assert.match(source, /data-rank-market/);
  assert.match(source, /new Map\(\[\]\.concat\(Array\.from\(state\.quotes\.entries\(\)\), quoteEntries\)\)/);
  assert.match(source, /state\.quoteMeta\[entry\[0\]\] = fetchedAt/);
  assert.match(source, /if \(state\.tab === "radar"\) loadRadar\(true\); else refreshData\(\)/);
  assert.match(source, /quoteHasRecentPrice\(local\.sina, quote\)/);
  assert.match(source, /Object\.assign\(\{\}, state\.histories, historyResult\.histories\)/);
  assert.doesNotMatch(source, /state\.quotes = new Map\(Object\.entries\(result\[0\]\.quotes\)\)/);
  assert.doesNotMatch(source, /state\.histories = historyResult\.histories/);
  assert.match(source, /cnyMode === "cost" \? "成本 "/);
  assert.match(source, /cnyMode === "accounting" \? "含汇兑 " \+ cnyText/);
  assert.match(source, /ranking-native " \+ tone\(row\.pnlNative\)/);
  assert.match(source, /canvas\.addEventListener\("pointerdown", updatePointerHover\)/);
  assert.match(source, /event\.key !== "ArrowLeft"/);
  assert.deepEqual(plain(vm.runInContext("chartLabelIndexes(90, 90, 390)", context)), [0, 18, 36, 53, 71, 89]);
  assert.deepEqual(plain(vm.runInContext("chartLabelIndexes(90, 90, 280)", context)), [0, 30, 59, 89]);
  assert.equal(vm.runInContext("formatChartDate('2026-07-06', true)", context), "7/6");
  assert.match(source, /\["actions", "持仓明细"\]/);
  assert.match(source, /page-title\\\">持仓明细/);
  assert.doesNotMatch(source, /优先处理|priorityActionTable|priorityRows/);
  assert.doesNotMatch(source, /\["review",\s*"复盘"\]/);
  assert.match(source, /const VALID_TABS = NAV_ITEMS\.map/);
});

test("holdings detail aggregates lots, filters, sorts, and renders an honest two-week outlook", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const runnable = source.replace(/\nstart\(\)\.catch\(function \(error\) \{[\s\S]*?\n\}\);\s*$/, "\n");
  const context = vm.createContext({ location: { hash: "#actions" }, localStorage: { getItem: () => null, setItem: () => {} } });
  new vm.Script(runnable).runInContext(context);
  const plain = (value) => JSON.parse(JSON.stringify(value));

  const aggregation = plain(vm.runInContext(`state.rows = [
    { market: "A股", code: "000001", name: "甲公司", status: "holding", sina: "sz000001", currency: "CNY", qty: 10, cost: 100, price: 120, purchaseCostCny: 1000, valueCny: 1200, pnlCny: 200, todayPnlCny: 50, quote: { price: 120, change: 5, changePct: 4.35 }, history: [] },
    { market: "A股", code: "000001", name: "甲公司", status: "holding", sina: "sz000001", currency: "CNY", qty: 5, cost: 100, price: 120, purchaseCostCny: 500, valueCny: 600, pnlCny: 100, todayPnlCny: 25, quote: { price: 120, change: 5, changePct: 4.35 }, history: [] },
    { market: "美股", code: "BBB", name: "乙公司", status: "holding", sina: "gb_bbb", currency: "USD", qty: 2, cost: 100, price: 90, purchaseCostCny: 1500, valueCny: 1300, pnlCny: -200, todayPnlCny: -30, quote: { price: 90, change: -2, changePct: -2.26 }, history: [] },
    { market: "A股", code: "000001", name: "甲公司", status: "sold", sina: "sz000001", currency: "CNY", qty: 2, cost: 80, price: 90, purchaseCostCny: 160, valueCny: 0, pnlCny: 20, todayPnlCny: 0, history: [] }
  ];
  openSecurityRows().map(({ holdingKey, qty, purchaseCostCny, valueCny, pnlCny, pnlNative, todayPnlCny, todayPnlNative, holdingPct }) => ({ holdingKey, qty, purchaseCostCny, valueCny, pnlCny, pnlNative, todayPnlCny, todayPnlNative, holdingPct }))`, context));
  assert.equal(aggregation.length, 2);
  assert.deepEqual(aggregation[0], {
    holdingKey: "A股:sz000001",
    qty: 15,
    purchaseCostCny: 1500,
    valueCny: 1800,
    pnlCny: 300,
    pnlNative: 300,
    todayPnlCny: 75,
    todayPnlNative: 75,
    holdingPct: 1800 / 3100 * 100,
  });
  assert.deepEqual(aggregation[1], {
    holdingKey: "美股:gb_bbb",
    qty: 2,
    purchaseCostCny: 1500,
    valueCny: 1300,
    pnlCny: -200,
    pnlNative: -20,
    todayPnlCny: -30,
    todayPnlNative: -4,
    holdingPct: 1300 / 3100 * 100,
  });

  const distribution = plain(vm.runInContext(`holdingSnapshot([
    { pnlCny: 100, todayPnlCny: 10, hasTodayQuote: true, hasValuation: true, valueCny: 1000, purchaseCostCny: 900 },
    { pnlCny: -50, todayPnlCny: -5, hasTodayQuote: true, hasValuation: true, valueCny: 800, purchaseCostCny: 850 },
    { pnlCny: 0, todayPnlCny: 0, hasTodayQuote: true, hasValuation: true, valueCny: 500, purchaseCostCny: 500 },
    { pnlCny: NaN, todayPnlCny: NaN, hasTodayQuote: false, hasValuation: false, valueCny: NaN, purchaseCostCny: 400 }
  ])`, context));
  assert.deepEqual({
    cumulative: [distribution.profitCount, distribution.lossCount, distribution.flatCount, distribution.unavailableCount],
    today: [distribution.todayProfitCount, distribution.todayLossCount, distribution.todayFlatCount, distribution.todayUnavailableCount],
  }, { cumulative: [1, 1, 1, 1], today: [1, 1, 1, 1] });

  const dualCurrencyMarkup = vm.runInContext(`state.market = "全部"; state.holdingPnlFilter = "all"; state.holdingQuery = ""; actionsPage()`, context);
  assert.match(dualCurrencyMarkup, /今日盈亏分布/);
  assert.match(dualCurrencyMarkup, /累计盈亏分布/);
  assert.match(dualCurrencyMarkup, /-US\$4\.00/);
  assert.match(dualCurrencyMarkup, /-US\$20\.00/);

  const filtered = plain(vm.runInContext(`state.market = "A股"; state.holdingPnlFilter = "profit"; state.holdingQuery = "000001";
    filteredHoldingRows(openSecurityRows()).map(({ market, code }) => ({ market, code }))`, context));
  assert.deepEqual(filtered, [{ market: "A股", code: "000001" }]);
  const sorted = plain(vm.runInContext(`state.market = "全部"; state.holdingPnlFilter = "all"; state.holdingQuery = ""; state.actionSort = "pnl"; state.actionSortDirection = "asc";
    sortActionRows(openSecurityRows()).map(({ code, pnlCny }) => ({ code, pnlCny }))`, context));
  assert.deepEqual(sorted, [{ code: "BBB", pnlCny: -200 }, { code: "000001", pnlCny: 300 }]);

  const partialCoverage = plain(vm.runInContext(`state.rows = [
    { market: "美股", code: "PART", name: "部分行情", status: "holding", sina: "gb_part", currency: "USD", qty: 1, cost: 100, price: 120, purchaseCostCny: 722, valueCny: 866.4, pnlCny: 144.4, todayPnlCny: 14.4, quote: { price: 120, change: 2, changePct: 1.69 }, hasTodayQuote: true, history: [] },
    { market: "美股", code: "PART", name: "部分行情", status: "holding", sina: "gb_part", currency: "USD", qty: 1, cost: 100, price: NaN, purchaseCostCny: 722, valueCny: NaN, pnlCny: NaN, todayPnlCny: NaN, quote: null, hasTodayQuote: false, history: [] }
  ];
  const row = openSecurityRows()[0];
  ({ hasValuation: row.hasValuation, hasTodayQuote: row.hasTodayQuote, pnlCny: row.pnlCny, pnlNative: row.pnlNative, todayPnlCny: row.todayPnlCny, todayPnlNative: row.todayPnlNative })`, context));
  assert.deepEqual(partialCoverage, { hasValuation: false, hasTodayQuote: false, pnlCny: null, pnlNative: null, todayPnlCny: null, todayPnlNative: null });

  const missingMarkup = vm.runInContext(`state.rows = [{ market: "美股", code: "MISS", name: "缺行情", status: "holding", sina: "gb_miss", currency: "USD", qty: 1, cost: 10, price: NaN, purchaseCostCny: 216.6, valueCny: NaN, pnlCny: NaN, todayPnlCny: NaN, changePct: NaN, buyFeeUsd: 20, quote: null, history: [], priceSource: "cost", hasLivePrice: false, hasTodayQuote: false }]; actionsPage()`, context);
  assert.doesNotMatch(missingMarkup, /NaN%|width:NaN/);
  assert.match(missingMarkup, /待估值|行情缺失/);

  const forecasts = plain(vm.runInContext(`(() => {
    function makeSeries(direction, length) {
      let close = 100;
      const today = new Date();
      return Array.from({ length }, (_, index) => {
        if (index) close *= 1 + direction * (0.008 + ((index % 5) - 2) * 0.0006);
        const date = new Date(today); date.setUTCDate(today.getUTCDate() - (length - 1 - index));
        return { date: date.toISOString().slice(0, 10), open: close * (1 - direction * 0.002), high: close * 1.01, low: close * 0.99, close };
      });
    }
    state.histories = { idx_csi300: makeSeries(1, 90) };
    const base = { market: "A股", code: "000001", name: "甲公司", sina: "sz000001", currency: "CNY", quote: { price: 200 } };
    const broken = makeSeries(1, 90); broken[broken.length - 2].high = NaN;
    return [
      holdingTwoWeekAnalysis({ ...base, history: makeSeries(1, 90) }),
      holdingTwoWeekAnalysis({ ...base, history: makeSeries(-1, 90) }),
      holdingTwoWeekAnalysis({ ...base, history: makeSeries(1, 30) }),
      holdingTwoWeekAnalysis({ ...base, history: broken })
    ].map(({ status, label, confidence, completeness, reason }) => ({ status, label, confidence, completeness, reason }));
  })()`, context));
  assert.equal(forecasts[0].status, "up");
  assert.equal(forecasts[0].label, "上涨倾向");
  assert.equal(forecasts[1].status, "down");
  assert.equal(forecasts[1].label, "下跌倾向");
  assert.equal(forecasts[2].status, "unknown");
  assert.match(forecasts[2].reason, /不足60个交易日/);
  assert.equal(forecasts[3].status, "unknown");
  assert.match(forecasts[3].reason, /OHLC|关键价位/);

  assert.match(source, /data-holding-search/);
  assert.match(source, /data-holding-pnl/);
  assert.match(source, /data-toggle-holding/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /aria-sort/);
  assert.match(source, /未来2周技术展望/);
  assert.match(source, /方向概率尚未经过历史校准/);
  assert.doesNotMatch(source, /上涨概率\s*[：:]\s*\d|下跌概率\s*[：:]\s*\d/);
});

test("opportunity radar filters the 600-plus pool, explains its score, and keeps watch items reversible", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const runnable = source.replace(/\nstart\(\)\.catch\(function \(error\) \{[\s\S]*?\n\}\);\s*$/, "\n");
  const context = vm.createContext({ location: { hash: "#radar" }, localStorage: { getItem: () => null, setItem: () => {} } });
  new vm.Script(runnable).runInContext(context);
  const plain = (value) => JSON.parse(JSON.stringify(value));

  const result = plain(vm.runInContext(`(() => {
    function candidate(market, code, name, score, band, trend, amount) {
      const currency = market === "A股" ? "CNY" : market === "港股" ? "HKD" : "USD";
      return {
        id: market + ":" + code, market, code, name, currency,
        sina: market === "A股" ? "sh" + code : market === "港股" ? "hk" + code : "gb_" + code.toLowerCase(),
        score, band,
        components: { trend: Math.min(35, score * .35), liquidity: Math.min(30, score * .30), risk: Math.min(20, score * .20), quality: Math.min(15, score * .15) },
        metrics: { price: 100, changePct: 1.2, return60d: trend, amount, marketCap: 100000000000, pe: 18, pb: 2, amplitude: 2.5, turnoverRate: 1.8 },
        reasons: ["成交活跃度位于本市场前列"], risks: ["分数不代表上涨概率"],
        source: "东方财富行情中心", quoteUpdatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), loadState: "fresh"
      };
    }
    state.holdings = [{ market: "港股", code: "00700", name: "腾讯控股", status: "holding", cost: 1, qty: 1, currency: "HKD", sina: "hk00700" }];
    state.rows = [];
    state.radarRows = [
      candidate("港股", "00700", "腾讯控股", 91, "priority", 50, 9e9),
      candidate("A股", "600001", "甲公司", 85, "priority", 32, 8e9),
      candidate("美股", "NVDA", "英伟达", 72, "priority", 45, 7e9),
      candidate("美股", "AMD", "超威半导体", 60, "watch", 20, 6e9),
      candidate("A股", "600002", "乙公司", 40, "reserve", -12, 5e9)
    ];
    state.radarMarkets = Object.fromEntries(RADAR_MARKETS.map(function (market) {
      const rows = Array.from({ length: 240 }, function (_, index) {
        const code = market === "A股" ? String(600100 + index) : market === "港股" ? String(1000 + index).padStart(5, "0") : "X" + String(index).padStart(4, "0");
        return candidate(market, code, market + "池" + index, 60, "watch", 12, 1e9 + index);
      });
      return [market, { market, modelVersion: RADAR_MODEL_VERSION, source: "东方财富行情中心", fetchedAt: new Date().toISOString(), poolSize: 240, rawSize: 500, candidates: rows, loadState: "fresh" }];
    }));
    state.radarStatus = "success";
    state.watchMarket = "全部"; state.radarBand = "priority"; state.radarSort = "score"; state.radarQuery = "";
    const priority = filteredRadarRows().map(function (item) { return item.id; });
    state.watchMarket = "美股"; state.radarBand = "all"; state.radarQuery = "NV";
    const searched = filteredRadarRows().map(function (item) { return item.id; });
    state.watchMarket = "全部"; state.radarBand = "priority"; state.radarQuery = "";
    const validation = {
      valid: isRadarSnapshot(state.radarMarkets["A股"], "A股"),
      emptyPool: isRadarSnapshot({ ...state.radarMarkets["A股"], candidates: [] }, "A股"),
      wrongVersion: isRadarSnapshot({ ...state.radarMarkets["A股"], modelVersion: "old-model" }, "A股")
    };
    const fresh = candidate("美股", "FRESH", "新结果", 70, "priority", 20, 5e9);
    const cached = candidate("A股", "600999", "缓存结果", 99, "priority", 50, 9e9); cached.loadState = "cached";
    const originalRows = state.radarRows; state.radarRows = [cached, fresh];
    const freshnessOrder = filteredRadarRows().map(function (item) { return item.id; });
    state.radarRows = originalRows;
    const expired = candidate("美股", "OLD", "过期结果", 88, "priority", 40, 8e9);
    expired.fetchedAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const expiredState = radarEffectiveLoadState(expired);
    const expiredMarkup = radarCandidateRow(expired, 1);
    state.radarSort = "trend";
    const nullSort = radarSortValue({ metrics: { return60d: null } });
    state.radarSort = "score";
    return {
      priority, searched, freshnessOrder, validation, expiredState, expiredMarkup,
      nulls: { pct: pct(null), ratio: ratioPct(null), native: nativeMoney(null, "USD"), sort: nullSort },
      issuerAlias: normalizedIssuerName("阿里巴巴-W") === normalizedIssuerName("阿里巴巴"),
      markup: radarPage(), normalizedInvalid: normalizeWatchlist({ broken: true })
    };
  })()`, context));

  assert.deepEqual(result.priority, ["A股:600001", "美股:NVDA"]);
  assert.deepEqual(result.searched, ["美股:NVDA"]);
  assert.deepEqual(result.freshnessOrder, ["美股:FRESH", "A股:600999"]);
  assert.deepEqual(result.validation, { valid: true, emptyPool: false, wrongVersion: false });
  assert.equal(result.expiredState, "cached");
  assert.match(result.expiredMarkup, /is-cached/);
  assert.match(result.expiredMarkup, /缓存 ·/);
  assert.deepEqual(result.nulls, { pct: "--", ratio: "--", native: "--", sort: null });
  assert.equal(result.issuerAlias, true);
  assert.deepEqual(result.normalizedInvalid, []);
  assert.match(result.markup, /有效基础池\s*<b>720 只<\/b>/);
  assert.match(result.markup, /怎么判断选择/);
  assert.match(result.markup, /60日趋势25 \+ 最近交易日动量10/);
  assert.match(result.markup, /短期波动/);
  assert.match(result.markup, /估值可比性/);
  assert.match(result.markup, /研究优先级不是上涨概率/);
  assert.match(result.markup, /data-toggle-watch=/);
  assert.match(result.markup, /data-toggle-radar=/);
  assert.doesNotMatch(result.markup, /热度/);
  assert.match(source, /data-toggle-watch/);
  assert.match(source, /移出观察/);
  assert.match(source, /RADAR_PAGE_SIZE = 10/);
  assert.match(source, /fetch\("\/api\/radar\?market="/);
  assert.doesNotMatch(source, /const candidates = \[/);
});

test("radar price model accepts 90 valid bars and fails closed for thin malformed or extreme histories", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const runnable = source.replace(/\nstart\(\)\.catch\(function \(error\) \{[\s\S]*?\n\}\);\s*$/, "\n");
  const context = vm.createContext({ location: { hash: "#radar" }, localStorage: { getItem: () => null, setItem: () => {} } });
  new vm.Script(runnable).runInContext(context);
  const plain = (value) => JSON.parse(JSON.stringify(value));

  const result = plain(vm.runInContext(`(() => {
    const today = calendarDateInTimeZone("Asia/Shanghai");
    const now = new Date(today + "T10:30:00.000Z");
    const dates = [];
    const cursor = new Date(today + "T12:00:00.000Z");
    while (dates.length < 90) {
      if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) dates.unshift(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    const history = dates.map(function (date, index) {
      const close = 100 + index * 0.25 + Math.sin(index / 3) * 1.5;
      return { date: date, open: close - 0.4, high: close + 1.2, low: close - 1.1, close: close };
    });
    const item = {
      id: "A股:600001", market: "A股", code: "600001", name: "测试股份", currency: "CNY", sina: "sh600001",
      score: 82, components: { trend: 30, liquidity: 24, risk: 16, quality: 12 },
      metrics: { price: 123, changePct: 1.2, return60d: 25, amount: 5e9, marketCap: 2e11, pe: 18 },
      reasons: ["成交活跃度位于本市场前列"], risks: ["分数不代表上涨概率"],
      source: "东方财富行情中心", quoteUpdatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), loadState: "fresh"
    };
    const malformed = history.map(function (point) { return Object.assign({}, point); });
    malformed[malformed.length - 3].high = malformed[malformed.length - 3].close - 0.01;
    const extreme = history.map(function (point, index) {
      if (index < 29) return Object.assign({}, point);
      const close = index % 2 ? 160 : 100;
      return { date: point.date, open: close, high: close * 1.02, low: close * 0.98, close: close };
    });
    const valid = radarTenDayLevels(item, history, now);
    const thin = radarTenDayLevels(item, history.slice(-60), now);
    const invalid = radarTenDayLevels(item, malformed, now);
    const unstable = radarTenDayLevels(item, extreme, now);
    state.radarHistories[item.sina] = history;
    state.radarHistoryStatus[item.sina] = { state: "ready", message: "" };
    const markup = radarCandidateRow(item, 1);
    const planStart = markup.indexOf('<dl class="radar-price-plan');
    const planEnd = planStart >= 0 ? markup.indexOf("</dl>", planStart) : -1;
    const pricePlan = planStart >= 0 && planEnd >= 0 ? markup.slice(planStart, planEnd + 5) : "";
    return {
      valid: valid,
      thin: thin,
      invalid: invalid,
      unstable: unstable,
      pricePlan: pricePlan,
      pricePlanTerms: (pricePlan.match(/<dt>/g) || []).length
    };
  })()`, context));

  assert.equal(result.valid.status, "ready");
  assert.equal(result.valid.bars, 90);
  assert.ok(result.valid.upper > 123);
  assert.ok(result.valid.stop > 0 && result.valid.stop < 123);
  assert.ok(result.valid.upperPct >= 3 && result.valid.upperPct <= 25);
  assert.ok(result.valid.stopPct <= -3 && result.valid.stopPct >= -15);
  assert.equal(result.thin.status, "insufficient");
  assert.match(result.thin.reason, /60\/61/);
  assert.equal(result.invalid.status, "invalid");
  assert.match(result.invalid.reason, /OHLC/);
  assert.equal(result.unstable.status, "unstable");
  assert.match(result.unstable.reason, /异常跳空|波动过大|公司行动/);
  assert.equal(result.pricePlanTerms, 3);
  assert.match(result.pricePlan, /当前价/);
  assert.match(result.pricePlan, /10日参考上沿/);
  assert.match(result.pricePlan, /风控止损参考/);
  assert.match(result.pricePlan, /非目标价/);
  assert.match(result.pricePlan, /日收盘低于/);
});

test("radar history batches only the visible ten as five plus five and keeps watchlist free of derived levels", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const runnable = source.replace(/\nstart\(\)\.catch\(function \(error\) \{[\s\S]*?\n\}\);\s*$/, "\n");
  const context = vm.createContext({ location: { hash: "#radar" }, localStorage: { getItem: () => null, setItem: () => {} } });
  new vm.Script(runnable).runInContext(context);
  const plain = (value) => JSON.parse(JSON.stringify(value));

  const result = plain(vm.runInContext(`(() => {
    function candidate(index) {
      const code = String(600001 + index);
      return {
        id: "A股:" + code, market: "A股", code: code, name: "候选" + (index + 1), currency: "CNY", sina: "sh" + code,
        score: 100 - index, components: { trend: 30, liquidity: 24, risk: 16, quality: 12 },
        metrics: { price: 100 + index, changePct: 1, return60d: 20, amount: 5e9, marketCap: 2e11, pe: 18 },
        reasons: ["用于批次测试"], risks: ["仅供研究"], source: "测试行情",
        quoteUpdatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), loadState: "fresh"
      };
    }
    state.holdings = [];
    state.rows = [];
    state.radarRows = Array.from({ length: 12 }, function (_, index) { return candidate(index); });
    state.watchMarket = "全部";
    state.radarBand = "all";
    state.radarSort = "score";
    state.radarQuery = "";
    state.radarPage = 1;
    const view = radarPageWindow();
    const batches = radarHistoryBatches(view.pageRows);
    const fingerprint = radarVisibleFingerprint(view.pageRows);
    const polluted = Object.assign({}, view.pageRows[0], {
      history: [{ date: "2026-08-18", close: 100 }], upper: 112, upperPct: 12, stop: 94, stopPct: -6
    });
    const savedWatchEntry = normalizeWatchlist([polluted])[0];
    return {
      pageCount: view.pageRows.length,
      batchSizes: batches.map(function (batch) { return batch.length; }),
      batchSymbols: batches.map(function (batch) { return batch.map(function (item) { return item.sina; }); }),
      visibleSymbols: view.pageRows.map(function (item) { return item.sina; }),
      hiddenSymbols: view.rows.slice(10).map(function (item) { return item.sina; }),
      fingerprint: fingerprint,
      savedWatchEntry: savedWatchEntry
    };
  })()`, context));

  assert.equal(result.pageCount, 10);
  assert.deepEqual(result.batchSizes, [5, 5]);
  assert.deepEqual(result.batchSymbols.flat(), result.visibleSymbols);
  assert.equal(result.fingerprint, result.visibleSymbols.join(","));
  result.hiddenSymbols.forEach((symbol) => assert.doesNotMatch(result.fingerprint, new RegExp(symbol)));
  assert.doesNotMatch(JSON.stringify(result.savedWatchEntry), /"(?:history|upper|upperPct|stop|stopPct)"/);
});

test("Pages keeps portfolio data behind Functions while serving only static assets directly", async () => {
  const routes = JSON.parse(await readFile(new URL("../_routes.json", import.meta.url), "utf8"));
  assert.deepEqual(routes, { version: 1, include: ["/*"], exclude: ["/assets/*", "/pet/*"] });
  const headers = await readFile(new URL("../_headers", import.meta.url), "utf8");
  assert.match(headers, /\/assets\/\*/);
  assert.match(headers, /\/pet\/\*/);
  assert.equal((headers.match(/! Cache-Control/g) || []).length, 2);
  assert.match(headers, /max-age=300/);
  assert.doesNotMatch(JSON.stringify(routes.exclude), /holdings|trades|api/);
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(index, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  const appSource = await readFile(new URL("../assets/app.js", import.meta.url));
  const styleSource = await readFile(new URL("../assets/styles.css", import.meta.url));
  const appVersion = createHash("sha256").update(appSource).digest("hex").slice(0, 8);
  const styleVersion = createHash("sha256").update(styleSource).digest("hex").slice(0, 8);
  assert.match(index, new RegExp("<script src=\\\"/assets/app\\.js\\?v=" + appVersion + "\\\" defer></script>"));
  assert.match(index, new RegExp("href=\\\"/assets/styles\\.css\\?v=" + styleVersion + "\\\""));
});

function radarRowsForPage(market, page, count = 100) {
  return Array.from({ length: count }, (_, offset) => {
    const index = (page - 1) * 100 + offset;
    const code = market === "A股"
      ? String(600000 + index)
      : market === "港股"
        ? String(index + 1).padStart(5, "0")
        : `T${String(index + 1).padStart(4, "0")}`;
    return {
      f2: 20 + index / 10,
      f3: (index % 31) - 15,
      f5: 10_000_000 - index,
      f6: 50_000_000_000 - index * 50_000_000,
      f7: 1 + (index % 17),
      f8: 0.5 + (index % 20) / 10,
      f9: 8 + (index % 45),
      f10: 0.8 + (index % 10) / 10,
      f12: code,
      f13: market === "A股" ? 1 : market === "港股" ? 116 : 105,
      f14: `${market}测试股${index + 1}`,
      f15: 21 + index / 10,
      f16: 19 + index / 10,
      f17: 19.5 + index / 10,
      f18: 20 + index / 10,
      f20: 2_000_000_000_000 - index * 1_000_000_000,
      f21: 1_500_000_000_000 - index * 800_000_000,
      f23: 0.8 + (index % 25) / 5,
      f24: (index % 121) - 60,
      f124: 1786924800,
    };
  });
}

test("radar API maps all three markets and scans exactly five bounded pages", async () => {
  const cases = [
    { market: "A股", currency: "CNY", fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23", sina: /^sh\d{6}$/ },
    { market: "港股", currency: "HKD", fs: "m:116+t:3", sina: /^hk\d{5}$/ },
    { market: "美股", currency: "USD", fs: "m:105,m:106", sina: /^gb_t\d{4}$/ },
  ];

  for (const item of cases) {
    const requested = [];
    const response = await getRadar({
      request: new Request(`https://example.test/api/radar?market=${encodeURIComponent(item.market)}`),
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      fetcher: async (input) => {
        const url = new URL(input);
        requested.push(url);
        const page = Number(url.searchParams.get("pn"));
        return Response.json({ rc: 0, data: { total: 500, diff: radarRowsForPage(item.market, page) } });
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(requested.length, 5);
    assert.deepEqual(requested.map((url) => Number(url.searchParams.get("pn"))).sort(), [1, 2, 3, 4, 5]);
    requested.forEach((url) => {
      assert.equal(url.origin + url.pathname, "https://push2delay.eastmoney.com/api/qt/clist/get");
      assert.equal(url.searchParams.get("pz"), "100");
      assert.equal(url.searchParams.get("fid"), "f6");
      assert.equal(url.searchParams.get("fs"), item.fs);
    });

    const payload = await response.json();
    assert.deepEqual({
      market: payload.market,
      modelVersion: payload.modelVersion,
      source: payload.source,
      fetchedAt: payload.fetchedAt,
      rawSize: payload.rawSize,
      eligibleSize: payload.eligibleSize,
      poolSize: payload.poolSize,
    }, {
      market: item.market,
      modelVersion: "radar-v1.1",
      source: "东方财富行情中心",
      fetchedAt: "2026-08-17T00:00:00.000Z",
      rawSize: 500,
      eligibleSize: 500,
      poolSize: 240,
    });
    assert.equal(payload.candidates.length, 240);
    payload.candidates.forEach((candidate) => {
      assert.equal(candidate.market, item.market);
      assert.equal(candidate.currency, item.currency);
      assert.match(candidate.id, new RegExp(`^${item.market}:`));
      assert.match(candidate.sina, item.sina);
      assert.equal(candidate.quoteUpdatedAt, "2026-08-17T00:00:00.000Z");
    });
  }
});

test("radar API applies equity filters and provider-specific symbol normalization", () => {
  const base = {
    f2: 100, f3: 2, f6: 2_000_000_000, f7: 3, f8: 1.5, f9: 20, f12: "600001", f13: 1,
    f14: "测试公司", f20: 100_000_000_000, f23: 2, f24: 5,
  };
  assert.equal(normalizeRadarRow(base, "A股").sina, "sh600001");
  assert.equal(normalizeRadarRow({ ...base, f12: "000001", f13: 0 }, "A股").sina, "sz000001");
  assert.equal(normalizeRadarRow({ ...base, f12: "700", f13: 116 }, "港股").sina, "hk00700");
  assert.equal(normalizeRadarRow({ ...base, f12: "NVDA", f13: 105 }, "美股").sina, "gb_nvda");
  assert.equal(normalizeRadarRow(base, "A股").metrics.turnoverRate, 1.5);

  assert.equal(isEligibleRadarCandidate(normalizeRadarRow({ ...base, f14: "*ST测试" }, "A股")), false);
  assert.equal(isEligibleRadarCandidate(normalizeRadarRow({ ...base, f12: "920001", f13: 0 }, "A股")), false);
  assert.equal(isEligibleRadarCandidate(normalizeRadarRow({ ...base, f12: "00700", f14: "恒指两倍做多ETF" }, "港股")), false);
  assert.equal(isEligibleRadarCandidate(normalizeRadarRow({ ...base, f12: "UPRO", f14: "ProShares UltraPro 3x ETF" }, "美股")), false);
  assert.equal(isEligibleRadarCandidate(normalizeRadarRow({ ...base, f6: null }, "A股")), false);
  assert.equal(isEligibleRadarCandidate(normalizeRadarRow({ ...base, f20: "-" }, "A股")), false);
  assert.equal(isEligibleRadarCandidate(normalizeRadarRow(base, "A股")), true);
});

test("radar API scores deterministically and exposes an exact transparent component sum", () => {
  const normalized = [1, 2, 3].flatMap((page) => radarRowsForPage("美股", page).map((row) => normalizeRadarRow(row, "美股")));
  const first = scoreRadarCandidates(normalized);
  const second = scoreRadarCandidates(normalized.slice().reverse());
  assert.deepEqual(first.map((candidate) => candidate.id), second.map((candidate) => candidate.id));
  assert.ok(first.every((candidate, index) => index === 0 || first[index - 1].score >= candidate.score));
  first.forEach((candidate) => {
    const sum = Object.values(candidate.components).reduce((total, value) => total + value, 0);
    assert.equal(candidate.score, Math.round((sum + Number.EPSILON) * 10) / 10);
    assert.deepEqual(Object.keys(candidate.components), ["trend", "liquidity", "risk", "quality"]);
    assert.ok(candidate.components.trend >= 0 && candidate.components.trend <= 35);
    assert.ok(candidate.components.liquidity >= 0 && candidate.components.liquidity <= 30);
    assert.ok(candidate.components.risk >= 0 && candidate.components.risk <= 20);
    assert.ok(candidate.components.quality >= 0 && candidate.components.quality <= 15);
    assert.ok(["priority", "watch", "reserve"].includes(candidate.band));
    assert.ok(candidate.reasons.length > 0);
    assert.ok(candidate.risks.length > 0);
  });
});

test("radar API returns structured 502 JSON for provider failure or insufficient coverage", async () => {
  const upstream = await getRadar({
    request: new Request("https://example.test/api/radar?market=A%E8%82%A1"),
    fetcher: async () => new Response("unavailable", { status: 503 }),
  });
  assert.equal(upstream.status, 502);
  assert.deepEqual(await upstream.json(), {
    error: "东方财富第 1 页返回 HTTP 503",
    code: "RADAR_UPSTREAM_ERROR",
    market: "A股",
  });

  const tooSmall = await getRadar({
    request: new Request("https://example.test/api/radar?market=%E6%B8%AF%E8%82%A1"),
    fetcher: async (input) => {
      const page = Number(new URL(input).searchParams.get("pn"));
      return Response.json({ rc: 0, data: { diff: radarRowsForPage("港股", page, 30) } });
    },
  });
  assert.equal(tooSmall.status, 502);
  const payload = await tooSmall.json();
  assert.equal(payload.code, "RADAR_POOL_TOO_SMALL");
  assert.equal(payload.market, "港股");
  assert.match(payload.error, /150 只/);
});

test("radar API aborts a stalled upstream page instead of hanging the worker", async () => {
  const stalledFetcher = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  await assert.rejects(
    scanRadarMarket({ market: "A股", fetcher: stalledFetcher, timeoutMs: 5 }),
    /请求超过 5ms/,
  );
});

test("sold records filter by inclusive sell dates and sort by date, realized profit, or return", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const runnable = source.replace(/\nstart\(\)\.catch\(function \(error\) \{[\s\S]*?\n\}\);\s*$/, "\n");
  const context = vm.createContext({ location: { hash: "#trades" }, localStorage: { getItem: () => null, setItem: () => {} } });
  new vm.Script(runnable).runInContext(context);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const rows = `[
    { market: "A股", code: "000001", name: "甲公司", status: "sold", currency: "CNY", sellDate: "2026-08-03", cost: 10, sellPrice: 9, qty: 100, purchaseCostCny: 1000, saleProceedsCny: 900, pnlCny: -100, pnlRate: -10 },
    { market: "港股", code: "00700", name: "乙公司", status: "sold", currency: "HKD", sellDate: "2026-08-18", cost: 100, sellPrice: 120, qty: 10, purchaseCostCny: 920, saleProceedsCny: 1104, pnlCny: 184, pnlRate: 20 },
    { market: "美股", code: "NVDA", name: "丙公司", status: "sold", currency: "USD", sellDate: "2026-07-31", cost: 200, sellPrice: 220, qty: 2, purchaseCostCny: 2888, saleProceedsCny: 3176.8, pnlCny: 288.8, pnlRate: 10 }
  ]`;

  const byDate = plain(vm.runInContext(`state.rows = ${rows}; state.tradeMarket = "全部"; state.tradeDateStart = "2026-08-01"; state.tradeDateEnd = "2026-08-18"; state.tradeSort = "date"; state.tradeSortDirection = "desc"; filteredSortedSoldRows().map(row => row.code)`, context));
  assert.deepEqual(byDate, ["00700", "000001"]);

  const byProfit = plain(vm.runInContext(`state.tradeDateStart = ""; state.tradeDateEnd = ""; state.tradeSort = "pnl"; state.tradeSortDirection = "asc"; filteredSortedSoldRows().map(row => row.code)`, context));
  assert.deepEqual(byProfit, ["000001", "00700", "NVDA"]);

  const byReturn = plain(vm.runInContext(`state.tradeMarket = "港股"; state.tradeSort = "rate"; state.tradeSortDirection = "desc"; filteredSortedSoldRows().map(row => row.code)`, context));
  assert.deepEqual(byReturn, ["00700"]);

  const markup = vm.runInContext(`state.tradeMarket = "全部"; state.tradeDateStart = "2026-08-01"; state.tradeDateEnd = "2026-08-18"; tradesPage()`, context);
  assert.match(markup, /data-trade-date-start/);
  assert.match(markup, /data-trade-date-end/);
  assert.match(markup, /data-trade-sort/);
  assert.match(markup, /data-trade-sort-direction/);
  assert.match(markup, /data-clear-trade-filters/);
  assert.match(markup, /sold-record-mobile/);
  assert.doesNotMatch(markup, /丙公司/);
});
