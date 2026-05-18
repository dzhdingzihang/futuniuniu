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

const recommendations = [
  {
    market: "美股",
    code: "NVDA",
    name: "英伟达",
    currency: "USD",
    sina: "gb_nvda",
    theme: "AI算力 / GPU",
    reason: "AI基础设施仍是美股最强主线之一，适合跟踪龙头是否继续放量突破。",
    trigger: "站稳近几日高点且成交放大时关注；若高开低走，等回踩再看。",
    risk: "估值和预期都高，财报或出口限制消息会放大波动。",
  },
  {
    market: "美股",
    code: "AVGO",
    name: "博通",
    currency: "USD",
    sina: "gb_avgo",
    theme: "AI网络 / 定制芯片",
    reason: "AI服务器网络、ASIC和数据中心需求具备景气支撑，走势通常比小票更稳。",
    trigger: "回踩不破关键均线后转强，可作为右侧观察对象。",
    risk: "若AI硬件链集体退潮，容易跟随板块调整。",
  },
  {
    market: "港股",
    code: "00981",
    name: "中芯国际",
    currency: "HKD",
    sina: "hk00981",
    theme: "国产半导体",
    reason: "港股半导体受国产算力替代和AI芯片代工预期带动，弹性较强。",
    trigger: "放量站回短期平台上沿再关注，避免追单一日急涨。",
    risk: "行业周期、制裁消息和扩产节奏都会影响估值。",
  },
  {
    market: "港股",
    code: "01810",
    name: "小米集团-W",
    currency: "HKD",
    sina: "hk01810",
    theme: "AI终端 / 汽车",
    reason: "手机、IoT、汽车多线叙事叠加，港股科技修复时容易成为资金锚点。",
    trigger: "回踩后重新收复前高，或恒生科技指数同步转强时关注。",
    risk: "汽车交付、毛利率和供应链消息会带来短线扰动。",
  },
  {
    market: "A股",
    code: "601138",
    name: "工业富联",
    currency: "CNY",
    sina: "sh601138",
    theme: "AI服务器 / 算力制造",
    reason: "AI服务器和算力产业链景气度高，且与你现有持仓相关，便于跟踪加减仓节奏。",
    trigger: "强势股不追急拉，等盘中回踩承接或放量突破后再观察。",
    risk: "涨幅大时资金兑现会很快，补仓要分批。",
  },
  {
    market: "A股",
    code: "300308",
    name: "中际旭创",
    currency: "CNY",
    sina: "sz300308",
    theme: "CPO / 光模块",
    reason: "光模块仍是AI算力链中弹性最高的方向之一，适合作为风向标观察。",
    trigger: "板块共振上涨且个股不破分时均价时关注，弱于板块则放弃。",
    risk: "高景气已被充分交易，回撤可能很快。",
  },
];

const els = {
  body: document.querySelector("#holdingsBody"),
  refresh: document.querySelector("#refreshButton"),
  totalProfit: document.querySelector("#totalProfit"),
  totalProfitRate: document.querySelector("#totalProfitRate"),
  totalCost: document.querySelector("#totalCost"),
  totalValue: document.querySelector("#totalValue"),
  updatedAt: document.querySelector("#updatedAt"),
  status: document.querySelector("#statusBand"),
  recommendations: document.querySelector("#recommendationsBody"),
  tabs: document.querySelectorAll(".tab"),
};

let currentMarket = "全部";
let latestRows = [];
const serviceUrl = "http://127.0.0.1:8787/";
const localUrl = location.protocol === "file:" ? serviceUrl : `${location.origin}/`;

