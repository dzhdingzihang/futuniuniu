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
const RADAR_SEGMENT_LABELS = { "A股": "创业板", "港股": "港股科技", "美股": "纳斯达克" };
const RADAR_PAGE_SIZE = 10;
const RADAR_MODEL_VERSION = "radar-v1.3";
const RADAR_PREVIOUS_MODEL = "radar-v1.1";
const RADAR_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const RADAR_HISTORY_TTL_MS = 30 * 60 * 1000;
const RADAR_HISTORY_ERROR_TTL_MS = 5 * 60 * 1000;
const RADAR_LEVEL_MODEL_VERSION = "radar-levels-v1";
const NAV_ITEMS = [["overview", "总览"], ["actions", "持仓明细"], ["radar", "机会雷达"], ["trades", "卖出记录"]];
const VALID_TABS = NAV_ITEMS.map(function (item) { return item[0]; });
const PAGE_META = {
  overview: { title: "总览", heading: "账户整体" },
  actions: { title: "持仓明细", heading: "持仓明细" },
  radar: { title: "机会雷达", heading: "机会雷达" },
  trades: { title: "卖出记录", heading: "卖出记录" }
};
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
let motionPreference = null;

const METRIC_HELP = {
  netInvested: "所有买入批次的人民币成本之和减去全部卖出净额。买入成本和卖出净额已计入适用的费用。",
  marketValue: "当前未卖出持仓按最新报价和实时汇率折算的市值。",
  totalPnl: "当前持仓市值减去股票总投入；正数为盈利，负数为亏损。",
  todayPnl: "当前未卖出持仓的今日价格变化乘以数量，再按实时汇率折算；不包含当天未录入的已实现盈亏。",
  holdingCount: "当前状态为持有中的证券数量，不包含已卖出记录。",
  chart: "按当前持仓数量回看历史价格，并减去当前股票总投入得到估算曲线；未反映区间内仓位变化和历史汇率变化。",
  actionPrice: "执行价位由当前价、成本价、持仓盈亏和日内波动自动推导；用于明确下一步的风控或分批操作参考。"
};

const linkedRadarScope = /(?:^|[?&])radar=(preopen|intraday|growth|market)(?:&|$)/.exec(location.search || "")?.[1];

const state = {
  tab: VALID_TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : linkedRadarScope ? "radar" : "overview",
  market: "全部",
  tradeMarket: "全部",
  tradeDateStart: "",
  tradeDateEnd: "",
  tradeSort: "date",
  tradeSortDirection: "desc",
  watchMarket: "全部",
  radarBand: linkedRadarScope === "growth" ? "all" : "priority",
  radarSort: "score",
  radarQuery: "",
  radarPage: 1,
  radarRows: [],
  radarScope: linkedRadarScope || "preopen",
  preopenData: null,
  preopenError: "",
  preopenLoading: false,
  preopenOpen: {},
  preopenReviewMarket: "A股",
  intradayData: null,
  intradayError: "",
  intradayLoading: false,
  intradayHistoryOpen: {},
  radarSegmentRows: [],
  radarMarkets: {},
  radarStatus: "idle",
  radarError: "",
  radarPublishedAt: "",
  radarAttemptedAt: "",
  radarSnapshotStatus: null,
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
  holdingsDocument: null,
  holdingsFileSha: "",
  holdingsRepository: null,
  costPolicyEditor: null,
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
  holdingEditorTrigger: "header",
  holdingDraft: null,
  holdingPendingOperation: null,
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
  const rows = document.lots.flatMap(function (lot, index) {
    if (!lot || typeof lot !== "object") return [];
    const market = normalizedHoldingMarket(lot.market);
    const rawCode = String(lot.code || "").trim().toUpperCase().replace(/^\$/, "");
    const code = market === "港股" && /^\d{1,5}$/.test(rawCode) ? rawCode.padStart(5, "0") : rawCode;
    const buy = lot.buy && typeof lot.buy === "object" ? lot.buy : {};
    const sell = lot.sell && typeof lot.sell === "object" ? lot.sell : null;
    const fees = lot.fees && typeof lot.fees === "object" ? lot.fees : {};
    const buyQty = Number(buy.qty);
    const sellQty = sell ? Number(sell.qty ?? buy.qty) : 0;
    const explicitBuyFee = optionalNumber(fees.buy);
    const explicitSellFee = optionalNumber(fees.sell);
    const buyFee = Number.isFinite(explicitBuyFee) ? explicitBuyFee : defaultBuyFee;
    const sellFee = Number.isFinite(explicitSellFee) ? explicitSellFee : defaultSellFee;
    const purchaseCostCny = optionalNumber(buy.purchaseCostCny);
    const adjustmentCny = optionalNumber(buy.adjustmentCny);
    const buyFeeCny = optionalNumber(buy.feeCny);
    const sellProceedsCny = optionalNumber(sell && sell.sellProceedsCny);
    const sellFeeCny = optionalNumber(sell && sell.feeCny);
    const base = {
      lotId: String(lot.id || (document.costPolicy ? "manual-" + (index + 1) : "")),
      parentLotId: String(lot.parentLotId || ""),
      market: market,
      code: code,
      name: String(lot.name || code).trim(),
      note: String(lot.note || "").trim(),
      quality: String(lot.quality || "").trim(),
      cost: Number(buy.price),
      currency: currencyForMarket(market),
      sina: providerCodeForHolding(market, code),
      buyDate: String(buy.date || ""),
      buyOperationId: String(buy.operationId || ""),
      buyFxAsOf: String(buy.fxAsOf || ""),
      buyFxSource: String(buy.fxSource || ""),
      buyFeeCny: buyFeeCny
    };
    if (!sell) return [normalizeHolding(Object.assign({}, base, {
      status: "holding", qty: buyQty, buyFeeUsd: buyFee, purchaseCostCny: purchaseCostCny,
      adjustmentCny: adjustmentCny
    }))].filter(isValidHolding);
    if (!Number.isFinite(sellQty) || sellQty <= 0 || !Number.isFinite(buyQty) || buyQty <= 0 || sellQty > buyQty) return [];
    const ratio = sellQty / buyQty;
    const records = [normalizeHolding(Object.assign({}, base, {
      status: "sold",
      qty: sellQty,
      sellPrice: Number(sell.price),
      sellDate: String(sell.date || ""),
      sellOperationId: String(sell.operationId || ""),
      sellFxAsOf: String(sell.fxAsOf || ""),
      sellFxSource: String(sell.fxSource || ""),
      buyFeeUsd: Number.isFinite(buyFee) ? buyFee * ratio : NaN,
      sellFeeUsd: sellFee,
      purchaseCostCny: Number.isFinite(purchaseCostCny) ? purchaseCostCny * ratio : NaN,
      adjustmentCny: Number.isFinite(adjustmentCny) ? adjustmentCny * ratio : NaN,
      buyFeeCny: Number.isFinite(buyFeeCny) ? buyFeeCny * ratio : NaN,
      sellProceedsCny: sellProceedsCny,
      sellFeeCny: sellFeeCny
    }))];
    if (sellQty < buyQty) {
      records.unshift(normalizeHolding(Object.assign({}, base, {
        status: "holding",
        qty: buyQty - sellQty,
        buyFeeUsd: Number.isFinite(buyFee) ? buyFee * (1 - ratio) : NaN,
        purchaseCostCny: Number.isFinite(purchaseCostCny) ? purchaseCostCny * (1 - ratio) : NaN,
        adjustmentCny: Number.isFinite(adjustmentCny) ? adjustmentCny * (1 - ratio) : NaN,
        buyFeeCny: Number.isFinite(buyFeeCny) ? buyFeeCny * (1 - ratio) : NaN
      })));
    }
    return records.filter(isValidHolding);
  });
  return document.costPolicy ? globalThis.PiggyHoldingCosts.apply(rows, document.costPolicy) : rows;
}

function isHoldingsDocument(document) {
  return Array.isArray(document) || Boolean(document && Number(document.version) === 2 && Array.isArray(document.lots));
}

function selectStartupHoldingsDocument(syncPayload, staticDocument, localDocument) {
  if (syncPayload && syncPayload.ok === true) {
    if (isHoldingsDocument(syncPayload.document)) return { source: "github", document: syncPayload.document };
    if (isHoldingsDocument(syncPayload.holdings)) return { source: "github", document: syncPayload.holdings };
  }
  if (isHoldingsDocument(staticDocument)) return { source: "static", document: staticDocument };
  if (isHoldingsDocument(localDocument)) return { source: "local", document: localDocument };
  return { source: "empty", document: [] };
}

function readableHoldingsDocument(rows, metadataSource) {
  if (metadataSource && metadataSource.costPolicy) return metadataSource;
  const document = {
    version: 2,
    guide: "日常新增只填 market、code、name 和 buy.date/price/qty；没有 sell 表示持有。purchaseCostCny 已包含 adjustmentCny 时请勿重复相加。",
    newTradeFeeUsd: { buy: FIXED_TRADE_FEE_USD, sell: FIXED_TRADE_FEE_USD },
    lots: rows.map(normalizeHolding).filter(isValidHolding).map(function (row) {
      const lot = {
        market: HOLDING_MARKET_KEYS[row.market],
        code: row.code,
        name: row.name,
        buy: { price: row.cost, qty: row.qty }
      };
      if (row.lotId) lot.id = row.lotId;
      if (row.parentLotId) lot.parentLotId = row.parentLotId;
      if (row.note) lot.note = row.note;
      if (row.quality) lot.quality = row.quality;
      if (/^\d{4}-\d{2}-\d{2}$/.test(row.buyDate)) lot.buy.date = row.buyDate;
      if (Number.isFinite(row.purchaseCostCny)) lot.buy.purchaseCostCny = row.purchaseCostCny;
      if (Number.isFinite(row.adjustmentCny)) lot.buy.adjustmentCny = row.adjustmentCny;
      if (Number.isFinite(row.buyFeeCny)) lot.buy.feeCny = row.buyFeeCny;
      if (row.buyFxAsOf) lot.buy.fxAsOf = row.buyFxAsOf;
      if (row.buyFxSource) lot.buy.fxSource = row.buyFxSource;
      if (row.buyOperationId) lot.buy.operationId = row.buyOperationId;
      if (row.status === "sold") {
        lot.sell = { price: row.sellPrice, qty: row.qty, date: row.sellDate };
        if (Number.isFinite(row.sellProceedsCny)) lot.sell.sellProceedsCny = row.sellProceedsCny;
        if (Number.isFinite(row.sellFeeCny)) lot.sell.feeCny = row.sellFeeCny;
        if (row.sellFxAsOf) lot.sell.fxAsOf = row.sellFxAsOf;
        if (row.sellFxSource) lot.sell.fxSource = row.sellFxSource;
        if (row.sellOperationId) lot.sell.operationId = row.sellOperationId;
      }
      const fees = {};
      if (Number.isFinite(row.buyFeeUsd)) fees.buy = row.buyFeeUsd;
      if (Number.isFinite(row.sellFeeUsd)) fees.sell = row.sellFeeUsd;
      if (Object.keys(fees).length) lot.fees = fees;
      return lot;
    })
  };
  if (metadataSource && typeof metadataSource === "object" && !Array.isArray(metadataSource)) {
    ["asOf", "valuationAsOf"].forEach(function (key) {
      const value = String(metadataSource[key] || "").trim();
      if (value) document[key] = value;
    });
    ["source", "fx"].forEach(function (key) {
      const value = metadataSource[key];
      if (value && typeof value === "object" && !Array.isArray(value)) document[key] = JSON.parse(JSON.stringify(value));
    });
  }
  return document;
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
  return Number.isFinite(timestamp) && age >= -RADAR_FUTURE_TOLERANCE_MS ? Math.max(0, age) : Infinity;
}

function radarCalendarDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return [values.year, values.month, values.day].join("-");
  } catch (_) {
    return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
  }
}

function radarSnapshotIsDailyCurrent(payload) {
  if (!Number.isFinite(radarSnapshotAgeMs(payload))) return false;
  const fetchedDay = radarCalendarDateKey(payload && payload.fetchedAt);
  return Boolean(fetchedDay) && fetchedDay === radarCalendarDateKey(Date.now());
}

function radarSnapshotIsCurrent(payload) {
  return radarSnapshotIsDailyCurrent(payload);
}

function radarEffectiveLoadState(payload) {
  const loadState = payload && payload.loadState || "idle";
  return loadState === "fresh" && !radarSnapshotIsCurrent(payload) ? "cached" : loadState;
}

function isRadarSnapshot(payload, market) {
  if (!payload || payload.market !== market || ![RADAR_MODEL_VERSION, "radar-v1.2", RADAR_PREVIOUS_MODEL].includes(payload.modelVersion) || !Array.isArray(payload.candidates)) return false;
  if (payload.loadState === "unavailable" && !payload.candidates.length && payload.segment && Array.isArray(payload.segment.candidates)) return true;
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
      const adjustments = snapshot.modelVersion === RADAR_PREVIOUS_MODEL
        ? globalThis.PiggyRadarRisk.assess(item.metrics, item.components) : null;
      return Object.assign({}, item, adjustments, {
        source: snapshot.source || item.source,
        fetchedAt: snapshot.fetchedAt || item.fetchedAt,
        modelVersion: snapshot.modelVersion || item.modelVersion,
        loadState: radarEffectiveLoadState(snapshot),
        loadError: snapshot.error && typeof snapshot.error === "object" ? snapshot.error.message || "" : snapshot.error || ""
      });
    });
  });
}

function radarSegmentRowsFromSnapshots(snapshots) {
  return RADAR_MARKETS.flatMap(function (market) {
    const segment = snapshots[market]?.segment;
    if (!segment || !Array.isArray(segment.candidates)) return [];
    const loadState = radarEffectiveLoadState(segment);
    if (loadState === "error" || loadState === "unavailable") return [];
    return segment.candidates.filter(function (item) {
      return item && item.market === market && item.id === market + ":" + item.code && item.sina && item.name &&
        Number.isFinite(optionalNumber(item.score)) && Number.isFinite(optionalNumber(item.metrics?.price));
    }).map(function (item) {
      return Object.assign({}, item, {
        radarScope: "growth", segmentLabel: segment.label || RADAR_SEGMENT_LABELS[market],
        source: segment.source || item.source, fetchedAt: segment.fetchedAt, loadState
      });
    });
  });
}

function activeRadarSnapshot(market) {
  const snapshot = state.radarMarkets[market];
  return state.radarScope === "growth" ? snapshot?.segment : snapshot;
}

function activeRadarRows() {
  return state.radarScope === "growth" ? state.radarSegmentRows : state.radarRows;
}

function mergeRadarSnapshot(previous, incoming, source) {
  if (!incoming) return previous;
  if (incoming.loadState === "unavailable") {
    if (previous?.fetchedAt && previous.loadState !== "unavailable") {
      return Object.assign({}, previous, { loadState: "stale", error: incoming.error });
    }
    return incoming;
  }
  if (previous && Date.parse(previous.fetchedAt) > Date.parse(incoming.fetchedAt)) return previous;
  const stale = incoming.loadState === "stale" || incoming.stale === true;
  const current = radarSnapshotIsDailyCurrent(incoming);
  const fresh = current && (source !== "envelope" || incoming.loadState === "fresh");
  const loadState = stale ? "stale" : fresh ? "fresh" : "cached";
  return Object.assign({}, incoming, { loadState, error: loadState === "fresh" ? "" : incoming.error });
}

function mergeRadarMarket(previous, incoming, source) {
  const market = mergeRadarSnapshot(previous, incoming, source);
  if (!market) return null;
  const segment = mergeRadarSnapshot(previous?.segment, incoming?.segment, source);
  return segment ? Object.assign({}, market, { segment }) : market;
}

function adoptRadarSnapshots(snapshots, source) {
  const next = {};
  RADAR_MARKETS.forEach(function (market) {
    const payload = snapshots && snapshots[market];
    const previous = source === "envelope" ? state.radarMarkets[market] : null;
    const merged = mergeRadarMarket(previous, isRadarSnapshot(payload, market) ? payload : null, source);
    if (merged) next[market] = merged;
  });
  state.radarMarkets = next;
  state.radarRows = radarRowsFromSnapshots(next);
  state.radarSegmentRows = radarSegmentRowsFromSnapshots(next);
  return Object.keys(next).length;
}

function readRadarCache() {
  const cache = readStorage(RADAR_CACHE_KEY, null);
  if (!cache || ![1, 2].includes(Number(cache.version)) || typeof cache !== "object" || !cache.markets || typeof cache.markets !== "object") return false;
  const count = adoptRadarSnapshots(cache.markets, "cache");
  const currentCount = RADAR_MARKETS.filter(function (market) {
    return radarEffectiveLoadState(state.radarMarkets[market]) === "fresh";
  }).length;
  const staleMarkets = RADAR_MARKETS.filter(function (market) { return radarEffectiveLoadState(state.radarMarkets[market]) === "stale"; });
  state.radarError = staleMarkets.length ? staleMarkets.join("、") + "沿用上一次有效候选" : "";
  if (count) state.radarStatus = currentCount === RADAR_MARKETS.length ? "success" : currentCount ? "partial" : staleMarkets.length ? "stale" : count === RADAR_MARKETS.length ? "cached" : "partial";
  return count > 0;
}

function saveRadarCache() {
  const markets = {};
  RADAR_MARKETS.forEach(function (market) {
    if (!isRadarSnapshot(state.radarMarkets[market], market)) return;
    markets[market] = Object.assign({}, state.radarMarkets[market]);
  });
  try {
    writeStorage(RADAR_CACHE_KEY, { version: 2, savedAt: new Date().toISOString(), markets: markets });
  } catch {
    // The live snapshot remains usable even if browser storage is unavailable.
  }
}

