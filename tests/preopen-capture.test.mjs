import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/preopen-capture.js";

const read = (date, data, reads=[]) => onRequestGet({
  request:new Request("https://test.invalid/api/preopen-capture?market=" + encodeURIComponent("A股") + "&date=" + date),
  env:{RADAR_SNAPSHOTS:{get:async key=>{reads.push(key);return data[key.split(":").slice(2).join(":")];}}},
  now:()=>new Date("2026-11-21T05:00:00Z"),fetcher:async()=>{throw Error("offline");}
});
test("capture audit distinguishes a present prior close, one available stage and a missing archive without disclosing stock rows", async()=>{
  const res=await read("2026-11-20",{"ref:2026-11-19":{referenceDate:"2026-11-19",rows:[{name:"private-test"}],total:2},
    "stage:2026-11-20:560":{tradeDate:"2026-11-20",frozenAt:"2026-11-20T01:21:00Z",coverage:{eligibleCount:1}}});
  const body=await res.json();
  assert.equal(body.reference.validCount,1);
  assert.deepEqual(body.stages.map(s=>s.slot),[560]);
  assert.equal(body.publishedAt,null);
  assert.doesNotMatch(JSON.stringify(body),/private-test/);
});
test("capture audit never reads stages of future, non-session, or invalid dates",async()=>{
  for (const date of ["2026-11-23","2026-11-21","2026-11-31","garbage"]) {
    const reads=[];
    assert.equal((await read(date,{},reads)).status,400);
    assert.equal(reads.length,0);
  }
});
