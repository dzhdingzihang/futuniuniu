import { normalizeRadarRow, isEligibleRadarCandidate } from "../api/radar.js";
import { intradaySession, loadSessionCalendar } from "./intraday-session.js";
import { GROWTH_SEGMENTS, fetchSegmentMembers, loadGrowthDirectory } from "./radar-segment.js";
import { buildPreopenEvidence } from "./preopen-evidence.js";
import { evaluatePreopenDay, fetchPreopenTouchBars, summarizePreopenHistory } from "./preopen-outcomes.js";

export const PREOPEN_VERSION = "preopen-v1";
const minute = 60000;
const day = 86400000;
const markets = Object.keys(GROWTH_SEGMENTS);
const exchangeDates = Object.fromEntries(markets.map(m => [m, new Intl.DateTimeFormat("sv-SE", {
  timeZone: m === "美股" ? "America/New_York" : m === "港股" ? "Asia/Hong_Kong" : "Asia/Shanghai"
})]));
const key = (market, suffix) => PREOPEN_VERSION + ":" + market + ":" + suffix;
const sampleMinutes = [555, 560, 564]; // 09:15, 09:20 and 09:24 in each exchange's time zone.
const expiry = days => ({expirationTtl: days * 86400});

function atMinute(date, market, localMinute, calendar) {
  // UTC noon is on the requested local date in Shanghai, Hong Kong and New York.
  const noon = new Date(date + "T12:00:00Z");
  const session = intradaySession(market, noon, calendar);
  return new Date(+noon + (localMinute-session.localMinute)*minute);
}

function nextSession(market, date, calendar, direction) {
  const noon = Date.parse(date + "T12:00:00Z");
  for (let i = 1; i <= 20; i++) {
    const next = intradaySession(market,new Date(noon+i*direction*day),calendar);
    if (!next.calendarKnown) return null;
    if (next.closeAt) return next;
  }
  return null;
}

const get = (kv,m,id) => kv.get(key(m,id),"json");
const put = (kv,m,id,v,ttl) => kv.put(key(m,id),JSON.stringify(v),expiry(ttl));

function compactRef(row) {
  const {price,high,low,amount,prevClose,open,changePct,return10d,return60d,volumeRatio,marketCap} = row.metrics;
  return {code:row.code,name:row.name,currency:row.currency,market:row.market,quoteUpdatedAt:row.quoteUpdatedAt,
    metrics:{price,high,low,amount,prevClose,open,changePct,return10d,return60d,volumeRatio,marketCap}};
}

function publicSnapshot(frozen) {
  if (!frozen) return null;
  const {universe, ...published} = frozen;
  return published;
}

async function loadRows(market,codes,fetcher) {
  return fetchSegmentMembers({market,codes:new Set(codes),fetcher,timeoutMs:7000,normalize:normalizeRadarRow});
}

function isClosingQuote(row, market, session, observedAt) {
  const stamp = Date.parse(row.quoteUpdatedAt);
  // Hong Kong's random uncross occurs 8–10 minutes after continuous trading ends.
  const earliest = Date.parse(session.closeAt) + (market === "港股" ? 8 * minute : 0);
  return stamp >= earliest && stamp <= observedAt && exchangeDates[market].format(stamp) === session.tradeDate;
}

export async function capturePreopenReference({market,referenceDate,calendar,directory,kv,clock,fetcher,getRows=loadRows}) {
  const session = intradaySession(market,new Date(referenceDate+"T12:00:00Z"),calendar);
  if (!session.closeAt || +clock()<Date.parse(session.closeAt)+15*minute) return null;
  const codes = directory?.[market]?.codes;
  if (!Array.isArray(codes) || codes.length<200) throw Error("缺少官方候选名册");
  const rows = await getRows(market,codes,fetcher);
  const observedAt = clock();
  const valid = rows.filter(r=>isClosingQuote(r,market,session,+observedAt) && isEligibleRadarCandidate(r)
    && r.metrics.amount>0 && Number.isFinite(r.metrics.changePct)).map(compactRef);
  if (valid.length<codes.length*0.65) throw Error("同一交易日的收盘参考覆盖不足");
  const ref={referenceDate,closeAt:session.closeAt,observedAt:observedAt.toISOString(),total:codes.length,codes,rows:valid};
  await put(kv,market,"ref:"+referenceDate,ref,14);
  return ref;
}

