export const RADAR_SNAPSHOT_KEY = "radar:latest:v1";
export const RADAR_SNAPSHOT_SCHEMA = "radar-snapshot-v2";
export const RADAR_SNAPSHOT_MARKETS = Object.freeze(["A股", "港股", "美股"]);

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("机会雷达快照时间无效");
  return date.toISOString();
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isRadarSnapshotEnvelope(value) {
  return isRecord(value)
    && value.schema === RADAR_SNAPSHOT_SCHEMA
    && typeof value.publishedAt === "string"
    && typeof value.attemptedAt === "string"
    && isRecord(value.markets)
    && isRecord(value.status)
    && Array.isArray(value.status.freshMarkets)
    && Array.isArray(value.status.staleMarkets)
    && Array.isArray(value.status.unavailableMarkets);
}

export async function readRadarSnapshotEnvelope(kv) {
  if (!kv || typeof kv.get !== "function") return null;
  try {
    const stored = await kv.get(RADAR_SNAPSHOT_KEY);
    if (stored === null || stored === undefined || stored === "") return null;
    const value = typeof stored === "string" ? JSON.parse(stored) : stored;
    return isRadarSnapshotEnvelope(value) ? value : null;
  } catch (_error) {
    return null;
  }
}

function refreshError(error, attemptedAt) {
  return {
    code: typeof error?.code === "string" && error.code ? error.code : "RADAR_REFRESH_FAILED",
    message: typeof error?.message === "string" && error.message ? error.message : "机会雷达市场扫描失败",
    at: attemptedAt,
  };
}

function freshSnapshot(snapshot) {
  return {
    ...snapshot,
    loadState: "fresh",
    stale: false,
    error: null,
  };
}

function staleSnapshot(snapshot, error, attemptedAt) {
  return {
    ...snapshot,
    loadState: "stale",
    stale: true,
    error: refreshError(error, attemptedAt),
  };
}

export async function refreshRadarSnapshots({ kv, scanMarket, now = () => new Date() }) {
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    throw new TypeError("缺少 RADAR_SNAPSHOTS KV 绑定");
  }
  if (typeof scanMarket !== "function") throw new TypeError("缺少机会雷达市场扫描函数");

  const previous = await readRadarSnapshotEnvelope(kv);
  const attemptedAt = isoTimestamp(now());
  const markets = {};
  const freshMarkets = [];
  const staleMarkets = [];
  const unavailableMarkets = [];
  const failures = {};

  for (const market of RADAR_SNAPSHOT_MARKETS) {
    try {
      const snapshot = await scanMarket(market);
      if (!isRecord(snapshot) || snapshot.market !== market || !Array.isArray(snapshot.candidates)) {
        throw Object.assign(new Error(`${market} 扫描结果结构无效`), { code: "RADAR_INVALID_SNAPSHOT" });
      }
      markets[market] = freshSnapshot(snapshot);
      freshMarkets.push(market);
    } catch (error) {
      failures[market] = refreshError(error, attemptedAt);
      const inherited = previous?.markets?.[market];
      if (isRecord(inherited) && Array.isArray(inherited.candidates)) {
        markets[market] = staleSnapshot(inherited, error, attemptedAt);
        staleMarkets.push(market);
      } else {
        unavailableMarkets.push(market);
      }
    }
  }

  const failedMarkets = RADAR_SNAPSHOT_MARKETS.filter((market) => failures[market]);
  if (!freshMarkets.length) {
    return {
      written: false,
      envelope: previous,
      failedMarkets,
      failures,
    };
  }

  const envelope = {
    schema: RADAR_SNAPSHOT_SCHEMA,
    publishedAt: attemptedAt,
    attemptedAt,
    markets,
    status: { freshMarkets, staleMarkets, unavailableMarkets },
  };
  await kv.put(RADAR_SNAPSHOT_KEY, JSON.stringify(envelope));
  return {
    written: true,
    envelope,
    failedMarkets,
    failures,
  };
}
