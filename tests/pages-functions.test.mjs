import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createHoldingsDocument, readGitHubHoldings, sanitizeHoldings, syncHoldingsToGitHub } from "../functions/lib/github-holdings.js";
import { normalizeSecurityInput, parseSinaQuote } from "../functions/lib/security-lookup.js";
import { onRequestGet, onRequestPost } from "../functions/api/holdings-sync.js";
import { onRequest as authMiddleware } from "../functions/_middleware.js";

const holding = { market: "美股", code: "NVDA", name: "英伟达", status: "holding", cost: 200, qty: 3, currency: "USD", sina: "gb_nvda", buyFeeUsd: 20 };

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

test("protects the whole Pages site and accepts a UTF-8 flower-name login", async () => {
  const env = { BASIC_AUTH_USER: "我的花名", BASIC_AUTH_PASSWORD: "test-password" };
  let nextCalls = 0;
  const denied = await authMiddleware({
    request: new Request("https://example.test/api/security-lookup"),
    env,
    next: async () => { nextCalls += 1; return new Response("ok"); },
  });
  assert.equal(denied.status, 401);
  assert.equal(nextCalls, 0);
  assert.match(denied.headers.get("www-authenticate"), /realm="Piggy Bank"/);
  assert.match(denied.headers.get("www-authenticate"), /charset="UTF-8"/);
  assert.deepEqual(await denied.json(), { error: "请输入花名和密码", code: "AUTH_REQUIRED" });

  const authorization = "basic " + Buffer.from("我的花名:test-password", "utf8").toString("base64");
  const allowed = await authMiddleware({
    request: new Request("https://example.test/", { headers: { authorization } }),
    env,
    next: async () => { nextCalls += 1; return new Response("ok"); },
  });
  assert.equal(allowed.status, 200);
  assert.equal(nextCalls, 1);
});

test("fails closed when Pages authentication is incomplete", async () => {
  const response = await authMiddleware({
    request: new Request("https://example.test/"),
    env: { BASIC_AUTH_USER: "我的花名" },
    next: async () => new Response("should not run"),
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.has("www-authenticate"), false);
});

test("client adopts local holdings only after GitHub confirms the write", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const syncIndex = source.indexOf("await syncHoldingsToGitHubClient(nextHoldings)");
  const localIndex = source.indexOf("state.holdings = nextHoldings", syncIndex);
  assert.ok(syncIndex > 0);
  assert.ok(localIndex > syncIndex);
  assert.match(source, /GitHub 同步失败，本次未保存/);
});

test("startup prefers GitHub, then static JSON, and uses local holdings only offline", async () => {
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
  assert.match(source, /selectStartupHoldingsDocument\(result\[0\], result\[1\], linked\)/);
});