function money(value, currency = "CNY", digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function number(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function signed(value, currency) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${money(value, currency)}`;
}

function pct(value) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${number(value, 2)}%`;
}

function classFor(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function normalizePrice(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

async function fetchQuotes() {
  const symbols = [...new Set([...holdings, ...recommendations].map((item) => item.sina))].join(",");
  const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("本地行情服务不可用");
  const payload = await response.json();
  const map = new Map();

  Object.entries(payload.quotes || {}).forEach(([symbol, quote]) => {
    if (normalizePrice(quote.price)) map.set(symbol, quote);
  });

  return map;
}

function buyZoneFor(row) {
  if (!row.quote) {
    return {
      price: NaN,
      label: "等价格",
      text: "取到实时价后再计算",
      tone: "neutral",
    };
  }

  let target;
  let label;
  let text;

  if (row.pnlRate <= -25) {
    target = row.price * 0.95;
    label = "只看止跌";
    text = "深套不急补，先等跌势放缓";
  } else if (row.pnlRate <= -10) {
    target = Math.min(row.cost * 0.92, row.price * 0.97);
    label = "分批试探";
    text = "低于参考价且缩量企稳再看";
  } else if (row.pnlRate < 8) {
    target = row.price * 0.96;
    label = "轻仓低吸";
    text = "回落到参考价附近再分批";
  } else {
    target = row.price * 0.9;
    label = "不追高";
    text = "等明显回踩，优先保护利润";
  }

  return {
    price: target,
    label,
    text,
    tone: row.pnlRate <= -10 ? "negative" : row.pnlRate >= 8 ? "positive" : "neutral",
  };
}

function sellZoneFor(row) {
  if (!row.quote) {
    return {
      price: NaN,
      label: "等价格",
      text: "取到实时价后再计算",
      tone: "neutral",
    };
  }

  let target;
  let label;
  let text;

  if (row.pnlRate >= 30) {
    target = row.price * 1.03;
    label = "分批止盈";
    text = "冲高到参考价附近先锁利润";
  } else if (row.pnlRate >= 12) {
    target = Math.max(row.cost * 1.22, row.price * 1.06);
    label = "目标止盈";
    text = "到位可卖出 25%-40%";
  } else if (row.pnlRate >= 0) {
    target = Math.max(row.cost * 1.12, row.price * 1.08);
    label = "耐心等涨";
    text = "未到目标前用成本线保护";
  } else if (row.pnlRate <= -20) {
    target = row.cost * 0.9;
    label = "反弹减仓";
    text = "反弹到参考价附近先降风险";
  } else {
    target = row.cost * 1.03;
    label = "回本减压";
    text = "接近回本可先减一部分";
  }

  return {
    price: target,
    label,
    text,
    tone: row.pnlRate >= 8 ? "positive" : row.pnlRate < 0 ? "negative" : "neutral",
  };
}

async function fetchRates() {
  const fallback = { CNY: 1, USD: 7.22, HKD: 0.92 };

  try {
    const response = await fetch("/api/rates", { cache: "no-store" });
    if (!response.ok) throw new Error("汇率接口不可用");
    const data = await response.json();
    return {
      CNY: 1,
      USD: Number(data.rates.USD_CNY),
      HKD: Number(data.rates.HKD_CNY),
    };
  } catch {
    return fallback;
  }
}

function actionFor(row) {
  if (!row.quote) {
    return {
      type: "hold",
      label: "先核对代码",
      text: "暂时没有取到实时价格，先确认代码或市场后再做判断。",
    };
  }

  if (row.pnlRate <= -25) {
    return {
      type: "stop",
      label: "控制风险",
      text: "浮亏较深，先看基本面和止损线；不建议只因为便宜就补仓。",
    };
  }

  if (row.pnlRate <= -10) {
    return {
      type: "hold",
      label: "观察修复",
      text: "处于明显浮亏，若趋势转强可分批处理，否则以降低仓位波动为主。",
    };
  }

  if (row.pnlRate >= 30) {
    return {
      type: "trim",
      label: "分批止盈",
      text: "浮盈较高，可以考虑分批锁定利润，保留一部分跟随趋势。",
    };
  }

  if (row.pnlRate >= 12) {
    return {
      type: "trim",
      label: "提高止盈线",
      text: "已有不错浮盈，适合把止盈线抬高，避免盈利大幅回吐。",
    };
  }

  if (row.changePct <= -4 && row.pnlRate > -8) {
    return {
      type: "buy",
      label: "等企稳",
      text: "日内回落较大但总体可控，可以等企稳信号后再考虑分批加减。",
    };
  }

  return {
    type: "hold",
    label: "继续持有",
    text: "盈亏处于中性区间，按原计划持有，重点关注仓位和趋势变化。",
  };
}

function buildRows(quotes, rates) {
  return holdings.map((item) => {
    const quote = quotes.get(item.sina) || null;
    const price = quote?.price ?? NaN;
    const costValue = item.cost * item.qty;
    const marketValue = price * item.qty;
    const pnl = marketValue - costValue;
    const pnlRate = (pnl / costValue) * 100;
    const rate = rates[item.currency] || 1;

    const row = {
      ...item,
      quote,
      displayName: item.name,
      price,
      costValue,
      marketValue,
      pnl,
      pnlRate,
      costCny: costValue * rate,
      valueCny: Number.isFinite(marketValue) ? marketValue * rate : NaN,
      pnlCny: Number.isFinite(pnl) ? pnl * rate : NaN,
      changePct: quote?.changePct ?? NaN,
    };

    row.buyZone = buyZoneFor(row);
    row.sellZone = sellZoneFor(row);
    row.action = actionFor(row);
    return row;
  });
}

function buildRecommendationRows(quotes) {
  return recommendations.map((item) => {
    const quote = quotes.get(item.sina) || null;
    return {
      ...item,
      quote,
      price: quote?.price ?? NaN,
      changePct: quote?.changePct ?? NaN,
    };
  });
}

function renderSummary(rows) {
  const valid = rows.filter((row) => Number.isFinite(row.valueCny));
  const totalCost = valid.reduce((sum, row) => sum + row.costCny, 0);
  const totalValue = valid.reduce((sum, row) => sum + row.valueCny, 0);
  const totalPnl = totalValue - totalCost;
  const totalRate = totalCost ? (totalPnl / totalCost) * 100 : NaN;

  els.totalProfit.textContent = signed(totalPnl, "CNY");
  els.totalProfit.className = classFor(totalPnl);
  els.totalProfitRate.textContent = pct(totalRate);
  els.totalProfitRate.className = classFor(totalRate);
  els.totalCost.textContent = money(totalCost, "CNY");
  els.totalValue.textContent = money(totalValue, "CNY");
  els.updatedAt.textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());

  const missing = rows.length - valid.length;
  els.status.textContent = missing
    ? `已刷新，可计算 ${valid.length} 只；${missing} 只暂未取到实时价格，请核对代码或等待行情源恢复。`
    : `已刷新 ${valid.length} 只持仓，顶部总盈亏已按人民币换算。`;
}

function renderTable(rows) {
  const visible = currentMarket === "全部" ? rows : rows.filter((row) => row.market === currentMarket);

  els.body.innerHTML = visible
    .map((row) => {
      const today = row.changePct;
      return `
        <tr>
          <td><span class="badge">${row.market}</span></td>
          <td>
            <div class="stock-name">
              <strong>${row.displayName}</strong>
              <span>${row.code} · ${row.sina}</span>
            </div>
          </td>
          <td>${money(row.cost, row.currency)}</td>
          <td>${number(row.qty, 0)}</td>
          <td>${money(row.price, row.currency)}</td>
          <td>
            <div class="buy-zone ${row.buyZone.tone}">
              <strong>${Number.isFinite(row.buyZone.price) ? `≤ ${money(row.buyZone.price, row.currency)}` : "--"}</strong>
              <span>${row.buyZone.label} · ${row.buyZone.text}</span>
            </div>
          </td>
          <td>
            <div class="sell-zone ${row.sellZone.tone}">
              <strong>${Number.isFinite(row.sellZone.price) ? `≥ ${money(row.sellZone.price, row.currency)}` : "--"}</strong>
              <span>${row.sellZone.label} · ${row.sellZone.text}</span>
            </div>
          </td>
          <td>${money(row.marketValue, row.currency)}</td>
          <td class="${classFor(row.pnl)}">${signed(row.pnl, row.currency)}</td>
          <td class="${classFor(row.pnlRate)}">${pct(row.pnlRate)}</td>
          <td class="${classFor(today)}">${pct(today)}</td>
          <td>
            <span class="action ${row.action.type}">${row.action.label}</span><br />
            <span class="advice-detail">${row.action.text}</span>
            <span class="advice-detail">仓位节奏：单次补仓不超过计划资金的 25%，优先等收盘价确认。</span>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderRecommendations(rows) {
  els.recommendations.innerHTML = rows
    .map((row) => `
      <article class="recommend-card">
        <div class="recommend-top">
          <span class="badge">${row.market}</span>
          <span class="${classFor(row.changePct)}">${pct(row.changePct)}</span>
        </div>
        <h3>${row.name}</h3>
        <p class="recommend-code">${row.code} · ${row.theme}</p>
        <div class="recommend-price">${money(row.price, row.currency)}</div>
        <dl>
          <div>
            <dt>关注逻辑</dt>
            <dd>${row.reason}</dd>
          </div>
          <div>
            <dt>触发条件</dt>
            <dd>${row.trigger}</dd>
          </div>
          <div>
            <dt>主要风险</dt>
            <dd>${row.risk}</dd>
          </div>
        </dl>
      </article>
    `)
    .join("");
}

async function refresh() {
  els.refresh.disabled = true;
  els.status.textContent = "正在连接实时行情...";

  try {
    const [quotes, rates] = await Promise.all([fetchQuotes(), fetchRates()]);
    latestRows = buildRows(quotes, rates);
    renderSummary(latestRows);
    renderTable(latestRows);
    renderRecommendations(buildRecommendationRows(quotes));
  } catch (error) {
    els.status.textContent = `行情刷新失败：${error.message}。请检查网络，或稍后再打开页面。`;
    latestRows = buildRows(new Map(), { CNY: 1, USD: 7.22, HKD: 0.92 });
    renderSummary(latestRows);
    renderTable(latestRows);
    renderRecommendations(buildRecommendationRows(new Map()));
  } finally {
    els.refresh.disabled = false;
  }
}

function renderFileMode() {
  latestRows = buildRows(new Map(), { CNY: 1, USD: 7.22, HKD: 0.92 });
  renderTable(latestRows);
  renderRecommendations(buildRecommendationRows(new Map()));

  els.totalProfit.textContent = "--";
  els.totalProfit.className = "neutral";
  els.totalProfitRate.textContent = "等待本地网站";
  els.totalProfitRate.className = "neutral";
  els.totalCost.textContent = "--";
  els.totalValue.textContent = "--";
  els.updatedAt.textContent = "--";
  els.refresh.disabled = true;
  els.status.innerHTML = `
    当前打开的是文件入口，实时行情需要从本地网站进入。
    <a class="status-link" href="${serviceUrl}">点这里打开实时版</a>
    <span class="status-note">正在自动跳转...</span>
  `;

  window.setTimeout(() => {
    window.location.replace(serviceUrl);
  }, 900);
}

async function guideFileMode() {
  if (location.protocol !== "file:") return;

  try {
    const response = await fetch(localUrl, { method: "HEAD", cache: "no-store" });
    if (response.ok) {
      els.status.innerHTML = `当前是文件模式，实时行情可能被拦截。<a href="${localUrl}">点这里用本地网站打开</a>。`;
    }
  } catch {
    els.status.textContent = "当前是文件模式，实时行情可能拿不到。请双击“打开网站.command”启动本地网站。";
  }
}

els.refresh.addEventListener("click", refresh);
els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    els.tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    currentMarket = tab.dataset.market;
    renderTable(latestRows);
  });
});

if (location.protocol === "file:") {
  renderFileMode();
} else {
  guideFileMode();
  refresh();
  setInterval(refresh, 60 * 1000);
}
