const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

function yahooSymbol(symbol) {
  if (symbol.startsWith("sh")) return `${symbol.slice(2)}.SS`;
  if (symbol.startsWith("sz")) return `${symbol.slice(2)}.SZ`;
  if (symbol.startsWith("hk")) return `${symbol.slice(2).replace(/^0+/, "").padStart(4, "0")}.HK`;
  if (symbol.startsWith("gb_")) return symbol.slice(3).toUpperCase();
  return null;
}

function parseYahooPayload(payload) {
  const result = payload?.chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];

  return timestamps
    .map((timestamp, index) => {
      const close = closes[index];
      if (!close || close <= 0) return null;
      const stamp = new Date(timestamp * 1000);
      return {
        date: stamp.toISOString().slice(0, 10),
        time: stamp.toISOString().slice(11, 16),
        open: opens[index] || close,
        high: highs[index] || close,
        low: lows[index] || close,
        close,
      };
    })
    .filter(Boolean)
    .slice(-120);
}

async function fetchIntraday(symbol) {
  const mapped = yahooSymbol(symbol);
  if (!mapped) return [];
  const response = await fetch(`${YAHOO_CHART_URL}${encodeURIComponent(mapped)}?range=1d&interval=5m&includePrePost=true`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cf: { cacheTtl: 0 },
  });
  return parseYahooPayload(await response.json());
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter((symbol) => /^(sh|sz|hk|gb_)[A-Za-z0-9_]+$/.test(symbol));
  const intraday = {};

  await Promise.all(symbols.map(async (symbol) => {
    try {
      const series = await fetchIntraday(symbol);
      if (series.length) intraday[symbol] = series;
    } catch {
      // Missing one symbol should not block the whole page.
    }
  }));

  return Response.json(
    { intraday },
    { headers: { "Cache-Control": "no-store" } },
  );
}
