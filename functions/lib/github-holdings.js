export class HoldingsSyncError extends Error {
  constructor(message, status = 400, code = "", details = null) {
    super(message);
    this.name = "HoldingsSyncError";
    this.status = status;
    this.code = code;
    this.details = details;
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
    const lotId = String(lot.id || "").trim();
    const parentLotId = String(lot.parentLotId || "").trim();
    const buyDate = String(buy.date || "").trim();
    const buyOperationId = String(buy.operationId || lot.operationId || "").trim();
    const buyFxAsOf = String(buy.fxAsOf || "").trim();
    const buyFxSource = String(buy.fxSource || "").trim();
    const purchaseCostCny = cleanOptionalNumber(buy.purchaseCostCny);
    const buyFeeCny = cleanOptionalNumber(buy.feeCny);
    if (lotId) base.lotId = lotId;
    if (parentLotId) base.parentLotId = parentLotId;
    if (buyDate) base.buyDate = buyDate;
    if (buyOperationId) base.buyOperationId = buyOperationId;
    if (buyFxAsOf) base.buyFxAsOf = buyFxAsOf;
    if (buyFxSource) base.buyFxSource = buyFxSource;
    if (purchaseCostCny !== undefined) base.purchaseCostCny = purchaseCostCny;
    if (buyFeeCny !== undefined) base.buyFeeCny = buyFeeCny;
    if (!sell) return [{ ...base, status: "holding", qty: buyQty, buyFeeUsd: buyFee }];
    if (!Number.isFinite(sellQty) || sellQty <= 0 || !Number.isFinite(buyQty) || buyQty <= 0 || sellQty > buyQty) {
      throw new HoldingsSyncError("第 " + (index + 1) + " 条卖出数量不正确");
    }
    const ratio = sellQty / buyQty;
    const sellOperationId = String(sell.operationId || "").trim();
    const sellFxAsOf = String(sell.fxAsOf || "").trim();
    const sellFxSource = String(sell.fxSource || "").trim();
    const sellProceedsCny = cleanOptionalNumber(sell.sellProceedsCny);
    const sellFeeCny = cleanOptionalNumber(sell.feeCny);
    const soldBase = { ...base };
    if (lotId && sellQty < buyQty) {
      soldBase.lotId = lotId + ":sold:" + (sellOperationId || sell.date || "partial");
      soldBase.parentLotId = parentLotId || lotId;
    }
    if (purchaseCostCny !== undefined) soldBase.purchaseCostCny = purchaseCostCny * ratio;
    if (buyFeeCny !== undefined) soldBase.buyFeeCny = buyFeeCny * ratio;
    const records = [{
      ...soldBase,
      status: "sold",
      qty: sellQty,
      sellPrice: Number(sell.price),
      sellDate: String(sell.date || ""),
      buyFeeUsd: buyFee * ratio,
      sellFeeUsd: sellFee,
    }];
    if (sellOperationId) records[0].sellOperationId = sellOperationId;
    if (sellFxAsOf) records[0].sellFxAsOf = sellFxAsOf;
    if (sellFxSource) records[0].sellFxSource = sellFxSource;
    if (sellProceedsCny !== undefined) records[0].sellProceedsCny = sellProceedsCny;
    if (sellFeeCny !== undefined) records[0].sellFeeCny = sellFeeCny;
    if (sellQty < buyQty) {
      const holdingRecord = {
        ...base,
        status: "holding",
        qty: buyQty - sellQty,
        buyFeeUsd: buyFee * (1 - ratio),
      };
      if (purchaseCostCny !== undefined) holdingRecord.purchaseCostCny = purchaseCostCny * (1 - ratio);
      if (buyFeeCny !== undefined) holdingRecord.buyFeeCny = buyFeeCny * (1 - ratio);
      records.unshift(holdingRecord);
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
    for (const feeKey of ["buyFeeUsd", "sellFeeUsd", "buyFeeCny", "sellFeeCny"]) {
      const fee = cleanOptionalNumber(item[feeKey]);
      if (fee !== undefined && fee < 0) throw new HoldingsSyncError("第 " + (index + 1) + " 条手续费不正确");
    }
    const purchaseCostCny = cleanOptionalNumber(item.purchaseCostCny);
    if (purchaseCostCny !== undefined && purchaseCostCny < 0) {
      throw new HoldingsSyncError("第 " + (index + 1) + " 条人民币金额不正确");
    }
    const output = { market, code, name, status, cost, qty, currency, sina };
    const optionalStrings = {
      lotId: item.lotId,
      parentLotId: item.parentLotId,
      buyDate: item.buyDate,
      buyOperationId: item.buyOperationId,
      buyFxAsOf: item.buyFxAsOf,
      buyFxSource: item.buyFxSource,
      sellOperationId: item.sellOperationId,
      sellFxAsOf: item.sellFxAsOf,
      sellFxSource: item.sellFxSource,
    };
    for (const [key, rawValue] of Object.entries(optionalStrings)) {
      const value = String(rawValue || "").trim();
      if (value) output[key] = value;
    }
    if (output.buyDate && !/^\d{4}-\d{2}-\d{2}$/.test(output.buyDate)) {
      throw new HoldingsSyncError("第 " + (index + 1) + " 条买入日期不正确");
    }
    ["purchaseCostCny", "sellProceedsCny", "buyFeeCny", "sellFeeCny", "buyFeeUsd", "sellFeeUsd", "sellPrice"].forEach((key) => {
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
      if (row.lotId) lot.id = row.lotId;
      if (row.parentLotId) lot.parentLotId = row.parentLotId;
      if (row.buyDate) lot.buy.date = row.buyDate;
      if (row.purchaseCostCny !== undefined) lot.buy.purchaseCostCny = row.purchaseCostCny;
      if (row.buyFeeCny !== undefined) lot.buy.feeCny = row.buyFeeCny;
      if (row.buyFxAsOf) lot.buy.fxAsOf = row.buyFxAsOf;
      if (row.buyFxSource) lot.buy.fxSource = row.buyFxSource;
      if (row.buyOperationId) lot.buy.operationId = row.buyOperationId;
      if (row.status === "sold") {
        lot.sell = { price: row.sellPrice, qty: row.qty, date: row.sellDate };
        if (row.sellProceedsCny !== undefined) lot.sell.sellProceedsCny = row.sellProceedsCny;
        if (row.sellFeeCny !== undefined) lot.sell.feeCny = row.sellFeeCny;
        if (row.sellFxAsOf) lot.sell.fxAsOf = row.sellFxAsOf;
        if (row.sellFxSource) lot.sell.fxSource = row.sellFxSource;
        if (row.sellOperationId) lot.sell.operationId = row.sellOperationId;
      }
      const fees = {};
      if (row.buyFeeUsd !== undefined) fees.buy = row.buyFeeUsd;
      if (row.sellFeeUsd !== undefined) fees.sell = row.sellFeeUsd;
      if (Object.keys(fees).length) lot.fees = fees;
      return lot;
    }),
  };
}

function copyJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function operationValue(operation, trade, key) {
  if (trade && Object.prototype.hasOwnProperty.call(trade, key)) return trade[key];
  return operation[key];
}

function operationMarket(value) {
  const raw = String(value || "").trim();
  return MARKET_NAMES[raw.toUpperCase()] ? raw.toUpperCase() : MARKET_CODES[raw] || "";
}

function operationCode(market, value) {
  const raw = String(value || "").trim().toUpperCase().replace(/^\$/, "");
  if (market === "HK" && /^\d{1,5}$/.test(raw)) return raw.padStart(5, "0");
  return raw;
}

function positiveOperationNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new HoldingsSyncError(label + "不正确");
  return number;
}

