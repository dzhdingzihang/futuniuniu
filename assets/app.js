const MARKETS = ["全部", "A股", "港股", "美股"];
const MARKET_ORDER = ["港股", "A股", "美股"];
const TRADE_KEY = "piggy-trades-v1";
const HOLDING_KEY = "piggy-linked-holdings-v1";
const WATCH_KEY = "piggy-watchlist-v1";
const FEE_USD = 30;

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
  baseHoldings: [],
  holdings: [],
  trades: [],
  rows: [],
  quotes: new Map(),
  histories: {},
  rates: { CNY: 1, HKD: 0.92, USD: 7.22 },
  saved: readStorage(WATCH_KEY, []),
  updatedAt: ""
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

function getJson(url, fallback) {
  return fetch(url, { cache: "no-store" }).then(function (response) {
    if (!response.ok) throw new Error(response.status + " " + response.statusText);
    return response.json();
  }).catch(function () { return fallback; });
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
  const cost = sum(state.rows, "costCny");
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
  return {
    market: market,
    open: open,
    value: sum(open, "valueCny"),
    today: sum(open, "todayPnlCny"),
    pnl: sum(all, "pnlCny"),
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
  return "<header class=\"site-header\"><a class=\"brand\" href=\"#overview\"><img src=\"assets/pig-logo.png\" alt=\"猪猪投资存钱罐\"/><span><strong>猪猪投资存钱罐</strong><small>长期主义 · 让复利为你工作</small></span></a><nav class=\"global-nav\" aria-label=\"主导航\">" +
    items.map(function (item) { return "<button class=\"nav-link " + (state.tab === item[0] ? "active" : "") + "\" type=\"button\" data-tab=\"" + item[0] + "\">" + item[1] + "</button>"; }).join("") +
    "</nav><div class=\"header-tools\"><span class=\"updated\">更新于 " + escapeHtml(state.updatedAt || "--") + "</span><a class=\"secondary-button\" href=\"https://github.com/dzhdingzihang/futuniuniu/edit/main/holdings.json\" target=\"_blank\" rel=\"noopener\">修改持仓</a><button class=\"icon-button\" type=\"button\" data-refresh=\"1\">刷新</button></div></header>";
}

function overviewPage() {
  const data = summary();
  const lossRows = data.openRows.slice().sort(function (a, b) { return a.pnlCny - b.pnlCny; });
  const topLoss = lossRows[0];
  const total = data.value || 1;
  const concentration = data.openRows.slice().sort(function (a, b) { return b.valueCny - a.valueCny; }).slice(0, 5).reduce(function (n, row) { return n + row.valueCny; }, 0) / total * 100;
  const attention = Math.min(3, data.openRows.filter(function (row) { return row.analysis.action !== "继续持有"; }).length);
  return "<main class=\"page-shell\"><h1 class=\"page-title\">资产盈亏总览 · 全部市场</h1><section class=\"overview-top\"><div class=\"card asset-summary\">" +
    metric("持仓市值（人民币）", money(data.value, 0), "仅含当前持仓", "neutral") +
    metric("今天盈亏", signed(data.today, 0), pct(data.todayRate), tone(data.today)) +
    metric("累计盈亏", signed(data.totalPnl, 0), pct(data.totalRate), tone(data.totalPnl)) +
    "</div><aside class=\"card decision-callout\"><span>今日优先处理 <b class=\"count-dot\">" + attention + "</b> 项</span><strong>先看持仓信号与风险提醒</strong><p>按盈亏、波动和仓位集中度生成。</p><button class=\"primary-button\" type=\"button\" data-tab=\"actions\">去处理</button></aside></section>" +
    "<section class=\"overview-main\"><article class=\"card chart-card\"><div class=\"chart-heading\"><div><h2>30日组合累计盈亏（人民币）</h2><div class=\"chart-legend\"><span class=\"legend-item\"><i class=\"legend-dot\"></i>累计盈亏 <b class=\"" + tone(data.totalPnl) + "\">" + signed(data.totalPnl, 0) + "</b></span><span class=\"legend-item\"><i class=\"legend-dot blue\"></i>盈亏平衡线</span></div></div><div class=\"segmented\"><button>7天</button><button class=\"active\">30天</button><button>90天</button></div></div><div class=\"canvas-wrap\"><canvas class=\"line-chart\" data-chart=\"portfolio\"></canvas></div></article>" +
    "<aside class=\"side-stack\"><section class=\"card side-card\"><h3>市场贡献（累计盈亏）</h3>" + contributionRows() + "</section><section class=\"card side-card\"><h3>最大亏损贡献</h3>" + (topLoss ? "<div class=\"key-risk\">" + marketLabel(topLoss.market) + "<span><strong>" + escapeHtml(topLoss.name) + "</strong><small>" + escapeHtml(topLoss.code) + "</small></span><b class=\"risk-number " + tone(topLoss.pnlCny) + "\">" + signed(topLoss.pnlCny, 0) + "</b></div>" : "<p class=\"section-helper\">暂无持仓</p>") + "</section><section class=\"card side-card\"><h3>集中度风险</h3><div class=\"concentration\"><b class=\"ring-value\">" + concentration.toFixed(0) + "%</b><p>前 5 大持仓占比 <b>" + concentration.toFixed(2) + "%</b><br/><span class=\"section-helper\">" + (concentration > 60 ? "偏高，建议分散配置" : "集中度在可关注范围内") + "</span></p></div></section></aside></section>" +
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
  return "<article class=\"market-block\"><div class=\"market-head\">" + marketLabel(market) + "<span>" + market + "</span></div><div class=\"market-kpis\"><div><span>资产（人民币）</span><b>" + money(data.value, 0) + "</b></div><div><span>今日盈亏</span><b class=\"" + tone(data.today) + "\">" + signed(data.today, 0) + "</b></div><div><span>持仓数量</span><b>" + data.count + "</b></div></div></article>";
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

function portfolioSeries() {
  const holdingCost = summary().holdingCost;
  return portfolioValueSeries().map(function (value) { return value - holdingCost; });
}

function portfolioValueSeries() {
  const rows = activeHoldings();
  const dayCount = Math.max.apply(null, rows.map(function (row) { return (state.histories[row.sina] || []).length; }).concat([30]));
  const values = [];
  for (let i = 0; i < dayCount; i += 1) {
    let value = 0;
    rows.forEach(function (row) {
      const history = state.histories[row.sina] || [];
      const offset = Math.max(0, history.length - dayCount + i);
      const point = history[offset];
      const price = point && Number(point.close) > 0 ? Number(point.close) : row.cost;
      value += price * row.qty * (state.rates[row.currency] || 1);
    });
    values.push(value);
  }
  return values;
}

function calculateDrawdown(values) {
  let peak = values[0] || 0, max = 0;
  values.forEach(function (value) { peak = Math.max(peak, value); if (peak) max = Math.max(max, (peak - value) / peak * 100); });
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
    const series = portfolioSeries();
    const baseline = series.map(function () { return 0; });
    const all = series.concat(baseline);
    let min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    if (min === max) { min *= 0.97; max *= 1.03; }
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#e9eef6";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = padding + (height - padding * 2) / 3 * i;
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
    }
    function line(values, color, fill) {
      ctx.beginPath();
      values.forEach(function (value, index) {
        const x = padding + (width - padding * 2) * index / Math.max(1, values.length - 1);
        const y = height - padding - (value - min) / (max - min) * (height - padding * 2);
        index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.stroke();
      if (fill) {
        const finalX = width - padding;
        ctx.lineTo(finalX, height - padding); ctx.lineTo(padding, height - padding); ctx.closePath();
        ctx.fillStyle = "rgba(255,75,75,.08)"; ctx.fill();
      }
    }
    line(baseline, "#2169f3", false);
    line(series, "#ff4b4b", true);
  });
}

function applyTrade(trade) {
  if (!trade.affectsHoldings) return;
  const current = state.holdings.find(function (item) { return item.status !== "sold" && item.sina === trade.sina; });
  if (trade.action === "buy") {
    if (current) {
      const totalQty = current.qty + trade.qty;
      current.cost = (current.cost * current.qty + trade.price * trade.qty) / totalQty;
      current.qty = totalQty;
    } else {
      state.holdings.push({ market: trade.market, code: trade.code, name: trade.name || trade.code, cost: trade.price, qty: trade.qty, currency: trade.currency, sina: trade.sina, status: "holding", sellPrice: NaN, sellDate: "" });
    }
  } else if (current) {
    current.qty = Math.max(0, current.qty - trade.qty);
    if (!current.qty) state.holdings = state.holdings.filter(function (item) { return item !== current; });
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
    if (["overview", "actions", "radar", "trades", "review"].includes(tab)) { state.tab = tab; render(); }
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

async function refreshData() {
  document.querySelector("#app").innerHTML = topNav() + "<main class=\"loading-screen\">正在刷新实时行情…</main>";
  const symbols = Array.from(new Set(state.holdings.concat(candidates).map(function (item) { return item.sina; }).filter(Boolean))).join(",");
  const result = await Promise.all([
    getJson("/api/quotes?symbols=" + encodeURIComponent(symbols), { quotes: {} }),
    getJson("/api/history?symbols=" + encodeURIComponent(symbols) + "&days=30", { histories: {} }),
    getJson("/api/rates", { rates: { USD_CNY: 7.22, HKD_CNY: 0.92 } })
  ]);
  state.quotes = new Map(Object.entries(result[0].quotes || {}));
  state.histories = result[1].histories || {};
  state.rates = { CNY: 1, USD: Number(result[2].rates && result[2].rates.USD_CNY) || 7.22, HKD: Number(result[2].rates && result[2].rates.HKD_CNY) || 0.92 };
  state.updatedAt = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  rebuildRows();
  render();
}

async function start() {
  const result = await Promise.all([getJson("holdings.json", []), getJson("trades.json", [])]);
  state.baseHoldings = (Array.isArray(result[0]) ? result[0] : []).map(normalizeHolding).filter(isValidHolding);
  const linked = readStorage(HOLDING_KEY, null);
  state.holdings = Array.isArray(linked) && linked.length ? linked.map(normalizeHolding).filter(isValidHolding) : state.baseHoldings.slice();
  const localTrades = readStorage(TRADE_KEY, null);
  state.trades = (Array.isArray(localTrades) ? localTrades : (Array.isArray(result[1]) ? result[1] : [])).map(normalizeTrade);
  eventHandlers();
  await refreshData();
}

start().catch(function (error) {
  document.querySelector("#app").innerHTML = "<main class=\"loading-screen\"><div class=\"error\">页面初始化失败：" + escapeHtml(error.message) + "。请刷新重试。</div></main>";
});
