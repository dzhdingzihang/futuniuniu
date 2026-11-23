import assert from "node:assert/strict";
import test from "node:test";
import { capturePreopenReference, preparePreopen, publishPreopen, readPreopenMarket, runPreopenCycle, settlePreopen } from "../functions/lib/preopen-cycle.js";
import { intradaySession } from "../functions/lib/intraday-session.js";
import { createRadarScheduler } from "../workers/radar-scheduler/index.js";
import { readFile } from "node:fs/promises";

const market = "A股";
const date = "2026-11-16", previous = "2026-11-13";
const at = time => new Date(date + "T" + time + "Z");
const session = intradaySession(market,at("01:15:00"));
const members = Array.from({length:200},(_,i)=>({
  market, code:String(300001+i),name:"公司"+i,currency:"CNY",
  quoteUpdatedAt:previous+"T07:02:00Z",metrics:{price:100,open:95,high:100,low:94,amount:1e8,
    prevClose:95,changePct:i<3?9-i:1,return10d:7,return60d:12,volumeRatio:1.1,marketCap:1e9},
}));
const directory = {[market]:{codes:members.map(r=>r.code)}};
class KV {
  data = new Map();
  async put(k,v) { this.data.set(k,JSON.parse(v)); }
  async get(k) {
    if (Array.isArray(k)) return new Map(k.map(key=>[key,structuredClone(this.data.get(key) || null)]));
    return structuredClone(this.data.get(k) || null);
  }
}
const base = kv => ({kv,market,session});
const clock = time => () => at(time);
async function reference(kv,rows = members) {
  return capturePreopenReference({...base(kv),directory,referenceDate:previous,
    clock:()=>new Date(previous+"T07:35:00Z"), getRows:async()=>rows});
}
function fixtureReport(rows) {
  return {candidates:rows.map(r=>({code:r.code,name:r.name,prevClose:100,evidence:[],risk:""})),jumped:[],
    evidenceAvailable:true,sources:[],coverage:{referenceCount:200,eligibleCount:200,confirmedMissCount:200-rows.length,
      unresolvedCount:0,qualifyingCount:rows.length,missingReferenceCount:0,jumpedCount:0},reason:rows.length?"达标":"证据不足",observations:{}};
}
async function prepare(kv,slot,time,selected,override={}) {
  return preparePreopen({...base(kv),slot,clock:clock(time),build:async input=>{
    assert.equal(input.previousTradeDate,previous);
    assert.equal(input.rows.length,200);
    assert.equal(input.total,200);
    assert.equal(input.cutoffAt,date+"T01:25:00.000Z");
    return fixtureReport(selected);
  },...override});
}
const publish = (kv,time) => publishPreopen({...base(kv),clock:clock(time)});
const read = (kv,time) => readPreopenMarket(kv,market,clock(time));

test("latest pre-cutoff observation wins, publish retries cannot reseat a sealed pick and daily controls use the same frozen universe",async ()=>{
  const kv=new KV();
  await reference(kv);
  await prepare(kv,555,"01:15:05",[members[0]]);
  await prepare(kv,560,"01:20:03",[members[4]]);
  await prepare(kv,564,"01:24:07",[members[3]]);
  await publish(kv,"01:24:57");
  assert.equal((await read(kv,"01:24:59")).latest,null);
  await publish(kv,"01:25:03");
  const page=await read(kv,"01:25:07");
  assert.equal(page.phase,"frozen");
  assert.deepEqual(page.latest.candidates.map(r=>r.code),[members[3].code]);
  assert.deepEqual(page.latest.yesterdayLeaders.map(r=>r.code),members.slice(0,3).map(r=>r.code));
  assert.equal(Object.hasOwn(page.latest,"universe"),false);
  await publish(kv,"01:27:00");
  assert.deepEqual((await read(kv,"01:27:01")).latest,page.latest);
  const closeRows=members.map((r,i)=>({...r,quoteUpdatedAt:date+"T07:05:00Z",metrics:{...r.metrics,
    prevClose:100,open:i===0?106:100,high:i===3||i===0?107:103,low:99,price:i===0?106:101}}));
  const minuteCalls=[];
  const settle=(time,rows)=>settlePreopen({...base(kv),clock:clock(time),getRows:async()=>rows,
    getMinutes:async(m,c,d)=>{minuteCalls.push([m,c,d]);return [];}});
  await settle("07:05:00",closeRows);
  assert.equal((await read(kv,"07:06:00")).results.length,0);
  await settle("07:35:00",closeRows);
  await settle("07:55:00",[]);
  const after=await read(kv,"08:00:00");
  assert.equal(after.results.length,1);
  assert.deepEqual(minuteCalls,[[market,members[3].code,date]]);
  const {groups,rows}=after.results[0];
  assert.equal(groups.pool.verified,200);
  assert.equal(groups.pool.hits,2);
  assert.equal(groups.yesterdayLeaders.hits,1);
  assert.equal(groups.picks.hits,1);
  assert.equal(groups.picks.faded,1);
  assert.equal(rows[0].firstTouch.kind,"intraday");
  assert.equal(after.evaluation.days,1);
});

