import test from "node:test";
import assert from "node:assert/strict";
import {readAuction} from "../functions/lib/preopen-feeds.js";

const date="2026-11-23", cutoffAt=date+"T01:25:00Z";
const at=Date.parse(date+"T01:22:35Z"), asOf=at+5000;
const stocks=n=>Array.from({length:n},(_,i)=>String(i+1).padStart(5,"0"));
const eastRow=code=>({f13:116,f12:code,f2:103,f17:103,f15:103,f16:103,f18:100,f6:1200000,f124:at/1000});
function tencentRow(code) {
  const f=Array(72).fill("");
  for (const [i,v] of Object.entries({1:"test",2:code,3:"103",4:"100",5:"103",30:"2026/11/23 09:22:35",33:"103",34:"103",37:"1200000"})) f[i]=v;
  return 'v_hk'+code+'="'+f.join("~")+'";';
}
function run(codes,fetcher,t=asOf) {
  return readAuction("港股",codes,date,cutoffAt,fetcher,{asOf,clock:()=>t});
}

test("HK retries only failed batches, recovers independent sources once and counts each stock once",async()=>{
  const codes=stocks(240), calls=new Map();
  const fetcher=async u=>{
    const url=new URL(u), group=url.searchParams.get("secids")?.split(",").map(s=>s.slice(4));
    if (!group) return new Response(tencentRow(codes[0]));
    const count=(calls.get(group[0]) || 0)+1;calls.set(group[0],count);
    if(group[0]!==codes[200] && count===1)return new Response(null,{status:503});
    return Response.json({rc:0,data:{diff:group.map(eastRow)}});
  };
  const report=await run(codes,fetcher);
  assert.deepEqual([...calls.values()],[2,2,1]);
  assert.equal(report.rows.length,240);
  assert.equal(report.providerQuotedCount,240);
  assert.equal(report.attempted,240);
  assert.deepEqual(report.providers.eastmoney,{batches:3,firstFailed:2,retried:2,recovered:2,unavailable:0,errors:{http_503:2}});
  assert.deepEqual(report.providers.tencent,{batches:1,firstFailed:0,retried:0,recovered:0,unavailable:0,errors:{}});
  assert.equal(report.failedCount,2);
});

test("HK leaves enough time to seal and never retries a completed historical cutoff",async()=>{
  for (const time of [Date.parse(cutoffAt)-7999,Date.parse(cutoffAt)+3600000]) {
    const report=await run(stocks(4),async u=>new URL(u).hostname.includes("eastmoney")
      ? Promise.reject(new TypeError("fetch failed")) : new Response(""),time);
    assert.deepEqual(report.providers.eastmoney,{batches:1,firstFailed:1,retried:0,recovered:0,unavailable:1,errors:{transport:1}});
    assert.equal(report.failedCount,1);
  }
});

test("HK limits additional subrequests to three even when both providers continue to fail",async()=>{
  const report=await run(stocks(240),async()=>new Response(null,{status:503}));
  const {eastmoney,tencent}=report.providers;
  assert.equal(eastmoney.retried+tencent.retried,3);
  assert.equal(tencent.retried,1);
  assert.equal(tencent.unavailable+eastmoney.unavailable,4);
  assert.equal(eastmoney.recovered+tencent.recovered,0);
  assert.equal(eastmoney.errors.http_503+tencent.errors.http_503,7);
  assert.equal(report.failedCount,7);
});

test("a recovered batch cannot introduce a trade after the sample timestamp",async()=>{
  let eastCalls=0;
  const report=await run(["00700"],async u=>{
    if (!new URL(u).hostname.includes("eastmoney")) return new Response("");
    if (++eastCalls===1) throw new TypeError("fetch failed");
    return Response.json({rc:0,data:{diff:[{...eastRow("00700"),f124:(asOf+1000)/1000}]}});
  });
  assert.equal(report.providers.eastmoney.recovered,1);
  assert.equal(report.rows.length,0);
});
