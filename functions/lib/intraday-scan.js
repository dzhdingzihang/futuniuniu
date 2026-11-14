import { normalizeRadarRow, isEligibleRadarCandidate } from "../api/radar.js";
import { GROWTH_SEGMENTS, loadGrowthDirectory, fetchSegmentMembers } from "./radar-segment.js";
import { intradaySession, loadSessionCalendar } from "./intraday-session.js";
import { evaluateIntradayPool } from "./radar-intraday.js";
import { planIntradaySettlement, recordIntradaySignals, settleIntradayDay, readIntradayEvaluation } from "./radar-intraday-evaluation.js";

export const MARKETS = Object.keys(GROWTH_SEGMENTS);
export const INTRADAY_VERSION = "intraday-v1";
const MINUTE = 60_000;
const SLOT = 5 * MINUTE;
const PREFIX = "radar:intraday:v1:";
const snapshotKey = market => PREFIX + market + ":latest";
const lastKey = market => PREFIX + market + ":last-signal";
const statsKey = market => PREFIX + market + ":evaluation";
const emptyEvaluation = {days:0,signalCount:0,verifiedCount:0,hitCount:0,hitRate:null,
  dayHitCount:0,afterHitCount:0,pendingCount:0,missingCount:0,unsettledDates:[]};
const baselineKey = (market, time) => PREFIX + market + ":base:" + Math.floor(time / SLOT);

export async function readIntradayMarket(kv, market, now, calendar) {
  const session = intradaySession(market, now, calendar);
  const { label, scope } = GROWTH_SEGMENTS[market];
  const [snapshot, lastSignal, storedStats] = await Promise.all([
    kv.get(snapshotKey(market), "json"), kv.get(lastKey(market), "json"),
    kv.get(statsKey(market), "json"),
  ]);
  const sameDay = snapshot?.sessionDate === session.tradeDate;
  const evaluation = {...(storedStats || emptyEvaluation)};
  // Daytime iterations persist the actual number of distinct public signals.
  // Add only the ones not yet represented by the most recent settlement summary.
  if (snapshot?.observedCount && (!evaluation.asOf || snapshot.scannedAt > evaluation.asOf)) {
    const pending = snapshot.observedCount;
    evaluation.signalCount += pending;
    if (now < new Date(snapshot.closeAt)) evaluation.pendingCount += pending;
    else evaluation.missingCount += pending;
  }
  const fresh = sameDay && snapshot.sessionKey === session.sessionKey && now - Date.parse(snapshot.scannedAt) >= 0 && now - Date.parse(snapshot.scannedAt) <= 8*MINUTE;
  const isOpen = session.phase === "trading";
  let status = "waiting", reason = "等待本市场开盘后建立盘中基线。";
  if (!session.calendarKnown) {
    status = "unavailable"; reason = "该交易日的市场日历尚待核对。";
  } else if (session.phase === "holiday" || session.phase === "closed") {
    status = "closed"; reason = session.phase === "holiday" ? "当地休市，当天没有新的盘中信号。" : "当地已收盘，本场信号进入收盘复核。";
  } else if (session.phase === "break") {
    status = "break"; reason = "午休暂停扫描，下午开盘后重新建立基线。";
  } else if (isOpen && fresh) {
    status = snapshot.status; reason = snapshot.reason;
  } else if (isOpen && sameDay && session.sessionKey === snapshot.sessionKey) {
    status = "stale"; reason = "盘中扫描超过 8 分钟未更新，等待新报价。";
  } else if (isOpen) {
    reason = "等待本交易时段的两轮可比报价。";
  }
  const live = isOpen && fresh && status === "live";
  return { market, label, scope, phase:isOpen ? "open" : session.phase, sessionDate:session.tradeDate,
    closeAt:session.closeAt, status, reason, scannedAt:sameDay ? snapshot.scannedAt : null,
    total:sameDay ? snapshot.total : null, quotedCount:sameDay ? snapshot.quotedCount : null,
    scoredCount:sameDay ? snapshot.scoredCount : null, candidates:live ? snapshot.candidates : [],
    lastSession:lastSignal && (!live || lastSignal.sessionDate !== session.tradeDate) ? lastSignal : null, evaluation };
}

