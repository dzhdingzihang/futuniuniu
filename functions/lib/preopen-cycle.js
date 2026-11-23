import { normalizeRadarRow, isEligibleRadarCandidate } from "../api/radar.js";
import { adjacentTradingSession as adjacentPreopenSession, intradaySession, loadSessionCalendar } from "./intraday-session.js";
import { GROWTH_SEGMENTS, fetchSegmentMembers, loadGrowthDirectory } from "./radar-segment.js";
import { classifyPreopenSelection } from "./preopen-selection.js";
import { buildPreopenEvidence } from "./preopen-evidence.js";
import { canEvaluatePreopenArchive, evaluatePreopenDay, fetchPreopenTouchBars, summarizePreopenHistory } from "./preopen-outcomes.js";

export const PREOPEN_VERSION = "preopen-v1";
const minute = 60000;
const markets = Object.keys(GROWTH_SEGMENTS);
const exchangeDates = Object.fromEntries(markets.map(m => [m, new Intl.DateTimeFormat("sv-SE", {
  timeZone: m === "美股" ? "America/New_York" : m === "港股" ? "Asia/Hong_Kong" : "Asia/Shanghai"
})]));
const key = (market, suffix) => PREOPEN_VERSION + ":" + market + ":" + suffix;
// Exchange-local minutes. Each market and sampling minute has its own volume history.
export const preopenSampleMinutes = Object.freeze([555, 560, 562, 563, 564]);
const expiry = days => ({expirationTtl: days * 86400});

function atMinute(date, market, localMinute, calendar) {
  // UTC noon is on the requested local date in Shanghai, Hong Kong and New York.
  const noon = new Date(date + "T12:00:00Z");
  const session = intradaySession(market, noon, calendar);
  return new Date(+noon + (localMinute-session.localMinute)*minute);
}

export { adjacentPreopenSession };

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
  return {...published,selectionStatus:classifyPreopenSelection(frozen)};
}

async function loadRows(market,codes,fetcher,options={}) {
  return fetchSegmentMembers({market,codes:new Set(codes),fetcher,timeoutMs:7000,normalize:normalizeRadarRow,...options});
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
  // A slow batch after the Hong Kong close can be retried well before the next trading session.
  const options = market === "港股" ? {timeoutMs:15000,batchSize:100} : undefined;
  let rows;
  try { rows = await getRows(market,codes,fetcher,options); }
  catch(error) { throw new Error("收盘行情读取失败：" + error.message); }
  const observedAt = clock();
  const closing = rows.filter(row => isClosingQuote(row,market,session,+observedAt));
  const usable = closing.filter(({metrics:m})=>m.price>0 && m.marketCap>0 && m.amount>0 && Number.isFinite(m.changePct));
  const valid = usable.map(row=>{
    const entry=compactRef(row);
    if(!isEligibleRadarCandidate(row)) entry.excluded=true;
    return entry;
  });
  if (usable.length<codes.length*0.65) {
    throw Object.assign(Error("同一交易日的收盘参考覆盖不足"), {
      counts:{total:codes.length,received:rows.length,closing:closing.length,usable:usable.length}
    });
  }
  const ref={referenceDate,closeAt:session.closeAt,observedAt:observedAt.toISOString(),total:codes.length,codes,rows:valid};
  await put(kv,market,"ref:"+referenceDate,ref,14);
  return ref;
}

function candidateEvidence(row) {
  return {...row, prevClose:row.prevClose, evidence:(row.evidence || []).map(e=>({...e,
    type:e.type || e.kind, source:e.source || e.provider || e.label})),risk:row.risk || row.risks?.join("；") || ""};
}

