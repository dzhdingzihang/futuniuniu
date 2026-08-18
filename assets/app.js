const MARKETS = ["全部", "A股", "港股", "美股"];
const MARKET_ORDER = ["港股", "A股", "美股"];
const MARKET_BENCHMARKS = {
  "A股": { symbol: "idx_csi300", name: "沪深300" },
  "港股": { symbol: "idx_hsi", name: "恒生指数" },
  "美股": { symbol: "idx_sp500", name: "标普500" }
};
const TRADE_KEY = "piggy-trades-v1";
const HOLDING_KEY = "piggy-linked-holdings-v1";
const WATCH_KEY = "piggy-watchlist-v1";
const MARKET_CACHE_KEY = "piggy-market-cache-v1";
const RADAR_CACHE_KEY = "piggy-radar-cache-v1";
const RADAR_MARKETS = ["A股", "港股", "美股"];
const RADAR_PAGE_SIZE = 10;
const RADAR_MODEL_VERSION = "radar-v1.1";
const RADAR_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const RADAR_HISTORY_TTL_MS = 30 * 60 * 1000;
const RADAR_HISTORY_ERROR_TTL_MS = 5 * 60 * 1000;
const RADAR_LEVEL_MODEL_VERSION = "radar-levels-v1";
const NAV_ITEMS = [["overview", "总览"], ["actions", "持仓明细"], ["radar", "机会雷达"], ["trades", "卖出记录"]];
const VALID_TABS = NAV_ITEMS.map(function (item) { return item[0]; });
// Legacy records store the buy price in native currency, but not historical FX.
// Keep invested cost fixed so a live FX refresh cannot change what was paid.
const COST_REFERENCE_RATES = { CNY: 1, HKD: 0.92, USD: 7.22 };
const FIXED_TRADE_FEE_USD = 20;
const BRAND_MOTION_CYCLE = 6400;
const BRAND_COIN_MIN = 4;
const BRAND_COIN_MAX = 12;
const PET_STATES = {
  idle: { row: 0, frames: 6, frameMs: 420, holdMs: 2940, label: "平静眨眼" },
  "running-right": { row: 1, frames: 8, frameMs: 190, holdMs: 3040, label: "开心迈步" },
  "running-left": { row: 2, frames: 8, frameMs: 190, holdMs: 3040, label: "快乐散步" },
  waving: { row: 3, frames: 4, frameMs: 260, holdMs: 2080, label: "开心挥手" },
  jumping: { row: 4, frames: 5, frameMs: 210, holdMs: 2100, label: "兴奋跳跃" },
  failed: { row: 5, frames: 8, frameMs: 300, holdMs: 3600, label: "有点难过" },
  waiting: { row: 6, frames: 6, frameMs: 340, holdMs: 3060, label: "耐心等待" },
  running: { row: 7, frames: 6, frameMs: 240, holdMs: 2880, label: "认真核算" },
  review: { row: 8, frames: 6, frameMs: 360, holdMs: 2880, label: "专注复盘" }
};
const PET_MOOD_SEQUENCES = {
  positive: ["waving", "running-right", "idle", "review", "running-left"],
  negative: ["review", "waiting", "failed", "idle"],
  neutral: ["idle", "waiting", "waving", "review"],
  working: ["review"],
  reviewing: ["review", "idle"]
};
const brandVisual = {
  mood: "",
  petState: "idle",
  petFrame: 0,
  petStateIndex: 0,
  petStateStartedAt: Date.now(),
  coinCount: BRAND_COIN_MIN,
  justAddedCoin: -1
};
let brandAnimationTimer = 0;
let jarDepositTimer = 0;
let jarCoinSettleTimer = 0;
let holdingLookupTimer = 0;
let holdingLookupController = null;
let holdingSearchTimer = 0;
let radarSearchTimer = 0;
let radarHistoryTimer = 0;
let toastTimer = 0;

const METRIC_HELP = {
  netInvested: "累计买入成交额减去累计卖出成交额，再加上每笔买入和卖出的固定手续费。历史成交按记录或参考汇率锁定。",
  marketValue: "当前未卖出持仓按最新报价和实时汇率折算的市值。",
  totalPnl: "当前持仓市值减去股票总投入；正数为盈利，负数为亏损。",
  todayPnl: "当前未卖出持仓的今日价格变化乘以数量，再按实时汇率折算；不包含当天未录入的已实现盈亏。",
  holdingCount: "当前状态为持有中的证券数量，不包含已卖出记录。",
  chart: "按当前持仓数量回看历史价格，并减去当前股票总投入得到估算曲线；未反映区间内仓位变化和历史汇率变化。",
  actionPrice: "执行价位由当前价、成本价、持仓盈亏和日内波动自动推导；用于明确下一步的风控或分批操作参考。"
};

const state = {
  tab: VALID_TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview",
  market: "全部",
  tradeMarket: "全部",
  tradeDateStart: "",
  tradeDateEnd: "",
  tradeSort: "date",
  tradeSortDirection: "desc",
  watchMarket: "全部",
  radarBand: "priority",
  radarSort: "score",
  radarQuery: "",
  radarPage: 1,
  radarRows: [],
  radarMarkets: {},
  radarStatus: "idle",
  radarError: "",
  expandedRadarId: "",
  radarRequestId: 0,
  radarHistories: {},
  radarHistoryMeta: {},
  radarHistoryStatus: {},
  radarHistoryRequestId: 0,
  radarHistoryController: null,
  radarVisibleFingerprint: "",
  trendDays: 30,
  rankMode: "profit",
  rankMarket: "全部",
  actionSort: "weight",
  actionSortDirection: "desc",
  holdingQuery: "",
  holdingPnlFilter: "all",
  expandedHoldingKey: "",
  baseHoldings: [],
  holdings: [],
  trades: [],
  rows: [],
  quotes: new Map(),
  quoteMeta: {},
  histories: {},
  rates: { CNY: 1, HKD: 0.92, USD: 7.22 },
  fxMeta: { asOf: null, fetchedAt: null, source: "固定参考汇率", fallback: true },
  saved: normalizeWatchlist(readStorage(WATCH_KEY, [])),
  updatedAt: "",
  isRefreshing: false,
  isHistoryLoading: false,
  isLoggingOut: false,
  holdingEditorOpen: false,
  holdingDraft: null,
  holdingLookup: { status: "idle", message: "输入股票代码后自动识别名称", security: null },
  holdingSave: { status: "idle", message: "" },
  toast: null
};

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value, null, 2));
}

