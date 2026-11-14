// All three groups use the same frozen membership and the same unadjusted daily price basis.
import { intradaySession } from "./intraday-session.js";

const GROUPS = ["picks", "pool", "yesterdayLeaders"];
const COUNTS = ["count", "verified", "missing", "hits", "openHits", "intradayHits", "held", "faded"];
const FIVE_MIN = 300_000;

function stamp(value) {
  if (value instanceof Date) return value.getTime();
  return typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : NaN;
}

const positive = v => typeof v === "number" && Number.isFinite(v) && v > 0;
const round = x => Math.round(x * 100) / 100;
const pct = (part, total) => total ? round(100 * part / total) : null;
const reached = (price, previous) => price * 100 >= previous * 105 - Number.EPSILON * previous * 105 * 4;
const samePrice = (a, b) => positive(a) && positive(b) && Math.abs(a-b) <= Math.max(a,b) * 1e-8;
const validBar = b => b && [b.open,b.high,b.low,b.close].every(positive)
  && b.high >= Math.max(b.open,b.close) && b.low <= Math.min(b.open,b.close);

// Only a gap-free sequence from the opening print can locate the first crossing.
// Opening auctions are included through the official daily open; HK closing auction
// may be absent from continuous-session 5m bars and therefore have unknown time.
function touchInterval(bars, openAt, closeAt, market, previous, daily) {
  if (!Array.isArray(bars) || !bars.length) return {kind:"intraday"};
  const byTime = new Map();
  for (const bar of bars) {
    const t = stamp(bar.start);
    if (t < openAt || t >= closeAt || !Number.isFinite(t) || (t-openAt)%FIVE_MIN) continue;
    if (byTime.has(t)) return {kind:"intraday"};
    byTime.set(t, bar);
  }
  const first = byTime.get(openAt);
  // Unadjusted intraday and daily series must agree on their opening price.
  if (!positive(first?.open) || Math.abs(first.open-daily.open) > daily.open*2e-7) return {kind:"intraday"};
  const breakStart = market === "港股" ? 150 : 120;
  for (let t = openAt; t + FIVE_MIN <= closeAt; t += FIVE_MIN) {
    const minutes = (t - openAt)/60_000;
    if (market !== "美股" && minutes >= breakStart && minutes < 210) continue;
    const bar = byTime.get(t);
    if (!validBar(bar) || !positive(bar.volume) || bar.high > daily.high * (1 + 2e-7)
        || bar.low < daily.low * (1 - 2e-7)) break;
    if (reached(bar.high,previous)) {
      return {kind:"interval",start:new Date(t).toISOString(),end:new Date(t+FIVE_MIN).toISOString()};
    }
  }
  return {kind:"intraday"};
}

export async function fetchPreopenTouchBars(market, code, tradeDate, fetcher=fetch) {
  const valid = market === "A股" ? /^\d{6}$/ : market === "港股" ? /^\d{5}$/ : /^[A-Z][A-Z0-9.-]{0,14}$/;
  const day = Date.parse(tradeDate+"T00:00:00Z");
  if (!["A股","港股","美股"].includes(market) || !valid.test(code) || !Number.isFinite(day)) return [];
  const symbol = market === "A股" ? code+".SZ" : market === "港股" ? Number(code).toString().padStart(4,"0")+".HK" : code.replaceAll(".","-");
  const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol));
  url.search = new URLSearchParams({period1:String(day/1000),period2:String(day/1000+86400),interval:"5m",includePrePost:"false"}).toString();
  try {
    const response = await fetcher(url,{signal:AbortSignal.timeout(5000),headers:{"User-Agent":"Mozilla/5.0"}});
    if (!response.ok) { await response.body?.cancel(); return []; }
    const data = (await response.json())?.chart?.result?.[0];
    if (data?.meta?.symbol?.toUpperCase() !== symbol.toUpperCase() || data.meta.dataGranularity !== "5m") return [];
    const q = data.indicators?.quote?.[0];
    return (data.timestamp || []).flatMap((time,i) => {
      if (!Number.isInteger(time) || !q || time < day/1000 || time >= day/1000+86400) return [];
      return [{start:new Date(time*1000).toISOString(),open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:q.close?.[i],volume:q.volume?.[i]}];
    });
  } catch { return []; }
}

function counts() {
  return {count:0,verified:0,missing:0,hits:0,openHits:0,intradayHits:0,held:0,faded:0};
}

function rates(c) {
  return {...c,hitRate:pct(c.hits,c.verified),coveragePct:pct(c.verified,c.count)};
}

function assess(member, bar, details, context) {
  let reason = "";
  if (!bar || !validBar(bar)) reason = "当日完整行情缺失或不一致";
  else if (!samePrice(member.prevClose,bar.prevClose)) reason = "昨收口径无法核对";
  else if (bar.volume != null && !positive(bar.volume)) reason = "当日成交无法核实";
  if (reason) return {status:"missing",reason,firstTouch:{kind:"unknown"}};

  const previous = bar.prevClose;
  const hit = reached(bar.high,previous);
  const openHit = reached(bar.open,previous);
  const held = reached(bar.close,previous);
  const outcome = {status:"verified",hit,openHit,held,faded:hit && !held};
  if (!details) return outcome;
  const firstTouch = !hit ? {kind:"none"} : openHit ? {kind:"open"} :
    touchInterval(context.minutesByCode[member.code],context.openAt,context.closeAt,context.market,previous,bar);
  return {...outcome,prevClose:previous,open:bar.open,high:bar.high,low:bar.low,close:bar.close,
    highChangePct:round(100*(bar.high/previous-1)),closeChangePct:round(100*(bar.close/previous-1)),
    openToClosePct:round(100*(bar.close/bar.open-1)),firstTouch};
}

