const SINA_URL = "https://hq.sinajs.cn/list=";

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
    change = price && prevClose ? price - prevClose : null;
    changePct = change !== null && prevClose ? (change / prevClose) * 100 : null;
  } else if (symbol.startsWith("hk")) {
    price = toNumber(parts, 6);
    change = toNumber(parts, 7);
    changePct = toNumber(parts, 8);
  } else {
    price = toNumber(parts, 1);
    changePct = toNumber(parts, 2);
    change = toNumber(parts, 4);
  }

  if (!price || price <= 0) return null;
  return { price, change, changePct };
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
