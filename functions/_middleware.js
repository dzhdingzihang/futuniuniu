const BASIC_CHALLENGE = 'Basic realm="Piggy Bank", charset="UTF-8"';

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function hasValidBasicAuth(request, user, password) {
  const match = /^Basic\s+(\S+)$/i.exec((request.headers.get("authorization") || "").trim());
  return Boolean(match && match[1] === utf8ToBase64(user + ":" + password));
}

function authResponse(request, status, message, challenge) {
  const isApi = new URL(request.url).pathname.startsWith("/api/");
  const headers = {
    "Cache-Control": "private, no-store",
    "Content-Type": isApi ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Vary": "Authorization",
  };
  if (challenge) headers["WWW-Authenticate"] = BASIC_CHALLENGE;
  const body = isApi ? JSON.stringify({ error: message, code: status === 401 ? "AUTH_REQUIRED" : "AUTH_NOT_CONFIGURED" }) : message;
  return new Response(body, { status, headers });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const user = String(env.BASIC_AUTH_USER || "");
  const password = String(env.BASIC_AUTH_PASSWORD || "");
  const allowUnauthenticated = env.ALLOW_UNAUTHENTICATED_LOCAL === "true";

  if (!allowUnauthenticated && (!user || !password)) return authResponse(request, 503, "网站登录尚未配置", false);
  if (!allowUnauthenticated && !hasValidBasicAuth(request, user, password)) return authResponse(request, 401, "请输入花名和密码", true);

  const response = await next();
  const secured = new Response(response.body, response);
  secured.headers.set("Cache-Control", "private, no-store");
  secured.headers.append("Vary", "Authorization");
  return secured;
}
