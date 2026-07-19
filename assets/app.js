const MARKETS = ["全部", "A股", "港股", "美股"];
const MARKET_ORDER = ["港股", "A股", "美股"];
const TRADE_KEY = "piggy-trades-v1";
const HOLDING_KEY = "piggy-linked-holdings-v1";
const WATCH_KEY = "piggy-watchlist-v1";
const MARKET_CACHE_KEY = "piggy-market-cache-v1";
const FEE_USD = 30;
// Legacy records store the buy price in native currency, but not historical FX.
// Keep invested cost fixed so a live FX refresh cannot change what was paid.
const COST_REFERENCE_RATES = { CNY: 1, HKD: 0.92, USD: 7.22 };

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
  isHistoryLoading: false
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
  return Number(item.cost) * Number(item.qty) * (COST_REFERENCE_RATES[item.currency] || 1);
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

function normalizeHolding(item) {
  const rawStatus = String(item.status || "holding").toLowerCase();
  const status = rawStatus === "sold" || rawStatus === "卖出" ? "sold" : "holding";
  return {
    market: String(item.market || "").trim(),
    code: String(item.code || "").trim(),
    name: String(item.name || item.code || "").trim(),
    cost: Number(item.cost),
    qty: Number(item.qty),
    currency: String(item.currency || "").toUpperCase(),
    purchaseCostCny: Number(item.purchaseCostCny ?? item.costCny),
    sina: String(item.sina || "").toLowerCase(),
    status: status,
    sellPrice: Number(item.sellPrice ?? item.soldPrice ?? item.exitPrice),
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
    affectsHoldings: item.affectsHoldings === true
  };
}

function activeHoldings() {
  return state.holdings.filter(function (item) { return item.status !== "sold"; });
}