function normalizeWatchlist(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(function (item) {
    return item && typeof item === "object" && item.market && item.code && item.name;
  }).map(function (item) {
    const market = RADAR_MARKETS.includes(item.market) ? item.market : "美股";
    const code = String(item.code || "").trim().toUpperCase();
    const id = String(item.id || market + ":" + code);
    const normalized = Object.assign({}, item, {
      id: id,
      market: market,
      code: code,
      currency: item.currency || currencyForMarket(market),
      addedAt: item.addedAt || null
    });
    ["history", "upper", "upperPct", "stop", "stopPct"].forEach(function (key) { delete normalized[key]; });
    return normalized;
  }).filter(function (item) {
    if (!item.code || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function money(value, digits) {
  const amount = optionalNumber(value);
  if (!Number.isFinite(amount)) return "--";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: digits ?? 0, maximumFractionDigits: digits ?? 0 }).format(amount);
}

function nativeMoney(value, currency) {
  const amount = optionalNumber(value);
  if (!Number.isFinite(amount)) return "--";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency || "CNY", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function signed(value, digits) {
  const amount = optionalNumber(value);
  if (!Number.isFinite(amount)) return "--";
  return (amount > 0 ? "+" : "") + money(amount, digits);
}

function signedNative(value, currency) {
  const amount = optionalNumber(value);
  if (!Number.isFinite(amount)) return "--";
  return (amount > 0 ? "+" : "") + nativeMoney(amount, currency);
}

function pct(value) {
  const amount = optionalNumber(value);
  if (!Number.isFinite(amount)) return "--";
  return (amount > 0 ? "+" : "") + amount.toFixed(2) + "%";
}

function ratioPct(value, digits) {
  const amount = optionalNumber(value);
  if (!Number.isFinite(amount)) return "--";
  return amount.toFixed(digits ?? 2) + "%";
}

function tone(value) {
  const amount = optionalNumber(value);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return "neutral";
  return amount > 0 ? "positive" : "negative";
}

function sum(items, key) {
  return items.reduce(function (total, item) { return total + (Number(item[key]) || 0); }, 0);
}

function last(items) {
  return items && items.length ? items[items.length - 1] : null;
}

function marketClass(market) {
  return market === "港股" ? "hk" : market === "A股" ? "a" : "us";
}

function marketLabel(market) {
  return "<span class=\"market-badge " + marketClass(market) + "\">" + escapeHtml(market) + "</span>";
}

function currencyForMarket(market) {
  return market === "港股" ? "HKD" : market === "美股" ? "USD" : "CNY";
}

const HOLDING_MARKET_CODES = { A: "A股", HK: "港股", US: "美股" };
const HOLDING_MARKET_KEYS = { "A股": "A", "港股": "HK", "美股": "US" };

function normalizedHoldingMarket(value) {
  const market = String(value || "").trim();
  return HOLDING_MARKET_CODES[market.toUpperCase()] || market;
}

function providerCodeForHolding(market, rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return "";
  if (market === "港股") return "hk" + code.padStart(5, "0");
  if (market === "美股") return "gb_" + code.toLowerCase();
  if (market === "A股" && /^\d{6}$/.test(code)) return (/^[569]/.test(code) ? "sh" : "sz") + code;
  return "";
}

function holdingsFromDocument(document) {
  if (Array.isArray(document)) return document.map(normalizeHolding).filter(isValidHolding);
  if (!document || Number(document.version) !== 2 || !Array.isArray(document.lots)) return [];
  const feeDefaults = document.newTradeFeeUsd && typeof document.newTradeFeeUsd === "object" ? document.newTradeFeeUsd : {};
  const configuredBuyFee = optionalNumber(feeDefaults.buy);
  const configuredSellFee = optionalNumber(feeDefaults.sell);
  const defaultBuyFee = Number.isFinite(configuredBuyFee) && configuredBuyFee >= 0 ? configuredBuyFee : FIXED_TRADE_FEE_USD;
  const defaultSellFee = Number.isFinite(configuredSellFee) && configuredSellFee >= 0 ? configuredSellFee : FIXED_TRADE_FEE_USD;
  return document.lots.flatMap(function (lot) {
    if (!lot || typeof lot !== "object") return [];
    const market = normalizedHoldingMarket(lot.market);
    const code = String(lot.code || "").trim().toUpperCase();
    const buy = lot.buy && typeof lot.buy === "object" ? lot.buy : {};
    const sell = lot.sell && typeof lot.sell === "object" ? lot.sell : null;
    const fees = lot.fees && typeof lot.fees === "object" ? lot.fees : {};
    const buyQty = Number(buy.qty);
    const sellQty = sell ? Number(sell.qty ?? buy.qty) : 0;
    const explicitBuyFee = optionalNumber(fees.buy);
    const explicitSellFee = optionalNumber(fees.sell);
    const buyFee = Number.isFinite(explicitBuyFee) ? explicitBuyFee : defaultBuyFee;
    const sellFee = Number.isFinite(explicitSellFee) ? explicitSellFee : defaultSellFee;
    const base = {
      market: market,
      code: code,
      name: String(lot.name || code).trim(),
      cost: Number(buy.price),
      currency: currencyForMarket(market),
      sina: providerCodeForHolding(market, code)
    };
    if (!sell) return [normalizeHolding(Object.assign({}, base, { status: "holding", qty: buyQty, buyFeeUsd: buyFee }))].filter(isValidHolding);
    if (!Number.isFinite(sellQty) || sellQty <= 0 || !Number.isFinite(buyQty) || buyQty <= 0 || sellQty > buyQty) return [];
    const ratio = sellQty / buyQty;
    const records = [normalizeHolding(Object.assign({}, base, {
      status: "sold",
      qty: sellQty,
      sellPrice: Number(sell.price),
      sellDate: String(sell.date || ""),
      buyFeeUsd: Number.isFinite(buyFee) ? buyFee * ratio : NaN,
      sellFeeUsd: sellFee
    }))];
    if (sellQty < buyQty) {
      records.unshift(normalizeHolding(Object.assign({}, base, {
        status: "holding",
        qty: buyQty - sellQty,
        buyFeeUsd: Number.isFinite(buyFee) ? buyFee * (1 - ratio) : NaN
      })));
    }
    return records.filter(isValidHolding);
  });
}

function isHoldingsDocument(document) {
  return Array.isArray(document) || Boolean(document && Number(document.version) === 2 && Array.isArray(document.lots));
}

function selectStartupHoldingsDocument(syncPayload, staticDocument, localDocument) {
  if (syncPayload && syncPayload.ok === true) {
    if (isHoldingsDocument(syncPayload.holdings)) return { source: "github", document: syncPayload.holdings };
    if (isHoldingsDocument(syncPayload.document)) return { source: "github", document: syncPayload.document };
  }
  if (isHoldingsDocument(staticDocument)) return { source: "static", document: staticDocument };
  if (isHoldingsDocument(localDocument)) return { source: "local", document: localDocument };
  return { source: "empty", document: [] };
}

function readableHoldingsDocument(rows) {
  return {
    version: 2,
    guide: "market 只填 A / HK / US；没有 sell 表示持有中，有 sell 表示已卖出；币种、状态和行情代码由系统生成。",
    newTradeFeeUsd: { buy: FIXED_TRADE_FEE_USD, sell: FIXED_TRADE_FEE_USD },
    lots: rows.map(normalizeHolding).filter(isValidHolding).map(function (row) {
      const lot = {
        market: HOLDING_MARKET_KEYS[row.market],
        code: row.code,
        name: row.name,
        buy: { price: row.cost, qty: row.qty }
      };
      if (row.status === "sold") lot.sell = { price: row.sellPrice, qty: row.qty, date: row.sellDate };
      const fees = {};
      if (Number.isFinite(row.buyFeeUsd)) fees.buy = row.buyFeeUsd;
      if (Number.isFinite(row.sellFeeUsd)) fees.sell = row.sellFeeUsd;
      if (Object.keys(fees).length) lot.fees = fees;
      return lot;
    })
  };
}

function dualMoney(nativeValue, currency, cnyValue, toneClass) {
  const toneName = toneClass ? " " + toneClass : "";
  if (currency === "CNY") return "<b class=\"" + toneName + "\">" + nativeMoney(nativeValue, "CNY") + "</b><small>人民币</small>";
  return "<b class=\"" + toneName + "\">" + nativeMoney(nativeValue, currency) + "</b><small>≈ " + money(cnyValue, 0) + "</small>";
}

function getJson(url, fallback, timeoutMs) {
  const controller = new AbortController();
  const timeout = window.setTimeout(function () { controller.abort(); }, timeoutMs || 6000);
  return fetch(url, { cache: "no-store", signal: controller.signal }).then(function (response) {
    if (!response.ok) throw new Error(response.status + " " + response.statusText);
    return response.json();
  }).catch(function () { return fallback; }).finally(function () { window.clearTimeout(timeout); });
}

function isRadarCandidate(item, market) {
  if (!item || typeof item !== "object" || item.market !== market || item.id !== market + ":" + item.code || !item.code || !item.name || !item.sina || item.currency !== currencyForMarket(market)) return false;
  if (item.quoteUpdatedAt && !Number.isFinite(Date.parse(item.quoteUpdatedAt))) return false;
  const score = optionalNumber(item.score), metrics = item.metrics || {}, components = item.components || {};
  if (!Number.isFinite(score) || score < 0 || score > 100) return false;
  const expectedBand = score >= 70 ? "priority" : score >= 55 ? "watch" : "reserve";
  if (item.band !== expectedBand) return false;
  if (![optionalNumber(metrics.price), optionalNumber(metrics.amount), optionalNumber(metrics.marketCap)].every(function (value) { return Number.isFinite(value) && value > 0; })) return false;
  const componentEntries = [["trend", 35], ["liquidity", 30], ["risk", 20], ["quality", 15]];
  if (!componentEntries.every(function (entry) {
    const value = optionalNumber(components[entry[0]]);
    return Number.isFinite(value) && value >= 0 && value <= entry[1];
  })) return false;
  const total = componentEntries.reduce(function (sum, entry) { return sum + optionalNumber(components[entry[0]]); }, 0);
  return Math.abs(total - score) <= 0.11;
}

function radarSnapshotAgeMs(payload) {
  const timestamp = Date.parse(payload && payload.fetchedAt || "");
  const age = Date.now() - timestamp;
  return Number.isFinite(timestamp) && age >= -5 * 60 * 1000 ? Math.max(0, age) : Infinity;
}

function radarSnapshotIsCurrent(payload) {
  return radarSnapshotAgeMs(payload) <= RADAR_SNAPSHOT_MAX_AGE_MS;
}

function radarEffectiveLoadState(payload) {
  const loadState = payload && payload.loadState || "idle";
  return loadState === "fresh" && !radarSnapshotIsCurrent(payload) ? "cached" : loadState;
}

function isRadarSnapshot(payload, market) {
  if (!payload || payload.market !== market || payload.modelVersion !== RADAR_MODEL_VERSION || !Array.isArray(payload.candidates)) return false;
  const poolSize = optionalNumber(payload.poolSize);
  if (!Number.isInteger(poolSize) || poolSize < 200 || payload.candidates.length !== poolSize) return false;
  if (!Number.isFinite(Date.parse(payload.fetchedAt || "")) || !String(payload.source || "").trim()) return false;
  return payload.candidates.every(function (item) { return isRadarCandidate(item, market); });
}

function radarRowsFromSnapshots(snapshots) {
  return RADAR_MARKETS.flatMap(function (market) {
    const snapshot = snapshots && snapshots[market];
    if (!snapshot || !Array.isArray(snapshot.candidates)) return [];
    return snapshot.candidates.map(function (item) {
      return Object.assign({}, item, {
        source: snapshot.source || item.source,
        fetchedAt: snapshot.fetchedAt || item.fetchedAt,
        modelVersion: snapshot.modelVersion || item.modelVersion,
        loadState: radarEffectiveLoadState(snapshot),
        loadError: snapshot.error || ""
      });
    });
  });
}

function adoptRadarSnapshots(snapshots, source) {
  const next = {};
  RADAR_MARKETS.forEach(function (market) {
    const payload = snapshots && snapshots[market];
    if (!isRadarSnapshot(payload, market)) return;
    next[market] = Object.assign({}, payload, { loadState: source || payload.loadState || "cached" });
  });
  state.radarMarkets = next;
  state.radarRows = radarRowsFromSnapshots(next);
  return Object.keys(next).length;
}

function readRadarCache() {
  const cache = readStorage(RADAR_CACHE_KEY, null);
  if (!cache || Number(cache.version) !== 1 || typeof cache !== "object" || !cache.markets || typeof cache.markets !== "object") return false;
  const count = adoptRadarSnapshots(cache.markets, "cached");
  if (count) state.radarStatus = count === RADAR_MARKETS.length ? "cached" : "partial";
  return count > 0;
}

function saveRadarCache() {
  const markets = {};
  RADAR_MARKETS.forEach(function (market) {
    if (!isRadarSnapshot(state.radarMarkets[market], market)) return;
    markets[market] = Object.assign({}, state.radarMarkets[market]);
    delete markets[market].loadState;
  });
  try {
    writeStorage(RADAR_CACHE_KEY, { version: 1, savedAt: new Date().toISOString(), markets: markets });
  } catch {
    // The live snapshot remains usable even if browser storage is unavailable.
  }
}

async function fetchRadarMarket(market) {
  const controller = new AbortController();
  const timeout = window.setTimeout(function () { controller.abort(); }, 14000);
  try {
    const response = await fetch("/api/radar?market=" + encodeURIComponent(market), { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(market + "扫描失败（" + response.status + "）");
    const payload = await response.json();
    if (!isRadarSnapshot(payload, market)) throw new Error(market + "扫描结果格式不正确");
    if (Number(payload.poolSize) < 200) throw new Error(market + "有效候选不足200只");
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadRadar(force) {
  if (state.radarStatus === "loading") return;
  if (!force && RADAR_MARKETS.every(function (market) {
    return isRadarSnapshot(state.radarMarkets[market], market) && state.radarMarkets[market].loadState === "fresh" && radarSnapshotIsCurrent(state.radarMarkets[market]);
  })) return;
  const requestId = ++state.radarRequestId;
  state.radarStatus = "loading";
  state.radarError = "";
  render();
  const results = await Promise.allSettled(RADAR_MARKETS.map(fetchRadarMarket));
  if (requestId !== state.radarRequestId) return;
  const failures = [];
  let freshCount = 0;
  results.forEach(function (result, index) {
    const market = RADAR_MARKETS[index];
    if (result.status === "fulfilled") {
      state.radarMarkets[market] = Object.assign({}, result.value, { loadState: "fresh" });
      freshCount += 1;
    } else {
      const message = result.reason && result.reason.message ? result.reason.message : market + "扫描失败";
      failures.push(message);
      if (isRadarSnapshot(state.radarMarkets[market], market)) {
        state.radarMarkets[market].loadState = "cached";
        state.radarMarkets[market].error = message;
      } else {
        state.radarMarkets[market] = { market: market, candidates: [], poolSize: 0, rawSize: 0, loadState: "error", error: message };
      }
    }
  });
  state.radarRows = radarRowsFromSnapshots(state.radarMarkets);
  state.radarStatus = freshCount === RADAR_MARKETS.length ? "success" : freshCount ? "partial" : state.radarRows.length ? "stale" : "error";
  state.radarError = failures.join("；");
  if (freshCount) saveRadarCache();
  render();
}

function fixedPurchaseCost(item) {
  const recordedCost = Number(item.purchaseCostCny ?? item.costCny);
  if (Number.isFinite(recordedCost) && recordedCost > 0) return recordedCost;
  const buyFeeUsd = Number(item.buyFeeUsd);
  const feeCny = Number.isFinite(buyFeeUsd) && buyFeeUsd > 0 ? buyFeeUsd * COST_REFERENCE_RATES.USD : 0;
  return Number(item.cost) * Number(item.qty) * (COST_REFERENCE_RATES[item.currency] || 1) + feeCny;
}

function fixedSaleProceeds(item) {
  const recordedProceeds = Number(item.sellProceedsCny ?? item.saleProceedsCny);
  if (Number.isFinite(recordedProceeds)) return recordedProceeds;
  if (item.status !== "sold" || !Number.isFinite(Number(item.sellPrice))) return 0;
  const sellFeeUsd = Number(item.sellFeeUsd);
  const feeCny = Number.isFinite(sellFeeUsd) && sellFeeUsd > 0 ? sellFeeUsd * COST_REFERENCE_RATES.USD : 0;
  return Number(item.sellPrice) * Number(item.qty) * (COST_REFERENCE_RATES[item.currency] || 1) - feeCny;
}

function feeCny(feeUsd) {
  const value = Number(feeUsd);
  return Number.isFinite(value) && value >= 0 ? value * COST_REFERENCE_RATES.USD : 0;
}

function grossPurchasePrincipalCny(row) {
  return Math.max(0, Number(row.purchaseCostCny) - feeCny(row.buyFeeUsd));
}

function grossSaleAmountCny(row) {
  if (row.status !== "sold") return 0;
  return Number(row.saleProceedsCny) + feeCny(row.sellFeeUsd);
}

function uniqueHoldingCount(rows) {
  return new Set((rows || []).filter(function (row) { return row.status !== "sold"; }).map(function (row) {
    return row.market + ":" + row.code;
  })).size;
}

function readMarketCache() {
  const cache = readStorage(MARKET_CACHE_KEY, null);
  if (!cache || typeof cache !== "object") return false;
  if (cache.quotes && typeof cache.quotes === "object") state.quotes = new Map(Object.entries(cache.quotes));
  if (cache.quoteMeta && typeof cache.quoteMeta === "object") state.quoteMeta = Object.assign({}, cache.quoteMeta);
  if (cache.histories && typeof cache.histories === "object") state.histories = cache.histories;
  if (cache.rates && typeof cache.rates === "object") state.rates = Object.assign({}, state.rates, cache.rates);
  if (cache.fxMeta && typeof cache.fxMeta === "object") state.fxMeta = Object.assign({}, state.fxMeta, cache.fxMeta);
  if (cache.updatedAt) state.updatedAt = String(cache.updatedAt);
  return true;
}

function saveMarketCache() {
  writeStorage(MARKET_CACHE_KEY, {
    quotes: Object.fromEntries(state.quotes), quoteMeta: state.quoteMeta, histories: state.histories,
    rates: state.rates, fxMeta: state.fxMeta, updatedAt: state.updatedAt
  });
}

function quoteIsFresh(symbol) {
  const fetchedAt = Date.parse(state.quoteMeta[symbol] || "");
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt >= 0 && Date.now() - fetchedAt <= 7 * 86400000;
}

function normalizedMarketDate(value) {
  const match = String(value || "").match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  return match ? [match[1], match[2], match[3]].join("-") : "";
}

function calendarDateInTimeZone(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return [values.year, values.month, values.day].join("-");
  } catch (_) {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  }
}

function quoteIsForCurrentMarketDay(quote, market) {
  const quoteDate = normalizedMarketDate(quote && quote.date);
  if (!quoteDate) return false;
  const timeZone = market === "美股" ? "America/New_York" : "Asia/Shanghai";
  return quoteDate === calendarDateInTimeZone(timeZone);
}

function quoteHasRecentPrice(symbol, quote) {
  const price = Number(quote && quote.price);
  return Number.isFinite(price) && price > 0 && quoteIsFresh(symbol) && historyAgeDays(normalizedMarketDate(quote && quote.date)) <= 10;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function normalizeHolding(item) {
  const market = normalizedHoldingMarket(item.market);
  const code = String(item.code || "").trim().toUpperCase();
  const rawStatus = String(item.status || "holding").toLowerCase();
  const status = rawStatus === "sold" || rawStatus === "卖出" ? "sold" : "holding";
  return {
    market: market,
    code: code,
    name: String(item.name || code || "").trim(),
    cost: Number(item.cost),
    qty: Number(item.qty),
    currency: String(item.currency || currencyForMarket(market)).toUpperCase(),
    purchaseCostCny: optionalNumber(item.purchaseCostCny ?? item.costCny),
    sellProceedsCny: optionalNumber(item.sellProceedsCny ?? item.saleProceedsCny),
    buyFeeUsd: optionalNumber(item.buyFeeUsd),
    sellFeeUsd: optionalNumber(item.sellFeeUsd),
    sina: String(item.sina || providerCodeForHolding(market, code)).toLowerCase(),
    status: status,
    sellPrice: optionalNumber(item.sellPrice ?? item.soldPrice ?? item.exitPrice),
    sellDate: String(item.sellDate || item.soldDate || "")
  };
}

function normalizeTrade(item, index) {
  return {
    id: String(item.id || "local-" + Date.now() + "-" + index),
    date: String(item.date || ""),
    action: item.action === "sell" ? "sell" : "buy",
    market: String(item.market || ""),
    code: String(item.code || ""),
    name: String(item.name || item.code || ""),
    price: Number(item.price),
    qty: Number(item.qty),
    currency: String(item.currency || "").toUpperCase(),
    sina: String(item.sina || "").toLowerCase(),
    note: String(item.note || ""),
    feeUsd: optionalNumber(item.feeUsd),
    affectsHoldings: item.affectsHoldings === true
  };
}

function activeHoldings() {
  return state.holdings.filter(function (item) { return item.status !== "sold"; });
}

function isValidHolding(item) {
  return item.market && item.code && item.sina && item.currency && Number.isFinite(item.cost) && item.cost > 0 && Number.isFinite(item.qty) && item.qty > 0 && (item.status !== "sold" || (Number.isFinite(item.sellPrice) && item.sellPrice > 0));
}

function rebuildRows() {
  state.rows = state.holdings.filter(isValidHolding).map(function (item, index) {
    const quote = state.quotes.get(item.sina);
    const history = state.histories[item.sina] || [];
    const quotePrice = Number(quote && quote.price);
    const historyPoint = last(history);
    const historyPrice = Number(historyPoint && historyPoint.close);
    const hasQuotePrice = Number.isFinite(quotePrice) && quotePrice > 0;
    const quoteDate = normalizedMarketDate(quote && quote.date);
    const hasLivePrice = quoteHasRecentPrice(item.sina, quote);
    const hasHistoryPrice = Number.isFinite(historyPrice) && historyPrice > 0 && historyAgeDays(historyPoint && historyPoint.date) <= 10;
    const hasTodayQuote = hasLivePrice && quoteIsForCurrentMarketDay(quote, item.market) && Number.isFinite(Number(quote && quote.change)) && Number.isFinite(Number(quote && quote.changePct));
    const live = hasLivePrice ? quotePrice : hasHistoryPrice ? historyPrice : hasQuotePrice ? quotePrice : NaN;
    const price = item.status === "sold" ? item.sellPrice : live;
    const fx = state.rates[item.currency] || 1;
    const costValue = item.cost * item.qty;
    const exitValue = price * item.qty;
    const hasValuationPrice = hasLivePrice || hasHistoryPrice;
    const valueCny = item.status === "sold" ? 0 : hasValuationPrice && Number.isFinite(exitValue) ? exitValue * fx : NaN;
    const purchaseCostCny = fixedPurchaseCost(item);
    const saleProceedsCny = fixedSaleProceeds(item);
    const pnlCny = item.status === "sold" ? saleProceedsCny - purchaseCostCny : Number.isFinite(valueCny) ? valueCny - purchaseCostCny : NaN;
    const todayPnlCny = item.status === "sold" ? 0 : hasTodayQuote ? Number(quote.change) * item.qty * fx : NaN;
    const changePct = Number(quote && quote.changePct);
    const pnlRate = purchaseCostCny ? pnlCny / purchaseCostCny * 100 : 0;
    const row = Object.assign({}, item, {
      quote: quote,
      history: history,
      price: price,
      costCny: costValue * fx,
      purchaseCostCny: purchaseCostCny,
      saleProceedsCny: saleProceedsCny,
      valueCny: valueCny,
      pnlCny: pnlCny,
      pnlRate: pnlRate,
      todayPnlCny: todayPnlCny,
      changePct: hasTodayQuote && Number.isFinite(changePct) ? changePct : NaN,
      hasLivePrice: hasLivePrice,
      hasTodayQuote: hasTodayQuote,
      priceSource: hasLivePrice ? "quote" : hasHistoryPrice ? "history" : hasQuotePrice ? "cache" : "cost",
      priceAsOf: hasLivePrice ? [quoteDate, String(quote && quote.time || "")].filter(Boolean).join("T") : hasHistoryPrice ? historyPoint.date : hasQuotePrice ? [quoteDate, String(quote && quote.time || "")].filter(Boolean).join("T") || state.quoteMeta[item.sina] || "" : "",
      holdingPct: 0,
      holdingKey: [item.market, item.code, item.status, index].join(":")
    });
    row.analysis = analysisFor(row);
    return row;
  });
  const totalValue = sum(state.rows.filter(function (row) { return row.status !== "sold"; }), "valueCny");
  state.rows.forEach(function (row) { row.holdingPct = totalValue ? row.valueCny / totalValue * 100 : 0; });
}

function analysisFor(row) {
  if (row.status === "sold") return { action: "已完成", cls: "good", text: "已卖出记录已进入已实现盈亏。", priority: 5, addPrice: NaN, stopPrice: NaN, trend: { label: "已结束", cls: "neutral", text: "该批次已经卖出" } };
  if (!Number.isFinite(row.price) || !Number.isFinite(row.pnlRate) || !["quote", "history"].includes(row.priceSource)) {
    return { action: "等待行情", cls: "hold", priority: 4, addPrice: NaN, stopPrice: NaN, trend: { label: "无法分析", cls: "neutral", text: "有效行情不足" }, text: "等待当前或最近有效行情后再生成价格规则。" };
  }
  const stopPrice = Math.min(row.price * 0.96, row.cost * 0.90);
  const addPrice = row.price * 0.98;
  const takeProfitPrice = row.price * 0.93;
  const trend = !Number.isFinite(row.changePct)
    ? { label: "走势待分析", cls: "neutral", text: "当日涨跌数据不足" }
    : row.changePct >= 0
      ? { label: "当日偏强", cls: "up", text: "当日价格表现偏强" }
      : { label: "当日偏弱", cls: "down", text: "当日价格表现偏弱" };
  if (row.pnlRate <= -15) return {
    action: "止损", cls: "stop", price: stopPrice, trigger: "跌破", priority: 0, addPrice: addPrice, stopPrice: stopPrice, trend: trend,
    text: "跌破 " + nativeMoney(stopPrice, row.currency) + " 立即止损，停止补仓。"
  };
  if (row.pnlRate >= 20) return {
    action: "止盈", cls: "take", price: takeProfitPrice, trigger: "跌破", priority: 1, addPrice: addPrice, stopPrice: stopPrice, trend: trend,
    text: "跌破 " + nativeMoney(takeProfitPrice, row.currency) + " 分批止盈，先锁定部分利润。"
  };
  if (row.pnlRate <= -5 && row.changePct <= -2) return {
    action: "补仓", cls: "add", price: addPrice, trigger: "回踩", priority: 2, addPrice: addPrice, stopPrice: stopPrice, trend: trend,
    text: "回踩 " + nativeMoney(addPrice, row.currency) + " 附近补仓，单次不超过现有仓位的 25%。"
  };
  if (row.changePct <= -5) return {
    action: "止损", cls: "stop", price: stopPrice, trigger: "跌破", priority: 3, addPrice: addPrice, stopPrice: stopPrice, trend: trend,
    text: "若跌破 " + nativeMoney(stopPrice, row.currency) + " 则止损，避免继续扩大亏损。"
  };
  return { action: "持有", cls: "hold", priority: 4, addPrice: addPrice, stopPrice: stopPrice, trend: trend, text: "继续持有；未触发补仓、止损或止盈的规则价位。" };
}

function filteredRows(status) {
  return state.rows.filter(function (row) {
    return (!status || row.status === status) && (state.market === "全部" || row.market === state.market);
  });
}

function summary() {
  const openRows = state.rows.filter(function (row) { return row.status !== "sold"; });
  const valuedRows = openRows.filter(function (row) { return Number.isFinite(Number(row.valueCny)); });
  const todayRows = openRows.filter(function (row) { return row.hasTodayQuote && Number.isFinite(Number(row.todayPnlCny)); });
  const soldRows = state.rows.filter(function (row) { return row.status === "sold"; });
  const grossBuys = sum(state.rows, "purchaseCostCny");
  const saleProceeds = sum(soldRows, "saleProceedsCny");
  const buyFees = state.rows.reduce(function (total, row) { return total + feeCny(row.buyFeeUsd); }, 0);
  const sellFees = soldRows.reduce(function (total, row) { return total + feeCny(row.sellFeeUsd); }, 0);
  const grossBuyPrincipal = state.rows.reduce(function (total, row) { return total + grossPurchasePrincipalCny(row); }, 0);
  const grossSaleAmount = soldRows.reduce(function (total, row) { return total + grossSaleAmountCny(row); }, 0);
  const netInvested = grossBuys - saleProceeds;
  const valuationComplete = valuedRows.length === openRows.length;
  const todayComplete = todayRows.length === openRows.length;
  const value = valuationComplete ? sum(valuedRows, "valueCny") : NaN;
  const openCost = valuationComplete ? sum(valuedRows, "purchaseCostCny") : NaN;
  const openPnl = valuationComplete ? sum(valuedRows, "pnlCny") : NaN;
  const soldPnl = sum(soldRows, "pnlCny");
  const totalPnl = valuationComplete ? value - netInvested : NaN;
  const today = todayComplete ? sum(todayRows, "todayPnlCny") : NaN;
  const yesterdayValue = valuationComplete && todayComplete ? value - today : NaN;
  return {
    openRows: openRows, soldRows: soldRows, grossBuys: grossBuys, saleProceeds: saleProceeds,
    grossBuyPrincipal: grossBuyPrincipal, grossSaleAmount: grossSaleAmount,
    buyFees: buyFees, sellFees: sellFees, totalFees: buyFees + sellFees,
    netInvested: netInvested, value: value, valuationCount: valuedRows.length, valuationTotal: openRows.length,
    openCost: openCost, openPnl: openPnl, openPnlRate: openCost > 0 ? openPnl / openCost * 100 : NaN, soldPnl: soldPnl,
    totalPnl: totalPnl, totalRate: netInvested > 0 ? totalPnl / netInvested * 100 : NaN,
    today: today, todayCount: todayRows.length, todayTotal: openRows.length,
    yesterdayValue: yesterdayValue, todayRate: yesterdayValue > 0 ? today / yesterdayValue * 100 : NaN,
    holdingCount: uniqueHoldingCount(openRows)
  };
}

function byMarket(market, items) {
  return (items || state.rows).filter(function (row) { return row.market === market; });
}

function marketSummary(market) {
  const all = byMarket(market);
  const open = all.filter(function (row) { return row.status !== "sold"; });
  const valuedOpen = open.filter(function (row) { return Number.isFinite(Number(row.valueCny)); });
  const todayOpen = open.filter(function (row) { return row.hasTodayQuote && Number.isFinite(Number(row.todayPnlCny)); });
  const valuationComplete = valuedOpen.length === open.length;
  const todayComplete = todayOpen.length === open.length;
  const currency = currencyForMarket(market);
  const fx = state.rates[currency] || 1;
  const grossBuys = sum(all, "purchaseCostCny");
  const saleProceeds = sum(all, "saleProceedsCny");
  const netInvested = grossBuys - saleProceeds;
  const valueCny = valuationComplete ? sum(valuedOpen, "valueCny") : NaN;
  const pnlCny = valuationComplete ? valueCny - netInvested : NaN;
  const todayCny = todayComplete ? sum(todayOpen, "todayPnlCny") : NaN;
  const yesterdayValueCny = valuationComplete && todayComplete ? valueCny - todayCny : NaN;
  const usdToNative = COST_REFERENCE_RATES.USD / (COST_REFERENCE_RATES[currency] || 1);
  const grossBuysNative = all.reduce(function (total, row) {
    const fee = Number.isFinite(row.buyFeeUsd) && row.buyFeeUsd > 0 ? row.buyFeeUsd * usdToNative : 0;
    return total + row.cost * row.qty + fee;
  }, 0);
  const saleProceedsNative = all.reduce(function (total, row) {
    if (row.status !== "sold" || !Number.isFinite(row.sellPrice)) return total;
    const fee = Number.isFinite(row.sellFeeUsd) && row.sellFeeUsd > 0 ? row.sellFeeUsd * usdToNative : 0;
    return total + row.sellPrice * row.qty - fee;
  }, 0);
  const netInvestedNative = grossBuysNative - saleProceedsNative;
  const valueNative = Number.isFinite(valueCny) ? valueCny / fx : NaN;
  return {
    market: market,
    open: open, valuationCount: valuedOpen.length, valuationTotal: open.length, todayCount: todayOpen.length, todayTotal: open.length,
    currency: currency,
    grossBuys: grossBuys,
    saleProceeds: saleProceeds,
    netInvested: netInvested,
    value: valueCny,
    today: todayCny,
    pnl: pnlCny,
    grossBuysNative: grossBuysNative,
    saleProceedsNative: saleProceedsNative,
    netInvestedNative: netInvestedNative,
    valueNative: valueNative,
    todayNative: Number.isFinite(todayCny) ? todayCny / fx : NaN,
    pnlNative: Number.isFinite(valueNative) ? valueNative - netInvestedNative : NaN,
    count: uniqueHoldingCount(open),
    weight: summary().value > 0 ? valueCny / summary().value * 100 : NaN,
    pnlRate: netInvested > 0 ? pnlCny / netInvested * 100 : NaN,
    todayRate: yesterdayValueCny > 0 ? todayCny / yesterdayValueCny * 100 : NaN
  };
}

function marketTabs(active, attribute) {
  return "<div class=\"tab-group\">" + MARKETS.map(function (market) {
    return "<button type=\"button\" class=\"" + (active === market ? "active" : "") + "\" data-" + attribute + "=\"" + market + "\">" + market + (market === "全部" ? "" : " <small>" + marketSummary(market).count + "</small>") + "</button>";
  }).join("") + "</div>";
}

function navIcon(name) {
  const icons = {
    overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.75h6.25V11H4zM13.75 4.75H20V11h-6.25zM4 14h6.25v5.25H4zM13.75 14H20v5.25h-6.25z"/></svg>',
    actions: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.25 7.5h15.5v11.25H4.25zM8.25 7.5V5.25h7.5V7.5M4.25 12.25h15.5M9.5 12.25v2h5v-2"/></svg>',
    radar: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.25"/><circle cx="12" cy="12" r="4.25"/><path d="M12 12l5.75-5.75M12 3.75V2.5M20.25 12h1.25"/><circle cx="17.75" cy="6.25" r="1.25" class="nav-icon-dot"/></svg>',
    trades: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.25 4.25h9.5v15.5h-9.5zM8.25 8h3.5M8.25 11.5h3.5M8.25 15h2.25M14.75 8.5h4M17.25 6l2.5 2.5-2.5 2.5"/></svg>'
  };
  return '<span class="nav-icon">' + icons[name] + '</span>';
}

function headerActionIcon(name) {
  if (name === "edit") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h4l10.2-10.2a2.15 2.15 0 0 0-3-3L5.5 16.5l-1 3Z"/><path d="m14.7 7.3 3 3M12 19.5h7.5"/></svg>';
  if (name === "logout") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 5H5.75v14h4.75M14.5 8l4 4-4 4M8.5 12h10"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 8.1A8 8 0 1 0 20 14"/><path d="M19.5 3.8v4.8h-4.8"/></svg>';
}

function formatUpdatedAt(date) {
  const value = date || new Date();
  const pad = function (number) { return String(number).padStart(2, "0"); };
  return value.getFullYear() + "年" + pad(value.getMonth() + 1) + "月" + pad(value.getDate()) + "日 " + pad(value.getHours()) + ":" + pad(value.getMinutes());
}

function currentPetMood() {
  if (state.isRefreshing || state.radarStatus === "loading") return "working";
  const today = Number(summary().today) || 0;
  if (today > 50) return "positive";
  if (today < -50) return "negative";
  return "neutral";
}

function petPosition(stateName, frame) {
  const definition = PET_STATES[stateName] || PET_STATES.idle;
  return {
    x: (Math.max(0, Math.min(7, frame)) * 100 / 7).toFixed(4) + "%",
    y: (definition.row * 100 / 8).toFixed(4) + "%"
  };
}

function syncBrandPet(now) {
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mood = reducedMotion ? "neutral" : currentPetMood();
  const sequence = PET_MOOD_SEQUENCES[mood] || PET_MOOD_SEQUENCES.neutral;
  if (brandVisual.mood !== mood) {
    brandVisual.mood = mood;
    brandVisual.petStateIndex = 0;
    brandVisual.petState = sequence[0];
    brandVisual.petFrame = 0;
    brandVisual.petStateStartedAt = now;
  }
  let definition = PET_STATES[brandVisual.petState] || PET_STATES.idle;
  let elapsed = Math.max(0, now - brandVisual.petStateStartedAt);
  if (!reducedMotion && elapsed >= definition.holdMs) {
    brandVisual.petStateIndex = (brandVisual.petStateIndex + 1) % sequence.length;
    brandVisual.petState = sequence[brandVisual.petStateIndex];
    brandVisual.petStateStartedAt = now;
    definition = PET_STATES[brandVisual.petState];
    elapsed = 0;
  }
  brandVisual.petFrame = reducedMotion ? 0 : Math.floor(elapsed / definition.frameMs) % definition.frames;
  const position = petPosition(brandVisual.petState, brandVisual.petFrame);
  const stage = document.querySelector(".brand-pig-stage");
  const sprite = document.querySelector(".brand-pig-sprite");
  if (stage) {
    stage.dataset.petState = brandVisual.petState;
    stage.dataset.petLabel = definition.label;
  }
  if (sprite) {
    sprite.style.setProperty("--pet-x", position.x);
    sprite.style.setProperty("--pet-y", position.y);
  }
  const brand = document.querySelector(".brand");
  if (brand) brand.setAttribute("aria-label", "猪猪存钱罐 · 小猪状态：" + definition.label + " · 返回总览");
}

function syncJarCoins() {
  document.querySelectorAll("[data-stored-coin]").forEach(function (coin) {
    const index = Number(coin.dataset.storedCoin);
    coin.classList.toggle("is-stored", index < brandVisual.coinCount);
    coin.classList.toggle("just-added", index === brandVisual.justAddedCoin);
  });
  const jar = document.querySelector(".brand-jar-stage");
  if (jar) jar.classList.toggle("is-full", brandVisual.coinCount >= BRAND_COIN_MAX);
}

function depositJarCoin() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (brandVisual.coinCount < BRAND_COIN_MAX) brandVisual.coinCount += 1;
  brandVisual.justAddedCoin = Math.max(0, brandVisual.coinCount - 1);
  syncJarCoins();
  window.clearTimeout(jarCoinSettleTimer);
  jarCoinSettleTimer = window.setTimeout(function () {
    brandVisual.justAddedCoin = -1;
    syncJarCoins();
  }, 760);
}

function scheduleJarDeposits() {
  window.clearTimeout(jarDepositTimer);
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  jarDepositTimer = window.setTimeout(function depositLoop() {
    depositJarCoin();
    jarDepositTimer = window.setTimeout(depositLoop, BRAND_MOTION_CYCLE);
  }, 4050);
}

function syncBrandVisuals() {
  syncBrandPet(Date.now());
  syncJarCoins();
}

function startBrandAnimations() {
  if (brandAnimationTimer) return;
  syncBrandVisuals();
  brandAnimationTimer = window.setInterval(syncBrandVisuals, 100);
}

function topNav() {
  const isBusy = state.isRefreshing || state.radarStatus === "loading";
  const petDefinition = PET_STATES[brandVisual.petState] || PET_STATES.idle;
  const storedCoins = Array.from({ length: BRAND_COIN_MAX }, function (_, index) {
    return "<i class=\"" + (index < brandVisual.coinCount ? "is-stored" : "") + "\" data-stored-coin=\"" + index + "\"></i>";
  }).join("");
  const updateStatus = isBusy
    ? "<span class=\"market-refresh-status\"><img src=\"assets/pig-logo.png\" alt=\"\"/>" + (state.tab === "radar" ? "小猪正在扫描机会" : "小猪正在核算行情") + "</span>"
    : "<span class=\"updated\">更新于 " + escapeHtml(state.updatedAt || "待更新") + "</span>";
  return "<header class=\"site-header\"><a class=\"brand\" href=\"#overview\" aria-label=\"猪猪存钱罐 · 小猪状态：" + escapeHtml(petDefinition.label) + " · 返回总览\"><span class=\"brand-scene\" aria-hidden=\"true\"><span class=\"brand-pig-stage\" data-pet-state=\"" + escapeHtml(brandVisual.petState) + "\" data-pet-label=\"" + escapeHtml(petDefinition.label) + "\"><span class=\"brand-pig-sprite\"></span></span><span class=\"brand-wordmark\"><strong data-text=\"猪猪存钱罐\">猪猪存钱罐</strong></span><span class=\"brand-jar-stage\"><span class=\"jar-coin-bank\">" + storedCoins + "</span><span class=\"brand-coins\"><i></i><i></i><i></i><i></i></span><img class=\"brand-jar\" src=\"assets/glass-savings-jar-v1.png\" alt=\"\"/></span></span></a><nav class=\"global-nav\" aria-label=\"主导航\">" +
    NAV_ITEMS.map(function (item) { return "<button class=\"nav-link " + (state.tab === item[0] ? "active" : "") + "\" " + (state.tab === item[0] ? "aria-current=\"page\" " : "") + "type=\"button\" data-tab=\"" + item[0] + "\">" + navIcon(item[0]) + "<span class=\"nav-label\">" + item[1] + "</span></button>"; }).join("") +
    "</nav><div class=\"header-tools\">" + updateStatus + "<div class=\"header-action-group\"><button class=\"header-action-button edit\" type=\"button\" data-open-holding-editor=\"holding\">" + headerActionIcon("edit") + "<span>修改持仓</span></button><button class=\"header-action-button refresh\" type=\"button\" data-refresh=\"1\"" + (isBusy ? " disabled aria-busy=\"true\"" : "") + ">" + headerActionIcon("refresh") + "<span>刷新</span></button><button class=\"header-action-button logout\" type=\"button\" data-logout aria-label=\"" + (state.isLoggingOut ? "正在退出登录" : "退出登录") + "\"" + (state.isLoggingOut ? " disabled aria-busy=\"true\"" : "") + ">" + headerActionIcon("logout") + "<span>" + (state.isLoggingOut ? "退出中" : "退出") + "</span></button></div></div></header>";
}

function createHoldingDraft(initialStatus) {
  return {
    market: "A股",
    code: "",
    name: "",
    sina: "",
    currency: "CNY",
    status: initialStatus === "sold" ? "sold" : "holding",
    buyPrice: "",
    buyQty: "",
    sellPrice: "",
    sellQty: ""
  };
}

function openHoldingEditor(initialStatus) {
  state.holdingDraft = createHoldingDraft(initialStatus);
  state.holdingLookup = { status: "idle", message: "输入股票代码后自动识别名称", security: null };
  state.holdingSave = { status: "idle", message: "" };
  state.holdingEditorOpen = true;
  render();
  window.requestAnimationFrame(function () {
    const input = document.querySelector("#holding-code-input");
    if (input) input.focus();
  });
}

function closeHoldingEditor() {
  if (state.holdingSave && state.holdingSave.status === "syncing") return;
  window.clearTimeout(holdingLookupTimer);
  if (holdingLookupController) holdingLookupController.abort();
  holdingLookupController = null;
  state.holdingEditorOpen = false;
  state.holdingDraft = null;
  state.holdingLookup = { status: "idle", message: "", security: null };
  state.holdingSave = { status: "idle", message: "" };
  render();
  window.requestAnimationFrame(function () {
    const trigger = document.querySelector("[data-open-holding-editor]");
    if (trigger) trigger.focus();
  });
}

function holdingEditorModal() {
  if (!state.holdingEditorOpen || !state.holdingDraft) return "";
  const draft = state.holdingDraft;
  const lookup = state.holdingLookup || { status: "idle", message: "", security: null };
  const isSold = draft.status === "sold";
  const currency = currencyForMarket(draft.market);
  const currencyLabel = currency === "CNY" ? "人民币 CNY" : currency === "HKD" ? "港币 HKD" : "美元 USD";
  const security = lookup.security;
  const saving = state.holdingSave || { status: "idle", message: "" };
  const isSyncing = saving.status === "syncing";
  const saveLabel = isSyncing ? "正在同步 GitHub…" : saving.status === "error" ? "重试同步" : "保存并同步";
  const saveDisabled = lookup.status !== "success" || isSyncing;
  const resultCard = security
    ? "<div class=\"lookup-result-card\" data-lookup-card><span class=\"lookup-result-mark\">✓</span><div><strong data-lookup-name>" + escapeHtml(security.name) + "</strong><small data-lookup-meta>" + escapeHtml(security.code + " · " + currencyLabel + (security.existing ? " · 已有持仓，将更新" : "")) + "</small></div>" + (Number.isFinite(security.price) ? "<b>现价 " + nativeMoney(security.price, security.currency) + "</b>" : "") + "</div>"
    : "<div class=\"lookup-result-card\" data-lookup-card hidden><span class=\"lookup-result-mark\">✓</span><div><strong data-lookup-name></strong><small data-lookup-meta></small></div></div>";
  return "<div class=\"holding-modal-layer\"><button class=\"holding-modal-backdrop\" type=\"button\" data-close-holding-editor aria-label=\"关闭修改持仓\"" + (isSyncing ? " disabled" : "") + "></button><section class=\"holding-editor-dialog" + (isSyncing ? " is-syncing" : "") + "\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"holding-editor-title\"><header class=\"holding-editor-head\"><div><span>PORTFOLIO ENTRY</span><h2 id=\"holding-editor-title\">修改持仓</h2><p>只填市场、代码、状态、价格和数量；名称、币种与行情代码自动识别。</p></div><button class=\"holding-modal-close\" type=\"button\" data-close-holding-editor aria-label=\"关闭\"" + (isSyncing ? " disabled" : "") + ">×</button></header><form id=\"holding-editor-form\" novalidate aria-busy=\"" + (isSyncing ? "true" : "false") + "\"><fieldset class=\"holding-fieldset\"><legend>1. 选择市场</legend><div class=\"holding-choice-grid market-choice\">" + ["A股", "港股", "美股"].map(function (market) { return "<label><input type=\"radio\" name=\"market\" value=\"" + market + "\"" + (draft.market === market ? " checked" : "") + (isSyncing ? " disabled" : "") + "/><span>" + market + "</span></label>"; }).join("") + "</div></fieldset><fieldset class=\"holding-fieldset\"><legend>2. 输入股票代码</legend><label class=\"holding-code-field\"><span>股票代码</span><div><input id=\"holding-code-input\" name=\"code\" value=\"" + escapeHtml(draft.code) + "\" placeholder=\"例如 601138 / 1810 / NVDA\" autocomplete=\"off\" autocapitalize=\"characters\" spellcheck=\"false\"" + (isSyncing ? " disabled" : "") + "/><button type=\"button\" data-retry-holding-lookup" + (isSyncing ? " disabled" : "") + ">识别</button></div></label><p class=\"holding-lookup-status " + escapeHtml(lookup.status) + "\" data-lookup-status aria-live=\"polite\">" + escapeHtml(lookup.message) + "</p>" + resultCard + "</fieldset><fieldset class=\"holding-fieldset\"><legend>3. 选择持仓状态</legend><div class=\"holding-choice-grid status-choice\"><label><input type=\"radio\" name=\"status\" value=\"holding\"" + (!isSold ? " checked" : "") + (isSyncing ? " disabled" : "") + "/><span><b>持有中</b><small>仍在组合里</small></span></label><label><input type=\"radio\" name=\"status\" value=\"sold\"" + (isSold ? " checked" : "") + (isSyncing ? " disabled" : "") + "/><span><b>已卖出</b><small>计入已实现盈亏</small></span></label></div></fieldset><fieldset class=\"holding-fieldset\"><legend>4. 填写买入信息</legend><div class=\"holding-number-grid\"><label><span>买入价格 <small data-currency-label>" + currency + "</small></span><input name=\"buyPrice\" type=\"number\" min=\"0\" step=\"0.0001\" inputmode=\"decimal\" value=\"" + escapeHtml(draft.buyPrice) + "\" placeholder=\"0.00\"" + (isSyncing ? " disabled" : "") + "/></label><label><span>买入数量</span><input name=\"buyQty\" type=\"number\" min=\"0\" step=\"any\" inputmode=\"decimal\" value=\"" + escapeHtml(draft.buyQty) + "\" placeholder=\"0\"" + (isSyncing ? " disabled" : "") + "/></label></div></fieldset><fieldset class=\"holding-fieldset sold-fields\" data-sold-fields" + (isSold ? "" : " hidden") + "><legend>5. 填写卖出信息</legend><div class=\"holding-number-grid\"><label><span>卖出价格 <small data-currency-label>" + currency + "</small></span><input name=\"sellPrice\" type=\"number\" min=\"0\" step=\"0.0001\" inputmode=\"decimal\" value=\"" + escapeHtml(draft.sellPrice) + "\" placeholder=\"0.00\"" + (isSold ? " required" : "") + (isSyncing ? " disabled" : "") + "/></label><label><span>卖出数量</span><input name=\"sellQty\" type=\"number\" min=\"0\" step=\"any\" inputmode=\"decimal\" value=\"" + escapeHtml(draft.sellQty) + "\" placeholder=\"0\"" + (isSold ? " required" : "") + (isSyncing ? " disabled" : "") + "/></label></div></fieldset><aside class=\"holding-fee-card\"><div><span>买入手续费</span><strong>US$20</strong></div><i>+</i><div class=\"sell-fee-item\"" + (isSold ? "" : " hidden") + "><span>卖出手续费</span><strong>US$20</strong></div><p>系统自动折算并计入盈亏，无需手工填写币种、名称或行情代码。</p></aside><div class=\"github-sync-note\"><span class=\"github-sync-dot\"></span><div><strong>直接写入 GitHub holdings.json</strong><small>GitHub 确认成功后，本机页面才会更新；失败时保留当前表单。</small></div></div><p class=\"holding-form-error\" data-holding-form-error aria-live=\"assertive\">" + escapeHtml(saving.message || "") + "</p><footer class=\"holding-editor-actions\"><button type=\"button\" data-close-holding-editor" + (isSyncing ? " disabled" : "") + ">取消</button><button class=\"save-holding-button\" type=\"submit\"" + (saveDisabled ? " disabled" : "") + ">" + saveLabel + "</button></footer></form></section></div>";
}

function setHoldingLookup(status, message, security) {
  state.holdingLookup = { status: status, message: message, security: security || null };
  syncHoldingLookupUi();
}

function syncHoldingLookupUi() {
  const lookup = state.holdingLookup || {};
  const status = document.querySelector("[data-lookup-status]");
  if (status) {
    status.className = "holding-lookup-status " + (lookup.status || "idle");
    status.textContent = lookup.message || "";
  }
  const card = document.querySelector("[data-lookup-card]");
  if (card) {
    card.hidden = !lookup.security;
    const name = card.querySelector("[data-lookup-name]");
    const meta = card.querySelector("[data-lookup-meta]");
    if (name) name.textContent = lookup.security ? lookup.security.name : "";
    if (meta) meta.textContent = lookup.security ? lookup.security.code + " · " + lookup.security.currency + (lookup.security.existing ? " · 已有持仓，将更新" : "") : "";
  }
  const save = document.querySelector(".save-holding-button");
  if (save) save.disabled = lookup.status !== "success";
}

function syncHoldingFormUi() {
  if (!state.holdingDraft) return;
  const sold = state.holdingDraft.status === "sold";
  const soldFields = document.querySelector("[data-sold-fields]");
  if (soldFields) soldFields.hidden = !sold;
  document.querySelectorAll("[data-sold-fields] input").forEach(function (input) { input.required = sold; });
  const sellFee = document.querySelector(".sell-fee-item");
  if (sellFee) sellFee.hidden = !sold;
  const currency = currencyForMarket(state.holdingDraft.market);
  document.querySelectorAll("[data-currency-label]").forEach(function (label) { label.textContent = currency; });
  syncHoldingLookupUi();
}

function comparableCode(value) {
  return String(value || "").trim().toUpperCase().replace(/^\$/, "").replace(/^(SH|SZ|BJ|HK|US)[:.]?/, "").replace(/\.(SH|SZ|BJ|HK|US)$/, "").replace(/^0+(?=\d)/, "");
}

function localHoldingMatch(market, code) {
  const target = comparableCode(code);
  return state.holdings.find(function (item) { return item.market === market && comparableCode(item.code) === target; }) || null;
}

function applyResolvedSecurity(security) {
  const existing = state.holdings.find(function (item) { return item.status !== "sold" && item.sina === security.sina; }) || localHoldingMatch(security.market, security.code);
  const resolved = Object.assign({}, security, { existing: Boolean(existing) });
  state.holdingDraft.code = security.code;
  state.holdingDraft.name = security.name;
  state.holdingDraft.sina = security.sina;
  state.holdingDraft.currency = security.currency;
  if (existing) {
    if (!state.holdingDraft.buyPrice) state.holdingDraft.buyPrice = String(existing.cost);
    if (!state.holdingDraft.buyQty) state.holdingDraft.buyQty = String(existing.qty);
  }
  const codeInput = document.querySelector("#holding-code-input");
  const buyPrice = document.querySelector("[name=\"buyPrice\"]");
  const buyQty = document.querySelector("[name=\"buyQty\"]");
  if (codeInput) codeInput.value = security.code;
  if (buyPrice) buyPrice.value = state.holdingDraft.buyPrice;
  if (buyQty) buyQty.value = state.holdingDraft.buyQty;
  setHoldingLookup("success", existing ? "已识别，并找到现有持仓" : "股票名称识别成功", resolved);
}

async function resolveHoldingCode() {
  if (!state.holdingDraft) return;
  const market = state.holdingDraft.market;
  const code = String(state.holdingDraft.code || "").trim();
  if (!code) { setHoldingLookup("idle", "输入股票代码后自动识别名称", null); return; }
  const local = localHoldingMatch(market, code);
  if (local) {
    const quote = state.quotes.get(local.sina);
    applyResolvedSecurity({ market: local.market, code: local.code, name: local.name, sina: local.sina, currency: local.currency, price: quoteHasRecentPrice(local.sina, quote) ? Number(quote.price) : null });
    return;
  }
  if (holdingLookupController) holdingLookupController.abort();
  holdingLookupController = new AbortController();
  const requestMarket = market;
  const requestCode = code;
  setHoldingLookup("loading", "正在识别股票名称…", null);
  try {
    const response = await fetch("/api/security-lookup?market=" + encodeURIComponent(requestMarket) + "&code=" + encodeURIComponent(requestCode), { cache: "no-store", signal: holdingLookupController.signal });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok || !payload.security) throw new Error(payload.error || "没有识别到这只股票");
    if (!state.holdingDraft || state.holdingDraft.market !== requestMarket || state.holdingDraft.code !== requestCode) return;
    applyResolvedSecurity(payload.security);
  } catch (error) {
    if (error.name === "AbortError") return;
    if (!state.holdingDraft || state.holdingDraft.market !== requestMarket || state.holdingDraft.code !== requestCode) return;
    setHoldingLookup("error", error.message || "识别失败，请检查代码后重试", null);
  }
}

function scheduleHoldingLookup(immediate) {
  window.clearTimeout(holdingLookupTimer);
  holdingLookupTimer = window.setTimeout(resolveHoldingCode, immediate ? 0 : 480);
}

function localDateString(date) {
  const value = date || new Date();
  const pad = function (number) { return String(number).padStart(2, "0"); };
  return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate());
}

function setHoldingFormError(message) {
  const error = document.querySelector("[data-holding-form-error]");
  if (error) error.textContent = message || "";
}

function showToast(message, kind) {
  state.toast = { message: message, kind: kind || "success" };
  render();
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () {
    state.toast = null;
    const toast = document.querySelector(".site-toast");
    if (toast) toast.remove();
  }, 3200);
}

function toastMarkup() {
  if (!state.toast) return "";
  return "<div class=\"site-toast " + escapeHtml(state.toast.kind) + "\" role=\"status\"><span>" + (state.toast.kind === "success" ? "✓" : "!") + "</span>" + escapeHtml(state.toast.message) + "</div>";
}

async function logoutUser() {
  if (state.isLoggingOut) return;
  state.isLoggingOut = true;
  render();
  try {
    const response = await fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json" }
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.error || "退出失败，请稍后重试");
    location.assign("/login");
  } catch (error) {
    state.isLoggingOut = false;
    showToast(error.message || "退出失败，请稍后重试", "error");
  }
}

function holdingRecordFor(draft, security, status, qty, buyFeeUsd) {
  const fx = COST_REFERENCE_RATES[security.currency] || 1;
  return {
    market: security.market,
    code: security.code,
    name: security.name,
    status: status,
    cost: Number(draft.buyPrice),
    qty: qty,
    currency: security.currency,
    sina: security.sina,
    purchaseCostCny: Number(draft.buyPrice) * qty * fx + buyFeeUsd * COST_REFERENCE_RATES.USD,
    buyFeeUsd: buyFeeUsd,
    sellPrice: NaN,
    sellDate: ""
  };
}

async function syncHoldingsToGitHubClient(nextHoldings) {
  const controller = new AbortController();
  const timeout = window.setTimeout(function () { controller.abort(); }, 15000);
  try {
    const response = await fetch("/api/holdings-sync", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ holdings: nextHoldings }),
      signal: controller.signal
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const error = new Error(payload.error || "GitHub 同步失败");
      error.status = response.status;
      throw error;
    }
    if (payload.ok !== true || !(payload.commitSha || payload.fileSha || payload.alreadyCurrent)) throw new Error("GitHub 没有返回写入确认，请重试");
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("同步等待超时，尚未确认是否写入 GitHub；请重新打开后核对");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function saveHoldingEditor() {
  if (state.holdingSave && state.holdingSave.status === "syncing") return;
  const draft = state.holdingDraft;
  const security = state.holdingLookup && state.holdingLookup.security;
  if (!draft || !security || state.holdingLookup.status !== "success") { setHoldingFormError("请先完成股票代码识别"); return; }
  const buyPrice = Number(draft.buyPrice);
  const buyQty = Number(draft.buyQty);
  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(buyQty) || buyQty <= 0) { setHoldingFormError("请填写正确的买入价格和买入数量"); return; }
  const isSold = draft.status === "sold";
  const sellPrice = Number(draft.sellPrice);
  const sellQty = Number(draft.sellQty);
  if (isSold && (!Number.isFinite(sellPrice) || sellPrice <= 0 || !Number.isFinite(sellQty) || sellQty <= 0)) { setHoldingFormError("已卖出记录需要填写卖出价格和卖出数量"); return; }
  if (isSold && sellQty > buyQty) { setHoldingFormError("卖出数量不能大于买入数量"); return; }

  const preserved = state.holdings.filter(function (item) { return item.status === "sold" || item.sina !== security.sina; });
  const records = [];
  if (!isSold) {
    records.push(holdingRecordFor(draft, security, "holding", buyQty, FIXED_TRADE_FEE_USD));
  } else {
    const soldRatio = sellQty / buyQty;
    const soldRecord = holdingRecordFor(draft, security, "sold", sellQty, FIXED_TRADE_FEE_USD * soldRatio);
    soldRecord.sellPrice = sellPrice;
    soldRecord.sellDate = localDateString();
    soldRecord.sellFeeUsd = FIXED_TRADE_FEE_USD;
    soldRecord.sellProceedsCny = sellPrice * sellQty * (COST_REFERENCE_RATES[security.currency] || 1) - FIXED_TRADE_FEE_USD * COST_REFERENCE_RATES.USD;
    records.push(soldRecord);
    const remainingQty = buyQty - sellQty;
    if (remainingQty > 0) records.unshift(holdingRecordFor(draft, security, "holding", remainingQty, FIXED_TRADE_FEE_USD * (remainingQty / buyQty)));
  }
  const nextHoldings = preserved.concat(records).map(normalizeHolding).filter(isValidHolding);
  state.holdingSave = { status: "syncing", message: "正在等待 GitHub 写入确认…" };
  render();
  try {
    const result = await syncHoldingsToGitHubClient(nextHoldings);
    state.holdings = nextHoldings;
    writeStorage(HOLDING_KEY, state.holdings);
    rebuildRows();
    state.holdingEditorOpen = false;
    state.holdingDraft = null;
    state.holdingLookup = { status: "idle", message: "", security: null };
    state.holdingSave = { status: "idle", message: "" };
    const confirmation = result.commitSha || result.fileSha || "";
    state.toast = { message: "已写入 GitHub holdings.json" + (confirmation ? " · " + confirmation.slice(0, 7) : ""), kind: "success" };
    render();
    refreshData();
  } catch (error) {
    state.holdingSave = { status: "error", message: error.message || "GitHub 同步失败，本次未保存" };
    render();
  }
}

function overviewPage() {
  const data = summary();
  const valuationComplete = data.valuationCount === data.valuationTotal;
  const todayComplete = data.todayCount === data.todayTotal;
  const valuationNote = valuationComplete ? "当前持仓按最新或最近有效行情与汇率折算" : "估值不完整：" + data.valuationCount + "/" + data.valuationTotal + "个持仓有有效价格";
  const todayNote = todayComplete ? "当日价差 × 当前持仓数量" : "当日行情不完整：" + data.todayCount + "/" + data.todayTotal + "个持仓有有效涨跌";
  return "<main class=\"page-shell overview-page\">" +
    "<section class=\"overview-section account-overview-section\"><div class=\"overview-section-heading account-section-heading\"><div><h1>账户整体</h1></div>" + fxStatusLine() + "</div>" +
    "<div class=\"account-metric-grid\">" +
    overviewMetric("股票总投入（人民币）", money(data.netInvested, 0), data.netInvested !== 0 ? "资金基准 100%" : "暂无投入", "买入 " + money(data.grossBuyPrincipal, 0) + " − 卖出 " + money(data.grossSaleAmount, 0) + " + 手续费 " + money(data.totalFees, 0), "neutral", METRIC_HELP.netInvested) +
    overviewMetric("持仓市值（人民币）", money(data.value, 0), data.netInvested > 0 && Number.isFinite(data.value) ? "占总投入 " + ratioPct(data.value / data.netInvested * 100) : "占总投入 --", valuationNote, "neutral", METRIC_HELP.marketValue) +
    overviewMetric("累计盈亏（人民币）", signed(data.totalPnl, 0), pct(data.totalRate), valuationComplete ? "持仓市值 − 股票总投入" : "等待全部持仓完成估值后计算", tone(data.totalPnl), METRIC_HELP.totalPnl) +
    overviewMetric("今日盈亏（人民币）", signed(data.today, 0), pct(data.todayRate), todayNote, tone(data.today), METRIC_HELP.todayPnl) +
    "</div><p class=\"fee-policy-note\">港美持仓市值与今日盈亏按最新汇率折算，历史买卖成本按记录或参考汇率固定；每笔买入和卖出各计 US$20 手续费。</p></section>" +
    "<section class=\"overview-section market-overview-section\"><div class=\"overview-section-heading\"><div><h2>市场概览</h2></div><p>市值与今日按最新汇率，投入按历史成本，累计盈亏包含汇兑影响。</p></div><div class=\"overview-market-grid\">" + MARKET_ORDER.map(marketBlock).join("") + "</div></section>" +
    "<section class=\"overview-section pnl-chart-section\"><article class=\"card chart-card overview-chart-card\"><div class=\"chart-heading\"><div><h2>累计盈亏走势（人民币）" + infoTip(METRIC_HELP.chart) + "</h2><div class=\"chart-legend\"><span class=\"legend-item\"><i class=\"legend-dot\"></i>当前累计盈亏 <b class=\"" + tone(data.totalPnl) + "\">" + signed(data.totalPnl, 0) + "</b></span><span class=\"legend-item\"><i class=\"legend-dot blue\"></i>盈亏平衡线（¥0）</span><span class=\"chart-estimate-note\">按当前持仓回溯估算，未反映期间交易</span></div></div>" + trendButtons() + "</div><div class=\"canvas-wrap overview-canvas-wrap\"><canvas class=\"line-chart\" data-chart=\"portfolio\" tabindex=\"0\" aria-label=\"" + state.trendDays + "日累计盈亏走势图；可触摸或使用左右方向键查看数据点\"></canvas></div></article></section>" +
    "<section class=\"overview-section ranking-section\"><div class=\"card overview-ranking-card\">" + rankCard() + "</div></section></main>";
}

function infoTip(text) {
  return "<span class=\"info-tip\" tabindex=\"0\" aria-label=\"查看指标说明\"><span class=\"info-icon\" aria-hidden=\"true\">i</span><span class=\"info-popover\" role=\"tooltip\">" + escapeHtml(text) + "</span></span>";
}

function overviewMetric(label, value, rate, formula, valueTone, helpText) {
  return "<article class=\"card account-metric-card\"><span class=\"metric-label\">" + label + (helpText ? infoTip(helpText) : "") + "</span><div class=\"account-metric-main\"><strong class=\"metric-value " + valueTone + "\">" + value + "</strong><span class=\"account-metric-rate " + valueTone + "\">" + rate + "</span></div><p>" + formula + "</p></article>";
}

function fxStatusLine() {
  const meta = state.fxMeta || {};
  const fetched = meta.fetchedAt ? new Date(meta.fetchedAt) : null;
  const fetchedText = fetched && Number.isFinite(fetched.getTime()) ? formatUpdatedAt(fetched) : "尚未刷新";
  const sourceText = meta.fallback ? "参考汇率" : "最新汇率";
  const asOfText = meta.asOf ? "汇率数据 " + escapeHtml(meta.asOf) : escapeHtml(meta.source || "固定参考汇率");
  return "<div class=\"fx-status-line " + (meta.fallback ? "is-fallback" : "is-fresh") + "\"><span class=\"fx-status-badge\">" + sourceText + "</span><div class=\"fx-rate-values\"><b>1 USD = ¥" + Number(state.rates.USD || 0).toFixed(4) + "</b><b>1 HKD = ¥" + Number(state.rates.HKD || 0).toFixed(4) + "</b><span>" + asOfText + " · 更新于 " + fetchedText + "</span></div></div>";
}

function trendButtons() {
  return "<div class=\"segmented trend-segmented\" aria-label=\"走势图时间范围\">" + [7, 30, 90].map(function (days) {
    const active = state.trendDays === days;
    return "<button class=\"" + (active ? "active" : "") + "\" type=\"button\" data-trend-days=\"" + days + "\" aria-pressed=\"" + active + "\">" + days + "天</button>";
  }).join("") + "</div>";
}

function marketBlock(market) {
  const data = marketSummary(market);
  const coverage = data.valuationCount === data.valuationTotal ? "" : " · 估值 " + data.valuationCount + "/" + data.valuationTotal;
  return "<article class=\"card overview-market-card " + (data.currency === "CNY" ? "is-cny" : "is-foreign") + "\"><header><div>" + marketLabel(market) + "<strong>" + market + "</strong></div><span>" + data.count + " 只持仓 · 占组合 " + ratioPct(data.weight, 1) + coverage + "</span></header><div class=\"overview-market-table\">" +
    marketDataRow("股票总投入", data.netInvestedNative, data.currency, data.netInvested, false, data.netInvested > 0 ? "资金基准" : "暂无投入", "cost") +
    marketDataRow("持仓市值", data.valueNative, data.currency, data.value, false, "占组合 " + ratioPct(data.weight, 1), "latest") +
    marketDataRow("累计盈亏", data.pnlNative, data.currency, data.pnl, true, pct(data.pnlRate), "accounting") +
    marketDataRow("今日盈亏", data.todayNative, data.currency, data.today, true, pct(data.todayRate), "latest") +
    "<div class=\"market-data-row count-row\"><span>持仓数量</span><b>" + data.count + " 只</b><small>当前持有的去重标的</small></div></div></article>";
}

function marketDataRow(label, nativeValue, currency, cnyValue, signedValue, rate, cnyMode) {
  const nativeTone = signedValue ? tone(nativeValue) : "neutral";
  const cnyTone = signedValue ? tone(cnyValue) : "neutral";
  const nativeText = signedValue ? signedNative(nativeValue, currency) : nativeMoney(nativeValue, currency);
  const cnyText = signedValue ? signed(cnyValue, 0) : money(cnyValue, 0);
  const cnyLabel = currency === "CNY" ? "人民币" : cnyMode === "cost" ? "成本 " + cnyText : cnyMode === "accounting" ? "含汇兑 " + cnyText : "≈ " + cnyText;
  const cnyTitle = currency === "CNY" ? "" : cnyMode === "cost" ? " title=\"按记录或参考汇率固定的人民币成本\"" : cnyMode === "accounting" ? " title=\"人民币盈亏口径，包含汇兑影响\"" : " title=\"按最新汇率折算的人民币金额\"";
  return "<div class=\"market-data-row\"><span>" + label + "</span><b class=\"market-native " + nativeTone + "\">" + nativeText + "</b><small class=\"market-cny " + cnyTone + "\"" + cnyTitle + ">" + cnyLabel + "</small><em class=\"" + cnyTone + "\">" + rate + "</em></div>";
}

function stockRankingRows() {
  const groups = new Map();
  state.rows.forEach(function (row) {
    const key = row.market + ":" + row.code;
    const current = groups.get(key) || { market: row.market, code: row.code, name: row.name, currency: row.currency, pnlCny: 0, pnlNative: 0, purchaseCostCny: 0, hasOpen: false, valuationMissing: false };
    const referenceRate = COST_REFERENCE_RATES[row.currency] || 1;
    const usdToNative = COST_REFERENCE_RATES.USD / referenceRate;
    const nativeFees = (Number.isFinite(row.buyFeeUsd) ? row.buyFeeUsd : 0) * usdToNative + (row.status === "sold" && Number.isFinite(row.sellFeeUsd) ? row.sellFeeUsd * usdToNative : 0);
    const nativePnl = row.status === "sold" ? (row.sellPrice - row.cost) * row.qty - nativeFees : Number.isFinite(row.price) && Number.isFinite(row.pnlCny) ? (row.price - row.cost) * row.qty - nativeFees : NaN;
    current.name = row.name || current.name;
    if (Number.isFinite(row.pnlCny)) current.pnlCny += row.pnlCny;
    else if (row.status !== "sold") current.valuationMissing = true;
    if (Number.isFinite(nativePnl)) current.pnlNative += nativePnl;
    else if (row.status !== "sold") current.valuationMissing = true;
    current.purchaseCostCny += row.purchaseCostCny;
    current.hasOpen = current.hasOpen || row.status !== "sold";
    groups.set(key, current);
  });
  return Array.from(groups.values()).map(function (row) {
    if (row.valuationMissing) {
      row.pnlCny = NaN;
      row.pnlNative = NaN;
    }
    row.pnlRate = !row.valuationMissing && row.purchaseCostCny > 0 ? row.pnlCny / row.purchaseCostCny * 100 : NaN;
    return row;
  }).filter(function (row) { return state.rankMarket === "全部" || row.market === state.rankMarket; });
}

function rankingPanel(rows, mode) {
  const title = mode === "profit" ? "盈利前五" : "亏损前五";
  const maxValue = Math.max.apply(null, rows.map(function (row) { return Math.abs(row.pnlCny); }).concat([1]));
  return "<section class=\"ranking-panel " + mode + " " + (state.rankMode === mode ? "is-active" : "") + "\"><h3>" + title + "</h3>" + (rows.length ? "<div class=\"ranking-list\">" + rows.map(function (row, index) {
    const width = Math.max(7, Math.abs(row.pnlCny) / maxValue * 100);
    return "<article class=\"ranking-row\"><b class=\"ranking-number\">" + (index + 1) + "</b><div class=\"ranking-security\"><div>" + marketLabel(row.market) + "<strong>" + escapeHtml(row.name) + "</strong></div><small>" + escapeHtml(row.code) + " · " + (row.hasOpen ? "持有中" : "已清仓") + "</small></div><div class=\"ranking-native " + tone(row.pnlNative) + "\">" + signedNative(row.pnlNative, row.currency) + "<small>原币</small></div><div class=\"ranking-cny " + tone(row.pnlCny) + "\">" + signed(row.pnlCny, 0) + "<small>" + pct(row.pnlRate) + "</small></div><div class=\"ranking-bar\"><i style=\"width:" + width.toFixed(1) + "%\"></i></div></article>";
  }).join("") + "</div>" : "<p class=\"empty ranking-empty\">暂无" + (mode === "profit" ? "盈利" : "亏损") + "数据。</p>") + "</section>";
}

function rankCard() {
  const rows = stockRankingRows();
  const pendingCount = rows.filter(function (row) { return row.valuationMissing || !Number.isFinite(row.pnlCny); }).length;
  const profitRows = rows.filter(function (row) { return Number.isFinite(row.pnlCny) && row.pnlCny > 0; }).sort(function (a, b) { return b.pnlCny - a.pnlCny; }).slice(0, 5);
  const lossRows = rows.filter(function (row) { return Number.isFinite(row.pnlCny) && row.pnlCny < 0; }).sort(function (a, b) { return a.pnlCny - b.pnlCny; }).slice(0, 5);
  const markets = ["全部", "港股", "A股", "美股"];
  return "<div class=\"ranking-heading\"><div><h2>个股盈亏排行</h2><p>同一股票的持仓与已卖出批次合并计算。" + (pendingCount ? " <b class=\"ranking-pending\">另有 " + pendingCount + " 只待估值，暂不进入排行。</b>" : "") + "</p></div><div class=\"ranking-controls\"><div class=\"ranking-market-tabs\" aria-label=\"排行市场筛选\">" + markets.map(function (market) {
    const active = state.rankMarket === market;
    return "<button type=\"button\" data-rank-market=\"" + market + "\" class=\"" + (active ? "active" : "") + "\" aria-pressed=\"" + active + "\">" + (market === "全部" ? "总体" : market) + "</button>";
  }).join("") + "</div><div class=\"segmented ranking-mode-tabs\"><button class=\"" + (state.rankMode === "profit" ? "active" : "") + "\" type=\"button\" data-rank-mode=\"profit\" aria-pressed=\"" + (state.rankMode === "profit") + "\">盈利榜</button><button class=\"" + (state.rankMode === "loss" ? "active" : "") + "\" type=\"button\" data-rank-mode=\"loss\" aria-pressed=\"" + (state.rankMode === "loss") + "\">亏损榜</button></div></div></div><div class=\"ranking-columns\">" + rankingPanel(profitRows, "profit") + rankingPanel(lossRows, "loss") + "</div>";
}

function openSecurityRows() {
  const groups = new Map();
  state.rows.filter(function (row) { return row.status !== "sold"; }).forEach(function (row, index) {
    const key = row.market + ":" + (row.sina || row.code);
    if (!groups.has(key)) {
      groups.set(key, Object.assign({}, row, {
        holdingKey: key, lots: [], qty: 0, purchaseCostCny: 0, valueCny: 0,
        pnlCny: 0, pnlNative: 0, todayPnlCny: 0, todayPnlNative: 0, nativeCostTotal: 0, nativeTotalCost: 0,
        buyFeeUsd: 0, valuationLotCount: 0, todayQuoteLotCount: 0,
        hasValuation: false, hasLivePrice: false, hasTodayQuote: false, firstIndex: index
      }));
    }
    const group = groups.get(key);
    group.lots.push(row);
    group.qty += Number(row.qty) || 0;
    group.purchaseCostCny += Number(row.purchaseCostCny) || 0;
    if (Number.isFinite(Number(row.valueCny)) && Number.isFinite(Number(row.pnlCny))) {
      group.valueCny += Number(row.valueCny);
      group.valuationLotCount += 1;
    }
    if (Number.isFinite(Number(row.pnlCny))) group.pnlCny += Number(row.pnlCny);
    if (Number.isFinite(Number(row.todayPnlCny))) group.todayPnlCny += Number(row.todayPnlCny);
    group.nativeCostTotal += (Number(row.cost) || 0) * (Number(row.qty) || 0);
    group.buyFeeUsd += Number(row.buyFeeUsd) || 0;
    const rowHasLivePrice = row.hasLivePrice === undefined ? Number(row.quote && row.quote.price) > 0 : Boolean(row.hasLivePrice);
    const rowHasTodayQuote = row.hasTodayQuote === undefined
      ? rowHasLivePrice && Number.isFinite(Number(row.quote && row.quote.change)) && Number.isFinite(Number(row.quote && row.quote.changePct))
      : Boolean(row.hasTodayQuote);
    if (rowHasTodayQuote && Number.isFinite(Number(row.quote && row.quote.change))) {
      group.todayPnlNative += Number(row.quote.change) * (Number(row.qty) || 0);
      group.todayQuoteLotCount += 1;
    }
    const rowPriceSource = row.priceSource || (rowHasLivePrice ? "quote" : row.history && row.history.length ? "history" : "cost");
    group.hasLivePrice = group.hasLivePrice || rowHasLivePrice;
    group.hasTodayQuote = group.hasTodayQuote || rowHasTodayQuote;
    if (rowPriceSource === "quote" || group.priceSource !== "quote" && rowPriceSource === "history") group.priceSource = rowPriceSource;
    if ((row.history || []).length > (group.history || []).length) group.history = row.history;
    if (row.quote) group.quote = row.quote;
    if (Number.isFinite(row.price) && row.price > 0) group.price = row.price;
  });
  const rows = Array.from(groups.values()).map(function (row) {
    row.hasValuation = row.lots.length > 0 && row.valuationLotCount === row.lots.length;
    row.hasTodayQuote = row.lots.length > 0 && row.todayQuoteLotCount === row.lots.length;
    row.cost = row.qty > 0 ? row.nativeCostTotal / row.qty : NaN;
    row.nativeTotalCost = row.nativeCostTotal + row.buyFeeUsd * COST_REFERENCE_RATES.USD / (COST_REFERENCE_RATES[row.currency] || 1);
    row.pnlNative = row.hasValuation && Number.isFinite(Number(row.price))
      ? Number(row.price) * row.qty - row.nativeTotalCost
      : NaN;
    if (!row.hasValuation) {
      row.valueCny = NaN;
      row.pnlCny = NaN;
    }
    row.pnlRate = row.purchaseCostCny > 0 ? row.pnlCny / row.purchaseCostCny * 100 : NaN;
    row.changePct = Number(row.quote && row.quote.changePct);
    if (!Number.isFinite(row.changePct)) row.changePct = NaN;
    if (!row.hasTodayQuote) {
      row.todayPnlCny = NaN;
      row.todayPnlNative = NaN;
      row.changePct = NaN;
    }
    return row;
  });
  const total = sum(rows.filter(function (row) { return Number.isFinite(Number(row.valueCny)); }), "valueCny");
  rows.forEach(function (row) { row.holdingPct = Number.isFinite(Number(row.valueCny)) && total > 0 ? row.valueCny / total * 100 : NaN; });
  return rows.sort(function (a, b) { return a.firstIndex - b.firstIndex; });
}

function holdingSnapshot(rows) {
  const valuedRows = rows.filter(function (row) { return row.hasValuation && Number.isFinite(Number(row.valueCny)); });
  const valuationComplete = rows.length > 0 && valuedRows.length === rows.length;
  const value = valuationComplete ? sum(valuedRows, "valueCny") : NaN;
  const cost = valuationComplete ? sum(valuedRows, "purchaseCostCny") : NaN;
  const pnl = valuationComplete ? sum(valuedRows, "pnlCny") : NaN;
  const todayRows = rows.filter(function (row) { return row.hasTodayQuote && Number.isFinite(Number(row.todayPnlCny)); });
  const todayComplete = rows.length > 0 && todayRows.length === rows.length;
  const today = todayComplete ? sum(todayRows, "todayPnlCny") : NaN;
  const yesterdayValue = todayComplete ? sum(todayRows, "valueCny") - today : NaN;
  function todayDistributionValue(row) {
    const nativeValue = Number(row.todayPnlNative);
    const value = Number.isFinite(nativeValue) ? nativeValue : Number(row.todayPnlCny);
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
  }
  return {
    count: rows.length, value: value, valuedCount: valuedRows.length, today: today, pnl: pnl,
    todayCount: todayRows.length,
    todayRate: yesterdayValue > 0 ? today / yesterdayValue * 100 : NaN,
    pnlRate: cost > 0 ? pnl / cost * 100 : NaN,
    profitCount: rows.filter(function (row) { return row.pnlCny > 0; }).length,
    lossCount: rows.filter(function (row) { return row.pnlCny < 0; }).length,
    flatCount: rows.filter(function (row) { return Number.isFinite(Number(row.pnlCny)) && row.pnlCny === 0; }).length,
    unavailableCount: rows.filter(function (row) { return !Number.isFinite(Number(row.pnlCny)); }).length,
    todayProfitCount: todayRows.filter(function (row) { return todayDistributionValue(row) > 0; }).length,
    todayLossCount: todayRows.filter(function (row) { return todayDistributionValue(row) < 0; }).length,
    todayFlatCount: todayRows.filter(function (row) { return todayDistributionValue(row) === 0; }).length,
    todayUnavailableCount: rows.length - todayRows.length
  };
}

function holdingStructure(rows) {
  const valuedRows = rows.filter(function (row) { return Number.isFinite(Number(row.valueCny)); });
  const total = sum(valuedRows, "valueCny");
  const markets = MARKET_ORDER.map(function (market) {
    const value = sum(valuedRows.filter(function (row) { return row.market === market; }), "valueCny");
    return { market: market, value: value, weight: total > 0 ? value / total * 100 : 0 };
  });
  const ranked = valuedRows.slice().sort(function (a, b) { return b.valueCny - a.valueCny; });
  return { markets: markets, largest: ranked[0] || null, topFive: total > 0 ? sum(ranked.slice(0, 5), "valueCny") / total * 100 : 0, valuedCount: valuedRows.length, totalCount: rows.length };
}

function filteredHoldingRows(rows) {
  const query = state.holdingQuery.trim().toLowerCase();
  return rows.filter(function (row) {
    if (state.market !== "全部" && row.market !== state.market) return false;
    if (state.holdingPnlFilter === "profit" && !(row.pnlCny > 0)) return false;
    if (state.holdingPnlFilter === "loss" && !(row.pnlCny < 0)) return false;
    return !query || [row.name, row.code, row.sina].some(function (value) { return String(value || "").toLowerCase().includes(query); });
  });
}

function holdingSnapshotMarkup(rows) {
  const data = holdingSnapshot(rows);
  const todayRateMarkup = Number.isFinite(Number(data.todayRate)) ? " <em>" + pct(data.todayRate) + "</em>" : "";
  const pnlRateMarkup = Number.isFinite(Number(data.pnlRate)) ? " <em>" + pct(data.pnlRate) + "</em>" : "";
  return "<section class=\"card holding-snapshot-card\" aria-labelledby=\"holding-snapshot-title\"><h2 id=\"holding-snapshot-title\" class=\"visually-hidden\">持仓快照</h2><dl class=\"holding-snapshot-grid\">" +
    "<div><dt>持仓数量</dt><dd>" + data.count + "只</dd><small>当前持有标的</small></div>" +
    "<div><dt>持仓市值</dt><dd>" + money(data.value, 0) + "</dd><small>" + data.valuedCount + "/" + data.count + "只具有当前或最近收盘价</small></div>" +
    "<div><dt>今日盈亏</dt><dd class=\"" + tone(data.today) + "\">" + signed(data.today, 0) + todayRateMarkup + "</dd><small>" + data.todayCount + "/" + data.count + "只具有当日行情；非交易日显示 --</small></div>" +
    "<div><dt>持仓浮动盈亏</dt><dd class=\"" + tone(data.pnl) + "\">" + signed(data.pnl, 0) + pnlRateMarkup + "</dd><small>持仓市值 − 当前持仓成本</small></div>" +
    "<div class=\"holding-distribution holding-total-distribution\"><dt>累计盈亏分布</dt><dd><b class=\"positive\">" + data.profitCount + "盈</b><span>/</span><b class=\"negative\">" + data.lossCount + "亏</b>" + (data.flatCount ? "<span>/</span><b>" + data.flatCount + "持平</b>" : "") + (data.unavailableCount ? "<span>/</span><b class=\"neutral\">" + data.unavailableCount + "待估值</b>" : "") + "</dd><small>按股票合并统计</small></div>" +
    "<div class=\"holding-distribution holding-today-distribution\"><dt>今日盈亏分布</dt><dd><b class=\"positive\">" + data.todayProfitCount + "盈</b><span>/</span><b class=\"negative\">" + data.todayLossCount + "亏</b>" + (data.todayFlatCount ? "<span>/</span><b>" + data.todayFlatCount + "持平</b>" : "") + (data.todayUnavailableCount ? "<span>/</span><b class=\"neutral\">" + data.todayUnavailableCount + "待行情</b>" : "") + "</dd><small>仅统计具有当日行情的股票</small></div></dl></section>";
}

function holdingStructureMarkup(rows) {
  const data = holdingStructure(rows);
  return "<section class=\"card holding-structure-card\" aria-labelledby=\"holding-structure-title\"><div class=\"holding-structure-main\"><h2 id=\"holding-structure-title\">仓位结构</h2><div class=\"holding-allocation-bar\" aria-hidden=\"true\">" + data.markets.map(function (item) {
    return "<span class=\"" + marketClass(item.market) + "\" style=\"width:" + Math.max(0, Math.min(100, item.weight)).toFixed(2) + "%\">" + item.market + " " + item.weight.toFixed(1) + "%</span>";
  }).join("") + "</div><p class=\"holding-allocation-text\">" + data.markets.map(function (item) { return item.market + " " + item.weight.toFixed(1) + "%"; }).join(" · ") + " · 估值覆盖 " + data.valuedCount + "/" + data.totalCount + "只</p></div><dl class=\"holding-concentration\"><div><dt>最大单股</dt><dd>" + (data.largest ? ratioPct(data.largest.holdingPct, 2) : "--") + "</dd><small>" + (data.largest ? escapeHtml(data.largest.name) : "暂无有效估值") + "</small></div><div><dt>前五集中度</dt><dd>" + data.topFive.toFixed(1) + "%</dd><small>按有效估值市值计算</small></div></dl></section>";
}

function holdingFilterButton(value, label, active, attribute) {
  return "<button type=\"button\" data-" + attribute + "=\"" + value + "\" class=\"" + (active ? "active" : "") + "\" aria-pressed=\"" + active + "\">" + label + "</button>";
}

function holdingSortSelect() {
  const current = state.actionSort + ":" + state.actionSortDirection;
  const options = [["weight:desc", "仓位从高到低"], ["weight:asc", "仓位从低到高"], ["cost:desc", "总成本从高到低"], ["cost:asc", "总成本从低到高"], ["qty:desc", "数量从高到低"], ["qty:asc", "数量从低到高"], ["price:desc", "当前价从高到低"], ["price:asc", "当前价从低到高"], ["today:desc", "今日盈亏从高到低"], ["today:asc", "今日盈亏从低到高"], ["pnl:desc", "累计盈亏从高到低"], ["pnl:asc", "累计盈亏从低到高"]];
  return "<label class=\"holding-sort-select\"><span>排序</span><select data-holding-sort>" + options.map(function (item) { return "<option value=\"" + item[0] + "\"" + (item[0] === current ? " selected" : "") + ">" + item[1] + "</option>"; }).join("") + "</select></label>";
}

function holdingToolbarMarkup(allRows, rows) {
  const markets = ["全部", "港股", "A股", "美股"];
  const resultText = "显示 " + rows.length + " 只持仓，按" + actionSortLabel(state.actionSort) + actionSortDirectionLabel() + "。";
  const filtered = rows.length !== allRows.length || state.holdingQuery || state.market !== "全部" || state.holdingPnlFilter !== "all";
  return "<section class=\"card holding-toolbar\" aria-label=\"持仓筛选与排序\"><label class=\"holding-search\"><span class=\"visually-hidden\">搜索股票名称或代码</span><input type=\"search\" data-holding-search value=\"" + escapeHtml(state.holdingQuery) + "\" placeholder=\"搜索股票名称或代码\" autocomplete=\"off\"/></label>" +
    "<fieldset class=\"holding-filter-group\"><legend>市场</legend><div>" + markets.map(function (market) { return holdingFilterButton(market, market, state.market === market, "holding-market"); }).join("") + "</div></fieldset>" +
    "<fieldset class=\"holding-filter-group holding-pnl-filter\"><legend>盈亏</legend><div>" + holdingFilterButton("all", "全部", state.holdingPnlFilter === "all", "holding-pnl") + holdingFilterButton("profit", "盈利", state.holdingPnlFilter === "profit", "holding-pnl") + holdingFilterButton("loss", "亏损", state.holdingPnlFilter === "loss", "holding-pnl") + "</div></fieldset>" +
    holdingSortSelect() + "<p class=\"holding-result-status\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\">" + resultText + "</p>" + (filtered ? "<button class=\"holding-clear-filter\" type=\"button\" data-clear-holding-filters>清除筛选</button>" : "") + "</section>";
}

function actionsPage() {
  const allRows = openSecurityRows();
  const rows = sortActionRows(filteredHoldingRows(allRows));
  if (state.expandedHoldingKey && !rows.some(function (row) { return row.holdingKey === state.expandedHoldingKey; })) state.expandedHoldingKey = "";
  return "<main class=\"page-shell action-page\"><header class=\"holding-page-heading\"><h1 class=\"page-title\">持仓明细</h1><p>看清仓位、成本与当前浮动盈亏</p></header>" + holdingSnapshotMarkup(allRows) + holdingStructureMarkup(allRows) + holdingToolbarMarkup(allRows, rows) +
    "<section class=\"card holding-list-card\"><div class=\"holding-list-heading\"><div><h2>全部持仓</h2><p>人民币为主读数；港美股第二行显示市场原币，累计人民币口径包含汇兑影响。点击数值表头切换升序或降序。</p></div><strong>" + rows.length + " / " + allRows.length + "只</strong></div>" + holdingActionTable(rows) + "</section></main>";
}

function actionSortLabel(sort) {
  const labels = { cost: "总成本", qty: "持仓数量", value: "持仓市值", price: "当前价", today: "今日盈亏", pnl: "累计盈亏", weight: "持仓占比" };
  return labels[sort] || labels.weight;
}

function actionSortDirectionLabel() {
  return state.actionSortDirection === "asc" ? "升序" : "降序";
}

function actionSortValue(row, key) {
  if (key === "cost") return row.purchaseCostCny;
  if (key === "qty") return row.qty;
  if (key === "value") return row.valueCny;
  if (key === "price") return row.priceSource === "cost" ? NaN : row.price * (state.rates[row.currency] || 1);
  if (key === "pnl") return row.pnlCny;
  if (key === "weight") return row.holdingPct;
  return row.todayPnlCny;
}

function sortActionRows(rows) {
  return rows.slice().sort(function (a, b) {
    const aValue = Number(actionSortValue(a, state.actionSort));
    const bValue = Number(actionSortValue(b, state.actionSort));
    const aMissing = !Number.isFinite(aValue), bMissing = !Number.isFinite(bValue);
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    const result = aValue - bValue;
    if (Math.abs(result) > 0.000001) return state.actionSortDirection === "asc" ? result : -result;
    if (b.valueCny !== a.valueCny) return b.valueCny - a.valueCny;
    return (a.market + a.code).localeCompare(b.market + b.code, "zh-CN");
  });
}

function stockCell(row) {
  return "<span class=\"stock-name\">" + escapeHtml(row.name) + "</span><span class=\"stock-code\">" + escapeHtml(row.code) + marketSuffix(row) + "</span>";
}

function tableDualMoney(nativeValue, currency, cnyValue, valueTone, note) {
  const className = valueTone ? " " + valueTone : "";
  return "<div class=\"table-money\"><b class=\"" + className + "\">" + money(cnyValue, 0) + "</b><small>" + (currency === "CNY" ? "人民币" : nativeMoney(nativeValue, currency)) + (note ? " · " + note : "") + "</small></div>";
}

function holdingPriceSourceLabel(row) {
  if (row.priceSource === "cost") return "行情缺失";
  if (row.priceSource === "history") return "收盘 " + escapeHtml(String(row.priceAsOf || "").slice(5));
  const date = new Date(row.priceAsOf || "");
  const timestamp = Number.isFinite(date.getTime())
    ? String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") + " " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0")
    : "时间未知";
  return (row.priceSource === "cache" ? "缓存 " : "刷新 ") + timestamp;
}

