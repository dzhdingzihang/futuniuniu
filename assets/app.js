const MARKETS = ["全部", "A股", "港股", "美股"];
const MARKET_ORDER = ["港股", "A股", "美股"];
const TRADE_KEY = "piggy-trades-v1";
const HOLDING_KEY = "piggy-linked-holdings-v1";
const WATCH_KEY = "piggy-watchlist-v1";
const MARKET_CACHE_KEY = "piggy-market-cache-v1";
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
let toastTimer = 0;

const METRIC_HELP = {
  netInvested: "累计买入金额减去累计卖出金额，按固定参考汇率折算为人民币。",
  marketValue: "当前未卖出持仓按最新报价和实时汇率折算的市值。",
  totalPnl: "当前持仓市值减去净投入。新表单录入的买入、卖出固定手续费已计入；旧记录不追溯补扣。",
  todayPnl: "当前未卖出持仓的今日价格变化乘以数量，再按实时汇率折算；不包含当天未录入的已实现盈亏。",
  holdingCount: "当前状态为持有中的证券数量，不包含已卖出记录。",
  chart: "按当前净投入与现有持仓的历史市值估算，蓝线为盈亏平衡线。",
  actionPrice: "执行价位由当前价、成本价、持仓盈亏和日内波动自动推导；用于明确下一步的风控或分批操作参考。"
};

const candidates = [
  { market: "美股", code: "NVDA", name: "英伟达", currency: "USD", sina: "gb_nvda", theme: "AI GPU", heat: 94, target: "等待回撤", reason: "AI 算力资本开支仍是全球科技股定价主线，关注业绩兑现与估值消化。" },
  { market: "美股", code: "AVGO", name: "博通", currency: "USD", sina: "gb_avgo", theme: "AI 网络 / ASIC", heat: 89, target: "中", reason: "定制芯片、数据中心网络与软件业务共同提供增长线索。" },
  { market: "美股", code: "MU", name: "美光科技", currency: "USD", sina: "gb_mu", theme: "存储芯片", heat: 88, target: "中", reason: "AI 服务器对高带宽存储的需求持续，留意周期波动。" },
  { market: "港股", code: "03690", name: "美团-W", currency: "HKD", sina: "hk03690", theme: "本地生活", heat: 82, target: "等待催化", reason: "竞争格局和利润率改善是近期判断的关键变量。" },
  { market: "港股", code: "09868", name: "小鹏汽车-W", currency: "HKD", sina: "hk09868", theme: "智能汽车", heat: 80, target: "中", reason: "交付数据与新品节奏是短期催化，需控制行业波动风险。" },
  { market: "A股", code: "300308", name: "中际旭创", currency: "CNY", sina: "sz300308", theme: "CPO / 光模块", heat: 93, target: "中", reason: "光模块与高速连接继续受算力建设驱动，关注景气持续性。" },
  { market: "A股", code: "002938", name: "鹏鼎控股", currency: "CNY", sina: "sz002938", theme: "PCB", heat: 90, target: "中", reason: "AI 硬件产业链热度延续，适合与现有主题暴露对照后再研究。" },
  { market: "A股", code: "688981", name: "中芯国际", currency: "CNY", sina: "sh688981", theme: "国产半导体", heat: 86, target: "等待回撤", reason: "国产算力链预期向上，但需留意估值和行业节奏。" }
];

const state = {
  tab: location.hash.slice(1) || "overview",
  market: "全部",
  tradeMarket: "全部",
  watchMarket: "全部",
  trendDays: 30,
  rankMode: "profit",
  actionSort: "today",
  actionSortDirection: "desc",
  baseHoldings: [],
  holdings: [],
  trades: [],
  rows: [],
  quotes: new Map(),
  histories: {},
  rates: { CNY: 1, HKD: 0.92, USD: 7.22 },
  saved: readStorage(WATCH_KEY, []),
  updatedAt: "",
  isRefreshing: false,
  isHistoryLoading: false,
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function money(value, digits) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: digits ?? 0, maximumFractionDigits: digits ?? 0 }).format(amount);
}

