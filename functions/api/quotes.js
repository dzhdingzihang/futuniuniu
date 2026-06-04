const SINA_URL = "https://hq.sinajs.cn/list=";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

function toNumber(parts, index) {
  const value = Number(parts[index]);
  return Number.isFinite(value) ? value : null;
}

function parseQuote(symbol, raw) {
  const parts = raw.split(",");
  let price;
  let change;
  let changePct;

  if (symbol.startsWith("sh") || symbol.startsWith("sz")) {
    price = toNumber(parts, 3);
    const prevClose = toNumber(parts, 2);
    const open = toNumber(parts, 1);
    const high = toNumber(parts, 4);
    const low = toNumber(parts, 5);
    change = price && prevClose ? price - prevClose : null;
    changePct = change !== null && prevClose ? (change / prevClose) * 100 : null;
    if (!price || price <= 0) return null;
    return { price, change, changePct, prevClose, open, high, low, session: "实时/延时", source: "sina" };
  } else if (symbol.startsWith("hk")) {
    price = toNumber(parts, 6);
    change = toNumber(parts, 7);
    changePct = toNumber(parts, 8);
    const prevClose = price && change !== null ? price - change : null;
    const open = toNumber(parts, 2);
    const high = toNumber(parts, 4);
    const low = toNumber(parts, 5);
    if (!price || price <= 0) return null;
    return { price, change, changePct, prevClose, open, high, low, session: "实时/延时", source: "sina" };
  } else {
    price = toNumber(parts, 1);
    changePct = toNumber(parts, 2);
    change = toNumber(parts, 4);
    const prevClose = price && change !== null ? price - change : null;
    if (!price || price <= 0) return null;
    return { price, change, changePct, prevClose, session: "实时/延时", source: "sina" };
  }
}

function yahooSymbol(symbol) {
  if (symbol.startsWith("sh")) return `${symbol.slice(2)}.SS`;
  if (symbol.startsWith("sz")) return `${symbol.slice(2)}.SZ`;
  if (symbol.startsWith("hk")) return `${symbol.slice(2).replace(/^0+/, "").padStart(4, "0")}.HK`;
  if (symbol.startsWith("gb_")) return symbol.slice(3).toUpperCase();
  return null;
}

function parseYahooQuote(payload) {
  const result = payload?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const opens = quote.open || [];
  const prevClose = meta.chartPreviousClose || meta.previousClose;
  const price = meta.postMarketPrice || meta.preMarketPrice || meta.regularMarketPrice || closes.findLast((value) => value && value > 0);
  if (!price || price <= 0) return null;
  const session = meta.postMarketPrice ? "盘后" : meta.preMarketPrice ? "盘前" : "实时/延时";
  const change = prevClose ? price - prevClose : null;
  const timestamp = meta.postMarketTime || meta.preMarketTime || meta.regularMarketTime || result.timestamp?.at(-1);
  const stamp = timestamp ? new Date(timestamp * 1000) : new Date();
  return {
    price,
    change,
    changePct: change !== null && prevClose ? (change / prevClose) * 100 : null,
    prevClose,
    open: opens.find((value) => value && value > 0) || price,
    high: Math.max(...highs.filter((value) => value && value > 0), price),
    low: Math.min(...lows.filter((value) => value && value > 0), price),
    date: stamp.toISOString().slice(0, 10),
    time: stamp.toISOString().slice(11, 16),
    session,
    source: "yahoo",
  };
}

async function fetchYahooQuote(symbol) {
  const mapped = yahooSymbol(symbol);
  if (!mapped) return null;
  const response = await fetch(`${YAHOO_CHART_URL}${encodeURIComponent(mapped)}?range=1d&interval=1m&includePrePost=true`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cf: { cacheTtl: 0 },
  });
  return parseYahooQuote(await response.json());
}

function decodeQuoteText(buffer) {
  try {
    return new TextDecoder("gb18030").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter((symbol) => /^(sh|sz|hk|gb_)[A-Za-z0-9_]+$/.test(symbol));

  if (!symbols.length) {
    return Response.json({ quotes: {} });
  }

  try {
    const response = await fetch(`${SINA_URL}${symbols.join(",")}`, {
      headers: {
        Referer: "https://finance.sina.com.cn/",
        "User-Agent": "Mozilla/5.0",
      },
      cf: { cacheTtl: 0 },
    });
    const text = decodeQuoteText(await response.arrayBuffer());
    const quotes = {};

    for (const symbol of symbols) {
      const pattern = new RegExp(`var hq_str_${symbol.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}="(.*?)";`);
      const match = text.match(pattern);
      if (!match) continue;
      const quote = parseQuote(symbol, match[1]);
      if (quote) quotes[symbol] = quote;
    }

    await Promise.all(symbols.map(async (symbol) => {
      if (!symbol.startsWith("gb_") && quotes[symbol]) return;
      try {
        const quote = await fetchYahooQuote(symbol);
        if (quote) quotes[symbol] = quote;
      } catch {
        // Keep Sina or empty fallback.
      }
    }));

    return Response.json(
      { quotes },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { quotes: {}, error: error.message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