function holdingPnlMarkup(cnyValue, nativeValue, currency, rate, missingLabel) {
  if (!Number.isFinite(Number(cnyValue))) {
    return "<div class=\"holding-pnl-cell is-missing\"><b>--</b><small>" + escapeHtml(missingLabel || "数据缺失") + "</small></div>";
  }
  const nativeText = currency === "CNY"
    ? "人民币"
    : Number.isFinite(Number(nativeValue)) ? signedNative(nativeValue, currency) : "原币数据缺失";
  const nativeClass = currency === "CNY" ? "neutral" : tone(nativeValue);
  return "<div class=\"holding-pnl-cell\"><b class=\"" + tone(cnyValue) + "\">" + signed(cnyValue, 0) + "</b><small class=\"" + nativeClass + "\">" + nativeText + "</small><em class=\"" + tone(cnyValue) + "\">" + pct(rate) + "</em></div>";
}

function actionSortHeader(key, label, sortLabel) {
  const active = state.actionSort === key;
  const direction = active ? state.actionSortDirection : "desc";
  const nextDirection = active && direction === "desc" ? "升序" : "降序";
  const ariaSort = active ? (direction === "asc" ? "ascending" : "descending") : "none";
  const unit = ["cost", "value", "today", "pnl"].includes(key) ? "金额" : "";
  return "<th scope=\"col\" aria-sort=\"" + ariaSort + "\"><button type=\"button\" class=\"table-sort-button" + (active ? " active" : "") + "\" data-action-sort=\"" + key + "\" aria-label=\"按" + (sortLabel || label) + unit + nextDirection + "排序\"><span>" + label + "</span><svg class=\"sort-arrow " + direction + "\" viewBox=\"0 0 12 12\" aria-hidden=\"true\"><path d=\"M6 2v8M3.5 4.5 6 2l2.5 2.5\"/></svg></button></th>";
}

