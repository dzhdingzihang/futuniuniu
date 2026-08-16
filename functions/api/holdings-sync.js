import { HoldingsSyncError, readGitHubHoldings, syncHoldingsToGitHub } from "../lib/github-holdings.js";

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function configFromEnv(env) {
  return {
    token: env.PIGGY_GITHUB_TOKEN,
    owner: env.PIGGY_GITHUB_OWNER || "dzhdingzihang",
    repo: env.PIGGY_GITHUB_REPO || "futuniuniu",
    path: env.PIGGY_GITHUB_HOLDINGS_PATH || "holdings.json",
    branch: env.PIGGY_GITHUB_BRANCH || "main",
  };
}

function requireProtectedWrite(env) {
  if (!env.BASIC_AUTH_USER || !env.BASIC_AUTH_PASSWORD) {
    throw new HoldingsSyncError("请先启用网站登录保护，再使用 GitHub 即时同步", 503);
  }
}

function errorResponse(error) {
  const status = error instanceof HoldingsSyncError ? error.status : 500;
  return json({ ok: false, error: error.message || "GitHub 同步失败" }, status);
}

export async function onRequestGet({ env, fetcher = fetch }) {
  try {
    requireProtectedWrite(env);
    const current = await readGitHubHoldings(configFromEnv(env), fetcher);
    return json({ ok: true, githubConfigured: true, currentFileReadable: true, ...current });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireProtectedWrite(env);
    const body = await request.json();
    const input = body && Object.prototype.hasOwnProperty.call(body, "holdings") ? body.holdings : body;
    const result = await syncHoldingsToGitHub(input, configFromEnv(env));
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