async function recentBaseline(kv, market, when, session) {
  const keys = [1,2,3].map(lag => baselineKey(market,when-lag*SLOT));
  const values = await kv.get(keys,"json");
  return keys.map(k => values.get(k)).find(v => v?.tradeDate === session.tradeDate && v.sessionKey === session.sessionKey) || null;
}

export async function scanIntradayMarket({market, kv, scheduledAt, calendar, codes, fetcher = fetch, clock = () => new Date(), getRows = fetchSegmentMembers}) {
  const expected = intradaySession(market, scheduledAt, calendar);
  if (expected.phase !== "trading") return;
  const started = clock();
  if (Math.abs(started - scheduledAt) >= SLOT) return;
  let base = {market, sessionDate:expected.tradeDate, sessionKey:expected.sessionKey, total:codes.size,
    candidates:[], quotedCount:0, scoredCount:0, status:"unavailable", reason:"盘中报价暂不可用。"};
  let baseline, logScan = false;
  const priorState = await kv.get(snapshotKey(market),"json");
  const seenCodes = new Set(priorState?.sessionDate === expected.tradeDate ? priorState.seenCodes : []);
  base.closeAt = expected.closeAt;
  try {
    const [prior, members] = await Promise.all([
      recentBaseline(kv, market, +scheduledAt, expected),
      getRows({market,codes,fetcher,timeoutMs:8000,normalize:normalizeRadarRow}),
    ]);
    const now = clock(), session = intradaySession(market,now,calendar);
    if (session.phase !== "trading" || session.tradeDate !== expected.tradeDate || session.sessionKey !== expected.sessionKey || now-scheduledAt >= SLOT) return;
    const rows = members.filter(isEligibleRadarCandidate);
    const analysis = evaluateIntradayPool({market,rows,previousBaseline:prior,now,total:codes.size,sessionOverride:session});
    baseline = analysis.baseline;
    logScan = ["ready","weak_market"].includes(analysis.state);
    base.quotedCount = analysis.quotedCount;
    base.scoredCount = analysis.comparedCount;
    base.status = logScan ? "live" : analysis.state === "insufficient_quotes" ? "unavailable" : "waiting";
    base.reason = analysis.reason;
    base.candidates = analysis.candidates.slice(0,3).map((row,idx) => {
      const {price,prevClose,volumeRatio,dayChangePct,quotedAt} = row.signal;
      return {code:row.code,name:row.name,currency:row.currency,rank:idx+1,score:row.score,
        triggerPrice:price,triggerAt:now.toISOString(),quoteAt:quotedAt,prevClose,changePct:dayChangePct,volumeRatio,
        targetPrice:Math.max(prevClose*1.05,price*1.03),targetPct:row.signal.neededPct,
        reasons:row.reasons,risks:row.risks,signal:row.signal};
    });
  } catch (error) { base.reason = "本轮未取得可比较的完整行情。"; console.warn("Intraday feed",market,error.message); }
  const published = clock();
  if (published-scheduledAt >= SLOT || intradaySession(market,published,calendar).sessionKey !== expected.sessionKey) return;
  base.scannedAt = published.toISOString();
  if (logScan) await recordIntradaySignals(kv, {market,tradeDate:expected.tradeDate,scannedAt:base.scannedAt,
    closedAt:expected.closeAt,candidates:base.candidates});
  base.candidates.forEach(candidate => seenCodes.add(candidate.code));
  base.seenCodes = [...seenCodes];
  base.observedCount = seenCodes.size;
  const writes = [kv.put(snapshotKey(market),JSON.stringify(base),{expirationTtl:7*86400})];
  if (baseline && Object.keys(baseline.rows).length >= 30) writes.push(kv.put(baselineKey(market,+scheduledAt), JSON.stringify(baseline), {expirationTtl:1800}));
  if (base.candidates.length) writes.push(kv.put(lastKey(market), JSON.stringify({
    sessionDate:base.sessionDate,scannedAt:base.scannedAt,candidates:base.candidates,
  }),{expirationTtl:30*86400}));
  await Promise.all(writes);
}

