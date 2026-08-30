import {
  HoldingsSyncError,
  createHoldingsDocument,
  readGitHubHoldings,
  readGitHubRepositoryStatus,
  sanitizeHoldings,
  syncHoldingOperationToGitHub,
  syncHoldingsToGitHub,
} from "../lib/github-holdings.js";

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
  const payload = { ok: false, error: error.message || "GitHub 同步失败" };
  if (error instanceof HoldingsSyncError && error.code) payload.code = error.code;
  if (error instanceof HoldingsSyncError && error.details) Object.assign(payload, error.details);
  return json(payload, status);
}

export async function onRequestGet({ env, fetcher = fetch }) {
  try {
    requireProtectedWrite(env);
    const config = configFromEnv(env);
    const [current, repository] = await Promise.all([
      readGitHubHoldings(config, fetcher),
      readGitHubRepositoryStatus(config, fetcher),
    ]);
    return json({ ok: true, githubConfigured: true, currentFileReadable: true, ...current, repository });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost({ request, env, fetcher = fetch }) {
  try {
    requireProtectedWrite(env);
    const body = await request.json();
    if (body && body.operation) {
      const result = await syncHoldingOperationToGitHub(
        body.operation,
        body.expectedFileSha,
        configFromEnv(env),
        fetcher,
      );
      return json({ ok: true, ...result });
    }
    const input = body && Object.prototype.hasOwnProperty.call(body, "holdings") ? body.holdings : body;
    const document = createHoldingsDocument(input);
    const holdings = sanitizeHoldings(document);
    const result = await syncHoldingsToGitHub(document, configFromEnv(env), fetcher);
    return json({ ok: true, ...result, document, holdings });
  } catch (error) {
    return errorResponse(error);
  }
}
