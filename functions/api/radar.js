const EASTMONEY_RADAR_URL = "https://push2delay.eastmoney.com/api/qt/clist/get";

export const RADAR_MODEL_VERSION = "radar-v1.1";
export const RADAR_SOURCE = "东方财富行情中心";
export const RADAR_PAGE_SIZE = 100;
export const RADAR_PAGE_COUNT = 5;
export const RADAR_POOL_SIZE = 240;
export const RADAR_MIN_POOL_SIZE = 200;
export const RADAR_UPSTREAM_TIMEOUT_MS = 8000;

export const RADAR_MARKETS = Object.freeze({
  "A股": Object.freeze({
    currency: "CNY",
    filter: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
  }),
  "港股": Object.freeze({
    currency: "HKD",
    filter: "m:116+t:3",
  }),
  "美股": Object.freeze({
    currency: "USD",
    filter: "m:105,m:106",
  }),
});

const RADAR_FIELDS = [
  "f2", "f3", "f5", "f6", "f7", "f8", "f9", "f10", "f12", "f13", "f14",
  "f15", "f16", "f17", "f18", "f20", "f21", "f23", "f24", "f124",
].join(",");

const HK_NON_EQUITY_NAME = /(?:认购|認購|认沽|認沽|牛证|牛證|熊证|熊證|权证|權證|窝轮|窩輪|ETF|ETN|基金|杠杆|槓桿|反向|做多|做空|债券|債券|票据|票據|优先股|優先股)/i;
const US_NON_EQUITY_NAME = /(?:\bETF\b|\bETN\b|exchange[- ]traded|proshares|direxion|ultrapro|ultrashort|leveraged|inverse|daily\s+(?:bull|bear)|\b[23]x\b|指数基金|交易所交易基金|杠杆|反向|做多|做空)/i;

