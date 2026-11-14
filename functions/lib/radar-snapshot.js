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
    && isRecord(value.markets)
    && (Number.isFinite(Date.parse(value.publishedAt))
      || (value.publishedAt === null && !Object.keys(value.markets).length))
    && Number.isFinite(Date.parse(value.attemptedAt))
    && isRecord(value.status)
    && Array.isArray(value.status.freshMarkets)
    && Array.isArray(value.status.staleMarkets)
    && Array.isArray(value.status.unavailableMarkets);
}

export async function readRadarSnapshotEnvelope(kv, { throwOnError = false } = {}) {
  if (!kv || typeof kv.get !== "function") return null;
  try {
    const stored = await kv.get(RADAR_SNAPSHOT_KEY);
    if (stored === null || stored === undefined || stored === "") return null;
    const value = typeof stored === "string" ? JSON.parse(stored) : stored;
    return isRadarSnapshotEnvelope(value) ? value : null;
  } catch (error) {
    if (throwOnError) throw error;
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

function isCurrentMarket(snapshot, attemptedAt) {
  if (!snapshot || snapshot.loadState !== "fresh" || snapshot.stale || !snapshot.candidates?.length) return false;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });
  const scanned = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(scanned) && date.format(scanned) === date.format(Date.parse(attemptedAt));
}

export async function refreshRadarSnapshots({ kv, scanMarket, now = () => new Date(), recoveryOnly = false }) {
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    throw new TypeError("缺少 RADAR_SNAPSHOTS KV 绑定");
  }
  if (typeof scanMarket !== "function") throw new TypeError("缺少机会雷达市场扫描函数");

  const previous = await readRadarSnapshotEnvelope(kv, { throwOnError: true });
  const attemptedAt = isoTimestamp(now());
  if (previous && Date.parse(previous.attemptedAt) > Date.parse(attemptedAt)) {
    return { written: false, envelope: previous, failedMarkets: [], failures: {} };
  }
  const markets = {};
  const freshMarkets = [];
  const staleMarkets = [];
  const unavailableMarkets = [];
  const failures = {};
  let scanned = 0;
  let published = false;

  for (const market of RADAR_SNAPSHOT_MARKETS) {
    const inherited = previous?.markets?.[market];
    if (recoveryOnly && isCurrentMarket(inherited, attemptedAt)
        && (!inherited.segment || inherited.segment.loadState === "fresh")) {
      markets[market] = inherited;
      freshMarkets.push(market);
      continue;
    }
    scanned++;
    try {
      const snapshot = await scanMarket(market, inherited);
      if (!isRecord(snapshot) || snapshot.market !== market || !Array.isArray(snapshot.candidates)
          || ((!snapshot.candidates.length || !Number.isFinite(Date.parse(snapshot.fetchedAt)))
             && snapshot.segment?.loadState !== "fresh" && snapshot.segment?.loadState !== "stale")) {
        throw Object.assign(new Error(`${market} 扫描结果结构无效`), { code: "RADAR_INVALID_SNAPSHOT" });
      }
      markets[market] = snapshot.loadState ? snapshot : freshSnapshot(snapshot);
      if (markets[market].loadState === "fresh" || snapshot.segment?.loadState === "fresh") published = true;
      if (snapshot.loadState === "stale" || snapshot.loadState === "unavailable") {
        (snapshot.loadState === "stale" ? staleMarkets : unavailableMarkets).push(market);
        failures[market] = snapshot.error;
      } else {
        freshMarkets.push(market);
      }
    } catch (error) {
      failures[market] = refreshError(error, attemptedAt);
      if (isRecord(inherited) && Array.isArray(inherited.candidates) && inherited.candidates.length) {
        markets[market] = staleSnapshot(inherited, error, attemptedAt);
        if (inherited.segment?.fetchedAt) markets[market].segment = staleSnapshot(inherited.segment, error, attemptedAt);
        staleMarkets.push(market);
      } else {
        unavailableMarkets.push(market);
      }
    }
  }

  const failedMarkets = RADAR_SNAPSHOT_MARKETS.filter((market) => failures[market]);
  if (!scanned) return { written: false, envelope: previous, failedMarkets, failures };

  const envelope = {
    schema: RADAR_SNAPSHOT_SCHEMA,
    publishedAt: published ? attemptedAt : previous?.publishedAt ?? null,
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
