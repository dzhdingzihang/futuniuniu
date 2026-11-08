const EASTMONEY_KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const TENCENT_KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const INDEX_ALIASES = {
  idx_csi300: { eastmoney: ["1.000300"], yahoo: "000300.SS" },
  idx_hsi: { eastmoney: ["100.HSI"], yahoo: "^HSI" },
  idx_sp500: { eastmoney: ["100.SPX"], yahoo: "^GSPC" },
};

function isIndexAlias(symbol) {
  return Object.prototype.hasOwnProperty.call(INDEX_ALIASES, symbol);
}

function secidsFor(symbol) {
  if (isIndexAlias(symbol)) return INDEX_ALIASES[symbol].eastmoney;
  if (symbol.startsWith("sh")) return [`1.${symbol.slice(2)}`];
  if (symbol.startsWith("sz")) return [`0.${symbol.slice(2)}`];
  if (symbol.startsWith("hk")) return [`116.${symbol.slice(2)}`];
  if (symbol.startsWith("gb_")) {
    const code = symbol.slice(3).toUpperCase();
    return [`105.${code}`, `106.${code}`, `107.${code}`];
  }
  return [];
}

function parseKlines(payload, days) {
  const klines = payload?.data?.klines || [];
  return klines
    .map((line) => {
      const parts = line.split(",");
      const close = Number(parts[2]);
      const open = Number(parts[1]);
      const high = Number(parts[3]);
      const low = Number(parts[4]);
      const openPrice = Number.isFinite(open) && open > 0 ? open : close;
      const highPrice = Number.isFinite(high) && high > 0 ? high : close;
      const lowPrice = Number.isFinite(low) && low > 0 ? low : close;
      return Number.isFinite(close) && close > 0 ? {
        date: parts[0],
        time: "",
        open: openPrice,
        high: Math.max(highPrice, openPrice, close),
        low: Math.min(lowPrice, openPrice, close),
        close,
      } : null;
    })
    .filter(Boolean)
    .slice(-days);
}

function yahooSymbol(symbol) {
  if (isIndexAlias(symbol)) return INDEX_ALIASES[symbol].yahoo;
  if (symbol.startsWith("sh")) return `${symbol.slice(2)}.SS`;
  if (symbol.startsWith("sz")) return `${symbol.slice(2)}.SZ`;
  if (symbol.startsWith("hk")) return `${symbol.slice(2).replace(/^0+/, "").padStart(4, "0")}.HK`;
  if (symbol.startsWith("gb_")) return symbol.slice(3).toUpperCase();
  return null;
}

function parseYahooPayload(payload, days) {
  const result = payload?.chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const opens = result.indicators?.quote?.[0]?.open || [];
  const highs = result.indicators?.quote?.[0]?.high || [];
  const lows = result.indicators?.quote?.[0]?.low || [];

  return timestamps
    .map((timestamp, index) => {
      const close = closes[index];
      if (!close || close <= 0) return null;
      const open = opens[index] || close;
      const high = highs[index] || close;
      const low = lows[index] || close;
      return {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        time: "",
        open,
        high: Math.max(high, open, close),
        low: Math.min(low, open, close),
        close,
      };
    })
    .filter(Boolean)
    .slice(-days);
}

function tencentKeysFor(symbol) {
  if (symbol.startsWith("sh") || symbol.startsWith("sz") || symbol.startsWith("hk")) {
    return [symbol.toLowerCase()];
  }
  if (symbol.startsWith("gb_")) {
    const code = symbol.slice(3).toUpperCase();
    return [`us${code}.OQ`, `us${code}.N`, `us${code}.A`];
  }
  return [];
}

function tencentSecurityPayload(payload, key) {
  const data = payload?.data;
  if (!data || typeof data !== "object") return null;
  if (data[key]) return data[key];
  const matchingKey = Object.keys(data).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return matchingKey ? data[matchingKey] : null;
}

function parseTencentPayload(payload, key, days) {
  const security = tencentSecurityPayload(payload, key);
  const rows = security?.qfqday || security?.day || [];
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      if (!Array.isArray(row) || row.length < 5) return null;
      const [date, rawOpen, rawClose, rawHigh, rawLow] = row;
      const open = Number(rawOpen);
      const close = Number(rawClose);
      const high = Number(rawHigh);
      const low = Number(rawLow);
      const validDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
      const validPrices = [open, close, high, low].every((price) => Number.isFinite(price) && price > 0);
      if (!validDate || !validPrices || high < Math.max(open, close) || low > Math.min(open, close) || low > high) {
        return null;
      }
      return { date, time: "", open, high, low, close };
    })
    .filter(Boolean)
    .slice(-days);
}

async function fetchTencentKey(key, days, fetcher) {
  const url = new URL(TENCENT_KLINE_URL);
  url.searchParams.set("param", `${key},day,,,${Math.max(days + 10, 80)},qfq`);
  const response = await fetcher(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://gu.qq.com/",
    },
    cf: { cacheTtl: 0 },
  });
  return parseTencentPayload(await response.json(), key, days);
}