function candidateEvidence(row) {
  return {...row, prevClose:row.prevClose, evidence:(row.evidence || []).map(e=>({...e,
    type:e.type || e.kind, source:e.source || e.provider || e.label})),risk:row.risk || row.risks?.join("；") || ""};
}

export async function preparePreopen({market,kv,session,slot,calendar,clock,fetcher,build=buildPreopenEvidence}) {
  const date=session.tradeDate, previous=nextSession(market,date,calendar,-1);
  if (!previous) return;
  const cutoffAt=atMinute(date,market,565,calendar).toISOString();
  const ref=await get(kv,market,"ref:"+previous.tradeDate);
  if (!ref?.rows?.length || ref.referenceDate!==previous.tradeDate) return;
  const history=await get(kv,market,"amounts:"+slot) || [];
  const historyAmounts=Object.create(null);
  for(const past of history.filter(v=>v.date<date)){
    for(const [code,amount] of Object.entries(past.amounts)) (historyAmounts[code] ??= []).push({date:past.date,amount});
  }
  const asOf=clock().toISOString();
  if (asOf>=cutoffAt || !(Date.parse(ref.observedAt)<=Date.parse(asOf))) return;
  const report=await build({market,tradeDate:date,cutoffAt,asOf,previousCloseAt:previous.closeAt,
    previousTradeDate:previous.tradeDate,rows:ref.rows,historyAmounts,fetcher});
  const frozenAt=clock().toISOString();
  if (frozenAt>cutoffAt) return;
  const priced=ref.rows.map(r=>({code:r.code,name:r.name,prevClose:r.metrics.price,changePct:r.metrics.changePct}));
  const byCode=new Map(priced.map(r=>[r.code,r]));
  const universe=(ref.codes || [...byCode.keys()]).map(code=>byCode.get(code) || {code,name:code,prevClose:null});
  const leaders=priced.slice().sort((a,b)=>b.changePct-a.changePct||a.code.localeCompare(b.code)).slice(0,3);
  const staged={modelVersion:PREOPEN_VERSION,market,tradeDate:date,cutoffAt,frozenAt,observedAt:asOf,referenceDate:ref.referenceDate,
    total:ref.total,evidenceAvailable:report.evidenceAvailable!==false,universe,yesterdayLeaders:leaders,candidates:report.candidates.map(candidateEvidence),
    jumped:report.jumped.map(candidateEvidence),sources:report.sources,coverage:report.coverage,reason:report.reason};
  await put(kv,market,"stage:"+date+":"+slot,staged,2);
  const amounts=Object.fromEntries(Object.entries(report.observations || {}).filter(([,v])=>
    Number.isFinite(v?.amount) && v.amount>0 && Date.parse(v.at)<=Date.parse(asOf)).map(([code,v])=>[code,v.amount]));
  if(Object.keys(amounts).length) await put(kv,market,"amounts:"+slot,[...history.filter(v=>v.date<date),{date,amounts}].slice(-10),40);
}