export async function preparePreopen({market,kv,session,slot,calendar,clock,fetcher,build=buildPreopenEvidence}) {
  const date=session.tradeDate, previous=adjacentPreopenSession(market,date,calendar,-1);
  const diagnose = (reason, at) => put(kv,market,"attempt:"+date+":"+slot,{
    stage:"sample",slot,at,reason,referenceDate:previous?.tradeDate
  },14);
  if (!previous) return diagnose("交易日历缺少前一交易日。",clock().toISOString());
  const cutoffAt=atMinute(date,market,565,calendar).toISOString();
  const ref=await get(kv,market,"ref:"+previous.tradeDate);
  if (!ref?.rows?.length || ref.referenceDate!==previous.tradeDate) return diagnose("采样时未读到前一交易日的有效收盘参考。",clock().toISOString());
  const history=await get(kv,market,"amounts:"+slot) || [];
  const historyAmounts=Object.create(null);
  for(const past of history.filter(v=>v.date<date)){
    for(const [code,value] of Object.entries(past.amounts)) {
      const point=typeof value==="number" ? {amount:value} : value;
      if(Number.isFinite(point?.amount) && point.amount>0)
        (historyAmounts[code] ??= []).push({date:past.date,amount:point.amount,basis:point.basis});
    }
  }
  const asOf=clock().toISOString();
  if (asOf>=cutoffAt) return diagnose("采样开始时已经到达截止时间。",asOf);
  if (!(Date.parse(ref.observedAt)<=Date.parse(asOf))) return diagnose("收盘参考的取得时间无法验证。",asOf);
  let report;
  try {
    report=await build({market,tradeDate:date,cutoffAt,asOf,previousCloseAt:previous.closeAt,
      previousTradeDate:previous.tradeDate,total:ref.total,rows:ref.rows,historyAmounts,fetcher});
  } catch(error) {
    await diagnose("盘前来源读取失败："+error.message.slice(0,180),clock().toISOString());
    throw error;
  }
  const frozenAt=clock().toISOString();
  if (frozenAt>cutoffAt) return diagnose("采样完成时超过截止时间，已弃用该份输入。",frozenAt);
  const priced=ref.rows.map(r=>({code:r.code,name:r.name,prevClose:r.metrics.price,changePct:r.metrics.changePct}));
  const byCode=new Map(priced.map(r=>[r.code,r]));
  const universe=(ref.codes || [...byCode.keys()]).map(code=>byCode.get(code) || {code,name:code,prevClose:null});
  const leaders=ref.rows.filter(r=>!r.excluded).map(r=>byCode.get(r.code)).sort((a,b)=>b.changePct-a.changePct||a.code.localeCompare(b.code)).slice(0,3);
  const staged={modelVersion:PREOPEN_VERSION,market,tradeDate:date,cutoffAt,frozenAt,observedAt:asOf,referenceDate:ref.referenceDate,
    total:ref.total,sampleMinute:slot,evidenceAvailable:report.evidenceAvailable===true,universe,yesterdayLeaders:leaders,candidates:report.candidates.map(candidateEvidence),
    jumped:report.jumped.map(candidateEvidence),sources:report.sources,coverage:report.coverage,reason:report.reason};
  await put(kv,market,"stage:"+date+":"+slot,staged,2);
  const amounts=Object.fromEntries(Object.entries(report.observations || {}).filter(([,v])=>
    Number.isFinite(v?.amount) && v.amount>0 && Date.parse(v.at)<=Date.parse(asOf)).map(([code,v])=>[code,v.basis ? {amount:v.amount,basis:v.basis} : v.amount]));
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
  const previous=adjacentPreopenSession(market,date,calendar,-1);
  const stageKeys=preopenSampleMinutes.map(slot=>key(market,"stage:"+date+":"+slot));
  const diagnosticKeys=preopenSampleMinutes.map(slot=>key(market,"attempt:"+date+":"+slot));
  if(previous) diagnosticKeys.unshift(key(market,"reference-attempt:"+previous.tradeDate));
  const values=await kv.get([...stageKeys,...diagnosticKeys],"json");
  const prepared=stageKeys.map((k,i)=>({slot:preopenSampleMinutes[i],value:values.get(k)}))
    .filter(({value:v})=>v?.tradeDate===date && v.cutoffAt===cutoff.toISOString() && Date.parse(v.frozenAt)<=+cutoff)
    .sort((a,b)=>b.value.frozenAt.localeCompare(a.value.frozenAt));
  // A just-written KV stage (and cached "missing" reads) can take time to propagate.
  // The retry may publish only inputs which had already finished by the original cutoff.
  if(!prepared.some(p=>p.slot===564) && +started<+cutoff+2*minute) return;
  // A newer observation can show that a former pick already jumped. Never restore a superseded ranking.
  const latest=prepared[0]?.value;
  const publishedAt=clock().toISOString();
  if(Date.parse(publishedAt)>=+cutoff+5*minute) return;
  const captureDiagnostics=diagnosticKeys.map(k=>values.get(k)).filter(Boolean);
  const lastAttempt=captureDiagnostics.at(-1);
  const record=latest ? {...latest,status:latest.evidenceAvailable===true ? "frozen" : "unavailable",publishedAt,captureDiagnostics} : {
    modelVersion:PREOPEN_VERSION,market,status:"unavailable",tradeDate:date,cutoffAt:cutoff.toISOString(),publishedAt,
    reason:lastAttempt ? "截至盘前截止时间未取得可冻结输入。"+lastAttempt.reason : "截止前未取得一份可审计的盘前输入，未收到采样记录。",
    captureDiagnostics,sources:[],candidates:[],jumped:[]};
  // One date is authoritative. Readers can still find it if the convenience pointer write fails.
  await put(kv,market,archive,record,180);
  await put(kv,market,"latest",publicSnapshot(record),180);
}

