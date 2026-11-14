import test from "node:test";
import assert from "node:assert/strict";
import {
  recordIntradaySignals, loadIntradaySignals, planIntradaySettlement, settleIntradayDay, readIntradayEvaluation,
} from "../functions/lib/radar-intraday-evaluation.js";

class Kv {
  entries = new Map();
  async put(name, value, {metadata}) {
    assert.ok(new TextEncoder().encode(JSON.stringify(metadata)).length <= 1024);
    this.entries.set(name, {name,metadata});
  }
  async list({prefix, cursor}) {
    const keys = [...this.entries.keys()].filter(key => key.startsWith(prefix)).sort();
    const start = Number(cursor || 0);
    // Force pagination of even small lists to exercise ordering and grouping.
    return {keys: keys.slice(start, start+4).map(key => this.entries.get(key)),
      list_complete: start+4 >= keys.length, cursor: String(start+4)};
  }
}
const market = "美股";
const tradeDate = "2026-11-13";
const closedAt = tradeDate + "T21:00:00Z";
const at = (time, day=tradeDate) => day + "T" + time + ":00Z";
const contract = {market, tradeDate, closedAt};
function signal(code, triggerAt, price=100) {
  return {code, name: code + " 公司", currency:"USD", rank:1, score:70, triggerPrice:price, triggerAt, prevClose:100};
}
async function scan(kv, time, rows, input = contract) {
  return recordIntradaySignals(kv,{...input,scannedAt: time,candidates:rows});
}
const fetchAt = at("21:30");
const close = (code, price, date=tradeDate) => ({code,close:price,tradeDate:date,source:"未复权日线"});

test("concurrent, retried and out-of-order scans retain the first visible top-three signal for each stock", async () => {
  const kv = new Kv();
  const t1 = at("14:55"), t2 = at("15:00");
  const rows = [signal("AAA",t1,100),signal("BBB",t1,100),signal("CCC",t1),signal("FOURTH",t1)];
  await Promise.all([
    scan(kv,t2,[signal("AAA",at("14:50"),103),signal("DDD",t2)]),
    scan(kv,t1,rows), scan(kv,t1,rows),
  ]);
  assert.equal(kv.entries.size,2);
  const signals = await loadIntradaySignals(kv,{market,tradeDate,asOf:t2});
  assert.deepEqual(signals.map(row=>row.code), ["AAA","BBB","CCC","DDD"]);
  assert.equal(signals[0].triggerPrice,100);
  assert.equal(signals[0].triggerAt,new Date(t1).toISOString());
  assert.equal(signals[1].rank,2);
  await assert.rejects(scan(kv,t1,[signal("LATER",t2)]), /时刻/);
  assert.equal((await scan(kv,closedAt,[signal("CLOSE",closedAt)])).recorded,false);
  assert.equal((await readIntradayEvaluation(kv,{market,asOf:at("15:12")})).pendingCount,4);
  assert.equal((await readIntradayEvaluation(kv,{market,asOf:t1})).signalCount,3);
});

test("only independently matched closes verified after market close enter the two hit rates and their intersection", async () => {
  const kv = new Kv(), time=at("15:00");
  await scan(kv,time,[signal("BOTH",time,100),signal("DAY",time,104),signal("AFTER",time,97)]);
  await scan(kv,at("15:05"),[signal("MISSING",time),signal("FUTURE",time)]);
  const closes = [
    close("BOTH",105),close("DAY",106),close("AFTER",102),close("MISSING",115,"2026-11-12"),
    {...close("FUTURE",120),verifiedAt:at("22:00")},
  ];
  const codes = closes.map(c=>c.code);
  assert.deepEqual((await planIntradaySettlement(kv,{...contract,asOf:at("20:59")})).codes,[]);
  assert.equal((await settleIntradayDay(kv,{...contract,asOf:time,closes})).written,false);
  const settled = await settleIntradayDay(kv,{...contract,asOf:fetchAt,attemptedCodes:codes,closes});
  assert.deepEqual(settled, {written:true,acceptedCount:3});
  const before = await readIntradayEvaluation(kv,{market,asOf:at("21:15")});
  assert.deepEqual([before.verifiedCount,before.missingCount,before.hitRate],[0,5,null]);
  const res = await readIntradayEvaluation(kv,{market,asOf:fetchAt});
  assert.deepEqual([res.days,res.signalCount,res.verifiedCount,res.missingCount,res.hitCount,res.dayHitCount,res.afterHitCount],
    [1,5,3,2,1,2,2]);
  assert.equal(res.hitRate,33.33);
  assert.equal(res.afterHitRate,66.67);
  assert.deepEqual(res.unsettledDates,[tradeDate]);
  await settleIntradayDay(kv,{...contract,asOf:at("22:00"),closes:[close("BOTH",1),close("MISSING",101)]});
  const updated = await readIntradayEvaluation(kv,{market,asOf:at("22:01")});
  assert.equal(updated.hitCount,1);
  assert.equal(updated.verifiedCount,4);
  assert.equal(updated.missingCount,1);
});

