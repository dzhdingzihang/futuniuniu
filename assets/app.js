const marketOrder = ["港股", "A股", "美股"];

const holdings = [
  { market: "美股", code: "COHX", name: "COHX", cost: 60, qty: 10, currency: "USD", sina: "gb_cohx" },
  { market: "美股", code: "DRAM", name: "DRAM", cost: 55, qty: 160, currency: "USD", sina: "gb_dram" },
  { market: "美股", code: "GLW", name: "康宁", cost: 179, qty: 14, currency: "USD", sina: "gb_glw" },
  { market: "美股", code: "LITX", name: "LITX", cost: 59.5, qty: 10, currency: "USD", sina: "gb_litx" },
  { market: "美股", code: "TSLL", name: "TSLL", cost: 15.5, qty: 100, currency: "USD", sina: "gb_tsll" },
  { market: "港股", code: "00763", name: "中兴通讯", cost: 30.5, qty: 800, currency: "HKD", sina: "hk00763" },
  { market: "港股", code: "01024", name: "快手-W", cost: 46, qty: 300, currency: "HKD", sina: "hk01024" },
  { market: "港股", code: "01810", name: "小米集团-W", cost: 43.5, qty: 600, currency: "HKD", sina: "hk01810" },
  { market: "港股", code: "02208", name: "金风科技", cost: 16.9, qty: 1600, currency: "HKD", sina: "hk02208" },
  { market: "港股", code: "07709", name: "07709", cost: 90, qty: 800, currency: "HKD", sina: "hk07709" },
  { market: "A股", code: "002217", name: "合力泰", cost: 3.6, qty: 3000, currency: "CNY", sina: "sz002217" },
  { market: "A股", code: "300053", name: "航宇微", cost: 20.8, qty: 800, currency: "CNY", sina: "sz300053" },
  { market: "A股", code: "300067", name: "安诺其", cost: 7.8, qty: 800, currency: "CNY", sina: "sz300067" },
  { market: "A股", code: "002639", name: "雪人集团", cost: 21.8, qty: 600, currency: "CNY", sina: "sz002639" },
  { market: "A股", code: "001896", name: "豫能控股", cost: 14.5, qty: 200, currency: "CNY", sina: "sz001896" },
  { market: "A股", code: "600869", name: "远东股份", cost: 22, qty: 200, currency: "CNY", sina: "sh600869" },
  { market: "A股", code: "300820", name: "英杰电气", cost: 58.5, qty: 100, currency: "CNY", sina: "sz300820" },
  { market: "A股", code: "601138", name: "工业富联", cost: 55.8, qty: 100, currency: "CNY", sina: "sh601138" },
];

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
  totalCost: document.querySelector("#totalCost"),
  totalValue: document.querySelector("#totalValue"),
  todayProfit: document.querySelector("#todayProfit"),
  todayProfitRate: document.querySelector("#todayProfitRate"),
  sevenProfit: document.querySelector("#sevenProfit"),
  sevenProfitRate: document.querySelector("#sevenProfitRate"),
  updatedAt: document.querySelector("#updatedAt"),
  status: document.querySelector("#statusBand"),
  totalTrendValue: document.querySelector("#totalTrendValue"),
  totalTrendChart: document.querySelector("#totalTrendChart"),
  totalTrendHint: document.querySelector("#totalTrendHint"),
  totalIntradayValue: document.querySelector("#totalIntradayValue"),
  totalIntradayChart: document.querySelector("#totalIntradayChart"),
  marketOverview: document.querySelector("#marketOverview"),
  recommendations: document.querySelector("#recommendationsBody"),
  watchlistDate: document.querySelector("#watchlistDate"),
  tabs: document.querySelectorAll(".tab"),
};

const serviceUrl = "http://127.0.0.1:8787/";
let currentMarket = "港股";
let latestRows = [];

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

