import { fetchTencentGrowthQuotes } from "./radar-tencent-quotes.js";
import { analyzeGrowthPool } from "./radar-growth.js";

const DIRECTORY_URL = "https://alixjd.com/assets/radar-universe.json";
const BATCH_SIZE = 380;
const DAY = 86400000;

export const GROWTH_SEGMENTS = Object.freeze({
  "A股": { key: "chinext", label: "创业板", scope: "深交所创业板上市股票", exchange: 0, amountFloor: 2e7 },
  "港股": { key: "hk-tech", label: "港股科技", scope: "恒生科技综合指数成份股（含大型、中型与小型公司）", exchange: 116, amountFloor: 1e7 },
  "美股": { key: "nasdaq", label: "纳斯达克", scope: "纳斯达克上市普通股及存托凭证", exchange: 105, amountFloor: 5e6 },
});

export async function loadGrowthDirectory(fetcher, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(new URL(DIRECTORY_URL), { signal: controller.signal, cf: { cacheTtl: 300 } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("名册 HTTP " + response.status);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function scanGrowthSegment({ market, fetcher = fetch, now = () => new Date(), timeoutMs = 8000,
  normalize, isEligible, directory, batchQuotes = fetchTencentGrowthQuotes }) {
  const config = GROWTH_SEGMENTS[market];
  const { key, label, scope } = config;
  const info = { key, label, scope };
  try {
    const entry = (await (directory || loadGrowthDirectory(fetcher, timeoutMs)))?.[market];
    const codes = new Set(entry?.codes);
    if (codes.size < 200 || !/^\d{4}-\d{2}-\d{2}$/.test(entry?.asOf || "")) throw new Error("官方名册缺失或不足 200 只");
    Object.assign(info, { total: codes.size, membershipAsOf: entry.asOf });
    const list = [...codes];
    const rows = new Map();
    const batchCount = Math.ceil(list.length / BATCH_SIZE);
    let nextBatch = 0;
    // Bound concurrent response bodies within a Workers invocation.
    let failure;
    async function readNext() {
      while (!failure && nextBatch < batchCount) {
        const start = nextBatch++ * BATCH_SIZE;
        try {
          const diff = await batchQuotes({ market, codes: list.slice(start, start + BATCH_SIZE), fetcher, timeoutMs });
          for (const raw of diff) {
            const row = normalize(raw, market);
            if (row && codes.has(row.code) && row.providerMarket === config.exchange) rows.set(row.code, row);
          }
        } catch (error) { failure = error; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(batchCount, 4) }, readNext));
    if (failure) throw failure;
    const stamp = new Date(now());
    const validQuotes = [...rows.values()].filter(row => {
      const age = stamp.getTime() - Date.parse(row.quoteUpdatedAt);
      return isEligible(row) && age >= -5 * 60_000 && age <= 10 * DAY;
    });
    if (validQuotes.length < codes.size * 0.75) throw new Error("有效行情不足名册的 75%（" + validQuotes.length + "/" + codes.size + "）");
    // A suspended stock may have an older last trade even when the provider serves a new snapshot.
    const exchangeZone = market === "美股" ? "America/New_York" : "Asia/Shanghai";
    const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: exchangeZone });
    const dateByTimestamp = new Map();
    function dayFor(row) {
      if (!dateByTimestamp.has(row.quoteUpdatedAt)) {
        dateByTimestamp.set(row.quoteUpdatedAt, dateFormat.format(new Date(row.quoteUpdatedAt)));
      }
      return dateByTimestamp.get(row.quoteUpdatedAt);
    }
    const dayCounts = new Map();
    for (const row of validQuotes) {
      const day = dayFor(row);
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    }
    const sessionDay = [...dayCounts].sort(([a, n], [b, m]) => m - n || b.localeCompare(a))[0][0];
    const current = validQuotes.filter(row => dayFor(row) === sessionDay);
    if (current.length < codes.size * 0.75) throw new Error("同一交易日的行情覆盖不足 75%");
    const liquid = current.filter(({ metrics }) => metrics.amount >= config.amountFloor && (market !== "美股" || metrics.price >= 3));
    const analysis = analyzeGrowthPool(liquid);
    return {
      ...info, source: "腾讯行情", quotedCount: current.length, scoredCount: analysis.scoredCount,
      qualifiedCount: analysis.candidates.length, quoteDate: sessionDay,
      fetchedAt: stamp.toISOString(), loadState: "fresh", stale: false, error: null,
      candidates: analysis.candidates.slice(0, 240).map(row => ({
        ...row, score: row.growthScore, components: row.growthComponents,
        band: row.growthScore >= 70 ? "priority" : "watch", topEligible: true,
        reasons: row.growthReasons, risks: row.growthRisks,
      })),
    };
  } catch (error) {
    throw Object.assign(new Error(label + "扫描失败：" + error.message), { code: "RADAR_SEGMENT_UNAVAILABLE", segmentInfo: info });
  }
}