function addRow(count, result) {
  count.count++;
  if (result.status !== "verified") { count.missing++; return; }
  count.verified++;
  if (result.hit) count.hits++;
  if (result.openHit) count.openHits++;
  if (result.hit && !result.openHit) count.intradayHits++;
  if (result.held) count.held++;
  if (result.faded) count.faded++;
}

export function evaluatePreopenDay({frozen,bars,closedAt,asOf,minutesByCode={},calendar}) {
  if (frozen?.status !== "frozen" || !["A股","港股","美股"].includes(frozen.market)) return null;
  const seal = stamp(frozen.frozenAt), cutoff = stamp(frozen.cutoffAt), publish = stamp(frozen.publishedAt);
  const closeAt = stamp(closedAt), knownAt = stamp(asOf), openAt = cutoff+FIVE_MIN;
  if (![seal,cutoff,publish,closeAt,knownAt].every(Number.isFinite)
      || seal > cutoff || publish < cutoff || publish >= openAt || closeAt <= openAt || knownAt < closeAt) return null;
  const session = intradaySession(frozen.market,cutoff,calendar);
  if (!session.calendarKnown || session.phase !== "preopen" || session.tradeDate !== frozen.tradeDate
      || session.localMinute !== 565 || cutoff % 60000 || stamp(session.closeAt) !== closeAt
      || intradaySession(frozen.market,seal,calendar).tradeDate !== frozen.tradeDate) return null;
  if (!Array.isArray(frozen.universe) || !frozen.universe.length || !Array.isArray(frozen.candidates)
      || !Array.isArray(frozen.yesterdayLeaders) || !Array.isArray(bars)) return null;
  const members = new Map(frozen.universe.map(member => [member.code,member]));
  if (members.size !== frozen.universe.length) return null;
  const groups = {picks:counts(),pool:counts(),yesterdayLeaders:counts()};
  const groupsByCode = new Map();
  for (const [group,values] of [["picks", frozen.candidates], ["yesterdayLeaders", frozen.yesterdayLeaders]]) {
    if (values.length > 3 || new Set(values.map(v => v.code)).size !== values.length) return null;
    for (const [i,v] of values.entries()) {
      if (!members.has(v.code)) return null;
      const ranks = groupsByCode.get(v.code) || {};
      ranks[group] = i+1;
      groupsByCode.set(v.code,ranks);
    }
  }
  const byCode = new Map();
  for (const bar of bars) {
    if (!bar || bar.tradeDate !== frozen.tradeDate || (bar.market && bar.market !== frozen.market)) continue;
    // An ambiguous listing or conflicting source needs a fresh quote on retry.
    if (byCode.has(bar.code)) byCode.set(bar.code,null);
    else byCode.set(bar.code,bar);
  }
  const rows = [];
  const context = {market:frozen.market,openAt,closeAt,minutesByCode};
  for (const member of members.values()) {
    const ranks = groupsByCode.get(member.code);
    const outcome = assess(member,byCode.get(member.code),Boolean(ranks),context);
    addRow(groups.pool,outcome);
    if (ranks) {
      for (const key of Object.keys(ranks)) addRow(groups[key],outcome);
      rows.push({code:member.code,name:member.name,groups:Object.keys(ranks),ranks,...outcome});
    }
  }
  rows.sort((a,b) => (a.ranks.picks ?? 9)-(b.ranks.picks ?? 9) || (a.ranks.yesterdayLeaders ?? 9)-(b.ranks.yesterdayLeaders ?? 9));
  return {market:frozen.market,tradeDate:frozen.tradeDate,asOf:new Date(knownAt).toISOString(),rows,
    groups:Object.fromEntries(GROUPS.map(key=>[key,rates(groups[key])]))};
}

export function summarizePreopenHistory(results, limit=20) {
  const byDate = new Map();
  let market;
  for (const result of results || []) {
    if (!result?.tradeDate || !result.groups || !GROUPS.every(k => result.groups[k])) continue;
    if (market && market !== result.market) throw new Error("按市场分别汇总盘前预测成绩");
    market = result.market;
    const existing = byDate.get(result.tradeDate);
    if (!existing || stamp(result.asOf) > stamp(existing.asOf)) byDate.set(result.tradeDate,result);
  }
  const dates = [...byDate.keys()].sort().reverse().slice(0,Math.max(0,limit));
  const groups = Object.fromEntries(GROUPS.map(k=>[k,counts()]));
  let emptyDays = 0;
  for (const date of dates) {
    const day = byDate.get(date);
    if (!day.groups.picks.count) emptyDays++;
    for (const key of GROUPS) {
      for (const metric of COUNTS) groups[key][metric] += day.groups[key][metric];
    }
  }
  return {market,days:dates.length,emptyDays,fromDate:dates.at(-1) || null,toDate:dates[0] || null,
    groups:Object.fromEntries(GROUPS.map(key=>[key,rates(groups[key])]))};
}
