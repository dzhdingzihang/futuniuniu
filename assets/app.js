const marketOrder = ["港股", "A股", "美股"];
const tradesStorageKey = "piggy-trades-v1";
const holdingsStorageKey = "piggy-linked-holdings-v1";
const roundTripFeeUsd = 30;

let holdings = [];
let baseHoldings = [];
let trades = [];

const watchCandidates = [
  { market: "美股", code: "NVDA", name: "英伟达", currency: "USD", sina: "gb_nvda", theme: "AI GPU", baseHeat: 94, targetPct: 0.09, reason: "AI芯片仍是全球科技股定价锚，算力资本开支主线明确。" },
  { market: "美股", code: "AVGO", name: "博通", currency: "USD", sina: "gb_avgo", theme: "AI网络/ASIC", baseHeat: 89, targetPct: 0.075, reason: "AI网络、定制芯片和数据中心交换需求延续高景气。" },
  { market: "美股", code: "MU", name: "美光科技", currency: "USD", sina: "gb_mu", theme: "存储芯片", baseHeat: 88, targetPct: 0.07, reason: "存储产业链热度抬升，AI服务器带动高带宽存储需求。" },
  { market: "港股", code: "00981", name: "中芯国际", currency: "HKD", sina: "hk00981", theme: "国产半导体", baseHeat: 91, targetPct: 0.08, reason: "港股芯片股活跃，国产算力链和先进制程预期提升。" },
  { market: "港股", code: "01024", name: "快手-W", currency: "HKD", sina: "hk01024", theme: "AI应用", baseHeat: 84, targetPct: 0.06, reason: "AI应用和内容平台热度回升，科技股反弹时弹性较高。" },
  { market: "A股", code: "300308", name: "中际旭创", currency: "CNY", sina: "sz300308", theme: "CPO/光模块", baseHeat: 93, targetPct: 0.08, reason: "PCB、光模块、铜缆高速连接仍是AI算力硬件强主线。" },
  { market: "A股", code: "002938", name: "鹏鼎控股", currency: "CNY", sina: "sz002938", theme: "PCB", baseHeat: 90, targetPct: 0.07, reason: "PCB产业链今日热度高，资金围绕算力硬件扩散。" },
  { market: "A股", code: "601138", name: "工业富联", currency: "CNY", sina: "sh601138", theme: "AI服务器", baseHeat: 88, targetPct: 0.065, reason: "AI服务器制造链景气度高，和现有持仓联动性强。" },
];

const els = {
  body: document.querySelector("#holdingsBody"),
  refresh: document.querySelector("#refreshButton"),
  totalProfit: document.querySelector("#totalProfit"),
  totalProfitRate: document.querySelector("#totalProfitRate"),
  totalProfitBreakdown: document.querySelector("#totalProfitBreakdown"),
  totalCost: document.querySelector("#totalCost"),
  totalCostBreakdown: document.querySelector("#totalCostBreakdown"),
  totalValue: document.querySelector("#totalValue"),
  totalValueBreakdown: document.querySelector("#totalValueBreakdown"),
  todayProfit: document.querySelector("#todayProfit"),
  todayProfitRate: document.querySelector("#todayProfitRate"),
  todayProfitBreakdown: document.querySelector("#todayProfitBreakdown"),
  sevenProfit: document.querySelector("#sevenProfit"),
  sevenProfitRate: document.querySelector("#sevenProfitRate"),
  sevenProfitBreakdown: document.querySelector("#sevenProfitBreakdown"),
  sevenProfitRange: document.querySelector("#sevenProfitRange"),
  updatedAt: document.querySelector("#updatedAt"),
  status: document.querySelector("#statusBand"),
  totalTrendValue: document.querySelector("#totalTrendValue"),
  totalTrendChart: document.querySelector("#totalTrendChart"),
  totalTrendHint: document.querySelector("#totalTrendHint"),
  totalIntradayValue: document.querySelector("#totalIntradayValue"),
  totalIntradayChart: document.querySelector("#totalIntradayChart"),
  weeklyAdvice: document.querySelector("#weeklyAdviceBody"),
  weeklyAdviceHint: document.querySelector("#weeklyAdviceHint"),
  marketOverview: document.querySelector("#marketOverview"),
  recommendations: document.querySelector("#recommendationsBody"),
  watchlistDate: document.querySelector("#watchlistDate"),
  tabs: document.querySelectorAll(".tab"),
  watchTabs: document.querySelectorAll(".watch-tab"),
  positionTabs: document.querySelectorAll(".position-tab"),
  sortButtons: document.querySelectorAll(".sort-button"),
  realizedProfit: document.querySelector("#realizedProfit"),
  openProfit: document.querySelector("#openProfit"),
  tradeCount: document.querySelector("#tradeCount"),
  tradeSyncStatus: document.querySelector("#tradeSyncStatus"),
  tradeForm: document.querySelector("#tradeForm"),
  tradeId: document.querySelector("#tradeId"),
  tradeDate: document.querySelector("#tradeDate"),
  tradeAction: document.querySelector("#tradeAction"),
  tradeMarket: document.querySelector("#tradeMarket"),
  tradeCode: document.querySelector("#tradeCode"),
  tradeName: document.querySelector("#tradeName"),
  tradePrice: document.querySelector("#tradePrice"),
  tradeQty: document.querySelector("#tradeQty"),
  tradeCurrency: document.querySelector("#tradeCurrency"),
  tradeSina: document.querySelector("#tradeSina"),
  tradeNote: document.querySelector("#tradeNote"),
  tradeAffectsHoldings: document.querySelector("#tradeAffectsHoldings"),
  tradesBody: document.querySelector("#tradesBody"),
  newTradeButton: document.querySelector("#newTradeButton"),
  exportTradesButton: document.querySelector("#exportTradesButton"),
  exportHoldingsButton: document.querySelector("#exportHoldingsButton"),
  resetLinkedHoldingsButton: document.querySelector("#resetLinkedHoldingsButton"),
  resetTradeButton: document.querySelector("#resetTradeButton"),
};

const serviceUrl = "http://127.0.0.1:8787/";
let currentMarket = "港股";
let currentWatchMarket = "A股";
let currentPositionStatus = "holding";
let tableSort = { key: "pnl", dir: "asc" };
let latestRows = [];
let latestHistories = {};
let latestIntraday = {};
let latestRates = {};
let latestQuotes = new Map();

function money(value, currency = "CNY", digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function number(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function signed(value, currency) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${money(value, currency)}`;
}

function signedPlain(value, currency) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "赚 " : value < 0 ? "亏 " : ""}${money(Math.abs(value), currency)}`;
}

function pct(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${number(value, 2)}%`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function classFor(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return "neutral";
  return value > 0 ? "positive" : "negative";
}

async function getJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url} 返回 ${response.status}`);
    return await response.json();
  } catch (error) {
    if (arguments.length >= 2) return fallback;
    throw error;
  }
}

async function loadHoldings() {
  let data;
  try {
    data = await getJson("holdings.json");
  } catch (error) {
    throw new Error(`持仓数据表读取失败：${error.message}`);
  }

  if (!Array.isArray(data) || !data.length) {
    throw new Error("持仓数据表为空或格式不正确");
  }
  baseHoldings = normalizeHoldings(data);
  const localHoldings = readLocalHoldings();
  holdings = localHoldings ? normalizeHoldings(localHoldings) : [...baseHoldings];
  if (!holdings.length) {
    throw new Error("持仓数据表没有可用股票，请检查 market/code/cost/qty/currency/sina");
  }
}

