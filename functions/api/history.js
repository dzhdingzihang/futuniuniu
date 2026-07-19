const EASTMONEY_KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

function secidsFor(symbol) {
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

async function fetchYahooHistory(symbol, days) {
  const mapped = yahooSymbol(symbol);
  if (!mapped) return [];
  const response = await fetch(`${YAHOO_CHART_URL}${encodeURIComponent(mapped)}?range=2mo&interval=1d`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cf: { cacheTtl: 0 },
  });
  return parseYahooPayload(await response.json(), days);
}

async function fetchHistory(symbol, days) {
  if (symbol.startsWith("gb_")) {
    try {
      const series = await fetchYahooHistory(symbol, days);
      if (series.length) return series;
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
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cf: { cacheTtl: 0 },
      });
      const series = parseKlines(await response.json(), days);
      if (series.length) return series;
    } catch {
      continue;
    }
  }
  try {
    const series = await fetchYahooHistory(symbol, days);
    if (series.length) return series;
  } catch {
    // No history fallback left.
  }
  return [];
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter((symbol) => /^(sh|sz|hk|gb_)[A-Za-z0-9_]+$/.test(symbol));
  const days = Math.max(5, Math.min(Number(url.searchParams.get("days")) || 30, 60));
  const histories = {};

  await Promise.all(symbols.map(async (symbol) => {
    const series = await fetchHistory(symbol, days);
    if (series.length) histories[symbol] = series;
  }));

  return Response.json(
    { histories, days },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
