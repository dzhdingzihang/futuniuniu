const DEFAULT_USER = "我的花名";
const SESSION_COOKIE = "piggy_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_LOGIN_BODY_BYTES = 4096;
const MAX_PASSWORD_LENGTH = 256;
const LOGIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function securityHeaders(contentType) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  const headers = securityHeaders("application/json; charset=utf-8");
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(JSON.stringify(payload), { status, headers });
}

function textResponse(message, status) {
  return new Response(message, {
    status,
    headers: securityHeaders("text/plain; charset=utf-8"),
  });
}

function redirectResponse(location, status = 302, extraHeaders = {}) {
  const headers = securityHeaders();
  headers.set("Location", location);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(null, { status, headers });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function safeNext(value) {
  const candidate = typeof value === "string" ? value : "";
  if (
    !candidate ||
    candidate.length > 2048 ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) return "/";

  try {
    const parsed = new URL(candidate, "https://piggy-session.invalid");
    if (parsed.origin !== "https://piggy-session.invalid" || parsed.pathname === "/login") return "/";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/";
  }
}

function requestedNext(url) {
  return safeNext(url.pathname + url.search);
}

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error("Invalid base64url");
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importSessionKey(password, usages) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

async function createSession(user, password) {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    u: user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  })));
  const key = await importSessionKey(password, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return payload + "." + bytesToBase64Url(new Uint8Array(signature));
}

async function verifySession(value, user, password) {
  const match = /^([A-Za-z0-9_-]{1,2048})\.([A-Za-z0-9_-]{43})$/.exec(value || "");
  if (!match) return false;

  try {
    const key = await importSessionKey(password, ["verify"]);
    const authentic = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(match[2]),
      encoder.encode(match[1]),
    );
    if (!authentic) return false;

    const payload = JSON.parse(decoder.decode(base64UrlToBytes(match[1])));
    return Boolean(
      payload &&
      payload.u === user &&
      Number.isSafeInteger(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

function cookieValue(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(name + "=")) return trimmed.slice(name.length + 1);
  }
  return "";
}

function sessionCookie(value) {
  return `${SESSION_COOKIE}=${value}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

async function constantTimePasswordMatch(candidate, expected) {
  const [candidateDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function loginPage(user, next) {
  const action = "/api/login?next=" + encodeURIComponent(next);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>猪猪存钱罐 · 登录</title>
  <style>
    :root{color-scheme:dark;--gold:#d6a84b;--gold-light:#f3d58a;--ink:#090806;--panel:#15110b;--muted:#a89b84}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 18%,#34260f 0,#15100a 28%,var(--ink) 70%);color:#f8f1df;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
    main{width:min(420px,100%);padding:40px;border:1px solid rgba(214,168,75,.48);border-radius:24px;background:linear-gradient(145deg,rgba(30,24,14,.97),rgba(10,9,7,.98));box-shadow:0 26px 90px rgba(0,0,0,.55),inset 0 1px rgba(255,235,180,.08)}
    .mark{width:62px;height:62px;display:grid;place-items:center;margin:0 auto 20px;border:1px solid rgba(214,168,75,.65);border-radius:18px;background:linear-gradient(145deg,#32230e,#120e08);font-size:31px;box-shadow:0 12px 32px rgba(214,168,75,.14)}
    h1{margin:0;text-align:center;font-size:28px;letter-spacing:.08em;background:linear-gradient(100deg,#806022,var(--gold-light),#a77a2b);background-clip:text;-webkit-background-clip:text;color:transparent}
    .user{margin:14px 0 30px;text-align:center;color:var(--muted);font-size:14px}.user strong{color:var(--gold-light);font-weight:650}
    label{display:block;margin-bottom:9px;color:#d9c9a5;font-size:13px}
    input{width:100%;height:52px;padding:0 16px;border:1px solid #5b4723;border-radius:12px;outline:none;background:#0b0906;color:#fff6dd;font-size:16px;transition:.2s border-color,.2s box-shadow}
    input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(214,168,75,.14)}
    button{width:100%;height:50px;margin-top:16px;border:0;border-radius:12px;background:linear-gradient(105deg,#8c6624,var(--gold-light),#a97828);color:#171006;font-size:15px;font-weight:750;cursor:pointer;box-shadow:0 10px 28px rgba(214,168,75,.16)}
    button:disabled{cursor:wait;opacity:.65}.status{min-height:20px;margin:13px 0 0;text-align:center;color:#e39a83;font-size:13px}
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">🐷</div>
    <h1>猪猪存钱罐</h1>
    <p class="user">密码提示：<strong>${escapeHtml(user)}</strong></p>
    <form id="login-form" action="${escapeHtml(action)}" method="post">
      <label for="password">请输入访问密码</label>
      <input id="password" name="password" type="password" maxlength="${MAX_PASSWORD_LENGTH}" autocomplete="current-password" required autofocus>
      <button type="submit">打开存钱罐</button>
      <p class="status" id="status" role="status" aria-live="polite"></p>
    </form>
  </main>
  <script>
    const form=document.getElementById("login-form"),password=document.getElementById("password"),status=document.getElementById("status"),button=form.querySelector("button");
    form.addEventListener("submit",async event=>{event.preventDefault();button.disabled=true;status.textContent="";try{const response=await fetch(form.action,{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({password:password.value})});const result=await response.json();if(!response.ok)throw new Error(result.error||"登录失败");window.location.assign(typeof result.redirect==="string"?result.redirect:"/")}catch(error){status.textContent=error.message||"登录失败";password.select()}finally{button.disabled=false}});
  </script>
</body>
</html>`;
  const headers = securityHeaders("text/html; charset=utf-8");
  headers.set("Content-Security-Policy", LOGIN_CSP);
  return new Response(html, { status: 200, headers });
}

function unavailableResponse(request) {
  if (isApiPath(new URL(request.url).pathname)) {
    return jsonResponse({ error: "网站登录尚未配置", code: "AUTH_NOT_CONFIGURED" }, 503);
  }
  return textResponse("网站登录尚未配置", 503);
}

function methodNotAllowed(allowedMethod) {
  return jsonResponse(
    { error: "请求方法不支持", code: "METHOD_NOT_ALLOWED" },
    405,
    { Allow: allowedMethod },
  );
}

async function handleLogin(request, user, password, next) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const contentType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonResponse({ error: "仅支持 JSON 登录请求", code: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LOGIN_BODY_BYTES) {
    return jsonResponse({ error: "登录请求过大", code: "REQUEST_TOO_LARGE" }, 413);
  }

  const rawBody = await request.text();
  if (encoder.encode(rawBody).byteLength > MAX_LOGIN_BODY_BYTES) {
    return jsonResponse({ error: "登录请求过大", code: "REQUEST_TOO_LARGE" }, 413);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "登录请求格式错误", code: "INVALID_REQUEST" }, 400);
  }
  if (!payload || typeof payload.password !== "string") {
    return jsonResponse({ error: "请输入密码", code: "INVALID_REQUEST" }, 400);
  }
  if (payload.password.length > MAX_PASSWORD_LENGTH) {
    return jsonResponse({ error: "密码长度超出限制", code: "PASSWORD_TOO_LONG" }, 413);
  }
  if (!(await constantTimePasswordMatch(payload.password, password))) {
    return jsonResponse({ error: "密码错误", code: "INVALID_PASSWORD" }, 401);
  }

  const session = await createSession(user, password);
  return jsonResponse(
    { ok: true, redirect: next },
    200,
    { "Set-Cookie": sessionCookie(session) },
  );
}