function nativeMoney(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "--";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency || "CNY", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function signed(value, digits) {
  if (!Number.isFinite(Number(value))) return "--";
  return (value > 0 ? "+" : "") + money(value, digits);
}

function signedNative(value, currency) {
  if (!Number.isFinite(Number(value))) return "--";
  return (value > 0 ? "+" : "") + nativeMoney(value, currency);
}

function pct(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return (value > 0 ? "+" : "") + Number(value).toFixed(2) + "%";
}

function tone(value) {
  if (!Number.isFinite(Number(value)) || Math.abs(value) < 0.005) return "neutral";
  return value > 0 ? "positive" : "negative";
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
  return document.lots.flatMap(function (lot) {
    if (!lot || typeof lot !== "object") return [];
    const market = normalizedHoldingMarket(lot.market);
    const code = String(lot.code || "").trim().toUpperCase();
    const buy = lot.buy && typeof lot.buy === "object" ? lot.buy : {};
    const sell = lot.sell && typeof lot.sell === "object" ? lot.sell : null;
    const fees = lot.fees && typeof lot.fees === "object" ? lot.fees : {};
    const buyQty = Number(buy.qty);
    const sellQty = sell ? Number(sell.qty ?? buy.qty) : 0;
    const buyFee = optionalNumber(fees.buy);
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
      sellFeeUsd: optionalNumber(fees.sell)
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

function readMarketCache() {
  const cache = readStorage(MARKET_CACHE_KEY, null);
  if (!cache || typeof cache !== "object") return false;
  if (cache.quotes && typeof cache.quotes === "object") state.quotes = new Map(Object.entries(cache.quotes));
  if (cache.histories && typeof cache.histories === "object") state.histories = cache.histories;
  if (cache.rates && typeof cache.rates === "object") state.rates = Object.assign({}, state.rates, cache.rates);
  if (cache.updatedAt) state.updatedAt = String(cache.updatedAt);
  return true;
}

function saveMarketCache() {
  writeStorage(MARKET_CACHE_KEY, {
    quotes: Object.fromEntries(state.quotes), histories: state.histories,
    rates: state.rates, updatedAt: state.updatedAt
  });
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
  state.rows = state.holdings.filter(isValidHolding).map(function (item) {
    const quote = state.quotes.get(item.sina);
    const history = state.histories[item.sina] || [];
    const live = quote && Number(quote.price) > 0 ? Number(quote.price) : (last(history) ? Number(last(history).close) : item.cost);
    const price = item.status === "sold" ? item.sellPrice : live;
    const fx = state.rates[item.currency] || 1;
    const costValue = item.cost * item.qty;
    const exitValue = price * item.qty;
    const valueCny = item.status === "sold" ? 0 : exitValue * fx;
    const purchaseCostCny = fixedPurchaseCost(item);
    const saleProceedsCny = fixedSaleProceeds(item);
    const pnlCny = item.status === "sold" ? saleProceedsCny - purchaseCostCny : valueCny - purchaseCostCny;
    const todayPnlCny = item.status === "sold" ? 0 : (Number(quote && quote.change) || 0) * item.qty * fx;
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
      changePct: Number.isFinite(changePct) ? changePct : 0,
      holdingPct: 0
    });
    row.analysis = analysisFor(row);
    return row;
  });
  const totalValue = sum(state.rows.filter(function (row) { return row.status !== "sold"; }), "valueCny");
  state.rows.forEach(function (row) { row.holdingPct = totalValue ? row.valueCny / totalValue * 100 : 0; });
}

function analysisFor(row) {
  const stopPrice = Math.min(row.price * 0.96, row.cost * 0.90);
  const addPrice = row.price * 0.98;
  const takeProfitPrice = row.price * 0.93;
  const trend = row.changePct >= 0
    ? { label: "预判上涨", cls: "up", text: "未来 3 个工作日偏强" }
    : { label: "预判下跌", cls: "down", text: "未来 3 个工作日偏弱" };
  if (row.status === "sold") return { action: "已完成", cls: "good", text: "已卖出记录已进入已实现盈亏。", priority: 5, addPrice: addPrice, stopPrice: stopPrice, trend: trend };
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
  const soldRows = state.rows.filter(function (row) { return row.status === "sold"; });
  const grossBuys = sum(state.rows, "purchaseCostCny");
  const saleProceeds = sum(soldRows, "saleProceedsCny");
  const netInvested = grossBuys - saleProceeds;
  const value = sum(openRows, "valueCny");
  const openPnl = sum(openRows, "pnlCny");
  const soldPnl = sum(soldRows, "pnlCny");
  const totalPnl = value - netInvested;
  const today = sum(openRows, "todayPnlCny");
  return {
    openRows: openRows, soldRows: soldRows, grossBuys: grossBuys, saleProceeds: saleProceeds, netInvested: netInvested, value: value, openPnl: openPnl, soldPnl: soldPnl,
    totalPnl: totalPnl, totalRate: netInvested ? totalPnl / netInvested * 100 : 0, today: today, todayRate: value ? today / value * 100 : 0
  };
}

function byMarket(market, items) {
  return (items || state.rows).filter(function (row) { return row.market === market; });
}

function marketSummary(market) {
  const all = byMarket(market);
  const open = all.filter(function (row) { return row.status !== "sold"; });
  const currency = currencyForMarket(market);
  const fx = state.rates[currency] || 1;
  const grossBuys = sum(all, "purchaseCostCny");
  const saleProceeds = sum(all, "saleProceedsCny");
  const netInvested = grossBuys - saleProceeds;
  const valueCny = sum(open, "valueCny");
  const pnlCny = valueCny - netInvested;
  const todayCny = sum(open, "todayPnlCny");
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
  const valueNative = valueCny / fx;
  return {
    market: market,
    open: open,
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
    todayNative: todayCny / fx,
    pnlNative: valueNative - netInvestedNative,
    count: open.length
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
    trades: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.25 4.25h9.5v15.5h-9.5zM8.25 8h3.5M8.25 11.5h3.5M8.25 15h2.25M14.75 8.5h4M17.25 6l2.5 2.5-2.5 2.5"/></svg>',
    review: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.25 4.25h9.5v15.5h-9.5zM9.25 4.25V2.75h5.5v1.5M9.5 9.25l1.25 1.25 2.5-2.5M9.5 14.25l1.25 1.25 2.5-2.5M15.5 9.25h1.25M15.5 14.25h1.25"/></svg>'
  };
  return '<span class="nav-icon">' + icons[name] + '</span>';
}

function headerActionIcon(name) {
  if (name === "edit") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h4l10.2-10.2a2.15 2.15 0 0 0-3-3L5.5 16.5l-1 3Z"/><path d="m14.7 7.3 3 3M12 19.5h7.5"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 8.1A8 8 0 1 0 20 14"/><path d="M19.5 3.8v4.8h-4.8"/></svg>';
}

function formatUpdatedAt(date) {
  const value = date || new Date();
  const pad = function (number) { return String(number).padStart(2, "0"); };
  return value.getFullYear() + "年" + pad(value.getMonth() + 1) + "月" + pad(value.getDate()) + "日 " + pad(value.getHours()) + ":" + pad(value.getMinutes());
}

function currentPetMood() {
  if (state.isRefreshing) return "working";
  if (state.tab === "review") return "reviewing";
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
  const items = [["overview", "总览"], ["actions", "持仓行动"], ["radar", "机会雷达"], ["trades", "卖出记录"], ["review", "复盘"]];
  const petDefinition = PET_STATES[brandVisual.petState] || PET_STATES.idle;
  const storedCoins = Array.from({ length: BRAND_COIN_MAX }, function (_, index) {
    return "<i class=\"" + (index < brandVisual.coinCount ? "is-stored" : "") + "\" data-stored-coin=\"" + index + "\"></i>";
  }).join("");
  const updateStatus = state.isRefreshing
    ? "<span class=\"market-refresh-status\"><img src=\"assets/pig-logo.png\" alt=\"\"/>小猪正在核算行情</span>"
    : "<span class=\"updated\">更新于 " + escapeHtml(state.updatedAt || "待更新") + "</span>";
  return "<header class=\"site-header\"><a class=\"brand\" href=\"#overview\" aria-label=\"猪猪存钱罐 · 小猪状态：" + escapeHtml(petDefinition.label) + " · 返回总览\"><span class=\"brand-scene\" aria-hidden=\"true\"><span class=\"brand-pig-stage\" data-pet-state=\"" + escapeHtml(brandVisual.petState) + "\" data-pet-label=\"" + escapeHtml(petDefinition.label) + "\"><span class=\"brand-pig-sprite\"></span></span><span class=\"brand-wordmark\"><strong data-text=\"猪猪存钱罐\">猪猪存钱罐</strong></span><span class=\"brand-jar-stage\"><span class=\"jar-coin-bank\">" + storedCoins + "</span><span class=\"brand-coins\"><i></i><i></i><i></i><i></i></span><img class=\"brand-jar\" src=\"assets/glass-savings-jar-v1.png\" alt=\"\"/></span></span></a><nav class=\"global-nav\" aria-label=\"主导航\">" +
    items.map(function (item) { return "<button class=\"nav-link " + (state.tab === item[0] ? "active" : "") + "\" " + (state.tab === item[0] ? "aria-current=\"page\" " : "") + "type=\"button\" data-tab=\"" + item[0] + "\">" + navIcon(item[0]) + "<span class=\"nav-label\">" + item[1] + "</span></button>"; }).join("") +
    "</nav><div class=\"header-tools\">" + updateStatus + "<div class=\"header-action-group\"><button class=\"header-action-button edit\" type=\"button\" data-open-holding-editor=\"holding\">" + headerActionIcon("edit") + "<span>修改持仓</span></button><button class=\"header-action-button refresh\" type=\"button\" data-refresh=\"1\"" + (state.isRefreshing ? " disabled aria-busy=\"true\"" : "") + ">" + headerActionIcon("refresh") + "<span>刷新</span></button></div></div></header>";
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
    applyResolvedSecurity({ market: local.market, code: local.code, name: local.name, sina: local.sina, currency: local.currency, price: quote && Number(quote.price) > 0 ? Number(quote.price) : null });
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
  toastTimer = window.setTimeout(function () { state.toast = null; render(); }, 3200);
}

function toastMarkup() {
  if (!state.toast) return "";
  return "<div class=\"site-toast " + escapeHtml(state.toast.kind) + "\" role=\"status\"><span>" + (state.toast.kind === "success" ? "✓" : "!") + "</span>" + escapeHtml(state.toast.message) + "</div>";
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
    state.updatedAt = formatUpdatedAt(new Date());
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
  return "<main class=\"page-shell\"><h1 class=\"page-title\">资产盈亏总览 · 全部市场</h1><section class=\"overview-top\"><div class=\"card asset-summary\">" +
    metric("净投入（人民币）", money(data.netInvested, 0), "累计买入 − 累计卖出", "neutral", METRIC_HELP.netInvested) +
    metric("持仓市值（人民币）", money(data.value, 0), "仅含当前持仓", "neutral", METRIC_HELP.marketValue) +
    metric("累计盈亏", signed(data.totalPnl, 0), pct(data.totalRate), tone(data.totalPnl), METRIC_HELP.totalPnl) +
    metric("今日盈亏", signed(data.today, 0), pct(data.todayRate), tone(data.today), METRIC_HELP.todayPnl) +
    "</div></section>" +
    "<section class=\"overview-main\"><article class=\"card chart-card\"><div class=\"chart-heading\"><div><h2>" + state.trendDays + "日组合累计盈亏（人民币）" + infoTip(METRIC_HELP.chart) + "</h2><div class=\"chart-legend\"><span class=\"legend-item\"><i class=\"legend-dot\"></i>累计盈亏 <b class=\"" + tone(data.totalPnl) + "\">" + signed(data.totalPnl, 0) + "</b></span><span class=\"legend-item\"><i class=\"legend-dot blue\"></i>盈亏平衡线（¥0）</span></div></div><div class=\"segmented\"><button class=\"" + (state.trendDays === 7 ? "active" : "") + "\" type=\"button\" data-trend-days=\"7\">7天</button><button class=\"" + (state.trendDays === 30 ? "active" : "") + "\" type=\"button\" data-trend-days=\"30\">30天</button></div></div><div class=\"canvas-wrap\"><canvas class=\"line-chart\" data-chart=\"portfolio\"></canvas></div></article>" +
    "<aside class=\"side-stack\"><section class=\"card side-card\"><h3>市场贡献（累计盈亏）</h3>" + contributionRows() + "</section>" + rankCard() + "</aside></section>" +
    "<section class=\"card market-overview\"><h2 class=\"section-title\" style=\"grid-column:1/-1;margin-bottom:18px\">市场概览</h2>" + MARKET_ORDER.map(marketBlock).join("") + "</section></main>";
}

function infoTip(text) {
  return "<span class=\"info-tip\" tabindex=\"0\" aria-label=\"查看指标说明\"><span class=\"info-icon\" aria-hidden=\"true\">i</span><span class=\"info-popover\" role=\"tooltip\">" + escapeHtml(text) + "</span></span>";
}

function metric(label, value, note, valueTone, helpText) {
  const noteClass = valueTone === "positive" ? "positive-bg" : valueTone === "negative" ? "negative-bg" : "neutral-bg";
  return "<div><span class=\"metric-label\">" + label + (helpText ? infoTip(helpText) : "") + "</span><strong class=\"metric-value " + valueTone + "\">" + value + "</strong><span class=\"metric-note " + noteClass + "\">" + note + "</span></div>";
}

function contributionRows() {
  const allPnl = summary().totalPnl || 1;
  return MARKET_ORDER.map(function (market) {
    const data = marketSummary(market);
    const dot = market === "A股" ? " a" : market === "美股" ? " us" : "";
    return "<div class=\"contribution-row\"><span><i class=\"market-dot" + dot + "\"></i>" + market + "</span><b class=\"" + tone(data.pnl) + "\">" + signed(data.pnl, 0) + "</b><span>" + (data.pnl / allPnl * 100).toFixed(1) + "%</span></div>";
  }).join("") + "<div class=\"contribution-row\"><b>合计</b><b class=\"" + tone(summary().totalPnl) + "\">" + signed(summary().totalPnl, 0) + "</b><span>100%</span></div>";
}

function marketBlock(market) {
  const data = marketSummary(market);
  return "<article class=\"market-block\"><div class=\"market-head\">" + marketLabel(market) + "<span>" + market + "</span></div><div class=\"market-kpis market-detail-grid\">" +
    marketMetric("净投入", dualMoney(data.netInvestedNative, data.currency, data.netInvested), METRIC_HELP.netInvested) +
    marketMetric("持仓市值", dualMoney(data.valueNative, data.currency, data.value), METRIC_HELP.marketValue) +
    marketMetric("累计盈亏", dualMoney(data.pnlNative, data.currency, data.pnl, tone(data.pnl)), METRIC_HELP.totalPnl) +
    marketMetric("今日盈亏", dualMoney(data.todayNative, data.currency, data.today, tone(data.today)), METRIC_HELP.todayPnl) +
    marketMetric("持仓数量", "<b>" + data.count + " 个</b><small>持有中</small>", METRIC_HELP.holdingCount) + "</div></article>";
}

function marketMetric(label, value, helpText) {
  return "<div><span>" + label + infoTip(helpText) + "</span>" + value + "</div>";
}

function rankCard() {
  const rows = state.rows.slice().sort(function (a, b) { return state.rankMode === "profit" ? b.pnlCny - a.pnlCny : a.pnlCny - b.pnlCny; }).slice(0, 5);
  return "<section class=\"card side-card leaderboard-card\"><div class=\"leaderboard-heading\"><h3>盈亏排行榜</h3><div class=\"segmented leaderboard-tabs\"><button class=\"" + (state.rankMode === "profit" ? "active" : "") + "\" type=\"button\" data-rank-mode=\"profit\">盈利 Top 5</button><button class=\"" + (state.rankMode === "loss" ? "active" : "") + "\" type=\"button\" data-rank-mode=\"loss\">亏损 Top 5</button></div></div>" +
    (rows.length ? "<div class=\"rank-list\">" + rows.map(function (row, index) {
      return "<div class=\"rank-row\"><b class=\"rank-number\">" + (index + 1) + "</b><div>" + marketLabel(row.market) + "<strong>" + escapeHtml(row.name) + "</strong><small>" + escapeHtml(row.code) + marketSuffix(row) + "</small></div><b class=\"risk-number " + tone(row.pnlCny) + "\">" + signed(row.pnlCny, 0) + "<small>" + pct(row.pnlRate) + "</small></b></div>";
    }).join("") + "</div>" : "<p class=\"section-helper\">暂无可用盈亏数据。</p>") + "</section>";
}

function actionsPage() {
  const filtered = filteredRows("holding");
  const priorityRows = filtered.slice().sort(function (a, b) {
    return a.analysis.priority - b.analysis.priority || b.holdingPct - a.holdingPct || a.pnlCny - b.pnlCny;
  }).filter(function (row) { return row.analysis.action !== "持有"; }).slice(0, 4);
  const rows = sortActionRows(filtered);
  return "<main class=\"page-shell action-page\"><h1 class=\"page-title\">持仓行动</h1><section class=\"card action-market-overview\">" + MARKET_ORDER.map(actionMarketBlock).join("") + "</section>" +
    "<div class=\"filter-bar action-filter-bar\">" + marketTabs(state.market, "market") + "<span class=\"section-helper\">人民币为主读数；港股、美股同时保留原币种金额。</span></div>" +
    "<section class=\"card priority-card\"><div class=\"table-heading\"><div><h2>优先处理</h2><p>只展示需要执行补仓、止损或止盈的持仓；每项均给出明确价位。</p></div><span class=\"section-helper action-rule-note\">规则价位" + infoTip(METRIC_HELP.actionPrice) + "</span></div>" + priorityActionTable(priorityRows) + "</section>" +
    "<section class=\"card table-card action-table-card\"><div class=\"table-heading action-table-heading\"><div><h2>全部持仓</h2><p>" + rows.length + " 个持仓标的 · 当前按" + actionSortLabel(state.actionSort) + actionSortDirectionLabel() + "；点击表头箭头排序</p></div></div>" + holdingActionTable(rows) + "</section></main>";
}

function actionMarketBlock(market) {
  const data = marketSummary(market);
  return "<article class=\"action-market-block\"><div class=\"action-market-head\">" + marketLabel(market) + "<strong>" + market + "</strong></div><div class=\"action-market-stats\">" +
    actionCountMetric(data) +
    actionMoneyMetric("总市值", data.valueNative, data.currency, data.value, false, METRIC_HELP.marketValue) +
    actionMoneyMetric("今日盈亏", data.todayNative, data.currency, data.today, true, METRIC_HELP.todayPnl) +
    actionMoneyMetric("累计盈亏", data.pnlNative, data.currency, data.pnl, true, METRIC_HELP.totalPnl) +
    "</div></article>";
}

function actionCountMetric(data) {
  return "<div class=\"action-count-metric\"><span>总持仓" + infoTip(METRIC_HELP.holdingCount) + "</span><b>" + data.count + " 个</b><small>持有中</small></div>";
}

function actionMoneyMetric(label, nativeValue, currency, cnyValue, isPnl, helpText) {
  const valueTone = isPnl ? " " + tone(cnyValue) : "";
  const cny = isPnl ? signed(cnyValue, 0) : money(cnyValue, 0);
  const native = isPnl ? signedNative(nativeValue, currency) : nativeMoney(nativeValue, currency);
  return "<div><span>" + label + infoTip(helpText) + "</span><b class=\"" + valueTone + "\">" + cny + "</b><small>" + (currency === "CNY" ? "人民币" : native) + "</small></div>";
}

function actionSortLabel(sort) {
  const labels = { cost: "总成本总价", qty: "持仓数量", value: "市值", price: "当前价", today: "今日盈亏", pnl: "持仓累计盈亏", weight: "持仓占比" };
  return labels[sort] || labels.today;
}

function actionSortDirectionLabel() {
  return state.actionSortDirection === "asc" ? "升序" : "降序";
}

function actionSortValue(row, key) {
  if (key === "cost") return row.purchaseCostCny;
  if (key === "qty") return row.qty;
  if (key === "value") return row.valueCny;
  if (key === "price") return row.price * (state.rates[row.currency] || 1);
  if (key === "pnl") return row.pnlCny;
  if (key === "weight") return row.holdingPct;
  return row.todayPnlCny;
}

function sortActionRows(rows) {
  return rows.slice().sort(function (a, b) {
    const result = actionSortValue(a, state.actionSort) - actionSortValue(b, state.actionSort);
    return state.actionSortDirection === "asc" ? result : -result;
  });
}

function stockCell(row) {
  return "<span class=\"stock-name\">" + escapeHtml(row.name) + "</span><span class=\"stock-code\">" + escapeHtml(row.code) + marketSuffix(row) + "</span>";
}

function tableDualMoney(nativeValue, currency, cnyValue, valueTone) {
  const className = valueTone ? " " + valueTone : "";
  return "<div class=\"table-money\"><b class=\"" + className + "\">" + money(cnyValue, 0) + "</b><small>" + (currency === "CNY" ? "人民币" : nativeMoney(nativeValue, currency)) + "</small></div>";
}

function priorityActionTable(rows) {
  if (!rows.length) return "<div class=\"empty\">当前筛选条件下，暂无触发补仓、止损或止盈规则的持仓。</div>";
  return "<div class=\"table-scroll\"><table class=\"priority-action-table\"><thead><tr><th>股票</th><th>市场</th><th>当前价</th><th>持仓累计盈亏</th><th>补仓价格</th><th>止损价格</th><th>走势预判（3工作日）</th><th>行动</th><th>执行规则</th></tr></thead><tbody>" + rows.map(function (row) {
    return "<tr><td>" + stockCell(row) + "</td><td>" + marketLabel(row.market) + "</td><td class=\"number-cell\">" + nativeMoney(row.price, row.currency) + "</td><td class=\"number-cell " + tone(row.pnlCny) + "\">" + signed(row.pnlCny, 0) + " (" + pct(row.pnlRate) + ")</td><td class=\"execution-price add\">" + nativeMoney(row.analysis.addPrice, row.currency) + "</td><td class=\"execution-price stop\">" + nativeMoney(row.analysis.stopPrice, row.currency) + "</td><td><span class=\"trend-chip " + row.analysis.trend.cls + "\">" + row.analysis.trend.label + "</span><span class=\"trend-note\">" + row.analysis.trend.text + "</span></td><td><span class=\"action-chip " + row.analysis.cls + "\">" + row.analysis.action + "</span></td><td class=\"analysis-copy\">" + escapeHtml(row.analysis.text) + "</td></tr>";
  }).join("") + "</tbody></table></div>";
}

function actionSortHeader(key, label) {
  const active = state.actionSort === key;
  const direction = active ? state.actionSortDirection : "desc";
  const directionText = direction === "asc" ? "升序" : "降序";
  return "<th><button type=\"button\" class=\"table-sort-button" + (active ? " active" : "") + "\" data-action-sort=\"" + key + "\" aria-label=\"按" + label + directionText + "排序\" aria-pressed=\"" + active + "\"><span>" + label + "</span><svg class=\"sort-arrow " + direction + "\" viewBox=\"0 0 12 12\" aria-hidden=\"true\"><path d=\"M6 2v8M3.5 4.5 6 2l2.5 2.5\"/></svg></button></th>";
}

function holdingActionTable(rows) {
  if (!rows.length) return "<div class=\"empty\">当前筛选条件下没有需要展示的持仓。</div>";
  return "<div class=\"table-scroll\"><table class=\"holding-action-table\"><thead><tr><th>股票</th><th>市场</th>" + actionSortHeader("cost", "总成本总价") + "<th>持仓数量</th>" + actionSortHeader("value", "市值") + actionSortHeader("price", "当前价") + actionSortHeader("today", "今日盈亏") + actionSortHeader("pnl", "持仓累计盈亏") + "<th>持仓占比</th><th>操作建议</th></tr></thead><tbody>" + rows.map(function (row) {
    return "<tr><td>" + stockCell(row) + "</td><td>" + marketLabel(row.market) + "</td><td>" + tableDualMoney(row.cost * row.qty, row.currency, row.purchaseCostCny) + "</td><td class=\"number-cell\">" + row.qty.toLocaleString("zh-CN") + "</td><td>" + tableDualMoney(row.price * row.qty, row.currency, row.valueCny) + "</td><td class=\"number-cell\">" + nativeMoney(row.price, row.currency) + "</td><td class=\"number-cell " + tone(row.todayPnlCny) + "\">" + signed(row.todayPnlCny, 0) + "</td><td class=\"number-cell " + tone(row.pnlCny) + "\">" + signed(row.pnlCny, 0) + "<small>" + pct(row.pnlRate) + "</small></td><td class=\"number-cell\">" + row.holdingPct.toFixed(2) + "%</td><td><span class=\"action-chip " + row.analysis.cls + "\">" + row.analysis.action + "</span><span class=\"action-brief\">" + escapeHtml(row.analysis.text) + "</span></td></tr>";
  }).join("") + "</tbody></table></div>";
}

function marketSuffix(row) {
  return row.market === "A股" ? (row.sina.startsWith("sh") ? ".SH" : ".SZ") : row.market === "港股" ? ".HK" : ".US";
}

function radarPage() {
  const owned = new Set(activeHoldings().map(function (item) { return item.sina; }));
  const rows = candidates.filter(function (item) { return !owned.has(item.sina) && (state.watchMarket === "全部" || item.market === state.watchMarket); }).map(function (item) {
    const quote = state.quotes.get(item.sina);
    return Object.assign({}, item, { quote: quote, saved: state.saved.some(function (saved) { return saved.sina === item.sina; }) });
  });
  const saved = state.saved.slice().reverse();
  return "<main class=\"page-shell\"><h1 class=\"page-title\">机会雷达 · 非持仓标的</h1><p class=\"page-subtitle\">研究与观察清单，仅作信息整理和跟踪，不构成买入建议或收益保证。</p><div class=\"filter-bar\">" + marketTabs(state.watchMarket, "watch-market") + "<span class=\"section-helper\">已自动排除当前持仓中的个股</span></div><section class=\"radar-top\"><article class=\"card radar-summary\"><b class=\"radar-target\">" + rows.length + "</b><div><h2>本周值得进一步研究 " + rows.length + " 个标的</h2><p>按照主题、行情变化、与现有持仓的重合度整理。先研究，再做交易决策。</p></div></article><aside class=\"card radar-side\"><h3>与当前持仓关联</h3><p>持仓覆盖 " + MARKET_ORDER.map(function (m) { return marketSummary(m).count; }).reduce(function (a, b) { return a + b; }, 0) + " 个标的；观察池优先保留不同主题和市场的选择。</p></aside></section><section class=\"watch-layout\"><section class=\"card watch-list\">" + (rows.length ? rows.map(watchRow).join("") : "<div class=\"empty\">该市场暂无非持仓候选标的。</div>") + "</section><aside class=\"card watch-aside\"><h2>观察清单（" + saved.length + "）</h2>" + (saved.length ? saved.map(function (item) { return "<div class=\"saved-row\">" + marketLabel(item.market) + "<div><strong>" + escapeHtml(item.name) + "</strong><br/><span>" + escapeHtml(item.code) + " · " + escapeHtml(item.theme) + "</span></div></div>"; }).join("") : "<p class=\"section-helper\">点击“加入观察”后会保存到当前浏览器。</p>") + "</aside></section></main>";
}

function watchRow(item) {
  const quote = item.quote;
  return "<article class=\"watch-row\"><div>" + marketLabel(item.market) + " <strong>" + escapeHtml(item.name) + "</strong><p>" + escapeHtml(item.code) + " · " + escapeHtml(item.theme) + "</p></div><div><span class=\"watch-meta\">今日涨跌</span><b class=\"" + tone(quote && quote.changePct) + "\">" + (quote ? pct(quote.changePct) : "--") + "</b></div><div class=\"reason\">" + escapeHtml(item.reason) + "</div><div><span class=\"watch-meta\">近期催化</span><p>" + escapeHtml(item.target) + "</p></div><div><span class=\"priority-level\">热度 " + item.heat + "</span></div><button class=\"" + (item.saved ? "secondary-button" : "outline-button") + "\" type=\"button\" data-add-watch=\"" + escapeHtml(item.sina) + "\"" + (item.saved ? " disabled" : "") + ">" + (item.saved ? "已在观察" : "加入观察") + "</button></article>";
}

function tradesPage() {
  const soldRows = state.rows.filter(function (row) { return row.status === "sold" && (state.tradeMarket === "全部" || row.market === state.tradeMarket); }).slice().sort(function (a, b) {
    return (b.sellDate || "").localeCompare(a.sellDate || "") || b.pnlCny - a.pnlCny;
  });
  const purchaseCost = soldRows.reduce(function (total, row) { return total + row.purchaseCostCny; }, 0);
  const saleProceeds = soldRows.reduce(function (total, row) { return total + row.saleProceedsCny; }, 0);
  const realizedPnl = soldRows.reduce(function (total, row) { return total + row.pnlCny; }, 0);
  const wins = soldRows.filter(function (row) { return row.pnlCny > 0; }).length;
  const winRate = soldRows.length ? wins / soldRows.length * 100 : 0;
  return "<main class=\"page-shell\"><div class=\"filter-bar\"><div><h1 class=\"page-title\" style=\"margin:0\">卖出记录</h1><p class=\"section-helper\">记录已完成的卖出批次，并自动计入固定手续费。</p></div><button class=\"primary-button\" type=\"button\" data-open-holding-editor=\"sold\">录入卖出</button></div><section class=\"trade-kpis\">" +
    tradeKpi("已卖出批次", soldRows.length + " 笔", "盈利 " + wins + " 笔 · 胜率 " + winRate.toFixed(0) + "%") + tradeKpi("买入成本", money(purchaseCost, 0), "买入价 × 数量，人民币折算") + tradeKpi("卖出金额", money(saleProceeds, 0), "卖出价 × 数量，人民币折算") + tradeKpi("已实现盈亏", signed(realizedPnl, 0), "卖出金额 − 买入成本", tone(realizedPnl)) + "</section>" +
    "<section class=\"card table-card\"><div class=\"trade-toolbar\">" + soldMarketTabs() + "<span class=\"trade-source\">表单记录保存在当前浏览器</span></div><div class=\"table-scroll\"><table class=\"sold-record-table\"><thead><tr><th>卖出日期</th><th>市场</th><th>股票</th><th>买入价</th><th>卖出价</th><th>数量</th><th>买入成本</th><th>卖出金额</th><th>已实现盈亏</th><th>收益率</th></tr></thead><tbody>" + (soldRows.length ? soldRows.map(soldRecordRow).join("") : "<tr><td colspan=\"10\"><div class=\"empty\">没有匹配的卖出记录。</div></td></tr>") + "</tbody></table></div></section></main>";
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
  return "<tr><td>" + escapeHtml(row.sellDate || "—") + "</td><td>" + marketLabel(row.market) + "</td><td><strong>" + escapeHtml(row.name) + "</strong><span class=\"stock-code\">" + escapeHtml(row.code) + "</span></td><td class=\"number-cell\">" + nativeMoney(row.cost, row.currency) + "</td><td class=\"number-cell\">" + nativeMoney(row.sellPrice, row.currency) + "</td><td>" + row.qty.toLocaleString("zh-CN") + "</td><td class=\"number-cell\">" + money(row.purchaseCostCny, 0) + "</td><td class=\"number-cell\">" + money(row.saleProceedsCny, 0) + "</td><td class=\"number-cell " + tone(row.pnlCny) + "\"><strong>" + signed(row.pnlCny, 0) + "</strong><small>" + signedNative(nativePnl, row.currency) + "</small></td><td class=\"number-cell " + tone(row.pnlRate) + "\"><strong>" + pct(row.pnlRate) + "</strong></td></tr>";
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
  const actions = state.rows.filter(function (row) { return row.status === "holding"; }).slice().sort(function (a, b) { return a.pnlCny - b.pnlCny; }).slice(0, 3);
  const latestTrades = state.trades.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 6);
  return "<main class=\"page-shell\"><div class=\"filter-bar\"><h1 class=\"page-title\" style=\"margin:0\">投资复盘 · " + new Date().getFullYear() + "年" + (new Date().getMonth() + 1) + "月</h1><div class=\"segmented\"><button>本周</button><button class=\"active\">本月</button><button>本季度</button></div></div><section class=\"review-grid\"><article class=\"card review-card\"><h2>① 本期组合表现如何</h2><div class=\"review-stat\"><strong class=\"" + tone(data.totalPnl) + "\">" + pct(data.totalRate) + "</strong><span>组合累计收益率</span></div><div class=\"review-canvas\"><canvas class=\"line-chart\" data-chart=\"review\"></canvas></div></article><article class=\"card review-card\"><h2>② 收益主要来自哪里</h2>" + MARKET_ORDER.map(function (market) { const item = marketSummary(market); const pctValue = Math.min(100, Math.abs(item.pnl) / Math.max(1, Math.max.apply(null, MARKET_ORDER.map(function (m) { return Math.abs(marketSummary(m).pnl); }))) * 100); return "<div class=\"bar-contribution\"><span>" + market + "</span><div class=\"bar-track\"><div class=\"bar-fill " + (item.pnl < 0 ? "negative" : "") + "\" style=\"width:" + pctValue.toFixed(0) + "%\"></div></div><b class=\"" + tone(item.pnl) + "\">" + signed(item.pnl, 0) + "</b></div>"; }).join("") + "</article><article class=\"card review-card\"><h2>③ 哪些决策需要复核</h2><div class=\"review-highlight\"><span>最大回撤（30日估算）</span><strong class=\"negative\">" + pct(-maxDrawdown) + "</strong></div><div class=\"review-highlight\"><span>前五大持仓集中度</span><strong>" + topFiveConcentration().toFixed(1) + "%</strong></div><p class=\"section-helper\">复核亏损扩大和高集中度的仓位，更新后续跟踪指标。</p></article></section><section class=\"review-bottom\"><article class=\"card timeline-card\"><h2>本期关键交易</h2><div class=\"table-scroll\"><table class=\"timeline-table\"><thead><tr><th>时间</th><th>事件 / 操作</th><th>交易备注</th><th>复盘结论</th></tr></thead><tbody>" + (latestTrades.length ? latestTrades.map(function (trade) { return "<tr><td>" + escapeHtml(trade.date) + "</td><td><b>" + (trade.action === "buy" ? "买入 " : "卖出 ") + escapeHtml(trade.name) + "</b><br/><span class=\"stock-code\">" + escapeHtml(trade.code) + " · " + trade.qty + " 股</span></td><td>" + escapeHtml(trade.note || "未填写") + "</td><td><span class=\"action-chip\">" + (trade.action === "buy" ? "等待验证" : "复核收益") + "</span></td></tr>"; }).join("") : "<tr><td colspan=\"4\"><div class=\"empty\">暂无交易记录。</div></td></tr>") + "</tbody></table></div></article><aside class=\"card next-card\"><h2>下期关注事项</h2>" + actions.map(function (row, index) { return "<div class=\"next-item\"><b class=\"order-num\">" + (index + 1) + "</b><div><strong>" + escapeHtml(row.name) + " <span class=\"stock-code\">" + escapeHtml(row.code) + "</span></strong><p>" + escapeHtml(row.analysis.text) + "</p></div><button class=\"text-link\" type=\"button\" data-tab=\"actions\">前往</button></div>"; }).join("") + "</aside></section></main>";
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
  const rows = activeHoldings();
  const dates = Array.from(new Set(rows.flatMap(function (row) {
    return (state.histories[row.sina] || []).map(function (point) { return point.date; });
  }))).sort().slice(-(days || 30));
  if (!dates.length) return [{ date: "—", value: sum(rows, "valueCny") }];
  return dates.map(function (date) {
    let value = 0;
    rows.forEach(function (row) {
      const history = state.histories[row.sina] || [];
      const point = pointOnOrBefore(history, date);
      const price = point && Number(point.close) > 0 ? Number(point.close) : row.cost;
      value += price * row.qty * (state.rates[row.currency] || 1);
    });
    return { date: date, value: value };
  });
}

function calculateDrawdown(points) {
  let peak = points[0] ? points[0].value : 0, max = 0;
  points.forEach(function (point) { peak = Math.max(peak, point.value); if (peak) max = Math.max(max, (peak - point.value) / peak * 100); });
  return max;
}

function topFiveConcentration() {
  const open = summary().openRows.slice().sort(function (a, b) { return b.valueCny - a.valueCny; });
  return open.slice(0, 5).reduce(function (n, row) { return n + row.valueCny; }, 0) / Math.max(1, summary().value) * 100;
}

function render() {
  const page = state.tab === "actions" ? actionsPage() : state.tab === "radar" ? radarPage() : state.tab === "trades" ? tradesPage() : state.tab === "review" ? reviewPage() : overviewPage();
  document.body.classList.toggle("modal-open", state.holdingEditorOpen);
  document.querySelector("#app").innerHTML = topNav() + page + "<footer class=\"page-footer\">数据来自公开行情接口，可能有延迟。港股以港币、美股以美元、A股以人民币展示；组合指标统一按实时汇率折算人民币。页面中的分析和观察内容仅作研究提示，不构成投资建议。</footer>" + holdingEditorModal() + toastMarkup();
  syncBrandVisuals();
  if (state.holdingEditorOpen) window.requestAnimationFrame(syncHoldingFormUi);
  scheduleJarDeposits();
  requestAnimationFrame(drawCharts);
}

function drawCharts() {
  document.querySelectorAll("canvas[data-chart]").forEach(function (canvas) {
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    const width = rect.width, height = rect.height, padding = 26;
    const points = portfolioSeries(state.trendDays);
    const series = points.map(function (point) { return point.value; });
    const baseline = series.map(function () { return 0; });
    const all = series.concat(baseline);
    let min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    const range = Math.max(1, max - min);
    min = Math.min(0, min - range * 0.1);
    max = Math.max(0, max + range * 0.1);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#e9eef6";
    ctx.lineWidth = 1;
    const left = 72, right = 22, top = 20, bottom = 30, gridCount = 4;
    const chartHeight = height - top - bottom;
    const chartWidth = width - left - right;
    ctx.font = "11px Noto Sans SC, sans-serif";
    ctx.fillStyle = "#8993a8";
    ctx.textAlign = "right";
    for (let i = 0; i <= gridCount; i += 1) {
      const value = max - (max - min) * i / gridCount;
      const y = top + chartHeight * i / gridCount;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
      ctx.fillText(formatAxisMoney(value), left - 8, y + 4);
    }
    ctx.textAlign = "center";
    const labels = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter(function (value, index, list) { return list.indexOf(value) === index; });
    labels.forEach(function (index) {
      const x = left + chartWidth * index / Math.max(1, points.length - 1);
      ctx.fillText(formatChartDate(points[index].date), x, height - 8);
    });
    function line(values, color, fill) {
      ctx.beginPath();
      values.forEach(function (value, index) {
        const x = left + chartWidth * index / Math.max(1, values.length - 1);
        const y = top + (max - value) / (max - min) * chartHeight;
        index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.stroke();
      if (fill) {
        const zeroY = top + (max - 0) / (max - min) * chartHeight;
        const finalX = width - right;
        ctx.lineTo(finalX, zeroY); ctx.lineTo(left, zeroY); ctx.closePath();
        ctx.fillStyle = "rgba(255,75,75,.08)"; ctx.fill();
      }
    }
    line(baseline, "#2169f3", false);
    line(series, "#ff4b4b", true);
  });
}

function formatAxisMoney(value) {
  const abs = Math.abs(value);
  const formatted = abs >= 10000 ? (abs / 10000).toFixed(abs >= 100000 ? 0 : 1) + "万" : Math.round(abs).toLocaleString("zh-CN");
  return (value > 0 ? "+" : value < 0 ? "-" : "") + "¥" + formatted;
}

function formatChartDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
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

function eventHandlers() {
  window.addEventListener("hashchange", function () {
    const tab = location.hash.slice(1);
    if (["overview", "actions", "radar", "trades", "review"].includes(tab)) {
      state.tab = tab;
      render();
      if (tab === "radar" && candidates.some(function (item) { return !state.quotes.has(item.sina); })) refreshData(true);
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
    const market = event.target.closest("[data-market]");
    if (market) { state.market = market.dataset.market; render(); return; }
    const watchMarket = event.target.closest("[data-watch-market]");
    if (watchMarket) { state.watchMarket = watchMarket.dataset.watchMarket; render(); return; }
    const tradeMarket = event.target.closest("[data-trade-market]");
    if (tradeMarket) { state.tradeMarket = tradeMarket.dataset.tradeMarket; render(); return; }
    const trendDays = event.target.closest("[data-trend-days]");
    if (trendDays) { state.trendDays = Number(trendDays.dataset.trendDays) || 30; render(); return; }
    const rankMode = event.target.closest("[data-rank-mode]");
    if (rankMode) { state.rankMode = rankMode.dataset.rankMode === "loss" ? "loss" : "profit"; render(); return; }
    const actionSort = event.target.closest("[data-action-sort]");
    if (actionSort) {
      const key = ["cost", "value", "price", "today", "pnl"].includes(actionSort.dataset.actionSort) ? actionSort.dataset.actionSort : "today";
      state.actionSortDirection = state.actionSort === key && state.actionSortDirection === "desc" ? "asc" : "desc";
      state.actionSort = key;
      render();
      return;
    }
    const refresh = event.target.closest("[data-refresh]");
    if (refresh) { refreshData(); return; }
    const add = event.target.closest("[data-add-watch]");
    if (add) {
      const item = candidates.find(function (candidate) { return candidate.sina === add.dataset.addWatch; });
      if (item && !state.saved.some(function (saved) { return saved.sina === item.sina; })) { state.saved.push(item); writeStorage(WATCH_KEY, state.saved); render(); }
      return;
    }
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
}

async function refreshData(includeCandidates) {
  state.isRefreshing = true;
  render();
  const holdingSymbols = Array.from(new Set(activeHoldings().map(function (item) { return item.sina; }).filter(Boolean))).join(",");
  const symbols = includeCandidates
    ? Array.from(new Set(activeHoldings().concat(candidates).map(function (item) { return item.sina; }).filter(Boolean))).join(",")
    : holdingSymbols;
  const currentQuotes = { quotes: Object.fromEntries(state.quotes) };
  const currentRates = { rates: { USD_CNY: state.rates.USD, HKD_CNY: state.rates.HKD } };
  const result = await Promise.all([
    getJson("/api/quotes?symbols=" + encodeURIComponent(symbols), currentQuotes, 9000),
    getJson("/api/rates", currentRates, 3500)
  ]);
  if (Object.keys(result[0].quotes || {}).length) state.quotes = new Map(Object.entries(result[0].quotes));
  state.rates = { CNY: 1, USD: Number(result[1].rates && result[1].rates.USD_CNY) || state.rates.USD || 7.22, HKD: Number(result[1].rates && result[1].rates.HKD_CNY) || state.rates.HKD || 0.92 };
  state.updatedAt = formatUpdatedAt(new Date());
  rebuildRows();
  state.isRefreshing = false;
  state.isHistoryLoading = true;
  saveMarketCache();
  render();
  const historyResult = await getJson("/api/history?symbols=" + encodeURIComponent(holdingSymbols) + "&days=30", { histories: state.histories }, 12000);
  if (Object.keys(historyResult.histories || {}).length) state.histories = historyResult.histories;
  state.isHistoryLoading = false;
  rebuildRows();
  saveMarketCache();
  render();
}

async function start() {
  const result = await Promise.all([getJson("holdings.json", []), getJson("trades.json", [])]);
  state.baseHoldings = holdingsFromDocument(result[0]);
  const linked = readStorage(HOLDING_KEY, null);
  state.holdings = Array.isArray(linked) || (linked && Number(linked.version) === 2) ? holdingsFromDocument(linked) : state.baseHoldings.slice();
  const localTrades = readStorage(TRADE_KEY, null);
  state.trades = (Array.isArray(localTrades) ? localTrades : (Array.isArray(result[1]) ? result[1] : [])).map(normalizeTrade);
  readMarketCache();
  rebuildRows();
  eventHandlers();
  render();
  startBrandAnimations();
  refreshData();
}

start().catch(function (error) {
  document.querySelector("#app").innerHTML = "<main class=\"loading-screen\"><div class=\"error\">页面初始化失败：" + escapeHtml(error.message) + "。请刷新重试。</div></main>";
});