export async function publishPreopen({market,kv,session,calendar,clock}) {
  const date=session.tradeDate,cutoff=atMinute(date,market,565,calendar),started=clock();
  if (+started < +cutoff || +started >= +cutoff+5*minute) return;
  const archive="frozen:"+date;
  const existing=await get(kv,market,archive);
  if(existing) {
    const pointer=await get(kv,market,"latest");
    if(!pointer || pointer.tradeDate<date) await put(kv,market,"latest",publicSnapshot(existing),180);
    return;
  }
  const keys=sampleMinutes.map(slot=>key(market,"stage:"+date+":"+slot));
  const values=await kv.get(keys,"json");
  const prepared=[...values.values()].filter(v=>v?.tradeDate===date && v.cutoffAt===cutoff.toISOString()
    && Date.parse(v.frozenAt)<=+cutoff).sort((a,b)=>b.frozenAt.localeCompare(a.frozenAt));
  const latest=prepared.find(v=>v.evidenceAvailable!==false) || prepared[0];
  const publishedAt=clock().toISOString();
  if(Date.parse(publishedAt)>=+cutoff+5*minute) return;
  const record=latest ? {...latest,status:latest.evidenceAvailable===false ? "unavailable" : "frozen",publishedAt} : {
    modelVersion:PREOPEN_VERSION,market,status:"unavailable",tradeDate:date,cutoffAt:cutoff.toISOString(),publishedAt,
    reason:"截止前未取得一份可审计的盘前输入，本期跳过预测。",sources:[],candidates:[],jumped:[]};
  // One date is authoritative. Readers can still find it if the convenience pointer write fails.
  await put(kv,market,archive,record,180);
  await put(kv,market,"latest",publicSnapshot(record),180);
}

export async function settlePreopen({market,kv,session,calendar,clock,fetcher,getRows=loadRows,getMinutes=fetchPreopenTouchBars}) {
  const frozen=await get(kv,market,"frozen:"+session.tradeDate);
  if(frozen?.status!=="frozen" || +clock()<Date.parse(session.closeAt)+20*minute) return;
  const rows=await getRows(market,frozen.universe.map(r=>r.code),fetcher);
  const observedAt=+clock();
  const bars=rows.filter(r=>isClosingQuote(r,market,session,observedAt) && r.metrics.amount>0).map(r=>({
      code:r.code,tradeDate:session.tradeDate,prevClose:r.metrics.prevClose,open:r.metrics.open,close:r.metrics.price,high:r.metrics.high,low:r.metrics.low}));
  const args={frozen,bars,closedAt:session.closeAt,asOf:clock().toISOString(),calendar};
  let result=evaluatePreopenDay(args);
  if(!result) return;
  const touches=result.rows.filter(r=>r.groups.includes("picks")&&r.hit&&!r.openHit);
  if(touches.length){
    const entries=await Promise.all(touches.map(async r=>[r.code,await getMinutes(market,r.code,session.tradeDate,fetcher)]));
    result=evaluatePreopenDay({...args,minutesByCode:Object.fromEntries(entries)});
  }
  const old=await get(kv,market,"history") || [];
  const prior=old.find(r=>r.tradeDate===session.tradeDate);
  if(prior) {
    const groups=Object.keys(result.groups);
    const regressed=groups.some(k=>prior.groups[k].verified>result.groups[k].verified);
    const oldDetails=prior.rows.filter(r=>r.status==="verified");
    const nextDetails=new Map(result.rows.filter(r=>r.status==="verified").map(r=>[r.code,r]));
    if(regressed || oldDetails.some(r=>!nextDetails.has(r.code))) return;
    for(const row of oldDetails) {
      const next=nextDetails.get(row.code);
      if(row.firstTouch?.kind==="interval" && next.firstTouch?.kind==="intraday"
        && row.high===next.high && row.open===next.open && row.prevClose===next.prevClose) next.firstTouch=row.firstTouch;
    }
    if(groups.every(k=>prior.groups[k].verified===result.groups[k].verified)
      && JSON.stringify(result.rows)===JSON.stringify(prior.rows) && JSON.stringify(result.groups)===JSON.stringify(prior.groups)) return;
  }
  const history=[...old.filter(r=>r.tradeDate!==session.tradeDate),result].sort((a,b)=>b.tradeDate.localeCompare(a.tradeDate)).slice(0,20);
  await put(kv,market,"history",history,180);
}

