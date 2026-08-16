const MARKET_CONFIG = {
  "A股": { currency: "CNY" },
  "港股": { currency: "HKD" },
  "美股": { currency: "USD" },
};

export class SecurityLookupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "SecurityLookupError";
    this.status = status;
  }
}

export function normalizeSecurityInput(market, rawCode) {
  const normalizedMarket = String(market || "").trim();
  const config = MARKET_CONFIG[normalizedMarket];
  if (!config) throw new SecurityLookupError("请选择 A股、港股或美股");
  let code = String(rawCode || "").trim().replace(/\s+/g, "").toUpperCase();
  if (!code) throw new SecurityLookupError("请输入股票代码");

  if (normalizedMarket === "A股") {
    let exchange = "";
    const suffix = code.match(/\.(SH|SZ|BJ)$/);
    if (suffix) {
      exchange = suffix[1].toLowerCase();
      code = code.replace(/\.(SH|SZ|BJ)$/, "");
    }
    const prefix = code.match(/^(SH|SZ|BJ)\.?/);
    if (prefix) {
      exchange = prefix[1].toLowerCase();
      code = code.slice(prefix[0].length);
    }
    if (!/^\d{6}$/.test(code)) throw new SecurityLookupError("A股代码应为 6 位数字，例如 601138");
    if (exchange === "bj" || /^[48]/.test(code) || /^92/.test(code)) throw new SecurityLookupError("当前行情接口暂不支持北交所代码");
    if (!exchange) exchange = /^[569]/.test(code) ? "sh" : "sz";
    return { market: normalizedMarket, code, sina: exchange + code, currency: config.currency };
  }

  if (normalizedMarket === "港股") {
    code = code.replace(/^HK\.?/, "").replace(/\.HK$/, "");
    if (!/^\d{1,5}$/.test(code)) throw new SecurityLookupError("港股代码应为 1–5 位数字，例如 1810");
    code = code.padStart(5, "0");
    return { market: normalizedMarket, code, sina: "hk" + code, currency: config.currency };
  }

  code = code.replace(/^\$/, "").replace(/^US[:.]?/, "").replace(/\.US$/, "");
  if (!/^[A-Z0-9]{1,12}$/.test(code)) throw new SecurityLookupError("请输入普通美股代码，例如 NVDA；暂不支持带点号或连字符的特殊代码");
  return { market: normalizedMarket, code, sina: "gb_" + code.toLowerCase(), currency: config.currency };
}

export function parseSinaQuote(text, security) {
  const match = String(text || "").match(/="([\s\S]*?)";/);
  if (!match || !match[1].trim()) throw new SecurityLookupError("没有找到这只股票，请检查市场和代码", 404);
  const fields = match[1].split(",");
  const name = String(security.market === "港股" ? (fields[1] || fields[0]) : fields[0] || "").trim();
  if (!name) throw new SecurityLookupError("没有识别到股票名称，请检查代码", 404);
  const priceIndex = security.market === "A股" ? 3 : security.market === "港股" ? 6 : 1;
  const price = Number(fields[priceIndex]);
  return { ...security, name, price: Number.isFinite(price) && price > 0 ? price : null };
}

export async function lookupSecurity(market, rawCode) {
  const security = normalizeSecurityInput(market, rawCode);
  const response = await fetch("https://hq.sinajs.cn/list=" + encodeURIComponent(security.sina), {
    headers: {
      Accept: "text/plain,*/*",
      Referer: "https://finance.sina.com.cn/",
      "User-Agent": "Mozilla/5.0",
    },
    cf: { cacheTtl: 0 },
  });
  if (!response.ok) throw new SecurityLookupError("行情服务暂时不可用，请稍后重试", 502);
  const bytes = await response.arrayBuffer();
  let text;
  try { text = new TextDecoder("gb18030").decode(bytes); }
  catch { text = new TextDecoder().decode(bytes); }
  return parseSinaQuote(text, security);
}
