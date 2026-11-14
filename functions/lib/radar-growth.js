import "../../assets/radar-risk-policy.js";

const isPositive = (value) => Number.isFinite(value) && value > 0;
const round1 = (value) => Math.round(value * 10) / 10;

// Each market uses one activity measure so that two names never compete on different denominators.
const activityMeasures = [
  { key: "volumeRatio", name: "量比", unit: "倍", value: (metrics) => metrics.volumeRatio },
  { key: "turnoverRate", name: "换手率", unit: "%", value: (metrics) => metrics.turnoverRate },
  {
    key: "amountToMarketCap", name: "成交额占总市值", unit: "%",
    value: (metrics) => isPositive(metrics.amount) && isPositive(metrics.marketCap)
      ? 100 * metrics.amount / metrics.marketCap : null,
  },
];

// Equally valued quotes have the same midpoint rank. Missing observations never enter a distribution.
function ranks(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const result = new Map();
  let start = 0;
  while (start < sorted.length) {
    let end = start + 1;
    while (end < sorted.length && sorted[end] === sorted[start]) end++;
    result.set(sorted[start], sorted.length === 1 ? 0.5 : (start + end - 1) / (2 * (sorted.length - 1)));
    start = end;
  }
  return result;
}

/** Rank one market's normalized equity universe, before truncating it by the balanced score. */
export function analyzeGrowthPool(candidates) {
  if (!candidates.length) return { scoredCount: 0, candidates: [] };
  const measure = activityMeasures.find(({ value }) =>
    candidates.filter(({ metrics }) => isPositive(value(metrics))).length * 3 >= candidates.length * 2);
  if (!measure) return { scoredCount: 0, candidates: [] };

  candidates = candidates.filter(({ metrics }) => isPositive(measure.value(metrics))
    && Number.isFinite(metrics.return10d) && Number.isFinite(metrics.return60d) && Number.isFinite(metrics.changePct)
    && Number.isFinite(metrics.amplitude) && metrics.amplitude >= 0);
  const activityValues = candidates.map(({ metrics }) => measure.value(metrics));
  const activityRanks = ranks(activityValues.filter(isPositive));
  const shortRanks = ranks(candidates.map(({ metrics }) => metrics.return10d));
  const trendRanks = ranks(candidates.map(({ metrics }) => metrics.return60d));
  const dailyRanks = ranks(candidates.map(({ metrics }) => metrics.changePct));
  const shortlist = [];
  for (const [index, candidate] of candidates.entries()) {
    const { return10d, return60d, changePct } = candidate.metrics;
    const shortRank = shortRanks.get(return10d);
    const trendRank = trendRanks.get(return60d);
    const dailyRank = dailyRanks.get(changePct);
    const activity = activityValues[index];
    const activityRank = activityRanks.get(activity);
    if (!Number.isFinite(trendRank) || !Number.isFinite(dailyRank) || !Number.isFinite(activityRank)
        || return10d <= 0 || shortRank < 0.60 || return60d <= 0 || changePct <= 0 || activityRank < 0.50
        || (measure.key === "volumeRatio" && activity < 1)) continue;
    if (!globalThis.PiggyRadarRisk.assess(candidate.metrics, { trend: 0, liquidity: 0, risk: 0, quality: 0 }).topEligible) continue;

    const rawScore = 40 * shortRank + 20 * trendRank + 5 * dailyRank + 35 * activityRank;
    if (rawScore < 65) continue;
    shortlist.push({
      ...candidate,
      growthScore: round1(rawScore),
      growthComponents: { momentum10d: round1(40 * shortRank), momentum60d: round1(20 * trendRank), latestChange: round1(5 * dailyRank), activity: round1(35 * activityRank) },
      growthActivityMetric: measure.key,
      growthReasons: [
        `近10个交易日上涨 ${return10d.toFixed(2)}%，处于本池第 ${Math.round(100 * shortRank)} 百分位`,
        `近60日上涨 ${return60d.toFixed(2)}%，最近交易日上涨 ${changePct.toFixed(2)}%`,
        `${measure.name} ${activity.toFixed(2)}${measure.unit}，处于本池第 ${Math.round(100 * activityRank)} 百分位`,
      ],
      growthRisks: [
        "过往涨幅已经发生，尚无两周收益验证",
        ...(measure.key === "volumeRatio" ? [] : [`量比覆盖不足，${measure.name}仅衡量当日活跃度，无法确认较平日放量`]),
      ],
    });
  }
  shortlist.sort((left, right) =>
    right.growthScore - left.growthScore || right.metrics.return60d - left.metrics.return60d || left.code.localeCompare(right.code));
  return { scoredCount: candidates.length, candidates: shortlist };
}

export function rankGrowthCandidates(candidates) {
  return analyzeGrowthPool(candidates).candidates;
}