function closingBars(rows,market,session,observedAt) {
  return rows.filter(r=>r?.market===market && isClosingQuote(r,market,session,observedAt) && r.metrics?.amount>0).map(r=>({
    code:r.code,market,tradeDate:session.tradeDate,prevClose:r.metrics.prevClose,open:r.metrics.open,
    close:r.metrics.price,high:r.metrics.high,low:r.metrics.low}));
}

async function incompleteFromClosingReference({kv,market,session,frozen,ref,now,calendar}) {
  const date=session.tradeDate;
  if(frozen?.status!=="unavailable" || frozen.market!==market || frozen.tradeDate!==date || !canEvaluatePreopenArchive(frozen,calendar)) return null;
  ref ??= await get(kv,market,"ref:"+date);
  const observedAt=Date.parse(ref?.observedAt);
  if(ref?.referenceDate!==date || ref.closeAt!==session.closeAt || !Number.isFinite(observedAt)
    || observedAt<Date.parse(session.closeAt)+15*minute || observedAt>+now || !Array.isArray(ref.rows)) return null;
  return evaluatePreopenDay({frozen,bars:closingBars(ref.rows,market,session,observedAt),closedAt:session.closeAt,asOf:ref.observedAt,calendar});
}

function withLatestSettlement(history,result) {
  return [...history.filter(r=>r.tradeDate!==result.tradeDate),result].sort((a,b)=>b.tradeDate.localeCompare(a.tradeDate)).slice(0,20);
}

async function recoverIncompleteSettlement({kv,market,clock,calendar},session,ref) {
  if(!ref) return;
  const date=session.tradeDate;
  const history=await get(kv,market,"history") || [];
  if(history.some(row=>row.tradeDate===date)) return;
  const frozen=await get(kv,market,"frozen:"+date);
  const result=await incompleteFromClosingReference({kv,market,session,frozen,ref,now:clock(),calendar});
  if(!result) return;
  // Normal settlement owns any existing result. Preserve other dates and merge onto the latest history.
  const latest=await get(kv,market,"history") || [];
  if(!latest.some(row=>row.tradeDate===date)) await put(kv,market,"history",withLatestSettlement(latest,result),180);
}

export async function settlePreopen({market,kv,session,calendar,clock,fetcher,getRows=loadRows,getMinutes=fetchPreopenTouchBars}) {
  const frozen=await get(kv,market,"frozen:"+session.tradeDate);
  if(+clock()<Date.parse(session.closeAt)+20*minute || frozen?.market!==market || frozen.tradeDate!==session.tradeDate
    || !canEvaluatePreopenArchive(frozen,calendar)) return;
  const rows=await getRows(market,frozen.universe.map(r=>r.code),fetcher);
  const observedAt=+clock();
  const bars=closingBars(rows,market,session,observedAt);
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
  await put(kv,market,"history",withLatestSettlement(old,result),180);
}