function normalizeHoldings(items) {
  return items.map((item) => {
    const rawStatus = String(item.status || "holding").trim().toLowerCase();
    const status = rawStatus === "sold" || rawStatus === "卖出" || rawStatus === "已卖出" ? "sold" : "holding";
    return {
      market: String(item.market || "").trim(),
      code: String(item.code || "").trim(),
      name: String(item.name || item.code || "").trim(),
      cost: Number(item.cost),
      qty: Number(item.qty),
      currency: String(item.currency || "").trim().toUpperCase(),
      sina: String(item.sina || "").trim().toLowerCase(),
      status,
      sellPrice: Number(item.sellPrice ?? item.soldPrice ?? item.exitPrice),
      sellDate: String(item.sellDate || item.soldDate || "").trim(),
    };
  }).filter((item) => {
    const hasBaseFields = item.market && item.code && item.currency && item.sina && Number.isFinite(item.cost) && Number.isFinite(item.qty) && item.qty > 0;
    return hasBaseFields && (item.status === "holding" || Number.isFinite(item.sellPrice));
  });
}

function readLocalHoldings() {
  try {
    const raw = localStorage.getItem(holdingsStorageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistHoldings() {
  localStorage.setItem(holdingsStorageKey, JSON.stringify(holdings, null, 2));
}

function clearLocalHoldings() {
  localStorage.removeItem(holdingsStorageKey);
  holdings = [...baseHoldings];
}

async function loadTrades() {
  const local = readLocalTrades();
  if (local) {
    trades = normalizeTrades(local);
    els.tradeSyncStatus.textContent = "使用本地记录";
    return;
  }

  const data = await getJson("trades.json", []);
  trades = normalizeTrades(Array.isArray(data) ? data : []);
  els.tradeSyncStatus.textContent = "读取 trades.json";
}

function normalizeTrades(items) {
  return items.map((item, index) => {
    const action = item.action === "sell" ? "sell" : "buy";
    return {
      id: String(item.id || `trade-${index + 1}-${Date.now()}`),
      date: String(item.date || "").trim(),
      action,
      market: String(item.market || "").trim(),
      code: String(item.code || "").trim(),
      name: String(item.name || item.code || "").trim(),
      price: Number(item.price),
      qty: Number(item.qty),
      currency: String(item.currency || "").trim().toUpperCase(),
      sina: String(item.sina || "").trim().toLowerCase(),
      note: String(item.note || "").trim(),
      affectsHoldings: item.affectsHoldings === true,
    };
  }).filter((item) => item.date && item.market && item.code && item.currency && item.sina && Number.isFinite(item.price) && Number.isFinite(item.qty) && item.qty > 0);
}

function readLocalTrades() {
  try {
    const raw = localStorage.getItem(tradesStorageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistTrades() {
  localStorage.setItem(tradesStorageKey, JSON.stringify(trades, null, 2));
  els.tradeSyncStatus.textContent = "已保存到本机浏览器";
}

async function fetchQuotes() {
  const symbols = [...new Set([...holdings, ...watchCandidates].map((item) => item.sina))].join(",");
  const payload = await getJson(`/api/quotes?symbols=${encodeURIComponent(symbols)}`, { quotes: {} });
  return new Map(Object.entries(payload.quotes || {}));
}

async function fetchRates() {
  const payload = await getJson("/api/rates", { rates: { USD_CNY: 7.22, HKD_CNY: 0.92 } });
  return { CNY: 1, USD: Number(payload.rates.USD_CNY) || 7.22, HKD: Number(payload.rates.HKD_CNY) || 0.92 };
}

async function fetchHistory() {
  const symbols = [...new Set([...holdings, ...watchCandidates].map((item) => item.sina))].join(",");
  const payload = await getJson(`/api/history?symbols=${encodeURIComponent(symbols)}&days=30`, { histories: {} });
  return payload.histories || {};
}

async function fetchIntraday() {
  const symbols = [...new Set(activeHoldings().map((item) => item.sina))].join(",");
  const payload = await getJson(`/api/intraday?symbols=${encodeURIComponent(symbols)}`, { intraday: {} });
  return payload.intraday || {};
}

function activeHoldings() {
  return holdings.filter((item) => item.status !== "sold");
}

function feeForCurrency(currency, rates) {
  const usdToCny = rates.USD || 7.22;
  const currencyToCny = rates[currency] || 1;
  return (roundTripFeeUsd * usdToCny) / currencyToCny;
}

function buildRows(quotes, histories, rates) {
  return holdings.map((item) => {
    const quote = quotes.get(item.sina) || null;
    const history = mergeQuoteIntoHistory(histories[item.sina] || [], quote);
    const isSold = item.status === "sold";
    const livePrice = quote?.price || last(history)?.close || NaN;
    const price = isSold ? item.sellPrice : livePrice;
    const rate = rates[item.currency] || 1;
    const fee = feeForCurrency(item.currency, rates);
    const feeCny = fee * rate;
    const costValue = item.cost * item.qty;
    const marketValue = isSold ? 0 : price * item.qty;
    const exitValue = price * item.qty;
    const pnl = Number.isFinite(price) ? exitValue - costValue - fee : NaN;
    const todayPnl = isSold ? 0 : (quote?.change || 0) * item.qty;
    const sevenPoint = history[Math.max(0, history.length - 8)];
    const latestPoint = last(history);
    const sevenPnl = isSold ? 0 : sevenPoint ? (price - sevenPoint.close) * item.qty : NaN;
    const row = {
      ...item,
      price,
      livePrice,
      quote,
      history,
      fee,
      feeCny,
      costValue,
      marketValue,
      exitValue,
      pnl,
      pnlRate: costValue ? (pnl / costValue) * 100 : NaN,
      todayPnl,
      todayPnlRate: isSold ? 0 : price ? ((quote?.change || 0) / (price - (quote?.change || 0))) * 100 : NaN,
      sevenPnl,
      sevenStartDate: sevenPoint?.date || "",
      sevenEndDate: latestPoint?.date || quote?.date || "",
      costCny: costValue * rate,
      valueCny: marketValue * rate,
      pnlCny: pnl * rate,
      todayPnlCny: todayPnl * rate,
      sevenPnlCny: Number.isFinite(sevenPnl) ? sevenPnl * rate : NaN,
      changePct: quote?.changePct ?? NaN,
      marketHeat: marketHeatFor(item.market),
    };
    row.buyZone = buyZoneFor(row);
    row.sellZone = sellZoneFor(row);
    row.action = actionFor(row);
    return row;
  });
}

function marketHeatFor(market) {
  const base = { "美股": 4, "港股": 1, "A股": 2 }[market] || 0;
  return base;
}

function mergeQuoteIntoHistory(history, quote) {
  if (!quote?.price) return history;
  const date = quote.date || new Date().toISOString().slice(0, 10);
  const time = quote.time || new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const point = {
    date,
    time,
    open: quote.open || quote.prevClose || quote.price,
    high: Math.max(quote.high || quote.price, quote.price),
    low: Math.min(quote.low || quote.price, quote.price),
    close: quote.price,
    live: true,
  };
  const next = [...history].filter((item) => item?.date);
  const index = next.findIndex((item) => item.date === date);
  if (index >= 0) {
    const current = next[index];
    next[index] = {
      ...current,
      time,
      high: Math.max(current.high || current.close || point.high, point.high),
      low: Math.min(current.low || current.close || point.low, point.low),
      close: point.close,
      live: true,
    };
  } else if (!next.length || date > last(next).date) {
    next.push(point);
  }
  return next.slice(-30);
}

function buildTradeStats(rows, rates) {
  const lots = new Map();
  let realizedCny = 0;
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  sorted.forEach((trade) => {
    const key = trade.sina || `${trade.market}:${trade.code}`;
    const fx = rates[trade.currency] || 1;
    if (!lots.has(key)) lots.set(key, []);
    const queue = lots.get(key);

    if (trade.action === "buy") {
      queue.push({ qty: trade.qty, price: trade.price, currency: trade.currency });
      return;
    }

    let remaining = trade.qty;
    while (remaining > 0 && queue.length) {
      const lot = queue[0];
      const matched = Math.min(remaining, lot.qty);
      realizedCny += (trade.price - lot.price) * matched * fx;
      lot.qty -= matched;
      remaining -= matched;
      if (lot.qty <= 0.000001) queue.shift();
    }
    if (remaining < trade.qty) realizedCny -= roundTripFeeUsd * (rates.USD || 7.22);
  });

  const openCny = sum(rows.filter((row) => row.status !== "sold"), "pnlCny");
  return {
    realizedCny,
    openCny,
    totalTrades: trades.length,
  };
}

function rowForTrade(trade, rows) {
  return rows.find((row) => row.sina === trade.sina)
    || rows.find((row) => row.market === trade.market && row.code === trade.code)
    || null;
}

function applyTradeToHoldings(trade, sourceHoldings) {
  const next = sourceHoldings.map((item) => ({ ...item }));
  const index = next.findIndex((item) => item.sina === trade.sina && item.status !== "sold");

  if (trade.action === "buy") {
    if (index >= 0) {
      const current = next[index];
      const totalQty = current.qty + trade.qty;
      const totalCost = current.cost * current.qty + trade.price * trade.qty;
      next[index] = {
        ...current,
        market: trade.market || current.market,
        code: trade.code || current.code,
        name: trade.name || current.name,
        currency: trade.currency || current.currency,
        sina: trade.sina || current.sina,
        status: "holding",
        qty: totalQty,
        cost: totalQty ? totalCost / totalQty : current.cost,
      };
    } else {
      next.push({
        market: trade.market,
        code: trade.code,
        name: trade.name || trade.code,
        cost: trade.price,
        qty: trade.qty,
        currency: trade.currency,
        sina: trade.sina,
        status: "holding",
      });
    }
  } else if (index >= 0) {
    const current = next[index];
    const qty = Math.max(0, current.qty - trade.qty);
    const soldQty = Math.min(current.qty, trade.qty);
    if (soldQty > 0) {
      next.push({
        ...current,
        qty: soldQty,
        status: "sold",
        sellPrice: trade.price,
        sellDate: trade.date,
      });
    }
    if (qty <= 0.000001) {
      next.splice(index, 1);
    } else {
      next[index] = { ...current, qty };
    }
  }

  return normalizeHoldings(next);
}

function rebuildLinkedHoldings() {
  holdings = trades
    .filter((trade) => trade.affectsHoldings)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .reduce((items, trade) => applyTradeToHoldings(trade, items), [...baseHoldings]);
  persistHoldings();
}

function buyZoneFor(row) {
  if (!Number.isFinite(row.price)) return { price: NaN, label: "等价格", text: "取到实时价后再计算", tone: "neutral" };
  if (row.pnlRate <= -20) return { price: row.price * 0.96, label: "只低吸", text: "等止跌阳线后小仓试探", tone: "negative" };
  if (row.pnlRate <= -8) return { price: Math.min(row.cost * 0.94, row.price * 0.98), label: "分批补", text: "回落缩量再补，不追反弹", tone: "negative" };
  if (row.pnlRate >= 12) return { price: row.price * 0.9, label: "等回踩", text: "盈利股不追高，回撤再看", tone: "positive" };
  return { price: row.price * 0.965, label: "轻仓低吸", text: "接近参考价再分批", tone: "neutral" };
}

function sellZoneFor(row) {
  if (!Number.isFinite(row.price)) return { price: NaN, label: "等价格", text: "取到实时价后再计算", tone: "neutral" };
  if (row.pnlRate >= 25) return { price: row.price * 1.025, label: "冲高止盈", text: "到位先卖25%-40%", tone: "positive" };
  if (row.pnlRate >= 8) return { price: row.price * 1.06, label: "目标止盈", text: "放量冲高分批落袋", tone: "positive" };
  if (row.pnlRate < -15) return { price: row.cost * 0.92, label: "反弹减仓", text: "修复到参考价先降风险", tone: "negative" };
  return { price: row.cost * 1.05, label: "回本减压", text: "到成本上方先减一部分", tone: "neutral" };
}

function actionFor(row) {
  const last3 = row.history.slice(-3);
  if (last3.length < 3) return { label: "中性", type: "hold", conclusion: "中性", text: "历史数据不足，未来3天结论：中性。先等价格和成交方向确认。" };
  const closes = last3.map((p) => p.close);
  const slope = closes[2] - closes[0];
  const day1 = ((closes[1] - closes[0]) / closes[0]) * 100;
  const day2 = ((closes[2] - closes[1]) / closes[1]) * 100;
  const avg = (day1 + day2) / 2;
  const volatility = ((Math.max(...last3.map((p) => p.high || p.close)) - Math.min(...last3.map((p) => p.low || p.close))) / closes[0]) * 100;
  let conclusion = "中性";
  if (slope > 0 && avg > 0.35) conclusion = "涨";
  if (slope < 0 && avg < -0.35) conclusion = "跌";
  if (volatility > 12 && Math.abs(avg) < 1) conclusion = "中性";
  const label = conclusion === "涨" ? "偏强观察" : conclusion === "跌" ? "防守优先" : "震荡观察";
  const type = conclusion === "涨" ? "buy" : conclusion === "跌" ? "stop" : "hold";
  return {
    label,
    type,
    conclusion,
    text: `最近3天收盘 ${number(closes[0])}→${number(closes[1])}→${number(closes[2])}，两日均幅 ${pct(avg)}，波动 ${pct(volatility)}。未来3天结论：${conclusion}。${conclusion === "涨" ? "可等回踩不破后持有或小仓跟随。" : conclusion === "跌" ? "优先控制仓位，反弹到卖出参考附近减仓。" : "上下方向不够清晰，先按区间处理。"}`
  };
}

function weeklyAdviceFor(row) {
  if (!Number.isFinite(row.price) || row.history.length < 5) {
    return {
      stance: "暂无建议",
      tone: "neutral",
      summary: "实时价或历史波动不足，本周不做新增动作。",
      buy: NaN,
      sell: NaN,
      tLow: NaN,
      tHigh: NaN,
      reason: "等价格、近5日高低点和日内波动补齐后再判断。",
    };
  }

  const points = row.history.slice(-20);
  const closes = points.map((p) => p.close).filter(Number.isFinite);
  const highs = points.map((p) => p.high || p.close).filter(Number.isFinite);
  const lows = points.map((p) => p.low || p.close).filter(Number.isFinite);
  const ma5 = average(closes.slice(-5));
  const ma10 = average(closes.slice(-10));
  const high20 = Math.max(...highs);
  const low20 = Math.min(...lows);
  const rangePct = row.price ? ((high20 - low20) / row.price) * 100 : NaN;
  const momentum = closes.length >= 6 ? ((last(closes) - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : 0;
  const sentiment = marketHeatFor(row.market) + clamp(momentum, -8, 8) * 0.35 + clamp(row.changePct || 0, -5, 5) * 0.5;
  const drawdown = high20 ? ((row.price - high20) / high20) * 100 : 0;
  const nearCost = row.cost ? ((row.price - row.cost) / row.cost) * 100 : 0;

  if (Math.abs(momentum) < 1.2 && rangePct < 5.5) {
    return {
      stance: "没有明确建议",
      tone: "neutral",
      summary: "价格波动和方向都不够清晰，本周以观察为主。",
      buy: NaN,
      sell: NaN,
      tLow: low20,
      tHigh: high20,
      reason: `近5日动量 ${pct(momentum)}，20日区间约 ${pct(rangePct)}，缺少值得动作的空间。`,
    };
  }

  const buy = row.pnlRate < -12
    ? Math.min(row.price * 0.97, ma5 * 0.985)
    : Math.min(ma10 || row.price * 0.96, row.price * 0.965);
  const sell = row.pnlRate > 10
    ? Math.max(row.price * 1.035, high20 * 0.99)
    : Math.max(row.cost * 1.03, row.price * 1.055);
  const tLow = Math.max(low20, row.price * (1 - clamp(rangePct, 4, 12) / 220));
  const tHigh = Math.min(high20 || row.price * 1.05, row.price * (1 + clamp(rangePct, 4, 12) / 180));
  const isStrong = (momentum > 2 || sentiment > 4) && row.price >= ma5;
  const isWeak = momentum < -2 || sentiment < -3 || drawdown < -10;
  const stance = isStrong ? "回踩低吸/冲高减仓" : isWeak ? "防守反弹减仓" : "区间做T";
  const tone = isStrong ? "positive" : isWeak ? "negative" : "neutral";
  const summary = isStrong
    ? `不追高，回踩 ${money(buy, row.currency)} 附近再看；冲到 ${money(sell, row.currency)} 附近先兑现一部分。`
    : isWeak
      ? `优先控风险，反弹到 ${money(sell, row.currency)} 附近减仓；补仓只等 ${money(buy, row.currency)} 附近且止跌。`
      : `适合轻仓做T，${money(tLow, row.currency)} 到 ${money(tHigh, row.currency)} 间高抛低吸。`;

  return {
    stance,
    tone,
    summary,
    buy,
    sell,
    tLow,
    tHigh,
    reason: `近5日动量 ${pct(momentum)}，今日 ${pct(row.changePct)}，市场情绪分 ${number(sentiment, 1)}；20日区间 ${money(low20, row.currency)}-${money(high20, row.currency)}，相对成本 ${pct(nearCost)}。`,
  };
}

function average(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? nums.reduce((total, value) => total + value, 0) / nums.length : NaN;
}

function last(arr) {
  return arr[arr.length - 1];
}

function buildPortfolioSeries(items, histories, rates, market = null) {
  const selected = (market ? items.filter((item) => item.market === market) : items).filter((item) => item.status !== "sold");
  const historyFor = (item) => histories[item.sina] || item.history || [];
  const dates = [...new Set(selected.flatMap((item) => historyFor(item).map((p) => p.date)))].sort().slice(-30);
  return dates.map((date) => {
    let open = 0, high = 0, low = 0, close = 0, cost = 0, included = 0;
    selected.forEach((item) => {
      const point = pointOnOrBefore(historyFor(item), date);
      if (!point) return;
      const fx = rates[item.currency] || 1;
      const itemCost = item.cost * item.qty * fx;
      open += ((point.open || point.close) * item.qty * fx) - itemCost;
      high += ((point.high || point.close) * item.qty * fx) - itemCost;
      low += ((point.low || point.close) * item.qty * fx) - itemCost;
      close += (point.close * item.qty * fx) - itemCost;
      cost += itemCost;
      included += 1;
    });
    return { date, open, high, low, close, cost, included, rate: cost ? (close / cost) * 100 : NaN };
  }).filter((p) => p.included > 0);
}

function buildIntradaySeries(items, intraday, rates, market = null) {
  const selected = (market ? items.filter((item) => item.market === market) : items).filter((item) => item.status !== "sold");
  const dates = selected.flatMap((item) => (intraday[item.sina] || []).map((p) => p.date)).sort();
  const date = last(dates);
  if (!date) return [];
  const keys = [...new Set(selected.flatMap((item) => (intraday[item.sina] || [])
    .filter((p) => p.date === date)
    .map((p) => `${p.date} ${p.time}`)))].sort();
  const series = keys.map((key) => {
    let value = 0, firstValue = 0, included = 0;
    selected.forEach((item) => {
      const daySeries = (intraday[item.sina] || []).filter((p) => p.date === date);
      const point = pointOnOrBeforeTime(daySeries, key);
      if (!point) return;
      const firstPoint = daySeries[0];
      const fx = rates[item.currency] || 1;
      value += point.close * item.qty * fx;
      firstValue += (firstPoint?.close || point.close) * item.qty * fx;
      included += 1;
    });
    return { key, value: value - firstValue, included };
  }).filter((p) => p.included > 0);
  if (!series.length) return [];
  return [{ key: `${date} 00:00`, value: 0, included: series[0].included }, ...series];
}

function pointOnOrBefore(series, date) {
  let found = null;
  for (const point of series) {
    if (point.date <= date) found = point;
    if (point.date > date) break;
  }
  return found;
}

function pointOnOrBeforeTime(series, key) {
  let found = null;
  for (const point of series) {
    const current = `${point.date} ${point.time || "00:00"}`;
    if (current <= key) found = point;
    if (current > key) break;
  }
  return found;
}

function renderSummary(rows, histories, intraday, rates) {
  const cost = sum(rows, "costCny");
  const holdingCost = sum(rows.filter((row) => row.status !== "sold"), "costCny");
  const value = sum(rows, "valueCny");
  const pnl = sum(rows, "pnlCny");
  const holdingPnl = sum(rows.filter((row) => row.status !== "sold"), "pnlCny");
  const soldPnl = sum(rows.filter((row) => row.status === "sold"), "pnlCny");
  const today = sum(rows, "todayPnlCny");
  const seven = sum(rows, "sevenPnlCny");
  els.totalProfit.textContent = signed(pnl, "CNY");
  els.totalProfit.className = classFor(pnl);
  els.totalProfitRate.textContent = pct(cost ? pnl / cost * 100 : NaN);
  els.totalProfitRate.className = classFor(pnl);
  els.totalProfitBreakdown.textContent = `持仓盈亏 ${signedPlain(holdingPnl, "CNY")} ｜ 卖出盈亏 ${signedPlain(soldPnl, "CNY")}`;
  els.totalCost.textContent = money(cost, "CNY");
  els.totalCostBreakdown.textContent = `现金成本 ${money(cost, "CNY")} ｜ 持仓成本 ${money(holdingCost, "CNY")}`;
  els.totalValue.textContent = money(value, "CNY");
  els.totalValueBreakdown.textContent = marketBreakdown(rows, "marketValue", false);
  els.todayProfit.textContent = signed(today, "CNY");
  els.todayProfit.className = classFor(today);
  els.todayProfitRate.textContent = pct(value ? today / (value - today) * 100 : NaN);
  els.todayProfitRate.className = classFor(today);
  els.todayProfitBreakdown.textContent = marketBreakdown(rows, "todayPnl");
  els.sevenProfit.textContent = signed(seven, "CNY");
  els.sevenProfit.className = classFor(seven);
  els.sevenProfitRate.textContent = pct(cost ? seven / cost * 100 : NaN);
  els.sevenProfitRate.className = classFor(seven);
  els.sevenProfitBreakdown.textContent = marketBreakdown(rows, "sevenPnl");
  els.sevenProfitRange.textContent = sevenRangeLabel(rows);
  els.updatedAt.textContent = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());

  const kline = buildPortfolioSeries(rows, histories, rates);
  const line = buildIntradaySeries(rows, intraday, rates);
  renderTrendBlock(els.totalTrendValue, els.totalTrendChart, kline, "CNY");
  renderLineBlock(els.totalIntradayValue, els.totalIntradayChart, line, "CNY");
  els.totalTrendHint.textContent = `红涨绿跌 · ${kline.length} 个交易点`;
  renderWeeklyAdvice(rows);
  renderTradeSummary(rows, rates);
}

function renderWeeklyAdvice(rows) {
  const marketRows = rows.filter((row) => row.market === currentMarket && row.status !== "sold");
  els.weeklyAdviceHint.textContent = `${currentMarket} · 参考实时价格、近30日波动、当日涨跌和市场情绪 · ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
  if (!marketRows.length) {
    els.weeklyAdvice.innerHTML = '<div class="empty-card">当前市场没有持股。</div>';
    return;
  }
  els.weeklyAdvice.innerHTML = marketRows.map((row) => {
    const advice = weeklyAdviceFor(row);
    return `
      <article class="weekly-advice-card ${advice.tone}">
        <div class="weekly-advice-top">
          <span class="badge">${row.market}</span>
          <strong>${row.code}</strong>
          <span>${row.name}</span>
        </div>
        <div class="weekly-stance">${advice.stance}</div>
        <p>${advice.summary}</p>
        <dl>
          <div><dt>补仓价</dt><dd>${Number.isFinite(advice.buy) ? `≤ ${money(advice.buy, row.currency)}` : "暂无"}</dd></div>
          <div><dt>卖出价</dt><dd>${Number.isFinite(advice.sell) ? `≥ ${money(advice.sell, row.currency)}` : "暂无"}</dd></div>
          <div><dt>做T区间</dt><dd>${Number.isFinite(advice.tLow) && Number.isFinite(advice.tHigh) ? `${money(advice.tLow, row.currency)}-${money(advice.tHigh, row.currency)}` : "暂无"}</dd></div>
        </dl>
        <span class="advice-reason">${advice.reason}</span>
      </article>
    `;
  }).join("");
}

function marketBreakdown(rows, key, signedValue = true) {
  return marketOrder.map((market) => {
    const selected = rows.filter((row) => row.market === market);
    if (!selected.length) return "";
    const currency = selected[0]?.currency || "CNY";
    const total = selected.reduce((sumValue, row) => sumValue + (Number.isFinite(row[key]) ? row[key] : 0), 0);
    return `${market}${signedValue ? signedPlain(total, currency) : money(total, currency)}`;
  }).filter(Boolean).join(" ｜ ");
}

function renderMarketOverview(rows, histories, intraday, rates) {
  els.marketOverview.innerHTML = marketOrder.filter((market) => market === currentMarket).map((market) => {
    const selected = rows.filter((row) => row.market === market);
    const currency = selected[0]?.currency || "CNY";
    const cost = selected.reduce((total, row) => total + row.costValue, 0);
    const value = selected.reduce((total, row) => total + row.marketValue, 0);
    const pnl = selected.reduce((total, row) => total + (Number.isFinite(row.pnl) ? row.pnl : 0), 0);
    const rate = cost ? pnl / cost * 100 : NaN;
    const today = selected.reduce((total, row) => total + (Number.isFinite(row.todayPnl) ? row.todayPnl : 0), 0);
    const todayRate = value - today ? today / (value - today) * 100 : NaN;
    const kline = buildPortfolioSeries(rows, histories, rates, market);
    const intradaySeries = buildIntradaySeries(rows, intraday, rates, market);
    return `
      <article class="market-card active" data-market-card="${market}">
        <div class="market-card-head"><span class="badge">${market}</span><span>${currency} 展示</span></div>
        <div class="market-money">
          <span>成本 <strong>${money(cost, currency)}</strong></span>
          <span>市值 <strong>${money(value, currency)}</strong></span>
        </div>
        <div class="market-today">
          <span>今日盈亏</span>
          <strong class="${classFor(today)}">${signed(today, currency)}</strong>
          <small class="${classFor(todayRate)}">${pct(todayRate)}</small>
        </div>
        <strong class="${classFor(pnl)}">${signed(pnl, currency)}</strong>
        <small class="${classFor(rate)}">${pct(rate)}</small>
        <div class="market-chart-pair">
          <div>
            <div class="mini-title">30日盈亏K线</div>
            <div class="sparkline compact">${candlestickSvg(kline, currency)}</div>
          </div>
          <div>
            <div class="mini-title">当日24小时波动</div>
            <div class="sparkline compact">${lineSvg(intradaySeries, currency)}</div>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderTradeSummary(rows, rates) {
  const stats = buildTradeStats(rows, rates);
  const realizedFromHoldings = rows.filter((row) => row.status === "sold").reduce((total, row) => total + (Number.isFinite(row.pnlCny) ? row.pnlCny : 0), 0);
  const realizedCny = realizedFromHoldings || stats.realizedCny;
  els.realizedProfit.textContent = signed(realizedCny, "CNY");
  els.realizedProfit.className = classFor(realizedCny);
  if (rows.length) {
    els.openProfit.textContent = signed(stats.openCny, "CNY");
    els.openProfit.className = classFor(stats.openCny);
  }
  els.tradeCount.textContent = `${stats.totalTrades} 条`;
  els.tradeSyncStatus.textContent = `${trades.filter((trade) => trade.affectsHoldings).length} 条联动持仓`;
  renderTrades(rows, rates);
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number.isFinite(row[key]) ? row[key] : 0), 0);
}

function sevenRangeLabel(rows) {
  const starts = rows.map((row) => row.sevenStartDate).filter(Boolean).sort();
  const ends = rows.map((row) => row.sevenEndDate).filter(Boolean).sort();
  if (!starts.length || !ends.length) return "等待30日历史数据";
  return `${shortDate(starts[0])} 至 ${shortDate(last(ends))} · 最近7个交易日`;
}

function renderTrendBlock(valueEl, chartEl, series, currency) {
  const current = last(series);
  const previous = series[0];
  valueEl.textContent = current ? `${signed(current.close, currency)} · ${pct(current.rate)}` : "--";
  valueEl.className = current ? classFor(current.close) : "neutral";
  chartEl.innerHTML = candlestickSvg(series, currency);
}

function renderLineBlock(valueEl, chartEl, series, currency) {
  const current = last(series);
  valueEl.textContent = current ? `${signed(current.value, currency)} · 今日波动` : "--";
  valueEl.className = classFor(current?.value);
  chartEl.innerHTML = lineSvg(series, currency);
}

function candlestickSvg(series) {
  if (!series.length) return '<div class="chart-empty">暂无历史K线</div>';
  const width = 760, height = 230, padL = 84, padR = 18, padT = 16, padB = 36;
  const highs = series.map((p) => p.high);
  const lows = series.map((p) => p.low);
  let min = Math.min(...lows, 0), max = Math.max(...highs, 0);
  if (min === max) { min -= 1; max += 1; }
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const step = plotW / series.length;
  const y = (v) => padT + (1 - ((v - min) / (max - min))) * plotH;
  const ticks = moneyTicks(min, max, 2000);
  const candles = series.map((p, index) => {
    const x = padL + index * step + step / 2;
    const up = p.close >= p.open;
    const cls = up ? "candle-up" : "candle-down";
    const top = Math.min(y(p.open), y(p.close));
    const body = Math.max(3, Math.abs(y(p.open) - y(p.close)));
    return `<g class="${cls}"><line x1="${x}" x2="${x}" y1="${y(p.high)}" y2="${y(p.low)}"></line><rect x="${x - Math.max(2, step * 0.28)}" y="${top}" width="${Math.max(4, step * 0.56)}" height="${body}" rx="1"></rect></g>`;
  }).join("");
  const grid = ticks.map((tick) => `<g><line class="axis-grid" x1="${padL}" x2="${width - padR}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis-label" x="8" y="${y(tick) + 4}">${compactMoney(tick)}</text></g>`).join("");
  const zero = `<line class="zero-axis" x1="${padL}" x2="${width - padR}" y1="${y(0)}" y2="${y(0)}"></line><text class="zero-label" x="8" y="${Math.max(padT + 10, y(0) - 5)}">0</text>`;
  const labels = tradingDateLabels(series, padL, plotW);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="盈亏K线">${grid}${zero}<line class="axis-line" x1="${padL}" x2="${padL}" y1="${padT}" y2="${height - padB}"></line><line class="axis-line" x1="${padL}" x2="${width - padR}" y1="${height - padB}" y2="${height - padB}"></line>${candles}${labels.map((tick) => `<text class="axis-label date-label" x="${tick.x}" y="${height - 9}">${tick.label}</text>`).join("")}</svg>`;
}

function lineSvg(series) {
  if (!series.length) return '<div class="chart-empty">暂无日内数据</div>';
  const width = 760, height = 150, padL = 74, padR = 18, padT = 16, padB = 28;
  const cleaned = series.filter((p) => Number.isFinite(p.value) && Number.isFinite(hourValue(p.key)));
  if (!cleaned.length) return '<div class="chart-empty">暂无日内数据</div>';
  const values = cleaned.map((p) => p.value);
  let min = Math.min(...values, 0), max = Math.max(...values, 0);
  if (min === max) { min -= 1; max += 1; }
  const plotW = width - padL - padR;
  const x = (point) => padL + Math.max(0, Math.min(24, hourValue(point.key))) / 24 * plotW;
  const y = (v) => padT + (1 - ((v - min) / (max - min))) * (height - padT - padB);
  const points = cleaned.map((p) => `${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const cls = last(cleaned).value >= 0 ? "chart-up" : "chart-down";
  const ticks = [max, (max + min) / 2, min];
  const grid = ticks.map((tick) => `<g><line class="axis-grid" x1="${padL}" x2="${width - padR}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis-label" x="8" y="${y(tick) + 4}">${compactMoney(tick)}</text></g>`).join("");
  const zero = `<line class="zero-axis subtle" x1="${padL}" x2="${width - padR}" y1="${y(0)}" y2="${y(0)}"></line><text class="zero-label" x="8" y="${Math.max(padT + 10, y(0) - 4)}">0</text>`;
  const hourLabels = hourTicks(padL, width - padR);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="当日盈亏波动">${grid}${zero}<line class="axis-line" x1="${padL}" x2="${padL}" y1="${padT}" y2="${height - padB}"></line><line class="axis-line" x1="${padL}" x2="${width - padR}" y1="${height - padB}" y2="${height - padB}"></line><polyline class="trend-line ${cls}" points="${points}"></polyline>${hourLabels.map((tick) => `<text class="axis-label hour-label" x="${tick.x}" y="${height - 6}">${tick.label}</text>`).join("")}</svg>`;
}

function moneyTicks(min, max, step = 2000) {
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = end; value >= start; value -= step) ticks.push(value);
  if (!ticks.includes(0)) ticks.push(0);
  const unique = [...new Set(ticks)].sort((a, b) => b - a);
  if (unique.length <= 7) return unique;
  return unique.filter((_, index) => index % Math.ceil(unique.length / 7) === 0 || unique[index] === 0).slice(0, 8);
}

function tradingDateLabels(series, padL, plotW) {
  const wanted = new Set([1, 3, 5]);
  const step = plotW / series.length;
  const labels = series
    .map((point, index) => ({ point, index, day: new Date(`${point.date}T00:00:00`).getDay() }))
    .filter((item) => wanted.has(item.day));
  const fallback = series.length ? [{ point: series[0], index: 0 }, { point: last(series), index: series.length - 1 }] : [];
  return (labels.length ? labels : fallback).map((item) => ({
    x: padL + item.index * step + step / 2,
    label: shortDate(item.point.date),
  }));
}

function hourValue(key) {
  const time = key.slice(11);
  const [hour, minute] = time.split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 0) + (Number.isFinite(minute) ? minute / 60 : 0);
}

function renderTrades(rows, rates) {
  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  if (!sorted.length) {
    els.tradesBody.innerHTML = '<tr><td colspan="9" class="empty-row">暂无交易记录。点击“新增记录”开始记录买入/卖出。</td></tr>';
    return;
  }

  els.tradesBody.innerHTML = sorted.map((trade) => {
    const row = rowForTrade(trade, rows);
    const currentPrice = row?.price;
    const fx = rates[trade.currency] || 1;
    const amount = trade.price * trade.qty;
    const move = Number.isFinite(currentPrice)
      ? (trade.action === "buy" ? currentPrice - trade.price : trade.price - currentPrice) * trade.qty
      : NaN;
    const moveRate = Number.isFinite(currentPrice) && trade.price ? (trade.action === "buy" ? currentPrice - trade.price : trade.price - currentPrice) / trade.price * 100 : NaN;
    const actionLabel = trade.action === "buy" ? "买入" : "卖出";
    const moveLabel = trade.action === "buy" ? "买入后" : "卖出后";
    const linkedLabel = trade.affectsHoldings ? "已联动持仓" : "历史记录";
    return `
      <tr>
        <td>${trade.date}</td>
        <td><span class="trade-pill ${trade.action}">${actionLabel}</span></td>
        <td><div class="stock-name"><strong>${trade.code}</strong><span>${trade.name || trade.sina}</span></div></td>
        <td>${money(trade.price, trade.currency)}</td>
        <td>${number(trade.qty, 0)}</td>
        <td>${money(amount, trade.currency)}</td>
        <td>
          <strong class="${classFor(move)}">${Number.isFinite(move) ? `${moveLabel} ${signed(move, trade.currency)}` : "等待行情"}</strong>
          <span class="trade-note">${pct(moveRate)} · 折人民币 ${signed(Number.isFinite(move) ? move * fx : NaN, "CNY")}</span>
        </td>
        <td>${trade.note || '<span class="muted">--</span>'}<span class="trade-note">${linkedLabel}</span></td>
        <td>
          <button class="icon-button" type="button" data-trade-edit="${trade.id}">编辑</button>
          <button class="icon-button danger" type="button" data-trade-delete="${trade.id}">删除</button>
        </td>
      </tr>
    `;
  }).join("");
}

function hourTicks(left, right) {
  return [0, 4, 8, 12, 16, 20, 24].map((hour) => ({
    x: left + hour / 24 * (right - left),
    label: `${hour}点`,
  }));
}

function shortDate(date) {
  const parts = date.split("-");
  return `${parts[1]}/${parts[2]}`;
}

function compactMoney(value) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 10000) return `${sign}${number(abs / 10000, 1)}万`;
  return `${sign}${number(abs, 0)}`;
}

function renderTable(rows) {
  const sorted = rows
    .filter((row) => row.market === currentMarket && row.status === currentPositionStatus)
    .sort((a, b) => sortValue(a, tableSort.key) === sortValue(b, tableSort.key)
      ? a.code.localeCompare(b.code)
      : (sortValue(a, tableSort.key) - sortValue(b, tableSort.key)) * (tableSort.dir === "asc" ? 1 : -1));
  els.sortButtons.forEach((button) => {
    const active = button.dataset.sortKey === tableSort.key;
    button.classList.toggle("active", active);
    button.textContent = `${button.dataset.label || button.textContent.replace(/[↑↓]/g, "").trim()}${active ? (tableSort.dir === "asc" ? " ↑" : " ↓") : ""}`;
  });
  if (!sorted.length) {
    els.body.innerHTML = `<tr><td colspan="14" class="empty-row">当前市场暂无${currentPositionStatus === "sold" ? "卖出" : "持仓"}个股。</td></tr>`;
    return;
  }
  els.body.innerHTML = sorted.map((row) => `
    <tr>
      <td><span class="badge">${row.market}</span></td>
      <td><div class="stock-name"><strong>${row.code}</strong><span>${row.name} · ${row.status === "sold" ? "已卖出" : "持有中"}</span></div></td>
      <td><strong>${money(row.costValue, row.currency)}</strong><span class="cell-sub">${money(row.cost, row.currency)} / 股 · 手续费 ${money(row.fee, row.currency)}</span></td>
      <td>${number(row.qty, 0)}</td>
      <td><strong class="price-cell">${money(row.status === "sold" ? row.livePrice : row.price, row.currency)}</strong><span class="cell-sub">${row.status === "sold" ? `实时价 · 卖出价 ${money(row.sellPrice, row.currency)}${row.sellDate ? ` · ${row.sellDate}` : ""}` : "实时/延时"}</span></td>
      <td><strong>${row.status === "sold" ? money(row.exitValue, row.currency) : money(row.marketValue, row.currency)}</strong><span class="cell-sub">${row.status === "sold" ? "卖出金额" : `折人民币 ${money(row.valueCny, "CNY")}`}</span></td>
      <td><strong class="pnl-cell ${classFor(row.pnl)}">${signed(row.pnl, row.currency)}</strong></td>
      <td><strong class="pnl-rate-cell ${classFor(row.pnlRate)}">${pct(row.pnlRate)}</strong></td>
      <td><strong class="pnl-cell day ${classFor(row.todayPnl)}">${signed(row.todayPnl, row.currency)}</strong></td>
      <td><strong class="pnl-rate-cell ${classFor(row.todayPnlRate)}">${pct(row.todayPnlRate)}</strong></td>
      <td>${row.status === "sold" ? '<span class="muted">--</span>' : `<div class="buy-zone ${row.buyZone.tone}"><strong>≤ ${money(row.buyZone.price, row.currency)}</strong><span>${row.buyZone.label} · ${row.buyZone.text}</span></div>`}</td>
      <td>${row.status === "sold" ? '<span class="muted">--</span>' : `<div class="sell-zone ${row.sellZone.tone}"><strong>≥ ${money(row.sellZone.price, row.currency)}</strong><span>${row.sellZone.label} · ${row.sellZone.text}</span></div>`}</td>
      <td class="${classFor(row.changePct)}">${pct(row.changePct)}</td>
      <td>${row.status === "sold" ? '<span class="conclusion flat">已落袋</span><span class="advice-detail">按买入价、卖出价和手续费计算</span>' : `<span class="conclusion ${row.action.conclusion === "涨" ? "up" : row.action.conclusion === "跌" ? "down" : "flat"}">未来3天：${row.action.conclusion}</span><span class="action ${row.action.type}">${row.action.label}</span><span class="advice-detail">${row.action.text}</span>`}</td>
    </tr>
  `).join("");
}

function sortValue(row, key) {
  const value = row[key];
  return Number.isFinite(value) ? value : -Infinity;
}

function renderWatchlist(quotes, histories) {
  els.watchlistDate.textContent = `更新于 ${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date())} · 分市场观察，价格和概率随行情变化`;
  const rows = watchCandidates.map((item) => {
    const quote = quotes.get(item.sina) || {};
    const history = mergeQuoteIntoHistory(histories[item.sina] || [], quote);
    const price = quote.price || last(history)?.close || NaN;
    const momentum = history.length >= 7 ? ((last(history).close - history[history.length - 7].close) / history[history.length - 7].close) * 100 : 0;
    const heat = Math.max(55, Math.min(99, Math.round(item.baseHeat + momentum * 0.8)));
    const targetPct = item.targetPct + Math.max(-0.02, Math.min(0.03, momentum / 500));
    const probability = Math.max(45, Math.min(86, Math.round(heat * 0.55 + Math.max(-8, Math.min(12, momentum)) + targetPct * 120)));
    return { ...item, price, heat, probability, target: Number.isFinite(price) ? price * (1 + targetPct) : NaN, momentum, session: quote.session || "实时/延时" };
  }).filter((row) => row.market === currentWatchMarket).sort((a, b) => b.probability - a.probability);

  els.recommendations.innerHTML = rows.map((row) => `
    <article class="recommend-card">
      <div class="recommend-top"><span class="badge">${row.market}</span><span class="heat">热度 ${row.heat} · 上涨概率 ${row.probability}%</span></div>
      <h3>${row.name}</h3>
      <p class="recommend-code">${row.code} · ${row.theme}</p>
      <div class="recommend-price">${money(row.price, row.currency)}</div>
      <dl>
        <div><dt>现价</dt><dd>${money(row.price, row.currency)} · ${row.session}</dd></div>
        <div><dt>一周目标价</dt><dd class="positive">${money(row.target, row.currency)}</dd></div>
        <div><dt>推荐原因</dt><dd>${row.reason}</dd></div>
        <div><dt>量化理由</dt><dd>近30日动量 ${pct(row.momentum)}，主题热度 ${row.heat}/100，上涨推测概率 ${row.probability}%；若跌破5日低点，观察结论自动降级。</dd></div>
      </dl>
    </article>
  `).join("") || '<div class="empty-card">当前市场暂无观察标的。</div>';
}

function resetTradeForm() {
  els.tradeForm.reset();
  els.tradeId.value = "";
  els.tradeDate.value = new Date().toISOString().slice(0, 10);
  els.tradeAction.value = "buy";
  els.tradeAffectsHoldings.checked = true;
  els.tradeMarket.value = currentMarket;
  const sample = holdings.find((item) => item.market === currentMarket) || holdings[0];
  if (sample) {
    els.tradeCurrency.value = sample.currency;
  }
}

function fillTradeForm(trade) {
  els.tradeId.value = trade.id;
  els.tradeDate.value = trade.date;
  els.tradeAction.value = trade.action;
  els.tradeMarket.value = trade.market;
  els.tradeCode.value = trade.code;
  els.tradeName.value = trade.name;
  els.tradePrice.value = Number.isFinite(trade.price) ? trade.price : "";
  els.tradeQty.value = Number.isFinite(trade.qty) ? trade.qty : "";
  els.tradeCurrency.value = trade.currency;
  els.tradeSina.value = trade.sina;
  els.tradeNote.value = trade.note;
  els.tradeAffectsHoldings.checked = trade.affectsHoldings;
  els.tradeForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function tradeFromForm() {
  const id = els.tradeId.value || `trade-${Date.now()}`;
  return {
    id,
    date: els.tradeDate.value,
    action: els.tradeAction.value,
    market: els.tradeMarket.value,
    code: els.tradeCode.value.trim(),
    name: els.tradeName.value.trim() || els.tradeCode.value.trim(),
    price: Number(els.tradePrice.value),
    qty: Number(els.tradeQty.value),
    currency: els.tradeCurrency.value,
    sina: els.tradeSina.value.trim().toLowerCase(),
    note: els.tradeNote.value.trim(),
    affectsHoldings: els.tradeAffectsHoldings.checked,
  };
}

function saveTrade(event) {
  event.preventDefault();
  const next = tradeFromForm();
  if (!next.date || !next.code || !next.sina || !Number.isFinite(next.price) || !Number.isFinite(next.qty) || next.price <= 0 || next.qty <= 0) {
    els.status.textContent = "交易记录未保存：请填写日期、代码、行情代码、价格和数量。";
    return;
  }

  const index = trades.findIndex((trade) => trade.id === next.id);
  if (index >= 0) {
    trades[index] = next;
  } else {
    trades.push(next);
  }
  trades = normalizeTrades(trades);
  persistTrades();
  rebuildLinkedHoldings();
  resetTradeForm();
  els.status.textContent = "交易记录已保存，持仓成本和数量已自动重算。备份按钮只在你想留档时使用。";
  refresh();
}

function deleteTrade(id) {
  trades = trades.filter((trade) => trade.id !== id);
  persistTrades();
  rebuildLinkedHoldings();
  els.status.textContent = "交易记录已删除，本地持仓已重新推导。";
  refresh();
}

function exportTrades() {
  const text = JSON.stringify([...trades].sort((a, b) => a.date.localeCompare(b.date)), null, 2);
  navigator.clipboard?.writeText(text).then(() => {
    els.status.textContent = "交易记录 JSON 已复制，作为备份使用。";
  }).catch(() => {
    els.status.textContent = "交易记录 JSON 已生成；如果复制失败，请从弹窗内容手动复制。";
  });
  window.prompt("交易记录备份 JSON：", text);
}

function exportHoldings() {
  const text = JSON.stringify(holdingsForExport(), null, 2);
  navigator.clipboard?.writeText(text).then(() => {
    els.status.textContent = "当前持仓 JSON 已复制，作为备份使用。";
  }).catch(() => {
    els.status.textContent = "当前持仓 JSON 已生成；如果复制失败，请从弹窗内容手动复制。";
  });
  window.prompt("当前持仓备份 JSON：", text);
}

function holdingsForExport() {
  return holdings.map((item) => {
    const row = {
      market: item.market,
      code: item.code,
      name: item.name,
      status: item.status === "sold" ? "sold" : "holding",
      cost: Number(item.cost.toFixed(4)),
      qty: Number(item.qty.toFixed(4)),
      currency: item.currency,
      sina: item.sina,
    };
    if (item.status === "sold") {
      row.sellPrice = Number(item.sellPrice.toFixed(4));
      if (item.sellDate) row.sellDate = item.sellDate;
    }
    return row;
  });
}

function resetLinkedHoldings() {
  clearLocalHoldings();
  trades = trades.map((trade) => ({ ...trade, affectsHoldings: false }));
  persistTrades();
  els.status.textContent = "已重置本地联动持仓，页面回到 GitHub holdings.json 的当前快照。";
  refresh();
}

function autofillTradeFields() {
  const code = els.tradeCode.value.trim();
  syncTradeMarketDefaults();
  if (!code) return;
  const found = holdings.find((item) => item.code.toLowerCase() === code.toLowerCase() || item.sina === code.toLowerCase());
  if (!found) {
    if (!els.tradeSina.value.trim()) els.tradeSina.value = inferSina(els.tradeMarket.value, code);
    return;
  }
  els.tradeMarket.value = found.market;
  els.tradeName.value = els.tradeName.value || found.name;
  els.tradeCurrency.value = found.currency;
  els.tradeSina.value = els.tradeSina.value || found.sina;
}

function syncTradeMarketDefaults() {
  const currencies = { "港股": "HKD", "A股": "CNY", "美股": "USD" };
  els.tradeCurrency.value = currencies[els.tradeMarket.value] || els.tradeCurrency.value;
  const code = els.tradeCode.value.trim();
  if (code && !els.tradeSina.value.trim()) els.tradeSina.value = inferSina(els.tradeMarket.value, code);
}

function inferSina(market, code) {
  const raw = code.trim();
  if (!raw) return "";
  if (/^(sh|sz|hk|gb_)/i.test(raw)) return raw.toLowerCase();
  if (market === "港股") return `hk${raw.padStart(5, "0")}`.toLowerCase();
  if (market === "美股") return `gb_${raw}`.toLowerCase();
  if (market === "A股") return `${raw.startsWith("6") ? "sh" : "sz"}${raw}`.toLowerCase();
  return raw.toLowerCase();
}

async function refresh() {
  els.refresh.disabled = true;
  els.status.textContent = "正在连接实时行情...";
  try {
    const [quotes, rates] = await Promise.all([fetchQuotes(), fetchRates()]);
    const rows = buildRows(quotes, {}, rates);
    latestRows = rows;
    latestHistories = {};
    latestIntraday = {};
    latestRates = rates;
    latestQuotes = quotes;
    renderSummary(rows, {}, {}, rates);
    renderMarketOverview(rows, {}, {}, rates);
    renderTable(rows);
    renderWatchlist(quotes, {});
    els.status.textContent = "实时盈亏已刷新，正在补充30日K线和日内波动...";

    const [histories, intraday] = await Promise.all([fetchHistory(), fetchIntraday()]);
    const liveHistories = Object.fromEntries([...holdings, ...watchCandidates].map((item) => [
      item.sina,
      mergeQuoteIntoHistory(histories[item.sina] || [], quotes.get(item.sina) || null),
    ]));
    const rowsWithHistory = buildRows(quotes, histories, rates);
    latestRows = rowsWithHistory;
    latestHistories = liveHistories;
    latestIntraday = intraday;
    latestRates = rates;
    renderSummary(rowsWithHistory, liveHistories, intraday, rates);
    renderMarketOverview(rowsWithHistory, liveHistories, intraday, rates);
    renderTable(rowsWithHistory);
    renderWatchlist(quotes, histories);
    const missing = rows.filter((row) => !Number.isFinite(row.price)).length;
    els.status.textContent = missing ? `已刷新，${missing} 只股票暂未取到实时价。` : "已刷新：实时价格、30日K线、当日波动均已更新。";
  } catch (error) {
    els.status.textContent = `刷新失败：${error.message}`;
  } finally {
    els.refresh.disabled = false;
  }
}

function renderFileMode() {
  els.status.innerHTML = `当前打开的是文件入口，实时行情需要从本地网站进入。<a class="status-link" href="${serviceUrl}">打开实时版</a>`;
  window.setTimeout(() => window.location.replace(serviceUrl), 900);
}

els.refresh.addEventListener("click", refresh);
els.tradeForm.addEventListener("submit", saveTrade);
els.resetTradeButton.addEventListener("click", resetTradeForm);
els.newTradeButton.addEventListener("click", resetTradeForm);
els.exportTradesButton.addEventListener("click", exportTrades);
els.exportHoldingsButton.addEventListener("click", exportHoldings);
els.resetLinkedHoldingsButton.addEventListener("click", resetLinkedHoldings);
els.tradeCode.addEventListener("blur", autofillTradeFields);
els.tradeMarket.addEventListener("change", syncTradeMarketDefaults);
els.tradesBody.addEventListener("click", (event) => {
  const editId = event.target.dataset.tradeEdit;
  const deleteId = event.target.dataset.tradeDelete;
  if (editId) {
    const trade = trades.find((item) => item.id === editId);
    if (trade) fillTradeForm(trade);
  }
  if (deleteId) deleteTrade(deleteId);
});
els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    currentMarket = tab.dataset.market;
    els.tabs.forEach((item) => item.classList.toggle("active", item.dataset.market === currentMarket));
    renderMarketOverview(latestRows, latestHistories, latestIntraday, latestRates);
    renderWeeklyAdvice(latestRows);
    renderTable(latestRows);
  });
});
els.positionTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    currentPositionStatus = tab.dataset.positionStatus;
    els.positionTabs.forEach((item) => item.classList.toggle("active", item.dataset.positionStatus === currentPositionStatus));
    renderTable(latestRows);
  });
});
els.watchTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    currentWatchMarket = tab.dataset.watchMarket;
    els.watchTabs.forEach((item) => item.classList.toggle("active", item.dataset.watchMarket === currentWatchMarket));
    renderWatchlist(latestQuotes, latestHistories);
  });
});
els.sortButtons.forEach((button) => {
  button.dataset.label = button.textContent.trim();
  button.addEventListener("click", () => {
    const key = button.dataset.sortKey;
    tableSort = tableSort.key === key
      ? { key, dir: tableSort.dir === "desc" ? "asc" : "desc" }
      : { key, dir: "desc" };
    renderTable(latestRows);
  });
});

if (location.protocol === "file:") {
  renderFileMode();
} else {
  Promise.all([loadHoldings(), loadTrades()])
    .then(() => {
      if (trades.some((trade) => trade.affectsHoldings)) rebuildLinkedHoldings();
      resetTradeForm();
      refresh();
    })
    .catch((error) => {
      els.refresh.disabled = true;
      els.status.textContent = `持仓数据读取失败：${error.message}`;
    });
}