test("a real empty forecast is distinct from a missing forecast, and a delayed preparation cannot use post-cutoff material",async()=>{
  const kv=new KV();
  await reference(kv);
  await prepare(kv,555,"01:15:03",[]);
  const times=[at("01:24:55"),at("01:25:02")];
  await prepare(kv,564,"01:24:55",[members[0]],{clock:()=>times.shift() || at("01:25:02")});
  await publish(kv,"01:25:05");
  assert.equal((await read(kv,"01:26:00")).latest,null);
  await publish(kv,"01:28:05");
  const empty=(await read(kv,"01:29:00")).latest;
  assert.equal(empty.selectionStatus,"confirmed_empty");
  assert.match(empty.captureDiagnostics[0].reason,/超过截止/);
  assert.equal(empty.status,"frozen");
  assert.equal(empty.candidates.length,0);
  assert.equal(empty.frozenAt,date+"T01:15:03.000Z");
  const noFreeze=new KV();
  await publish(noFreeze,"01:28:02");
  assert.equal((await read(noFreeze,"01:26:00")).latest.status,"unavailable");
  assert.equal((await read(noFreeze,"01:26:00")).evaluation.days,0);
  const restart=new KV();
  await reference(restart);
  await prepare(restart,560,"01:20:00",[members[0]]);
  await publish(restart,"01:30:00");
  assert.equal((await read(restart,"01:30:01")).latest,null);
});

test("Saturday never publishes a ranking, and the next cutoff matches each exchange and early/late US daylight seasons",async()=>{
  const kv = new KV();
  const closed = new Date("2026-11-14T01:25:00Z");
  const calendar = JSON.parse(await readFile(new URL("../assets/radar-calendar.json",import.meta.url),"utf8"));
  await runPreopenCycle({env:{RADAR_SNAPSHOTS:kv},scheduledAt:closed,clock:()=>closed,calendar,
    fetcher:async()=>{throw Error("休市不应读取行情");}});
  assert.equal(kv.data.size,0);
  for(const [venue,expected] of [["A股","01:25"],["港股","01:25"],["美股","14:25"]]){
    const page=await readPreopenMarket(kv,venue,()=>new Date("2026-11-14T12:00:00Z"),calendar);
    assert.equal(page.marketPhase,"holiday");
    assert.equal(page.localDate,"2026-11-14");
    assert.equal(page.lastClosedDate,"2026-11-13");
    assert.equal(page.closeAt,null);
    assert.equal(page.nextCutoffAt,date+"T"+expected+":00.000Z");
    assert.equal(page.sessionDate,date);
    assert.equal(page.latest,null);
  }
  const dst=await readPreopenMarket(kv,"美股",()=>new Date("2026-08-10T11:00:00Z"),calendar);
  assert.equal(dst.cutoffAt,"2026-08-10T13:25:00.000Z");
});

test("shared cron dispatches only jobs due at this UTC tick",async()=>{
  const calls=[];
  const scheduler=createRadarScheduler(...["daily","intraday","preopen"].map(id=>async opts=>calls.push([id,opts])));
  const {triggers}=JSON.parse(await readFile(new URL("../workers/radar-scheduler/wrangler.jsonc",import.meta.url),"utf8"));
  const extraCronByMinute={22:2,23:3,28:2};
  for(const [time,expected] of [["00:10:00",["daily"]],["00:40:00",["daily"]],
    ["01:22:58",["preopen"]],["01:23:58",["preopen"]],["13:23:58",[]],["14:23:58",["preopen"]],["01:24:00",["preopen"]],["01:28:58",["preopen"]],["01:25:00",["intraday","preopen"]],["01:30:00",["intraday"]],
    ["07:35:00",["intraday","preopen"]],["01:45:00",["intraday"]]]) {
    calls.length=0;
    let done;
    const scheduled=at(time);
    const cronIndex=scheduled.getUTCHours()===0 ? 0 : extraCronByMinute[scheduled.getUTCMinutes()] ?? 1;
    scheduler.scheduled({cron:triggers.crons[cronIndex],scheduledTime:+scheduled},
      {RADAR_SNAPSHOTS:{}},{waitUntil:p=>{done=p;}});
    await done;
    assert.deepEqual(calls.map(c=>c[0]),expected,time);
    if(expected[0]==="daily") assert.equal(calls[0][1].recoveryOnly,time==="00:40:00");
  }
});

