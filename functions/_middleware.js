const DEFAULT_USER = "我的花名";
const SESSION_COOKIE = "piggy_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_LOGIN_BODY_BYTES = 4096;
const MAX_PASSWORD_LENGTH = 256;
const LOGIN_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
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
    const signatureBytes = base64UrlToBytes(match[2]);
    const payloadBytes = base64UrlToBytes(match[1]);
    if (bytesToBase64Url(signatureBytes) !== match[2] || bytesToBase64Url(payloadBytes) !== match[1]) return false;
    const key = await importSessionKey(password, ["verify"]);
    const authentic = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(match[1]),
    );
    if (!authentic) return false;

    const payload = JSON.parse(decoder.decode(payloadBytes));
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
  <meta name="theme-color" content="#0b111a">
  <title>猪猪存钱罐 · 登录</title>
  <link rel="icon" type="image/svg+xml" href="/assets/terminal-mark.svg">
  <style>
    :root{color-scheme:dark;--ink:#edf3fa;--base:#0b111a;--panel:#131d2a;--line:#34485e;--accent:#69c9ff}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:20px;background:radial-gradient(ellipse at 50% 44%,#162739 0,var(--base) 64%);color:var(--ink);font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif}
    main{width:min(420px,100%);padding:clamp(24px,6vw,40px);border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:0 18px 60px #03070c66}
    .brand-lockup{display:flex;align-items:center;gap:15px;padding-bottom:28px;border-bottom:1px solid var(--line)}
    .mark{display:block;width:52px;height:52px}
    h1{margin:0;line-height:1}h1 img{display:block;width:min(158px,38vw);height:auto}
    form{margin-top:24px}
    label{display:block;margin-bottom:10px;font-size:15px;font-weight:650}
    input{appearance:none;width:100%;height:48px;padding:0 14px;border:1px solid #4d657c;border-radius:6px;background:var(--base);color:var(--ink);font:inherit;font-size:17px;caret-color:var(--accent)}
    input:focus{outline:2px solid var(--accent);outline-offset:2px}
    .user{margin:12px 0 23px;color:#a5b5c8;font-size:13px;line-height:1.6}.user strong{color:var(--ink);font-weight:600}
    button{display:flex;width:100%;min-height:48px;align-items:center;justify-content:space-between;gap:12px;padding:0 15px;border:0;border-radius:6px;background:var(--accent);color:#0b1721;font:inherit;font-weight:700;cursor:pointer}
    button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button:disabled{cursor:wait;background:#7a94a6}
    button svg{width:18px;height:18px;stroke:currentColor}
    .status{margin:12px 0 0;color:#ff8792;font-size:13px;line-height:1.55}.status:empty{display:none}
    @media (hover:hover){button:hover:not(:disabled){background:#96dcff}}
    @media (prefers-reduced-motion:no-preference){button svg{transition:transform .16s ease-out}button:active svg{transform:translateX(3px)}}
  </style>
</head>
<body>
  <main>
    <div class="brand-lockup">
      <img class="mark" src="/assets/terminal-mark.svg" alt="" width="52" height="52">
      <h1><img src="/assets/terminal-wordmark.svg" alt="猪猪存钱罐" width="158" height="28"></h1>
    </div>
    <form id="login-form" action="${escapeHtml(action)}" method="post">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" maxlength="${MAX_PASSWORD_LENGTH}" autocomplete="current-password" aria-describedby="hint" required autofocus>
      <p class="user" id="hint">密码提示：<strong>${escapeHtml(user)}</strong></p>
      <button type="submit"><span>打开存钱罐</span><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg></button>
      <p class="status" id="status" role="status" aria-live="polite"></p>
    </form>
  </main>
  <script>
    const form=document.getElementById("login-form"),password=document.getElementById("password"),status=document.getElementById("status"),button=form.querySelector("button");
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if(button.disabled)return;
      button.disabled=true;
      button.querySelector("span").textContent="正在打开…";
      status.textContent="";
      try{
        const response=await fetch(form.action,{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({password:password.value})});
        const result=await response.json();
        if(!response.ok)throw new Error(result.error||"登录失败，请重试");
        window.location.assign(typeof result.redirect==="string"?result.redirect:"/");
      }catch(error){
        status.textContent=error.message||"登录失败，请重试";
        button.disabled=false;
        button.querySelector("span").textContent="打开存钱罐";
        password.focus();
        password.select();
      }
    });
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
