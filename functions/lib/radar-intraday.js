import { intradaySession } from "./intraday-session.js";

// The amounts are in each listing's trading currency, per ten trading minutes.
const liquidityFloors = {
  "A股": { intervalAmount: 1_000_000, price: 0 },
  "港股": { intervalAmount: 500_000, price: 1 },
  "美股": { intervalAmount: 250_000, price: 3 },
};
const MINUTE = 60_000;
const MAX_AGE_MS = 3 * MINUTE;

const pctChange = (end, start) => (end / start - 1) * 100;
const capped = value => Math.max(0, Math.min(1, value));
const round2 = value => Math.round(value * 100) / 100;
const positive = value => Number.isFinite(value) && value > 0;

function usableQuote(row, nowMs, sessionStart) {
  const time = Date.parse(row.quoteUpdatedAt);
  if (!Number.isFinite(time) || time > nowMs || nowMs - time > MAX_AGE_MS || time < sessionStart) return false;
  const { price, prevClose, open, high, low, amount, changePct } = row.metrics || {};
  return [price, prevClose, open, high, low, amount].every(positive)
    && low <= Math.min(open, price) && high >= Math.max(open, price)
    && Number.isFinite(changePct) && Math.abs(changePct - pctChange(price, prevClose)) <= 0.12;
}

// Use the full paired cohort, including declines and unchanged prices. A tie
// occupies its midpoint rank and cannot manufacture a cross-sectional leader.
function cohortStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[half] : (sorted[half-1] + sorted[half]) / 2;
  const ranks = new Map();
  for (let first = 0; first < sorted.length;) {
    let next = first + 1;
    while (next < sorted.length && sorted[first] === sorted[next]) next++;
    ranks.set(sorted[first], (first + next - 1) / (2 * (sorted.length - 1)));
    first = next;
  }
  return { median, ranks };
}

function candidateFor(pair, returns, floors, universeMedianPct) {
  const { row, intervalMinutes, intervalChangePct, move5m, amount10m, turnoverPace } = pair;
  const { price, open, high, low, prevClose, volumeRatio } = row.metrics;
  const dayChangePct = pctChange(price, prevClose);
  const relativeMovePct = move5m - returns.median;
  const percentile = returns.ranks.get(move5m);
  const closePosition = high > low ? (price - low) / (high - low) : 0;
  if (price < floors.price || amount10m < floors.intervalAmount
      || dayChangePct < 0.3 || dayChangePct > 3 || pctChange(open, prevClose) > 2 || high >= prevClose * 1.05
      || price <= open || move5m < 0.25 || relativeMovePct < 0.15 || percentile < 0.75
      || !positive(volumeRatio) || volumeRatio < 1.2 || turnoverPace < 0.8 || closePosition < 0.65) return null;

  const components = {
    relativeStrength: round2(20 * capped(relativeMovePct / 1) + 15 * capped((percentile - 0.5) * 2)),
    participation: round2(18 * capped(volumeRatio / 2.5) + 17 * capped(turnoverPace / 1.7)),
    rangePosition: round2(20 * closePosition),
    headroom: round2(10 * capped((3 - dayChangePct) / 1.5)),
  };
  const score = round2(Object.values(components).reduce((sum, value) => sum + value, 0));
  if (score < 65) return null;
  const neededPct = Math.max(3, pctChange(prevClose * 1.05, price));
  return {
    ...row, score, components, topEligible: true,
    signal: {
      price, prevClose, quotedAt: row.quoteUpdatedAt, dayChangePct: round2(dayChangePct),
      intervalChangePct: round2(intervalChangePct), intervalMinutes: round2(intervalMinutes),
      move5m: round2(move5m), relativeMovePct: round2(relativeMovePct), peerPercentile: round2(100 * percentile),
      universeMedianPct: round2(universeMedianPct), closePosition: round2(closePosition),
      turnoverPace: round2(turnoverPace), volumeRatio, neededPct: round2(neededPct),
    },
    reasons: [
      '最近 ' + round2(intervalMinutes) + ' 分钟上涨 ' + round2(intervalChangePct) + '%，折算每 5 分钟领先板块中位数 ' + round2(relativeMovePct) + ' 个百分点',
      '量比 ' + round2(volumeRatio) + ' 倍，最近成交速率为今日此前平均的 ' + round2(turnoverPace) + ' 倍',
      '现价较昨收上涨 ' + round2(dayChangePct) + '%，位于日内高低区间的 ' + Math.round(closePosition * 100) + '% 处',
    ],
    risks: ['从信号报价到收盘还需上涨 ' + round2(neededPct) + '% 才命中双重目标，盘中放量也可能快速回落。'],
  };
}