test("stale, not-yet-observed and pre-auction close prints cannot become the baseline", async () => {
  const kv = new KV();
  for (const stamp of [previous+"T06:59:59Z", previous+"T07:36:00Z", "2026-11-12T07:00:01Z"]) {
    await assert.rejects(reference(kv, members.map(row => ({...row, quoteUpdatedAt:stamp}))), /覆盖不足/);
  }
  assert.equal(kv.data.size, 0);
  const hk = "港股";
  const getRows = time => async () => members.map((r,i) => ({
    ...r, market:hk, currency:"HKD", code:String(1000+i).padStart(5,"0"), quoteUpdatedAt:previous+"T"+time+"Z"
  }));
  const rows = await getRows("08:08:30")();
  const opts = {kv,market:hk,referenceDate:previous,directory:{[hk]:{codes:rows.map(r=>r.code)}},
    clock:()=>new Date(previous+"T08:35:00Z")};
  await assert.rejects(capturePreopenReference({...opts,getRows:getRows("08:00:00")}), /覆盖不足/);
  assert.equal((await capturePreopenReference({...opts,getRows:getRows("08:08:30")})).rows.length,200);
});

test("an archived issue survives a failed latest-pointer write, and a later publication repairs that pointer", async () => {
  class PartialKV extends KV {
    failNextPointer = true;
    async put(k,v) {
      if (this.failNextPointer && k.endsWith(":latest")) {
        this.failNextPointer = false;
        throw new Error("simulated KV interruption");
      }
      return super.put(k,v);
    }
  }
  const kv = new PartialKV();
  await reference(kv);
  await prepare(kv,564,"01:24:12",[members[4]]);
  await assert.rejects(publish(kv,"01:25:01"), /simulated/);
  const archived = (await read(kv,"01:25:08")).latest;
  assert.equal(archived.candidates[0].code, members[4].code);
  await publish(kv,"01:25:24");
  const later = await readPreopenMarket(kv,market,()=>new Date("2026-11-17T00:55:00Z"));
  assert.deepEqual(later.latest,archived);
  assert.equal(later.phase,"waiting");
});

test("a later retry with weaker minute coverage cannot erase a previously verified first-touch interval", async () => {
  const kv = new KV();
  await reference(kv);
  await prepare(kv,564,"01:24:10",[members[4]]);
  await publish(kv,"01:25:02");
  const getRows = async () => members.map((r,i) => ({...r,quoteUpdatedAt:date+"T07:05:00Z",
    metrics:{...r.metrics,prevClose:100,open:100,high:i===4?106:103,low:98,price:101}}));
  const minutes = [{start:date+"T01:30:00Z",open:100,high:106,low:99,close:102,volume:1200}];
  const settle = (time,bars) => settlePreopen({...base(kv), clock:clock(time), getRows, getMinutes:async()=>bars});
  await settle("07:35:00",minutes);
  const early = (await read(kv,"07:36:00")).results[0].rows[0];
  assert.equal(early.firstTouch.kind,"interval");
  await settle("07:55:00",[]);
  const later = (await read(kv,"08:00:00")).results[0].rows[0];
  assert.deepEqual(later.firstTouch,early.firstTouch);
});

test("public radar exposes the actual closing session and restores its archive when the latest pointer belongs to an older date",async()=>{
  const kv=new KV();
  kv.data.set("preopen-v1:美股:latest",{tradeDate:"2026-11-24",status:"frozen",candidates:[]});
  kv.data.set("preopen-v1:美股:frozen:2026-11-27",{tradeDate:"2026-11-27",status:"unavailable",universe:[{code:"PRIVATE"}]});
  const halfDay=await readPreopenMarket(kv,"美股",()=>new Date("2026-11-27T18:01:00Z"));
  assert.equal(halfDay.marketPhase,"closed");
  assert.equal(halfDay.closeAt,"2026-11-27T18:00:00.000Z");
  assert.equal(halfDay.lastClosedDate,"2026-11-27");
  const weekend=await readPreopenMarket(kv,"美股",()=>new Date("2026-11-28T15:00:00Z"));
  assert.equal(weekend.lastClosedDate,"2026-11-27");
  assert.equal(weekend.lastClosedRecord.status,"unavailable");
  assert.equal(weekend.lastClosedRecord.universe,undefined);
});