export async function readPreopenMarket(kv,market,clock,calendar) {
  const now=clock(), current=intradaySession(market,now,calendar);
  const target=current.closeAt ? current : nextSession(market,current.tradeDate,calendar,1);
  const date=target?.tradeDate,cutoff=date && atMinute(date,market,565,calendar);
  const [today,prior,results]=await Promise.all([date ? get(kv,market,"frozen:"+date) : null,get(kv,market,"latest"),get(kv,market,"history")]);
  const latest=publicSnapshot(today || prior);
  let phase="waiting",reason="等待交易日盘前冻结名单。";
  if(!cutoff){phase="unavailable";reason="交易日历待更新。";}
  else if(today){phase=today.status;reason=today.reason;}
  else if(+now>=+cutoff+5*minute){phase="missed";reason="本交易日没有在开盘前冻结的记录，不事后补选。";}
  const next=cutoff && (+now<+cutoff ? target : nextSession(market,date,calendar,1));
  return {market,label:GROWTH_SEGMENTS[market].label,scope:GROWTH_SEGMENTS[market].scope,
    sessionDate:date || null,cutoffAt:cutoff?.toISOString() || null,
    nextCutoffAt:next ? atMinute(next.tradeDate,market,565,calendar).toISOString() : null,
    phase,reason,total:latest?.total ?? null,latest,results:results || [],evaluation:summarizePreopenHistory(results || [])};
}

export async function runPreopenCycle({env,scheduledAt,clock=()=>new Date(),fetcher=fetch,calendar}){
  const kv=env.RADAR_SNAPSHOTS;
  calendar ??= await loadSessionCalendar(fetcher,scheduledAt);
  let directory;
  const failures=[];
  // Independent clocks: the two Asian boards must stage before the same cutoff.
  await Promise.all(markets.map(async market=>{
    const session=intradaySession(market,scheduledAt,calendar);
    if(Math.abs(clock()-scheduledAt)>=4*minute) return;
    const opts={market,kv,session,calendar,clock,fetcher};
    const slot=session.localMinute;
    try {
      if(!session.closeAt) {
        // Seed the last real close during a weekend or holiday for the next opening.
        // Only reference prices are stored here. Preparing a forecast requires a trading day.
        if(session.calendarKnown && scheduledAt.getUTCHours()===8 && scheduledAt.getUTCMinutes()===35) {
          const previous=nextSession(market,session.tradeDate,calendar,-1);
          if(previous && !await get(kv,market,"ref:"+previous.tradeDate)) {
            directory ??=loadGrowthDirectory(fetcher,7000);
            await capturePreopenReference({...opts,referenceDate:previous.tradeDate,directory:await directory});
          }
        }
        return;
      }
      if(slot===550) {
        const previous=nextSession(market,session.tradeDate,calendar,-1);
        if(!previous || await get(kv,market,"ref:"+previous.tradeDate)) return;
        directory ??=loadGrowthDirectory(fetcher,7000);
        await capturePreopenReference({...opts,referenceDate:previous.tradeDate,directory:await directory});
      } else if(sampleMinutes.includes(slot)){
        await preparePreopen({...opts,slot});
      } else if(slot===565) {
        await publishPreopen(opts);
      } else if(session.phase==="closed"){
        const afterClose=Math.round((scheduledAt-Date.parse(session.closeAt))/minute);
        if(afterClose===35 || afterClose===55){
          if(afterClose===35 || !await get(kv,market,"ref:"+session.tradeDate)) {
            directory ??=loadGrowthDirectory(fetcher,7000);
            try {await capturePreopenReference({...opts,referenceDate:session.tradeDate,directory:await directory});}
            catch(error){failures.push(market+" 收盘参考 "+error.message);}
          }
          await settlePreopen(opts);
        }
      }
    } catch(error){failures.push(market+" "+error.message);}
  }));
  if(failures.length) throw Error(failures.join(" / "));
}