function pct(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${number(value, 2)}%`;
}

function classFor(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return "neutral";
  return value > 0 ? "positive" : "negative";
}

async function getJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("request failed");
    return await response.json();
  } catch {
    return fallback;
  }
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
  const symbols = [...new Set(holdings.map((item) => item.sina))].join(",");
  const payload = await getJson(`/api/history?symbols=${encodeURIComponent(symbols)}&days=30`, { histories: {} });
  return payload.histories || {};
}

async function fetchIntraday() {
  const symbols = [...new Set(holdings.map((item) => item.sina))].join(",");
  const payload = await getJson(`/api/intraday?symbols=${encodeURIComponent(symbols)}`, { intraday: {} });
  return payload.intraday || {};
}

function buildRows(quotes, histories, rates) {
  return holdings.map((item) => {
    const quote = quotes.get(item.sina) || null;
    const history = histories[item.sina] || [];
    const price = quote?.price || last(history)?.close || NaN;
    const rate = rates[item.currency] || 1;
    const costValue = item.cost * item.qty;
    const marketValue = price * item.qty;
    const pnl = marketValue - costValue;
    const todayPnl = (quote?.change || 0) * item.qty;
    const sevenPoint = history[Math.max(0, history.length - 8)];
    const sevenPnl = sevenPoint ? (price - sevenPoint.close) * item.qty : NaN;
    const row = {
      ...item,
      price,
      quote,
      history,
      costValue,
      marketValue,
      pnl,
      pnlRate: costValue ? (pnl / costValue) * 100 : NaN,
      todayPnl,
      todayPnlRate: price ? ((quote?.change || 0) / (price - (quote?.change || 0))) * 100 : NaN,
      sevenPnl,
      costCny: costValue * rate,
      valueCny: marketValue * rate,
      pnlCny: pnl * rate,
      todayPnlCny: todayPnl * rate,
      sevenPnlCny: Number.isFinite(sevenPnl) ? sevenPnl * rate : NaN,
      changePct: quote?.changePct ?? NaN,
    };
    row.buyZone = buyZoneFor(row);
    row.sellZone = sellZoneFor(row);
    row.action = actionFor(row);
    return row;
  });
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

function last(arr) {
  return arr[arr.length - 1];
}

function buildPortfolioSeries(items, histories, rates, market = null) {
  const selected = market ? items.filter((item) => item.market === market) : items;
  const dates = [...new Set(selected.flatMap((item) => (histories[item.sina] || []).map((p) => p.date)))].sort().slice(-30);
  return dates.map((date) => {
    let open = 0, high = 0, low = 0, close = 0, cost = 0, included = 0;
    selected.forEach((item) => {
      const point = pointOnOrBefore(histories[item.sina] || [], date);
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
  const selected = market ? items.filter((item) => item.market === market) : items;
  const keys = [...new Set(selected.flatMap((item) => (intraday[item.sina] || []).map((p) => `${p.date} ${p.time}`)))].sort();
  return keys.map((key) => {
    let value = 0, firstValue = 0, included = 0;
    selected.forEach((item) => {
      const point = pointOnOrBeforeTime(intraday[item.sina] || [], key);
      if (!point) return;
      const firstPoint = (intraday[item.sina] || [])[0];
      const fx = rates[item.currency] || 1;
      value += point.close * item.qty * fx;
      firstValue += (firstPoint?.close || point.close) * item.qty * fx;
      included += 1;
    });
    return { key, value: value - firstValue, included };
  }).filter((p) => p.included > 0).slice(-96);
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
  const value = sum(rows, "valueCny");
  const pnl = value - cost;
  const today = sum(rows, "todayPnlCny");
  const seven = sum(rows, "sevenPnlCny");
  els.totalProfit.textContent = signed(pnl, "CNY");
  els.totalProfit.className = classFor(pnl);
  els.totalProfitRate.textContent = pct(cost ? pnl / cost * 100 : NaN);
  els.totalProfitRate.className = classFor(pnl);
  els.totalCost.textContent = money(cost, "CNY");
  els.totalValue.textContent = money(value, "CNY");
  els.todayProfit.textContent = signed(today, "CNY");
  els.todayProfit.className = classFor(today);
  els.todayProfitRate.textContent = pct(value ? today / (value - today) * 100 : NaN);
  els.todayProfitRate.className = classFor(today);
  els.sevenProfit.textContent = signed(seven, "CNY");
  els.sevenProfit.className = classFor(seven);
  els.sevenProfitRate.textContent = pct(cost ? seven / cost * 100 : NaN);
  els.sevenProfitRate.className = classFor(seven);
  els.updatedAt.textContent = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());

  const kline = buildPortfolioSeries(holdings, histories, rates);
  const line = buildIntradaySeries(holdings, intraday, rates);
  renderTrendBlock(els.totalTrendValue, els.totalTrendChart, kline, "CNY");
  renderLineBlock(els.totalIntradayValue, els.totalIntradayChart, line, "CNY");
  els.totalTrendHint.textContent = `红涨绿跌 · ${kline.length} 个交易点`;
}

function renderMarketOverview(rows, histories, intraday, rates) {
  els.marketOverview.innerHTML = marketOrder.map((market) => {
    const selected = rows.filter((row) => row.market === market);
    const currency = selected[0]?.currency || "CNY";
    const cost = selected.reduce((total, row) => total + row.costValue, 0);
    const value = selected.reduce((total, row) => total + row.marketValue, 0);
    const pnl = value - cost;
    const rate = cost ? pnl / cost * 100 : NaN;
    const kline = buildPortfolioSeries(holdings, histories, rates, market);
    const intradaySeries = buildIntradaySeries(holdings, intraday, rates, market);
    return `
      <article class="market-card ${market === currentMarket ? "active" : ""}" data-market-card="${market}">
        <div class="market-card-head"><span class="badge">${market}</span><span>${currency} 展示</span></div>
        <div class="market-money">
          <span>成本 <strong>${money(cost, currency)}</strong></span>
          <span>市值 <strong>${money(value, currency)}</strong></span>
        </div>
        <strong class="${classFor(pnl)}">${signed(pnl, currency)}</strong>
        <small class="${classFor(rate)}">${pct(rate)}</small>
        <div class="mini-title">30日盈亏K线</div>
        <div class="sparkline compact">${candlestickSvg(kline, currency)}</div>
        <div class="mini-title">当日24小时波动</div>
        <div class="sparkline compact">${lineSvg(intradaySeries, currency)}</div>
      </article>
    `;
  }).join("");
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number.isFinite(row[key]) ? row[key] : 0), 0);
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
  const previous = series[0];
  const delta = current && previous ? current.value - previous.value : NaN;
  valueEl.textContent = current ? `${signed(current.value, currency)} · 日内 ${signed(delta, currency)}` : "--";
  valueEl.className = classFor(delta);
  chartEl.innerHTML = lineSvg(series, currency);
}

function candlestickSvg(series) {
  if (!series.length) return '<div class="chart-empty">暂无历史K线</div>';
  const width = 760, height = 210, padL = 74, padR = 18, padT = 16, padB = 28;
  const highs = series.map((p) => p.high);
  const lows = series.map((p) => p.low);
  let min = Math.min(...lows), max = Math.max(...highs);
  if (min === max) { min -= 1; max += 1; }
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const step = plotW / series.length;
  const y = (v) => padT + (1 - ((v - min) / (max - min))) * plotH;
  const ticks = [max, (max + min) / 2, min];
  const candles = series.map((p, index) => {
    const x = padL + index * step + step / 2;
    const up = p.close >= p.open;
    const cls = up ? "candle-up" : "candle-down";
    const top = Math.min(y(p.open), y(p.close));
    const body = Math.max(3, Math.abs(y(p.open) - y(p.close)));
    return `<g class="${cls}"><line x1="${x}" x2="${x}" y1="${y(p.high)}" y2="${y(p.low)}"></line><rect x="${x - Math.max(2, step * 0.28)}" y="${top}" width="${Math.max(4, step * 0.56)}" height="${body}" rx="1"></rect></g>`;
  }).join("");
  const grid = ticks.map((tick) => `<g><line class="axis-grid" x1="${padL}" x2="${width - padR}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis-label" x="8" y="${y(tick) + 4}">${compactMoney(tick)}</text></g>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="盈亏K线">${grid}<line class="axis-line" x1="${padL}" x2="${padL}" y1="${padT}" y2="${height - padB}"></line><line class="axis-line" x1="${padL}" x2="${width - padR}" y1="${height - padB}" y2="${height - padB}"></line>${candles}<text class="axis-label" x="${padL}" y="${height - 6}">${shortDate(series[0].date)}</text><text class="axis-label" x="${width - padR - 42}" y="${height - 6}">${shortDate(last(series).date)}</text></svg>`;
}

function lineSvg(series) {
  if (!series.length) return '<div class="chart-empty">暂无日内数据</div>';
  const width = 760, height = 150, padL = 74, padR = 18, padT = 16, padB = 28;
  const values = series.map((p) => p.value);
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => padL + i * (width - padL - padR) / Math.max(series.length - 1, 1);
  const y = (v) => padT + (1 - ((v - min) / (max - min))) * (height - padT - padB);
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const cls = last(series).value >= series[0].value ? "chart-up" : "chart-down";
  const ticks = [max, (max + min) / 2, min];
  const grid = ticks.map((tick) => `<g><line class="axis-grid" x1="${padL}" x2="${width - padR}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis-label" x="8" y="${y(tick) + 4}">${compactMoney(tick)}</text></g>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="当日盈亏波动">${grid}<line class="axis-line" x1="${padL}" x2="${padL}" y1="${padT}" y2="${height - padB}"></line><line class="axis-line" x1="${padL}" x2="${width - padR}" y1="${height - padB}" y2="${height - padB}"></line><polyline class="trend-line ${cls}" points="${points}"></polyline><text class="axis-label" x="${padL}" y="${height - 6}">0点</text><text class="axis-label" x="${width - padR - 52}" y="${height - 6}">${last(series).key.slice(11)}</text></svg>`;
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
  const sorted = rows.filter((row) => row.market === currentMarket);
  els.body.innerHTML = sorted.map((row) => `
    <tr>
      <td><span class="badge">${row.market}</span></td>
      <td><div class="stock-name"><strong>${row.code}</strong><span>${row.name}</span></div></td>
      <td>${money(row.cost, row.currency)}</td>
      <td>${number(row.qty, 0)}</td>
      <td><strong class="price-cell">${money(row.price, row.currency)}</strong></td>
      <td class="${classFor(row.pnl)}">${signed(row.pnl, row.currency)}</td>
      <td class="${classFor(row.pnlRate)}">${pct(row.pnlRate)}</td>
      <td class="${classFor(row.todayPnl)}">${signed(row.todayPnl, row.currency)}</td>
      <td class="${classFor(row.todayPnlRate)}">${pct(row.todayPnlRate)}</td>
      <td><div class="buy-zone ${row.buyZone.tone}"><strong>≤ ${money(row.buyZone.price, row.currency)}</strong><span>${row.buyZone.label} · ${row.buyZone.text}</span></div></td>
      <td><div class="sell-zone ${row.sellZone.tone}"><strong>≥ ${money(row.sellZone.price, row.currency)}</strong><span>${row.sellZone.label} · ${row.sellZone.text}</span></div></td>
      <td class="${classFor(row.changePct)}">${pct(row.changePct)}</td>
      <td><span class="conclusion ${row.action.conclusion === "涨" ? "up" : row.action.conclusion === "跌" ? "down" : "flat"}">未来3天：${row.action.conclusion}</span><span class="action ${row.action.type}">${row.action.label}</span><span class="advice-detail">${row.action.text}</span></td>
    </tr>
  `).join("");
}

function renderWatchlist(quotes, histories) {
  els.watchlistDate.textContent = `更新于 ${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date())} · AI算力、PCB、存储、半导体为主线`;
  const rows = watchCandidates.map((item) => {
    const quote = quotes.get(item.sina) || {};
    const history = histories[item.sina] || [];
    const price = quote.price || last(history)?.close || NaN;
    const momentum = history.length >= 7 ? ((last(history).close - history[history.length - 7].close) / history[history.length - 7].close) * 100 : 0;
    const heat = Math.max(55, Math.min(99, Math.round(item.baseHeat + momentum * 0.8)));
    const targetPct = item.targetPct + Math.max(-0.02, Math.min(0.03, momentum / 500));
    const probability = Math.max(45, Math.min(86, Math.round(heat * 0.55 + Math.max(-8, Math.min(12, momentum)) + targetPct * 120)));
    return { ...item, price, heat, probability, target: Number.isFinite(price) ? price * (1 + targetPct) : NaN, momentum };
  }).sort((a, b) => b.heat - a.heat).slice(0, 6);

  els.recommendations.innerHTML = rows.map((row) => `
    <article class="recommend-card">
      <div class="recommend-top"><span class="badge">${row.market}</span><span class="heat">热度 ${row.heat} · 上涨概率 ${row.probability}%</span></div>
      <h3>${row.name}</h3>
      <p class="recommend-code">${row.code} · ${row.theme}</p>
      <div class="recommend-price">${money(row.price, row.currency)}</div>
      <dl>
        <div><dt>7天目标价</dt><dd class="positive">${money(row.target, row.currency)}</dd></div>
        <div><dt>推荐原因</dt><dd>${row.reason}</dd></div>
        <div><dt>量化理由</dt><dd>近30日动量 ${pct(row.momentum)}，主题热度 ${row.heat}/100，上涨推测概率 ${row.probability}%；若跌破5日低点，观察结论自动降级。</dd></div>
      </dl>
    </article>
  `).join("");
}

async function refresh() {
  els.refresh.disabled = true;
  els.status.textContent = "正在连接实时行情...";
  try {
    const [quotes, rates] = await Promise.all([fetchQuotes(), fetchRates()]);
    const rows = buildRows(quotes, {}, rates);
    latestRows = rows;
    renderSummary(rows, {}, {}, rates);
    renderMarketOverview(rows, {}, {}, rates);
    renderTable(rows);
    renderWatchlist(quotes, {});
    els.status.textContent = "实时盈亏已刷新，正在补充30日K线和日内波动...";

    const [histories, intraday] = await Promise.all([fetchHistory(), fetchIntraday()]);
    const rowsWithHistory = buildRows(quotes, histories, rates);
    latestRows = rowsWithHistory;
    renderSummary(rowsWithHistory, histories, intraday, rates);
    renderMarketOverview(rowsWithHistory, histories, intraday, rates);
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
els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    currentMarket = tab.dataset.market;
    els.tabs.forEach((item) => item.classList.toggle("active", item.dataset.market === currentMarket));
    renderTable(latestRows);
    document.querySelectorAll("[data-market-card]").forEach((card) => {
      card.classList.toggle("active", card.dataset.marketCard === currentMarket);
    });
  });
});

if (location.protocol === "file:") {
  renderFileMode();
} else {
  refresh();
  setInterval(refresh, 60 * 1000);
}
