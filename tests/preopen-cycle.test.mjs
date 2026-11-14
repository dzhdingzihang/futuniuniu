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
    sources:[],coverage:{total:200},reason:rows.length?"达标":"证据不足",observations:{}};
}
async function prepare(kv,slot,time,selected,override={}) {
  return preparePreopen({...base(kv),slot,clock:clock(time),build:async input=>{
    assert.equal(input.previousTradeDate,previous);
    assert.equal(input.rows.length,200);
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
  const empty=(await read(kv,"01:26:00")).latest;
  assert.equal(empty.status,"frozen");
  assert.equal(empty.candidates.length,0);
  assert.equal(empty.frozenAt,date+"T01:15:03.000Z");
  const noFreeze=new KV();
  await publish(noFreeze,"01:25:02");
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
  for(const [time,expected] of [["00:10:00",["daily"]],["00:40:00",["daily"]],
    ["01:24:00",["preopen"]],["01:25:00",["intraday","preopen"]],["01:30:00",["intraday"]],
    ["07:35:00",["intraday","preopen"]],["01:45:00",["intraday"]]]) {
    calls.length=0;
    let done;
    const scheduled=at(time);
    scheduler.scheduled({cron:triggers.crons[scheduled.getUTCHours()===0 ? 0 : 1],scheduledTime:+scheduled},
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
  await prepare(kv,560,"01:20:12",[members[4]]);
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
  await prepare(kv,560,"01:20:10",[members[4]]);
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