export async function fetchSessionClose(market,code,tradeDate,fetcher) {
  const key = market === "美股" ? "us"+code+".OQ" : (market === "A股" ? "sz" : "hk")+code;
  const url = new URL("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get");
  // An unadjusted daily close has the same currency/share basis as that day's live quote.
  url.searchParams.set("param", key+",day,,,60,");
  const response = await fetcher(url,{signal:AbortSignal.timeout(6500),headers:{Referer:"https://gu.qq.com/"},cf:{cacheTtl:0}});
  if (!response.ok) { await response.body?.cancel(); return null; }
  const bars = (await response.json())?.data?.[key]?.day;
  const row = Array.isArray(bars) && bars.find(r => r[0] === tradeDate);
  if (!row) return null;
  const [open,close,hi,lo] = row.slice(1,5).map(Number);
  return [open,close,hi,lo].every(v => Number.isFinite(v) && v>0) && hi >= Math.max(open,close) && lo <= Math.min(open,close)
    ? {code,tradeDate,close,source:"腾讯不复权日线"} : null;
}

async function settleMarket(kv,market,session,now,calendar,fetcher) {
  // Today first. Then revisit older incomplete outcomes even if a run was missed.
  const asOf = now.toISOString();
  const summary = await readIntradayEvaluation(kv,{market,asOf,tradeDate:session.tradeDate});
  const dates = [...new Set([session.tradeDate,...(summary.unsettledDates || [])])].slice(0,4);
  let remaining = 12;
  for (const tradeDate of dates) {
    const historical = intradaySession(market,new Date(tradeDate+"T12:00:00Z"),calendar);
    if (!historical.closeAt || now-Date.parse(historical.closeAt)<20*MINUTE) continue;
    const args = {market,tradeDate,closedAt:historical.closeAt,asOf};
    const plan = await planIntradaySettlement(kv,{...args,limit:remaining});
    if (!plan.observed) continue;
    if (!plan.codes.length && plan.signals?.length) continue;
    const attemptedCodes = plan.codes;
    const result = await Promise.allSettled(attemptedCodes.map(code=>fetchSessionClose(market,code,tradeDate,fetcher)));
    const closes = result.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);
    await settleIntradayDay(kv,{...args,attemptedCodes,closes,signals:plan.signals});
    remaining -= attemptedCodes.length;
    if (!remaining) break;
  }
  const stats = await readIntradayEvaluation(kv,{market,asOf:now.toISOString()});
  await kv.put(statsKey(market),JSON.stringify(stats));
}

export async function runIntradayScan({env, scheduledAt=new Date(), clock=()=>new Date(), fetcher=fetch, calendar}) {
  const kv = env.RADAR_SNAPSHOTS;
  if (!kv) throw Error("缺少 RADAR_SNAPSHOTS");
  calendar ??= await loadSessionCalendar(fetcher,scheduledAt);
  let directory;
  const failures = [];
  for (const market of MARKETS) {
    const session = intradaySession(market,scheduledAt,calendar);
    try {
      if (session.phase === "trading") {
        directory ??= loadGrowthDirectory(fetcher,8000);
        const codes = new Set((await directory)?.[market]?.codes);
        if (codes.size < 200) throw Error("名册不足 200 只");
        await scanIntradayMarket({market,kv,scheduledAt,calendar,codes,fetcher,clock});
      } else if (session.phase === "closed" && session.closeAt) {
        const elapsed = Math.floor((scheduledAt-Date.parse(session.closeAt))/MINUTE);
        // Stagger Asian close work and bound the daily bar requests per invocation.
        if (elapsed >= 20 && elapsed <= 150 && elapsed % 15 === (market === "港股" ? 5 : 0))
          await settleMarket(kv,market,session,clock(),calendar,fetcher);
      }
    } catch (error) { failures.push(market+" "+error.message); }
  }
  if (failures.length) throw Error(failures.join(" / "));
}