export class RadarError extends Error {
  constructor(message, code = "RADAR_UPSTREAM_ERROR", status = 502) {
    super(message);
    this.name = "RadarError";
    this.code = code;
    this.status = status;
  }
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function round1(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function providerTimestamp(value) {
  const timestamp = positiveNumber(value);
  if (timestamp === null) return null;
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function canonicalCode(market, value) {
  const code = String(value || "").trim().toUpperCase();
  if (market === "A股") return /^\d{6}$/.test(code) ? code : "";
  if (market === "港股") return /^\d{1,5}$/.test(code) ? code.padStart(5, "0") : "";
  return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(code) ? code : "";
}

export function sinaSymbolFor(market, code, providerMarket = null) {
  if (market === "A股") {
    const exchange = Number(providerMarket) === 1 || /^[569]/.test(code) ? "sh" : "sz";
    return exchange + code;
  }
  if (market === "港股") return "hk" + code.padStart(5, "0");
  if (market === "美股") return "gb_" + code.toLowerCase();
  return "";
}

export function normalizeRadarRow(raw, market) {
  const config = RADAR_MARKETS[market];
  if (!config || !raw || typeof raw !== "object") return null;
  const code = canonicalCode(market, raw.f12);
  const name = String(raw.f14 || "").trim();
  if (!code || !name) return null;
  const providerMarket = finiteNumber(raw.f13);
  return {
    id: `${market}:${code}`,
    market,
    code,
    name,
    currency: config.currency,
    sina: sinaSymbolFor(market, code, providerMarket),
    providerMarket,
    quoteUpdatedAt: providerTimestamp(raw.f124),
    metrics: {
      price: positiveNumber(raw.f2),
      changePct: finiteNumber(raw.f3),
      return60d: finiteNumber(raw.f24),
      amount: positiveNumber(raw.f6),
      marketCap: positiveNumber(raw.f20),
      pe: finiteNumber(raw.f9),
      pb: finiteNumber(raw.f23),
      amplitude: finiteNumber(raw.f7),
      turnoverRate: finiteNumber(raw.f8),
    },
  };
}

export function isEligibleRadarCandidate(candidate) {
  if (!candidate || !RADAR_MARKETS[candidate.market]) return false;
  const metrics = candidate.metrics || {};
  if (![metrics.price, metrics.amount, metrics.marketCap].every((value) => Number.isFinite(value) && value > 0)) return false;

  if (candidate.market === "A股") {
    if (!/^\d{6}$/.test(candidate.code)) return false;
    if (/^(?:4|8|92)/.test(candidate.code)) return false;
    if (/(?:\*?ST)|退市|退$/i.test(candidate.name)) return false;
  } else if (candidate.market === "港股") {
    if (!/^\d{5}$/.test(candidate.code) || HK_NON_EQUITY_NAME.test(candidate.name)) return false;
  } else if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(candidate.code) || US_NON_EQUITY_NAME.test(candidate.name)) {
    return false;
  }
  return true;
}

function percentile(value, values, missing = 0) {
  if (!Number.isFinite(value) || !values.length) return missing;
  if (values.length === 1) return 0.5;
  let lower = 0;
  while (lower < values.length && values[lower] < value) lower += 1;
  let upper = lower;
  while (upper < values.length && values[upper] === value) upper += 1;
  const averageRank = (lower + Math.max(lower, upper - 1)) / 2;
  return averageRank / (values.length - 1);
}

function sortedMetric(candidates, getter, predicate = Number.isFinite) {
  return candidates.map(getter).filter(predicate).sort((left, right) => left - right);
}

function reasonsFor(candidate) {
  const reasons = [];
  if (candidate.components.liquidity >= 22) reasons.push("成交活跃度位于本市场前列");
  if (candidate.components.trend >= 25) reasons.push("60日趋势与最近交易日动量位于本市场前列");
  else if (Number.isFinite(candidate.metrics.return60d) && candidate.metrics.return60d >= -10 && candidate.metrics.return60d <= 30) reasons.push("60日趋势处于可继续研究区间");
  if (candidate.components.risk >= 14) reasons.push("最近交易日振幅与涨跌速度相对可控");
  if (candidate.components.quality >= 10) reasons.push("估值指标在本市场具有相对可比性");
  if (!reasons.length) reasons.push("核心行情数据完整，可纳入后续研究");
  return reasons.slice(0, 3);
}

function risksFor(candidate) {
  const risks = [];
  if ((candidate.metrics.amplitude || 0) >= 8 || Math.abs(candidate.metrics.changePct || 0) >= 7) {
    risks.push("最近交易日波动较大，避免把短期冲高当成确定性机会");
  }
  if (Number.isFinite(candidate.metrics.return60d) && candidate.metrics.return60d >= 60) {
    risks.push("60日涨幅较高，需要额外评估追高与回撤风险");
  }
  if (!Number.isFinite(candidate.metrics.pe) || candidate.metrics.pe <= 0) {
    risks.push("市盈率缺失或为负，质量分不能代替基本面核查");
  }
  if (Number.isFinite(candidate.metrics.pb) && candidate.metrics.pb >= 15) {
    risks.push("市净率处于较高水平，估值容错需要单独评估");
  }
  if (!risks.length) risks.push("分数仅表示本市场内的研究优先级，不代表上涨概率");
  return risks.slice(0, 3);
}

export function scoreRadarCandidates(input) {
  const candidates = input.filter(isEligibleRadarCandidate);
  const return60d = sortedMetric(candidates, (item) => item.metrics.return60d);
  const changes = sortedMetric(candidates, (item) => item.metrics.changePct);
  const amounts = sortedMetric(candidates, (item) => Math.log10(item.metrics.amount));
  const marketCaps = sortedMetric(candidates, (item) => Math.log10(item.metrics.marketCap));
  const amplitudes = sortedMetric(candidates, (item) => item.metrics.amplitude, (value) => Number.isFinite(value) && value >= 0);
  const absoluteChanges = sortedMetric(candidates, (item) => Math.abs(item.metrics.changePct));
  const positivePe = sortedMetric(candidates, (item) => item.metrics.pe, (value) => Number.isFinite(value) && value > 0);
  const positivePb = sortedMetric(candidates, (item) => item.metrics.pb, (value) => Number.isFinite(value) && value > 0);

  return candidates.map((candidate) => {
    const trend = round1(
      percentile(candidate.metrics.return60d, return60d) * 25
      + percentile(candidate.metrics.changePct, changes) * 10,
    );
    const liquidity = round1(
      percentile(Math.log10(candidate.metrics.amount), amounts) * 20
      + percentile(Math.log10(candidate.metrics.marketCap), marketCaps) * 10,
    );
    const amplitudeScore = Number.isFinite(candidate.metrics.amplitude) && candidate.metrics.amplitude >= 0
      ? 1 - percentile(candidate.metrics.amplitude, amplitudes)
      : 0;
    const changeRiskScore = Number.isFinite(candidate.metrics.changePct)
      ? 1 - percentile(Math.abs(candidate.metrics.changePct), absoluteChanges)
      : 0;
    const risk = round1(amplitudeScore * 12 + changeRiskScore * 8);
    const peScore = Number.isFinite(candidate.metrics.pe) && candidate.metrics.pe > 0
      ? 1 - percentile(candidate.metrics.pe, positivePe)
      : 0;
    const pbScore = Number.isFinite(candidate.metrics.pb) && candidate.metrics.pb > 0
      ? 1 - percentile(candidate.metrics.pb, positivePb)
      : 0;
    const quality = round1(peScore * 9 + pbScore * 6);
    const components = { trend, liquidity, risk, quality };
    const score = round1(trend + liquidity + risk + quality);
    const scored = {
      ...candidate,
      score,
      band: score >= 70 ? "priority" : score >= 55 ? "watch" : "reserve",
      components,
    };
    return { ...scored, reasons: reasonsFor(scored), risks: risksFor(scored) };
  }).sort((left, right) => (
    right.score - left.score
    || right.metrics.amount - left.metrics.amount
    || right.metrics.marketCap - left.metrics.marketCap
    || left.code.localeCompare(right.code)
  ));
}

export function radarPageUrl(market, page) {
  const config = RADAR_MARKETS[market];
  if (!config) throw new RadarError("请选择 A股、港股或美股", "INVALID_MARKET", 400);
  const url = new URL(EASTMONEY_RADAR_URL);
  url.searchParams.set("pn", String(page));
  url.searchParams.set("pz", String(RADAR_PAGE_SIZE));
  url.searchParams.set("po", "1");
  url.searchParams.set("np", "1");
  url.searchParams.set("fltt", "2");
  url.searchParams.set("invt", "2");
  url.searchParams.set("fid", "f6");
  url.searchParams.set("fs", config.filter);
  url.searchParams.set("fields", RADAR_FIELDS);
  return url;
}

async function fetchRadarPage(market, page, fetcher, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(radarPageUrl(market, page), {
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: "https://quote.eastmoney.com/center/",
        "User-Agent": "Mozilla/5.0",
      },
      cf: { cacheTtl: 0 },
      signal: controller.signal,
    });
    if (!response.ok) throw new RadarError(`东方财富第 ${page} 页返回 HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.rc !== undefined && payload.rc !== 0) throw new RadarError(`东方财富第 ${page} 页返回错误 ${payload.rc}`);
    const diff = payload?.data?.diff;
    if (!diff || typeof diff !== "object") throw new RadarError(`东方财富第 ${page} 页数据缺失`);
    return Array.isArray(diff) ? diff : Object.values(diff);
  } catch (error) {
    if (error?.name === "AbortError") throw new RadarError(`东方财富第 ${page} 页请求超过 ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function scanRadarMarket({ market, fetcher = fetch, now = () => new Date(), timeoutMs = RADAR_UPSTREAM_TIMEOUT_MS }) {
  if (!RADAR_MARKETS[market]) throw new RadarError("请选择 A股、港股或美股", "INVALID_MARKET", 400);
  const pages = await Promise.all(Array.from(
    { length: RADAR_PAGE_COUNT },
    (_, index) => fetchRadarPage(market, index + 1, fetcher, timeoutMs),
  ));
  const rawRows = pages.flat();
  const byId = new Map();
  rawRows.forEach((raw) => {
    const candidate = normalizeRadarRow(raw, market);
    if (candidate && isEligibleRadarCandidate(candidate) && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
  });
  const eligible = Array.from(byId.values());
  if (eligible.length < RADAR_MIN_POOL_SIZE) {
    throw new RadarError(
      `行情覆盖不足：过滤后仅 ${eligible.length} 只，低于 ${RADAR_MIN_POOL_SIZE} 只安全下限`,
      "RADAR_POOL_TOO_SMALL",
    );
  }
  const candidates = scoreRadarCandidates(eligible).slice(0, RADAR_POOL_SIZE);
  const stamp = now();
  const fetchedAt = (stamp instanceof Date ? stamp : new Date(stamp)).toISOString();
  return {
    market,
    modelVersion: RADAR_MODEL_VERSION,
    source: RADAR_SOURCE,
    fetchedAt,
    rawSize: rawRows.length,
    eligibleSize: eligible.length,
    poolSize: candidates.length,
    candidates,
  };
}

function errorResponse(error, market) {
  const radarError = error instanceof RadarError
    ? error
    : new RadarError(error?.message || "机会雷达行情服务暂时不可用");
  return Response.json(
    { error: radarError.message, code: radarError.code, market: RADAR_MARKETS[market] ? market : null },
    { status: radarError.status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function onRequestGet({ request, fetcher = fetch, now = () => new Date(), timeoutMs = RADAR_UPSTREAM_TIMEOUT_MS }) {
  const market = new URL(request.url).searchParams.get("market") || "";
  try {
    const snapshot = await scanRadarMarket({ market, fetcher, now, timeoutMs });
    return Response.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error, market);
  }
}