function handleLogout(request) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  return jsonResponse(
    { ok: true, redirect: "/login" },
    200,
    { "Set-Cookie": clearedSessionCookie() },
  );
}

function unauthorizedApiResponse() {
  return jsonResponse({ error: "请先登录", code: "AUTH_REQUIRED" }, 401);
}

function securedResponse(response) {
  const secured = new Response(response.body, response);
  secured.headers.set("Cache-Control", "private, no-store");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.delete("WWW-Authenticate");
  const vary = (secured.headers.get("Vary") || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!vary.some((item) => item.toLowerCase() === "cookie")) vary.push("Cookie");
  secured.headers.set("Vary", vary.join(", "));
  return secured;
}

export async function onRequest(context) {
  const { request, env = {}, next } = context;
  const user = String(env.BASIC_AUTH_USER || DEFAULT_USER);
  const password = typeof env.BASIC_AUTH_PASSWORD === "string" ? env.BASIC_AUTH_PASSWORD : "";
  if (!password) return unavailableResponse(request);

  const url = new URL(request.url);
  const nextLocation = safeNext(url.searchParams.get("next"));

  if (url.pathname === "/api/login") return handleLogin(request, user, password, nextLocation);
  if (url.pathname === "/api/logout") return handleLogout(request);

  const hasSession = await verifySession(cookieValue(request, SESSION_COOKIE), user, password);
  if (url.pathname === "/login") {
    if (request.method !== "GET" && request.method !== "HEAD") return textResponse("请求方法不支持", 405);
    if (hasSession) return redirectResponse(nextLocation);
    return loginPage(user, nextLocation);
  }

  if (!hasSession) {
    if (isApiPath(url.pathname)) return unauthorizedApiResponse();
    const loginLocation = "/login?next=" + encodeURIComponent(requestedNext(url));
    return redirectResponse(loginLocation);
  }

  return securedResponse(await next());
}
