import test from "node:test";
import assert from "node:assert/strict";
import {readAuction} from "../functions/lib/preopen-feeds.js";

const date="2026-11-23", cutoff=date+"T14:25:00Z", asOf=Date.parse(date+"T13:29:45Z");
const marks=["This page refreshes every 30 seconds.","Data last updated Nov 23, 2026 08:29 AM ET."];
const tape=["08:14:39","08:14:30","08:13:30"].map(time=>({time,price:"$347.77",shareVolume:"1"}));
async function sample({lastUpdateInfo=marks,trades=tape,cnbc=null}={}) {
  const fetcher=async u=>{
    const url=new URL(u);
    if (url.hostname==="quote.cnbc.com") return Response.json({FormattedQuoteResult:{FormattedQuote:cnbc?[cnbc]:[]}});
    assert.equal(url.searchParams.get("time"),"0"); // Exchange's "Last 100 Trades" filter.
    return Response.json({data:{lastUpdateInfo,previousInfo:"Market Close: $342.56",
      infoTable:{rows:[{volume:"605,149",highPrice:"$349.16 (05:55:15 AM)"}]},tradeDetailTable:{rows:trades}}});
  };
  return readAuction("美股",["AAPL"],date,cutoff,fetcher,{asOf});
}

test("live Nasdaq notice precedes the dated update; delayed sale timestamps survive without being called fresh",async()=>{
  const r=await sample();
  assert.equal(r.tapeReturnedCount,1);
  assert.equal(r.rows[0].at,Date.parse(date+"T13:14:39Z"));
  assert.equal(r.rows[0].multiple,true);
  assert.ok(asOf-r.rows[0].at>15*60000);
  assert.equal(r.rows[0].amountAt,Date.parse(date+"T13:29:59.999Z"));
});

test("wrong-day, ambiguous, and future Nasdaq update lines never validate an undated tape",async()=>{
  const old="Data last updated Nov 20, 2026 08:29 AM ET.";
  for(const lastUpdateInfo of [[marks[0],old],[...marks,old],[marks[0]],["Data last updated Nov 23, 2026 08:30 AM ET."]]) {
    assert.equal((await sample({lastUpdateInfo})).tapeReturnedCount,0);
  }
  assert.equal((await sample({trades:[{time:"08:29:55",price:"$350",shareVolume:"1"}]})).tapeReturnedCount,0);
});

test("a corroborating delayed Nasdaq tape cannot replace a more current CNBC price or volume",async()=>{
  const cnbc={symbol:"AAPL",code:0,exchange:"NASDAQ",currencyCode:"USD",realTime:"true",last:"342.56",ExtendedMktQuote:{
    type:"PRE_MKT",last:"347.50",change:"+4.94",volume:"603,887",last_time:"2026-11-23T08:28:19.796-0500"}};
  const r=await sample({cnbc}), row=r.rows[0];
  assert.equal(r.cnbcFreshCount,1);
  assert.equal(r.tapeReturnedCount,1);
  assert.equal(row.source,"CNBC 盘前成交");
  assert.equal(row.price,347.5);
  assert.equal(row.amount,603887);
  assert.equal(row.multiple,true);
});
