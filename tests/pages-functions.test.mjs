import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createHoldingsDocument, readGitHubHoldings, sanitizeHoldings, syncHoldingsToGitHub } from "../functions/lib/github-holdings.js";
import { normalizeSecurityInput, parseSinaQuote } from "../functions/lib/security-lookup.js";
import { onRequestGet, onRequestPost } from "../functions/api/holdings-sync.js";
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
