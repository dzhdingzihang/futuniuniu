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

function base64ToUtf8(value) {
  let binary;
  try {
    binary = atob(String(value || "").replace(/\s+/g, ""));
  } catch {
    throw new HoldingsSyncError("GitHub holdings.json 内容无法解码", 502);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function cleanOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

const MARKET_NAMES = { A: "A股", HK: "港股", US: "美股" };
const MARKET_CODES = { "A股": "A", "港股": "HK", "美股": "US" };
const DEFAULT_TRADE_FEE_USD = 20;

function currencyForMarket(market) {
  return market === "港股" ? "HKD" : market === "美股" ? "USD" : "CNY";
}

function quoteCodeForMarket(market, rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (market === "港股") return "hk" + code.padStart(5, "0");
  if (market === "美股") return "gb_" + code.toLowerCase();
  if (market === "A股" && /^\d{6}$/.test(code)) return (/^[569]/.test(code) ? "sh" : "sz") + code;
  return "";
}

function rowsFromInput(input) {
  if (Array.isArray(input)) return input;
  if (!input || Number(input.version) !== 2 || !Array.isArray(input.lots)) throw new HoldingsSyncError("持仓数据格式不正确");
  const configuredFees = input.newTradeFeeUsd && typeof input.newTradeFeeUsd === "object" ? input.newTradeFeeUsd : {};
  const defaultBuyFee = cleanOptionalNumber(configuredFees.buy) ?? DEFAULT_TRADE_FEE_USD;
  const defaultSellFee = cleanOptionalNumber(configuredFees.sell) ?? DEFAULT_TRADE_FEE_USD;
  if (defaultBuyFee < 0 || defaultSellFee < 0) throw new HoldingsSyncError("持仓默认手续费不正确");
  return input.lots.flatMap((lot, index) => {
    if (!lot || typeof lot !== "object") throw new HoldingsSyncError("第 " + (index + 1) + " 条持仓格式不正确");
    const market = MARKET_NAMES[String(lot.market || "").trim().toUpperCase()] || String(lot.market || "").trim();
    const code = String(lot.code || "").trim().toUpperCase();
    const buy = lot.buy && typeof lot.buy === "object" ? lot.buy : {};
    const sell = lot.sell && typeof lot.sell === "object" ? lot.sell : null;
    const fees = lot.fees && typeof lot.fees === "object" ? lot.fees : {};
    const buyQty = Number(buy.qty);
    const sellQty = sell ? Number(sell.qty ?? buy.qty) : 0;
    const explicitBuyFee = cleanOptionalNumber(fees.buy);
    const explicitSellFee = cleanOptionalNumber(fees.sell);
    const buyFee = explicitBuyFee ?? defaultBuyFee;
    const sellFee = sell ? explicitSellFee ?? defaultSellFee : undefined;
    if (buyFee < 0 || (sellFee !== undefined && sellFee < 0)) throw new HoldingsSyncError("第 " + (index + 1) + " 条手续费不正确");
    const base = {
      market,
      code,
      name: String(lot.name || code).trim(),
      cost: Number(buy.price),
      currency: currencyForMarket(market),
      sina: quoteCodeForMarket(market, code),
    };
    if (!sell) return [{ ...base, status: "holding", qty: buyQty, buyFeeUsd: buyFee }];
    if (!Number.isFinite(sellQty) || sellQty <= 0 || !Number.isFinite(buyQty) || buyQty <= 0 || sellQty > buyQty) {
      throw new HoldingsSyncError("第 " + (index + 1) + " 条卖出数量不正确");
    }
    const ratio = sellQty / buyQty;
    const records = [{
      ...base,
      status: "sold",
      qty: sellQty,
      sellPrice: Number(sell.price),
      sellDate: String(sell.date || ""),
      buyFeeUsd: buyFee * ratio,
      sellFeeUsd: sellFee,
    }];
    if (sellQty < buyQty) {
      records.unshift({
        ...base,
        status: "holding",
        qty: buyQty - sellQty,
        buyFeeUsd: buyFee * (1 - ratio),
      });
    }
    return records;
  });
}

export function sanitizeHoldings(input) {
  const rows = rowsFromInput(input);
  if (rows.length > 500) throw new HoldingsSyncError("持仓数据格式不正确");
  return rows.map((item, index) => {
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
    const sellPrice = cleanOptionalNumber(item.sellPrice);
    const sellDate = String(item.sellDate || "");
    if (status === "sold" && (sellPrice === undefined || sellPrice <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(sellDate))) {
      throw new HoldingsSyncError("第 " + (index + 1) + " 条卖出信息不完整");
    }
    for (const feeKey of ["buyFeeUsd", "sellFeeUsd"]) {
      const fee = cleanOptionalNumber(item[feeKey]);
      if (fee !== undefined && fee < 0) throw new HoldingsSyncError("第 " + (index + 1) + " 条手续费不正确");
    }
    const output = { market, code, name, status, cost, qty, currency, sina };
    ["purchaseCostCny", "sellProceedsCny", "buyFeeUsd", "sellFeeUsd", "sellPrice"].forEach((key) => {
      const value = cleanOptionalNumber(item[key]);
      if (value !== undefined) output[key] = value;
    });
    if (status === "sold") output.sellDate = sellDate;
    return output;
  });
}

export function createHoldingsDocument(input) {
  const rows = sanitizeHoldings(input);
  return {
    version: 2,
    guide: "market 只填 A / HK / US；没有 sell 表示持有中，有 sell 表示已卖出；币种、状态和行情代码由系统生成。",
    newTradeFeeUsd: { buy: DEFAULT_TRADE_FEE_USD, sell: DEFAULT_TRADE_FEE_USD },
    lots: rows.map((row) => {
      const lot = {
        market: MARKET_CODES[row.market],
        code: row.code,
        name: row.name,
        buy: { price: row.cost, qty: row.qty },
      };
      if (row.status === "sold") lot.sell = { price: row.sellPrice, qty: row.qty, date: row.sellDate };
      const fees = {};
      if (row.buyFeeUsd !== undefined) fees.buy = row.buyFeeUsd;
      if (row.sellFeeUsd !== undefined) fees.sell = row.sellFeeUsd;
      if (Object.keys(fees).length) lot.fees = fees;
      return lot;
    }),
  };
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
  const { holdings, document, ...status } = await readGitHubHoldings(config, fetcher);
  return status;
}

export async function readGitHubHoldings(config, fetcher = fetch) {
  const values = configValues(config);
  if (!values.token) throw new HoldingsSyncError("GitHub 即时同步尚未配置", 503);
  const endpoint = githubEndpoint(values);
  const current = await githubRequest(endpoint + "?ref=" + encodeURIComponent(values.branch), { headers: githubHeaders(values.token), cf: { cacheTtl: 0 } }, fetcher);
  if (!current.response.ok) throw githubFailure(current.response.status, "读取");
  if (!current.payload || current.payload.encoding !== "base64" || typeof current.payload.content !== "string") {
    throw new HoldingsSyncError("GitHub holdings.json 内容无法读取", 502);
  }
  let input;
  try {
    input = JSON.parse(base64ToUtf8(current.payload.content));
  } catch (error) {
    if (error instanceof HoldingsSyncError) throw error;
    throw new HoldingsSyncError("GitHub holdings.json 不是有效 JSON", 502);
  }
  let holdings;
  try {
    holdings = sanitizeHoldings(input);
  } catch (error) {
    if (error instanceof HoldingsSyncError) throw new HoldingsSyncError("GitHub holdings.json 格式不正确：" + error.message, 502);
    throw error;
  }
  return {
    target: values.owner + "/" + values.repo,
    path: values.path,
    branch: values.branch,
    fileSha: current.payload && current.payload.sha ? current.payload.sha : "",
    fileUrl: current.payload && current.payload.html_url ? current.payload.html_url : "",
    holdings,
    document: createHoldingsDocument(holdings),
  };
}

export async function syncHoldingsToGitHub(holdings, config, fetcher = fetch) {
  const values = configValues(config);
  if (!values.token) throw new HoldingsSyncError("GitHub 即时同步尚未配置", 503);
  const document = createHoldingsDocument(holdings);
  const content = utf8ToBase64(JSON.stringify(document, null, 2) + "\n");
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