test("incomplete sealed days use the same close for controls and never backfill forecasts",async()=>{
  const kv=new KV(), historyKey="preopen-v1:"+market+":history", refKey="preopen-v1:"+market+":ref:"+date;
  await reference(kv);
  await prepare(kv,564,"01:24:10",[],{build:async()=>{
    const partial=fixtureReport([]);
    partial.evidenceAvailable=false;
    partial.coverage.confirmedMissCount=3;
    partial.coverage.unresolvedCount=197;
    return partial;
  }});
  await publish(kv,"01:25:05");
  const getRows=async()=>members.map(row=>({...row,quoteUpdatedAt:date+"T07:05:00Z",
    metrics:{...row.metrics,open:100,prevClose:100,high:106,low:99,price:104}}));
  const now=clock("07:35:00");
  assert.equal((await read(kv,"07:34:59")).evaluation.days,0);
  await capturePreopenReference({...base(kv),directory,referenceDate:date,clock:now,getRows});
  const ref=structuredClone(kv.data.get(refKey));
  assert.equal((await read(kv,"07:34:59")).evaluation.days,0);
  const publicPage=await read(kv,"07:36:00");
  assert.deepEqual([publicPage.evaluation.days,publicPage.evaluation.incompleteDays,publicPage.evaluation.emptyDays],[1,1,0]);
  assert.equal(publicPage.results[0].groups.picks.hitRate,null);
  assert.equal(publicPage.results[0].groups.picks.count,0);
  assert.equal(publicPage.results[0].groups.pool.hits,200);
  assert.equal(kv.data.has(historyKey),false);
  for(const patch of [{referenceDate:previous},{closeAt:date+"T06:00:00Z"},{observedAt:date+"T07:14:59Z"},
    {rows:ref.rows.map(row=>({...row,quoteUpdatedAt:date+"T06:58:00Z"}))},
    {rows:ref.rows.map(row=>({...row,market:"港股"}))}]) {
    kv.data.set(refKey,{...ref,...patch});
    assert.equal((await read(kv,"07:36:00")).evaluation.days,0);
  }
  kv.data.set(refKey,ref);
  await settlePreopen({...base(kv),clock:now,getRows,getMinutes:()=>assert.fail("no picks")});
  assert.deepEqual(kv.data.get(historyKey),publicPage.results);
  assert.equal((await read(kv,"07:58:00")).evaluation.days,1);
  const missing=new KV();
  await publish(missing,"01:28:30");
  missing.data.set(refKey,ref);
  await settlePreopen({...base(missing),clock:now,getRows:()=>assert.fail("no sealed snapshot")});
  assert.equal((await read(missing,"07:58:00")).evaluation.days,0);
});

test("a delayed close cron captures the reference; an afternoon retry accepts delayed final timestamps",async()=>{
  const kv=new KV();
  const date="2026-11-20";
  const session=intradaySession(market,new Date(date+"T07:35:58Z"));
  const makeFetch=stamp=>async url=>{
    if(String(url).includes("radar-universe.json")) return Response.json(directory);
    if(String(url).includes("qt.gtimg.cn")) {
      const rows=members.map(({code})=>{
        const fields=Array(72).fill("");
        Object.assign(fields,{1:"企业",2:code,3:"100",4:"90",5:"91",30:stamp,32:"10",33:"101",34:"89",35:"1/2/100000000",45:"10"});
        return 'v_sz'+code+'="'+fields.join("~")+'";';
      });
      return new Response(rows.join("\n"));
    }
    throw Error("unexpected fetch "+url);
  };
  const calendar=JSON.parse(await readFile(new URL("../assets/radar-calendar.json",import.meta.url),"utf8"));
  const run=(time,stamp)=>{
    const tick=new Date(date+"T"+time+"Z");
    return runPreopenCycle({env:{RADAR_SNAPSHOTS:kv},scheduledAt:tick,clock:()=>tick,calendar,fetcher:makeFetch(stamp)});
  };
  await assert.rejects(run("07:35:58","20261120161400"),/覆盖不足/);
  const attempt=await kv.get("preopen-v1:A股:reference-attempt:"+session.tradeDate);
  assert.deepEqual(attempt.counts,{total:200,received:200,closing:0,usable:0});
  assert.equal(await kv.get("preopen-v1:A股:ref:"+date),null);
  await run("07:55:58","20261120155100");
  const id="preopen-v1:A股:ref:"+date;
  assert.equal((await kv.get(id)).rows.length,200);
  kv.data.delete(id);
  await run("08:45:58","20261120161400");
  assert.equal((await kv.get(id)).rows[0].quoteUpdatedAt,date+"T08:14:00.000Z");
});