function holdingActionTable(rows) {
  if (!rows.length) return "<div class=\"empty holding-empty\"><strong>没有符合条件的持仓</strong><p>换一个市场、盈亏状态或搜索关键词试试。</p><button type=\"button\" data-clear-holding-filters>清除筛选</button></div>";
  const maxWeight = Math.max.apply(null, rows.map(function (item) { return item.holdingPct; }).filter(Number.isFinite).concat([1]));
  return "<div class=\"holding-desktop-table\"><table class=\"holding-action-table\"><caption class=\"visually-hidden\">当前持仓。人民币为主读数，港股和美股第二行显示市场原币金额；累计人民币口径包含汇兑影响。</caption><colgroup><col class=\"holding-col-stock\"/><col class=\"holding-col-qty\"/><col class=\"holding-col-cost\"/><col class=\"holding-col-price\"/><col class=\"holding-col-value\"/><col class=\"holding-col-today\"/><col class=\"holding-col-pnl\"/><col class=\"holding-col-detail\"/></colgroup><thead><tr><th scope=\"col\">股票</th>" + actionSortHeader("qty", "持仓数量") + actionSortHeader("cost", "总成本") + actionSortHeader("price", "买入均价·当前价", "当前价") + actionSortHeader("weight", "市值·仓位", "持仓占比") + actionSortHeader("today", "今日盈亏") + actionSortHeader("pnl", "累计盈亏") + "<th scope=\"col\">详情</th></tr></thead><tbody>" + rows.map(function (row) { return holdingDesktopRow(row, maxWeight); }).join("") + "</tbody></table></div><div class=\"holding-mobile-list\" role=\"list\">" + rows.map(holdingMobileCard).join("") + "</div>";
}

function holdingPanelId(row, surface) {
  return "holding-outlook-" + surface + "-" + row.holdingKey.replace(/[^A-Za-z0-9_-]/g, "-");
}

function holdingDesktopRow(row, maxWeight) {
  const expanded = state.expandedHoldingKey === row.holdingKey;
  const panelId = holdingPanelId(row, "desktop");
  const currentPrice = row.priceSource === "cost" ? "--" : nativeMoney(row.price, row.currency);
  const priceNote = holdingPriceSourceLabel(row);
  const todayMarkup = row.hasTodayQuote
    ? holdingPnlMarkup(row.todayPnlCny, row.todayPnlNative, row.currency, row.changePct, "今日行情缺失")
    : holdingPnlMarkup(NaN, NaN, row.currency, NaN, "今日行情缺失");
  const cumulativeMarkup = holdingPnlMarkup(row.pnlCny, row.pnlNative, row.currency, row.pnlRate, "估值数据缺失");
  const weightText = ratioPct(row.holdingPct, 2);
  const weightWidth = Number.isFinite(row.holdingPct) ? Math.min(100, row.holdingPct / maxWeight * 100).toFixed(1) : "0";
  return "<tr class=\"holding-main-row" + (expanded ? " is-expanded" : "") + "\"><th scope=\"row\"><div class=\"holding-stock-cell\"><div>" + stockCell(row) + "</div>" + marketLabel(row.market) + "</div></th><td class=\"number-cell\">" + row.qty.toLocaleString("zh-CN") + "</td><td>" + tableDualMoney(row.nativeTotalCost, row.currency, row.purchaseCostCny, "", "含买入费") + "</td><td><div class=\"holding-price-pair\"><span>" + nativeMoney(row.cost, row.currency) + "</span><i>→</i><b>" + currentPrice + "</b><small>" + priceNote + "</small></div></td><td><div class=\"holding-value-cell\"><b>" + money(row.valueCny, 0) + "</b><span>" + weightText + "</span><i><em style=\"width:" + weightWidth + "%\"></em></i></div></td><td>" + todayMarkup + "</td><td>" + cumulativeMarkup + "</td><td><button class=\"holding-expand-button\" type=\"button\" data-toggle-holding=\"" + escapeHtml(row.holdingKey) + "\" aria-expanded=\"" + expanded + "\"" + (expanded ? " aria-controls=\"" + panelId + "\"" : "") + ">" + (expanded ? "收起" : "查看") + "</button></td></tr>" + (expanded ? "<tr class=\"holding-detail-row\"><td colspan=\"8\">" + holdingOutlookMarkup(row, "desktop") + "</td></tr>" : "");
}

function holdingMobileCard(row) {
  const expanded = state.expandedHoldingKey === row.holdingKey;
  const panelId = holdingPanelId(row, "mobile");
  const currentPrice = row.priceSource === "cost" ? "--" : nativeMoney(row.price, row.currency);
  const priceNote = holdingPriceSourceLabel(row);
  const todayMarkup = row.hasTodayQuote
    ? holdingPnlMarkup(row.todayPnlCny, row.todayPnlNative, row.currency, row.changePct, "今日行情缺失")
    : holdingPnlMarkup(NaN, NaN, row.currency, NaN, "今日行情缺失");
  const cumulativeMarkup = holdingPnlMarkup(row.pnlCny, row.pnlNative, row.currency, row.pnlRate, "估值数据缺失");
  return "<article class=\"holding-mobile-card" + (expanded ? " is-expanded" : "") + "\" role=\"listitem\"><header><div><strong>" + escapeHtml(row.name) + "</strong><span>" + escapeHtml(row.code) + marketSuffix(row) + "</span></div>" + marketLabel(row.market) + "</header><p class=\"holding-mobile-cost\">数量 " + row.qty.toLocaleString("zh-CN") + "股 · 总成本 " + money(row.purchaseCostCny, 0) + "<small>" + (row.currency === "CNY" ? "人民币" : nativeMoney(row.nativeTotalCost, row.currency)) + " · 含买入费</small></p><dl><div><dt>买入均价 → 当前价</dt><dd>" + nativeMoney(row.cost, row.currency) + " → " + currentPrice + "<small class=\"holding-price-source\">" + priceNote + "</small></dd></div><div><dt>市值 · 仓位</dt><dd>" + money(row.valueCny, 0) + " · " + ratioPct(row.holdingPct, 2) + "</dd></div><div><dt>今日盈亏</dt><dd>" + todayMarkup + "</dd></div><div><dt>累计盈亏</dt><dd>" + cumulativeMarkup + "</dd></div></dl><button class=\"holding-mobile-expand\" type=\"button\" data-toggle-holding=\"" + escapeHtml(row.holdingKey) + "\" aria-expanded=\"" + expanded + "\"" + (expanded ? " aria-controls=\"" + panelId + "\"" : "") + ">" + (expanded ? "收起未来2周展望" : "查看未来2周展望") + "</button>" + (expanded ? holdingOutlookMarkup(row, "mobile") : "") + "</article>";
}