function optionalNonNegativeNumber(value, label) {
  const number = cleanOptionalNumber(value);
  if (number !== undefined && number < 0) throw new HoldingsSyncError(label + "不正确");
  return number;
}

function validOperationDate(value, label) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HoldingsSyncError("请填写正确的" + label);
  return date;
}

function operationAlreadyApplied(document, operationId) {
  return document.lots.some((lot) => (
    String(lot.operationId || "") === operationId
    || String(lot.buy && lot.buy.operationId || "") === operationId
    || String(lot.sell && lot.sell.operationId || "") === operationId
  ));
}

function ensureLotIds(document) {
  const seen = new Set();
  document.lots.forEach((lot, index) => {
    let id = String(lot.id || "").trim();
    if (!id) {
      const date = String(lot.buy && lot.buy.date || "undated").replace(/[^0-9]/g, "") || "undated";
      id = "legacy-" + String(lot.market || "lot").toLowerCase() + "-" + String(lot.code || "unknown").toLowerCase() + "-" + date + "-" + (index + 1);
    }
    if (seen.has(id)) id += "-" + (index + 1);
    lot.id = id;
    seen.add(id);
  });
  return document;
}

function copyScaledBuy(buy, quantity, sourceQuantity) {
  const output = { ...buy, qty: quantity };
  const ratio = quantity / sourceQuantity;
  for (const key of ["purchaseCostCny", "feeCny"]) {
    const value = cleanOptionalNumber(buy[key]);
    if (value !== undefined) output[key] = value * ratio;
  }
  return output;
}