function isValidHolding(item) {
  return item.market && item.code && item.sina && item.currency && Number.isFinite(item.cost) && Number.isFinite(item.qty) && item.qty > 0;
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
    const fee = FEE_USD * (state.rates.USD || 7.22);
    const pnlCny = (exitValue - costValue) * fx - fee;
    const valueCny = item.status === "sold" ? 0 : exitValue * fx;
    const todayPnlCny = item.status === "sold" ? 0 : (Number(quote && quote.change) || 0) * item.qty * fx;
    const changePct = Number(quote && quote.changePct);
    const pnlRate = costValue ? (exitValue - costValue) / costValue * 100 : 0;
    const row = Object.assign({}, item, {
      quote: quote,
      history: history,
      price: price,
      costCny: costValue * fx,
      purchaseCostCny: fixedPurchaseCost(item),
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
  if (row.status === "sold") return { action: "已完成", cls: "good", text: "已卖出记录已进入已实现盈亏。" };
  if (row.pnlRate <= -15) return { action: "复核逻辑", cls: "warn", text: "亏损较深，先核实最初买入逻辑与仓位上限，避免机械补仓。" };
  if (row.pnlRate >= 20) return { action: "分批止盈", cls: "good", text: "已有较厚浮盈，设置回撤线并分批兑现，保护盈利。" };
  if (row.changePct <= -3) return { action: "继续观察", cls: "warn", text: "当日波动放大，等待价格稳定和催化确认后再决策。" };
  if (row.changePct >= 3) return { action: "避免追高", cls: "warn", text: "短线涨幅偏快，优先观察量价持续性，避免情绪化加仓。" };
  return { action: "继续持有", cls: "good", text: "仓位与走势暂未出现需立即调整的信号，跟踪下一条基本面催化。" };
}

function filteredRows(status) {
  return state.rows.filter(function (row) {
    return (!status || row.status === status) && (state.market === "全部" || row.market === state.market);
  });
}

function summary() {
  const openRows = state.rows.filter(function (row) { return row.status !== "sold"; });
  const soldRows = state.rows.filter(function (row) { return row.status === "sold"; });
  const cost = sum(state.rows, "purchaseCostCny");
  const holdingCost = sum(openRows, "costCny");
  const soldCost = sum(soldRows, "costCny");
  const value = sum(openRows, "valueCny");
  const openPnl = sum(openRows, "pnlCny");
  const soldPnl = sum(soldRows, "pnlCny");
  const totalPnl = openPnl + soldPnl;
  const today = sum(openRows, "todayPnlCny");
  return {
    openRows: openRows, soldRows: soldRows, cost: cost, holdingCost: holdingCost, soldCost: soldCost, value: value, openPnl: openPnl, soldPnl: soldPnl,
    totalPnl: totalPnl, totalRate: cost ? totalPnl / cost * 100 : 0, today: today, todayRate: value ? today / value * 100 : 0
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
  const costCny = sum(all, "purchaseCostCny");
  const valueCny = sum(open, "valueCny");
  const pnlCny = sum(all, "pnlCny");
  const todayCny = sum(open, "todayPnlCny");
  return {
    market: market,
    open: open,
    currency: currency,
    cost: costCny,
    value: valueCny,
    today: todayCny,
    pnl: pnlCny,
    costNative: all.reduce(function (total, row) { return total + row.cost * row.qty; }, 0),
    valueNative: valueCny / fx,
    todayNative: todayCny / fx,
    pnlNative: pnlCny / fx,
    count: open.length
  };
}

function marketTabs(active, attribute) {
  return "<div class=\"tab-group\">" + MARKETS.map(function (market) {
    return "<button type=\"button\" class=\"" + (active === market ? "active" : "") + "\" data-" + attribute + "=\"" + market + "\">" + market + (market === "全部" ? "" : " <small>" + marketSummary(market).count + "</small>") + "</button>";
  }).join("") + "</div>";
}

function topNav() {
  const items = [["overview", "总览"], ["actions", "持仓行动"], ["radar", "机会雷达"], ["trades", "交易记录"], ["review", "复盘"]];
  const updateStatus = state.isRefreshing
    ? "<span class=\"market-refresh-status\"><img src=\"assets/pig-logo.png\" alt=\"\"/>小猪正在核算行情</span>"
    : "<span class=\"updated\">更新于 " + escapeHtml(state.updatedAt || "待更新") + "</span>";
  return "<header class=\"site-header\"><a class=\"brand\" href=\"#overview\"><img src=\"assets/pig-logo.png\" alt=\"猪猪投资存钱罐\"/><span><strong>猪猪投资存钱罐</strong><small>长期主义 · 让复利为你工作</small></span></a><nav class=\"global-nav\" aria-label=\"主导航\">" +
    items.map(function (item) { return "<button class=\"nav-link " + (state.tab === item[0] ? "active" : "") + "\" type=\"button\" data-tab=\"" + item[0] + "\">" + item[1] + "</button>"; }).join("") +
    "</nav><div class=\"header-tools\">" + updateStatus + "<a class=\"secondary-button\" href=\"https://github.com/dzhdingzihang/futuniuniu/edit/main/holdings.json\" target=\"_blank\" rel=\"noopener\">修改持仓</a><button class=\"icon-button\" type=\"button\" data-refresh=\"1\">刷新</button></div></header>";
}

function overviewPage() {
  const data = summary();
  return "<main class=\"page-shell\"><h1 class=\"page-title\">资产盈亏总览 · 全部市场</h1><section class=\"overview-top\"><div class=\"card asset-summary\">" +
    metric("投入成本（人民币）", money(data.cost, 0), "全部买入成交额 · 固定汇率折算", "neutral") +
    metric("持仓市值（人民币）", money(data.value, 0), "仅含当前持仓", "neutral") +
    metric("累计盈亏", signed(data.totalPnl, 0), pct(data.totalRate), tone(data.totalPnl)) +
    metric("今日盈亏", signed(data.today, 0), pct(data.todayRate), tone(data.today)) +
    "</div></section>" +
    "<section class=\"overview-main\"><article class=\"card chart-card\"><div class=\"chart-heading\"><div><h2>" + state.trendDays + "日组合累计盈亏（人民币）</h2><div class=\"chart-legend\"><span class=\"legend-item\"><i class=\"legend-dot\"></i>累计盈亏 <b class=\"" + tone(data.totalPnl) + "\">" + signed(data.totalPnl, 0) + "</b></span><span class=\"legend-item\"><i class=\"legend-dot blue\"></i>盈亏平衡线（¥0）</span></div></div><div class=\"segmented\"><button class=\"" + (state.trendDays === 7 ? "active" : "") + "\" type=\"button\" data-trend-days=\"7\">7天</button><button class=\"" + (state.trendDays === 30 ? "active" : "") + "\" type=\"button\" data-trend-days=\"30\">30天</button></div></div><div class=\"canvas-wrap\"><canvas class=\"line-chart\" data-chart=\"portfolio\"></canvas></div></article>" +
    "<aside class=\"side-stack\"><section class=\"card side-card\"><h3>市场贡献（累计盈亏）</h3>" + contributionRows() + "</section>" + rankCard() + "</aside></section>" +
    "<section class=\"card market-overview\"><h2 class=\"section-title\" style=\"grid-column:1/-1;margin-bottom:18px\">市场概览</h2>" + MARKET_ORDER.map(marketBlock).join("") + "</section></main>";
}

function metric(label, value, note, valueTone) {
  const noteClass = valueTone === "positive" ? "positive-bg" : valueTone === "negative" ? "negative-bg" : "neutral-bg";
  return "<div><span class=\"metric-label\">" + label + "</span><strong class=\"metric-value " + valueTone + "\">" + value + "</strong><span class=\"metric-note " + noteClass + "\">" + note + "</span></div>";
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
    "<div><span>投入总成本</span>" + dualMoney(data.costNative, data.currency, data.cost) + "</div>" +
    "<div><span>持仓市值</span>" + dualMoney(data.valueNative, data.currency, data.value) + "</div>" +
    "<div><span>累计盈亏</span>" + dualMoney(data.pnlNative, data.currency, data.pnl, tone(data.pnl)) + "</div>" +
    "<div><span>今日盈亏</span>" + dualMoney(data.todayNative, data.currency, data.today, tone(data.today)) + "</div>" +
    "<div><span>持仓数量</span><b>" + data.count + " 个</b><small>持有中</small></div></div></article>";
}

function rankCard() {
  const rows = state.rows.slice().sort(function (a, b) { return state.rankMode === "profit" ? b.pnlCny - a.pnlCny : a.pnlCny - b.pnlCny; }).slice(0, 5);
  return "<section class=\"card side-card leaderboard-card\"><div class=\"leaderboard-heading\"><h3>盈亏排行榜</h3><div class=\"segmented leaderboard-tabs\"><button class=\"" + (state.rankMode === "profit" ? "active" : "") + "\" type=\"button\" data-rank-mode=\"profit\">盈利 Top 5</button><button class=\"" + (state.rankMode === "loss" ? "active" : "") + "\" type=\"button\" data-rank-mode=\"loss\">亏损 Top 5</button></div></div>" +
    (rows.length ? "<div class=\"rank-list\">" + rows.map(function (row, index) {
      return "<div class=\"rank-row\"><b class=\"rank-number\">" + (index + 1) + "</b><div>" + marketLabel(row.market) + "<strong>" + escapeHtml(row.name) + "</strong><small>" + escapeHtml(row.code) + marketSuffix(row) + "</small></div><b class=\"risk-number " + tone(row.pnlCny) + "\">" + signed(row.pnlCny, 0) + "<small>" + pct(row.pnlRate) + "</small></b></div>";
    }).join("") + "</div>" : "<p class=\"section-helper\">暂无可用盈亏数据。</p>") + "</section>";
}

function actionsPage() {
  const rows = filteredRows("holding").slice().sort(function (a, b) {
    const priority = { "复核逻辑": 0, "分批止盈": 1, "避免追高": 2, "继续观察": 3, "继续持有": 4 };
    return priority[a.analysis.action] - priority[b.analysis.action] || a.pnlCny - b.pnlCny;
  });
  const priorityRows = rows.filter(function (row) { return row.analysis.action !== "继续持有"; }).slice(0, 4);
  return "<main class=\"page-shell\"><h1 class=\"page-title\">持仓行动</h1><div class=\"filter-bar\">" + marketTabs(state.market, "market") + "<span class=\"section-helper\">以人民币折算资产和盈亏；个股价格保留原币种。</span></div><section class=\"market-mini-grid\">" + MARKET_ORDER.map(miniMarket).join("") + "</section>" +
    "<section class=\"card priority-card\"><div class=\"table-heading\"><h2>优先处理</h2><p>基于持仓盈亏、日内波动、仓位占比和规则分析</p></div>" + actionTable(priorityRows, true) + "</section><section class=\"card table-card\"><div class=\"table-heading\"><h2>全部持仓</h2><p>" + rows.length + " 个持仓标的 · 按风险优先级排序</p></div>" + actionTable(rows, false) + "</section></main>";
}

function miniMarket(market) {
  const data = marketSummary(market);
  return "<article class=\"card market-mini\">" + marketLabel(market) + "<div><span>" + market + " 总市值</span><strong>" + money(data.value, 0) + "</strong></div><div><span>今日盈亏</span><p class=\"" + tone(data.today) + "\">" + signed(data.today, 0) + "</p></div><div><span>累计盈亏</span><p class=\"" + tone(data.pnl) + "\">" + signed(data.pnl, 0) + "</p></div></article>";
}

function actionTable(rows, isPriority) {
  if (!rows.length) return "<div class=\"empty\">当前筛选条件下没有需要展示的持仓。</div>";
  return "<div class=\"table-scroll\"><table><thead><tr><th>股票</th><th>市场</th><th>当前价</th><th>今日涨跌</th><th>持仓盈亏</th><th>持仓占比</th><th>最近分析</th><th>建议行动</th></tr></thead><tbody>" + rows.map(function (row) {
    return "<tr><td><span class=\"stock-name\">" + escapeHtml(row.name) + "</span><span class=\"stock-code\">" + escapeHtml(row.code) + marketSuffix(row) + "</span></td><td>" + marketLabel(row.market) + "</td><td class=\"number-cell\">" + nativeMoney(row.price, row.currency) + "</td><td class=\"number-cell " + tone(row.changePct) + "\">" + pct(row.changePct) + "</td><td class=\"number-cell " + tone(row.pnlCny) + "\">" + signed(row.pnlCny, 0) + " (" + pct(row.pnlRate) + ")</td><td>" + row.holdingPct.toFixed(2) + "%</td><td class=\"analysis-copy\" title=\"" + escapeHtml(row.analysis.text) + "\">" + escapeHtml(row.analysis.text) + "</td><td><span class=\"action-chip " + row.analysis.cls + "\">" + row.analysis.action + "</span></td></tr>";
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
  const data = summary();
  const trades = state.trades.filter(function (trade) { return state.tradeMarket === "全部" || trade.market === state.tradeMarket; }).slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
  const month = new Date().toISOString().slice(0, 7);
  const monthTrades = state.trades.filter(function (trade) { return trade.date.startsWith(month); });
  const buys = monthTrades.filter(function (trade) { return trade.action === "buy"; }).reduce(function (n, t) { return n + t.price * t.qty * (state.rates[t.currency] || 1); }, 0);
  const sells = monthTrades.filter(function (trade) { return trade.action === "sell"; }).reduce(function (n, t) { return n + t.price * t.qty * (state.rates[t.currency] || 1); }, 0);
  return "<main class=\"page-shell\"><div class=\"filter-bar\"><h1 class=\"page-title\" style=\"margin:0\">交易记录</h1><button class=\"primary-button\" type=\"button\" data-show-form=\"1\">新增交易记录</button></div><section class=\"trade-kpis\">" +
    tradeKpi("本月买入", money(buys, 0), "人民币折算") + tradeKpi("本月卖出", money(sells, 0), "人民币折算") + tradeKpi("已实现盈亏", signed(data.soldPnl, 0), "按卖出记录估算", tone(data.soldPnl)) + tradeKpi("交易次数", state.trades.length + " 次", "买卖流水") + "</section>" +
    "<section class=\"card table-card\"><div class=\"trade-toolbar\">" + marketTabs(state.tradeMarket, "trade-market") + "<div><button class=\"secondary-button\" type=\"button\" data-export=\"trades\">备份 JSON</button></div></div><div class=\"table-scroll\"><table><thead><tr><th>日期</th><th>市场</th><th>股票</th><th>操作</th><th>成交价</th><th>数量</th><th>成交额</th><th>备注</th><th></th></tr></thead><tbody>" + (trades.length ? trades.map(tradeRow).join("") : "<tr><td colspan=\"9\"><div class=\"empty\">没有匹配的交易记录。</div></td></tr>") + "</tbody></table></div></section><section class=\"card trade-form-card\" id=\"trade-form-panel\" hidden><h2>新增交易记录</h2>" + tradeForm() + "</section></main>";
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
  const holdingCost = summary().holdingCost;
  return portfolioValueSeries(days).map(function (point) { return { date: point.date, value: point.value - holdingCost }; });
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
  document.querySelector("#app").innerHTML = topNav() + page + "<footer class=\"page-footer\">数据来自公开行情接口，可能有延迟。港股以港币、美股以美元、A股以人民币展示；组合指标统一按实时汇率折算人民币。页面中的分析和观察内容仅作研究提示，不构成投资建议。</footer>";
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
  if (trade.action === "buy") {
    const tradePurchaseCost = trade.price * trade.qty * (COST_REFERENCE_RATES[trade.currency] || 1);
    if (current) {
      const priorPurchaseCost = fixedPurchaseCost(current);
      const totalQty = current.qty + trade.qty;
      current.cost = (current.cost * current.qty + trade.price * trade.qty) / totalQty;
      current.qty = totalQty;
      current.purchaseCostCny = priorPurchaseCost + tradePurchaseCost;
    } else {
      state.holdings.push({ market: trade.market, code: trade.code, name: trade.name || trade.code, cost: trade.price, qty: trade.qty, currency: trade.currency, purchaseCostCny: tradePurchaseCost, sina: trade.sina, status: "holding", sellPrice: NaN, sellDate: "" });
    }
  } else if (current) {
    current.qty = Math.max(0, current.qty - trade.qty);
    if (!current.qty) {
      current.status = "sold";
      current.sellPrice = trade.price;
      current.sellDate = trade.date;
    }
  }
  writeStorage(HOLDING_KEY, state.holdings);
}

function saveTrade(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const trade = normalizeTrade({
    id: "local-" + Date.now(),
    date: data.date, action: data.action, market: data.market, code: data.code, name: data.name,
    price: Number(data.price), qty: Number(data.qty), currency: data.currency, sina: data.sina, note: data.note, affectsHoldings: true
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
  const payload = kind === "trades" ? state.trades : state.holdings;
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
    if (event.target && event.target.id === "trade-form") { event.preventDefault(); saveTrade(event.target); }
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
  state.updatedAt = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
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
  state.baseHoldings = (Array.isArray(result[0]) ? result[0] : []).map(normalizeHolding).filter(isValidHolding);
  const linked = readStorage(HOLDING_KEY, null);
  state.holdings = Array.isArray(linked) && linked.length ? linked.map(normalizeHolding).filter(isValidHolding) : state.baseHoldings.slice();
  const localTrades = readStorage(TRADE_KEY, null);
  state.trades = (Array.isArray(localTrades) ? localTrades : (Array.isArray(result[1]) ? result[1] : [])).map(normalizeTrade);
  readMarketCache();
  rebuildRows();
  eventHandlers();
  render();
  refreshData();
}

start().catch(function (error) {
  document.querySelector("#app").innerHTML = "<main class=\"loading-screen\"><div class=\"error\">页面初始化失败：" + escapeHtml(error.message) + "。请刷新重试。</div></main>";
});