test("settlement prioritizes never-attempted stocks and rotates retries without losing disjoint concurrent batches", async () => {
  const kv = new Kv();
  for (let i=0;i<5;i++) {
    const t = at("15:0"+i);
    await scan(kv,t,[0,1,2].map(j=>signal("E"+String(i*3+j).padStart(2,"0"),t)));
  }
  const initial = await planIntradaySettlement(kv,{...contract,asOf:fetchAt});
  assert.equal(initial.codes.length,12);
  const part1=initial.codes.slice(0,6), part2=initial.codes.slice(6);
  await Promise.all([part1,part2].map((part,i)=>settleIntradayDay(kv,{
    ...contract,asOf:fetchAt,signals:initial.signals,attemptedCodes:part,
    closes:i ? part.map(code=>close(code,105)) : [],
  })));
  const next = await planIntradaySettlement(kv,{...contract,asOf:at("21:35"),limit:4});
  assert.deepEqual(next.codes,["E12","E13","E14","E00"]);
  assert.equal(next.verifiedCount,6);
});

test("records 20 most recent observed completed days plus today's pending, and leaves untouched sessions unknown",async () => {
  const kv = new Kv();
  const empty = await readIntradayEvaluation(kv,{market,asOf:fetchAt});
  assert.deepEqual([empty.days,empty.signalCount,empty.hitRate],[0,0,null]);
  let num = 0;
  for (let ms=Date.parse("2026-10-01"); ms<=Date.parse(tradeDate); ms+=86400000) {
    const day = new Date(ms);
    if ([0,6].includes(day.getUTCDay())) continue;
    num++;
    const d=day.toISOString().slice(0,10), t=at("15:30",d);
    await scan(kv,t,[signal("TODAY",t)],{market,tradeDate:d});
  }
  assert.ok(num>20);
  const summary=await readIntradayEvaluation(kv,{market,asOf:at("16:00")});
  assert.deepEqual([summary.days,summary.signalCount,summary.pendingCount,summary.missingCount],[20,21,1,20]);
  assert.ok(summary.unsettledDates[0]<tradeDate);
  const activeAt=at("19:59","2026-10-30");
  assert.equal((await scan(kv,activeAt,[],{market,tradeDate:"2026-10-30"})).recorded,true);
  assert.equal((await scan(kv,at("20:00","2026-10-30"),[],{market,tradeDate:"2026-10-30"})).recorded,false);
  assert.deepEqual((await readIntradayEvaluation(kv,{market:"港股",asOf:fetchAt})).days,0);
});

test("an empty but observed session may mature; no samples yield no hit rate; premature half-day data is excluded",async () => {
  const kv = new Kv();
  const shortEnd=at("18:00"), short={...contract,closedAt:shortEnd};
  await scan(kv,at("15:00"),[],short);
  const s=await readIntradayEvaluation(kv,{market,asOf:shortEnd});
  assert.deepEqual([s.days,s.signalCount,s.verifiedCount,s.hitRate],[1,0,0,null]);
  assert.equal((await scan(kv,at("18:05"),[signal("X",at("18:05"))],short)).recorded,false);
});
