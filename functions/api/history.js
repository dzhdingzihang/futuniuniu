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

async function fetchTencentHistory(symbol, days, fetcher) {
  const keys = tencentKeysFor(symbol);
  const sufficientLength = Math.min(days, 61);
  let longest = [];

  for (const key of keys) {
    try {
      const series = await fetchTencentKey(key, days, fetcher);
      if (series.length > longest.length) longest = series;
      if (series.length >= sufficientLength) return series;
    } catch {
      // Try the next exchange suffix. Tencent uses different suffixes for US listings.
    }
  }
  return longest;
}

async function fetchYahooHistory(symbol, days, fetcher) {
  const mapped = yahooSymbol(symbol);
  if (!mapped) return [];
  const response = await fetcher(`${YAHOO_CHART_URL}${encodeURIComponent(mapped)}?range=6mo&interval=1d`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cf: { cacheTtl: 0 },
  });
  return parseYahooPayload(await response.json(), days);
}

async function fetchHistory(symbol, days, fetcher) {
  const sufficientLength = Math.min(days, 61);
  let longest = [];
  const remember = (series) => {
    if (series.length > longest.length) longest = series;
    return series.length >= sufficientLength;
  };

  if (symbol.startsWith("gb_")) {
    try {
      const series = await fetchYahooHistory(symbol, days, fetcher);
      if (remember(series)) return series;
    } catch {
      // Fall through to Eastmoney.
    }
  }

  const limit = Math.max(days + 10, 45);
  for (const secid of secidsFor(symbol)) {
    try {
      const url = new URL(EASTMONEY_KLINE_URL);
      url.searchParams.set("secid", secid);
      url.searchParams.set("fields1", "f1,f2,f3,f4,f5");
      url.searchParams.set("fields2", "f51,f52,f53,f54,f55");
      url.searchParams.set("klt", "101");
      url.searchParams.set("fqt", "1");
      url.searchParams.set("end", "20500101");
      url.searchParams.set("lmt", String(limit));
      const response = await fetcher(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cf: { cacheTtl: 0 },
      });
      const series = parseKlines(await response.json(), days);
      if (remember(series)) return series;
    } catch {
      continue;
    }
  }

  if (!symbol.startsWith("gb_")) {
    try {
      const series = await fetchYahooHistory(symbol, days, fetcher);
      if (remember(series)) return series;
    } catch {
      // Fall through to Tencent.
    }
  }

  try {
    const series = await fetchTencentHistory(symbol, days, fetcher);
    if (series.length > longest.length) longest = series;
  } catch {
    // No history fallback left.
  }
  return longest;
}

export async function onRequestGet({ request, fetcher = fetch }) {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter((symbol) => isIndexAlias(symbol) || /^(sh|sz|hk|gb_)[A-Za-z0-9_]+$/.test(symbol));
  const requestedDays = Number.parseInt(url.searchParams.get("days") || "30", 10);
  const days = Math.max(5, Math.min(Number.isFinite(requestedDays) ? requestedDays : 30, 120));
  const histories = {};

  await Promise.all(symbols.map(async (symbol) => {
    const series = await fetchHistory(symbol, days, fetcher);
    if (series.length) histories[symbol] = series;
  }));

  return Response.json(
    { histories, days },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