function cleanedDailyHistory(history) {
  const byDate = new Map();
  (history || []).forEach(function (point) {
    const close = Number(point && point.close);
    if (!point || !/^\d{4}-\d{2}-\d{2}$/.test(point.date) || !Number.isFinite(close) || close <= 0) return;
    byDate.set(point.date, {
      date: point.date,
      open: Number(point.open), high: Number(point.high), low: Number(point.low), close: close
    });
  });
  return Array.from(byDate.values()).sort(function (a, b) { return a.date.localeCompare(b.date); });
}

function averageNumber(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce(function (total, value) { return total + value; }, 0) / valid.length : NaN;
}

function standardDeviation(values) {
  const mean = averageNumber(values);
  if (!Number.isFinite(mean) || values.length < 2) return NaN;
  const variance = values.reduce(function (total, value) { return total + Math.pow(value - mean, 2); }, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function simpleMovingAverage(series, length, offset) {
  const end = series.length - (offset || 0);
  if (end < length) return NaN;
  return averageNumber(series.slice(end - length, end).map(function (point) { return point.close; }));
}

function logReturn(series, lookback) {
  if (series.length <= lookback) return NaN;
  const latest = series[series.length - 1].close;
  const prior = series[series.length - 1 - lookback].close;
  return latest > 0 && prior > 0 ? Math.log(latest / prior) : NaN;
}

function averageTrueRange(series, length) {
  if (series.length < length + 1) return NaN;
  const ranges = [];
  for (let index = series.length - length; index < series.length; index += 1) {
    const point = series[index], previous = series[index - 1];
    if (![point.high, point.low, previous.close].every(Number.isFinite)) return NaN;
    ranges.push(Math.max(point.high - point.low, Math.abs(point.high - previous.close), Math.abs(point.low - previous.close)));
  }
  return averageNumber(ranges);
}

function radarMarketClock(market, now) {
  const timeZone = market === "美股" ? "America/New_York" : "Asia/Shanghai";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(now || new Date());
    const values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return {
      date: [values.year, values.month, values.day].join("-"),
      minutes: Number(values.hour) * 60 + Number(values.minute)
    };
  } catch (_) {
    const date = now || new Date();
    return {
      date: [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"),
      minutes: date.getHours() * 60 + date.getMinutes()
    };
  }
}

function completedRadarHistory(history, market, now) {
  const clock = radarMarketClock(market, now);
  const closeMinute = market === "A股" ? 15 * 60 + 10 : 16 * 60 + 10;
  const series = cleanedDailyHistory(history).filter(function (point) { return point.date <= clock.date; });
  if (series.length && last(series).date === clock.date && clock.minutes < closeMinute) series.pop();
  return series;
}

function latestConfirmedPivotLow(series) {
  for (let index = series.length - 3; index >= 2; index -= 1) {
    const value = Number(series[index].close);
    if ([series[index - 2], series[index - 1], series[index + 1], series[index + 2]].every(function (point) {
      return value < Number(point.close);
    })) return value;
  }
  return NaN;
}

function radarLevelUnavailable(status, reason, bars, baseDate) {
  return {
    status: status, reason: reason, bars: bars || 0, baseDate: baseDate || "",
    upper: NaN, upperPct: NaN, stop: NaN, stopPct: NaN,
    modelVersion: RADAR_LEVEL_MODEL_VERSION
  };
}

function radarTenDayLevels(item, history, now) {
  const series = completedRadarHistory(history, item && item.market, now);
  const baseDate = series.length ? last(series).date : "";
  if (series.length < 61) return radarLevelUnavailable("insufficient", "历史日线 " + series.length + "/61", series.length, baseDate);
  const current = optionalNumber(item && item.metrics && item.metrics.price);
  if (!Number.isFinite(current) || current <= 0) return radarLevelUnavailable("invalid", "当前价格不可用", series.length, baseDate);
  if (historyAgeDays(baseDate, radarMarketClock(item && item.market, now).date) > 10) return radarLevelUnavailable("stale", "历史行情已超过10天", series.length, baseDate);

  const recent = series.slice(-61);
  const validOhlc = recent.every(function (point) {
    const open = Number(point.open), high = Number(point.high), low = Number(point.low), close = Number(point.close);
    return [open, high, low, close].every(function (value) { return Number.isFinite(value) && value > 0; })
      && low <= Math.min(open, close) && high >= Math.max(open, close);
  });
  if (!validOhlc) return radarLevelUnavailable("invalid", "缺少有效OHLC", series.length, baseDate);

  const returns = [], trueRangeRatios = [];
  for (let index = 1; index < recent.length; index += 1) {
    const point = recent[index], previous = recent[index - 1];
    const dailyReturn = Math.log(point.close / previous.close);
    const trueRange = Math.max(point.high - point.low, Math.abs(point.high - previous.close), Math.abs(point.low - previous.close));
    returns.push(dailyReturn);
    trueRangeRatios.push(trueRange / previous.close);
  }
  if (returns.some(function (value) { return !Number.isFinite(value) || Math.abs(value) > Math.log(1.5); })
    || trueRangeRatios.some(function (value) { return !Number.isFinite(value) || value > 0.35; })) {
    return radarLevelUnavailable("unstable", "近期存在异常跳空或公司行动", series.length, baseDate);
  }

  const sigma20 = standardDeviation(returns.slice(-20));
  const sigma60 = standardDeviation(returns);
  const sigmaEffective = Math.max(sigma20, 0.75 * sigma60);
  const atr = averageTrueRange(recent, 14);
  const latestClose = last(recent).close;
  if (![sigma20, sigma60, sigmaEffective, atr, latestClose].every(Number.isFinite) || sigmaEffective <= 0 || atr <= 0) {
    return radarLevelUnavailable("unstable", "近期波动数据不足", series.length, baseDate);
  }
  if (Math.abs(Math.log(current / latestClose)) > Math.log(1.25)) {
    return radarLevelUnavailable("unstable", "当前价与历史收盘偏离过大", series.length, baseDate);
  }

  const rawBand = Math.max(1.25 * sigmaEffective * Math.sqrt(10), Math.log(1 + 2 * atr / current));
  if (!Number.isFinite(rawBand) || rawBand > Math.log(1.25)) {
    return radarLevelUnavailable("unstable", "近期波动过大，无法给出稳定价位", series.length, baseDate);
  }
  const band = Math.max(rawBand, -Math.log(0.97));
  const upper = current * Math.exp(band);
  const volatilityStop = current * Math.exp(-band);
  const pivot = latestConfirmedPivotLow(recent.slice(-60));
  const structureStop = Number.isFinite(pivot) ? pivot - 0.25 * atr : NaN;
  const minimumDistance = Math.max(0.03, 1.5 * atr / current);
  const stopCandidates = [volatilityStop, structureStop].filter(function (value) {
    if (!Number.isFinite(value) || value <= 0 || value >= current) return false;
    const distance = 1 - value / current;
    return distance + 1e-9 >= minimumDistance && distance <= 0.15 + 1e-9;
  });
  const stop = stopCandidates.length ? Math.max.apply(null, stopCandidates) : NaN;
  const roundedCurrent = Math.round(current * 100) / 100;
  const roundedUpper = Math.round(upper * 100) / 100;
  const roundedStop = Number.isFinite(stop) ? Math.round(stop * 100) / 100 : NaN;
  if (!(roundedUpper > roundedCurrent)) return radarLevelUnavailable("invalid", "参考上沿未通过价格校验", series.length, baseDate);

  return {
    status: "ready", reason: "基于日对数波动与ATR的10个交易日情景", bars: series.length, baseDate: baseDate,
    upper: roundedUpper, upperPct: (roundedUpper / current - 1) * 100,
    stop: roundedStop, stopPct: Number.isFinite(roundedStop) && roundedStop > 0 && roundedStop < roundedCurrent ? (roundedStop / current - 1) * 100 : NaN,
    stopReason: Number.isFinite(roundedStop) && roundedStop > 0 && roundedStop < roundedCurrent ? "日收盘低于该价位触发复核" : "没有通过3%–15%距离校验的风控线",
    modelVersion: RADAR_LEVEL_MODEL_VERSION
  };
}

function historyReturn(history, lookback) {
  const series = cleanedDailyHistory(history);
  if (series.length <= lookback) return NaN;
  return (series[series.length - 1].close / series[series.length - 1 - lookback].close - 1) * 100;
}

function historyAgeDays(date, referenceDate) {
  const normalized = normalizedMarketDate(date);
  const today = normalizedMarketDate(referenceDate) || calendarDateInTimeZone("Asia/Shanghai");
  if (!normalized || normalized > today) return Infinity;
  const time = new Date(normalized + "T12:00:00Z").getTime();
  const todayTime = new Date(today + "T12:00:00Z").getTime();
  return Number.isFinite(time) && Number.isFinite(todayTime) ? Math.floor((todayTime - time) / 86400000) : Infinity;
}

function twoWeekWindowLabel() {
  const start = new Date(), end = new Date(start);
  let weekdays = 0;
  while (weekdays < 10) {
    end.setDate(end.getDate() + 1);
    if (end.getDay() !== 0 && end.getDay() !== 6) weekdays += 1;
  }
  return (start.getMonth() + 1) + "月" + start.getDate() + "日–" + (end.getMonth() + 1) + "月" + end.getDate() + "日 · 约10个交易日";
}

function signalLabel(value, threshold) {
  if (!Number.isFinite(value)) return { text: "缺失", cls: "unknown" };
  if (value >= threshold) return { text: "偏强", cls: "up" };
  if (value <= -threshold) return { text: "偏弱", cls: "down" };
  return { text: "中性", cls: "neutral" };
}

function holdingTwoWeekAnalysis(row) {
  const series = cleanedDailyHistory(row.history);
  const lastPoint = last(series);
  const recent60 = series.slice(-60);
  const validOhlc = recent60.filter(function (point) { return [point.open, point.high, point.low, point.close].every(function (value) { return Number.isFinite(value) && value > 0; }); }).length;
  const coverage = recent60.length ? validOhlc / recent60.length : 0;
  const fresh = lastPoint ? historyAgeDays(lastPoint.date) <= 5 : false;
  const dailyReturns = series.slice(-21).map(function (point, index, points) {
    if (!index) return NaN;
    return Math.log(point.close / points[index - 1].close);
  }).filter(Number.isFinite);
  const sigma20 = standardDeviation(dailyReturns);
  const r10 = logReturn(series, 10), r20 = logReturn(series, 20);
  const z10 = Number.isFinite(sigma20) && sigma20 > 0 ? r10 / (sigma20 * Math.sqrt(10)) : NaN;
  const z20 = Number.isFinite(sigma20) && sigma20 > 0 ? r20 / (sigma20 * Math.sqrt(20)) : NaN;
  const sma10 = simpleMovingAverage(series, 10, 0), sma20 = simpleMovingAverage(series, 20, 0), priorSma20 = simpleMovingAverage(series, 20, 5);
  const latestClose = lastPoint ? lastPoint.close : NaN;
  const upTrend = z10 >= 0.75 && z20 >= 0.50 && latestClose > sma20 && sma10 > sma20 && sma20 > priorSma20;
  const downTrend = z10 <= -0.75 && z20 <= -0.50 && latestClose < sma20 && sma10 < sma20 && sma20 < priorSma20;
  const benchmark = MARKET_BENCHMARKS[row.market];
  const benchmarkHistory = benchmark ? state.histories[benchmark.symbol] || [] : [];
  const benchmark5 = historyReturn(benchmarkHistory, 5), benchmark20 = historyReturn(benchmarkHistory, 20);
  const benchmarkSeries = cleanedDailyHistory(benchmarkHistory), benchmarkLast = last(benchmarkSeries);
  const benchmarkReady = Number.isFinite(benchmark5) && Number.isFinite(benchmark20) && benchmarkSeries.length >= 21 && benchmarkLast && historyAgeDays(benchmarkLast.date) <= 5;
  const quoteReady = Boolean(row.hasLivePrice);
  const atr = averageTrueRange(series, 14);
  const recent20 = series.slice(-20);
  const recent20Valid = recent20.length === 20 && recent20.every(function (point) {
    return [point.open, point.high, point.low, point.close].every(function (value) { return Number.isFinite(value) && value > 0; }) && point.high >= point.low;
  });
  const low20 = recent20Valid ? Math.min.apply(null, recent20.map(function (point) { return point.low; })) : NaN;
  const high20 = recent20Valid ? Math.max.apply(null, recent20.map(function (point) { return point.high; })) : NaN;
  const rangePct = Number.isFinite(sigma20) ? Math.max(0.04, Math.min(0.30, sigma20 * Math.sqrt(10) * 1.25)) : NaN;
  const rangeLow = Number.isFinite(rangePct) ? latestClose * (1 - rangePct) : NaN;
  const rangeHigh = Number.isFinite(rangePct) ? latestClose * (1 + rangePct) : NaN;
  const supportLow = Number.isFinite(atr) && Number.isFinite(low20) ? Math.max(0, low20 - atr * 0.25) : NaN;
  const supportHigh = Number.isFinite(atr) && Number.isFinite(low20) ? low20 + atr * 0.25 : NaN;
  const resistanceLow = Number.isFinite(atr) && Number.isFinite(high20) ? Math.max(0, high20 - atr * 0.25) : NaN;
  const resistanceHigh = Number.isFinite(atr) && Number.isFinite(high20) ? high20 + atr * 0.25 : NaN;
  const levelsReady = [rangeLow, rangeHigh, supportLow, supportHigh, resistanceLow, resistanceHigh].every(Number.isFinite);
  const minimumReady = series.length >= 60 && coverage >= 0.95 && recent20Valid && fresh && Number.isFinite(sigma20) && sigma20 > 0 && levelsReady;
  let status = "unknown", label = "无法分析", reason = "方向信号不足";
  if (!minimumReady) {
    if (series.length < 60) reason = "历史日线不足60个交易日";
    else if (coverage < 0.95) reason = "近期日线不完整";
    else if (!recent20Valid || !levelsReady) reason = "近期20根OHLC或关键价位数据不完整";
    else if (!fresh) reason = "行情已过期，等待刷新";
    else reason = "近期波动数据异常";
  } else if (upTrend) { status = "up"; label = "上涨倾向"; reason = "短中期动量与均线结构同向偏强"; }
  else if (downTrend) { status = "down"; label = "下跌倾向"; reason = "短中期动量与均线结构同向偏弱"; }
  const completeness = Math.round(Math.min(100, (series.length >= 90 ? 40 : Math.min(1, series.length / 90) * 40) + coverage * 15 + (recent20Valid && levelsReady ? 10 : 0) + (fresh ? 15 : 0) + (quoteReady ? 10 : 0) + (benchmarkReady ? 10 : 0)));
  const confidence = status === "unknown" ? "不足" : series.length >= 90 && coverage === 1 && quoteReady && benchmarkReady && ((status === "up" && z10 >= 1.25 && z20 >= 1) || (status === "down" && z10 <= -1.25 && z20 <= -1)) ? "高" : "中";
  const stock20 = Number.isFinite(r20) ? (Math.exp(r20) - 1) * 100 : NaN;
  const marketText = benchmarkReady
    ? benchmark.name + "近5日" + pct(benchmark5) + "，近20日" + pct(benchmark20) + (Number.isFinite(stock20) && Number.isFinite(benchmark20) ? "；个股同期相对基准" + pct(stock20 - benchmark20) : "") + "。"
    : "市场基准数据暂缺或已过期；当前结论只依据个股日线，可信度已相应降低。";
  return {
    status: status, label: label, reason: reason, confidence: confidence, completeness: completeness, levelsReady: levelsReady,
    latestDate: lastPoint ? lastPoint.date : "--", window: twoWeekWindowLabel(), basePrice: latestClose,
    rangeLow: rangeLow, rangeHigh: rangeHigh, supportLow: supportLow, supportHigh: supportHigh,
    resistanceLow: resistanceLow, resistanceHigh: resistanceHigh,
    invalidation: status === "up" ? supportLow : status === "down" ? resistanceHigh : NaN,
    marketText: marketText,
    signals: [
      { name: "10日动量", value: signalLabel(z10, 0.75) },
      { name: "20日趋势", value: signalLabel(z20, 0.50) },
      { name: "均线结构", value: !minimumReady ? { text: "缺失", cls: "unknown" } : sma10 > sma20 && sma20 > priorSma20 ? { text: "偏强", cls: "up" } : sma10 < sma20 && sma20 < priorSma20 ? { text: "偏弱", cls: "down" } : { text: "中性", cls: "neutral" } }
    ]
  };
}

function outlookPriceRange(low, high, currency) {
  return Number.isFinite(low) && Number.isFinite(high) ? nativeMoney(low, currency) + " – " + nativeMoney(high, currency) : "--";
}

function holdingOutlookMarkup(row, surface) {
  const data = holdingTwoWeekAnalysis(row);
  const panelId = holdingPanelId(row, surface);
  const titleId = panelId + "-title";
  const showLevels = data.status !== "unknown" && data.levelsReady;
  return "<section id=\"" + panelId + "\" class=\"holding-outlook-panel " + data.status + "\" role=\"region\" aria-label=\"" + escapeHtml(row.name) + "未来2周技术展望\"><header class=\"holding-outlook-head\"><div><h3 id=\"" + titleId + "\">未来2周技术展望</h3><span>规则模型</span></div><p>行情截至 " + escapeHtml(data.latestDate) + " · " + data.window + "</p></header><div class=\"holding-outlook-grid\"><article class=\"outlook-direction\"><span>方向判断</span><strong class=\"outlook-verdict " + data.status + "\">" + data.label + "</strong><p>数据与信号可信度：<b>" + data.confidence + "</b></p><div class=\"outlook-signals\">" + data.signals.map(function (signal) { return "<div><span>" + signal.name + "</span><b class=\"" + signal.value.cls + "\">" + signal.value.text + "</b></div>"; }).join("") + "</div><small>方向概率尚未经过历史校准，因此不展示伪精确概率。</small></article><article class=\"outlook-levels\"><span>预估波动带（非目标价）</span>" + (showLevels ? "<strong>" + outlookPriceRange(data.rangeLow, data.rangeHigh, row.currency) + "</strong><dl><div><dt>启发式支撑区</dt><dd>" + outlookPriceRange(data.supportLow, data.supportHigh, row.currency) + "</dd></div><div><dt>启发式压力区</dt><dd>" + outlookPriceRange(data.resistanceLow, data.resistanceHigh, row.currency) + "</dd></div><div><dt>判断失效</dt><dd>日收盘" + (data.status === "up" ? "低于 " : "高于 ") + nativeMoney(data.invalidation, row.currency) + "</dd></div></dl>" : "<strong>暂不展示</strong><p>" + escapeHtml(data.reason) + "。补齐数据或等待趋势形成后重新计算。</p>") + "</article><article class=\"outlook-market\"><span>当前市场情况</span><p>" + escapeHtml(data.marketText) + "</p><dl><div><dt>个股趋势依据</dt><dd>短期动量 · 中期均线 · 波动率</dd></div><div><dt>分析结论</dt><dd>" + escapeHtml(data.reason) + "</dd></div></dl><label><span>模型数据评分 " + data.completeness + "%</span><progress max=\"100\" value=\"" + data.completeness + "\">" + data.completeness + "%</progress></label><small>市场基准仅作背景对照；刷新行情后自动重新计算</small></article></div><footer>基于公开行情与规则模型估算，仅作研究参考，不构成投资建议或收益保证。突发事件、财报、流动性及汇率变化可能使结论失效。</footer></section>";
}

function marketSuffix(row) {
  return row.market === "A股" ? (row.sina.startsWith("sh") ? ".SH" : ".SZ") : row.market === "港股" ? ".HK" : ".US";
}

function normalizedIssuerName(value) {
  return String(value || "").toUpperCase()
    .replace(/[-－—]\s*(?:SW|W|S|A|B)$/i, "")
    .replace(/^(?:\d+(?:\.\d+)?倍)?(?:做多|做空|多头|空头)/, "")
    .replace(/[\s·・\-－—_]/g, "")
    .replace(/(?:股份有限公司|有限公司|集团|控股|公司|LIMITED|LTD|INCORPORATED|INC|CORPORATION|CORP|HOLDINGS|PLC)+$/g, "");
}

function radarOwnedSets() {
  const holdings = activeHoldings();
  return {
    symbols: new Set(holdings.map(function (item) { return item.sina; }).filter(Boolean)),
    names: new Set(holdings.map(function (item) { return normalizedIssuerName(item.name); }).filter(Boolean))
  };
}

function radarCandidateIsOwned(item, owned) {
  return owned.symbols.has(item.sina) || owned.names.has(normalizedIssuerName(item.name));
}

function radarRowsBeforeFilters() {
  const owned = radarOwnedSets();
  return state.radarRows.filter(function (item) { return !radarCandidateIsOwned(item, owned); });
}

function radarBandMatches(item) {
  const score = optionalNumber(item.score);
  if (state.radarBand === "priority") return Number.isFinite(score) && score >= 70;
  if (state.radarBand === "watch") return Number.isFinite(score) && score >= 55 && score < 70;
  if (state.radarBand === "reserve") return Number.isFinite(score) && score < 55;
  return true;
}

function radarSortValue(item) {
  const metrics = item.metrics || {};
  if (state.radarSort === "trend") return optionalNumber(metrics.return60d);
  if (state.radarSort === "liquidity") return optionalNumber(metrics.amount);
  if (state.radarSort === "risk") return optionalNumber(item.components && item.components.risk);
  if (state.radarSort === "change") return optionalNumber(metrics.changePct);
  return optionalNumber(item.score);
}

function filteredRadarRows() {
  const query = state.radarQuery.trim().toUpperCase();
  return radarRowsBeforeFilters().filter(function (item) {
    if (state.watchMarket !== "全部" && item.market !== state.watchMarket) return false;
    if (!radarBandMatches(item)) return false;
    if (query && !(String(item.name || "").toUpperCase().includes(query) || String(item.code || "").toUpperCase().includes(query))) return false;
    return true;
  }).slice().sort(function (left, right) {
    const freshness = (radarEffectiveLoadState(left) === "fresh" ? 0 : 1) - (radarEffectiveLoadState(right) === "fresh" ? 0 : 1);
    if (freshness) return freshness;
    const a = radarSortValue(left), b = radarSortValue(right);
    if (!Number.isFinite(a) && !Number.isFinite(b)) return String(left.id).localeCompare(String(right.id));
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return b - a || Number(right.score) - Number(left.score) || String(left.id).localeCompare(String(right.id));
  });
}

function radarPageWindow() {
  const rows = filteredRadarRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / RADAR_PAGE_SIZE));
  const page = Math.max(1, Math.min(totalPages, state.radarPage));
  const start = (page - 1) * RADAR_PAGE_SIZE;
  return { rows: rows, totalPages: totalPages, page: page, start: start, pageRows: rows.slice(start, start + RADAR_PAGE_SIZE) };
}

function radarVisibleFingerprint(rows) {
  return (rows || []).map(function (item) { return item.sina; }).filter(Boolean).join(",");
}

function radarHistoryBatches(rows) {
  const batches = [];
  for (let index = 0; index < (rows || []).length; index += 5) batches.push(rows.slice(index, index + 5));
  return batches;
}

function radarHistoryNeedsRefresh(symbol) {
  const meta = state.radarHistoryMeta[symbol];
  if (!meta) return true;
  const age = Date.now() - Date.parse(meta.checkedAt || "");
  if (!Number.isFinite(age) || age < 0) return true;
  const status = state.radarHistoryStatus[symbol] && state.radarHistoryStatus[symbol].state;
  const ttl = status === "error" || status === "missing" ? RADAR_HISTORY_ERROR_TTL_MS : RADAR_HISTORY_TTL_MS;
  return age > ttl;
}

async function fetchRadarHistoryBatch(rows, signal) {
  const symbols = rows.map(function (item) { return item.sina; }).filter(Boolean);
  const response = await fetch("/api/history?symbols=" + encodeURIComponent(symbols.join(",")) + "&days=90", { cache: "no-store", signal: signal });
  if (!response.ok) throw new Error("历史行情请求失败（" + response.status + "）");
  const payload = await response.json();
  if (!payload || typeof payload.histories !== "object") throw new Error("历史行情格式不正确");
  return payload.histories;
}

function pruneRadarHistoryCache() {
  const symbols = Object.keys(state.radarHistoryMeta).sort(function (left, right) {
    return Date.parse(state.radarHistoryMeta[right].checkedAt || "") - Date.parse(state.radarHistoryMeta[left].checkedAt || "");
  });
  symbols.slice(60).forEach(function (symbol) {
    delete state.radarHistories[symbol];
    delete state.radarHistoryMeta[symbol];
    delete state.radarHistoryStatus[symbol];
  });
}

