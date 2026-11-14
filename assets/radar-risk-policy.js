// Shared by the scheduled scanner, Pages and the dashboard's older cached rankings.
(() => {
  function assess(metrics, base) {
    const { amplitude, changePct, return60d } = metrics;
    const volatileDay = (Number.isFinite(changePct) && Math.abs(changePct) >= 7)
      || (Number.isFinite(amplitude) && amplitude >= 8);
    const extendedTrend = Number.isFinite(return60d) && return60d >= 60;
    const complete = Number.isFinite(changePct) && Number.isFinite(return60d)
      && Number.isFinite(amplitude) && amplitude >= 0;
    const riskPoints = volatileDay ? Math.min(6, base.risk) : 0;
    const trendPoints = extendedTrend ? Math.min(8, base.trend) : 0;
    const reasons = [];
    if (volatileDay) reasons.push("单日绝对涨跌达到 7% 或振幅达到 8%");
    if (extendedTrend) reasons.push("60 日涨幅达到 60%");
    if (!complete) reasons.push("缺少完整的日涨跌、振幅或 60 日涨跌数据");
    const round = (value) => Math.round(value * 10) / 10;
    const components = { ...base, trend: round(base.trend - trendPoints), risk: round(base.risk - riskPoints) };
    const score = round(components.trend + components.liquidity + components.risk + components.quality);
    return {
      components, score, band: score >= 70 ? "priority" : score >= 55 ? "watch" : "reserve",
      riskAdjustment: { riskPoints, trendPoints, reasons }, topEligible: complete && !volatileDay && !extendedTrend,
    };
  }
  globalThis.PiggyRadarRisk = Object.freeze({ assess });
})();