test("missing previous close is reported for each sample and survives publication",async()=>{
  const kv=new KV();
  for(const [slot,time] of [[555,"01:15:58"],[562,"01:22:58"],[564,"01:24:58"]]){
    await prepare(kv,slot,time,[]);
  }
  await publish(kv,"01:25:58");
  assert.equal(await kv.get("preopen-v1:A股:frozen:"+date),null);
  await publish(kv,"01:28:58");
  const snapshot=(await read(kv,"01:29:30")).latest;
  assert.equal(snapshot.status,"unavailable");
  assert.equal(snapshot.selectionStatus,"unavailable");
  assert.deepEqual(snapshot.captureDiagnostics.map(a=>a.slot),[555,562,564]);
  assert.match(snapshot.reason,/前一交易日的有效收盘参考/);
});

test("all three markets capture at their own exchange-local 09:23",async()=>{
  const kv=new KV();
  const calendar=JSON.parse(await readFile(new URL("../assets/radar-calendar.json",import.meta.url),"utf8"));
  for (const time of ["01:23:58","14:23:58"]) {
    const tick=at(time);
    await runPreopenCycle({env:{RADAR_SNAPSHOTS:kv},scheduledAt:tick,clock:()=>tick,calendar});
  }
  assert.deepEqual([...kv.data.keys()].sort(),["A股","港股","美股"].map(m=>"preopen-v1:"+m+":attempt:"+date+":563").sort());
});

test("a US 09:23 scan is dispatched only at the local morning tick across the DST transition", async()=>{
  const calls=[];
  const scheduler=createRadarScheduler(...["daily","intraday","preopen"].map(id=>async()=>calls.push(id)));
  for (const [day,hour,expected] of [
    ["2026-10-30",13,["preopen"]],["2026-10-30",14,[]],
    ["2026-11-02",13,[]],["2026-11-02",14,["preopen"]],["2026-11-07",14,[]],
  ]) {
    calls.length=0;
    let done;
    scheduler.scheduled({scheduledTime:Date.parse(day+"T"+hour+":23:58Z")},{},{waitUntil:p=>{done=p;}});
    await done;
    assert.deepEqual(calls,expected,day+" "+hour);
  }
});

for(const [exchange,utcHour] of [["A股","01"],["港股","01"],["美股","14"]]) {
  test(exchange+" has an independent 09:23 baseline and uses the latest valid sample when 09:24 crosses cutoff",async()=>{
    const kv=new KV();
    const tick=ms=>at(utcHour+":"+ms);
    const opts={market:exchange,kv,session:intradaySession(exchange,tick("15:00"))};
    const prefix="preopen-v1:"+exchange+":";
    const code=members[0].code;
    await kv.put(prefix+"ref:"+previous,JSON.stringify({referenceDate:previous,observedAt:previous+"T23:00:00Z",
      total:members.length,rows:members}));
    await kv.put(prefix+"amounts:562",JSON.stringify([{date:previous,amounts:{[code]:500}}]));
    await preparePreopen({...opts,slot:562,clock:()=>tick("22:40"),build:async()=>fixtureReport([members[0]])});
    const times=[tick("23:58"),tick("24:09")];
    await preparePreopen({...opts,slot:563,clock:()=>times.shift(),build:async({historyAmounts,asOf})=>{
      assert.equal(historyAmounts[code],undefined);
      return {...fixtureReport([members[1]]),observations:{[code]:{amount:700,at:asOf}}};
    }});
    assert.deepEqual((await kv.get(prefix+"amounts:563"))[0].amounts,{[code]:700});
    assert.deepEqual((await kv.get(prefix+"amounts:562"))[0].amounts,{[code]:500});
    const late=[tick("24:58"),tick("25:09")];
    await preparePreopen({...opts,slot:564,clock:()=>late.shift(),build:async()=>fixtureReport([members[2]])});
    await publishPreopen({...opts,clock:()=>tick("28:40")});
    const saved=await kv.get(prefix+"frozen:"+date);
    assert.equal(saved.sampleMinute,563);
    assert.equal(saved.frozenAt,tick("24:09").toISOString());
    assert.deepEqual(saved.candidates.map(r=>r.code),[members[1].code]);
    assert.deepEqual(saved.captureDiagnostics.map(a=>a.slot),[564]);
  });
}