async function loadVisibleRadarHistories(expectedFingerprint) {
  const view = radarPageWindow();
  const fingerprint = radarVisibleFingerprint(view.pageRows);
  if (!fingerprint || fingerprint !== expectedFingerprint || state.tab !== "radar") return;
  const missing = view.pageRows.filter(function (item) {
    const status = state.radarHistoryStatus[item.sina];
    return item.sina && radarHistoryNeedsRefresh(item.sina) && (!status || status.state !== "loading");
  });
  if (!missing.length) return;

  if (state.radarHistoryController) state.radarHistoryController.abort();
  const controller = new AbortController();
  const requestId = ++state.radarHistoryRequestId;
  state.radarHistoryController = controller;
  missing.forEach(function (item) {
    state.radarHistoryStatus[item.sina] = { state: "loading", message: "正在补齐历史日线" };
  });
  render();

  const batches = radarHistoryBatches(missing);
  const results = await Promise.allSettled(batches.map(function (batch) { return fetchRadarHistoryBatch(batch, controller.signal); }));
  if (requestId !== state.radarHistoryRequestId || fingerprint !== state.radarVisibleFingerprint) return;
  const checkedAt = new Date().toISOString();
  results.forEach(function (result, index) {
    const batch = batches[index];
    if (result.status === "fulfilled") {
      batch.forEach(function (item) {
        const series = result.value[item.sina];
        if (Array.isArray(series) && series.length) {
          state.radarHistories[item.sina] = series;
          state.radarHistoryStatus[item.sina] = { state: "ready", message: "" };
        } else {
          state.radarHistoryStatus[item.sina] = { state: "missing", message: "没有可用历史日线" };
        }
        state.radarHistoryMeta[item.sina] = { checkedAt: checkedAt };
      });
    } else if (result.reason && result.reason.name !== "AbortError") {
      batch.forEach(function (item) {
        state.radarHistoryStatus[item.sina] = { state: "error", message: result.reason.message || "历史行情加载失败" };
        state.radarHistoryMeta[item.sina] = { checkedAt: checkedAt };
      });
    }
  });
  state.radarHistoryController = null;
  pruneRadarHistoryCache();
  render();
}

function scheduleVisibleRadarHistoryLoad() {
  if (state.tab !== "radar") return;
  const view = radarPageWindow();
  const fingerprint = radarVisibleFingerprint(view.pageRows);
  if (fingerprint !== state.radarVisibleFingerprint) {
    window.clearTimeout(radarHistoryTimer);
    radarHistoryTimer = 0;
    state.radarHistoryRequestId += 1;
    if (state.radarHistoryController) state.radarHistoryController.abort();
    state.radarHistoryController = null;
    state.radarVisibleFingerprint = fingerprint;
  }
  const needsLoad = view.pageRows.some(function (item) {
    const status = state.radarHistoryStatus[item.sina];
    return item.sina && radarHistoryNeedsRefresh(item.sina) && (!status || status.state !== "loading");
  });
  if (!fingerprint || !needsLoad || radarHistoryTimer) return;
  radarHistoryTimer = window.setTimeout(function () {
    radarHistoryTimer = 0;
    loadVisibleRadarHistories(fingerprint);
  }, 180);
}

function radarLevelsForItem(item) {
  const history = state.radarHistories[item.sina];
  const status = state.radarHistoryStatus[item.sina];
  if (Array.isArray(history) && history.length) {
    const levels = radarTenDayLevels(item, history);
    levels.loading = Boolean(status && status.state === "loading");
    levels.loadMessage = status && status.state === "error" ? status.message : "";
    return levels;
  }
  if (status && status.state === "error") return radarLevelUnavailable("error", status.message || "历史行情加载失败", 0, "");
  if (status && status.state === "missing") return radarLevelUnavailable("insufficient", status.message || "没有可用历史日线", 0, "");
  return radarLevelUnavailable("loading", "正在补齐历史日线", 0, "");
}

function radarCompactMoney(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  const symbol = currency === "USD" ? "US$" : currency === "HKD" ? "HK$" : "¥";
  const abs = Math.abs(amount);
  const unit = abs >= 1e12 ? [1e12, "万亿"] : abs >= 1e8 ? [1e8, "亿"] : abs >= 1e4 ? [1e4, "万"] : [1, ""];
  return (amount < 0 ? "-" : "") + symbol + (abs / unit[0]).toFixed(abs / unit[0] >= 100 ? 0 : 1) + unit[1];
}

function radarTimestamp(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "时间待更新";
  return formatUpdatedAt(date);
}

function radarQuoteTimestamp(item) {
  const value = item && item.quoteUpdatedAt;
  return value && Number.isFinite(Date.parse(value)) ? radarTimestamp(value) : "时间待核验";
}

function radarQuoteShortTimestamp(item) {
  const date = new Date(item && item.quoteUpdatedAt || "");
  if (!Number.isFinite(date.getTime())) return "时间待核验";
  const pad = function (value) { return String(value).padStart(2, "0"); };
  return pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function radarBandLabel(item) {
  const score = optionalNumber(item.score);
  if (score >= 70) return { key: "priority", text: "优先研究" };
  if (score >= 55) return { key: "watch", text: "候补观察" };
  return { key: "reserve", text: "暂不优先" };
}

function radarScoreRow(label, value, maximum) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? Math.max(0, Math.min(maximum, amount)) : 0;
  return "<div class=\"radar-score-row\"><span>" + label + "</span><progress max=\"" + maximum + "\" value=\"" + safe.toFixed(1) + "\">" + safe.toFixed(1) + "/" + maximum + "</progress><b>" + (Number.isFinite(amount) ? amount.toFixed(1) : "--") + " / " + maximum + "</b></div>";
}

function radarPanelId(item) {
  return "radar-detail-" + String(item.id || item.market + ":" + item.code).replace(/[^A-Za-z0-9_-]/g, "-");
}

function radarCandidateDetail(item) {
  const metrics = item.metrics || {}, components = item.components || {};
  const marketData = marketSummary(item.market);
  const relation = Number.isFinite(Number(marketData.weight))
    ? "当前组合中的" + item.market + "市值占比约 " + marketData.weight.toFixed(1) + "%；本项仅提示市场重叠，尚未计算行业相关性。"
    : "当前组合的市场仓位数据不完整，暂不计算组合适配扣分。";
  const reasons = Array.isArray(item.reasons) && item.reasons.length ? item.reasons : ["当前没有足够的正向依据"];
  const risks = Array.isArray(item.risks) && item.risks.length ? item.risks : ["公开快照无法覆盖财报、公告与突发事件风险"];
  const pe = optionalNumber(metrics.pe), pb = optionalNumber(metrics.pb);
  const levels = radarLevelsForItem(item);
  const levelNote = levels.status === "ready"
    ? "10日价位依据 " + levels.bars + " 根日线，历史截至 " + levels.baseDate + "；上沿是历史波动情景，不是目标价；止损参考需以日收盘确认。"
    : "10日价位暂不可算：" + levels.reason + "。";
  return "<div class=\"radar-detail\"><section><h4>评分拆解</h4><div class=\"radar-score-breakdown\">" + radarScoreRow("趋势动量", components.trend, 35) + radarScoreRow("流动性与规模", components.liquidity, 30) + radarScoreRow("短期波动", components.risk, 20) + radarScoreRow("估值可比性", components.quality, 15) + "</div></section><section class=\"radar-evidence\"><div><h4>为什么进入候选</h4><ul>" + reasons.map(function (reason) { return "<li>" + escapeHtml(reason) + "</li>"; }).join("") + "</ul></div><div><h4>反方与风险</h4><ul>" + risks.map(function (risk) { return "<li>" + escapeHtml(risk) + "</li>"; }).join("") + "</ul></div></section><section class=\"radar-evidence radar-evidence-metrics\"><div><h4>快照指标</h4><p>60日涨跌 " + pct(metrics.return60d) + " · 最近交易日振幅 " + ratioPct(metrics.amplitude, 2) + " · 换手率 " + ratioPct(metrics.turnoverRate, 2) + " · 成交额 " + radarCompactMoney(metrics.amount, item.currency) + " · 总市值 " + radarCompactMoney(metrics.marketCap, item.currency) + " · PE " + (Number.isFinite(pe) ? pe.toFixed(1) : "--") + " · PB " + (Number.isFinite(pb) ? pb.toFixed(1) : "--") + "</p></div><div><h4>价位与持仓关系</h4><p>" + escapeHtml(levelNote + " " + relation) + "</p></div></section><footer>行情来源：" + escapeHtml(item.source || "东方财富行情中心") + " · 行情时间 " + escapeHtml(radarQuoteTimestamp(item)) + " · 扫描于 " + escapeHtml(radarTimestamp(item.fetchedAt)) + "。研究优先级不是上涨概率，也不等于买入建议。</footer></div>";
}

function radarPricePlanMarkup(item) {
  const metrics = item.metrics || {}, levels = radarLevelsForItem(item);
  const cached = radarEffectiveLoadState(item) !== "fresh";
  const quoteLabel = (cached ? "缓存 · 行情 " : "行情 ") + radarQuoteShortTimestamp(item) + " · 最近交易日 " + pct(metrics.changePct);
  const loading = levels.status === "loading" || levels.loading;
  const wrapperClass = "radar-price-plan " + (loading ? "is-loading" : levels.status === "ready" ? "is-ready" : levels.status === "error" ? "is-error" : "is-unavailable");
  const upperReady = levels.status === "ready" && Number.isFinite(levels.upper) && Number.isFinite(levels.upperPct);
  const stopReady = levels.status === "ready" && Number.isFinite(levels.stop) && Number.isFinite(levels.stopPct);
  const upperValue = upperReady ? nativeMoney(levels.upper, item.currency) : "--";
  const upperNote = upperReady ? "较当前 " + pct(levels.upperPct) + " · 非目标价" : levels.reason;
  const stopValue = stopReady ? nativeMoney(levels.stop, item.currency) : "--";
  const stopNote = stopReady ? "日收盘低于 · 较当前 " + pct(levels.stopPct) : levels.status === "ready" ? levels.stopReason : levels.reason;
  return "<dl class=\"" + wrapperClass + "\" aria-label=\"" + escapeHtml(item.name) + "未来10个交易日价格参考\" aria-busy=\"" + loading + "\"><div class=\"radar-price-point is-current\"><dt>当前价</dt><dd>" + nativeMoney(metrics.price, item.currency) + "</dd><small>" + escapeHtml(quoteLabel) + "</small></div><div class=\"radar-price-point is-upper\"><dt>10日参考上沿</dt><dd class=\"" + (upperReady ? "positive" : "") + "\">" + upperValue + "</dd><small>" + escapeHtml(upperNote || "正在补齐历史日线") + "</small></div><div class=\"radar-price-point is-stop\"><dt>风控止损参考</dt><dd class=\"" + (stopReady ? "negative" : "") + "\">" + stopValue + "</dd><small>" + escapeHtml(stopNote || "正在补齐历史日线") + "</small></div></dl>";
}

function radarCandidateRow(item, displayRank) {
  const metrics = item.metrics || {}, band = radarBandLabel(item);
  const saved = state.saved.some(function (entry) { return entry.id === item.id; });
  const expanded = state.expandedRadarId === item.id;
  const panelId = radarPanelId(item);
  const primaryReason = Array.isArray(item.reasons) && item.reasons.length ? item.reasons[0] : "等待更多有效数据";
  const score = optionalNumber(item.score);
  const cached = radarEffectiveLoadState(item) !== "fresh";
  const cacheLabel = cached ? " · 缓存 " + radarTimestamp(item.fetchedAt).split(" ")[0] : "";
  return "<li class=\"radar-candidate " + (expanded ? "is-expanded " : "") + (cached ? "is-cached" : "") + "\"><article><div class=\"radar-candidate-main\"><span class=\"radar-rank\">#" + displayRank + "</span><div class=\"radar-security\">" + marketLabel(item.market) + "<h3>" + escapeHtml(item.name) + "</h3><p>" + escapeHtml(item.code + cacheLabel) + "</p></div><div class=\"radar-score\"><span class=\"radar-band " + band.key + "\">" + band.text + "</span><strong>" + (Number.isFinite(score) ? score.toFixed(1) : "--") + "</strong><meter min=\"0\" max=\"100\" value=\"" + (Number.isFinite(score) ? score.toFixed(1) : "0") + "\">" + (Number.isFinite(score) ? score.toFixed(1) : "--") + "/100</meter></div>" + radarPricePlanMarkup(item) + "<div class=\"radar-thesis\"><span>入选依据</span><p>" + escapeHtml(primaryReason) + "</p></div><div class=\"radar-candidate-actions\"><button class=\"outline-button\" type=\"button\" data-toggle-radar=\"" + escapeHtml(item.id) + "\" aria-expanded=\"" + expanded + "\" aria-controls=\"" + panelId + "\">" + (expanded ? "收起依据" : "查看依据") + "</button><button class=\"" + (saved ? "secondary-button" : "primary-button") + "\" type=\"button\" data-toggle-watch=\"" + escapeHtml(item.id) + "\" aria-pressed=\"" + saved + "\">" + (saved ? "移出观察" : "加入观察") + "</button></div></div><section id=\"" + panelId + "\" aria-label=\"" + escapeHtml(item.name) + "评分依据\"" + (expanded ? "" : " hidden") + ">" + radarCandidateDetail(item) + "</section></article></li>";
}

function radarMarketStat(market) {
  const snapshot = state.radarMarkets[market];
  const usable = isRadarSnapshot(snapshot, market);
  const pool = usable ? optionalNumber(snapshot.poolSize) : NaN;
  const priority = usable ? snapshot.candidates.filter(function (item) { return optionalNumber(item.score) >= 70; }).length : 0;
  const loadState = radarEffectiveLoadState(snapshot);
  const expired = Boolean(snapshot && snapshot.loadState === "fresh" && loadState === "cached");
  const stateText = loadState === "fresh" ? "本次已更新" : loadState === "cached" ? expired ? "缓存 · 超过6小时" : snapshot && snapshot.error ? "缓存 · 更新失败" : "上次缓存" : loadState === "error" ? "本次失败" : "等待扫描";
  const cardClass = loadState === "error" || !snapshot ? "is-error" : loadState === "cached" ? "is-partial" : "";
  const rawSize = usable ? optionalNumber(snapshot.rawSize) : NaN;
  const note = loadState === "error" ? snapshot.error || "本市场扫描失败" : loadState === "cached" ? "显示 " + radarTimestamp(snapshot.fetchedAt) + " 的缓存；" + (expired ? "已超过6小时，页面会自动刷新。" : snapshot.error ? "本次更新失败。" : "正在获取本次结果。") : "按本市场自身分布评分；候选数量不足200只时不会发布本期排名。";
  return "<article class=\"radar-market-stat " + cardClass + "\"><header><span>" + marketLabel(market) + "</span><small>" + escapeHtml(stateText) + "</small></header><dl><div><dt>有效候选</dt><dd>" + (Number.isFinite(pool) ? pool : "--") + "<small>只</small></dd></div><div><dt>优先研究</dt><dd>" + (usable ? priority : "--") + "<small>只</small></dd></div><div><dt>原始扫描</dt><dd>" + (Number.isFinite(rawSize) ? rawSize : "--") + "<small>只</small></dd></div></dl><p>" + escapeHtml(note) + "</p><progress max=\"500\" value=\"" + (Number.isFinite(rawSize) ? Math.min(500, rawSize) : 0) + "\">" + (Number.isFinite(rawSize) ? rawSize : 0) + "/500</progress></article>";
}

function radarWatchAside() {
  const live = new Map(state.radarRows.map(function (item) { return [item.id, item]; }));
  const owned = radarOwnedSets();
  const saved = state.saved.slice().reverse();
  return "<aside class=\"card radar-watch-aside\" aria-labelledby=\"radar-watch-title\"><header><div><h2 id=\"radar-watch-title\" tabindex=\"-1\">观察清单</h2><span>仅保存在当前浏览器</span></div><b>" + saved.length + "</b></header>" + (saved.length ? saved.map(function (entry) {
    const current = live.get(entry.id), item = current || entry;
    const score = optionalNumber(item.score), isOwned = radarCandidateIsOwned(item, owned);
    const added = radarTimestamp(entry.addedAt || entry.fetchedAt);
    const status = isOwned ? "已持有 · 自动退出候选排序" : current ? (radarEffectiveLoadState(current) === "fresh" ? "当前研究分 " : "缓存研究分 ") + (Number.isFinite(score) ? score.toFixed(1) : "--") : "已退出本期候选 · 加入时 " + (Number.isFinite(score) ? score.toFixed(1) + "分" : "未评分") + " · " + added;
    return "<article class=\"radar-saved-row" + (isOwned ? " is-owned" : current ? "" : " is-archived") + "\">" + marketLabel(item.market) + "<div><strong>" + escapeHtml(item.name) + "</strong><span>" + escapeHtml(item.code) + " · " + escapeHtml(status) + "</span></div><button type=\"button\" class=\"text-button\" data-toggle-watch=\"" + escapeHtml(entry.id) + "\" aria-label=\"将" + escapeHtml(item.name) + "移出观察\">移除</button></article>";
  }).join("") : "<div class=\"radar-empty\"><strong>还没有观察标的</strong><p>先展开评分依据，再把值得继续研究的股票加入这里。</p></div>") + "</aside>";
}

function radarPage() {
  const view = radarPageWindow();
  const allRows = view.rows, totalPages = view.totalPages, start = view.start, pageRows = view.pageRows;
  state.radarPage = view.page;
  const poolTotal = RADAR_MARKETS.reduce(function (total, market) { return total + (Number(state.radarMarkets[market] && state.radarMarkets[market].poolSize) || 0); }, 0);
  const priorityTotal = radarRowsBeforeFilters().filter(function (item) { return optionalNumber(item.score) >= 70; }).length;
  const freshMarketCount = RADAR_MARKETS.filter(function (market) { return radarEffectiveLoadState(state.radarMarkets[market]) === "fresh"; }).length;
  let displayStatus = state.radarStatus;
  if (displayStatus !== "loading" && poolTotal && freshMarketCount === 0) displayStatus = state.radarError ? "stale" : "cached";
  else if (displayStatus !== "loading" && poolTotal && freshMarketCount < RADAR_MARKETS.length) displayStatus = "partial";
  const scanStatus = displayStatus === "loading" ? "正在扫描三地市场，保留上次结果供查看…" : displayStatus === "error" ? "三地市场本次扫描均失败。" + (state.radarError || "请稍后重试。") : displayStatus === "stale" ? "三地市场本次扫描均失败，当前仅展示已明确标记的缓存。" + (state.radarError || "") : displayStatus === "partial" ? "部分市场未完成更新；缓存候选已标记并排在本次结果之后。" + (state.radarError ? " " + state.radarError : "") : displayStatus === "cached" ? "正在展示超过6小时的上次扫描结果，页面会自动尝试刷新。" : "三地市场扫描完成。";
  const marketOptions = ["全部"].concat(RADAR_MARKETS).map(function (market) {
    const count = market === "全部" ? poolTotal : Number(state.radarMarkets[market] && state.radarMarkets[market].poolSize) || 0;
    return "<button type=\"button\" data-radar-market=\"" + market + "\" aria-pressed=\"" + (state.watchMarket === market) + "\">" + market + " <small>" + count + "</small></button>";
  }).join("");
  const bandOptions = [["priority", "优先研究"], ["watch", "候补观察"], ["reserve", "暂不优先"], ["all", "全部分数"]].map(function (option) {
    return "<button type=\"button\" data-radar-band=\"" + option[0] + "\" aria-pressed=\"" + (state.radarBand === option[0]) + "\">" + option[1] + "</button>";
  }).join("");
  const method = "<details class=\"card radar-method-card\"><summary><b>怎么判断选择</b><small>展开查看研究优先级的计算方法 · 模型 radar-v1.1</small></summary><div class=\"radar-method-list\"><div><strong>第一步 · 资格门槛</strong><span>排除无有效价格、成交额或市值的证券；排除 ST、退市风险、ETF、基金、权证、牛熊证和杠杆/反向产品。</span></div><div><strong>第二步 · 同市场评分</strong><span>60日趋势25 + 最近交易日动量10；成交额20 + 市值10；振幅稳定12 + 最近交易日涨跌稳定8；相对PE9 + PB6。全部按同市场分位计算。</span></div><div><strong>第三步 · 人工复核</strong><span>70分以上只代表优先研究。仍要检查公告、财报、行业和组合重叠；页面不会直接给出买入或仓位建议。</span></div><div><strong>如何使用</strong><span>优先展开高分股票的依据与反方风险，加入观察后持续跟踪；不要只看最近一次涨幅做决定。</span></div></div></details>";
  const levelStates = pageRows.map(radarLevelsForItem);
  const readyLevels = levelStates.filter(function (levels) { return levels.status === "ready"; }).length;
  const loadingLevels = levelStates.filter(function (levels) { return levels.status === "loading" || levels.loading; }).length;
  const unavailableLevels = Math.max(0, pageRows.length - readyLevels - loadingLevels);
  const levelProgress = !pageRows.length ? "当前无待计算股票" : loadingLevels
    ? "10日价位计算中 " + readyLevels + "/" + pageRows.length
    : "10日价位已计算 " + readyLevels + "/" + pageRows.length + (unavailableLevels ? " · " + unavailableLevels + "只数据不足" : "");
  const results = pageRows.length ? "<p class=\"radar-level-progress\" role=\"status\" aria-live=\"polite\">" + escapeHtml(levelProgress) + "</p><ol class=\"radar-candidate-list\">" + pageRows.map(function (item, index) { return radarCandidateRow(item, start + index + 1); }).join("") + "</ol>" : "<div class=\"radar-empty\"><strong>没有符合当前条件的候选</strong><p>可以切换到“全部分数”或清除搜索条件。</p><button type=\"button\" class=\"outline-button\" data-radar-clear>清除筛选</button></div>";
  const pagination = "<nav class=\"radar-pagination\" aria-label=\"候选结果分页\"><button type=\"button\" data-radar-page=\"" + (state.radarPage - 1) + "\"" + (state.radarPage <= 1 ? " disabled" : "") + ">上一页</button><span>第 " + state.radarPage + " / " + totalPages + " 页</span><button type=\"button\" data-radar-page=\"" + (state.radarPage + 1) + "\"" + (state.radarPage >= totalPages ? " disabled" : "") + ">下一页</button></nav>";
  return "<main class=\"page-shell radar-page\"><header class=\"radar-page-heading\"><div><h1 class=\"page-title\">机会雷达</h1><p class=\"page-subtitle\">从三地高流动性股票中筛出值得优先研究的候选；研究分只用于排序，不代表未来上涨概率。</p></div><small>有效基础池 <b>" + (poolTotal || "--") + " 只</b><br/>优先研究 " + priorityTotal + " 只</small></header><section class=\"radar-scan-grid\" aria-busy=\"" + (state.radarStatus === "loading") + "\">" + RADAR_MARKETS.map(radarMarketStat).join("") + "</section><p class=\"radar-scan-status " + (displayStatus === "error" || displayStatus === "stale" ? "error" : "") + "\" role=\"status\" aria-live=\"polite\">" + escapeHtml(scanStatus) + "</p>" + method + "<section class=\"card radar-toolbar\" role=\"search\" aria-label=\"筛选机会候选\"><label class=\"radar-search\"><span>搜索股票</span><input type=\"search\" value=\"" + escapeHtml(state.radarQuery) + "\" placeholder=\"输入名称或代码\" data-radar-search></label><fieldset class=\"radar-filter-group\"><legend>市场</legend><div class=\"radar-filter-options\">" + marketOptions + "</div></fieldset><fieldset class=\"radar-filter-group\"><legend>研究级别</legend><div class=\"radar-filter-options\">" + bandOptions + "</div></fieldset><label class=\"radar-sort\"><span>排序</span><select data-radar-sort><option value=\"score\"" + (state.radarSort === "score" ? " selected" : "") + ">研究优先级</option><option value=\"trend\"" + (state.radarSort === "trend" ? " selected" : "") + ">60日趋势</option><option value=\"liquidity\"" + (state.radarSort === "liquidity" ? " selected" : "") + ">成交活跃度</option><option value=\"risk\"" + (state.radarSort === "risk" ? " selected" : "") + ">短期波动</option><option value=\"change\"" + (state.radarSort === "change" ? " selected" : "") + ">最近交易日涨跌</option></select></label><p class=\"radar-result-status\" role=\"status\">筛选后 " + allRows.length + " 只，当前显示 " + (pageRows.length ? start + 1 : 0) + "–" + (start + pageRows.length) + "。已排除当前持仓中的同代码或同名证券。</p></section><div class=\"radar-content-grid\"><section class=\"card radar-results-card\" aria-labelledby=\"radar-results-title\"><header class=\"radar-results-head\"><div><h2 id=\"radar-results-title\" tabindex=\"-1\">候选股票</h2><p>先看评分依据和反方风险，再决定是否加入观察。</p></div><span>每页 " + RADAR_PAGE_SIZE + " 只</span></header>" + (state.radarStatus === "loading" && !state.radarRows.length ? "<div class=\"radar-loading\"><strong>正在建立600+股票候选池…</strong><p>A股、港股、美股分别扫描，通常需要几秒钟。</p></div>" : results + pagination) + "</section>" + radarWatchAside() + "</div></main>";
}