function proportionalShares(total, allocations) {
  if (total === undefined) return allocations.map(() => undefined);
  const quantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  let assigned = 0;
  return allocations.map((allocation, index) => {
    if (index === allocations.length - 1) return total - assigned;
    const share = total * allocation.quantity / quantity;
    assigned += share;
    return share;
  });
}

/**
 * Applies one append-only portfolio operation to a readable v2 document.
 * The function has no I/O, so callers can validate and retry safely before a GitHub PUT.
 */
export function applyHoldingOperation(input, rawOperation) {
  if (!rawOperation || typeof rawOperation !== "object") throw new HoldingsSyncError("持仓操作格式不正确");
  const operation = rawOperation;
  const type = String(operation.type || operation.action || "").trim().toLowerCase();
  if (type !== "buy" && type !== "sell") throw new HoldingsSyncError("持仓操作类型不正确");
  const operationId = String(operation.operationId || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(operationId)) throw new HoldingsSyncError("持仓操作 operationId 不正确");

  const document = ensureLotIds(createHoldingsDocument(input));
  if (operationAlreadyApplied(document, operationId)) return document;

  const trade = operation[type] && typeof operation[type] === "object" ? operation[type] : null;
  const security = operation.security && typeof operation.security === "object" ? operation.security : {};
  const market = operationMarket(operationValue(operation, trade, "market") || security.market);
  const code = operationCode(market, operationValue(operation, trade, "code") || security.code);
  if (!MARKET_NAMES[market] || !code) throw new HoldingsSyncError("持仓操作的市场或股票代码不正确");
  const price = positiveOperationNumber(operationValue(operation, trade, "price"), type === "buy" ? "买入价格" : "卖出价格");
  const quantity = positiveOperationNumber(operationValue(operation, trade, "qty"), type === "buy" ? "买入数量" : "卖出数量");
  const date = validOperationDate(operationValue(operation, trade, "date"), type === "buy" ? "买入日期" : "卖出日期");
  const fxAsOf = String(operationValue(operation, trade, "fxAsOf") || "").trim();
  const fxSource = String(operationValue(operation, trade, "fxSource") || "").trim();
  const feeCny = optionalNonNegativeNumber(operationValue(operation, trade, "feeCny"), "手续费人民币金额");

  if (type === "buy") {
    const purchaseCostCny = optionalNonNegativeNumber(operationValue(operation, trade, "purchaseCostCny"), "买入成本人民币金额");
    const requestedId = String(operation.lotId || operation.id || "").trim();
    const lotId = requestedId || "lot-" + operationId;
    if (document.lots.some((lot) => lot.id === lotId)) throw new HoldingsSyncError("持仓批次 id 已存在");
    const buy = { price, qty: quantity, date, operationId };
    if (purchaseCostCny !== undefined) buy.purchaseCostCny = purchaseCostCny;
    if (feeCny !== undefined) buy.feeCny = feeCny;
    if (fxAsOf) buy.fxAsOf = fxAsOf;
    if (fxSource) buy.fxSource = fxSource;
    document.lots.push({
      id: lotId,
      market,
      code,
      name: String(operationValue(operation, trade, "name") || security.name || code).trim(),
      buy,
      fees: { buy: DEFAULT_TRADE_FEE_USD },
    });
    return createHoldingsDocument(document);
  }

  // A small sale can legitimately have negative net proceeds when the fixed
  // US$20 fee is larger than the gross consideration.
  const sellProceedsCny = cleanOptionalNumber(operationValue(operation, trade, "sellProceedsCny"));
  const candidates = document.lots
    .map((lot, index) => ({ lot, index }))
    .filter(({ lot }) => !lot.sell && lot.market === market && String(lot.code).toUpperCase() === code)
    .sort((left, right) => {
      const leftDate = String(left.lot.buy && left.lot.buy.date || "0000-00-00");
      const rightDate = String(right.lot.buy && right.lot.buy.date || "0000-00-00");
      return leftDate.localeCompare(rightDate) || left.index - right.index;
    });
  const available = candidates.reduce((sum, item) => sum + Number(item.lot.buy.qty), 0);
  if (available < quantity) {
    throw new HoldingsSyncError("可卖数量不足，当前可卖 " + available + " 股");
  }

  let remainingToSell = quantity;
  const allocations = [];
  for (const candidate of candidates) {
    if (remainingToSell <= 0) break;
    const sourceQuantity = Number(candidate.lot.buy.qty);
    const allocatedQuantity = Math.min(sourceQuantity, remainingToSell);
    allocations.push({ ...candidate, sourceQuantity, quantity: allocatedQuantity });
    remainingToSell -= allocatedQuantity;
  }
  const allocationByIndex = new Map(allocations.map((allocation, index) => [allocation.index, { ...allocation, fragmentIndex: index }]));
  const sellFeeShares = proportionalShares(DEFAULT_TRADE_FEE_USD, allocations);
  const sellFeeCnyShares = proportionalShares(feeCny, allocations);
  const proceedsShares = proportionalShares(sellProceedsCny, allocations);
  const nextLots = [];

  document.lots.forEach((lot, index) => {
    const allocation = allocationByIndex.get(index);
    if (!allocation) {
      nextLots.push(lot);
      return;
    }
    const remainingQuantity = allocation.sourceQuantity - allocation.quantity;
    const sourceBuyFee = cleanOptionalNumber(lot.fees && lot.fees.buy) ?? DEFAULT_TRADE_FEE_USD;
    if (remainingQuantity > 0) {
      const remainingLot = copyJson(lot);
      remainingLot.buy = copyScaledBuy(lot.buy, remainingQuantity, allocation.sourceQuantity);
      remainingLot.fees = { ...(remainingLot.fees || {}), buy: sourceBuyFee * remainingQuantity / allocation.sourceQuantity };
      nextLots.push(remainingLot);
    }

    const soldBuy = copyScaledBuy(lot.buy, allocation.quantity, allocation.sourceQuantity);
    const sell = { price, qty: allocation.quantity, date, operationId };
    if (proceedsShares[allocation.fragmentIndex] !== undefined) sell.sellProceedsCny = proceedsShares[allocation.fragmentIndex];
    if (sellFeeCnyShares[allocation.fragmentIndex] !== undefined) sell.feeCny = sellFeeCnyShares[allocation.fragmentIndex];
    if (fxAsOf) sell.fxAsOf = fxAsOf;
    if (fxSource) sell.fxSource = fxSource;
    nextLots.push({
      id: lot.id + ":sold:" + operationId + ":" + (allocation.fragmentIndex + 1),
      parentLotId: lot.id,
      market: lot.market,
      code: lot.code,
      name: lot.name,
      buy: soldBuy,
      sell,
      fees: {
        buy: sourceBuyFee * allocation.quantity / allocation.sourceQuantity,
        sell: sellFeeShares[allocation.fragmentIndex],
      },
    });
  });

  return createHoldingsDocument({ ...document, lots: nextLots });
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

function githubRepositoryEndpoint(config) {
  return "https://api.github.com/repos/" + encodeURIComponent(config.owner) + "/" + encodeURIComponent(config.repo);
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

export async function readGitHubRepositoryStatus(config, fetcher = fetch) {
  const values = configValues(config);
  if (!values.token) throw new HoldingsSyncError("GitHub 即时同步尚未配置", 503);
  const current = await githubRequest(githubRepositoryEndpoint(values), {
    headers: githubHeaders(values.token),
    cf: { cacheTtl: 0 },
  }, fetcher);
  if (!current.response.ok) throw githubFailure(current.response.status, "读取仓库状态");
  const isPrivate = typeof current.payload?.private === "boolean" ? current.payload.private : null;
  const visibility = typeof current.payload?.visibility === "string"
    ? current.payload.visibility
    : isPrivate === null ? "unknown" : isPrivate ? "private" : "public";
  return {
    private: isPrivate,
    visibility,
    url: typeof current.payload?.html_url === "string" ? current.payload.html_url : "",
  };
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

async function writeHoldingsDocumentToGitHub(document, current, config, fetcher) {
  const values = configValues(config);
  if (!values.token) throw new HoldingsSyncError("GitHub 即时同步尚未配置", 503);
  const content = utf8ToBase64(JSON.stringify(document, null, 2) + "\n");
  const body = {
    message: "chore: apply holdings operation from 猪猪存钱罐",
    content,
    branch: values.branch,
    sha: current.fileSha,
  };
  const saved = await githubRequest(githubEndpoint(values), {
    method: "PUT",
    headers: githubHeaders(values.token),
    body: JSON.stringify(body),
    cf: { cacheTtl: 0 },
  }, fetcher);
  if (!saved.response.ok) throw githubFailure(saved.response.status, "更新");
  return {
    commitSha: saved.payload && saved.payload.commit ? saved.payload.commit.sha : "",
    fileSha: saved.payload && saved.payload.content && saved.payload.content.sha ? saved.payload.content.sha : "",
    fileUrl: saved.payload && saved.payload.content && saved.payload.content.html_url
      ? saved.payload.content.html_url
      : current.fileUrl || "",
    alreadyCurrent: false,
  };
}

function currentOperationResult(current) {
  return {
    commitSha: "",
    fileSha: current.fileSha,
    fileUrl: current.fileUrl,
    alreadyCurrent: true,
    document: current.document,
    holdings: current.holdings,
  };
}

function holdingsConflict(current) {
  return new HoldingsSyncError(
    "持仓数据已更新，请刷新后再提交",
    409,
    "HOLDINGS_SHA_CONFLICT",
    {
      fileSha: current.fileSha,
      currentFileSha: current.fileSha,
      document: current.document,
      holdings: current.holdings,
    },
  );
}

export async function syncHoldingOperationToGitHub(operation, expectedFileSha, config, fetcher = fetch) {
  const expected = String(expectedFileSha || "").trim();
  if (!expected) throw new HoldingsSyncError("缺少 expectedFileSha，请刷新持仓后重试");
  const current = await readGitHubHoldings(config, fetcher);
  const operationId = String(operation && operation.operationId || "").trim();
  if (operationId && operationAlreadyApplied(current.document, operationId)) {
    return currentOperationResult(current);
  }
  if (current.fileSha !== expected) throw holdingsConflict(current);
  const document = applyHoldingOperation(current.document, operation);
  const holdings = sanitizeHoldings(document);
  if (JSON.stringify(document) === JSON.stringify(current.document)) {
    return {
      commitSha: "",
      fileSha: current.fileSha,
      fileUrl: current.fileUrl,
      alreadyCurrent: true,
      document,
      holdings,
    };
  }
  try {
    const saved = await writeHoldingsDocumentToGitHub(document, current, config, fetcher);
    return { ...saved, document, holdings };
  } catch (error) {
    if (!(error instanceof HoldingsSyncError) || error.status !== 409) throw error;
    const latest = await readGitHubHoldings(config, fetcher);
    if (operationId && operationAlreadyApplied(latest.document, operationId)) return currentOperationResult(latest);
    throw holdingsConflict(latest);
  }
}