async function fetchYahooHistory(symbol, days, fetcher) {
  const mapped = yahooSymbol(symbol);
  if (!mapped) return { series: [] };
  const range = days > 500 ? "5y" : days > 120 ? "2y" : "6mo";
  const response = await fetcher(`${YAHOO_CHART_URL}${encodeURIComponent(mapped)}?range=${range}&interval=1d`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cf: { cacheTtl: 0 },
  });
  const payload = await response.json();
  return {
    series: parseYahooPayload(payload, days),
    firstTradeTime: payload?.chart?.result?.[0]?.meta?.firstTradeDate,
  };
}

async function fetchEastmoneyHistory(secid, days, fetcher) {
  const url = new URL(EASTMONEY_KLINE_URL);
  for (const [key, value] of Object.entries({
    secid, fields1: "f1,f2,f3,f4,f5", fields2: "f51,f52,f53,f54,f55",
    klt: "101", fqt: "1", end: "20500101", lmt: String(Math.max(days + 10, 45)),
  })) url.searchParams.set(key, value);
  const response = await fetcher(url, { headers: { "User-Agent": "Mozilla/5.0" }, cf: { cacheTtl: 0 } });
  return parseKlines(await response.json(), days);
}

async function timedHistory(provider, fetcher, timeout) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("History provider timed out")); }, timeout);
  });
  try {
    return await Promise.race([expired, provider((url, options) => fetcher(url, { ...options, signal: controller.signal }))]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHistory(symbol, days, fetcher, startDate) {
  const yahoo = (fetch) => fetchYahooHistory(symbol, days, fetch);
  const eastmoney = secidsFor(symbol).map(secid => fetch => fetchEastmoneyHistory(secid, days, fetch));
  const providers = symbol.startsWith("gb_") ? [yahoo, ...eastmoney] : [...eastmoney, yahoo];
  providers.push(...tencentKeysFor(symbol).map(key => fetch => fetchTencentKey(key, days, fetch)));
  const now = Date.now();
  const deadline = now + 18000;
  const today = new Date(now).toISOString().slice(0, 10);
  const recent = new Date(now - 10 * 86400000).toISOString().slice(0, 10);
  let best = [];
  let bestScore = 0;

  for (const provider of providers) {
    try {
      const remaining = deadline - Date.now();
      if (startDate && remaining <= 0) break;
      const result = startDate ? await timedHistory(provider, fetcher, Math.min(4000, remaining)) : await provider(fetcher);
      const bars = Array.isArray(result) ? result : result.series;
      if (!startDate) {
        if (bars.length >= Math.min(days, 61)) return bars;
        if (bars.length > best.length) best = bars;
        continue;
      }
      const series = bars.filter(bar => bar.date <= today && Number.isFinite(Date.parse(bar.date)) && bar.close > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      const last = series.at(-1)?.date;
      if (!last || last < startDate) continue;
      const fresh = last >= recent;
      const coverage = series.filter(bar => bar.date >= startDate).length;
      const score = (fresh ? days + 1 : 0) + coverage;
      if (score > bestScore || (score === bestScore && last > best.at(-1)?.date)) {
        best = series;
        bestScore = score;
      }
      const inception = Number(result.firstTradeTime) * 1000;
      const coversListing = inception > Date.parse(startDate) && inception <= now
        && Math.abs(Date.parse(series[0].date) - inception) <= 7 * 86400000;
      if (fresh && (series[0].date <= startDate || coversListing)) return series;
    } catch {
      // Keep other providers and the best usable series within the time budget.
    }
  }
  return best;
}

export async function onRequestGet({ request, fetcher = fetch }) {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter((symbol) => isIndexAlias(symbol) || /^(sh|sz|hk|gb_)[A-Za-z0-9_]+$/.test(symbol));
  const requestedDays = Number.parseInt(url.searchParams.get("days") || "30", 10);
  const window = Number(url.searchParams.get("window"));
  const longWindow = window === 365 || window === 1095;
  if (longWindow && symbols.length > 4) return Response.json({ error: "每次最多查询四只股票的长期日线" }, { status: 400 });
  // Fetch enough trading bars for the calendar window and a prior close for holidays.
  const days = longWindow ? Math.ceil(window * 5 / 7) + 12 : Math.max(5, Math.min(Number.isFinite(requestedDays) ? requestedDays : 30, 120));
  const startDate = longWindow ? new Date(Date.now() - (window - 1) * 86400000).toISOString().slice(0, 10) : null;
  const histories = {};

  await Promise.all(symbols.map(async (symbol) => {
    const series = await fetchHistory(symbol, days, fetcher, startDate);
    if (series.length) histories[symbol] = longWindow ? series.map(({ date, close }) => ({ date, close })) : series;
  }));

  return Response.json(
    { histories, days },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