test("09:28 publication can recover a pre-cutoff stage that only becomes visible after 09:25",async()=>{
  const kv=new KV();
  await reference(kv);
  await prepare(kv,562,"01:22:58",[members[0]]);
  await publish(kv,"01:25:58");
  assert.equal(await kv.get("preopen-v1:A股:frozen:"+date),null);
  await prepare(kv,564,"01:24:59",[members[1]]);
  await publish(kv,"01:28:58");
  const snapshot=(await read(kv,"01:29:00")).latest;
  assert.equal(snapshot.candidates[0].code,members[1].code);
  assert.equal(snapshot.sampleMinute,564);
});

test("a newer incomplete sample with a verified prior jump supersedes an earlier pick",async()=>{
  const kv=new KV();
  await reference(kv);
  await prepare(kv,562,"01:22:58",[members[0]]);
  await prepare(kv,564,"01:24:50",[],{build:async()=>({
    ...fixtureReport([]),evidenceAvailable:false,jumped:[{code:members[0].code}],
    coverage:{referenceCount:200,eligibleCount:200,unresolvedCount:199,jumpedCount:1},
  })});
  await publish(kv,"01:25:58");
  const snapshot=(await read(kv,"01:26:10")).latest;
  assert.equal(snapshot.selectionStatus,"incomplete");
  assert.equal(snapshot.candidates.length,0);
  assert.equal(snapshot.jumped[0].code,members[0].code);
});

test("same-slot volume history preserves each provider basis and reads legacy numeric observations",async()=>{
  const kv=new KV();
  await reference(kv);
  const key="preopen-v1:A股:amounts:562", code=members[0].code;
  await kv.put(key,JSON.stringify([
    {date:"2026-11-12",amounts:{[code]:500}},
    {date:"2026-11-13",amounts:{[code]:{amount:1100,basis:"new-feed"}}}
  ]));
  await prepare(kv,562,"01:22:50",[],{build:async ({historyAmounts,asOf})=>{
    assert.deepEqual(historyAmounts[code],[{date:"2026-11-12",amount:500,basis:undefined},
      {date:"2026-11-13",amount:1100,basis:"new-feed"}]);
    return {...fixtureReport([]),observations:{[code]:{amount:1200,at:asOf,basis:"new-feed"}}};
  }});
  assert.deepEqual((await kv.get(key)).at(-1).amounts[code],{amount:1200,basis:"new-feed"});
});

test("a late Hong Kong reference retry splits slow lists, records acquisition errors and only saves a dated close once",async()=>{
  const kv=new KV(), market="港股", codes=Array.from({length:201},(_,i)=>String(i+1000).padStart(5,"0"));
  const requests=[];
  let responding=false;
  const fetcher=async url=>{
    if(String(url).includes("radar-universe.json")) return Response.json({[market]:{codes}});
    const symbols=new URL(url).pathname.split("q=")[1].split(",");
    requests.push(symbols.length);
    if(!responding) throw Error("The operation was aborted");
    return new Response(symbols.map(symbol=>{
      const fields=Array(72).fill("");
      Object.assign(fields,{1:"公司",2:symbol.slice(2),3:"10",4:"9",5:"9.5",30:date+" 16:08:25",32:"11.11",33:"10",34:"9",37:"1000000",45:"2"});
      return 'v_'+symbol+'="'+fields.join("~")+'";';
    }).join("\n"));
  };
  const calendar=JSON.parse(await readFile(new URL("../assets/radar-calendar.json",import.meta.url),"utf8"));
  const run=(time)=>runPreopenCycle({env:{RADAR_SNAPSHOTS:kv},scheduledAt:at(time),clock:clock(time),calendar,fetcher});
  await assert.rejects(run("09:35:58"),/收盘行情读取失败/);
  assert.match((await kv.get("preopen-v1:港股:reference-attempt:"+date)).reason,/aborted/);
  responding=true; requests.length=0;
  await run("13:35:58");
  assert.deepEqual(requests.sort((a,b)=>a-b),[1,100,100]);
  assert.equal((await kv.get("preopen-v1:港股:ref:"+date)).rows.length,codes.length);
  await run("13:55:58");
  assert.equal(requests.length,3);
});