function soldDateValue(row) {
  const value = String(row && row.sellDate || "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function soldReturnRate(row) {
  const recorded = optionalNumber(row && row.pnlRate);
  if (Number.isFinite(recorded)) return recorded;
  const cost = optionalNumber(row && row.purchaseCostCny), pnl = optionalNumber(row && row.pnlCny);
  return Number.isFinite(cost) && cost > 0 && Number.isFinite(pnl) ? pnl / cost * 100 : NaN;
}

function soldSortValue(row) {
  if (state.tradeSort === "pnl") return optionalNumber(row && row.pnlCny);
  if (state.tradeSort === "rate") return soldReturnRate(row);
  return soldDateValue(row);
}

function compareSoldRows(left, right) {
  const a = soldSortValue(left), b = soldSortValue(right);
  const aMissing = state.tradeSort === "date" ? !a : !Number.isFinite(a);
  const bMissing = state.tradeSort === "date" ? !b : !Number.isFinite(b);
  if (aMissing || bMissing) {
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
  } else {
    const order = state.tradeSort === "date" ? a.localeCompare(b) : a - b;
    if (order) return state.tradeSortDirection === "asc" ? order : -order;
  }
  return (soldDateValue(right) || "").localeCompare(soldDateValue(left) || "") || String(left && left.name || "").localeCompare(String(right && right.name || ""), "zh-CN");
}

function tradeDateRangeInvalid() {
  return Boolean(state.tradeDateStart && state.tradeDateEnd && state.tradeDateStart > state.tradeDateEnd);
}

function filteredSortedSoldRows() {
  if (tradeDateRangeInvalid()) return [];
  return state.rows.filter(function (row) {
    if (row.status !== "sold" || (state.tradeMarket !== "全部" && row.market !== state.tradeMarket)) return false;
    const date = soldDateValue(row);
    if (state.tradeDateStart && (!date || date < state.tradeDateStart)) return false;
    if (state.tradeDateEnd && (!date || date > state.tradeDateEnd)) return false;
    return true;
  }).slice().sort(compareSoldRows);
}

function tradeFiltersActive() {
  return state.tradeMarket !== "全部" || Boolean(state.tradeDateStart) || Boolean(state.tradeDateEnd);
}

function tradeSortDirectionLabel() {
  if (state.tradeSort === "date") return state.tradeSortDirection === "asc" ? "↑ 最早优先" : "↓ 最新优先";
  return state.tradeSortDirection === "asc" ? "↑ 低到高" : "↓ 高到低";
}

function soldFilterControls() {
  const sortOptions = [["date", "卖出时间"], ["pnl", "盈亏金额"], ["rate", "收益率"]].map(function (option) {
    return "<option value=\"" + option[0] + "\"" + (state.tradeSort === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
  }).join("");
  return "<div class=\"trade-filter-controls\"><div class=\"trade-date-range\" role=\"group\" aria-label=\"卖出日期范围\"><label><span>卖出日期从</span><input type=\"date\" value=\"" + escapeHtml(state.tradeDateStart) + "\" data-trade-date-start></label><span aria-hidden=\"true\">至</span><label><span>卖出日期到</span><input type=\"date\" value=\"" + escapeHtml(state.tradeDateEnd) + "\" data-trade-date-end></label></div><label class=\"trade-sort-field\"><span>排序依据</span><select data-trade-sort>" + sortOptions + "</select></label><button class=\"secondary-button trade-sort-direction\" type=\"button\" data-trade-sort-direction aria-label=\"切换排序方向，当前" + tradeSortDirectionLabel().replace(/[↑↓]\s*/, "") + "\">" + tradeSortDirectionLabel() + "</button>" + (tradeFiltersActive() ? "<button class=\"text-button trade-clear-filter\" type=\"button\" data-clear-trade-filters>清除筛选</button>" : "") + "</div>";
}

function soldEmptyState() {
  const invalid = tradeDateRangeInvalid();
  const title = invalid ? "日期范围需要调整" : "没有匹配的卖出记录";
  const note = invalid ? "起始日期不能晚于结束日期。" : tradeFiltersActive() ? "换一个市场或日期范围试试。" : "完成卖出并保存后，记录会出现在这里。";
  return "<div class=\"empty sold-empty\"><strong>" + title + "</strong><p>" + note + "</p>" + (tradeFiltersActive() ? "<button class=\"secondary-button\" type=\"button\" data-clear-trade-filters>清除筛选</button>" : "") + "</div>";
}

function tradesPage() {
  const soldRows = filteredSortedSoldRows();
  const allSoldCount = state.rows.filter(function (row) { return row.status === "sold"; }).length;
  const purchaseCost = soldRows.reduce(function (total, row) { return total + row.purchaseCostCny; }, 0);
  const saleProceeds = soldRows.reduce(function (total, row) { return total + row.saleProceedsCny; }, 0);
  const realizedPnl = soldRows.reduce(function (total, row) { return total + row.pnlCny; }, 0);
  const wins = soldRows.filter(function (row) { return row.pnlCny > 0; }).length;
  const winRate = soldRows.length ? wins / soldRows.length * 100 : 0;
  return "<main class=\"page-shell\"><div class=\"filter-bar\"><div><h1 class=\"page-title\" style=\"margin:0\">卖出记录</h1><p class=\"section-helper\">记录已完成的卖出批次，并自动计入固定手续费。</p></div><button class=\"primary-button\" type=\"button\" data-open-holding-editor=\"sold\">录入卖出</button></div><section class=\"trade-kpis\">" +
    tradeKpi("已卖出批次", soldRows.length + " 笔", "盈利 " + wins + " 笔 · 胜率 " + winRate.toFixed(0) + "%") + tradeKpi("买入成本", money(purchaseCost, 0), "买入价 × 数量，人民币折算") + tradeKpi("卖出金额", money(saleProceeds, 0), "卖出价 × 数量，人民币折算") + tradeKpi("已实现盈亏", signed(realizedPnl, 0), "卖出金额 − 买入成本", tone(realizedPnl)) + "</section>" +
    "<section class=\"card table-card sold-record-section\"><div class=\"trade-toolbar\"><div class=\"trade-toolbar-heading\">" + soldMarketTabs() + "<span class=\"trade-source\">卖出批次来自 GitHub holdings.json</span></div>" + soldFilterControls() + "</div><p class=\"trade-result-summary" + (tradeDateRangeInvalid() ? " is-error" : "") + "\" role=\"status\">" + (tradeDateRangeInvalid() ? "日期范围无效，请调整后查看记录。" : "当前显示 " + soldRows.length + " / " + allSoldCount + " 笔卖出记录") + "</p><div class=\"table-scroll sold-record-desktop\"><table class=\"sold-record-table\"><thead><tr><th>卖出日期</th><th>市场</th><th>股票</th><th>买入价</th><th>卖出价</th><th>数量</th><th>买入成本</th><th>卖出金额</th><th>已实现盈亏</th><th>收益率</th></tr></thead><tbody>" + (soldRows.length ? soldRows.map(soldRecordRow).join("") : "<tr><td colspan=\"10\">" + soldEmptyState() + "</td></tr>") + "</tbody></table></div><div class=\"sold-record-mobile\">" + (soldRows.length ? soldRows.map(soldRecordMobileCard).join("") : soldEmptyState()) + "</div></section></main>";
}

function soldMarketTabs() {
  const allSold = state.rows.filter(function (row) { return row.status === "sold"; });
  return "<div class=\"tab-group\">" + ["全部", "A股", "港股", "美股"].map(function (market) {
    const count = market === "全部" ? allSold.length : allSold.filter(function (row) { return row.market === market; }).length;
    return "<button type=\"button\" class=\"" + (state.tradeMarket === market ? "active" : "") + "\" data-trade-market=\"" + market + "\">" + market + " <small>" + count + "</small></button>";
  }).join("") + "</div>";
}

function soldRecordRow(row) {
  const nativePnl = row.pnlCny / (COST_REFERENCE_RATES[row.currency] || 1);
  const returnRate = soldReturnRate(row);
  return "<tr><td>" + escapeHtml(row.sellDate || "—") + "</td><td>" + marketLabel(row.market) + "</td><td><strong>" + escapeHtml(row.name) + "</strong><span class=\"stock-code\">" + escapeHtml(row.code) + "</span></td><td class=\"number-cell\">" + nativeMoney(row.cost, row.currency) + "</td><td class=\"number-cell\">" + nativeMoney(row.sellPrice, row.currency) + "</td><td>" + row.qty.toLocaleString("zh-CN") + "</td><td class=\"number-cell\">" + money(row.purchaseCostCny, 0) + "</td><td class=\"number-cell\">" + money(row.saleProceedsCny, 0) + "</td><td class=\"number-cell " + tone(row.pnlCny) + "\"><strong>" + signed(row.pnlCny, 0) + "</strong><small>" + signedNative(nativePnl, row.currency) + "</small></td><td class=\"number-cell " + tone(returnRate) + "\"><strong>" + pct(returnRate) + "</strong></td></tr>";
}

function soldRecordMobileCard(row) {
  const nativePnl = row.pnlCny / (COST_REFERENCE_RATES[row.currency] || 1), returnRate = soldReturnRate(row);
  return "<article class=\"sold-record-card\"><header><div>" + marketLabel(row.market) + "<span><strong>" + escapeHtml(row.name) + "</strong><small>" + escapeHtml(row.code) + "</small></span></div><time datetime=\"" + escapeHtml(soldDateValue(row)) + "\">" + escapeHtml(row.sellDate || "日期待补") + "</time></header><dl><div><dt>买入价</dt><dd>" + nativeMoney(row.cost, row.currency) + "</dd></div><div><dt>卖出价</dt><dd>" + nativeMoney(row.sellPrice, row.currency) + "</dd></div><div><dt>数量</dt><dd>" + row.qty.toLocaleString("zh-CN") + "</dd></div><div><dt>卖出金额</dt><dd>" + money(row.saleProceedsCny, 0) + "</dd></div></dl><footer><div><span>已实现盈亏</span><strong class=\"" + tone(row.pnlCny) + "\">" + signed(row.pnlCny, 0) + "</strong><small class=\"" + tone(row.pnlCny) + "\">" + signedNative(nativePnl, row.currency) + "</small></div><div><span>收益率</span><strong class=\"" + tone(returnRate) + "\">" + pct(returnRate) + "</strong></div></footer></article>";
}

function tradeKpi(label, value, note, toneClass) {
  return "<article class=\"card trade-kpi\"><span>" + label + "</span><strong class=\"" + (toneClass || "") + "\">" + value + "</strong><small>" + note + "</small></article>";
}

function tradeRow(trade) {
  const amount = trade.price * trade.qty;
  return "<tr><td>" + escapeHtml(trade.date) + "</td><td>" + marketLabel(trade.market) + "</td><td><strong>" + escapeHtml(trade.name) + "</strong><span class=\"stock-code\">" + escapeHtml(trade.code) + "</span></td><td class=\"" + (trade.action === "buy" ? "positive" : "negative") + "\">" + (trade.action === "buy" ? "买入" : "卖出") + "</td><td class=\"number-cell\">" + nativeMoney(trade.price, trade.currency) + "</td><td>" + trade.qty + "</td><td class=\"number-cell\">" + nativeMoney(amount, trade.currency) + "</td><td>" + escapeHtml(trade.note || "—") + "</td><td><button class=\"text-link\" type=\"button\" data-delete-trade=\"" + escapeHtml(trade.id) + "\">删除</button></td></tr>";
}

function tradeForm() {
  const fields = [
    ["日期", "date", "date", new Date().toISOString().slice(0, 10)],
    ["操作", "action", "select", "buy"],
    ["市场", "market", "select", "A股"],
    ["股票代码", "code", "text", ""],
    ["名称", "name", "text", ""],
    ["成交价", "price", "number", ""],
    ["数量", "qty", "number", ""],
    ["币种", "currency", "select", "CNY"],
    ["行情代码", "sina", "text", ""],
    ["备注", "note", "text", ""]
  ];
  return "<form class=\"trade-form\" id=\"trade-form\">" + fields.map(function (field) {
    const label = field[0], key = field[1], type = field[2], value = field[3];
    if (type === "select") {
      const options = key === "action" ? [["buy", "买入"], ["sell", "卖出"]] : key === "market" ? [["A股", "A股"], ["港股", "港股"], ["美股", "美股"]] : [["CNY", "CNY"], ["HKD", "HKD"], ["USD", "USD"]];
      return "<label class=\"form-field\"><span>" + label + "</span><select name=\"" + key + "\">" + options.map(function (item) { return "<option value=\"" + item[0] + "\"" + (item[0] === value ? " selected" : "") + ">" + item[1] + "</option>"; }).join("") + "</select></label>";
    }
    return "<label class=\"form-field" + (key === "note" ? " full" : "") + "\"><span>" + label + "</span><input name=\"" + key + "\" type=\"" + type + "\" value=\"" + escapeHtml(value) + "\"" + (key === "price" ? " step=\"0.0001\" min=\"0\"" : "") + (key === "qty" ? " step=\"1\" min=\"0\"" : "") + " required /></label>";
  }).join("") + "<button class=\"primary-button form-submit\" type=\"submit\">保存交易</button></form>";
}

function reviewPage() {
  const data = summary();
  const series = portfolioValueSeries();
  const maxDrawdown = calculateDrawdown(series);
  const actions = state.rows.filter(function (row) { return row.status === "holding"; }).slice().sort(function (a, b) {
    const aMissing = !Number.isFinite(a.pnlCny), bMissing = !Number.isFinite(b.pnlCny);
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    return a.pnlCny - b.pnlCny;
  }).slice(0, 3);
  const latestTrades = state.trades.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 6);
  const markets = MARKET_ORDER.map(marketSummary);
  const finiteMarketPnls = markets.map(function (item) { return Math.abs(item.pnl); }).filter(Number.isFinite);
  const maxMarketPnl = finiteMarketPnls.length ? Math.max.apply(null, finiteMarketPnls.concat([1])) : NaN;
  const concentration = topFiveConcentration();
  const reviewIncomplete = !Number.isFinite(data.totalPnl) || !Number.isFinite(maxDrawdown) || !Number.isFinite(concentration);
  return "<main class=\"page-shell\"><div class=\"filter-bar\"><h1 class=\"page-title\" style=\"margin:0\">投资复盘 · " + new Date().getFullYear() + "年" + (new Date().getMonth() + 1) + "月</h1><div class=\"segmented\"><button>本周</button><button class=\"active\">本月</button><button>本季度</button></div></div><section class=\"review-grid\"><article class=\"card review-card\"><h2>① 本期组合表现如何</h2><div class=\"review-stat\"><strong class=\"" + tone(data.totalPnl) + "\">" + pct(data.totalRate) + "</strong><span>组合累计收益率</span></div><div class=\"review-canvas\"><canvas class=\"line-chart\" data-chart=\"review\"></canvas></div></article><article class=\"card review-card\"><h2>② 收益主要来自哪里</h2>" + markets.map(function (item) { const available = Number.isFinite(item.pnl) && Number.isFinite(maxMarketPnl); const pctValue = available ? Math.min(100, Math.abs(item.pnl) / maxMarketPnl * 100) : 0; return "<div class=\"bar-contribution\"><span>" + item.market + "</span><div class=\"bar-track\">" + (available ? "<div class=\"bar-fill " + (item.pnl < 0 ? "negative" : "") + "\" style=\"width:" + pctValue.toFixed(0) + "%\"></div>" : "") + "</div><b class=\"" + tone(item.pnl) + "\">" + signed(item.pnl, 0) + "</b></div>"; }).join("") + "</article><article class=\"card review-card\"><h2>③ 哪些决策需要复核</h2><div class=\"review-highlight\"><span>最大回撤（30日估算）</span><strong class=\"negative\">" + (Number.isFinite(maxDrawdown) ? pct(-maxDrawdown) : "--") + "</strong></div><div class=\"review-highlight\"><span>前五大持仓集中度</span><strong>" + (Number.isFinite(concentration) ? concentration.toFixed(1) + "%" : "--") + "</strong></div><p class=\"section-helper\">" + (reviewIncomplete ? "估值或历史行情不足，暂不输出完整复盘指标。" : "复核亏损扩大和高集中度的仓位，更新后续跟踪指标。") + "</p></article></section><section class=\"review-bottom\"><article class=\"card timeline-card\"><h2>本期关键交易</h2><div class=\"table-scroll\"><table class=\"timeline-table\"><thead><tr><th>时间</th><th>事件 / 操作</th><th>交易备注</th><th>复盘结论</th></tr></thead><tbody>" + (latestTrades.length ? latestTrades.map(function (trade) { return "<tr><td>" + escapeHtml(trade.date) + "</td><td><b>" + (trade.action === "buy" ? "买入 " : "卖出 ") + escapeHtml(trade.name) + "</b><br/><span class=\"stock-code\">" + escapeHtml(trade.code) + " · " + trade.qty + " 股</span></td><td>" + escapeHtml(trade.note || "未填写") + "</td><td><span class=\"action-chip\">" + (trade.action === "buy" ? "等待验证" : "复核收益") + "</span></td></tr>"; }).join("") : "<tr><td colspan=\"4\"><div class=\"empty\">暂无交易记录。</div></td></tr>") + "</tbody></table></div></article><aside class=\"card next-card\"><h2>下期关注事项</h2>" + actions.map(function (row, index) { return "<div class=\"next-item\"><b class=\"order-num\">" + (index + 1) + "</b><div><strong>" + escapeHtml(row.name) + " <span class=\"stock-code\">" + escapeHtml(row.code) + "</span></strong><p>" + escapeHtml(row.analysis.text) + "</p></div><button class=\"text-link\" type=\"button\" data-tab=\"actions\">前往</button></div>"; }).join("") + "</aside></section></main>";
}

function pointOnOrBefore(history, date) {
  let found = null;
  for (let index = 0; index < history.length; index += 1) {
    if (history[index].date <= date) found = history[index];
    if (history[index].date > date) break;
  }
  return found;
}

function portfolioSeries(days) {
  const netInvested = summary().netInvested;
  return portfolioValueSeries(days).map(function (point) { return { date: point.date, value: point.value - netInvested }; });
}

function portfolioValueSeries(days) {
  const rows = state.rows.filter(function (row) { return row.status !== "sold"; });
  if (!rows.length) return [];
  const currentValue = summary().value;
  if (!Number.isFinite(currentValue)) return [];
  const historyLimit = Math.max(1, (days || 30) - 1);
  const dates = Array.from(new Set(rows.flatMap(function (row) {
    return (state.histories[row.sina] || []).map(function (point) { return point.date; });
  }))).sort().slice(-historyLimit);
  if (!dates.length) return [{ date: "当前", value: currentValue }];
  const series = dates.map(function (date) {
    let value = 0;
    rows.forEach(function (row) {
      const history = state.histories[row.sina] || [];
      const point = pointOnOrBefore(history, date);
      const price = point && Number(point.close) > 0 ? Number(point.close) : row.price;
      value += price * row.qty * (state.rates[row.currency] || 1);
    });
    return { date: date, value: value };
  });
  series.push({ date: "当前", value: currentValue });
  return series;
}

function calculateDrawdown(points) {
  const valid = (points || []).filter(function (point) { return Number.isFinite(Number(point.value)); });
  if (valid.length < 2) return NaN;
  let peak = valid[0].value, max = 0;
  valid.forEach(function (point) { peak = Math.max(peak, point.value); if (peak) max = Math.max(max, (peak - point.value) / peak * 100); });
  return max;
}

function topFiveConcentration() {
  const data = summary();
  if (!Number.isFinite(data.value) || data.value <= 0) return NaN;
  const open = data.openRows.filter(function (row) { return Number.isFinite(Number(row.valueCny)); }).slice().sort(function (a, b) { return b.valueCny - a.valueCny; });
  return open.slice(0, 5).reduce(function (n, row) { return n + row.valueCny; }, 0) / data.value * 100;
}

function render() {
  const page = state.tab === "actions" ? actionsPage() : state.tab === "radar" ? radarPage() : state.tab === "trades" ? tradesPage() : overviewPage();
  document.body.classList.toggle("modal-open", state.holdingEditorOpen);
  document.querySelector("#app").innerHTML = topNav() + page + "<footer class=\"page-footer\">数据来自公开行情接口，可能有延迟。港美持仓市值与今日盈亏按最新汇率折算；历史买卖成本按记录或参考汇率固定。页面中的分析和观察内容仅作研究提示，不构成投资建议。</footer>" + holdingEditorModal() + toastMarkup();
  syncBrandVisuals();
  if (state.holdingEditorOpen) window.requestAnimationFrame(syncHoldingFormUi);
  scheduleJarDeposits();
  requestAnimationFrame(drawCharts);
  if (state.tab === "radar") requestAnimationFrame(scheduleVisibleRadarHistoryLoad);
}

function chartLabelIndexes(length, days, width) {
  if (length <= 0) return [];
  const compact = width < 620;
  const narrow = width < 290;
  const desired = narrow ? 4 : compact ? (days <= 7 ? 4 : days <= 30 ? 5 : 6) : (days <= 7 ? 7 : days <= 30 ? 8 : 9);
  if (length <= desired) return Array.from({ length: length }, function (_, index) { return index; });
  const indexes = [];
  for (let index = 0; index < desired; index += 1) indexes.push(Math.round((length - 1) * index / (desired - 1)));
  return indexes.filter(function (value, index, list) { return list.indexOf(value) === index; });
}

function drawChartCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.floor(rect.width * scale));
  const targetHeight = Math.max(1, Math.floor(rect.height * scale));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const width = rect.width, height = rect.height;
  const days = state.trendDays;
  const points = portfolioSeries(days);
  ctx.clearRect(0, 0, width, height);
  if (!points.length) {
    ctx.fillStyle = "#8993a8";
    ctx.font = "13px -apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("暂无持仓数据", width / 2, height / 2);
    return;
  }
  const series = points.map(function (point) { return point.value; });
  const all = series.concat([0]);
  let min = Math.min.apply(null, all), max = Math.max.apply(null, all);
  const range = Math.max(1, max - min);
  min = Math.min(0, min - range * 0.1);
  max = Math.max(0, max + range * 0.1);
  const left = width < 620 ? 64 : 82, right = width < 620 ? 12 : 24, top = 24, bottom = 34, gridCount = 4;
  const chartHeight = Math.max(1, height - top - bottom);
  const chartWidth = Math.max(1, width - left - right);
  const zeroY = top + (max / (max - min)) * chartHeight;
  ctx.font = "12px -apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif";
  ctx.fillStyle = "#8993a8";
  ctx.textAlign = "right";
  ctx.lineWidth = 1;
  for (let index = 0; index <= gridCount; index += 1) {
    const value = max - (max - min) * index / gridCount;
    const y = top + chartHeight * index / gridCount;
    ctx.strokeStyle = Math.abs(value) < range / gridCount / 2 ? "#b8caf0" : "#e9eef6";
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
    ctx.fillText(formatAxisMoney(value), left - 8, y + 4);
  }
  const labelIndexes = chartLabelIndexes(points.length, days, width);
  labelIndexes.forEach(function (index, labelIndex) {
    const x = left + chartWidth * index / Math.max(1, points.length - 1);
    ctx.textAlign = labelIndex === 0 ? "left" : labelIndex === labelIndexes.length - 1 ? "right" : "center";
    ctx.fillText(formatChartDate(points[index].date, width < 290), x, height - 8);
  });
  const xAt = function (index) { return left + chartWidth * index / Math.max(1, series.length - 1); };
  const yAt = function (value) { return top + (max - value) / (max - min) * chartHeight; };
  ctx.beginPath();
  series.forEach(function (value, index) { index ? ctx.lineTo(xAt(index), yAt(value)) : ctx.moveTo(xAt(index), yAt(value)); });
  ctx.lineTo(width - right, zeroY); ctx.lineTo(left, zeroY); ctx.closePath();
  const fill = ctx.createLinearGradient(0, top, 0, top + chartHeight);
  const zeroStop = Math.max(0, Math.min(1, (zeroY - top) / chartHeight));
  fill.addColorStop(0, "rgba(255,75,75,.15)");
  fill.addColorStop(Math.max(0, zeroStop - 0.002), "rgba(255,75,75,.055)");
  fill.addColorStop(Math.min(1, zeroStop + 0.002), "rgba(6,155,98,.055)");
  fill.addColorStop(1, "rgba(6,155,98,.16)");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  series.forEach(function (value, index) { index ? ctx.lineTo(xAt(index), yAt(value)) : ctx.moveTo(xAt(index), yAt(value)); });
  const stroke = ctx.createLinearGradient(0, top, 0, top + chartHeight);
  stroke.addColorStop(0, "#ff4b4b");
  stroke.addColorStop(Math.max(0, zeroStop - 0.002), "#ff4b4b");
  stroke.addColorStop(Math.min(1, zeroStop + 0.002), "#069b62");
  stroke.addColorStop(1, "#069b62");
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.strokeStyle = "#2169f3";
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(left, zeroY); ctx.lineTo(width - right, zeroY); ctx.stroke();

  const hoverIndex = Number(canvas.dataset.hoverIndex);
  if (canvas.dataset.chart === "portfolio" && Number.isInteger(hoverIndex) && hoverIndex >= 0 && hoverIndex < points.length) {
    const point = points[hoverIndex];
    const x = xAt(hoverIndex), y = yAt(point.value);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#9cb1d4";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + chartHeight); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = point.value >= 0 ? "#ff4b4b" : "#069b62";
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
    const boxWidth = 196, boxHeight = 70;
    const boxX = Math.max(left, Math.min(width - right - boxWidth, x - boxWidth / 2));
    const boxY = Math.max(top + 4, Math.min(top + chartHeight - boxHeight - 4, y - boxHeight - 16));
    ctx.fillStyle = "rgba(255,255,255,.98)"; ctx.strokeStyle = "#dfe6f1"; ctx.lineWidth = 1;
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight); ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
    ctx.textAlign = "left"; ctx.fillStyle = "#6e778d"; ctx.font = "12px -apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif";
    ctx.fillText(point.date, boxX + 14, boxY + 23);
    ctx.fillStyle = "#111a33"; ctx.fillText("累计盈亏", boxX + 14, boxY + 50);
    ctx.textAlign = "right"; ctx.fillStyle = point.value >= 0 ? "#ff4b4b" : "#069b62"; ctx.font = "700 13px -apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif";
    ctx.fillText(signed(point.value, 0), boxX + boxWidth - 14, boxY + 50);
    ctx.restore();
  }
}

function drawCharts() {
  document.querySelectorAll("canvas[data-chart]").forEach(function (canvas) {
    drawChartCanvas(canvas);
    if (canvas.dataset.chart !== "portfolio" || canvas.dataset.pointerReady) return;
    canvas.dataset.pointerReady = "true";
    const updatePointerHover = function (event) {
      const rect = canvas.getBoundingClientRect();
      const left = rect.width < 620 ? 64 : 82;
      const right = rect.width < 620 ? 12 : 24;
      const length = portfolioSeries(state.trendDays).length;
      const relative = Math.max(0, Math.min(rect.width - left - right, event.clientX - rect.left - left));
      canvas.dataset.hoverIndex = String(Math.round(relative / Math.max(1, rect.width - left - right) * Math.max(0, length - 1)));
      drawChartCanvas(canvas);
    };
    canvas.addEventListener("pointermove", updatePointerHover);
    canvas.addEventListener("pointerdown", updatePointerHover);
    canvas.addEventListener("focus", function () {
      canvas.dataset.hoverIndex = String(Math.max(0, portfolioSeries(state.trendDays).length - 1));
      drawChartCanvas(canvas);
    });
    canvas.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const length = portfolioSeries(state.trendDays).length;
      if (!length) return;
      const current = Number.isInteger(Number(canvas.dataset.hoverIndex)) ? Number(canvas.dataset.hoverIndex) : length - 1;
      const next = event.key === "Home" ? 0 : event.key === "End" ? length - 1 : Math.max(0, Math.min(length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
      canvas.dataset.hoverIndex = String(next);
      drawChartCanvas(canvas);
    });
    canvas.addEventListener("pointerleave", function () { delete canvas.dataset.hoverIndex; drawChartCanvas(canvas); });
    canvas.addEventListener("blur", function () { delete canvas.dataset.hoverIndex; drawChartCanvas(canvas); });
  });
}

function formatAxisMoney(value) {
  const abs = Math.abs(value);
  const formatted = abs >= 10000 ? (abs / 10000).toFixed(abs >= 100000 ? 0 : 1) + "万" : Math.round(abs).toLocaleString("zh-CN");
  return (value > 0 ? "+" : value < 0 ? "-" : "") + "¥" + formatted;
}

function formatChartDate(date, compact) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (compact) {
    const parts = date.slice(5).split("-");
    return Number(parts[0]) + "/" + Number(parts[1]);
  }
  return date.slice(5);
}

