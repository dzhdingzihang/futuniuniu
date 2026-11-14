// Immutable scan and verification events. Overlapping jobs write different keys;
// their first signal per stock is derived when reading, without a KV read/modify/write.
const PREFIX = "radar:intraday-eval:v1:";
const venues = {
  "A股": { id: "cn", zone: "Asia/Shanghai", currency: "CNY", hour: 15 },
  "港股": { id: "hk", zone: "Asia/Hong_Kong", currency: "HKD", hour: 16 },
  "美股": { id: "us", zone: "America/New_York", currency: "USD", hour: 16 },
};
const byteEncoder = new TextEncoder();
const DAYS = 20;
const MAX_BATCH = 12;
const positive = value => Number.isFinite(value) && value > 0;

function instant(value) {
  if (value === null || value === undefined || value === "") throw new TypeError("缺少验证时刻");
  return new Date(value).toISOString();
}

function marketPrefix(market) {
  if (!Object.hasOwn(venues, market)) throw new TypeError("未知证券市场");
  return PREFIX + venues[market].id + ":";
}

function reverseDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || instant(date).slice(0, 10) !== date) throw new TypeError("交易日格式无效");
  return String(99999999 - Number(date.replaceAll("-", ""))).padStart(8, "0");
}

function localDate(timestamp, market) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: venues[market].zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(timestamp));
}

function sessionClose(market, tradeDate, closedAt) {
  if (closedAt != null) {
    const close = instant(closedAt);
    if (localDate(close, market) !== tradeDate) throw new TypeError("收盘时刻与交易日不一致");
    return close;
  }
  // Explicit exchange close times supplied by the caller take priority on shortened sessions.
  const { zone, hour } = venues[market];
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(tradeDate + "T16:00:00Z"));
  const offset = Number(parts.find(part => part.type === "timeZoneName").value.slice(3));
  return instant(tradeDate + "T" + String(hour - offset).padStart(2, "0") + ":00:00Z");
}

function validCode(market, code) {
  if (typeof code !== "string") return false;
  if (market === "港股") return /^\d{5}$/.test(code);
  if (market === "A股") return /^\d{6}$/.test(code);
  return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(code);
}

// Store small, provider-independent tuples in key metadata. Listing a day or the
// newest 20 market sessions needs no per-stock KV reads. Metadata is limited to 1 KiB.
async function appendEvent(kv, market, day, at, kind, closeAt, rows) {
  const prefix = marketPrefix(market) + reverseDate(day) + ":";
  const metadata = { d: day, t: at, k: kind, e: closeAt, r: rows };
  const binary = byteEncoder.encode(JSON.stringify(metadata));
  if (binary.length > 1000) {
    if (rows.length < 2) throw new TypeError("单条验证事件超出大小限制");
    const cut = Math.ceil(rows.length / 2);
    await Promise.all([rows.slice(0,cut),rows.slice(cut)].map(part => appendEvent(kv, market, day, at, kind, closeAt, part)));
    return;
  }
  const digest = await crypto.subtle.digest("SHA-256", binary);
  const suffix = Array.from(new Uint8Array(digest).slice(0, 12), n => n.toString(16).padStart(2, "0")).join("");
  await kv.put(prefix + at + ":" + kind + ":" + suffix, "1", { metadata });
}

export async function recordIntradaySignals(kv, { market, tradeDate, scannedAt, closedAt, candidates }) {
  marketPrefix(market);
  const at = instant(scannedAt);
  const end = sessionClose(market, tradeDate, closedAt);
  if (!Array.isArray(candidates)) throw new TypeError("缺少盘中候选列表");
  if (localDate(at, market) !== tradeDate || at >= end) return { recorded: false };
  const seen = new Set();
  const rows = [];
  for (const [index, c] of candidates.slice(0, 3).entries()) {
    const signalAt = instant(c.triggerAt);
    if (!validCode(market, c.code) || !positive(c.prevClose) || !positive(c.triggerPrice)
        || localDate(signalAt, market) !== tradeDate || signalAt > at) throw new TypeError("盘中信号缺少可核实的价格或时刻");
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    rows.push([c.code, String(c.name || c.code).slice(0, 120), index + 1, Number.isFinite(c.score) ? c.score : null,
      c.triggerPrice, c.prevClose, signalAt]);
  }
  await appendEvent(kv, market, tradeDate, at, "s", end, rows);
  return { recorded: true, count: rows.length };
}

async function* events(kv, market, day, asOf) {
  const prefix = marketPrefix(market) + (day ? reverseDate(day) + ":" : "");
  let cursor;
  do {
    const page = await kv.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const key of page.keys) {
      const event = key.metadata;
      if (event && event.t <= asOf && Array.isArray(event.r)) yield event;
    }
    if (page.list_complete) break;
    if (!page.cursor || page.cursor === cursor) throw new Error("盘中记录分页读取不完整");
    cursor = page.cursor;
  } while (cursor);
}

function newDay(day, closeAt) {
  return { day, closeAt, observed: false, first: new Map(), tried: new Map(), closes: new Map() };
}