async function fetchRadarMarket(market) {
  const controller = new AbortController();
  const timeout = window.setTimeout(function () { controller.abort(); }, 45000);
  try {
    const response = await fetch("/api/radar?market=" + encodeURIComponent(market), { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(market + "扫描失败（" + response.status + "）");
    const payload = await response.json();
    if (!isRadarSnapshot(payload, market)) throw new Error(market + "扫描结果格式不正确");
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

function isRadarEnvelope(payload) {
  return Boolean(payload && payload.schema === "radar-snapshot-v2" && Number.isFinite(Date.parse(payload.attemptedAt || "")) && (payload.publishedAt === null || Number.isFinite(Date.parse(payload.publishedAt))) && payload.markets && typeof payload.markets === "object" && payload.status && Array.isArray(payload.status.freshMarkets) && Array.isArray(payload.status.staleMarkets) && Array.isArray(payload.status.unavailableMarkets));
}

async function fetchRadarEnvelope() {
  const controller = new AbortController();
  const timeout = window.setTimeout(function () { controller.abort(); }, 10000);
  try {
    const response = await fetch("/api/radar", { cache: "no-store", signal: controller.signal });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.error || "每日机会快照读取失败（" + response.status + "）");
    if (!isRadarEnvelope(payload)) throw new Error("每日机会快照格式不正确");
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

function adoptRadarEnvelope(envelope) {
  const count = adoptRadarSnapshots(envelope.markets, "envelope");
  state.radarPublishedAt = envelope.publishedAt || "";
  state.radarAttemptedAt = envelope.attemptedAt || envelope.publishedAt || "";
  state.radarSnapshotStatus = envelope.status || null;
  const unavailable = envelope.status.unavailableMarkets || [];
  const stale = envelope.status.staleMarkets || [];
  state.radarStatus = count === RADAR_MARKETS.length && !stale.length && !unavailable.length ? "success" : count ? (stale.length || unavailable.length ? "partial" : "cached") : "error";
  const messages = [];
  if (stale.length) messages.push(stale.join("、") + "沿用上一次有效候选");
  if (unavailable.length) messages.push(unavailable.join("、") + "暂时没有可用候选");
  state.radarError = messages.join("；");
  if (count) saveRadarCache();
  return count;
}

function dailyRadarScope(scope = state.radarScope) {
  return scope === "intraday" || scope === "preopen";
}

async function loadDailyRadar(scope = state.radarScope) {
  if (!dailyRadarScope(scope) || state[scope + "Loading"] || state.tab !== "radar") return;
  state[scope + "Loading"] = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  render();
  try {
    const response = await fetch("/api/" + scope + "-radar", { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data?.modelVersion !== scope + "-v1" || !data.markets || !Number.isFinite(Date.parse(data.asOf))) throw new Error();
    state[scope + "Data"] = data;
    state[scope + "Error"] = "";
  } catch (error) {
    const label = scope === "preopen" ? "盘前预测" : "盘中行情";
    state[scope + "Error"] = label + (error.name === "AbortError" ? "读取超时，请刷新重试。" : "暂时读取失败，请刷新重试。");
  } finally {
    window.clearTimeout(timeout);
    state[scope + "Loading"] = false;
    if (state.tab === "radar" && state.radarScope === scope) render();
  }
}

async function loadRadar(force) {
  if (dailyRadarScope()) return loadDailyRadar();
  if (state.radarStatus === "loading") return;
  let targetMarkets = RADAR_MARKETS.slice();
  const requestId = ++state.radarRequestId;
  state.radarStatus = "loading";
  state.radarError = "";
  render();
  if (!force) {
    try {
      const envelope = await fetchRadarEnvelope();
      if (requestId !== state.radarRequestId) return;
      adoptRadarEnvelope(envelope);
      targetMarkets = RADAR_MARKETS.filter(market => radarEffectiveLoadState(state.radarMarkets[market]) !== "fresh"
        || state.radarMarkets[market]?.modelVersion !== RADAR_MODEL_VERSION
        || radarEffectiveLoadState(state.radarMarkets[market]?.segment) !== "fresh");
      state.radarStatus = targetMarkets.length ? "loading" : "success";
      if (!targetMarkets.length) state.radarError = "";
      render();
      if (!targetMarkets.length) return;
    } catch (error) {
      if (requestId !== state.radarRequestId) return;
      state.radarError = error && error.message ? error.message : "每日机会快照读取失败";
    }
  }
  const results = await Promise.allSettled(targetMarkets.map(fetchRadarMarket));
  if (requestId !== state.radarRequestId) return;
  const failures = [];
  let freshCount = 0;
  results.forEach(function (result, index) {
    const market = targetMarkets[index];
    if (result.status === "fulfilled") {
      const merged = mergeRadarMarket(state.radarMarkets[market], result.value, "live");
      state.radarMarkets[market] = merged;
      if (merged.loadState === "fresh" || merged.segment?.loadState === "fresh") freshCount += 1;
      if (merged.loadState !== "fresh") failures.push(market + (merged.loadState === "unavailable" ? "尚无有效全市场榜" : "沿用上一次有效候选"));
    } else {
      const message = result.reason && result.reason.message ? result.reason.message : market + "扫描失败";
      failures.push(message);
      if (isRadarSnapshot(state.radarMarkets[market], market)) {
        const snapshot = state.radarMarkets[market];
        if (snapshot.fetchedAt) snapshot.loadState = "stale";
        if (snapshot.segment?.fetchedAt) snapshot.segment = Object.assign({}, snapshot.segment, { loadState: "stale", error: message });
        state.radarMarkets[market].error = message;
      } else {
        state.radarMarkets[market] = { market: market, candidates: [], poolSize: 0, rawSize: 0, loadState: "error", error: message };
      }
    }
  });
  state.radarRows = radarRowsFromSnapshots(state.radarMarkets);
  state.radarSegmentRows = radarSegmentRowsFromSnapshots(state.radarMarkets);
  const currentCount = RADAR_MARKETS.filter(function (market) {
    return isRadarSnapshot(state.radarMarkets[market], market) && radarEffectiveLoadState(state.radarMarkets[market]) === "fresh";
  }).length;
  state.radarStatus = currentCount === RADAR_MARKETS.length ? "success" : currentCount ? "partial" : state.radarRows.length ? "stale" : "error";
  state.radarError = failures.join("；");
  if (freshCount) saveRadarCache();
  render();
}

function fixedPurchaseCost(item) {
  // adjustmentCny is an audit-only component that is already included in the
  // locked purchaseCostCny. Never add it again here.
  const recordedCost = optionalNumber(item.purchaseCostCny ?? item.costCny);
  if (Number.isFinite(recordedCost) && recordedCost >= 0) return recordedCost;
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

function recordedFeeCny(row, side) {
  const recorded = Number(row && row[side + "FeeCny"]);
  return Number.isFinite(recorded) && recorded >= 0 ? recorded : feeCny(row && row[side + "FeeUsd"]);
}

function grossPurchasePrincipalCny(row) {
  return Math.max(0, Number(row.purchaseCostCny) - recordedFeeCny(row, "buy"));
}

function grossSaleAmountCny(row) {
  if (row.status !== "sold") return 0;
  return Number(row.saleProceedsCny) + recordedFeeCny(row, "sell");
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
  applyWorkbookFxFallback();
  return true;
}

function workbookFx(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return null;
  const source = document.source && typeof document.source === "object" ? document.source : {};
  const fx = document.fx && typeof document.fx === "object" ? document.fx : source.fx && typeof source.fx === "object" ? source.fx : null;
  if (!fx) return null;
  const usd = optionalNumber(fx.USD ?? fx.USD_CNY);
  const hkd = optionalNumber(fx.HKD ?? fx.HKD_CNY);
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(hkd) || hkd <= 0) return null;
  return { CNY: 1, USD: usd, HKD: hkd, asOf: String(fx.asOf || source.asOf || document.asOf || "") };
}

function applyWorkbookFxFallback() {
  const fx = workbookFx(state.holdingsDocument);
  if (!fx || (state.fxMeta && state.fxMeta.fallback === false)) return false;
  state.rates = { CNY: 1, USD: fx.USD, HKD: fx.HKD };
  state.fxMeta = { asOf: fx.asOf || null, fetchedAt: null, source: "Excel 锁定汇率", fallback: true };
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
    lotId: String(item.lotId || item.id || ""),
    parentLotId: String(item.parentLotId || ""),
    market: market,
    code: code,
    name: String(item.name || code || "").trim(),
    note: String(item.note || "").trim(),
    quality: String(item.quality || "").trim(),
    cost: Number(item.cost),
    qty: Number(item.qty),
    currency: String(item.currency || currencyForMarket(market)).toUpperCase(),
    purchaseCostCny: optionalNumber(item.purchaseCostCny ?? item.costCny),
    adjustmentCny: optionalNumber(item.adjustmentCny),
    sellProceedsCny: optionalNumber(item.sellProceedsCny ?? item.saleProceedsCny),
    buyFeeUsd: optionalNumber(item.buyFeeUsd),
    sellFeeUsd: optionalNumber(item.sellFeeUsd),
    buyFeeCny: optionalNumber(item.buyFeeCny),
    sellFeeCny: optionalNumber(item.sellFeeCny),
    sina: String(item.sina || providerCodeForHolding(market, code)).toLowerCase(),
    status: status,
    buyDate: String(item.buyDate || ""),
    buyOperationId: String(item.buyOperationId || ""),
    buyFxAsOf: String(item.buyFxAsOf || ""),
    buyFxSource: String(item.buyFxSource || ""),
    sellPrice: optionalNumber(item.sellPrice ?? item.soldPrice ?? item.exitPrice),
    sellDate: String(item.sellDate || item.soldDate || ""),
    sellOperationId: String(item.sellOperationId || ""),
    sellFxAsOf: String(item.sellFxAsOf || ""),
    sellFxSource: String(item.sellFxSource || "")
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
  const buyFees = state.rows.reduce(function (total, row) { return total + recordedFeeCny(row, "buy"); }, 0);
  const sellFees = soldRows.reduce(function (total, row) { return total + recordedFeeCny(row, "sell"); }, 0);
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
  const grossBuysNative = currency === "CNY" ? grossBuys : all.reduce(function (total, row) {
    if (tradeDetailsMissing(row) && Number.isFinite(Number(row.purchaseCostCny))) {
      return total + Number(row.purchaseCostCny) / fx;
    }
    const fee = Number.isFinite(row.buyFeeUsd) && row.buyFeeUsd > 0 ? row.buyFeeUsd * usdToNative : 0;
    return total + row.cost * row.qty + fee;
  }, 0);
  const saleProceedsNative = currency === "CNY" ? saleProceeds : all.reduce(function (total, row) {
    if (tradeDetailsMissing(row) && row.status === "sold" && Number.isFinite(Number(row.saleProceedsCny))) {
      return total + Number(row.saleProceedsCny) / fx;
    }
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
  if (brandAnimationTimer || prefersReducedMotion()) return;
  syncBrandVisuals();
  brandAnimationTimer = window.setInterval(syncBrandVisuals, 100);
}

function prefersReducedMotion() {
  if (!window.matchMedia) return false;
  if (!motionPreference) motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  return motionPreference.matches;
}

function preferredScrollBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}

function topNav() {
  const isBusy = state.tab === "radar" ? (dailyRadarScope() ? state[state.radarScope + "Loading"] : state.radarStatus === "loading") : state.isRefreshing;
  const updateLabel = state.tab === "radar" && dailyRadarScope() ? (state[state.radarScope + "Data"]?.asOf ? radarTimestamp(state[state.radarScope + "Data"].asOf) : "待更新") : state.updatedAt;
  const petDefinition = PET_STATES[brandVisual.petState] || PET_STATES.idle;
  const storedCoins = Array.from({ length: BRAND_COIN_MAX }, function (_, index) {
    return "<i class=\"" + (index < brandVisual.coinCount ? "is-stored" : "") + "\" data-stored-coin=\"" + index + "\"></i>";
  }).join("");
  const updateStatus = isBusy
    ? "<span class=\"market-refresh-status\" role=\"status\" aria-live=\"polite\"><img src=\"assets/pig-logo.png\" alt=\"\"/>" + (state.tab === "radar" ? "小猪正在读取机会" : "小猪正在核算行情") + "</span>"
    : "<span class=\"updated\" role=\"status\">更新于 " + escapeHtml(updateLabel || "待更新") + "</span>";
  return "<header class=\"site-header\"><a class=\"brand\" href=\"#overview\" aria-label=\"猪猪存钱罐 · 小猪状态：" + escapeHtml(petDefinition.label) + " · 返回总览\"><span class=\"brand-scene\" aria-hidden=\"true\"><span class=\"brand-pig-stage\" data-pet-state=\"" + escapeHtml(brandVisual.petState) + "\" data-pet-label=\"" + escapeHtml(petDefinition.label) + "\"><span class=\"brand-pig-sprite\"></span></span><span class=\"brand-wordmark\"><strong data-text=\"猪猪存钱罐\">猪猪存钱罐</strong></span><span class=\"brand-jar-stage\"><span class=\"jar-coin-bank\">" + storedCoins + "</span><span class=\"brand-coins\"><i></i><i></i><i></i><i></i></span><img class=\"brand-jar\" src=\"assets/glass-savings-jar-v1.png\" alt=\"\"/></span></span></a><nav class=\"global-nav\" aria-label=\"主导航\">" +
    NAV_ITEMS.map(function (item) { return "<button class=\"nav-link " + (state.tab === item[0] ? "active" : "") + "\" " + (state.tab === item[0] ? "aria-current=\"page\" " : "") + "type=\"button\" data-tab=\"" + item[0] + "\">" + navIcon(item[0]) + "<span class=\"nav-label\">" + item[1] + "</span></button>"; }).join("") +
    "</nav><div class=\"header-tools\">" + updateStatus + "<div class=\"header-action-group\"><button class=\"header-action-button edit\" type=\"button\" data-open-holding-editor=\"holding\" data-editor-trigger=\"header\">" + headerActionIcon("edit") + "<span>记录交易</span></button><button class=\"header-action-button refresh\" type=\"button\" data-refresh=\"1\"" + (isBusy ? " disabled aria-busy=\"true\"" : "") + ">" + headerActionIcon("refresh") + "<span>刷新</span></button><button class=\"header-action-button logout\" type=\"button\" data-logout aria-label=\"" + (state.isLoggingOut ? "正在退出登录" : "退出登录") + "\"" + (state.isLoggingOut ? " disabled aria-busy=\"true\"" : "") + ">" + headerActionIcon("logout") + "<span>" + (state.isLoggingOut ? "退出中" : "退出") + "</span></button></div></div></header>";
}

function createHoldingDraft(initialStatus) {
  return {
    market: "A股",
    code: "",
    name: "",
    sina: "",
    currency: "CNY",
    operationType: initialStatus === "sold" ? "sell" : "buy",
    tradeDate: localDateString(),
    buyPrice: "",
    buyQty: "",
    sellPrice: "",
    sellQty: ""
  };
}

function openHoldingEditor(initialStatus, trigger) {
  state.holdingEditorTrigger = trigger && trigger.dataset ? String(trigger.dataset.editorTrigger || "header") : "header";
  state.holdingDraft = createHoldingDraft(initialStatus);
  state.holdingLookup = { status: "idle", message: "输入股票代码后自动识别名称", security: null };
  state.holdingSave = { status: "idle", message: "" };
  state.holdingPendingOperation = null;
  state.holdingEditorOpen = true;
  render();
  window.requestAnimationFrame(function () {
    const input = document.querySelector("#holding-code-input");
    if (input) input.focus();
  });
}

function closeHoldingEditor() {
  if (state.holdingSave && (state.holdingSave.status === "syncing" || state.holdingSave.uncertain)) return;
  window.clearTimeout(holdingLookupTimer);
  if (holdingLookupController) holdingLookupController.abort();
  holdingLookupController = null;
  state.holdingEditorOpen = false;
  state.holdingDraft = null;
  state.holdingLookup = { status: "idle", message: "", security: null };
  state.holdingSave = { status: "idle", message: "" };
  state.holdingPendingOperation = null;
  render();
  window.requestAnimationFrame(function () {
    const triggerSelector = "[data-editor-trigger=\"" + state.holdingEditorTrigger.replace(/\"/g, "\\\"") + "\"]";
    const opener = document.querySelector(triggerSelector) || document.querySelector("[data-open-holding-editor]");
    if (opener) opener.focus();
  });
}

function availableHoldingQty(security) {
  if (!security) return 0;
  return state.holdings.filter(function (item) {
    return item.status !== "sold" && (item.sina === security.sina || (item.market === security.market && comparableCode(item.code) === comparableCode(security.code)));
  }).reduce(function (total, item) { return total + Number(item.qty || 0); }, 0);
}

function repositoryPrivacyMarkup() {
  const repository = state.holdingsRepository;
  if (!repository || repository.private !== false) return "";
  return "<div class=\"github-privacy-warning\" role=\"note\"><strong>隐私提醒</strong><span>当前持仓文件位于公开 GitHub 仓库，知道仓库地址的人可以读取。切换为私有仓库前，请不要录入不希望公开的数据。</span></div>";
}

function holdingEditorModal() {
  if (!state.holdingEditorOpen || !state.holdingDraft) return "";
  const draft = state.holdingDraft;
  const lookup = state.holdingLookup || { status: "idle", message: "", security: null };
  const isSell = draft.operationType === "sell";
  const currency = currencyForMarket(draft.market);
  const currencyLabel = currency === "CNY" ? "人民币 CNY" : currency === "HKD" ? "港币 HKD" : "美元 USD";
  const security = lookup.security;
  const availableQty = availableHoldingQty(security);
  const saving = state.holdingSave || { status: "idle", message: "" };
  const isSyncing = saving.status === "syncing";
  const saveLabel = isSyncing ? "正在同步 GitHub…" : saving.status === "error" ? "重试同步" : "保存并同步";
  const saveDisabled = lookup.status !== "success" || isSyncing;
  const resultCard = security
    ? "<div class=\"lookup-result-card\" data-lookup-card><span class=\"lookup-result-mark\">✓</span><div><strong data-lookup-name>" + escapeHtml(security.name) + "</strong><small data-lookup-meta>" + escapeHtml(security.code + " · " + currencyLabel + (isSell ? " · 可卖 " + availableQty + " 股" : security.existing ? " · 将新增一笔买入" : "")) + "</small></div>" + (Number.isFinite(security.price) ? "<b>现价 " + nativeMoney(security.price, security.currency) + "</b>" : "") + "</div>"
    : "<div class=\"lookup-result-card\" data-lookup-card hidden><span class=\"lookup-result-mark\">✓</span><div><strong data-lookup-name></strong><small data-lookup-meta></small></div></div>";
  const priceName = isSell ? "sellPrice" : "buyPrice";
  const qtyName = isSell ? "sellQty" : "buyQty";
  const priceValue = isSell ? draft.sellPrice : draft.buyPrice;
  const qtyValue = isSell ? draft.sellQty : draft.buyQty;
  return "<div class=\"holding-modal-layer\"><button class=\"holding-modal-backdrop\" type=\"button\" data-close-holding-editor aria-label=\"关闭记录交易\"" + (isSyncing ? " disabled" : "") + "></button><section class=\"holding-editor-dialog" + (isSyncing ? " is-syncing" : "") + "\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"holding-editor-title\" aria-describedby=\"holding-editor-description\"><header class=\"holding-editor-head\"><div><span>PORTFOLIO ENTRY</span><h2 id=\"holding-editor-title\">记录一笔交易</h2><p id=\"holding-editor-description\">每次只记录一次买入或卖出；名称、币种和行情代码自动识别。</p></div><button class=\"holding-modal-close\" type=\"button\" data-close-holding-editor aria-label=\"关闭\"" + (isSyncing ? " disabled" : "") + ">×</button></header><form id=\"holding-editor-form\" novalidate aria-busy=\"" + (isSyncing ? "true" : "false") + "\"><fieldset class=\"holding-fieldset\"><legend>1. 选择交易类型</legend><div class=\"holding-choice-grid status-choice\"><label><input type=\"radio\" name=\"operationType\" value=\"buy\"" + (!isSell ? " checked" : "") + (isSyncing ? " disabled" : "") + "/><span><b>买入 / 加仓</b><small>新增一笔买入批次</small></span></label><label><input type=\"radio\" name=\"operationType\" value=\"sell\"" + (isSell ? " checked" : "") + (isSyncing ? " disabled" : "") + "/><span><b>卖出 / 减仓</b><small>按先进先出扣减持仓</small></span></label></div></fieldset><fieldset class=\"holding-fieldset\"><legend>2. 选择市场</legend><div class=\"holding-choice-grid market-choice\">" + ["A股", "港股", "美股"].map(function (market) { return "<label><input type=\"radio\" name=\"market\" value=\"" + market + "\"" + (draft.market === market ? " checked" : "") + (isSyncing ? " disabled" : "") + "/><span>" + market + "</span></label>"; }).join("") + "</div></fieldset><fieldset class=\"holding-fieldset\"><legend>3. 输入股票代码</legend><label class=\"holding-code-field\" for=\"holding-code-input\"><span>股票代码</span><div><input id=\"holding-code-input\" name=\"code\" value=\"" + escapeHtml(draft.code) + "\" placeholder=\"例如 601138 / 1810 / NVDA\" autocomplete=\"off\" autocapitalize=\"characters\" spellcheck=\"false\" aria-describedby=\"holding-code-status\"" + (isSyncing ? " disabled" : "") + "/><button type=\"button\" data-retry-holding-lookup" + (isSyncing ? " disabled" : "") + ">识别</button></div></label><p id=\"holding-code-status\" class=\"holding-lookup-status " + escapeHtml(lookup.status) + "\" data-lookup-status aria-live=\"polite\">" + escapeHtml(lookup.message) + "</p>" + resultCard + "</fieldset><fieldset class=\"holding-fieldset\"><legend>4. 填写成交信息</legend><div class=\"holding-number-grid\"><label><span>成交日期</span><input id=\"holding-trade-date\" name=\"tradeDate\" type=\"date\" value=\"" + escapeHtml(draft.tradeDate) + "\" max=\"" + localDateString() + "\"" + (isSyncing ? " disabled" : "") + "/></label><label><span>" + (isSell ? "卖出价格" : "买入价格") + " <small data-currency-label>" + currency + "</small></span><input id=\"holding-trade-price\" name=\"" + priceName + "\" type=\"number\" min=\"0\" step=\"0.0001\" inputmode=\"decimal\" value=\"" + escapeHtml(priceValue) + "\" placeholder=\"0.00\"" + (isSyncing ? " disabled" : "") + "/></label><label><span>" + (isSell ? "卖出数量" : "买入数量") + (isSell ? " <small>可卖 " + availableQty + "</small>" : "") + "</span><input id=\"holding-trade-qty\" name=\"" + qtyName + "\" type=\"number\" min=\"0\" step=\"any\" inputmode=\"decimal\" value=\"" + escapeHtml(qtyValue) + "\" placeholder=\"0\"" + (isSell && availableQty > 0 ? " max=\"" + availableQty + "\"" : "") + (isSyncing ? " disabled" : "") + "/></label></div></fieldset><aside class=\"holding-fee-card\"><div><span>本次" + (isSell ? "卖出" : "买入") + "手续费</span><strong>US$20</strong></div><p>系统按本次汇率锁定人民币成本或卖出净额，无需手工填写名称、币种和行情代码。" + escapeHtml(policyDescription(state.holdingsDocument && state.holdingsDocument.costPolicy)) + "</p></aside><div class=\"github-sync-note\"><span class=\"github-sync-dot\"></span><div><strong>同步到 GitHub holdings.json</strong><small>服务器按交易流水更新，买入不会覆盖旧批次；卖出按先进先出扣减。同步失败时保留表单。</small></div></div>" + repositoryPrivacyMarkup() + "<p id=\"holding-form-error\" class=\"holding-form-error\" data-holding-form-error role=\"alert\">" + escapeHtml(saving.message || "") + "</p><footer class=\"holding-editor-actions\"><button type=\"button\" data-close-holding-editor" + (isSyncing ? " disabled" : "") + ">取消</button><button class=\"save-holding-button\" type=\"submit\"" + (saveDisabled ? " disabled" : "") + ">" + saveLabel + "</button></footer></form></section></div>";
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
    if (meta) {
      const available = availableHoldingQty(lookup.security);
      meta.textContent = lookup.security ? lookup.security.code + " · " + lookup.security.currency + (state.holdingDraft && state.holdingDraft.operationType === "sell" ? " · 可卖 " + available + " 股" : lookup.security.existing ? " · 将新增一笔买入" : "") : "";
    }
  }
  const save = document.querySelector(".save-holding-button");
  if (save) save.disabled = lookup.status !== "success" || state.holdingSave.status === "syncing";
}

function syncHoldingFormUi() {
  if (!state.holdingDraft) return;
  const currency = currencyForMarket(state.holdingDraft.market);
  document.querySelectorAll("[data-currency-label]").forEach(function (label) { label.textContent = currency; });
  syncHoldingLookupUi();
}

function comparableCode(value) {
  return String(value || "").trim().toUpperCase().replace(/^\$/, "").replace(/^(SH|SZ|BJ|HK|US)[:.]?/, "").replace(/\.(SH|SZ|BJ|HK|US)$/, "").replace(/^0+(?=\d)/, "");
}

function localHoldingMatch(market, code) {
  const target = comparableCode(code);
  return state.holdings.find(function (item) { return item.status !== "sold" && item.market === market && comparableCode(item.code) === target; }) || null;
}

function applyResolvedSecurity(security) {
  const existing = state.holdings.find(function (item) { return item.status !== "sold" && item.sina === security.sina; }) || localHoldingMatch(security.market, security.code);
  const resolved = Object.assign({}, security, { existing: Boolean(existing) });
  state.holdingDraft.code = security.code;
  state.holdingDraft.name = security.name;
  state.holdingDraft.sina = security.sina;
  state.holdingDraft.currency = security.currency;
  const codeInput = document.querySelector("#holding-code-input");
  if (codeInput) codeInput.value = security.code;
  state.holdingLookup = { status: "success", message: existing ? "已识别，并找到当前持仓" : "股票名称识别成功", security: resolved };
  render();
  window.requestAnimationFrame(function () {
    const price = document.querySelector("#holding-trade-price");
    if (price) price.focus();
  });
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

function clearHoldingFieldErrors() {
  document.querySelectorAll("#holding-editor-form [aria-invalid=\"true\"]").forEach(function (field) {
    field.removeAttribute("aria-invalid");
    const describedBy = String(field.getAttribute("aria-describedby") || "").split(/\s+/).filter(function (id) { return id && id !== "holding-form-error"; });
    if (describedBy.length) field.setAttribute("aria-describedby", describedBy.join(" "));
    else field.removeAttribute("aria-describedby");
  });
}

function setHoldingFormError(message, fieldNames) {
  clearHoldingFieldErrors();
  const error = document.querySelector("[data-holding-form-error]");
  if (error) error.textContent = message || "";
  (fieldNames || []).forEach(function (name) {
    const field = document.querySelector("#holding-editor-form [name=\"" + name.replace(/\"/g, "\\\"") + "\"]");
    if (!field) return;
    field.setAttribute("aria-invalid", "true");
    const describedBy = new Set(String(field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    describedBy.add("holding-form-error");
    field.setAttribute("aria-describedby", Array.from(describedBy).join(" "));
  });
  const firstInvalid = document.querySelector("#holding-editor-form [aria-invalid=\"true\"]");
  if (message && firstInvalid) firstInvalid.focus();
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
  return "<div class=\"site-toast " + escapeHtml(state.toast.kind) + "\" role=\"" + (state.toast.kind === "error" ? "alert" : "status") + "\"><span>" + (state.toast.kind === "success" ? "✓" : "!") + "</span>" + escapeHtml(state.toast.message) + "</div>";
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

function createHoldingOperationId() {
  const random = window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2);
  return "op_" + Date.now().toString(36) + "_" + random.slice(0, 14);
}

function currentTradeFx(currency) {
  return {
    tradeToCny: Number(state.rates[currency]) || COST_REFERENCE_RATES[currency] || 1,
    usdToCny: Number(state.rates.USD) || COST_REFERENCE_RATES.USD,
    asOf: state.fxMeta.asOf || localDateString(),
    source: state.fxMeta.source || "固定参考汇率"
  };
}

function holdingOperationFromDraft(draft, security) {
  const isSell = draft.operationType === "sell";
  const price = Number(isSell ? draft.sellPrice : draft.buyPrice);
  const qty = Number(isSell ? draft.sellQty : draft.buyQty);
  const fx = currentTradeFx(security.currency);
  const feeCny = FIXED_TRADE_FEE_USD * fx.usdToCny;
  return {
    operationId: createHoldingOperationId(),
    type: isSell ? "sell" : "buy",
    market: HOLDING_MARKET_KEYS[security.market],
    code: security.code,
    name: security.name,
    date: draft.tradeDate,
    price: price,
    qty: qty,
    feeCny: feeCny,
    purchaseCostCny: isSell ? undefined : price * qty * fx.tradeToCny + feeCny,
    sellProceedsCny: isSell ? price * qty * fx.tradeToCny - feeCny : undefined,
    fxAsOf: fx.asOf,
    fxSource: fx.source
  };
}

async function syncHoldingsToGitHubClient(operation, expectedFileSha = state.holdingsFileSha) {
  const controller = new AbortController();
  const timeout = window.setTimeout(function () { controller.abort(); }, 15000);
  try {
    const response = await fetch("/api/holdings-sync", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedFileSha: expectedFileSha || "", operation: operation }),
      signal: controller.signal
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const error = new Error(payload.error || "GitHub 同步失败");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    if (payload.ok !== true || !isHoldingsDocument(payload.document)) throw new Error("GitHub 没有返回完整持仓确认，请重试");
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      const uncertain = new Error("同步等待超时，正在核对 GitHub 是否已经写入…");
      uncertain.uncertain = true;
      throw uncertain;
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function holdingOperationInDocument(document, operationId) {
  if (document && document.costPolicy && document.costPolicy.lastOperationId === operationId) return true;
  return Boolean(document && Array.isArray(document.lots) && document.lots.some(function (lot) {
    return String(lot && lot.operationId || "") === operationId || String(lot && lot.buy && lot.buy.operationId || "") === operationId || String(lot && lot.sell && lot.sell.operationId || "") === operationId;
  }));
}

async function fetchAuthoritativeHoldings() {
  const controller = new AbortController();
  const timeout = window.setTimeout(function () { controller.abort(); }, 8000);
  try {
    const response = await fetch("/api/holdings-sync", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload.ok !== true || !isHoldingsDocument(payload.document)) throw new Error(payload.error || "无法核对 GitHub 最新持仓");
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

function adoptConfirmedHoldings(result) {
  state.holdingsDocument = result.document;
  state.holdingsFileSha = String(result.fileSha || state.holdingsFileSha || "");
  state.holdingsRepository = result.repository || state.holdingsRepository;
  state.baseHoldings = holdingsFromDocument(result.document);
  state.holdings = state.baseHoldings.slice();
  let cacheSaved = true;
  try { writeStorage(HOLDING_KEY, result.document); } catch { cacheSaved = false; }
  rebuildRows();
  return cacheSaved;
}

function applySuccessfulHoldingSync(result, operation, reconciled) {
  const cacheSaved = adoptConfirmedHoldings(result);
  state.holdingEditorOpen = false;
  state.holdingDraft = null;
  state.holdingLookup = { status: "idle", message: "", security: null };
  state.holdingSave = { status: "idle", message: "" };
  state.holdingPendingOperation = null;
  const confirmation = result.commitSha || result.fileSha || "";
  const verb = operation.type === "buy" ? "买入" : "卖出";
  state.toast = { message: verb + (reconciled ? "已在 GitHub 确认" : "已同步到 holdings.json") + (confirmation ? " · " + confirmation.slice(0, 7) : "") + (cacheSaved ? "" : " · 本地缓存不可用"), kind: cacheSaved ? "success" : "warning" };
  render();
  window.requestAnimationFrame(function () {
    const opener = document.querySelector("[data-editor-trigger=\"" + state.holdingEditorTrigger.replace(/\"/g, "\\\"") + "\"]");
    if (opener) opener.focus();
  });
  refreshData();
}

async function saveHoldingEditor() {
  if (state.holdingSave && state.holdingSave.status === "syncing") return;
  const draft = state.holdingDraft;
  const security = state.holdingLookup && state.holdingLookup.security;
  if (!draft || !security || state.holdingLookup.status !== "success") { setHoldingFormError("请先完成股票代码识别", ["code"]); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.tradeDate) || draft.tradeDate > localDateString()) { setHoldingFormError("请选择今天或更早的成交日期", ["tradeDate"]); return; }
  const isSell = draft.operationType === "sell";
  const priceField = isSell ? "sellPrice" : "buyPrice";
  const qtyField = isSell ? "sellQty" : "buyQty";
  const price = Number(draft[priceField]);
  const qty = Number(draft[qtyField]);
  if (!Number.isFinite(price) || price <= 0) { setHoldingFormError("请填写正确的成交价格", [priceField]); return; }
  if (!Number.isFinite(qty) || qty <= 0) { setHoldingFormError("请填写正确的成交数量", [qtyField]); return; }
  const availableQty = availableHoldingQty(security);
  if (isSell && availableQty <= 0) { setHoldingFormError("这只股票没有可卖持仓，请先记录买入", ["code"]); return; }
  if (isSell && qty > availableQty) { setHoldingFormError("卖出数量不能超过可卖的 " + availableQty + " 股", [qtyField]); return; }

  const operation = state.holdingPendingOperation || holdingOperationFromDraft(draft, security);
  state.holdingPendingOperation = operation;
  state.holdingSave = { status: "syncing", message: "正在等待 GitHub 写入确认…" };
  render();
  try {
    const result = await syncHoldingsToGitHubClient(operation);
    applySuccessfulHoldingSync(result, operation, false);
  } catch (error) {
    if (error.uncertain) {
      try {
        const latest = await fetchAuthoritativeHoldings();
        state.holdingsFileSha = String(latest.fileSha || state.holdingsFileSha || "");
        state.holdingsRepository = latest.repository || state.holdingsRepository;
        if (holdingOperationInDocument(latest.document, operation.operationId)) {
          applySuccessfulHoldingSync(latest, operation, true);
          return;
        }
        state.holdingSave = { status: "error", message: "GitHub 最新文件中还没有这笔交易；已保留同一交易编号，可安全重试", uncertain: true };
      } catch (_) {
        state.holdingSave = { status: "error", message: "暂时无法确认 GitHub 是否写入；请保留表单并点击重试，不要重新录入", uncertain: true };
      }
    } else if (error.status === 409 && error.payload) {
      if (isHoldingsDocument(error.payload.document)) {
        state.holdingsDocument = error.payload.document;
        state.baseHoldings = holdingsFromDocument(error.payload.document);
        state.holdings = state.baseHoldings.slice();
        rebuildRows();
        try { writeStorage(HOLDING_KEY, error.payload.document); } catch { /* GitHub remains authoritative. */ }
      }
      state.holdingsFileSha = String(error.payload.fileSha || error.payload.currentFileSha || state.holdingsFileSha || "");
      state.holdingSave = { status: "error", message: "持仓刚被其他页面更新，已载入最新版；请核对后再次保存" };
    } else {
      state.holdingSave = { status: "error", message: error.message || "GitHub 同步失败，本次未保存" };
    }
    render();
  }
}

function policyDescription(policy) {
  return policy ? "每只股票买入成本 " + money(policy.buyCny, 2) + "，有卖出记录时计卖出成本 " + money(policy.sellCny, 2) + "。同一市场与代码各计一次。" : "";
}

function policyAmounts(editor) {
  const buyCny = Number(editor.buy), sellCny = Number(editor.sell);
  const valid = [editor.buy, editor.sell].every(function (input) {
    return /^\d+(?:\.\d{1,2})?$/.test(input) && Number.isSafeInteger(Math.round(Number(input) * 100));
  });
  return valid ? { buyCny: buyCny, sellCny: sellCny } : null;
}

function policyPreview(editor) {
  const proposed = policyAmounts(editor);
  if (!proposed) return "请输入不小于 0 的人民币金额，最多两位小数。";
  const newTotal = proposed.buyCny * editor.bought + proposed.sellCny * editor.sold;
  const oldTotal = editor.policy.buyCny * editor.bought + editor.policy.sellCny * editor.sold;
  const delta = newTotal - oldTotal;
  return "涉及 " + editor.bought + " 只买入、" + editor.sold + " 只卖出。调整成本合计 " + money(newTotal, 2) +
    (Math.abs(delta) < 0.005 ? "。" : "。按相同行情，累计盈亏将" + (delta > 0 ? "减少 " : "增加 ") + money(Math.abs(delta), 2) + "。");
}

function loadPolicyBaseline(editor, response, resetInputs) {
  const policy = response.document.costPolicy;
  if (!policy || !response.fileSha) throw new Error("尚未读取到 GitHub 成本规则，请重新打开设置。");
  editor.policy = policy;
  editor.fileSha = response.fileSha;
  const rows = holdingsFromDocument(response.document);
  const id = function (row) { return row.market + ":" + row.code; };
  editor.bought = new Set(rows.map(id)).size;
  editor.sold = new Set(rows.filter(function (r) { return r.status === "sold"; }).map(id)).size;
  if (resetInputs) {
    editor.buy = String(policy.buyCny);
    editor.sell = String(policy.sellCny);
  }
}

function costPolicyPanel() {
  const policy = state.holdingsDocument && state.holdingsDocument.costPolicy;
  const editor = state.costPolicyEditor;
  const description = policyDescription(policy);
  const feeText = "新增交易每笔买入或卖出另计 US$20 手续费。";
  if (!editor) return '<div class="cost-policy-summary"><p class="fee-policy-note">' + description + feeText + '</p>' +
    (policy ? '<button type="button" class="text-link" data-open-cost-policy>调整成本规则</button>' : '') + '</div>';
  const pending = Boolean(editor.operation);
  const disabled = pending || !editor.fileSha ? " disabled" : "";
  const busy = editor.status === "loading" || editor.status === "saving";
  return '<form id="cost-policy-form" class="cost-policy-form"><h2>每只股票的成本规则</h2>' +
    '<p>' + description + feeText + '</p><div class="holding-number-grid">' +
    '<label>买入成本（人民币）<input name="buy" type="number" min="0" step="0.01" inputmode="decimal" required value="' + escapeHtml(editor.buy) + '"' + disabled + '></label>' +
    '<label>卖出成本（人民币）<input name="sell" type="number" min="0" step="0.01" inputmode="decimal" required value="' + escapeHtml(editor.sell) + '"' + disabled + '></label></div>' +
    '<p data-policy-preview aria-live="polite">' + (editor.fileSha ? policyPreview(editor) : "") + '</p><p role="status">' + escapeHtml(editor.message) + '</p>' +
    '<div class="cost-policy-actions"><button type="submit" class="primary-button"' + (busy || !editor.fileSha ? " disabled" : "") + '>' +
    (editor.status === "saving" ? "正在同步…" : pending ? "重试同步" : "保存到 GitHub") + '</button>' +
    '<button type="button" class="secondary-button" data-close-cost-policy' + (editor.status === "saving" ? " disabled" : "") + '>关闭</button></div></form>';
}

async function openCostPolicyEditor() {
  const editor = { status: "loading", message: "正在读取 GitHub 最新规则…", buy: "", sell: "", fileSha: "", operation: null };
  state.costPolicyEditor = editor;
  render();
  try {
    const response = await fetchAuthoritativeHoldings();
    if (state.costPolicyEditor !== editor) return;
    loadPolicyBaseline(editor, response, true);
    adoptConfirmedHoldings(response);
    editor.status = "ready";
    editor.message = "";
  } catch (error) {
    editor.status = "error";
    editor.message = error.message;
  }
  if (state.costPolicyEditor === editor) {
    render();
    document.querySelector("#cost-policy-form input:not(:disabled)")?.focus();
  }
}

async function saveCostPolicyEditor() {
  const editor = state.costPolicyEditor;
  if (!editor || !editor.fileSha || editor.status === "saving") return;
  const amounts = policyAmounts(editor);
  if (!amounts) { editor.message = "请检查输入的金额。"; render(); return; }
  if (amounts.buyCny === editor.policy.buyCny && amounts.sellCny === editor.policy.sellCny && !editor.operation) {
    editor.message = "金额与当前规则相同。"; render(); return;
  }
  const operation = editor.operation || Object.assign({ type: "cost-policy", operationId: createHoldingOperationId() }, amounts);
  editor.operation = operation;
  editor.status = "saving";
  editor.message = "正在等待 GitHub 确认…";
  render();
  try {
    let result;
    try {
      result = await syncHoldingsToGitHubClient(operation, editor.fileSha);
    } catch (error) {
      if (!error.uncertain) throw error;
      result = await fetchAuthoritativeHoldings();
      if (!holdingOperationInDocument(result.document, operation.operationId)) {
        if (result.fileSha !== editor.fileSha) { error.status = 409; error.payload = result; }
        throw error;
      }
    }
    if (!holdingOperationInDocument(result.document, operation.operationId)) throw new Error("GitHub 尚未确认这次成本规则调整，请重试。");
    adoptConfirmedHoldings(result);
    state.costPolicyEditor = null;
    showToast("成本规则已同步到 GitHub", "success");
    document.querySelector("[data-open-cost-policy]")?.focus();
  } catch (error) {
    editor.status = "error";
    editor.message = error.message || "同步结果待核对，请重试。";
    if (error.status === 409 && error.payload && isHoldingsDocument(error.payload.document)) {
      const current = error.payload;
      loadPolicyBaseline(editor, { document: current.document, fileSha: current.fileSha || current.currentFileSha }, false);
      adoptConfirmedHoldings({ document: current.document, fileSha: editor.fileSha });
      editor.operation = null;
      editor.message = "GitHub 记录已更新。已载入最新规则，请核对上方金额后再保存。";
    }
    render();
  }
}

function isBeijingWeekend() {
  const date = calendarDateInTimeZone("Asia/Shanghai");
  const parsed = new Date(date + "T12:00:00+08:00");
  return parsed.getUTCDay() === 0 || parsed.getUTCDay() === 6;
}

function portfolioChartA11yMarkup(points) {
  const rows = (points || []).filter(function (point) { return Number.isFinite(Number(point.value)); });
  if (!rows.length) return "<p id=\"portfolio-chart-summary\" class=\"visually-hidden\">暂无累计盈亏走势数据。</p><p id=\"portfolio-chart-live\" class=\"visually-hidden\" role=\"status\" aria-live=\"polite\"></p>";
  const values = rows.map(function (point) { return Number(point.value); });
  const latest = rows[rows.length - 1];
  const summaryText = state.trendDays + "日累计盈亏走势，共 " + rows.length + " 个数据点；最新 " + latest.date + " 为 " + signed(latest.value, 0) + "，区间最高 " + signed(Math.max.apply(null, values), 0) + "，最低 " + signed(Math.min.apply(null, values), 0) + "。";
  return "<p id=\"portfolio-chart-summary\" class=\"visually-hidden\">" + escapeHtml(summaryText) + "使用左右方向键逐点查看，Home 和 End 跳到首尾。</p><p id=\"portfolio-chart-live\" class=\"visually-hidden\" role=\"status\" aria-live=\"polite\"></p><div class=\"visually-hidden\"><table><caption>" + state.trendDays + "日累计盈亏数据</caption><thead><tr><th scope=\"col\">日期</th><th scope=\"col\">累计盈亏（人民币）</th></tr></thead><tbody>" + rows.map(function (point) { return "<tr><th scope=\"row\">" + escapeHtml(point.date) + "</th><td>" + escapeHtml(signed(point.value, 0)) + "</td></tr>"; }).join("") + "</tbody></table></div>";
}

function orderFeeComparison(data) {
  const source = state.holdingsDocument?.source;
  const baseline = source?.orderFeeScenario;
  if (!baseline || ![baseline.buyOrderCount, baseline.sellOrderCount].every(n => Number.isSafeInteger(n) && n >= 0)
      || ![baseline.recordedOrderFeesCny, baseline.scenarioOrderFeesCny].every(n => Number.isFinite(n) && n >= 0)
      || baseline.feeUsdPerOrder !== 2) return null;

  let count = baseline.buyOrderCount + baseline.sellOrderCount;
  let feeDifference = baseline.recordedOrderFeesCny - baseline.scenarioOrderFeesCny;
  if (!Number.isFinite(data.totalPnl)) {
    const snapshotPnl = source.reconciliation?.sourcePnlCny;
    return Number.isFinite(snapshotPnl) ? { pnl: snapshotPnl + feeDifference, count, asOf: source.asOf } : null;
  }

  // Excel orders are already included in the baseline. A website order can be
  // split across several lots by FIFO, each carrying only its share of the fee.
  const orders = new Map();
  for (const row of state.rows) {
    for (const side of ["buy", "sell"]) {
      const id = row[side + "OperationId"];
      if (!id) continue;
      const key = side + ":" + id;
      const order = orders.get(key) || { usd: 0, cny: 0 };
      order.usd += row[side + "FeeUsd"];
      order.cny += recordedFeeCny(row, side);
      orders.set(key, order);
    }
  }
  for (const order of orders.values()) {
    if (!(order.usd > 0) || !Number.isFinite(order.cny) || order.cny <= 0) return null;
    const usdToCny = order.cny / order.usd;
    feeDifference += order.cny - baseline.feeUsdPerOrder * usdToCny;
    count++;
  }
  const stockAdjustments = sum(state.rows, "adjustmentCny") + sum(state.rows, "sellAdjustmentCny");
  return { pnl: data.totalPnl + stockAdjustments + feeDifference, count, asOf: "" };
}

function orderFeeNote(data) {
  const result = orderFeeComparison(data);
  if (!result) return '<p class="order-fee-note">每单 2 美元的盈亏测算正在等待可核对的订单和费用数据。</p>';
  const detail = "每张已成交买单、卖单各计 2 美元，同一订单分多次成交只计一次。按订单汇率换算人民币，替换可核实的订单手续费，免计每只股票的定额成本。A 股历史订单和费用不全，历史交易成本沿用原表。网站新录入的各市场买卖也按单计费。";
  const date = result.asOf ? " · " + escapeHtml(result.asOf) + " 账本估值" : "";
  return '<p class="order-fee-note">若每笔买入或卖出只收 2 美元，累计盈亏约为 <strong class="' +
    tone(result.pnl) + '">' + signed(result.pnl, 2) + '</strong><span>（' + result.count +
    ' 单，A 股历史费用沿用原表' + date + '）</span>' + infoTip(detail) + '</p>';
}

function overviewPage() {
  const data = summary();
  const chartPoints = portfolioSeries(state.trendDays);
  const valuationComplete = data.valuationCount === data.valuationTotal;
  const todayComplete = data.todayCount === data.todayTotal;
  const valuationNote = valuationComplete ? "当前持仓按最新或最近有效行情与汇率折算" : "估值不完整：" + data.valuationCount + "/" + data.valuationTotal + "个持仓有有效价格";
  const todayNote = todayComplete ? "当日价差 × 当前持仓数量" : isBeijingWeekend() ? "周末主要市场休市，沿用最近有效收盘价" : "当日行情不完整：" + data.todayCount + "/" + data.todayTotal + "个持仓有有效涨跌";
  return "<main id=\"main-content\" class=\"page-shell overview-page\" tabindex=\"-1\">" +
    "<section class=\"overview-section account-overview-section\"><div class=\"overview-section-heading account-section-heading\"><div><h1>账户整体</h1></div>" + fxStatusLine() + "</div>" +
    "<div class=\"account-metric-grid\">" +
    overviewMetric("股票总投入（人民币）", money(data.netInvested, 0), data.netInvested !== 0 ? "资金基准 100%" : "暂无投入", "买入总成本 " + money(data.grossBuys, 0) + " − 卖出净额 " + money(data.saleProceeds, 0), "neutral", METRIC_HELP.netInvested) +
    overviewMetric("持仓市值（人民币）", money(data.value, 0), data.netInvested > 0 && Number.isFinite(data.value) ? "占总投入 " + ratioPct(data.value / data.netInvested * 100) : "占总投入 --", valuationNote, "neutral", METRIC_HELP.marketValue) +
    overviewMetric("累计盈亏（人民币）", signed(data.totalPnl, 0), pct(data.totalRate), valuationComplete ? "持仓市值 − 股票总投入" : "等待全部持仓完成估值后计算", tone(data.totalPnl), METRIC_HELP.totalPnl) +
    overviewMetric("今日盈亏（人民币）", signed(data.today, 0), pct(data.todayRate), todayNote, tone(data.today), METRIC_HELP.todayPnl) +
    "</div>" + orderFeeNote(data) + costPolicyPanel() + "</section>" +
    "<section class=\"overview-section market-overview-section\"><div class=\"overview-section-heading\"><div><h2>市场概览</h2></div><p>A 股按人民币记账。港美股的原币盈亏按成交价计算，人民币盈亏另计成本调整和汇兑影响。</p></div><div class=\"overview-market-grid\">" + MARKET_ORDER.map(marketBlock).join("") + "</div></section>" +
    "<section class=\"overview-section pnl-chart-section\"><article class=\"card chart-card overview-chart-card\"><div class=\"chart-heading\"><div><h2>累计盈亏走势（人民币）" + infoTip(METRIC_HELP.chart) + "</h2><div class=\"chart-legend\"><span class=\"legend-item\"><i class=\"legend-dot\"></i>当前累计盈亏 <b class=\"" + tone(data.totalPnl) + "\">" + signed(data.totalPnl, 0) + "</b></span><span class=\"legend-item\"><i class=\"legend-dot blue\"></i>盈亏平衡线（¥0）</span><span class=\"chart-estimate-note\">按当前持仓回溯估算，未反映期间交易</span></div></div>" + trendButtons() + "</div>" + longChartNote(chartPoints) + "<div class=\"canvas-wrap overview-canvas-wrap\"><canvas class=\"line-chart\" data-chart=\"portfolio\" tabindex=\"0\" role=\"img\" aria-label=\"" + state.trendDays + "日累计盈亏走势图\" aria-keyshortcuts=\"ArrowLeft ArrowRight Home End\" aria-describedby=\"portfolio-chart-summary\"></canvas></div>" + portfolioChartA11yMarkup(chartPoints) + "</article></section>" +
    "<section class=\"overview-section ranking-section\"><div class=\"card overview-ranking-card\">" + rankCard() + "</div></section></main>";
}

function infoTip(text) {
  let hash = 0;
  String(text).split("").forEach(function (character) { hash = (hash * 31 + character.charCodeAt(0)) >>> 0; });
  const id = "metric-help-" + hash.toString(36);
  return "<span class=\"info-tip\" tabindex=\"0\" aria-label=\"指标说明\" aria-describedby=\"" + id + "\"><span class=\"info-icon\" aria-hidden=\"true\">i</span><span id=\"" + id + "\" class=\"info-popover\" role=\"tooltip\">" + escapeHtml(text) + "</span></span>";
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
  return "<div class=\"segmented trend-segmented\" aria-label=\"走势图时间范围\">" + [7, 30, 90, 365, 1095].map(function (days) {
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

function tradingPnlNative(row) {
  if (row.currency === "CNY") return row.pnlCny;
  const price = row.status === "sold" ? row.sellPrice : row.price;
  if (!Number.isFinite(price) || tradeDetailsMissing(row)) return NaN;
  const usdToNative = COST_REFERENCE_RATES.USD / (COST_REFERENCE_RATES[row.currency] || 1);
  const feesUsd = (row.buyFeeUsd || 0) + (row.status === "sold" ? row.sellFeeUsd || 0 : 0);
  return (price - row.cost) * row.qty - feesUsd * usdToNative;
}

function stockRankingRows() {
  const groups = new Map();
  state.rows.forEach(function (row) {
    const key = row.market + ":" + row.code;
    const current = groups.get(key) || { market: row.market, code: row.code, name: row.name, currency: row.currency, pnlCny: 0, pnlNative: 0, purchaseCostCny: 0, hasOpen: false, valuationMissing: false };
    const nativePnl = tradingPnlNative(row);
    current.name = row.name || current.name;
    if (Number.isFinite(row.pnlCny)) current.pnlCny += row.pnlCny;
    else if (row.status !== "sold") current.valuationMissing = true;
    if (Number.isFinite(nativePnl)) current.pnlNative += nativePnl;
    else current.pnlNative = NaN;
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
  return "<div class=\"ranking-heading\"><div><h2>个股盈亏排行</h2><p>合并同一股票的持仓与卖出批次，按人民币盈亏排名。" + (pendingCount ? " <b class=\"ranking-pending\">另有 " + pendingCount + " 只待估值，暂不进入排行。</b>" : "") + "</p></div><div class=\"ranking-controls\"><div class=\"ranking-market-tabs\" aria-label=\"排行市场筛选\">" + markets.map(function (market) {
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
    row.nativeTotalCost = row.currency === "CNY" ? row.purchaseCostCny : row.nativeCostTotal + row.buyFeeUsd * COST_REFERENCE_RATES.USD / (COST_REFERENCE_RATES[row.currency] || 1);
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
  return "<main id=\"main-content\" class=\"page-shell action-page\" tabindex=\"-1\"><header class=\"holding-page-heading\"><h1 class=\"page-title\">持仓明细</h1><p>看清仓位、成本与当前浮动盈亏</p></header>" + holdingSnapshotMarkup(allRows) + holdingStructureMarkup(allRows) + holdingToolbarMarkup(allRows, rows) +
    "<section class=\"card holding-list-card\"><div class=\"holding-list-heading\"><div><h2>全部持仓</h2><p>金额首行显示人民币，含买入成本调整。港美股第二行显示原币成交口径。点击表头可排序。</p></div><strong>" + rows.length + " / " + allRows.length + "只</strong></div>" + holdingActionTable(rows) + "</section></main>";
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
  return "<tr class=\"holding-main-row" + (expanded ? " is-expanded" : "") + "\"><th scope=\"row\"><div class=\"holding-stock-cell\"><div>" + stockCell(row) + "</div>" + marketLabel(row.market) + "</div></th><td class=\"number-cell\">" + row.qty.toLocaleString("zh-CN") + "</td><td>" + tableDualMoney(row.nativeTotalCost, row.currency, row.purchaseCostCny, "", "人民币总成本含调整") + "</td><td><div class=\"holding-price-pair\"><span>" + nativeMoney(row.cost, row.currency) + "</span><i>→</i><b>" + currentPrice + "</b><small>" + priceNote + "</small></div></td><td><div class=\"holding-value-cell\"><b>" + money(row.valueCny, 0) + "</b><span>" + weightText + "</span><i><em style=\"width:" + weightWidth + "%\"></em></i></div></td><td>" + todayMarkup + "</td><td>" + cumulativeMarkup + "</td><td><button class=\"holding-expand-button\" type=\"button\" data-toggle-holding=\"" + escapeHtml(row.holdingKey) + "\" aria-expanded=\"" + expanded + "\"" + (expanded ? " aria-controls=\"" + panelId + "\"" : "") + ">" + (expanded ? "收起" : "查看") + "</button></td></tr>" + (expanded ? "<tr class=\"holding-detail-row\"><td colspan=\"8\">" + holdingOutlookMarkup(row, "desktop") + "</td></tr>" : "");
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
  return "<article class=\"holding-mobile-card" + (expanded ? " is-expanded" : "") + "\" role=\"listitem\"><header><div><strong>" + escapeHtml(row.name) + "</strong><span>" + escapeHtml(row.code) + marketSuffix(row) + "</span></div>" + marketLabel(row.market) + "</header><p class=\"holding-mobile-cost\">数量 " + row.qty.toLocaleString("zh-CN") + "股 · 总成本 " + money(row.purchaseCostCny, 0) + "<small>" + (row.currency === "CNY" ? "人民币" : nativeMoney(row.nativeTotalCost, row.currency)) + " · 人民币总成本含调整</small></p><dl><div><dt>买入均价 → 当前价</dt><dd>" + nativeMoney(row.cost, row.currency) + " → " + currentPrice + "<small class=\"holding-price-source\">" + priceNote + "</small></dd></div><div><dt>市值 · 仓位</dt><dd>" + money(row.valueCny, 0) + " · " + ratioPct(row.holdingPct, 2) + "</dd></div><div><dt>今日盈亏</dt><dd>" + todayMarkup + "</dd></div><div><dt>累计盈亏</dt><dd>" + cumulativeMarkup + "</dd></div></dl><button class=\"holding-mobile-expand\" type=\"button\" data-toggle-holding=\"" + escapeHtml(row.holdingKey) + "\" aria-expanded=\"" + expanded + "\"" + (expanded ? " aria-controls=\"" + panelId + "\"" : "") + ">" + (expanded ? "收起未来2周展望" : "查看未来2周展望") + "</button>" + (expanded ? holdingOutlookMarkup(row, "mobile") : "") + "</article>";
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
  const quotedPrice = optionalNumber(item && item.metrics && item.metrics.price);
  if (!Number.isFinite(quotedPrice) || quotedPrice <= 0) return radarLevelUnavailable("invalid", "当前价格不可用", series.length, baseDate);
  const marketDate = radarMarketClock(item.market, now).date;
  if (historyAgeDays(baseDate, marketDate) > 10) return radarLevelUnavailable("stale", "历史行情已超过10天", series.length, baseDate);
  const quotedAt = Date.parse(item.quoteUpdatedAt || "");
  if (!Number.isFinite(quotedAt)) return radarLevelUnavailable("stale", "缺少可核对的报价日期", series.length, baseDate);
  const quoteDate = radarMarketClock(item.market, new Date(quotedAt)).date;
  if (quotedAt > (now || new Date()).getTime() + RADAR_FUTURE_TOLERANCE_MS ||
      historyAgeDays(quoteDate, marketDate) > 10) {
    return radarLevelUnavailable("stale", "报价与最新日线日期不匹配", series.length, baseDate);
  }

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
  // If the ranking is older, its snapshot quote and percentage change belong to
  // that older session. Anchor both reference prices to the verified later close.
  const useLatestClose = baseDate > quoteDate;
  const current = useLatestClose ? latestClose : quotedPrice;
  if (![sigma20, sigma60, sigmaEffective, atr, latestClose].every(Number.isFinite) || sigmaEffective <= 0 || atr <= 0) {
    return radarLevelUnavailable("unstable", "近期波动数据不足", series.length, baseDate);
  }
  if (Math.abs(Math.log(quotedPrice / latestClose)) > Math.log(1.25)) {
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
  const roundedCurrent = Math.round(current * 100) / 100;
  const roundedUpper = Math.round(upper * 100) / 100;
  const displayStops = stopCandidates.map(value => Math.round(value * 100) / 100).filter(value => {
    const distance = 1 - value / current;
    return value > 0 && value < roundedCurrent && distance + 1e-9 >= minimumDistance && distance <= 0.15 + 1e-9;
  });
  const roundedStop = displayStops.length ? Math.max(...displayStops) : NaN;
  if (!(roundedUpper > roundedCurrent)) return radarLevelUnavailable("invalid", "参考上沿未通过价格校验", series.length, baseDate);

  return {
    status: "ready", reason: "基于日对数波动与ATR的10个交易日情景", bars: series.length, baseDate: baseDate,
    referenceClose: useLatestClose ? current : null,
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
  return activeRadarRows().filter(function (item) { return !radarCandidateIsOwned(item, owned); });
}

function compareRadarTopCandidates(left, right) {
  const freshness = (radarEffectiveLoadState(left) === "fresh" ? 0 : 1) - (radarEffectiveLoadState(right) === "fresh" ? 0 : 1);
  if (freshness) return freshness;
  const leftScore = optionalNumber(left.score), rightScore = optionalNumber(right.score);
  if (Number.isFinite(leftScore) !== Number.isFinite(rightScore)) return Number.isFinite(leftScore) ? -1 : 1;
  if (Number.isFinite(leftScore) && leftScore !== rightScore) return rightScore - leftScore;
  const leftAmount = optionalNumber(left.metrics && left.metrics.amount), rightAmount = optionalNumber(right.metrics && right.metrics.amount);
  if (Number.isFinite(leftAmount) !== Number.isFinite(rightAmount)) return Number.isFinite(leftAmount) ? -1 : 1;
  if (Number.isFinite(leftAmount) && leftAmount !== rightAmount) return rightAmount - leftAmount;
  const leftCap = optionalNumber(left.metrics && left.metrics.marketCap), rightCap = optionalNumber(right.metrics && right.metrics.marketCap);
  if (Number.isFinite(leftCap) !== Number.isFinite(rightCap)) return Number.isFinite(leftCap) ? -1 : 1;
  if (Number.isFinite(leftCap) && leftCap !== rightCap) return rightCap - leftCap;
  return String(left.code || left.id || "").localeCompare(String(right.code || right.id || ""));
}

function radarTopThreeByMarket(market) {
  const eligible = radarRowsBeforeFilters().filter(function (item) { return item.market === market && item.topEligible === true; });
  return (state.radarScope === "growth" ? eligible : eligible.sort(compareRadarTopCandidates)).slice(0, 3);
}

function radarLatestUpdate() {
  const entries = RADAR_MARKETS.map(function (market) {
    const snapshot = activeRadarSnapshot(market);
    const timestamp = Date.parse(snapshot && snapshot.fetchedAt || "");
    return Number.isFinite(timestamp) ? { market: market, snapshot: snapshot, timestamp: timestamp } : null;
  }).filter(Boolean);
  const todayEntries = entries.filter(function (entry) {
    return radarEffectiveLoadState(entry.snapshot) === "fresh" && radarSnapshotIsDailyCurrent(entry.snapshot);
  });
  const visibleEntries = todayEntries.length ? todayEntries : entries;
  const latest = visibleEntries.length ? visibleEntries.reduce(function (best, entry) {
    return !best || entry.timestamp > best.timestamp ? entry : best;
  }, null) : null;
  return {
    currentCount: todayEntries.length,
    complete: todayEntries.length === RADAR_MARKETS.length,
    iso: latest ? new Date(latest.timestamp).toISOString() : "",
    value: latest ? latest.snapshot.fetchedAt : ""
  };
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
  if (state.radarSort === "growth10d") return optionalNumber(metrics.return10d);
  if (state.radarSort === "trend") return optionalNumber(metrics.return60d);
  if (state.radarSort === "liquidity") return optionalNumber(metrics.amount) * (state.rates[item.currency] || NaN);
  if (state.radarSort === "risk") return optionalNumber(item.radarScope === "growth" ? item.components?.activity : item.components?.risk);
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

function radarHistoryTargets(rows) {
  const candidates = RADAR_MARKETS.flatMap(radarTopThreeByMarket).concat(rows || []);
  const seen = new Set();
  return candidates.filter(function (item) {
    if (!item || !item.sina || seen.has(item.sina)) return false;
    seen.add(item.sina);
    return true;
  });
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
  const response = await fetch("/api/history?symbols=" + encodeURIComponent(symbols.join(",")) + "&days=90&ohlc=1", { cache: "no-store", signal: signal });
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
  const targets = radarHistoryTargets(view.pageRows);
  const fingerprint = radarVisibleFingerprint(targets);
  if (!fingerprint || fingerprint !== expectedFingerprint || state.tab !== "radar" || dailyRadarScope()) return;
  const missing = targets.filter(function (item) {
    const status = state.radarHistoryStatus[item.sina];
    return item.sina && radarHistoryNeedsRefresh(item.sina) && (!status || status.state !== "loading");
  });
  if (!missing.length) return;

  if (state.radarHistoryController) return;
  const controller = new AbortController();
  const requestId = ++state.radarHistoryRequestId;
  state.radarHistoryController = controller;
  missing.forEach(function (item) {
    state.radarHistoryStatus[item.sina] = { state: "loading", message: "正在补齐历史日线" };
  });
  render();

  const batches = radarHistoryBatches(missing);
  await Promise.all(batches.map(async function (batch) {
    try {
      const histories = await fetchRadarHistoryBatch(batch, controller.signal);
      if (requestId !== state.radarHistoryRequestId) return;
      batch.forEach(function (item) {
        const series = histories[item.sina];
        if (Array.isArray(series) && series.length) {
          state.radarHistories[item.sina] = series;
          state.radarHistoryStatus[item.sina] = { state: "ready", message: "" };
        } else {
          state.radarHistoryStatus[item.sina] = { state: "missing", message: "没有可用历史日线" };
        }
      });
    } catch (error) {
      if (requestId !== state.radarHistoryRequestId) return;
      batch.forEach(function (item) {
        state.radarHistoryStatus[item.sina] = { state: "error", message: error.message || "历史行情加载失败" };
      });
    }
    const checkedAt = new Date().toISOString();
    batch.forEach(function (item) { state.radarHistoryMeta[item.sina] = { checkedAt: checkedAt }; });
    if (state.tab === "radar") render();
  }));
  if (requestId !== state.radarHistoryRequestId) return;
  state.radarHistoryController = null;
  pruneRadarHistoryCache();
}

function scheduleVisibleRadarHistoryLoad() {
  if (state.tab !== "radar" || dailyRadarScope()) return;
  const view = radarPageWindow();
  const targets = radarHistoryTargets(view.pageRows);
  const fingerprint = radarVisibleFingerprint(targets);
  if (fingerprint !== state.radarVisibleFingerprint) {
    window.clearTimeout(radarHistoryTimer);
    radarHistoryTimer = 0;
    state.radarHistoryRequestId += 1;
    if (state.radarHistoryController) {
      state.radarHistoryController.abort();
      for (const [symbol, status] of Object.entries(state.radarHistoryStatus)) {
        if (status.state === "loading") delete state.radarHistoryStatus[symbol];
      }
    }
    state.radarHistoryController = null;
    state.radarVisibleFingerprint = fingerprint;
  }
  const needsLoad = targets.some(function (item) {
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
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    const values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + "年" + values.month + "月" + values.day + "日 " + values.hour + ":" + values.minute;
  } catch (_) {
    return formatUpdatedAt(date);
  }
}

function radarTimeMarkup(value, fallback) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "<span>" + escapeHtml(fallback || "等待今日扫描") + "</span>";
  return "<time datetime=\"" + escapeHtml(date.toISOString()) + "\">" + escapeHtml(radarTimestamp(value)) + "</time>";
}

function radarQuoteTimestamp(item) {
  if (!item || !item.quoteUpdatedAt) return "时间待核验";
  const date = new Date(item.quoteUpdatedAt);
  if (!Number.isFinite(date.getTime())) return "时间待核验";
  const clock = radarMarketClock(item.market, date);
  const hour = String(Math.floor(clock.minutes / 60)).padStart(2, "0");
  const minute = String(clock.minutes % 60).padStart(2, "0");
  return clock.date + " " + hour + ":" + minute + (item.market === "美股" ? " 美东" : " 北京");
}

function radarBandLabel(item) {
  const score = optionalNumber(item.score);
  if (item.radarScope === "growth") return score >= 70 ? { key: "priority", text: "优先研究" } : { key: "watch", text: "候补观察" };
  if (score >= 70) return { key: "priority", text: "优先研究" };
  if (score >= 55) return { key: "watch", text: "候补观察" };
  return { key: "reserve", text: "暂不优先" };
}

function radarScoreRow(label, value, maximum) {
  const amount = optionalNumber(value);
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
  const adjustment = item.riskAdjustment || {};
  const deductions = [];
  if (adjustment.trendPoints > 0) deductions.push("趋势扣 " + Number(adjustment.trendPoints).toFixed(1) + " 分");
  if (adjustment.riskPoints > 0) deductions.push("短期稳定性扣 " + Number(adjustment.riskPoints).toFixed(1) + " 分");
  const adjustmentNote = Array.isArray(adjustment.reasons) ? adjustment.reasons.join("、") : "";
  const eligibility = item.topEligible === false ? '<p class="radar-adjustment">未纳入 Top 3。' +
    escapeHtml([deductions.join("，"), adjustmentNote || "关键行情不足或触发风险门槛"].filter(Boolean).join(" · ")) + '</p>' : "";
  const breakdown = item.radarScope === "growth"
    ? radarScoreRow("近 10 日实际涨跌", components.momentum10d, 40) + radarScoreRow("60 日趋势", components.momentum60d, 20) + radarScoreRow("最近交易日涨幅", components.latestChange, 5) + radarScoreRow("交易活跃度", components.activity, 35)
    : radarScoreRow("趋势动量", components.trend, 35) + radarScoreRow("流动性与规模", components.liquidity, 30) + radarScoreRow("短期波动", components.risk, 20) + radarScoreRow("估值可比性", components.quality, 15);
  const pe = optionalNumber(metrics.pe), pb = optionalNumber(metrics.pb);
  const levels = radarLevelsForItem(item);
  const levelNote = levels.status === "ready"
    ? "10日价位依据 " + levels.bars + " 根日线，历史截至 " + levels.baseDate + "；上沿是历史波动情景，不是目标价；止损参考需以日收盘确认。"
    : "10日价位暂不可算：" + levels.reason + "。";
  return "<div class=\"radar-detail\"><section><h4>评分拆解</h4><div class=\"radar-score-breakdown\">" + breakdown + "</div>" + eligibility + "</section><section class=\"radar-evidence\"><div><h4>为什么进入候选</h4><ul>" + reasons.map(function (reason) { return "<li>" + escapeHtml(reason) + "</li>"; }).join("") + "</ul></div><div><h4>反方与风险</h4><ul>" + risks.map(function (risk) { return "<li>" + escapeHtml(risk) + "</li>"; }).join("") + "</ul></div></section><section class=\"radar-evidence radar-evidence-metrics\"><div><h4>快照指标</h4><p>" + (item.radarScope === "growth" ? "近 10 日实际涨跌 " + pct(metrics.return10d) + " · " : "") + "60日涨跌 " + pct(metrics.return60d) + " · 最近交易日振幅 " + ratioPct(metrics.amplitude, 2) + " · 换手率 " + ratioPct(metrics.turnoverRate, 2) + " · 成交额 " + radarCompactMoney(metrics.amount, item.currency) + " · 总市值 " + radarCompactMoney(metrics.marketCap, item.currency) + " · PE " + (Number.isFinite(pe) ? pe.toFixed(1) : "--") + " · PB " + (Number.isFinite(pb) ? pb.toFixed(1) : "--") + "</p></div><div><h4>价位与持仓关系</h4><p>" + escapeHtml(levelNote + " " + relation) + "</p></div></section><footer>行情来源：" + escapeHtml(item.source || "东方财富行情中心") + " · 行情时间 " + escapeHtml(radarQuoteTimestamp(item)) + " · 扫描于 " + escapeHtml(radarTimestamp(item.fetchedAt)) + "。研究优先级不是上涨概率，也不等于买入建议。</footer></div>";
}

function radarPricePlanMarkup(item, inTopThree = false) {
  const metrics = item.metrics || {}, levels = radarLevelsForItem(item);
  const cached = radarEffectiveLoadState(item) !== "fresh";
  const quoteTime = (cached ? "缓存 · " : "") + radarQuoteTimestamp(item);
  const dailyChange = Number.isFinite(optionalNumber(metrics.changePct)) ? "当日 " + pct(metrics.changePct) : "当日涨跌待核验";
  const hasNewerClose = Number.isFinite(levels.referenceClose);
  const quoteLabel = hasNewerClose ? levels.baseDate + " 收盘" : inTopThree ? dailyChange : quoteTime + " · " + dailyChange;
  const loading = levels.status === "loading" || levels.loading;
  const wrapperClass = "radar-price-plan " + (loading ? "is-loading" : levels.status === "ready" ? "is-ready" : levels.status === "error" ? "is-error" : "is-unavailable");
  const upperReady = levels.status === "ready" && Number.isFinite(levels.upper) && Number.isFinite(levels.upperPct);
  const stopReady = levels.status === "ready" && Number.isFinite(levels.stop) && Number.isFinite(levels.stopPct);
  const upperValue = upperReady ? nativeMoney(levels.upper, item.currency) : "—";
  const upperLabel = item.radarScope === "growth" ? "未来10日参考上沿" : "10日参考上沿";
  const stopValue = stopReady ? nativeMoney(levels.stop, item.currency) : "—";
  const upperNote = upperReady ? "上行空间 " + pct(levels.upperPct) : levels.reason;
  const stopNote = stopReady ? "距现价 " + pct(levels.stopPct) : levels.status === "ready" ? levels.stopReason : "待日线核验";
  return '<dl class="' + wrapperClass + '" aria-label="' + escapeHtml(item.name) + '未来10个交易日价格参考" aria-busy="' + loading + '">' +
    '<div class="radar-price-point is-current"><dt>' + (hasNewerClose ? "最近收盘价" : "当前价") + '</dt><dd>' + nativeMoney(hasNewerClose ? levels.referenceClose : metrics.price, item.currency) + '</dd><small>' + escapeHtml(quoteLabel) + '</small></div>' +
    '<div class="radar-price-point is-upper"><dt>' + upperLabel + '<span class="visually-hidden">，波动情景，非目标价</span></dt><dd>' + upperValue + '</dd><small>' + escapeHtml(upperNote) + '</small></div>' +
    '<div class="radar-price-point is-stop"><dt>风控止损参考<span class="visually-hidden">，日收盘低于时复核</span></dt><dd>' + stopValue + '</dd><small>' + escapeHtml(stopNote) + '</small></div></dl>';
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

function radarSnapshotErrorText(snapshot, fallback) {
  if (!snapshot || !snapshot.error) return fallback || "";
  return typeof snapshot.error === "object" ? snapshot.error.message || fallback || "" : String(snapshot.error);
}

function radarMarketStat(market) {
  const snapshot = state.radarMarkets[market];
  const usable = isRadarSnapshot(snapshot, market) && snapshot.loadState !== "unavailable";
  const pool = usable ? optionalNumber(snapshot.poolSize) : NaN;
  const priority = usable ? snapshot.candidates.filter(function (item) { return optionalNumber(item.score) >= 70; }).length : 0;
  const loadState = radarEffectiveLoadState(snapshot);
  const priorDay = Boolean(snapshot && !radarSnapshotIsDailyCurrent(snapshot));
  const stateText = loadState === "fresh" ? "今日已更新" : loadState === "stale" ? "今日更新失败 · 沿用旧榜" : loadState === "cached" ? priorDay ? "缓存 · 非今日" : snapshot && snapshot.error ? "缓存 · 更新失败" : "上次缓存" : loadState === "error" || loadState === "unavailable" ? "今日更新失败" : "等待扫描";
  const cardClass = loadState === "error" || loadState === "unavailable" || !snapshot ? "is-error" : loadState === "cached" || loadState === "stale" ? "is-partial" : "";
  const rawSize = usable ? optionalNumber(snapshot.rawSize) : NaN;
  const note = loadState === "error" || loadState === "unavailable" ? radarSnapshotErrorText(snapshot, "本市场扫描失败") : loadState === "stale" ? radarSnapshotErrorText(snapshot, "今日后台更新失败，明确沿用上次有效候选。") : loadState === "cached" ? priorDay ? "当前是非今日缓存；可点击顶部刷新手动重试。" : snapshot && snapshot.error ? "今日重新扫描失败，页面会稍后重试。" : "正在获取今日结果。" : "按本市场自身分布评分；候选数量不足200只时不会发布本期排名。";
  const time = snapshot && snapshot.fetchedAt ? "<span class=\"radar-market-time\">机会扫描 " + radarTimeMarkup(snapshot.fetchedAt) + " · 北京时间</span>" : "<span class=\"radar-market-time\">机会扫描时间待更新</span>";
  return "<article class=\"radar-market-stat " + cardClass + "\"><header><span>" + marketLabel(market) + "</span><small>" + escapeHtml(stateText) + "</small></header><dl><div><dt>有效候选</dt><dd>" + (Number.isFinite(pool) ? pool : "--") + "<small>只</small></dd></div><div><dt>优先研究</dt><dd>" + (usable ? priority : "--") + "<small>只</small></dd></div><div><dt>原始扫描</dt><dd>" + (Number.isFinite(rawSize) ? rawSize : "--") + "<small>只</small></dd></div></dl><p>" + time + "<small>" + escapeHtml(note) + "</small></p><progress max=\"500\" value=\"" + (Number.isFinite(rawSize) ? Math.min(500, rawSize) : 0) + "\">" + (Number.isFinite(rawSize) ? rawSize : 0) + "/500</progress></article>";
}

function radarTopThreeEvidence(item) {
  const metrics = item.metrics || {}, components = item.components || {};
  const trend = optionalNumber(metrics.return60d), liquidity = optionalNumber(components.liquidity);
  const facts = [];
  let positive = Array.isArray(item.reasons) && item.reasons[0];
  if (item.radarScope === "growth") {
    const measured = optionalNumber(metrics.return10d);
    positive = Number.isFinite(measured) ? "近 10 个交易日实际涨跌 " + pct(measured) : "近 10 个交易日实际涨跌待核对";
    const activity = (item.reasons || []).find(function (reason) { return /量比|换手率|成交额占/.test(reason); });
    if (activity) facts.push(activity);
    if (Number.isFinite(trend)) facts.push("近 60 日 " + pct(trend));
  } else {
    if (Number.isFinite(trend)) facts.push("60 日涨跌 " + pct(trend));
    if (Number.isFinite(liquidity)) facts.push("流动性与规模 " + liquidity.toFixed(1) + "/30");
  }
  const risk = Array.isArray(item.risks) && item.risks.find(function (text) {
    return text && !text.includes("不代表上涨概率");
  });
  const amplitude = optionalNumber(metrics.amplitude);
  const caution = risk || (Number.isFinite(amplitude) ? "最近交易日振幅 " + ratioPct(amplitude, 2) + "，留意持有期内的价格波动。" : "日内波动信息有限，需复核近期行情。");
  return '<dl class="radar-top3-evidence"><div><dt>为什么入选</dt><dd>' + escapeHtml(positive || "综合评分位居本市场前列") +
    (facts.length ? '<small>' + escapeHtml(facts.join(" · ")) + '</small>' : '') + '</dd></div>' +
    '<div class="radar-top3-risk"><dt>关注风险</dt><dd>' + escapeHtml(caution) + '</dd></div></dl>';
}

function radarTopThreeMarket(market) {
  const growth = state.radarScope === "growth";
  const snapshot = activeRadarSnapshot(market);
  const label = growth ? snapshot?.label || RADAR_SEGMENT_LABELS[market] : market;
  const loadState = radarEffectiveLoadState(snapshot);
  const rows = radarTopThreeByMarket(market);
  const stateText = loadState === "fresh" ? "今日已扫描" : loadState === "stale" ? "沿用旧榜" : loadState === "cached" ? "缓存榜单" : loadState === "error" || loadState === "unavailable" ? "更新失败" : "等待更新";
  const cardClass = loadState === "fresh" ? "" : loadState === "cached" || loadState === "stale" ? " is-cached" : " is-error";
  const pool = optionalNumber(snapshot && snapshot.poolSize);
  const availability = growth ? market : Number.isFinite(pool) ? "有效候选 " + pool + " 只" : "候选数待更新";
  const coverage = growth && snapshot && (["fresh", "cached", "stale"].includes(loadState) || Number.isInteger(snapshot.total)) ? '<div class="radar-segment-coverage"><p>' + escapeHtml(snapshot.scope || label) + '</p><dl>' +
    [["范围内标的", snapshot.total], ["有效报价", snapshot.quotedCount], ["完成评分", snapshot.scoredCount], ["达到门槛", snapshot.qualifiedCount]].map(function ([key, value]) {
      return '<div><dt>' + key + '</dt><dd>' + (Number.isInteger(value) && value >= 0 ? value + ' 只' : '待核对') + '</dd></div>';
    }).join("") + '</dl></div>' : growth && snapshot?.scope ? '<div class="radar-segment-coverage"><p>' + escapeHtml(snapshot.scope) + '</p></div>' : "";
  const hasScannedCandidates = Array.isArray(snapshot && snapshot.candidates) && snapshot.candidates.length > 0;
  const knownGrowthPool = growth && ["fresh", "cached", "stale"].includes(loadState);
  const emptyReason = growth && !snapshot ? "当前快照尚未包含这个板块，等待独立扫描。" :
    knownGrowthPool ? (hasScannedCandidates ? "本期符合门槛的股票均已持有。" : "本期报价中暂无同时满足趋势、活跃度、风险门槛和 65 分要求的股票。") : hasScannedCandidates ? "排除持仓并检查行情完整度和波动门槛后，本市场暂无符合条件的股票。" :
    radarSnapshotErrorText(snapshot, loadState === "error" ? "本市场今日更新失败，请稍后重试。" : "等待可用的市场扫描结果。");
  const list = rows.length ? '<ol class="radar-top3-list">' + rows.map(function (item, index) {
    const score = optionalNumber(item.score);
    const cached = radarEffectiveLoadState(item) !== "fresh";
    const saved = state.saved.some(function (entry) { return entry.id === item.id; });
    const action = saved ? "移出观察" : "加入观察";
    return '<li class="radar-top3-item' + (cached ? ' is-cached' : '') + '"><span class="radar-top3-rank" aria-label="第' + (index + 1) + '名">' + (index + 1) + '</span>' +
      '<div class="radar-top3-security"><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(item.code) + ' · ' + escapeHtml(item.currency) + '</span></div>' +
      '<div class="radar-top3-score"><strong>' + (Number.isFinite(score) ? score.toFixed(1) : "—") + '</strong><small>' + (growth ? '成长动量分' : '研究分') + '</small></div>' +
      radarPricePlanMarkup(item, true) + radarTopThreeEvidence(item) +
      '<footer class="radar-top3-tools"><small>评分快照 ' + escapeHtml(radarQuoteTimestamp(item)) + '</small>' +
      '<button type="button" data-toggle-watch="' + escapeHtml(item.id) + '" aria-pressed="' + saved + '" aria-label="将' + escapeHtml(item.name) + action + '">' + action + '</button></footer></li>';
  }).join("") + '</ol>' + (rows.length < 3 ? '<p class="radar-top3-shortfall">本期仅 ' + rows.length + ' 只符合入榜条件。</p>' : '') :
    '<div class="radar-top3-empty"><strong>' + (hasScannedCandidates || knownGrowthPool ? "暂无符合入榜条件的股票" : "暂无可展示候选") + '</strong><p>' + escapeHtml(emptyReason) + '</p></div>';
  const successfulScan = snapshot && snapshot.fetchedAt ? '<small class="radar-successful-scan">榜单采集 ' + radarTimeMarkup(snapshot.fetchedAt) + ' 北京</small>' : '';
  const legacyNote = snapshot && snapshot.modelVersion === "radar-v1.1" ? '<small class="radar-successful-scan">旧快照按本期规则复核</small>' : '';
  return '<article class="radar-top3-market' + cardClass + '"><header><div><h3>' + escapeHtml(label) + ' Top 3</h3>' + successfulScan + legacyNote + '</div><div><strong>' + stateText +
    '</strong><span>' + availability + '</span></div></header>' + coverage + list + '</article>';
}

function radarTopThreeSection() {
  const update = radarLatestUpdate();
  const growth = state.radarScope === "growth";
  const title = growth ? "成长板块 Top 3" : update.complete ? "今日三地 Top 3" : "三地市场 Top 3";
  const intro = growth ? "创业板、港股科技与纳斯达克分别独立扫描、评分。榜单排除当前持仓。下方列表可查看通过门槛的板块候选。" :
    "从未持有股票中按本市场研究分选取，剔除过热与关键信息缺失的候选。两周按 10 个交易日估算，上沿反映历史波动，收盘低于止损参考时复核。";
  const attempted = state.radarAttemptedAt;
  const time = attempted ? radarTimeMarkup(attempted) : radarTimeMarkup(update.value, "时间待更新");
  const timeLabel = attempted ? "最近后台尝试" : "最近榜单采集";
  const status = update.complete ? growth ? "三个板块今日更新完成" : "三市场今日更新完成" : update.currentCount ? "今日已更新 " + update.currentCount + "/3" : update.value ? "当前显示上次榜单" : "等待首次扫描";
  return '<section class="card radar-top3-section" aria-labelledby="radar-top3-title"><header class="radar-top3-head"><div><h2 id="radar-top3-title">' + title +
    '</h2><p>' + intro + '</p></div>' +
    '<div class="radar-top3-update"><span>' + status + '</span><b>' + timeLabel + ' ' + time + ' 北京</b>' +
    '<small>每日 08:10 后台更新 · 08:40 补扫失败市场</small></div></header><div class="radar-top3-grid">' + RADAR_MARKETS.map(radarTopThreeMarket).join("") + '</div></section>';
}

function radarWatchAside() {
  const live = new Map(state.radarRows.concat(state.radarSegmentRows).map(function (item) { return [(item.radarScope || "market") + ":" + item.id, item]; }));
  const owned = radarOwnedSets();
  const saved = state.saved.slice().reverse();
  return "<aside class=\"card radar-watch-aside\" aria-labelledby=\"radar-watch-title\"><header><div><h2 id=\"radar-watch-title\" tabindex=\"-1\">观察清单</h2><span>仅保存在当前浏览器</span></div><b>" + saved.length + "</b></header>" + (saved.length ? saved.map(function (entry) {
    const current = live.get((entry.radarScope || "market") + ":" + entry.id), item = current || entry;
    const score = optionalNumber(item.score), isOwned = radarCandidateIsOwned(item, owned);
    const added = radarTimestamp(entry.addedAt || entry.fetchedAt);
    const scoreLabel = item.radarScope === "growth" ? "成长动量分 " : "研究分 ";
    const status = isOwned ? "已持有 · 自动退出候选排序" : current ? (radarEffectiveLoadState(current) === "fresh" ? "当前" : "缓存") + scoreLabel + (Number.isFinite(score) ? score.toFixed(1) : "--") : "已退出本期候选 · 加入时 " + (Number.isFinite(score) ? score.toFixed(1) + "分" : "未评分") + " · " + added;
    return "<article class=\"radar-saved-row" + (isOwned ? " is-owned" : current ? "" : " is-archived") + "\">" + marketLabel(item.market) + "<div><strong>" + escapeHtml(item.name) + "</strong><span>" + escapeHtml(item.code + (item.segmentLabel ? " · " + item.segmentLabel : "")) + " · " + escapeHtml(status) + "</span></div><button type=\"button\" class=\"text-button\" data-toggle-watch=\"" + escapeHtml(entry.id) + "\" aria-label=\"将" + escapeHtml(item.name) + "移出观察\">移除</button></article>";
  }).join("") : "<div class=\"radar-empty\"><strong>还没有观察标的</strong><p>先展开评分依据，再把值得继续研究的股票加入这里。</p></div>") + "</aside>";
}

function radarScopeControls() {
  const scopes = [["preopen", "盘前预测"], ["intraday", "盘中确认"], ["growth", "成长板块"], ["market", "全市场"]];
  return '<div class="radar-scope-switch" role="group" aria-label="机会雷达视图">' +
    scopes.map(([key, label]) => '<button type="button" data-radar-scope="' + key + '" aria-pressed="' +
      (state.radarScope === key) + '">' + label + '</button>').join("") + '</div>';
}

const INTRADAY_CLOCKS = {
  "A股": { zone: "Asia/Shanghai", label: "北京时间", lunch: [690, 780] },
  "港股": { zone: "Asia/Hong_Kong", label: "香港时间", lunch: [720, 780] },
  "美股": { zone: "America/New_York", label: "美东时间" }
};
const INTRADAY_PHASES = { preopen: "未开盘", open: "交易中", break: "午间休市", closed: "已收盘", holiday: "休市" };
const INTRADAY_MAX_AGE = 8 * 60000;

function intradayClock(value, market) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INTRADAY_CLOCKS[market].zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: p.year + "-" + p.month + "-" + p.day, time: p.hour + ":" + p.minute,
    minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function intradayMarketState(snapshot, market, now) {
  const clock = intradayClock(now, market);
  const scanned = intradayClock(snapshot.scannedAt, market);
  const age = now - Date.parse(snapshot.scannedAt);
  const lunch = INTRADAY_CLOCKS[market].lunch;
  if (snapshot.sessionDate !== clock.date) return { phase: "unknown", live: false };
  const close = Date.parse(snapshot.closeAt);
  let phase = snapshot.phase;
  if (phase === "open") {
    if (Number.isFinite(close) && now >= close) phase = "closed";
    else if (lunch && clock.minutes >= lunch[0] && clock.minutes < lunch[1]) phase = "break";
  }
  const fresh = scanned?.date === clock.date && age >= -60000 && age < INTRADAY_MAX_AGE;
  const sameSession = !lunch || clock.minutes < lunch[1] || (scanned && scanned.minutes >= lunch[1]);
  return { phase, live: phase === "open" && snapshot.status === "live" && fresh && sameSession && Number.isFinite(close) && now < close };
}

function intradayNumber(value) {
  return Number.isInteger(value) && value >= 0 ? value.toLocaleString("zh-CN") : "—";
}

function intradayPrices(item, market) {
  const trigger = optionalNumber(item.triggerPrice);
  const target = optionalNumber(item.targetPrice);
  if (!(trigger > 0 && target > 0)) return "";
  const currency = { "A股": "CNY", "港股": "HKD", "美股": "USD" }[market];
  const price = value => value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return '<dl class="intraday-prices"><div><dt>触发价 · ' + currency + '</dt><dd>' + price(trigger) +
    '</dd></div><div><dt>达标收盘价 · ' + currency + '</dt><dd>' + price(target) +
    '</dd></div></dl><p class="intraday-distance">从触发价到收盘还需上涨 <b>' + ratioPct((target / trigger - 1) * 100, 2) + '</b></p>';
}

function intradaySignals(rows, market) {
  return '<ol class="intraday-signals">' + rows.map((item, index) => {
    const clock = intradayClock(item.triggerAt, market);
    const ratio = optionalNumber(item.volumeRatio);
    const reasons = Array.isArray(item.reasons) ? item.reasons.filter(x => typeof x === "string") : [];
    const risks = Array.isArray(item.risks) ? item.risks.filter(x => typeof x === "string") : [];
    return '<li><header><span class="intraday-rank">' + (index + 1) + '</span><div><strong>' + escapeHtml(item.name || item.code) +
      '</strong><small>' + escapeHtml(item.code) + ' · ' + (clock?.time || "—") + ' 触发</small></div></header>' +
      intradayPrices(item, market) + '<p class="intraday-evidence">触发时较昨收 ' + pct(item.changePct) +
      (Number.isFinite(ratio) ? ' · 量比 ' + ratio.toFixed(2) + ' 倍' : '') + '</p>' +
      (reasons.length ? '<ul class="intraday-reasons">' + reasons.map(reason => '<li>' + escapeHtml(reason) + '</li>').join("") + '</ul>' : '') +
      (risks.length ? '<p class="intraday-risk"><b>风险</b> ' + escapeHtml(risks.join("；")) + '</p>' : '') + '</li>';
  }).join("") + '</ol>';
}

function intradayHistory(last, market) {
  if (!last?.sessionDate || !Array.isArray(last.candidates) || !last.candidates.length) return "";
  const clock = intradayClock(last.scannedAt, market);
  const rows = last.candidates.filter(item => item && item.code && intradayClock(item.triggerAt, market)?.date === last.sessionDate);
  if (!rows.length) return "";
  return '<details class="intraday-history" data-intraday-history="' + market + '"' +
    (state.intradayHistoryOpen[market] ? ' open' : '') + '><summary>历史信号 · ' + escapeHtml(last.sessionDate) +
    ' <small>' + rows.length + ' 只</small></summary><div><p>归档扫描 ' + (clock?.time || "—") + ' ' +
    INTRADAY_CLOCKS[market].label + '</p>' + intradaySignals(rows, market) + '</div></details>';
}

function intradayMarketCard(market, now) {
  const snap = state.intradayData?.markets?.[market];
  const label = RADAR_SEGMENT_LABELS[market];
  if (!snap) return '<article class="card intraday-board"><h3>' + label + '</h3><p class="intraday-empty">' +
    (state.intradayError ? "暂未取得该市场的盘中数据。" : "正在读取市场状态…") + '</p></article>';
  const { phase, live } = intradayMarketState(snap, market, now);
  const local = INTRADAY_CLOCKS[market].label;
  const scan = intradayClock(snap.scannedAt, market);
  const close = intradayClock(snap.closeAt, market);
  const phaseLabel = INTRADAY_PHASES[phase] || "状态待更新";
  const rows = (live && !state.intradayError && Array.isArray(snap.candidates) ? snap.candidates : []).filter(item =>
    item && item.code && intradayClock(item.triggerAt, market)?.date === snap.sessionDate);
  const phaseMessage = { unknown: "等待本地新交易日的扫描。", holiday: "休市，下一交易日开盘后扫描。",
    closed: "今天的交易已结束。", preopen: "等待开盘后的第一轮有效行情。", break: "午间休市，下午开盘后继续扫描。" }[phase];
  let message = phaseMessage || snap.reason || (live ? "本轮没有同时满足信号和风控条件的股票。" : "等待新一轮有效行情。");
  if (phase === "open" && !live && snap.status === "live") message = "上次报价已过期，正在等待新的盘中信号。";
  if (state.intradayError) message = "行情读取未完成，暂缓展示盘中信号。";
  return '<article class="card intraday-board"><header><div><small>' + market + ' · ' + local + '</small><h3>' +
    escapeHtml(snap.label || label) + '</h3></div><span class="intraday-phase' + (live && !state.intradayError ? " is-live" : "") + '">' +
    phaseLabel + '</span></header><p class="intraday-session">' + escapeHtml(snap.sessionDate || "") +
    (close ? ' · 收盘 ' + close.time : '') + '</p><p class="intraday-scope">' + escapeHtml(snap.scope || "") + '</p>' +
    '<dl class="intraday-coverage"><div><dt>股票池</dt><dd>' + intradayNumber(snap.total) + '</dd></div><div><dt>有效报价</dt><dd>' +
    intradayNumber(snap.quotedCount) + '</dd></div><div><dt>参与评分</dt><dd>' + intradayNumber(snap.scoredCount) +
    '</dd></div></dl><p class="intraday-scan">最近扫描 ' + (scan ? scan.date + ' ' + scan.time : '尚无记录') +
    '</p>' + (rows.length ? intradaySignals(rows, market) : '<p class="intraday-empty">' + escapeHtml(message) + '</p>') +
    intradayHistory(snap.lastSession, market) + '</article>';
}

function intradayEvaluation() {
  const data = state.intradayData;
  const rows = RADAR_MARKETS.map(market => [RADAR_SEGMENT_LABELS[market], data?.markets?.[market]?.evaluation]);
  const populated = rows.some(([, e]) => e && (e.signalCount > 0 || e.days > 0 || e.pendingCount > 0));
  return '<section class="card intraday-evaluation"><h2>收盘验证</h2><p>最近 20 个有记录的已收盘交易日，同一只股票每天按首次触发价核对一次。两项条件同时达到才计为达标。</p>' +
    (populated ? '<div class="intraday-results">' + rows.map(([label, e]) => {
      const n = e?.verifiedCount;
      return '<article><h3>' + label + '</h3><strong>' +
        (n > 0 ? intradayNumber(e.hitCount) + ' / ' + intradayNumber(n) + ' 达标' : '暂无已验证样本') +
        '</strong><p>' + (n > 0 ? '历史达标率 ' + ratioPct(e.hitRate, 1) + ' · ' + intradayNumber(e.days) + ' 个交易日<br>' +
          '全天涨幅达标 ' + intradayNumber(e.dayHitCount) + ' 只 · 触发后涨幅达标 ' + intradayNumber(e.afterHitCount) + ' 只<br>' : '') +
        '待收盘 ' + intradayNumber(e?.pendingCount) + ' 只 · 缺收盘价 ' + intradayNumber(e?.missingCount) + ' 只</p></article>';
    }).join("") + '</div>' : '<p class="intraday-empty">' + (data ? '尚无已验证样本。首个盘中信号出现并取得当日收盘价后，这里会显示实际达标记录。' : '等待扫描与验证记录。') + '</p>') + '</section>';
}

function intradayPage() {
  const data = state.intradayData;
  const now = Date.now();
  return '<main id="main-content" tabindex="-1" class="page-shell radar-page intraday-page"><header class="radar-page-heading"><div><h1 class="page-title">机会雷达</h1>' +
    '<p class="page-subtitle">创业板 · 港股科技 · 纳斯达克</p></div>' + radarScopeControls() + '</header>' +
    '<section class="card intraday-target"><div><h2>当日异动观察</h2><p>交易时段每 5 分钟筛选一次，寻找放量走强、距收盘仍有上涨空间的股票。</p></div>' +
    '<dl><div><dt>收盘较昨收</dt><dd>≥ 5%</dd></div><div><dt>收盘较触发价</dt><dd>≥ 3%</dd></div></dl></section>' +
    '<p class="intraday-updated" role="status">' + (state.intradayError ? escapeHtml(state.intradayError) :
      data ? '页面状态更新于 ' + escapeHtml(radarTimestamp(data.asOf)) + ' 北京' : '正在读取盘中扫描记录…') + '</p>' +
    '<section class="intraday-grid" aria-label="三地盘中观察名单">' + RADAR_MARKETS.map(market => intradayMarketCard(market, now)).join("") +
    '</section>' + intradayEvaluation() + '</main>';
}

function preopenStamp(value, market) {
  const clock = intradayClock(value, market);
  return clock ? clock.date + " " + clock.time : "时间待核";
}

function preopenDetails(id, title, content) {
  const key = escapeHtml(id);
  return '<details class="preopen-details" data-preopen-details="' + key + '"' + (state.preopenOpen[id] ? " open" : "") +
    '><summary data-preopen-focus="' + key + '">' + escapeHtml(title) + '</summary><div>' + content + '</div></details>';
}

function preopenSourceLink(label, value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return '<a href="' + escapeHtml(url.href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label || "查看来源") + '</a>';
  } catch {}
  return escapeHtml(label || "来源待核");
}

function preopenPrice(value, market) {
  const currency = {"A股":"CNY","港股":"HKD","美股":"USD"}[market];
  return new Intl.NumberFormat("zh-CN", {style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 4}).format(value);
}

function preopenPick(pick, market, cutoffAt) {
  const citations = (pick.evidence || []).filter(e => e && e.label && Date.parse(e.at) <= Date.parse(cutoffAt));
  const evidence = citations.map(e => '<li><strong>' + escapeHtml(e.label) + '</strong><p>' + escapeHtml(e.detail) +
    '</p><small>' + preopenSourceLink(e.source, e.url) + (e.at ? ' · ' + preopenStamp(e.at, market) : '') + '</small></li>').join("");
  const price = optionalNumber(pick.prevClose);
  const target = optionalNumber(pick.targetPrice);
  const prePrice = optionalNumber(pick.prePrice);
  const quote = value => preopenPrice(value, market);
  const risk = pick.risk || (pick.risks || []).join("；");
  return '<li class="preopen-pick"><h4>' + escapeHtml(pick.name || pick.code) + ' <small>' + escapeHtml(pick.code) +
    '</small></h4><p class="preopen-target-price">' + (price > 0 ? '昨收 ' + quote(price) +
      ' · 触及线 ' + quote(target > 0 ? target : price * 1.05) + '<br>' : '') +
    (prePrice > 0 ? '冻结前价格 ' + quote(prePrice) + (Number.isFinite(optionalNumber(pick.preChangePct)) ? '（' + pct(pick.preChangePct) + '）' : '') +
      (pick.prePriceAt ? ' · ' + preopenStamp(pick.prePriceAt, market) : '') : '盘前价待核对') + '</p>' +
    '<ul class="preopen-evidence">' + evidence + '</ul>' + (risk ? '<p class="preopen-risk">关注风险 · ' + escapeHtml(risk) + '</p>' : '') + '</li>';
}

function preopenFrozen(snapshot, market) {
  const picks = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
  const jumped = Array.isArray(snapshot.jumped) ? snapshot.jumped : [];
  const id = "preopen-" + market + "-" + snapshot.tradeDate;
  let html = '<p class="preopen-frozen-time">冻结截止 ' + preopenStamp(snapshot.cutoffAt, market) +
    (snapshot.observedAt ? '<br>输入采集时间 ' + preopenStamp(snapshot.observedAt, market) : '') +
    (snapshot.publishedAt ? '<br>名单发布时间 ' + preopenStamp(snapshot.publishedAt, market) : '') + '</p>';
  if (snapshot.status === "frozen") {
    html += picks.length ? '<ol class="preopen-picks">' + picks.slice(0,3).map(item => preopenPick(item, market, snapshot.cutoffAt)).join("") + '</ol>'
      : '<p class="preopen-notice"><strong>本次冻结为空榜</strong>' + escapeHtml(snapshot.reason || "没有股票同时达到两类独立证据要求。") + '</p>';
  } else {
    html += '<p class="preopen-notice"><strong>本次预测缺少可核实数据</strong>' + escapeHtml(snapshot.reason || "本次未生成可用名单。") + '</p>';
  }
  if (jumped.length) html += preopenDetails(id + "-jumped", "盘前已跳涨 · " + jumped.length + " 只",
    '<ul class="preopen-jumped">' + jumped.map(row => {
      const jumpPct = row.jumpPrice > 0 && row.prevClose > 0 ? (row.jumpPrice / row.prevClose - 1) * 100 : null;
      const source = row.jumpSource ? ' · ' + preopenSourceLink(row.jumpSource, row.jumpUrl) : '';
      return '<li><div><strong>' + escapeHtml(row.name || row.code) + ' <small>' + escapeHtml(row.code) + '</small></strong>' +
        '<p class="preopen-target-price">' + (jumpPct !== null ? '盘前达标价 ' + preopenPrice(row.jumpPrice, market) + '（' + pct(jumpPct) + '）' : '盘前达标价待核') + (row.jumpAt ? ' · ' + preopenStamp(row.jumpAt, market) : '') +
        source + (Number.isFinite(optionalNumber(row.preChangePct)) ? '<br>冻结前最新 ' + pct(row.preChangePct) : '') + '</p></div></li>';
    }).join("") + '</ul>');
  if (snapshot.sources?.length || snapshot.coverage) {
    const c = snapshot.coverage;
    const coverage = c ? '<p class="preopen-scope">昨收可核 ' + intradayNumber(c.referenceCount) + ' 只' +
      (Number.isInteger(c.eligibleCount) ? ' · 通过流动性等门槛 ' + intradayNumber(c.eligibleCount) + ' 只' : '') + ' · 竞价或盘前成交 ' + intradayNumber(c.auctionCount) + ' 只 · 当日事件 ' + intradayNumber(c.eventCount) + ' 只 · 同业线索 ' + intradayNumber(c.contextCount) + ' 只' +
      (Number.isInteger(c.auctionAttempted) ? '<br>已尝试读取竞价 ' + intradayNumber(c.auctionAttempted) + ' 只 · 同时点异常放量 ' + intradayNumber(c.abnormalVolumeCount) + ' 只' : '') +
      (market === "美股" ? '<br>美股每轮最多逐只核验 8 只的盘前成交。' : '') +
      (c.comparablePriceRejected > 0 ? '<br>剔除昨收口径不一致 ' + intradayNumber(c.comparablePriceRejected) + ' 只' : '') + '</p>' : '';
    const statuses = {available:"可用", partial:"部分可用", unavailable:"未取得"};
    html += preopenDetails(id + "-sources", "数据来源与覆盖", coverage + '<ul class="preopen-source-list">' +
      (snapshot.sources || []).map(s => '<li><b>' + preopenSourceLink(s.label || s.source, s.url) + '</b> · ' + (statuses[s.status] || "待核") +
        '<p>' + escapeHtml(s.detail || "覆盖情况待核") + '</p></li>').join("") + '</ul>');
  }
  return html;
}

function preopenMarketCard(market) {
  const snap = state.preopenData?.markets?.[market];
  const label = RADAR_SEGMENT_LABELS[market];
  if (!snap) return '<article class="card preopen-board"><h3>' + label + '</h3><p class="preopen-stage">' +
    (state.preopenError || state.preopenData ? '暂未取得该市场的冻结记录，请刷新重试。' : '正在读取冻结记录…') + '</p></article>';
  const current = snap.latest?.tradeDate === snap.sessionDate ? snap.latest : null;
  const older = snap.latest && !current ? snap.latest : null;
  const status = {"waiting":"待冻结","frozen":"已冻结","missed":"本次缺档","unavailable":"数据待核"}[snap.phase] || "待核对";
  const anchor = intradayClock(snap.cutoffAt || snap.nextCutoffAt, market);
  const date = anchor?.date || snap.sessionDate;
  const zone = INTRADAY_CLOCKS[market].label;
  let body = current ? preopenFrozen(current, market) : '<p class="preopen-notice">' +
    escapeHtml(snap.reason || (snap.phase === "waiting" ? "等待本场开盘前的冻结时点。" : "该交易日尚无可核实的盘前名单。")) + '</p>';
  if (older) body += preopenDetails("preopen-prev-" + market, "上一次记录 · " + older.tradeDate, preopenFrozen(older, market));
  if (!snap.latest && snap.phase === "waiting") body += '<p class="preopen-first">尚无历史冻结记录。</p>';
  return '<article class="card preopen-board"><header><div><small>' + market + ' · ' + zone + '</small><h3>' + escapeHtml(snap.label || label) +
    '</h3></div><span class="preopen-tag ' + (snap.phase === "frozen" ? "is-frozen" : "") + '">' + status + '</span></header>' +
    '<dl class="preopen-clock"><div><dt>当地冻结时间</dt><dd>' + escapeHtml(anchor?.time || "—") + '</dd></div><div><dt>交易日</dt><dd>' +
    escapeHtml(date || "待定") + '</dd></div></dl><p class="preopen-scope">' + escapeHtml(snap.scope || label) +
    (Number.isInteger(snap.total) ? ' · ' + snap.total.toLocaleString("zh-CN") + ' 只' : '') +
    (snap.membershipAsOf ? '<br>候选名册更新于 ' + escapeHtml(String(snap.membershipAsOf).slice(0,10)) : '') + '</p>' + body + '</article>';
}

function preopenExample() {
  return '<details class="card preopen-example" data-preopen-details="preopen-example"' + (state.preopenOpen["preopen-example"] ? " open" : "") +
    '><summary data-preopen-focus="preopen-example"><strong>看判读示例</strong><span>虚构股票 · 独立演示</span></summary>' +
    '<div class="preopen-example-grid"><article><small>主榜候选</small><h3>乙股</h3><p>昨晚上调业绩指引。盘前涨 1.8%，成交额为过去同一时点中位数的 3 倍。公告与资金响应相互印证。</p></article>' +
    '<article><small>证据不足</small><h3>甲股</h3><p>过去 10 天涨了 22%，当天没有新的公司公告，盘前成交平淡。本轮留在候选池。</p></article>' +
    '<article><small>已跳涨</small><h3>丙股</h3><p>冻结时已有可靠的盘前成交，价格较昨收涨 6%。单列观察，主榜席位留给仍有上涨空间的股票。</p></article></div>' +
    '<p class="preopen-example-outcome">假设乙股盘中最高涨 7%、收盘涨 1%，这一笔记为「盘中命中 · 收盘回落」。示例不参与历史统计。</p></details>';
}

function preopenFirstTouch(row, market) {
  const touch = row.firstTouch;
  if (!row.hit || !touch) return "";
  if (touch.kind === "open") return "开盘即触及";
  if (touch.kind === "interval" && touch.start && touch.end) {
    return "首次触及区间 " + (intradayClock(touch.start, market)?.time || "—") + "–" + (intradayClock(touch.end, market)?.time || "—");
  }
  return touch.at ? "首次触及 " + preopenStamp(touch.at, market) : "盘中触及，时刻待核";
}

function preopenReview(snap, market) {
  if (!snap) return '<p class="preopen-notice">' + (state.preopenError || state.preopenData ? "暂未取得该市场的验证记录。" : "正在读取验证记录…") + '</p>';
  const e = snap.evaluation;
  if (!e?.days) return '<p class="preopen-notice">尚无已复核的冻结记录。交易日结束后，这里将比较盘前主榜、全候选池和昨日涨幅前三。</p>';
  const tableRows = [["picks","盘前主榜"],["pool","全候选池"],["yesterdayLeaders","昨日涨幅前三"]].map(([k,title]) => {
    const g = e.groups?.[k];
    if (!g) return '<tr><th scope="row">' + title + '</th><td colspan="4">待核实</td></tr>';
    return '<tr><th scope="row">' + title + '</th><td>' + intradayNumber(g.hits) + ' / ' + intradayNumber(g.verified) + '</td><td>' +
      (g.verified ? ratioPct(g.hitRate,1) : '—') + '</td><td>' + intradayNumber(g.held) + '</td><td>' + intradayNumber(g.missing) + '</td></tr>';
  }).join("");
  const picks = e.groups?.picks;
  const detail = (snap.results || []).filter(r => Array.isArray(r.rows)).slice().sort((a,b) => String(b.tradeDate).localeCompare(String(a.tradeDate)))[0];
  const details = detail?.rows.filter(r => r.groups?.includes("picks")).map(r => '<li><strong>' +
    escapeHtml(r.name || r.code) + ' <small>' + escapeHtml(r.code) + '</small></strong><p>' +
    (r.status === "verified" ? '盘中最高 ' + pct(r.highChangePct) + ' · 收盘 ' + pct(r.closeChangePct) + ' · 开盘至收盘 ' +
      pct(r.openToClosePct) + (r.hit ? ' · ' + preopenFirstTouch(r, market) + ' · ' + (r.held ? '守住涨幅' : '收盘回落') : ' · 未触及')
      : escapeHtml(r.reason || "行情缺失，待核实")) + '</p></li>').join("");
  return '<p class="preopen-sample">' + escapeHtml(e.fromDate || "") + ' 至 ' + escapeHtml(e.toDate || "") + ' · ' +
    intradayNumber(e.days) + ' 个交易日 · 空榜 ' + intradayNumber(e.emptyDays) + ' 天</p>' +
    '<div class="preopen-table-wrap" tabindex="0" role="region" aria-label="可横向滚动的验证对比"><table class="preopen-table"><thead><tr><th>样本组</th>' +
    '<th>触及 / 已核</th><th>触及率</th><th>收盘守住</th><th>缺数据</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>' +
    (picks ? '<p class="preopen-breakdown">主榜共 ' + intradayNumber(picks.count) + ' 笔，开盘即触及 ' + intradayNumber(picks.openHits) + ' 笔，盘中才触及 ' +
      intradayNumber(picks.intradayHits) + ' 笔，触及后收盘回落 ' + intradayNumber(picks.faded) + ' 笔。</p>' : '') +
    (details ? preopenDetails("preopen-outcomes-" + market, "最近收盘明细 · " + detail.tradeDate, '<ul class="preopen-journal">' + details + '</ul>') : '');
}

function preopenPage() {
  const market = state.preopenReviewMarket;
  const tabs = RADAR_MARKETS.map(m => '<button type="button" data-preopen-focus="review-' + m + '" data-preopen-market="' + m +
    '" aria-pressed="' + (m === market) + '">' + escapeHtml(RADAR_SEGMENT_LABELS[m]) + '</button>').join("");
  return '<main id="main-content" tabindex="-1" class="page-shell radar-page preopen-page"><header class="radar-page-heading"><div><h1>机会雷达</h1>' +
    '<p>创业板 · 港股科技 · 纳斯达克</p></div>' + radarScopeControls() + '</header>' +
    '<section class="card preopen-brief"><div><h2>当日大涨预测</h2><p>开盘前 5 分钟冻结名单。公司公告、盘前买盘、同业走势至少有两类信号相互印证，才进入主榜。每个市场最多 3 只，允许空榜。</p></div>' +
    '<div class="preopen-goal"><span>盘中触及线</span><strong>+5<small>%</small></strong><span>相对可比昨收</span></div></section>' +
    (state.preopenData?.asOf ? '<p class="preopen-updated">记录读取时间 ' + preopenStamp(state.preopenData.asOf, "A股") + ' 北京时间</p>' : '') +
    (state.preopenError ? '<p class="preopen-error" role="status">' + escapeHtml(state.preopenError) + (state.preopenData ? ' 当前展示上次读取的记录。' : '') + '</p>' : '') +
    '<section class="preopen-boards" aria-label="三地盘前冻结名单">' + RADAR_MARKETS.map(preopenMarketCard).join("") + '</section>' +
    preopenExample() + '<section class="card preopen-review"><header><div><h2>收盘验证</h2><p>最高价触及 +5% 计为命中，另看收盘能否守住。按市场分别统计最近 20 个已记录交易日。缺少可核对行情的样本单列。</p></div>' +
    '<div class="preopen-review-tabs" role="group" aria-label="选择验证市场">' + tabs + '</div></header>' +
    preopenReview(state.preopenData?.markets?.[market],market) + '</section></main>';
}

function radarPage() {
  if (state.radarScope === "preopen") return preopenPage();
  if (state.radarScope === "intraday") return intradayPage();
  const view = radarPageWindow();
  const allRows = view.rows, totalPages = view.totalPages, start = view.start, pageRows = view.pageRows;
  state.radarPage = view.page;
  const poolTotal = RADAR_MARKETS.reduce(function (total, market) { return total + (Number(state.radarMarkets[market] && state.radarMarkets[market].poolSize) || 0); }, 0);
  const growth = state.radarScope === "growth";
  const scopeControls = radarScopeControls();
  const availableRows = radarRowsBeforeFilters();
  const query = state.radarQuery.trim().toUpperCase();
  const scopeRows = availableRows.filter(function (item) {
    return radarBandMatches(item) && (!query || String(item.code || "").toUpperCase().includes(query) || String(item.name || "").toUpperCase().includes(query));
  });
  const freshMarketCount = RADAR_MARKETS.filter(function (market) { return radarEffectiveLoadState(state.radarMarkets[market]) === "fresh"; }).length;
  let displayStatus = state.radarStatus;
  if (displayStatus !== "loading" && poolTotal && freshMarketCount === 0) displayStatus = state.radarError ? "stale" : "cached";
  else if (displayStatus !== "loading" && poolTotal && freshMarketCount < RADAR_MARKETS.length) displayStatus = "partial";
  const scanStatus = displayStatus === "loading" ? "正在更新三地市场，保留上次结果供查看…" : displayStatus === "error" ? "三地市场今日扫描均失败。" + (state.radarError || "请稍后重试。") : displayStatus === "stale" ? "三地市场今日更新均失败，当前仅展示已明确标记的缓存。" + (state.radarError || "") : displayStatus === "partial" ? "部分市场未完成今日扫描，已标明旧榜。" + (state.radarError ? " " + state.radarError : "") : displayStatus === "cached" ? "正在展示非今日的上次扫描结果，页面会自动尝试今日更新。" : "三地市场今日扫描完成。";
  const marketOptions = ["全部"].concat(RADAR_MARKETS).map(function (market) {
    const count = market === "全部" ? scopeRows.length : scopeRows.filter(function (item) { return item.market === market; }).length;
    return "<button type=\"button\" data-radar-market=\"" + market + "\" aria-pressed=\"" + (state.watchMarket === market) + "\">" + (growth && market !== "全部" ? RADAR_SEGMENT_LABELS[market] : market) + " <small>" + count + "</small></button>";
  }).join("");
  const bandOptions = [["priority", "优先研究"], ["watch", "候补观察"], ["reserve", "暂不优先"], ["all", "全部分数"]].map(function (option) {
    return "<button type=\"button\" data-radar-band=\"" + option[0] + "\" aria-pressed=\"" + (state.radarBand === option[0]) + "\">" + option[1] + "</button>";
  }).join("");
  const growthSortOption = growth ? '<option value="growth10d"' + (state.radarSort === "growth10d" ? " selected" : "") + '>近 10 日实际涨跌</option>' : "";
  const bandFilter = growth ? "" : '<fieldset class="radar-filter-group"><legend>研究级别</legend><div class="radar-filter-options">' + bandOptions + '</div></fieldset>';
  const scans = '<section class="radar-scan-grid" aria-label="扫描覆盖" aria-busy="' + (state.radarStatus === "loading") + '">' + RADAR_MARKETS.map(radarMarketStat).join("") + '</section>';
  const method = growth ? '<details class="card radar-method-card"><summary><b>怎么判断成长动量</b><small>入榜条件与 10 日价位</small></summary><div class="radar-method-list">' +
    '<div><strong>板块内独立评分</strong><span>按同板块股票的相对位置评分。近 10 日实际涨跌占 40 分，60 日趋势占 20 分，最近交易日涨跌占 5 分，交易活跃度占 35 分。</span></div>' +
    '<div><strong>趋势与活跃门槛</strong><span>近 10 个交易日实际涨幅为正，且排名达到板块第 60 百分位。近 60 日和最近交易日均上涨，活跃度达到板块中位数，使用量比时还须达到 1 倍。</span></div>' +
    '<div><strong>成交额下限</strong><span>A 股至少 2,000 万元、港股至少 1,000 万港元、美股至少 500 万美元。美股股价还须达到 3 美元。</span></div>' +
    '<div><strong>活跃度与风险</strong><span>同一板块统一使用量比、换手率或成交额占总市值。排除行情缺失与过热股票后，成长动量达到 65 分才进入候选，最多保留 240 只。</span></div>' +
    '<div><strong>两周价格情景</strong><span>用历史日线波动估算未来 10 个交易日的参考上沿和止损价。价位数据不足时显示原因。</span></div></div></details>' : '<details class="card radar-method-card"><summary><b>怎么判断选择</b><small>评分权重、两周价位算法与三地扫描明细</small></summary>' +
    '<div class="radar-method-list"><div><strong>入池条件</strong><span>按成交额扫描，各市场至少 200 只有效股票才发布排名。剔除无有效价格、成交额或市值的记录及命中排除规则的产品。</span></div>' +
    '<div><strong>同市场评分</strong><span>60日趋势25 + 最近交易日动量10，成交额20 + 市值10，振幅与涨跌稳定性20，相对PE与PB合计15。分数越高，研究优先级越高。</span></div>' +
    '<div><strong>两周价格情景</strong><span>用最近 60 个交易日的收益波动与真实波幅估算 10 日上沿。止损参考结合波动带与近期支撑，日线或价格条件不满足时显示原因。</span></div>' +
    '<div><strong>Top 3 风险门槛</strong><span>日涨跌绝对值 ≥7% 或振幅 ≥8%，稳定性最多扣 6 分。60 日涨幅 ≥60%，趋势最多扣 8 分。以上情况及关键涨跌、振幅缺失时，仍保留在候选列表。</span></div></div>' + scans + '</details>';
  const levelStates = pageRows.map(radarLevelsForItem);
  const readyLevels = levelStates.filter(function (levels) { return levels.status === "ready"; }).length;
  const loadingLevels = levelStates.filter(function (levels) { return levels.status === "loading" || levels.loading; }).length;
  const unavailableLevels = Math.max(0, pageRows.length - readyLevels - loadingLevels);
  const levelProgress = !pageRows.length ? "当前无待计算股票" : loadingLevels
    ? "10日价位计算中 " + readyLevels + "/" + pageRows.length
    : "10日价位已计算 " + readyLevels + "/" + pageRows.length + (unavailableLevels ? " · " + unavailableLevels + "只数据不足" : "");
  const results = pageRows.length ? "<p class=\"radar-level-progress\" role=\"status\" aria-live=\"polite\">" + escapeHtml(levelProgress) + "</p><ol class=\"radar-candidate-list\">" + pageRows.map(function (item, index) { return radarCandidateRow(item, start + index + 1); }).join("") + "</ol>" : "<div class=\"radar-empty\"><strong>没有符合当前条件的候选</strong><p>" + (growth ? "可清除搜索或切换板块，扫描覆盖与入榜门槛见上方。" : "可以切换到“全部分数”或清除搜索条件。") + "</p><button type=\"button\" class=\"outline-button\" data-radar-clear>清除筛选</button></div>";
  const pagination = "<nav class=\"radar-pagination\" aria-label=\"候选结果分页\"><button type=\"button\" data-radar-page=\"" + (state.radarPage - 1) + "\"" + (state.radarPage <= 1 ? " disabled" : "") + ">上一页</button><span>第 " + state.radarPage + " / " + totalPages + " 页</span><button type=\"button\" data-radar-page=\"" + (state.radarPage + 1) + "\"" + (state.radarPage >= totalPages ? " disabled" : "") + ">下一页</button></nav>";
  const notice = growth || displayStatus === "success" ? "" : '<p class="radar-scan-status' +
    (displayStatus === "error" || displayStatus === "stale" ? ' error' : '') + '" role="status">' + escapeHtml(scanStatus) + '</p>';
  return '<main id="main-content" tabindex="-1" class="page-shell radar-page"><header class="radar-page-heading"><div><h1 class="page-title">机会雷达</h1>' +
    '<p class="page-subtitle">' + (growth ? "创业板 · 港股科技 · 纳斯达克" : '有效基础池 <b>' + (poolTotal || "—") + ' 只</b>') + ' · 可研究 ' + availableRows.length +
    ' 只</p></div>' + scopeControls + '</header>' + radarTopThreeSection() + notice + method + "<section class=\"card radar-toolbar" + (growth ? " is-growth" : "") + "\" role=\"search\" aria-label=\"筛选机会候选\"><label class=\"radar-search\"><span>筛选候选列表</span><input type=\"search\" value=\"" + escapeHtml(state.radarQuery) + "\" placeholder=\"输入名称或代码\" data-radar-search></label><fieldset class=\"radar-filter-group\"><legend>" + (growth ? "板块" : "市场") + "</legend><div class=\"radar-filter-options\">" + marketOptions + "</div></fieldset>" + bandFilter + "<label class=\"radar-sort\"><span>排序</span><select data-radar-sort><option value=\"score\"" + (state.radarSort === "score" ? " selected" : "") + ">" + (growth ? "成长动量分" : "研究优先级") + "</option>" + growthSortOption + "<option value=\"trend\"" + (state.radarSort === "trend" ? " selected" : "") + ">60日趋势</option><option value=\"liquidity\"" + (state.radarSort === "liquidity" ? " selected" : "") + ">成交额（折人民币）</option><option value=\"risk\"" + (state.radarSort === "risk" ? " selected" : "") + ">" + (growth ? "交易活跃度（高到低）" : "波动稳定度（高到低）") + "</option><option value=\"change\"" + (state.radarSort === "change" ? " selected" : "") + ">最近交易日涨跌</option></select></label><p class=\"radar-result-status\" role=\"status\">筛选后 " + allRows.length + " 只，当前显示 " + (pageRows.length ? start + 1 : 0) + "–" + (start + pageRows.length) + "。" + (growth ? "板块按钮显示当前搜索条件下的可研究数量。" : "市场按钮显示当前级别和搜索条件下的数量。") + "</p></section><div class=\"radar-content-grid\"><section class=\"card radar-results-card\" aria-labelledby=\"radar-results-title\"><header class=\"radar-results-head\"><div><h2 id=\"radar-results-title\" tabindex=\"-1\">" + (growth ? "成长板块候选股票" : "候选股票") + "</h2><p>按当前条件和排序展示，优先列出最新扫描。</p></div><span>每页 " + RADAR_PAGE_SIZE + " 只</span></header>" + (state.radarStatus === "loading" && !activeRadarRows().length ? "<div class=\"radar-loading\"><strong>正在读取每日机会快照…</strong><p>后台每日扫描三地市场；当前页面只读取统一快照。</p></div>" : results + pagination) + "</section>" + radarWatchAside() + "</div></main>";
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
  const invalid = tradeDateRangeInvalid();
  const invalidAttributes = invalid ? " aria-invalid=\"true\" aria-describedby=\"trade-filter-status\"" : "";
  return "<div class=\"trade-filter-controls\"><div class=\"trade-date-range\" role=\"group\" aria-label=\"卖出日期范围\"><label><span>卖出日期从</span><input type=\"date\" value=\"" + escapeHtml(state.tradeDateStart) + "\" data-trade-date-start" + invalidAttributes + "></label><span aria-hidden=\"true\">至</span><label><span>卖出日期到</span><input type=\"date\" value=\"" + escapeHtml(state.tradeDateEnd) + "\" data-trade-date-end" + invalidAttributes + "></label></div><label class=\"trade-sort-field\"><span>排序依据</span><select data-trade-sort>" + sortOptions + "</select></label><button class=\"secondary-button trade-sort-direction\" type=\"button\" data-trade-sort-direction aria-label=\"切换排序方向，当前" + tradeSortDirectionLabel().replace(/[↑↓]\s*/, "") + "\">" + tradeSortDirectionLabel() + "</button>" + (tradeFiltersActive() ? "<button class=\"text-button trade-clear-filter\" type=\"button\" data-clear-trade-filters>清除筛选</button>" : "") + "</div>";
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
  return "<main class=\"page-shell\"><div class=\"filter-bar\"><div><h1 class=\"page-title\" style=\"margin:0\">卖出记录</h1><p class=\"section-helper\">按卖出批次查看已实现盈亏，人民币金额已计入适用的买卖成本。</p></div><button class=\"primary-button\" type=\"button\" data-open-holding-editor=\"sold\" data-editor-trigger=\"trades\">录入卖出</button></div><section class=\"trade-kpis\">" +
    tradeKpi("已卖出批次", soldRows.length + " 笔", "盈利 " + wins + " 笔 · 胜率 " + winRate.toFixed(0) + "%") + tradeKpi("买入成本", money(purchaseCost, 0), "该批次分摊的人民币买入成本") + tradeKpi("卖出金额", money(saleProceeds, 0), "扣除卖出费用后的人民币净额") + tradeKpi("已实现盈亏", signed(realizedPnl, 0), "卖出金额 − 买入成本", tone(realizedPnl)) + "</section>" +
    "<section class=\"card table-card sold-record-section\"><div class=\"trade-toolbar\"><div class=\"trade-toolbar-heading\">" + soldMarketTabs() + "<span class=\"trade-source\">卖出批次来自 GitHub holdings.json</span></div>" + soldFilterControls() + "</div><p id=\"trade-filter-status\" class=\"trade-result-summary" + (tradeDateRangeInvalid() ? " is-error" : "") + "\" role=\"status\">" + (tradeDateRangeInvalid() ? "日期范围无效，请调整后查看记录。" : "当前显示 " + soldRows.length + " / " + allSoldCount + " 笔卖出记录") + "</p><div class=\"table-scroll sold-record-desktop\"><table class=\"sold-record-table\"><caption class=\"visually-hidden\">卖出记录，可按市场、卖出时间、盈亏金额或收益率筛选排序</caption><thead><tr><th scope=\"col\">卖出日期</th><th scope=\"col\">市场</th><th scope=\"col\">股票</th><th scope=\"col\">买入价</th><th scope=\"col\">卖出价</th><th scope=\"col\">数量</th><th scope=\"col\">买入成本</th><th scope=\"col\">卖出金额</th><th scope=\"col\">已实现盈亏</th><th scope=\"col\">收益率</th></tr></thead><tbody>" + (soldRows.length ? soldRows.map(soldRecordRow).join("") : "<tr><td colspan=\"10\">" + soldEmptyState() + "</td></tr>") + "</tbody></table></div><div class=\"sold-record-mobile\">" + (soldRows.length ? soldRows.map(soldRecordMobileCard).join("") : soldEmptyState()) + "</div></section></main>";
}

function soldMarketTabs() {
  const allSold = state.rows.filter(function (row) { return row.status === "sold"; });
  return "<div class=\"tab-group\">" + ["全部", "A股", "港股", "美股"].map(function (market) {
    const count = market === "全部" ? allSold.length : allSold.filter(function (row) { return row.market === market; }).length;
    return "<button type=\"button\" class=\"" + (state.tradeMarket === market ? "active" : "") + "\" data-trade-market=\"" + market + "\" aria-pressed=\"" + (state.tradeMarket === market) + "\">" + market + " <small>" + count + "</small></button>";
  }).join("") + "</div>";
}

function soldRecordRow(row) {
  const nativePnl = tradingPnlNative(row);
  const returnRate = soldReturnRate(row);
  const missingDetails = tradeDetailsMissing(row);
  return "<tr><td>" + escapeHtml(row.sellDate || "—") + "</td><td>" + marketLabel(row.market) + "</td><td><strong>" + escapeHtml(row.name) + "</strong><span class=\"stock-code\">" + escapeHtml(row.code) + "</span></td><td class=\"number-cell\">" + (missingDetails ? "—" : nativeMoney(row.cost, row.currency)) + "</td><td class=\"number-cell\">" + (missingDetails ? "—" : nativeMoney(row.sellPrice, row.currency)) + "</td><td>" + (missingDetails ? "—" : row.qty.toLocaleString("zh-CN")) + "</td><td class=\"number-cell\">" + money(row.purchaseCostCny, 0) + "</td><td class=\"number-cell\">" + money(row.saleProceedsCny, 0) + "</td><td class=\"number-cell " + tone(row.pnlCny) + "\"><strong>" + signed(row.pnlCny, 0) + "</strong><small>" + signedNative(nativePnl, row.currency) + "</small></td><td class=\"number-cell " + tone(returnRate) + "\"><strong>" + pct(returnRate) + "</strong></td></tr>";
}

function soldRecordMobileCard(row) {
  const nativePnl = tradingPnlNative(row), returnRate = soldReturnRate(row);
  const missingDetails = tradeDetailsMissing(row);
  return "<article class=\"sold-record-card\"><header><div>" + marketLabel(row.market) + "<span><strong>" + escapeHtml(row.name) + "</strong><small>" + escapeHtml(row.code) + "</small></span></div><time datetime=\"" + escapeHtml(soldDateValue(row)) + "\">" + escapeHtml(row.sellDate || "日期待补") + "</time></header><dl><div><dt>买入价</dt><dd>" + (missingDetails ? "—" : nativeMoney(row.cost, row.currency)) + "</dd></div><div><dt>卖出价</dt><dd>" + (missingDetails ? "—" : nativeMoney(row.sellPrice, row.currency)) + "</dd></div><div><dt>数量</dt><dd>" + (missingDetails ? "—" : row.qty.toLocaleString("zh-CN")) + "</dd></div><div><dt>卖出金额</dt><dd>" + money(row.saleProceedsCny, 0) + "</dd></div></dl><footer><div><span>已实现盈亏</span><strong class=\"" + tone(row.pnlCny) + "\">" + signed(row.pnlCny, 0) + "</strong><small class=\"" + tone(nativePnl) + "\">" + signedNative(nativePnl, row.currency) + "</small></div><div><span>收益率</span><strong class=\"" + tone(returnRate) + "\">" + pct(returnRate) + "</strong></div></footer></article>";
}

function tradeDetailsMissing(row) {
  return Boolean(row && row.quality === "trade-details-missing");
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

const longChartCache = new Map();
const chartDayMs = 86400000;

function longChartWindow(days) {
  const today = calendarDateInTimeZone("Asia/Shanghai");
  const start = new Date(Date.parse(today) - (days - 1) * chartDayMs).toISOString().slice(0, 10);
  return { start, today };
}

function longChartKey(days) {
  const symbols = Array.from(new Set(activeHoldings().map(row => row.sina))).sort();
  return { symbols, key: [longChartWindow(days).today, days, ...symbols].join("|") };
}

async function loadLongChart(days, retry = false) {
  if (days < 365) return;
  const { symbols, key } = longChartKey(days);
  const previous = longChartCache.get(key);
  if (!symbols.length || (previous && (previous.loading || !retry || !previous.missing))) return;
  const entry = { loading: true, histories: { ...previous?.histories }, missing: 0 };
  longChartCache.set(key, entry);
  if (longChartCache.size > 4) longChartCache.delete(longChartCache.keys().next().value);
  const pending = symbols.filter(symbol => !entry.histories[symbol]);
  async function worker() {
    while (pending.length) {
      const batch = pending.splice(0, 4);
      const url = "/api/history?symbols=" + encodeURIComponent(batch.join(",")) + "&window=" + days;
      const payload = await getJson(url, null, 30000);
      for (const symbol of batch) {
        const bars = payload?.histories?.[symbol];
        if (Array.isArray(bars) && bars.length) entry.histories[symbol] = bars;
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  entry.loading = false;
  entry.missing = symbols.filter(symbol => !entry.histories[symbol]).length;
  if (state.tab === "overview" && state.trendDays === days && longChartKey(days).key === key) render();
}

function longChartNote(points) {
  const days = state.trendDays;
  if (days < 365) return "";
  const { start, today } = longChartWindow(days);
  const entry = longChartCache.get(longChartKey(days).key);
  let status;
  if (!activeHoldings().length) status = "暂无当前持仓";
  else if (!entry || entry.loading) status = "正在读取长期日线…";
  else {
    const bars = points.filter(point => point.date !== "当前");
    status = bars.length ? "可估值区间 " + bars[0].date + " 至 " + bars.at(-1).date : "各持仓缺少共同可估值日期";
    if (entry.missing) status += " · " + entry.missing + " 只持仓仅查询到短期日线或暂无日线，可点击区间重试";
  }
  return '<p class="chart-window-note" role="status">' + start + " 至 " + today + " · " + status + "</p>";
}

function longPortfolioValues(days, rows, currentValue) {
  const { start, today } = longChartWindow(days);
  const entry = longChartCache.get(longChartKey(days).key);
  const current = { date: "当前", value: currentValue };
  if (!entry || entry.loading) return Number.isFinite(currentValue) ? [current] : [];
  if (entry.rows === state.rows && entry.rates === state.rates && entry.shortHistories === state.histories &&
      Object.is(entry.currentValue, currentValue) && entry.values) return entry.values;
  const positions = rows.map(row => ({
    bars: entry.histories[row.sina] || state.histories[row.sina] || [], cursor: -1, weight: row.qty * (state.rates[row.currency] || 1)
  }));
  const dates = [...new Set(positions.flatMap(pos => pos.bars.map(bar => bar.date)))].filter(date => date >= start && date <= today).sort();
  const series = [];
  for (const date of dates) {
    let total = 0;
    for (const pos of positions) {
      while (pos.cursor + 1 < pos.bars.length && pos.bars[pos.cursor + 1].date <= date) pos.cursor++;
      const bar = pos.bars[pos.cursor];
      // Allow nearby market holidays, never carry today's price back before listing.
      if (!bar || !(bar.close > 0) || Date.parse(date) - Date.parse(bar.date) > 10 * chartDayMs) { total = NaN; break; }
      total += bar.close * pos.weight;
    }
    if (Number.isFinite(total)) series.push({ date, value: total });
  }
  if (Number.isFinite(currentValue)) {
    if (series.at(-1)?.date === today) series.pop();
    series.push(current);
  }
  Object.assign(entry, { rows: state.rows, rates: state.rates, shortHistories: state.histories, currentValue, values: series });
  return series;
}

function portfolioValueSeries(days) {
  const rows = state.rows.filter(function (row) { return row.status !== "sold"; });
  if (!rows.length) return [];
  const currentValue = summary().value;
  if (days >= 365) return longPortfolioValues(days, rows, currentValue);
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
      const price = point && Number(point.close) > 0 ? Number(point.close) : NaN;
      value += price * row.qty * (state.rates[row.currency] || 1);
    });
    return { date: date, value: value };
  }).filter(point => Number.isFinite(point.value));
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

function applyPageMeta(announceRoute) {
  const meta = PAGE_META[state.tab] || PAGE_META.overview;
  document.title = meta.title + " · 猪猪存钱罐";
  if (!announceRoute) return;
  const announcer = document.querySelector("#route-announcer");
  if (announcer) {
    announcer.textContent = "";
    window.requestAnimationFrame(function () { announcer.textContent = "已进入" + meta.title + "页面"; });
  }
  window.requestAnimationFrame(function () {
    const heading = document.querySelector("#app .page-shell h1");
    if (!heading) {
      const main = document.querySelector("#main-content");
      if (main) main.focus({ preventScroll: true });
      return;
    }
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  });
}

function syncModalIsolation() {
  document.querySelectorAll("#app > .site-header, #app > .page-shell, #app > .page-footer").forEach(function (element) {
    if (state.holdingEditorOpen) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    } else {
      element.removeAttribute("inert");
      element.removeAttribute("aria-hidden");
    }
  });
}

function normalizeHoldingEditorSemantics() {
  const field = document.querySelector("label.holding-code-field");
  if (field) {
    const wrapper = document.createElement("div");
    wrapper.className = field.className;
    while (field.firstChild) wrapper.appendChild(field.firstChild);
    field.replaceWith(wrapper);
    const title = wrapper.firstElementChild;
    const input = wrapper.querySelector("#holding-code-input");
    if (title && input) {
      title.id = "holding-code-label";
      input.setAttribute("aria-labelledby", "holding-code-label");
    }
  }
  if (state.holdingSave && state.holdingSave.uncertain) {
    document.querySelectorAll("#holding-editor-form input, #holding-editor-form [data-retry-holding-lookup], [data-close-holding-editor]").forEach(function (control) { control.disabled = true; });
  }
}

function radarWatchSurface(button) {
  if (button.closest(".radar-top3-item")) return ".radar-top3-item";
  return button.closest(".radar-watch-aside") ? ".radar-watch-aside" : ".radar-candidate";
}

function findRadarWatchButton(surface, id) {
  return Array.from(document.querySelectorAll(surface + " [data-toggle-watch]")).find(function (button) {
    return button.dataset.toggleWatch === id;
  });
}

function render(announceRoute) {
  // Background price batches can redraw the page while a watch button has focus.
  const activeWatch = !announceRoute && state.tab === "radar" && !state.holdingEditorOpen &&
    document.activeElement?.closest("[data-toggle-watch]");
  const watchSurface = activeWatch && radarWatchSurface(activeWatch);
  const activePreopen = !announceRoute && document.activeElement?.closest("[data-preopen-focus]")?.dataset.preopenFocus;
  document.querySelectorAll("[data-preopen-details]").forEach(el => { state.preopenOpen[el.dataset.preopenDetails] = el.open; });
  const activeArchive = !announceRoute && document.activeElement?.closest("[data-intraday-history]")?.dataset.intradayHistory;
  if (state.tab === "radar") {
    document.querySelectorAll("[data-intraday-history]").forEach(el => { state.intradayHistoryOpen[el.dataset.intradayHistory] = el.open; });
  }
  const activeScope = !announceRoute && state.tab === "radar" && !state.holdingEditorOpen && document.activeElement?.closest("[data-radar-scope]");
  const rawPage = state.tab === "actions" ? actionsPage() : state.tab === "radar" ? radarPage() : state.tab === "trades" ? tradesPage() : overviewPage();
  const page = rawPage;
  document.body.classList.toggle("modal-open", state.holdingEditorOpen);
  document.querySelector("#app").innerHTML = topNav() + page + "<footer class=\"page-footer\">数据来自公开行情接口，可能有延迟。港美持仓市值与今日盈亏按最新汇率折算；历史买卖成本按记录或参考汇率固定。页面中的分析和观察内容仅作研究提示，不构成投资建议。</footer>" + holdingEditorModal() + toastMarkup();
  const main = document.querySelector("#app > main.page-shell");
  if (main) {
    main.id = "main-content";
    main.setAttribute("tabindex", "-1");
  }
  if (activeScope) document.querySelector('[data-radar-scope="' + activeScope.dataset.radarScope + '"]')?.focus({ preventScroll: true });
  if (activePreopen) document.querySelector('[data-preopen-focus="' + CSS.escape(activePreopen) + '"]')?.focus({ preventScroll: true });
  if (activeArchive) document.querySelector('[data-intraday-history="' + activeArchive + '"] summary')?.focus({ preventScroll: true });
  if (activeWatch) findRadarWatchButton(watchSurface, activeWatch.dataset.toggleWatch)?.focus({ preventScroll: true });
  normalizeHoldingEditorSemantics();
  applyPageMeta(Boolean(announceRoute));
  syncModalIsolation();
  syncBrandVisuals();
  if (state.holdingEditorOpen) window.requestAnimationFrame(syncHoldingFormUi);
  scheduleJarDeposits();
  requestAnimationFrame(drawCharts);
  if (state.tab === "radar" && !dailyRadarScope()) requestAnimationFrame(scheduleVisibleRadarHistoryLoad);
  if (state.tab === "overview" && state.trendDays >= 365) void loadLongChart(state.trendDays);
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

function longChartFraction(date, window, days) {
  return (Date.parse(date === "当前" ? window.today : date) - Date.parse(window.start)) / ((days - 1) * chartDayMs);
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
    ctx.fillText(days >= 365 ? "暂无可绘制的估值" : "暂无持仓估值", width / 2, height / 2);
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
  const longWindow = days >= 365 ? longChartWindow(days) : null;
  const xAt = index => left + chartWidth * (longWindow
    ? longChartFraction(points[index].date, longWindow, days)
    : index / Math.max(1, series.length - 1));
  if (longWindow) {
    const ticks = Math.max(3, Math.min(8, Math.floor(chartWidth / 74)));
    for (let tick = 0; tick < ticks; tick++) {
      const fraction = tick / (ticks - 1);
      const date = new Date(Date.parse(longWindow.start) + Math.round(fraction * (days - 1)) * chartDayMs).toISOString().slice(0, 7);
      ctx.textAlign = tick === 0 ? "left" : tick === ticks - 1 ? "right" : "center";
      ctx.fillText(date, left + chartWidth * fraction, height - 8);
    }
  } else {
    const labelIndexes = chartLabelIndexes(points.length, days, width);
    labelIndexes.forEach(function (index, labelIndex) {
      ctx.textAlign = labelIndex === 0 ? "left" : labelIndex === labelIndexes.length - 1 ? "right" : "center";
      ctx.fillText(formatChartDate(points[index].date, width < 290), xAt(index), height - 8);
    });
  }
  const yAt = function (value) { return top + (max - value) / (max - min) * chartHeight; };
  ctx.beginPath();
  series.forEach(function (value, index) { index ? ctx.lineTo(xAt(index), yAt(value)) : ctx.moveTo(xAt(index), yAt(value)); });
  ctx.lineTo(xAt(series.length - 1), zeroY); ctx.lineTo(xAt(0), zeroY); ctx.closePath();
  const fill = ctx.createLinearGradient(0, top, 0, top + chartHeight);
  const zeroStop = Math.max(0, Math.min(1, (zeroY - top) / chartHeight));
  fill.addColorStop(0, "rgba(255,75,75,.15)");
  fill.addColorStop(Math.max(0, zeroStop - 0.002), "rgba(255,75,75,.055)");
  fill.addColorStop(Math.min(1, zeroStop + 0.002), "rgba(6,155,98,.055)");
  fill.addColorStop(1, "rgba(6,155,98,.16)");
  ctx.fillStyle = fill;
  if (!longWindow) ctx.fill();
  ctx.beginPath();
  series.forEach(function (value, index) {
    const largeGap = longWindow && index > 0 && Date.parse(points[index].date === "当前" ? longWindow.today : points[index].date) - Date.parse(points[index - 1].date) > 10 * chartDayMs;
    if (!index || largeGap) ctx.moveTo(xAt(index), yAt(value));
    else ctx.lineTo(xAt(index), yAt(value));
  });
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
  if (longWindow) {
    const lastIndex = series.length - 1;
    ctx.fillStyle = series[lastIndex] >= 0 ? "#ff4b4b" : "#069b62";
    ctx.beginPath(); ctx.arc(xAt(lastIndex), yAt(series[lastIndex]), 3, 0, Math.PI * 2); ctx.fill();
  }
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
      const points = portfolioSeries(state.trendDays);
      const relative = Math.max(0, Math.min(rect.width - left - right, event.clientX - rect.left - left));
      const fraction = relative / Math.max(1, rect.width - left - right);
      let nearest = Math.round(fraction * Math.max(0, points.length - 1));
      if (state.trendDays >= 365) {
        const window = longChartWindow(state.trendDays);
        let distance = Infinity;
        nearest = -1;
        points.forEach((point, index) => {
          const delta = Math.abs(longChartFraction(point.date, window, state.trendDays) - fraction);
          if (delta < distance && delta * (rect.width - left - right) <= 12) { distance = delta; nearest = index; }
        });
      }
      canvas.dataset.hoverIndex = String(nearest);
      drawChartCanvas(canvas);
    };
    canvas.addEventListener("pointermove", updatePointerHover);
    canvas.addEventListener("pointerdown", updatePointerHover);
    canvas.addEventListener("focus", function () {
      const index = Math.max(0, portfolioSeries(state.trendDays).length - 1);
      canvas.dataset.hoverIndex = String(index);
      drawChartCanvas(canvas);
      announcePortfolioPoint(index);
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
      announcePortfolioPoint(next);
    });
    canvas.addEventListener("pointerleave", function () { delete canvas.dataset.hoverIndex; drawChartCanvas(canvas); });
    canvas.addEventListener("blur", function () { delete canvas.dataset.hoverIndex; drawChartCanvas(canvas); });
  });
}

function announcePortfolioPoint(index) {
  const point = portfolioSeries(state.trendDays)[index];
  const live = document.querySelector("#portfolio-chart-live");
  if (point && live) live.textContent = point.date + "，累计盈亏 " + signed(point.value, 0) + "，第 " + (index + 1) + " 个，共 " + portfolioSeries(state.trendDays).length + " 个数据点。";
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
    const priorAdjustmentCny = Number(current.adjustmentCny);
    const soldAdjustmentCny = Number.isFinite(priorAdjustmentCny) ? priorAdjustmentCny * soldQty / originalQty : NaN;
    const priorBuyFeeUsd = Number.isFinite(current.buyFeeUsd) ? current.buyFeeUsd : 0;
    const soldBuyFeeUsd = priorBuyFeeUsd * soldQty / originalQty;
    const soldRecord = Object.assign({}, current, {
      qty: soldQty,
      status: "sold",
      purchaseCostCny: soldPurchaseCost,
      adjustmentCny: soldAdjustmentCny,
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
      if (Number.isFinite(priorAdjustmentCny)) current.adjustmentCny = priorAdjustmentCny - soldAdjustmentCny;
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
  const payload = kind === "trades" ? state.trades : readableHoldingsDocument(state.holdings, state.holdingsDocument);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = kind + ".json"; link.click();
  URL.revokeObjectURL(url);
}

function refreshRadarIfStale() {
  if (document.visibilityState === "hidden" || state.tab !== "radar") return;
  if (dailyRadarScope()) return loadDailyRadar();
  if (state.tab !== "radar" || state.radarStatus === "loading") return;
  const allCurrent = RADAR_MARKETS.every(function (market) {
    const snapshot = state.radarMarkets[market];
    return isRadarSnapshot(snapshot, market) && radarEffectiveLoadState(snapshot) === "fresh"
      && radarEffectiveLoadState(snapshot.segment) === "fresh";
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
      render(true);
      if (tab === "radar") loadRadar(false);
    }
  });
  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-open-cost-policy]")) { openCostPolicyEditor(); return; }
    if (event.target.closest("[data-close-cost-policy]")) {
      if (state.costPolicyEditor?.status === "saving") return;
      state.costPolicyEditor = null;
      render();
      document.querySelector("[data-open-cost-policy]")?.focus();
      return;
    }
    const openHolding = event.target.closest("[data-open-holding-editor]");
    if (openHolding) { openHoldingEditor(openHolding.dataset.openHoldingEditor, openHolding); return; }
    const closeHolding = event.target.closest("[data-close-holding-editor]");
    if (closeHolding) { closeHoldingEditor(); return; }
    const retryLookup = event.target.closest("[data-retry-holding-lookup]");
    if (retryLookup) { scheduleHoldingLookup(true); return; }
    const tab = event.target.closest("[data-tab]");
    if (tab) { location.hash = tab.dataset.tab; return; }
    const reviewButton = event.target.closest("[data-preopen-market]");
    if (reviewButton && RADAR_MARKETS.includes(reviewButton.dataset.preopenMarket)) {
      state.preopenReviewMarket = reviewButton.dataset.preopenMarket;
      render();
      return;
    }
    const scopeButton = event.target.closest("[data-radar-scope]");
    if (scopeButton) {
      const scope = scopeButton.dataset.radarScope;
      if (!["preopen", "intraday", "market", "growth"].includes(scope) || scope === state.radarScope) return;
      state.radarScope = scope;
      const url = new URL(location.href);
      url.searchParams.set("radar", scope);
      window.history.replaceState(null, "", url);
      state.radarPage = 1;
      state.watchMarket = "全部";
      state.radarQuery = "";
      state.radarBand = scope === "growth" ? "all" : "priority";
      state.radarSort = "score";
      state.expandedRadarId = "";
      render();
      document.querySelector('[data-radar-scope="' + scope + '"]')?.focus({ preventScroll: true });
      if (dailyRadarScope(scope) || state.radarStatus === "idle") loadRadar(false);
      else refreshRadarIfStale();
      return;
    }
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
      state.radarBand = state.radarScope === "growth" ? "all" : "priority";
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
          heading.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
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
      const watchSurface = radarWatchSurface(toggleWatch);
      const existing = state.saved.findIndex(function (item) { return item.id === id; });
      const previous = state.saved.slice();
      if (existing >= 0) {
        state.saved.splice(existing, 1);
      } else {
        const item = activeRadarRows().find(function (candidate) { return candidate.id === id; });
        if (item) state.saved = normalizeWatchlist(state.saved.concat([Object.assign({}, item, { addedAt: new Date().toISOString() })]));
      }
      try {
        writeStorage(WATCH_KEY, state.saved);
        showToast(existing >= 0 ? "已移出观察清单" : "已加入观察清单", "success");
      } catch {
        state.saved = previous;
        showToast("浏览器无法保存观察清单", "error");
      }
      // Interaction can land on the document body when removing the focused
      // sidebar entry. Keep an intentional switch to any other control intact.
      if (document.activeElement === document.body) {
        const next = findRadarWatchButton(watchSurface, id) || findRadarWatchButton(".radar-top3-item", id) ||
          findRadarWatchButton(".radar-candidate", id) || document.querySelector("#radar-watch-title");
        if (next) next.focus({ preventScroll: true });
      }
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
    if (trendDays) {
      state.trendDays = Number(trendDays.dataset.trendDays) || 30;
      if (state.trendDays >= 365) void loadLongChart(state.trendDays, true);
      render();
      return;
    }
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
    if (show) { const panel = document.querySelector("#trade-form-panel"); if (panel) { panel.hidden = false; panel.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" }); } return; }
    const exportButton = event.target.closest("[data-export]");
    if (exportButton) exportJson(exportButton.dataset.export);
  });
  document.addEventListener("submit", function (event) {
    if (event.target && event.target.id === "cost-policy-form") { event.preventDefault(); saveCostPolicyEditor(); return; }
    if (event.target && event.target.id === "holding-editor-form") { event.preventDefault(); saveHoldingEditor(); return; }
    if (event.target && event.target.id === "trade-form") { event.preventDefault(); saveTrade(event.target); }
  });
  document.addEventListener("input", function (event) {
    if (event.target.closest("#cost-policy-form") && state.costPolicyEditor && ["buy", "sell"].includes(event.target.name)) {
      state.costPolicyEditor[event.target.name] = event.target.value;
      document.querySelector("[data-policy-preview]").textContent = policyPreview(state.costPolicyEditor);
      return;
    }
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
    state.holdingPendingOperation = null;
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
      state.radarSort = ["score", "growth10d", "trend", "liquidity", "risk", "change"].includes(radarSort.value) ? radarSort.value : "score";
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
    state.holdingPendingOperation = null;
    setHoldingFormError("");
    if (field === "operationType") {
      render();
      window.requestAnimationFrame(function () {
        const control = document.querySelector("#holding-editor-form [name=\"operationType\"][value=\"" + state.holdingDraft.operationType + "\"]");
        if (control) control.focus();
      });
      return;
    }
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
  if (window.matchMedia) {
    motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleMotionPreference = function () {
      if (motionPreference.matches) {
        window.clearInterval(brandAnimationTimer);
        window.clearTimeout(jarDepositTimer);
        brandAnimationTimer = 0;
        jarDepositTimer = 0;
        syncBrandVisuals();
      } else {
        startBrandAnimations();
        scheduleJarDeposits();
      }
    };
    if (typeof motionPreference.addEventListener === "function") motionPreference.addEventListener("change", handleMotionPreference);
    else if (typeof motionPreference.addListener === "function") motionPreference.addListener(handleMotionPreference);
  }
  window.setInterval(() => {
    if (state.tab === "radar" && dailyRadarScope() && document.visibilityState === "visible") loadDailyRadar();
  }, 60000);
  window.setInterval(() => {
    if (!dailyRadarScope()) refreshRadarIfStale();
  }, 5 * 60 * 1000);
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
  const responseUsd = Number(result[1].rates && result[1].rates.USD_CNY);
  const responseHkd = Number(result[1].rates && result[1].rates.HKD_CNY);
  const responseFallback = result[1].fallback === true;
  const sourceFx = workbookFx(state.holdingsDocument);
  const useSourceFx = responseFallback && sourceFx;
  state.rates = useSourceFx
    ? { CNY: 1, USD: sourceFx.USD, HKD: sourceFx.HKD }
    : { CNY: 1, USD: Number.isFinite(responseUsd) && responseUsd > 0 ? responseUsd : state.rates.USD || 7.22, HKD: Number.isFinite(responseHkd) && responseHkd > 0 ? responseHkd : state.rates.HKD || 0.92 };
  const hasLiveRates = !responseFallback && Number.isFinite(responseUsd) && responseUsd > 0 && Number.isFinite(responseHkd) && responseHkd > 0;
  state.fxMeta = {
    asOf: useSourceFx ? sourceFx.asOf || null : result[1].asOf || null,
    fetchedAt: useSourceFx ? null : result[1].fetchedAt || (hasLiveRates ? new Date().toISOString() : state.fxMeta.fetchedAt || null),
    source: useSourceFx ? "Excel 锁定汇率" : result[1].source || (hasLiveRates ? "Frankfurter" : state.fxMeta.source || "固定参考汇率"),
    fallback: useSourceFx ? true : result[1].fallback !== undefined ? Boolean(result[1].fallback) : !hasLiveRates
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
  state.holdingsDocument = Array.isArray(holdingsDocument) ? readableHoldingsDocument(holdingsDocument) : holdingsDocument;
  applyWorkbookFxFallback();
  state.baseHoldings = holdingsFromDocument(holdingsDocument);
  state.holdings = state.baseHoldings.slice();
  state.trades = (Array.isArray(tradesDocument) ? tradesDocument : []).map(normalizeTrade);
}

function startupStateFingerprint() {
  return JSON.stringify([state.holdings, state.trades]);
}

async function start() {
  if (!VALID_TABS.includes(location.hash.slice(1))) location.hash = linkedRadarScope ? "#radar" : "#overview";
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
  if (syncPayload && syncPayload.ok === true) {
    state.holdingsFileSha = String(syncPayload.fileSha || "");
    state.holdingsRepository = syncPayload.repository || null;
  }
  const authoritative = selectStartupHoldingsDocument(syncPayload, staticResult[0], linked);
  const startupStateUnchanged = interactiveSnapshot === startupStateFingerprint();
  if (startupStateUnchanged && (authoritative.source === "github" || (authoritative.source === "static" && currentSource === "local"))) {
    const previousSymbols = activeHoldings().map(function (item) { return item.sina; }).sort().join(",");
    adoptStartupDocuments(authoritative.document, Array.isArray(localTrades) ? localTrades : staticResult[1]);
    rebuildRows();
    try { writeStorage(HOLDING_KEY, state.holdingsDocument); } catch { /* Cache failure must not replace the authoritative source. */ }
    render();
    const nextSymbols = activeHoldings().map(function (item) { return item.sina; }).sort().join(",");
    if (previousSymbols !== nextSymbols) {
      Promise.resolve(marketRefresh).finally(function () { refreshData(); });
    }
  }
}

start().catch(function (error) {
  document.querySelector("#app").innerHTML = "<main id=\"main-content\" class=\"loading-screen\" tabindex=\"-1\"><div class=\"error\" role=\"alert\">页面初始化失败：" + escapeHtml(error.message) + "。请刷新重试。</div></main>";
});
