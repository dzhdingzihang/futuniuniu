import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePreopenDay, summarizePreopenHistory, fetchPreopenTouchBars } from "../functions/lib/preopen-outcomes.js";

const day = "2026-11-16", market = "港股";
const members = ["00700","01810","00788","00981","01211"].map(code=>({name:code,code,prevClose:100}));
const frozen = {status:"frozen",market,tradeDate:day,frozenAt:day+"T01:20:12Z",cutoffAt:day+"T01:25:00Z",
  publishedAt:day+"T01:25:06Z",universe:members,candidates:members.slice(0,3),yesterdayLeaders:members.slice(1,4)};
const makeBar = (i,open,high,low,close,prevClose=100) => ({code:members[i].code,market,tradeDate:day,open,high,low,close,prevClose});
const bars = [makeBar(0,100,107,99,101),makeBar(1,105,106,104,105),makeBar(2,101,104,99,100),makeBar(3,50,65,49,62,50)];
const evaluate = options => evaluatePreopenDay({frozen,bars,closedAt:day+"T08:00:00Z",asOf:day+"T09:00:00Z",...options});
test("identical labels for all three frozen cohorts distinguish opening jump, fading and a missing corporate-action basis",()=>{
  const result = evaluate();
  assert.deepEqual(result.groups.picks,{count:3,verified:3,missing:0,hits:2,hitRate:66.67,openHits:1,intradayHits:1,held:1,faded:1,coveragePct:100});
  assert.deepEqual(result.groups.yesterdayLeaders,{count:3,verified:2,missing:1,hits:1,hitRate:50,openHits:1,intradayHits:0,held:1,faded:0,coveragePct:66.67});
  assert.deepEqual(result.groups.pool,{count:5,verified:3,missing:2,hits:2,hitRate:66.67,openHits:1,intradayHits:1,held:1,faded:1,coveragePct:60});
  const [fading,opening,untouched,split] = result.rows;
  assert.equal(fading.highChangePct,7);
  assert.equal(fading.openToClosePct,1);
  assert.equal(fading.firstTouch.kind,"intraday");
  assert.equal(opening.firstTouch.kind,"open");
  assert.equal(untouched.firstTouch.kind,"none");
  assert.equal(split.status,"missing");
  assert.equal(result.rows.length,4);
});

test("foreign-market bars, duplicate and wrong-date bars are never eligible observations",()=>{
  const extra = [{...bars[0],market:"美股",high:110},{...bars[1],tradeDate:"2026-11-17"},bars[2],{...bars[0],code:members[4].code,low:499}];
  const result = evaluate({bars:[...bars,...extra]});
  assert.equal(result.groups.pool.verified,2);
  assert.equal(result.groups.pool.hits,2);
  assert.equal(result.rows.find(r=>r.code===members[2].code).status,"missing");
});

test("forecasts that were not properly sealed or published before open never enter completed-session statistics",()=>{
  for(const patch of [{status:"missing"},{frozenAt:null},{publishedAt:null},{frozenAt:day+"T01:26:00Z"},
    {publishedAt:day+"T01:24:59Z"},{publishedAt:day+"T01:30:00Z"},{cutoffAt:day+"T01:26:00Z"},{publishedAt:day+"T01:18:00Z"},
    {tradeDate:"2026-11-17"},{candidates:[{code:"00001"}]}]) {
    assert.equal(evaluate({frozen:{...frozen,...patch}}),null,JSON.stringify(patch));
  }
  assert.equal(evaluate({asOf:day+"T07:59:59Z"}),null);
  assert.equal(evaluate({closedAt:day+"T07:00:00Z"}),null);
});

test("regular-session five-minute observations localize the first hit, ignore lunch and abstain on gaps or wrong prices",()=>{
  const ticks=[];
  const start = Date.parse(day+"T01:30:00Z"), afternoon = Date.parse(day+"T05:00:00Z");
  const bar = (t,spread=103) => ({start:new Date(t).toISOString(),open:100,high:spread,low:99.5,close:101,volume:1200});
  for(let i=0;i<30;i++) ticks.push(bar(start + i*300000));
  ticks.push(bar(Date.parse(day+"T04:05:00Z"),106));
  ticks.push(bar(afternoon,106));
  function first(items) { return evaluate({minutesByCode:{"00700":items}}).rows[0].firstTouch; }
  assert.deepEqual(first(ticks),{kind:"interval",start:day+"T05:00:00.000Z",end:day+"T05:05:00.000Z"});
  assert.equal(first(ticks.slice(1)).kind,"intraday");
  assert.equal(first(ticks.filter((_,i)=>i!==15)).kind,"intraday");
  assert.equal(first([{...ticks[0],open:99.6},...ticks.slice(1)]).kind,"intraday");
  assert.equal(first([{...ticks[0],volume:null},...ticks.slice(1)]).kind,"intraday");
});

test("only observed days count, zero picks have no hit rate, market rates pool verified denominators, and same-day retries count once",()=>{
  const initial=evaluate({bars:[]}), final=evaluate({asOf:day+"T10:00:00Z"});
  const empty=evaluate({frozen:{...frozen,candidates:[]}});
  assert.equal(summarizePreopenHistory([empty]).groups.picks.hitRate,null);
  assert.equal(summarizePreopenHistory([]).days,0);
  const summary=summarizePreopenHistory([initial,final,initial,{...empty,tradeDate:"2026-11-17"}]);
  assert.equal(summary.days,2);
  assert.equal(summary.emptyDays,1);
  assert.equal(summary.groups.pool.count,10);
  assert.equal(summary.groups.picks.hitRate,66.67);
  assert.equal(summarizePreopenHistory([initial,final],1).groups.pool.verified,3);
});

test("minute source requests the dated regular-session range, native currency and genuine highs",async ()=>{
  for (const [m,code,symbol] of [["A股","300750","300750.SZ"],["港股","00700","0700.HK"],["美股","NVDA","NVDA"]]) {
    let requested;
    const result=await fetchPreopenTouchBars(m,code,day,async url=>{
      requested=url;
      return Response.json({chart:{result:[{meta:{symbol,dataGranularity:"5m"},timestamp:[Date.parse(day+"T14:30:00Z")/1000],
        indicators:{quote:[{open:[100],high:[null],low:[99],close:[101],volume:[1000]}]}}]}});
    });
    assert.equal(requested.searchParams.get("includePrePost"),"false");
    assert.equal(Number(requested.searchParams.get("period2"))-Number(requested.searchParams.get("period1")),86400);
    assert.equal(result[0].high,null);
  }
});