export async function readPreopenMarket(kv,market,clock,calendar) {
  const now=clock(), current=intradaySession(market,now,calendar);
  const target=current.closeAt ? current : adjacentPreopenSession(market,current.tradeDate,calendar,1);
  const date=target?.tradeDate,cutoff=date && atMinute(date,market,565,calendar);
  const lastClosed = current.calendarKnown && (current.phase === "closed" ? current : adjacentPreopenSession(market,current.tradeDate,calendar,-1));
  const lastClosedDate = lastClosed?.tradeDate || null;
  const [today,prior,history]=await Promise.all([date ? get(kv,market,"frozen:"+date) : null,get(kv,market,"latest"),get(kv,market,"history")]);
  let results=history || [];
  const latest=publicSnapshot(today || prior);
  const needsArchive = lastClosedDate && lastClosedDate !== date && lastClosedDate !== latest?.tradeDate && !today;
  const missingSettlement=lastClosedDate && !results.some(entry=>entry.tradeDate===lastClosedDate);
  // Between midnight and the recovery tick the latest pointer has no private membership.
  const needsFullRecord=missingSettlement && latest?.tradeDate===lastClosedDate && latest.status==="unavailable" && !today;
  const lastRecord = needsArchive || needsFullRecord ? await get(kv,market,"frozen:"+lastClosedDate) : null;
  if(missingSettlement) {
    const frozen=lastClosedDate===date ? today : lastRecord;
    const verified=await incompleteFromClosingReference({kv,market,session:lastClosed,frozen,now,calendar});
    if(verified) results=withLatestSettlement(results,verified);
  }
  let phase="waiting",reason="等待交易日盘前冻结名单。";
  if(!cutoff){phase="unavailable";reason="交易日历待更新。";}
  else if(today){phase=today.status;reason=today.reason;}
  else if(+now>=+cutoff+5*minute){phase="missed";reason="本交易日没有在开盘前冻结的记录，不事后补选。";}
  const next=cutoff && (+now<+cutoff ? target : adjacentPreopenSession(market,date,calendar,1));
  return {market,label:GROWTH_SEGMENTS[market].label,scope:GROWTH_SEGMENTS[market].scope,
    localDate:current.tradeDate,marketPhase:current.calendarKnown ? current.phase : "unknown",closeAt:current.closeAt,
    lastClosedDate,lastClosedRecord:lastClosedDate !== latest?.tradeDate ? publicSnapshot(lastRecord) : null,
    sessionDate:date || null,cutoffAt:cutoff?.toISOString() || null,
    nextCutoffAt:next ? atMinute(next.tradeDate,market,565,calendar).toISOString() : null,
    phase,reason,total:latest?.total ?? null,latest,results,evaluation:summarizePreopenHistory(results)};
}

export async function runPreopenCycle({env,scheduledAt,clock=()=>new Date(),fetcher=fetch,calendar}){
  const kv=env.RADAR_SNAPSHOTS;
  calendar ??= await loadSessionCalendar(fetcher,scheduledAt);
  let directory;
  const failures=[];
  async function tryReference(opts,referenceDate) {
    const existing=await get(kv,opts.market,"ref:"+referenceDate);
    if(existing) return existing;
    try {
      directory ??=loadGrowthDirectory(fetcher,12000).catch(error=>{throw new Error("候选名册读取失败：" + error.message);});
      return await capturePreopenReference({...opts,referenceDate,directory:await directory});
    } catch(error) {
      await put(kv,opts.market,"reference-attempt:"+referenceDate,{
        stage:"reference",at:clock().toISOString(),referenceDate,reason:error.message.slice(0,180),counts:error.counts
      },14);
      failures.push(opts.market+" 收盘参考 "+error.message);
    }
  }
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
          const previous=adjacentPreopenSession(market,session.tradeDate,calendar,-1);
          if(previous) await tryReference(opts,previous.tradeDate);
        }
        return;
      }
      if(slot===550) {
        const previous=adjacentPreopenSession(market,session.tradeDate,calendar,-1);
        if(previous) {
          const ref=await tryReference(opts,previous.tradeDate);
          await recoverIncompleteSettlement(opts,previous,ref);
        }
      } else if(preopenSampleMinutes.includes(slot)){
        await preparePreopen({...opts,slot});
      } else if(slot===565 || slot===568) {
        await publishPreopen(opts);
      } else if(session.phase==="closed"){
        const afterClose=Math.floor((scheduledAt-Date.parse(session.closeAt))/minute);
        if(afterClose===35 || afterClose===55){
          await tryReference(opts,session.tradeDate);
          await settlePreopen(opts);
        } else if(market==="港股" && [95,335,355].includes(afterClose)) {
          const ref=await tryReference(opts,session.tradeDate);
          await recoverIncompleteSettlement(opts,session,ref);
        } else if(market==="A股" && [105,155].includes(afterClose)) {
          // The mainland provider can stamp a whole closing batch after 16:00 local time.
          const ref=await tryReference(opts,session.tradeDate);
          await recoverIncompleteSettlement(opts,session,ref);
        }
      }
    } catch(error){failures.push(market+" "+error.message);}
  }));
  if(failures.length) throw Error(failures.join(" / "));
}