function applyEvent(state, event, market) {
  if (event.k === "s") {
    state.observed = true;
    for (const [code,name,rank,score,triggerPrice,prevClose,triggerAt] of event.r) {
      const old = state.first.get(code);
      // Rank the time the signal was actually made visible, even if a later scan
      // receives an earlier timestamp from the quote provider.
      if (old && (old.scannedAt < event.t || (old.scannedAt === event.t && old.rank <= rank))) continue;
      state.first.set(code, { code, name, rank, score, triggerPrice, prevClose, triggerAt, scannedAt: event.t,
        currency: venues[market].currency });
    }
  } else if (event.k === "c") {
    for (const [code, close, source] of event.r) {
      if (!state.tried.has(code) || event.t > state.tried.get(code)) state.tried.set(code, event.t);
      if (positive(close) && source) {
        const old = state.closes.get(code);
        if (!old || event.t < old.verifiedAt) state.closes.set(code, { close, source, verifiedAt: event.t });
      }
    }
  }
}

async function readDay(kv, market, day, asOf, closedAt) {
  const state = newDay(day, closedAt || null);
  for await (const event of events(kv, market, day, asOf)) {
    state.closeAt = closedAt || event.e;
    applyEvent(state, event, market);
  }
  return state;
}

export async function loadIntradaySignals(kv, { market, tradeDate, asOf = new Date() }) {
  const state = await readDay(kv, market, tradeDate, instant(asOf));
  return [...state.first.values()];
}

export async function planIntradaySettlement(kv, { market, tradeDate, closedAt, asOf = new Date(), limit = MAX_BATCH }) {
  marketPrefix(market);
  const at = instant(asOf);
  const end = sessionClose(market, tradeDate, closedAt);
  const state = await readDay(kv, market, tradeDate, at, end);
  const signals = [...state.first.values()];
  const missing = signals.filter(row => !state.closes.has(row.code)).sort((a, b) =>
    (state.tried.get(a.code) || "").localeCompare(state.tried.get(b.code) || "")
    || a.scannedAt.localeCompare(b.scannedAt) || a.rank - b.rank || a.code.localeCompare(b.code));
  return { signals, observed: state.observed, verifiedCount: signals.length - missing.length, missingCount: missing.length,
    codes: at >= end ? missing.slice(0, Math.max(0, Math.min(MAX_BATCH, limit))).map(row => row.code) : [] };
}

export async function settleIntradayDay(kv, { market, tradeDate, closedAt, asOf = new Date(), closes = [], attemptedCodes, signals }) {
  marketPrefix(market);
  const at = instant(asOf);
  const end = sessionClose(market, tradeDate, closedAt);
  if (at < end) return { written: false, acceptedCount: 0 };
  const first = signals || await loadIntradaySignals(kv, { market, tradeDate, asOf: at });
  const codes = new Set(first.map(c => c.code));
  const attempts = [...new Set(attemptedCodes || closes.map(row => row.code))].filter(code => codes.has(code));
  if (!attempts.length) return { written: false, acceptedCount: 0 };
  if (attempts.length > MAX_BATCH) throw new RangeError("单批收盘验证最多 12 只");
  const accepted = new Map();
  for (const c of closes) {
    if (c.tradeDate === tradeDate && positive(c.close) && typeof c.source === "string" && c.source.trim()
        && (!c.market || c.market === market) && (!c.verifiedAt || instant(c.verifiedAt) <= at)) {
      accepted.set(c.code, [c.code, c.close, c.source.trim().slice(0,100)]);
    }
  }
  const rows = attempts.map(code => accepted.get(code) || [code, null, null]);
  await appendEvent(kv, market, tradeDate, at, "c", end, rows);
  return { written: true, acceptedCount: rows.filter(row => positive(row[1])).length };
}

function rate(hits, count) {
  return count ? Math.round(hits * 10000 / count) / 100 : null;
}

// Take at most 20 observed, mature market sessions plus today's ongoing session.
// Reverse market-date keys allow historical scans to stop at the window boundary.
export async function readIntradayEvaluation(kv, { market, asOf = new Date() }) {
  const at = instant(asOf);
  const stateByDay = new Map();
  let matureDays = 0;
  for await (const event of events(kv, market, null, at)) {
    let state = stateByDay.get(event.d);
    if (!state) {
      if (matureDays >= DAYS) break;
      state = newDay(event.d, event.e);
      stateByDay.set(event.d, state);
    }
    if (!state.observed && event.k === "s" && at >= state.closeAt) matureDays++;
    applyEvent(state, event, market);
  }
  const result = { asOf: at, days: 0, signalCount: 0, verifiedCount: 0, hitCount: 0, dayHitCount: 0, afterHitCount: 0,
    pendingCount: 0, missingCount: 0, unsettledDates: [] };
  for (const state of stateByDay.values()) {
    if (!state.observed) continue;
    result.signalCount += state.first.size;
    if (at < state.closeAt) {
      result.pendingCount += state.first.size;
      continue;
    }
    result.days++;
    let missing = 0;
    for (const row of state.first.values()) {
      const verified = state.closes.get(row.code);
      if (!verified) { missing++; continue; }
      // Compare in multiplied units so that an exact +5.00%/+3.00% counts.
      const dailyHit = verified.close * 100 + 1e-9 >= row.prevClose * 105;
      const afterHit = verified.close * 100 + 1e-9 >= row.triggerPrice * 103;
      result.verifiedCount++;
      if (dailyHit) result.dayHitCount++;
      if (afterHit) result.afterHitCount++;
      if (dailyHit && afterHit) result.hitCount++;
    }
    if (missing) result.unsettledDates.push(state.day);
    result.missingCount += missing;
  }
  return { ...result, hitRate: rate(result.hitCount, result.verifiedCount),
    dayHitRate: rate(result.dayHitCount, result.verifiedCount), afterHitRate: rate(result.afterHitCount, result.verifiedCount) };
}