function applyTrade(trade) {
  if (!trade.affectsHoldings) return;
  const current = state.holdings.find(function (item) { return item.status !== "sold" && item.sina === trade.sina; });
  const feeUsd = Number.isFinite(trade.feeUsd) && trade.feeUsd >= 0 ? trade.feeUsd : FIXED_TRADE_FEE_USD;
  if (trade.action === "buy") {
    const tradePurchaseCost = trade.price * trade.qty * (COST_REFERENCE_RATES[trade.currency] || 1) + feeUsd * COST_REFERENCE_RATES.USD;
    if (current) {
      const priorPurchaseCost = fixedPurchaseCost(current);
      const totalQty = current.qty + trade.qty;
      current.cost = (current.cost * current.qty + trade.price * trade.qty) / totalQty;
      current.qty = totalQty;
      current.purchaseCostCny = priorPurchaseCost + tradePurchaseCost;
      current.buyFeeUsd = (Number.isFinite(current.buyFeeUsd) ? current.buyFeeUsd : 0) + feeUsd;
    } else {
      state.holdings.push({ market: trade.market, code: trade.code, name: trade.name || trade.code, cost: trade.price, qty: trade.qty, currency: trade.currency, purchaseCostCny: tradePurchaseCost, buyFeeUsd: feeUsd, sina: trade.sina, status: "holding", sellPrice: NaN, sellDate: "" });
    }
  } else if (current) {
    const originalQty = current.qty;
    const soldQty = Math.min(originalQty, trade.qty);
    const priorPurchaseCost = fixedPurchaseCost(current);
    const soldPurchaseCost = priorPurchaseCost * soldQty / originalQty;
    const priorBuyFeeUsd = Number.isFinite(current.buyFeeUsd) ? current.buyFeeUsd : 0;
    const soldBuyFeeUsd = priorBuyFeeUsd * soldQty / originalQty;
    const soldRecord = Object.assign({}, current, {
      qty: soldQty,
      status: "sold",
      purchaseCostCny: soldPurchaseCost,
      buyFeeUsd: soldBuyFeeUsd,
      sellPrice: trade.price,
      sellDate: trade.date,
      sellFeeUsd: feeUsd,
      sellProceedsCny: trade.price * soldQty * (COST_REFERENCE_RATES[trade.currency] || 1) - feeUsd * COST_REFERENCE_RATES.USD
    });
    if (soldQty === originalQty) {
      Object.assign(current, soldRecord);
    } else {
      current.qty = originalQty - soldQty;
      current.purchaseCostCny = priorPurchaseCost - soldPurchaseCost;
      current.buyFeeUsd = priorBuyFeeUsd - soldBuyFeeUsd;
      state.holdings.push(soldRecord);
    }
  }
  writeStorage(HOLDING_KEY, state.holdings);
}

function saveTrade(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const trade = normalizeTrade({
    id: "local-" + Date.now(),
    date: data.date, action: data.action, market: data.market, code: data.code, name: data.name,
    price: Number(data.price), qty: Number(data.qty), currency: data.currency, sina: data.sina, note: data.note, feeUsd: FIXED_TRADE_FEE_USD, affectsHoldings: true
  }, state.trades.length);
  if (!trade.date || !trade.code || !trade.sina || !Number.isFinite(trade.price) || !Number.isFinite(trade.qty) || trade.qty <= 0) return;
  state.trades.push(trade);
  writeStorage(TRADE_KEY, state.trades);
  applyTrade(trade);
  rebuildRows();
  state.tab = "trades";
  render();
}

function exportJson(kind) {
  const payload = kind === "trades" ? state.trades : readableHoldingsDocument(state.holdings);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = kind + ".json"; link.click();
  URL.revokeObjectURL(url);
}

function refreshRadarIfStale() {
  if (state.tab !== "radar" || state.radarStatus === "loading") return;
  const allCurrent = RADAR_MARKETS.every(function (market) {
    const snapshot = state.radarMarkets[market];
    return isRadarSnapshot(snapshot, market) && radarEffectiveLoadState(snapshot) === "fresh";
  });
  if (!allCurrent) loadRadar(false);
}

function eventHandlers() {
  window.addEventListener("hashchange", function () {
    const tab = location.hash.slice(1);
    if (!VALID_TABS.includes(tab)) {
      location.hash = "#overview";
      return;
    }
    if (VALID_TABS.includes(tab)) {
      state.tab = tab;
      if (tab !== "actions") state.expandedHoldingKey = "";
      if (tab !== "radar") state.expandedRadarId = "";
      render();
      if (tab === "radar") loadRadar(false);
    }
  });
  document.addEventListener("click", function (event) {
    const openHolding = event.target.closest("[data-open-holding-editor]");
    if (openHolding) { openHoldingEditor(openHolding.dataset.openHoldingEditor); return; }
    const closeHolding = event.target.closest("[data-close-holding-editor]");
    if (closeHolding) { closeHoldingEditor(); return; }
    const retryLookup = event.target.closest("[data-retry-holding-lookup]");
    if (retryLookup) { scheduleHoldingLookup(true); return; }
    const tab = event.target.closest("[data-tab]");
    if (tab) { location.hash = tab.dataset.tab; return; }
    const radarMarket = event.target.closest("[data-radar-market]");
    if (radarMarket) {
      state.watchMarket = ["全部"].concat(RADAR_MARKETS).includes(radarMarket.dataset.radarMarket) ? radarMarket.dataset.radarMarket : "全部";
      state.radarPage = 1;
      state.expandedRadarId = "";
      render();
      window.requestAnimationFrame(function () {
        const control = Array.from(document.querySelectorAll("[data-radar-market]")).find(function (button) { return button.dataset.radarMarket === state.watchMarket && button.offsetParent !== null; });
        if (control) control.focus();
      });
      return;
    }
    const radarBand = event.target.closest("[data-radar-band]");
    if (radarBand) {
      state.radarBand = ["priority", "watch", "reserve", "all"].includes(radarBand.dataset.radarBand) ? radarBand.dataset.radarBand : "priority";
      state.radarPage = 1;
      state.expandedRadarId = "";
      render();
      window.requestAnimationFrame(function () {
        const control = document.querySelector("[data-radar-band=\"" + state.radarBand + "\"]");
        if (control) control.focus();
      });
      return;
    }
    const clearRadar = event.target.closest("[data-radar-clear]");
    if (clearRadar) {
      state.watchMarket = "全部";
      state.radarBand = "priority";
      state.radarSort = "score";
      state.radarQuery = "";
      state.radarPage = 1;
      state.expandedRadarId = "";
      render();
      window.requestAnimationFrame(function () { const input = document.querySelector("[data-radar-search]"); if (input) input.focus(); });
      return;
    }
    const radarPageButton = event.target.closest("[data-radar-page]");
    if (radarPageButton && !radarPageButton.disabled) {
      state.radarPage = Math.max(1, Number(radarPageButton.dataset.radarPage) || 1);
      state.expandedRadarId = "";
      render();
      window.requestAnimationFrame(function () {
        const heading = document.querySelector("#radar-results-title");
        if (heading) {
          heading.focus({ preventScroll: true });
          heading.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      return;
    }
    const toggleRadar = event.target.closest("[data-toggle-radar]");
    if (toggleRadar) {
      const id = toggleRadar.dataset.toggleRadar || "";
      state.expandedRadarId = state.expandedRadarId === id ? "" : id;
      render();
      window.requestAnimationFrame(function () {
        const control = document.querySelector("[data-toggle-radar=\"" + id.replace(/\"/g, "\\\"") + "\"]");
        if (control) control.focus();
      });
      return;
    }
    const toggleWatch = event.target.closest("[data-toggle-watch]");
    if (toggleWatch) {
      const id = toggleWatch.dataset.toggleWatch || "";
      const triggeredFromAside = Boolean(toggleWatch.closest(".radar-watch-aside"));
      const existing = state.saved.findIndex(function (item) { return item.id === id; });
      const previous = state.saved.slice();
      if (existing >= 0) {
        state.saved.splice(existing, 1);
      } else {
        const item = state.radarRows.find(function (candidate) { return candidate.id === id; });
        if (item) state.saved = normalizeWatchlist(state.saved.concat([Object.assign({}, item, { addedAt: new Date().toISOString() })]));
      }
      try {
        writeStorage(WATCH_KEY, state.saved);
        showToast(existing >= 0 ? "已移出观察清单" : "已加入观察清单", "success");
      } catch {
        state.saved = previous;
        showToast("浏览器无法保存观察清单", "error");
      }
      window.requestAnimationFrame(function () {
        const selector = "[data-toggle-watch=\"" + id.replace(/\"/g, "\\\"") + "\"]";
        const controls = Array.from(document.querySelectorAll(selector));
        const preferred = controls.find(function (control) {
          return triggeredFromAside ? control.closest(".radar-watch-aside") : control.closest(".radar-candidate");
        });
        const fallback = controls[0] || document.querySelector("#radar-watch-title");
        if (preferred || fallback) (preferred || fallback).focus();
      });
      return;
    }
    const holdingMarket = event.target.closest("[data-holding-market]");
    if (holdingMarket) {
      state.market = ["全部", "港股", "A股", "美股"].includes(holdingMarket.dataset.holdingMarket) ? holdingMarket.dataset.holdingMarket : "全部";
      state.expandedHoldingKey = "";
      render();
      window.requestAnimationFrame(function () {
        const control = Array.from(document.querySelectorAll("[data-holding-market]")).find(function (button) { return button.dataset.holdingMarket === state.market; });
        if (control) control.focus();
      });
      return;
    }
    const holdingPnl = event.target.closest("[data-holding-pnl]");
    if (holdingPnl) {
      state.holdingPnlFilter = ["all", "profit", "loss"].includes(holdingPnl.dataset.holdingPnl) ? holdingPnl.dataset.holdingPnl : "all";
      state.expandedHoldingKey = "";
      render();
      window.requestAnimationFrame(function () {
        const control = Array.from(document.querySelectorAll("[data-holding-pnl]")).find(function (button) { return button.dataset.holdingPnl === state.holdingPnlFilter; });
        if (control) control.focus();
      });
      return;
    }
    const clearHoldingFilters = event.target.closest("[data-clear-holding-filters]");
    if (clearHoldingFilters) {
      state.market = "全部";
      state.holdingPnlFilter = "all";
      state.holdingQuery = "";
      state.expandedHoldingKey = "";
      render();
      window.requestAnimationFrame(function () { const search = document.querySelector("[data-holding-search]"); if (search) search.focus(); });
      return;
    }
    const toggleHolding = event.target.closest("[data-toggle-holding]");
    if (toggleHolding) {
      const key = toggleHolding.dataset.toggleHolding || "";
      state.expandedHoldingKey = state.expandedHoldingKey === key ? "" : key;
      render();
      window.requestAnimationFrame(function () {
        const trigger = Array.from(document.querySelectorAll("[data-toggle-holding=\"" + key.replace(/\"/g, "\\\"") + "\"]")).find(function (button) { return button.offsetParent !== null; });
        if (trigger) trigger.focus();
      });
      return;
    }
    const market = event.target.closest("[data-market]");
    if (market) { state.market = market.dataset.market; render(); return; }
    const tradeMarket = event.target.closest("[data-trade-market]");
    if (tradeMarket) {
      state.tradeMarket = ["全部", "A股", "港股", "美股"].includes(tradeMarket.dataset.tradeMarket) ? tradeMarket.dataset.tradeMarket : "全部";
      render();
      return;
    }
    const tradeSortDirection = event.target.closest("[data-trade-sort-direction]");
    if (tradeSortDirection) {
      state.tradeSortDirection = state.tradeSortDirection === "asc" ? "desc" : "asc";
      render();
      window.requestAnimationFrame(function () { const control = document.querySelector("[data-trade-sort-direction]"); if (control) control.focus(); });
      return;
    }
    const clearTradeFilters = event.target.closest("[data-clear-trade-filters]");
    if (clearTradeFilters) {
      state.tradeMarket = "全部";
      state.tradeDateStart = "";
      state.tradeDateEnd = "";
      render();
      window.requestAnimationFrame(function () { const control = document.querySelector("[data-trade-date-start]"); if (control) control.focus(); });
      return;
    }
    const trendDays = event.target.closest("[data-trend-days]");
    if (trendDays) { state.trendDays = Number(trendDays.dataset.trendDays) || 30; render(); return; }
    const rankMode = event.target.closest("[data-rank-mode]");
    if (rankMode) { state.rankMode = rankMode.dataset.rankMode === "loss" ? "loss" : "profit"; render(); return; }
    const rankMarket = event.target.closest("[data-rank-market]");
    if (rankMarket) {
      state.rankMarket = ["全部", "港股", "A股", "美股"].includes(rankMarket.dataset.rankMarket) ? rankMarket.dataset.rankMarket : "全部";
      render();
      return;
    }
    const actionSort = event.target.closest("[data-action-sort]");
    if (actionSort) {
      const key = ["cost", "qty", "value", "weight", "price", "today", "pnl"].includes(actionSort.dataset.actionSort) ? actionSort.dataset.actionSort : "weight";
      state.actionSortDirection = state.actionSort === key && state.actionSortDirection === "desc" ? "asc" : "desc";
      state.actionSort = key;
      state.expandedHoldingKey = "";
      render();
      window.requestAnimationFrame(function () {
        const control = Array.from(document.querySelectorAll("[data-action-sort]")).find(function (button) { return button.dataset.actionSort === key && button.offsetParent !== null; });
        if (control) control.focus();
      });
      return;
    }
    const refresh = event.target.closest("[data-refresh]");
    if (refresh) { if (state.tab === "radar") loadRadar(true); else refreshData(); return; }
    const logout = event.target.closest("[data-logout]");
    if (logout) { logoutUser(); return; }
    const removeTrade = event.target.closest("[data-delete-trade]");
    if (removeTrade) {
      state.trades = state.trades.filter(function (trade) { return trade.id !== removeTrade.dataset.deleteTrade; });
      writeStorage(TRADE_KEY, state.trades); render(); return;
    }
    const show = event.target.closest("[data-show-form]");
    if (show) { const panel = document.querySelector("#trade-form-panel"); if (panel) { panel.hidden = false; panel.scrollIntoView({ behavior: "smooth", block: "start" }); } return; }
    const exportButton = event.target.closest("[data-export]");
    if (exportButton) exportJson(exportButton.dataset.export);
  });
  document.addEventListener("submit", function (event) {
    if (event.target && event.target.id === "holding-editor-form") { event.preventDefault(); saveHoldingEditor(); return; }
    if (event.target && event.target.id === "trade-form") { event.preventDefault(); saveTrade(event.target); }
  });
  document.addEventListener("input", function (event) {
    const radarSearch = event.target.closest("[data-radar-search]");
    if (radarSearch) {
      const start = radarSearch.selectionStart, end = radarSearch.selectionEnd;
      state.radarQuery = radarSearch.value;
      state.radarPage = 1;
      state.expandedRadarId = "";
      window.clearTimeout(radarSearchTimer);
      radarSearchTimer = window.setTimeout(function () {
        render();
        window.requestAnimationFrame(function () {
          const input = document.querySelector("[data-radar-search]");
          if (!input) return;
          input.focus();
          if (Number.isInteger(start) && Number.isInteger(end)) input.setSelectionRange(start, end);
        });
      }, 160);
      return;
    }
    const holdingSearch = event.target.closest("[data-holding-search]");
    if (holdingSearch) {
      const start = holdingSearch.selectionStart, end = holdingSearch.selectionEnd;
      state.holdingQuery = holdingSearch.value;
      state.expandedHoldingKey = "";
      window.clearTimeout(holdingSearchTimer);
      holdingSearchTimer = window.setTimeout(function () {
        render();
        window.requestAnimationFrame(function () {
          const input = document.querySelector("[data-holding-search]");
          if (!input) return;
          input.focus();
          if (Number.isInteger(start) && Number.isInteger(end)) input.setSelectionRange(start, end);
        });
      }, 140);
      return;
    }
    if (!state.holdingDraft || !event.target.closest("#holding-editor-form") || !event.target.name) return;
    state.holdingDraft[event.target.name] = event.target.value;
    setHoldingFormError("");
    if (event.target.name === "code") {
      state.holdingDraft.name = "";
      state.holdingDraft.sina = "";
      setHoldingLookup("typing", "输入完成后将自动识别…", null);
      scheduleHoldingLookup(false);
    }
  });
  document.addEventListener("change", function (event) {
    const tradeDateStart = event.target.closest("[data-trade-date-start]");
    if (tradeDateStart) {
      state.tradeDateStart = /^\d{4}-\d{2}-\d{2}$/.test(tradeDateStart.value) ? tradeDateStart.value : "";
      render();
      window.requestAnimationFrame(function () { const control = document.querySelector("[data-trade-date-start]"); if (control) control.focus(); });
      return;
    }
    const tradeDateEnd = event.target.closest("[data-trade-date-end]");
    if (tradeDateEnd) {
      state.tradeDateEnd = /^\d{4}-\d{2}-\d{2}$/.test(tradeDateEnd.value) ? tradeDateEnd.value : "";
      render();
      window.requestAnimationFrame(function () { const control = document.querySelector("[data-trade-date-end]"); if (control) control.focus(); });
      return;
    }
    const tradeSort = event.target.closest("[data-trade-sort]");
    if (tradeSort) {
      state.tradeSort = ["date", "pnl", "rate"].includes(tradeSort.value) ? tradeSort.value : "date";
      render();
      window.requestAnimationFrame(function () { const control = document.querySelector("[data-trade-sort]"); if (control) control.focus(); });
      return;
    }
    const radarSort = event.target.closest("[data-radar-sort]");
    if (radarSort) {
      state.radarSort = ["score", "trend", "liquidity", "risk", "change"].includes(radarSort.value) ? radarSort.value : "score";
      state.radarPage = 1;
      state.expandedRadarId = "";
      render();
      window.requestAnimationFrame(function () { const control = document.querySelector("[data-radar-sort]"); if (control) control.focus(); });
      return;
    }
    const holdingSort = event.target.closest("[data-holding-sort]");
    if (holdingSort) {
      const parts = String(holdingSort.value || "weight:desc").split(":");
      state.actionSort = ["cost", "qty", "value", "weight", "price", "today", "pnl"].includes(parts[0]) ? parts[0] : "weight";
      state.actionSortDirection = parts[1] === "asc" ? "asc" : "desc";
      state.expandedHoldingKey = "";
      render();
      window.requestAnimationFrame(function () { const control = document.querySelector("[data-holding-sort]"); if (control) control.focus(); });
      return;
    }
    if (!state.holdingDraft || !event.target.closest("#holding-editor-form") || !event.target.name) return;
    const field = event.target.name;
    state.holdingDraft[field] = event.target.value;
    setHoldingFormError("");
    if (field === "status") { syncHoldingFormUi(); return; }
    if (field === "market") {
      state.holdingDraft.currency = currencyForMarket(event.target.value);
      state.holdingDraft.code = "";
      state.holdingDraft.name = "";
      state.holdingDraft.sina = "";
      state.holdingDraft.buyPrice = "";
      state.holdingDraft.buyQty = "";
      state.holdingDraft.sellPrice = "";
      state.holdingDraft.sellQty = "";
      document.querySelectorAll("#holding-editor-form input[type=\"text\"], #holding-editor-form input[type=\"number\"]").forEach(function (input) { input.value = ""; });
      setHoldingLookup("idle", "输入股票代码后自动识别名称", null);
      syncHoldingFormUi();
      const code = document.querySelector("#holding-code-input");
      if (code) code.focus();
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && state.expandedRadarId && !state.holdingEditorOpen) {
      const id = state.expandedRadarId;
      state.expandedRadarId = "";
      render();
      window.requestAnimationFrame(function () { const trigger = document.querySelector("[data-toggle-radar=\"" + id.replace(/\"/g, "\\\"") + "\"]"); if (trigger) trigger.focus(); });
      return;
    }
    if (event.key === "Escape" && state.expandedHoldingKey && !state.holdingEditorOpen) {
      const key = state.expandedHoldingKey;
      state.expandedHoldingKey = "";
      render();
      window.requestAnimationFrame(function () {
        const trigger = Array.from(document.querySelectorAll("[data-toggle-holding=\"" + key.replace(/\"/g, "\\\"") + "\"]")).find(function (button) { return button.offsetParent !== null; });
        if (trigger) trigger.focus();
      });
      return;
    }
    if (!state.holdingEditorOpen) return;
    if (event.key === "Escape") { event.preventDefault(); closeHoldingEditor(); return; }
    if (event.key !== "Tab") return;
    const dialog = document.querySelector(".holding-editor-dialog");
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])")).filter(function (element) { return !element.closest("[hidden]"); });
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  window.addEventListener("resize", function () { requestAnimationFrame(drawCharts); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refreshRadarIfStale();
  });
  window.setInterval(refreshRadarIfStale, 5 * 60 * 1000);
}

async function refreshData() {
  state.isRefreshing = true;
  state.isHistoryLoading = true;
  render();
  const holdingSymbols = Array.from(new Set(activeHoldings().map(function (item) { return item.sina; }).filter(Boolean))).join(",");
  const historySymbols = Array.from(new Set(activeHoldings().map(function (item) { return item.sina; }).filter(Boolean).concat(Object.keys(MARKET_BENCHMARKS).map(function (market) {
    return MARKET_BENCHMARKS[market].symbol;
  })))).join(",");
  const symbols = holdingSymbols;
  const currentQuotes = { quotes: Object.fromEntries(state.quotes) };
  const currentRates = {
    rates: { USD_CNY: state.rates.USD, HKD_CNY: state.rates.HKD },
    asOf: state.fxMeta.asOf,
    fetchedAt: state.fxMeta.fetchedAt,
    source: state.fxMeta.source,
    fallback: state.fxMeta.fallback
  };
  const historyRequest = getJson("/api/history?symbols=" + encodeURIComponent(historySymbols) + "&days=90", { histories: state.histories, days: 90 }, 12000);
  const result = await Promise.all([
    getJson("/api/quotes?symbols=" + encodeURIComponent(symbols), currentQuotes, 9000),
    getJson("/api/rates", currentRates, 3500)
  ]);
  const quoteEntries = Object.entries(result[0].quotes || {});
  const quotesRefreshed = result[0] !== currentQuotes && quoteEntries.length > 0;
  if (quoteEntries.length) {
    state.quotes = new Map([].concat(Array.from(state.quotes.entries()), quoteEntries));
    if (quotesRefreshed) {
      const fetchedAt = new Date().toISOString();
      quoteEntries.forEach(function (entry) { state.quoteMeta[entry[0]] = fetchedAt; });
    }
  }
  state.rates = { CNY: 1, USD: Number(result[1].rates && result[1].rates.USD_CNY) || state.rates.USD || 7.22, HKD: Number(result[1].rates && result[1].rates.HKD_CNY) || state.rates.HKD || 0.92 };
  const hasLiveRates = Number.isFinite(Number(result[1].rates && result[1].rates.USD_CNY)) && Number.isFinite(Number(result[1].rates && result[1].rates.HKD_CNY));
  state.fxMeta = {
    asOf: result[1].asOf || null,
    fetchedAt: result[1].fetchedAt || (hasLiveRates ? new Date().toISOString() : state.fxMeta.fetchedAt || null),
    source: result[1].source || (hasLiveRates ? "Frankfurter" : state.fxMeta.source || "固定参考汇率"),
    fallback: result[1].fallback !== undefined ? Boolean(result[1].fallback) : !hasLiveRates
  };
  if (quotesRefreshed) state.updatedAt = formatUpdatedAt(new Date());
  rebuildRows();
  state.isRefreshing = false;
  saveMarketCache();
  render();
  const historyResult = await historyRequest;
  if (Object.keys(historyResult.histories || {}).length) {
    state.histories = Object.assign({}, state.histories, historyResult.histories);
  }
  state.isHistoryLoading = false;
  rebuildRows();
  saveMarketCache();
  render();
}

function adoptStartupDocuments(holdingsDocument, tradesDocument) {
  state.baseHoldings = holdingsFromDocument(holdingsDocument);
  state.holdings = state.baseHoldings.slice();
  state.trades = (Array.isArray(tradesDocument) ? tradesDocument : []).map(normalizeTrade);
}

function startupStateFingerprint() {
  return JSON.stringify([state.holdings, state.trades]);
}

async function start() {
  if (!VALID_TABS.includes(location.hash.slice(1))) location.hash = "#overview";
  const syncRequest = getJson("/api/holdings-sync", null, 8000);
  const staticRequest = Promise.all([
    getJson("holdings.json", null),
    getJson("trades.json", [])
  ]);
  const linked = readStorage(HOLDING_KEY, null);
  const localTrades = readStorage(TRADE_KEY, null);
  let currentSource = "empty";
  let marketRefresh = null;
  let interactiveSnapshot = "";

  if (isHoldingsDocument(linked)) {
    adoptStartupDocuments(linked, localTrades);
    readMarketCache();
    readRadarCache();
    rebuildRows();
    eventHandlers();
    render();
    startBrandAnimations();
    if (state.tab === "radar") loadRadar(false);
    currentSource = "local";
    marketRefresh = refreshData();
    interactiveSnapshot = startupStateFingerprint();
  }

  const staticResult = await staticRequest;
  if (currentSource === "empty") {
    const initial = selectStartupHoldingsDocument(null, staticResult[0], linked);
    adoptStartupDocuments(initial.document, Array.isArray(localTrades) ? localTrades : staticResult[1]);
    readMarketCache();
    readRadarCache();
    rebuildRows();
    eventHandlers();
    render();
    startBrandAnimations();
    if (state.tab === "radar") loadRadar(false);
    currentSource = initial.source;
    marketRefresh = refreshData();
    interactiveSnapshot = startupStateFingerprint();
  }

  const syncPayload = await syncRequest;
  const authoritative = selectStartupHoldingsDocument(syncPayload, staticResult[0], linked);
  const startupStateUnchanged = interactiveSnapshot === startupStateFingerprint();
  if (startupStateUnchanged && (authoritative.source === "github" || (authoritative.source === "static" && currentSource === "local"))) {
    const previousSymbols = activeHoldings().map(function (item) { return item.sina; }).sort().join(",");
    adoptStartupDocuments(authoritative.document, Array.isArray(localTrades) ? localTrades : staticResult[1]);
    rebuildRows();
    try { writeStorage(HOLDING_KEY, state.holdings); } catch { /* Cache failure must not replace the authoritative source. */ }
    render();
    const nextSymbols = activeHoldings().map(function (item) { return item.sina; }).sort().join(",");
    if (previousSymbols !== nextSymbols) {
      Promise.resolve(marketRefresh).finally(function () { refreshData(); });
    }
  }
}

start().catch(function (error) {
  document.querySelector("#app").innerHTML = "<main class=\"loading-screen\"><div class=\"error\">页面初始化失败：" + escapeHtml(error.message) + "。请刷新重试。</div></main>";
});
