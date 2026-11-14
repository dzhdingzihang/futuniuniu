// Tencent's wire layout differs by market. Return horizons are trading sessions.
const layout = {
  "A股": { r5: 63, r10: 69, r20: 70, r60: 71, ytd: 62, volumeRatio: 49, turnover: 38, pb: 46 },
  "港股": { r5: 62, r10: 66, r20: 67, r60: 68, ytd: 61, volumeRatio: 50, turnover: 59, pb: 58 },
  "美股": { r5: 55, r10: 59, r20: 60, r60: 61, ytd: 54, volumeRatio: 64, turnover: 38, pb: 51 },
};

function number(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function symbolFor(market, code) {
  if (market === "美股" && /^[A-Z][A-Z0-9.-]{0,14}$/.test(code)) return "us" + code;
  if (market === "港股" && /^\d{5}$/.test(code)) return "hk" + code;
  if (market === "A股" && /^\d{6}$/.test(code)) return (/^[569]/.test(code) ? "sh" : "sz") + code;
  return null;
}

const newYorkClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", timeZoneName: "shortOffset",
});

function quoteTimestamp(value, market, offsets) {
  // Mainland quotes use YYYYMMDDHHmmss; HK and US include punctuation.
  const match = String(value || "").match(/^(\d{4})[-/]?(\d\d)[-/]?(\d\d) ?(\d\d):?(\d\d):?(\d\d)$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = year + "-" + month + "-" + day;
  let offset = "+08:00";
  if (market === "美股") {
    if (!offsets.has(date)) {
      // Noon New York is after the Sunday DST transition, which precedes the next session.
      const noon = new Date(date + "T17:00:00Z");
      if (!Number.isFinite(noon.getTime())) return null;
      const zone = newYorkClock.formatToParts(noon).find(part => part.type === "timeZoneName")?.value;
      if (!/^GMT-[45]$/.test(zone)) return null;
      offsets.set(date, "-0" + zone.slice(-1) + ":00");
    }
    offset = offsets.get(date);
  }
  const timestamp = Date.parse(date + "T" + hour + ":" + minute + ":" + second + offset);
  return Number.isFinite(timestamp) ? timestamp / 1000 : null;
}

function toRow(market, symbol, fields, offsets) {
  const code = symbol.slice(2);
  const exchange = market === "美股" ? /^(.*)\.(OQ|N|A)$/.exec(fields[2] || "") : null;
  if ((exchange ? exchange[1] : fields[2]) !== code || !fields[1] || !fields[30]) return null;
  if (market === "美股" && !exchange) return null;
  const providerMarket = exchange ? { OQ: 105, N: 106, A: 107 }[exchange[2]]
    : market === "港股" ? 116 : Number(symbol.startsWith("sh"));
  const idx = layout[market];
  const marketCap = number(fields[45]); // All three markets report units of 100 million.
  const amount = number(fields[37]);
  const return20d = number(fields[idx.r20]);
  let return60d = number(fields[idx.r60]);
  const quoteMonth = Number(fields[30].slice(4).replace(/^[-/]/, "").slice(0, 2));
  // Tencent may fill longer windows with the since-listing return. Identical
  // rounded observations can coincide for seasoned stocks too, so abstain.
  // From May onward YTD always spans more than 60 sessions in these markets.
  if (return60d === return20d || (quoteMonth >= 5 && return60d === number(fields[idx.ytd]))) return60d = null;
  // Mainland slot 35 has the unrounded RMB value; slot 37 is rounded to ten-thousands.
  const mainlandAmount = market === "A股" ? number(fields[35]?.split("/")[2]) : null;
  return {
    f12: code, f13: providerMarket, f14: fields[1],
    f2: number(fields[3]), f3: number(fields[32]),
    f6: mainlandAmount ?? (amount === null ? null : amount * (market === "A股" ? 10000 : 1)),
    f7: number(fields[43]), f8: number(fields[idx.turnover]), f9: number(fields[39]),
    f10: number(fields[idx.volumeRatio]), f20: marketCap === null ? null : Math.round(marketCap * 1e8),
    f23: number(fields[idx.pb]), f24: return60d,
    f124: quoteTimestamp(fields[30], market, offsets),
    return5d: number(fields[idx.r5]), return10d: number(fields[idx.r10]), return20d,
  };
}

export async function fetchTencentGrowthQuotes({ market, codes, fetcher = fetch, timeoutMs = 8000 }) {
  if (!Object.hasOwn(layout, market)) throw new Error("未知腾讯行情市场");
  const symbols = new Set(codes.map(code => symbolFor(market, code)).filter(Boolean));
  if (!symbols.size) return [];
  // The UTF-8 route avoids GBK-specific decoder support on edge runtimes.
  const url = new URL("https://qt.gtimg.cn/utf8/q=" + [...symbols].join(","));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      signal: controller.signal, headers: { Referer: "https://gu.qq.com/" }, cf: { cacheTtl: 0 },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`腾讯批量行情 HTTP ${response.status}`);
    }
    const body = await response.text();
    const rows = [];
    const offsets = new Map();
    for (const [, symbol, quote] of body.matchAll(/(?:^|[;\n])\s*v_([A-Za-z0-9.-]+)="([^"\r\n]*)"/g)) {
      if (!symbols.delete(symbol)) continue;
      const row = toRow(market, symbol, quote.split("~"), offsets);
      if (row) rows.push(row);
    }
    return rows;
  } finally {
    clearTimeout(timer);
  }
}
