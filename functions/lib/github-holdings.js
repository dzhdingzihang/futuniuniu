export class HoldingsSyncError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "HoldingsSyncError";
    this.status = status;
  }
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function cleanOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function sanitizeHoldings(input) {
  if (!Array.isArray(input) || input.length > 500) throw new HoldingsSyncError("持仓数据格式不正确");
  return input.map((item, index) => {
    if (!item || typeof item !== "object") throw new HoldingsSyncError("第 " + (index + 1) + " 条持仓格式不正确");
    const market = String(item.market || "").trim();
    const code = String(item.code || "").trim();
    const name = String(item.name || "").trim();
    const status = item.status === "sold" ? "sold" : "holding";
    const cost = Number(item.cost);
    const qty = Number(item.qty);
    const currency = String(item.currency || "").trim().toUpperCase();
    const sina = String(item.sina || "").trim().toLowerCase();
    if (!['A股', '港股', '美股'].includes(market) || !code || !name || !sina || !['CNY', 'HKD', 'USD'].includes(currency) || !Number.isFinite(cost) || cost <= 0 || !Number.isFinite(qty) || qty <= 0) {
      throw new HoldingsSyncError("第 " + (index + 1) + " 条持仓缺少必填信息");
    }
    const output = { market, code, name, status, cost, qty, currency, sina };
    ["purchaseCostCny", "sellProceedsCny", "buyFeeUsd", "sellFeeUsd", "sellPrice"].forEach((key) => {
      const value = cleanOptionalNumber(item[key]);
      if (value !== undefined) output[key] = value;
    });
    if (status === "sold") output.sellDate = String(item.sellDate || "");
    return output;
  });
}

function configValues(config) {
  return {
    token: String(config.token || "").trim(),
    owner: String(config.owner || "dzhdingzihang").trim(),
    repo: String(config.repo || "futuniuniu").trim(),
    path: String(config.path || "holdings.json").trim(),
    branch: String(config.branch || "main").trim(),
  };
}

function githubEndpoint(config) {
  return "https://api.github.com/repos/" + encodeURIComponent(config.owner) + "/" + encodeURIComponent(config.repo) + "/contents/" + config.path.split("/").map(encodeURIComponent).join("/");
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
    "User-Agent": "piggy-bank-holdings-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubRequest(url, options, fetcher) {
  const response = await fetcher(url, options);
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { response, payload };
}

function githubFailure(status, action) {
  if (status === 401 || status === 403) return new HoldingsSyncError("GitHub 写入凭证无效或权限不足", 403);
  if (status === 409) return new HoldingsSyncError("GitHub 文件刚被更新，请重新同步", 409);
  if (status === 429) return new HoldingsSyncError("GitHub 请求过于频繁，请稍后重试", 429);
  return new HoldingsSyncError(action + " GitHub holdings.json 失败", 502);
}

export async function readGitHubHoldingsStatus(config, fetcher = fetch) {
  const values = configValues(config);
  if (!values.token) throw new HoldingsSyncError("GitHub 即时同步尚未配置", 503);
  const endpoint = githubEndpoint(values);
  const current = await githubRequest(endpoint + "?ref=" + encodeURIComponent(values.branch), { headers: githubHeaders(values.token), cf: { cacheTtl: 0 } }, fetcher);
  if (!current.response.ok) throw githubFailure(current.response.status, "读取");
  return {
    target: values.owner + "/" + values.repo,
    path: values.path,
    branch: values.branch,
    fileSha: current.payload && current.payload.sha ? current.payload.sha : "",
  };
}

export async function syncHoldingsToGitHub(holdings, config, fetcher = fetch) {
  const values = configValues(config);
  if (!values.token) throw new HoldingsSyncError("GitHub 即时同步尚未配置", 503);
  const clean = sanitizeHoldings(holdings);
  const content = utf8ToBase64(JSON.stringify(clean, null, 2) + "\n");
  const endpoint = githubEndpoint(values);
  const headers = githubHeaders(values.token);
  const current = await githubRequest(endpoint + "?ref=" + encodeURIComponent(values.branch), { headers, cf: { cacheTtl: 0 } }, fetcher);
  if (!current.response.ok && current.response.status !== 404) throw githubFailure(current.response.status, "读取");
  if (current.payload && typeof current.payload.content === "string" && current.payload.content.replace(/\s+/g, "") === content.replace(/\s+/g, "")) {
    return {
      commitSha: "",
      fileSha: current.payload.sha || "",
      fileUrl: current.payload.html_url || "",
      alreadyCurrent: true,
    };
  }
  const body = {
    message: "chore: update holdings from 猪猪存钱罐",
    content,
    branch: values.branch,
  };
  if (current.payload && current.payload.sha) body.sha = current.payload.sha;
  const saved = await githubRequest(endpoint, { method: "PUT", headers, body: JSON.stringify(body), cf: { cacheTtl: 0 } }, fetcher);
  if (!saved.response.ok) throw githubFailure(saved.response.status, "更新");
  return {
    commitSha: saved.payload && saved.payload.commit ? saved.payload.commit.sha : "",
    fileSha: saved.payload && saved.payload.content && saved.payload.content.sha ? saved.payload.content.sha : "",
    fileUrl: saved.payload && saved.payload.content ? saved.payload.content.html_url : "",
    alreadyCurrent: false,
  };
}