export function evaluateIntradayPool({ market, rows, previousBaseline = null, now = new Date(), total = rows.length, sessionOverride }) {
  const clock = new Date(now);
  const session = sessionOverride ?? intradaySession(market, clock);
  const { tradeDate, sessionKey, phase } = session;
  const result = {
    market, tradeDate, phase, state: "off_session", reason: "当前处于连续交易时段以外。",
    quotedCount: 0, comparedCount: 0, qualifiedCount: 0, candidates: [], baseline: null, universeMedianPct: null,
  };
  if (phase !== "trading" || !sessionKey || !liquidityFloors[market]) return result;
  const start = Date.parse(session.sessionStartAt);
  if (!Number.isFinite(start)) return result;
  const nowMs = clock.getTime();
  if (!Number.isFinite(nowMs) || nowMs < start || nowMs >= Date.parse(session.closeAt)) return result;
  const baseline = { tradeDate, sessionKey, rows: Object.create(null) };
  result.baseline = baseline;
  const prior = previousBaseline?.tradeDate === tradeDate && previousBaseline.sessionKey === sessionKey
    ? previousBaseline.rows : null;
  const current = new Map();
  for (const row of rows) {
    if (!row || row.market !== market || !row.code || !usableQuote(row, nowMs, start)) continue;
    const prev = current.get(row.code);
    if (!prev || Date.parse(row.quoteUpdatedAt) > Date.parse(prev.quoteUpdatedAt)) current.set(row.code, row);
  }
  result.quotedCount = current.size;

  const pairs = [];
  for (const [code, row] of current) {
    const { price, amount } = row.metrics;
    const time = Date.parse(row.quoteUpdatedAt);
    const old = prior && Object.hasOwn(prior, code) ? prior[code] : null;
    baseline.rows[code] = [time, price, amount];
    if (!Array.isArray(old)) continue;
    const [oldTime, oldPrice, oldAmount] = old;
    if (!Number.isFinite(oldTime) || oldTime < start || oldTime > time || !positive(oldPrice) || !positive(oldAmount)) continue;
    const intervalMinutes = (time - oldTime) / MINUTE;
    // Polls or manual reloads under four minutes must not repeatedly reset the comparison clock.
    if (intervalMinutes < 4) { baseline.rows[code] = old; continue; }
    if (intervalMinutes > 16 || amount < oldAmount || (amount === oldAmount && price !== oldPrice)) continue;
    const elapsedBefore = session.elapsedMinutes - (nowMs - oldTime) / MINUTE;
    if (elapsedBefore < 1) continue;
    const rate = (amount - oldAmount) / intervalMinutes;
    const intervalChangePct = pctChange(price, oldPrice);
    pairs.push({
      row, intervalMinutes, intervalChangePct, move5m: intervalChangePct * 5 / intervalMinutes,
      amount10m: rate * 10, turnoverPace: rate * elapsedBefore / oldAmount,
    });
  }

  result.comparedCount = pairs.length;
  if (!Number.isInteger(total) || total < 30 || current.size < Math.max(30, total * 0.35)) {
    return { ...result, state: "insufficient_quotes", reason: "三分钟内的完整盘中报价不足，等待足够的板块覆盖。" };
  }
  if (session.elapsedMinutes < 15) return { ...result, state: "warming_up", reason: "开盘后的前 15 个交易分钟仅采集基线。" };
  if (session.remainingMinutes <= 60) return { ...result, state: "late", reason: "距离收盘不足或等于 60 个交易分钟，本场停止发出新信号。" };
  if (pairs.length < Math.max(30, total * 0.15)) {
    return { ...result, state: "insufficient_pairs", reason: "等待同一连续交易时段相隔 4–16 分钟的两轮可比报价。" };
  }
  const returns = cohortStats(pairs.map(pair => pair.move5m));
  const dayMedian = cohortStats(pairs.map(({ row }) => pctChange(row.metrics.price, row.metrics.prevClose))).median;
  result.universeMedianPct = round2(returns.median);
  if (dayMedian <= -1.5 || returns.median <= -0.4) {
    return { ...result, state: "weak_market", reason: "板块多数股票当日或最近一段同步下行，本轮暂停发出信号。" };
  }
  const candidates = pairs.map(pair => candidateFor(pair, returns, liquidityFloors[market], returns.median))
    .filter(Boolean).sort((a, b) => b.score - a.score || b.signal.relativeMovePct - a.signal.relativeMovePct || a.code.localeCompare(b.code));
  return {
    ...result, state: "ready", reason: candidates.length ? "" : "本轮没有股票同时达到价格、成交、相对强度和过热门槛。",
    qualifiedCount: candidates.length, candidates,
  };
}
