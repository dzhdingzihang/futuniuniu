import test from "node:test";
import assert from "node:assert/strict";
import { buildPreopenEvidence } from "../functions/lib/preopen-evidence.js";
import { datedIndustries,readNews,readAuction } from "../functions/lib/preopen-feeds.js";

const asOf="2026-11-16T14:24:30Z", now=Date.parse(asOf);
const previousCloseAt="2026-11-13T21:00:00Z", code="TEST", cutoffAt="2026-11-16T14:25:00Z";
const common={market:"美股",tradeDate:"2026-11-16",asOf,cutoffAt,previousCloseAt};
const rows=[code,"BBB","CCC","DDD","EEE","FFF","GGG","HHH","III"].map((code,i)=>({code,name:code,currency:"USD",market:"美股",
  quoteUpdatedAt:previousCloseAt,metrics:{price:100,high:101,low:95,changePct:i?1:3,amount:10000000}}));
const industries=new Map(rows.map(r=>[r.code,"Semiconductors"]));
const announcement={code,at:now-60_000,title:"Issuer raises full-year revenue guidance",source:"Issuer",url:"https://www.prnewswire.com/"};
const history=[3,4,5,6,9].map(d=>({date:"2026-11-"+String(d).padStart(2,"0"),amount:1000}));
const print={code,price:102,prevClose:100,at:now-10_000,amountAt:now-12_000,amount:2000,liquid:true,multiple:true,source:"Nasdaq",url:"https://www.nasdaq.com/"};

function build({news=[],groups=industries,tape=[],historyAmounts={},data=rows,newsOk=true,...opts}={}) {
  return buildPreopenEvidence({...common,rows:data,historyAmounts,providers:{
    readNews:async()=>({rows:news,available:newsOk,label:"源",detail:"摘要"}),
    readIndustries:async()=>groups,
    readAuction:async(_market,codes)=>({rows:tape.filter(q=>codes.includes(q.code)),available:true,attempted:codes.length})
  },...opts});
}

test("upward close alone never ranks; usable feeds with zero matching announcements allow a valid empty list",async()=>{
  const r=await build();
  assert.equal(r.evidenceAvailable,true);assert.equal(r.candidates.length,0);
  assert.equal(r.coverage.contextCount,9);assert.equal(r.coverage.auctionAttempted,8);
  const none=await build({groups:new Map(),newsOk:false});
  assert.equal(none.evidenceAvailable,false);assert.equal(none.candidates.length,0);
});

test("company event and five or more other peers can qualify even with missing auction; duplicates count once",async()=>{
  const r=await build({news:[announcement,{...announcement,at:now-100}]});
  assert.deepEqual(r.candidates.map(c=>c.code),[code]);assert.deepEqual(r.candidates[0].evidence.map(v=>v.kind),["event","context"]);
  assert.equal(r.candidates[0].prePrice,null);assert.match(r.candidates[0].risks.join(" "),/无法排除已跳涨/);
  const thin=new Map(rows.slice(0,5).map(r=>[r.code,"Thin"]));
  assert.equal((await build({news:[announcement],groups:thin})).candidates.length,0);
  const oldOrFuture=await build({news:[{...announcement,at:Date.parse(previousCloseAt)}, {...announcement,at:now+1}]});
  assert.equal(oldOrFuture.coverage.eventCount,0);
});

test("future or duplicate baselines cannot produce abnormal volume; price change and volume form a single source",async()=>{
  const historyAmounts={[code]:history};
  const r=await build({news:[announcement],tape:[print],historyAmounts});
  assert.equal(r.candidates[0].evidence.length,3);
  assert.equal(r.observations[code].amount,2000);
  assert.equal((await build({groups:new Map(),tape:[print],historyAmounts})).candidates.length,0);
  const incomplete=[history[0],history[0],history[1],history[2],history[3],{date:"2026-11-16",amount:700}];
  assert.equal((await build({news:[announcement],tape:[print],historyAmounts:{[code]:incomplete}})).coverage.abnormalVolumeCount,0);
  assert.equal((await build({news:[announcement],tape:[{...print,amountAt:now+1}],historyAmounts})).coverage.abnormalVolumeCount,0);
  assert.equal((await build({news:[announcement],tape:[{...print,multiple:false}],historyAmounts})).coverage.abnormalVolumeCount,0);
});

test("move at threshold and earlier premarket high are separated; stale, future, mismatched references and late runs do not qualify",async()=>{
  const r=await build({news:[announcement],tape:[{...print,price:105}]});
  assert.equal(r.jumped[0].jumpPrice,105);assert.equal(r.candidates.length,0);
  const back=await build({news:[announcement],tape:[{...print,price:101,high:106,highAt:now-60_000}]});
  assert.equal(back.jumped[0].jumpPrice,106);assert.equal(back.jumped[0].prePrice,101);
  assert.equal((await build({tape:[{...print,price:106,at:now+1}]})).jumped.length,0);
  const oldPrint=await build({news:[announcement],tape:[{...print,price:106,at:now-301000}]});
  assert.equal(oldPrint.jumped.length,1);assert.equal(oldPrint.jumped[0].prePrice,null);
  assert.equal(oldPrint.candidates.length,0);
  const split=await build({news:[announcement],tape:[{...print,prevClose:50}]});
  assert.equal(split.coverage.comparablePriceRejected,1);assert.equal(split.candidates.length,0);
  assert.equal((await build({news:[announcement],asOf:"2026-11-16T14:25:30Z"})).evidenceAvailable,false);
  assert.equal((await build({news:[announcement],data:rows.map(r=>({...r,quoteUpdatedAt:"2026-11-12T21:00:00Z"}))})).coverage.referenceCount,0);
});

test("CN indications before 09:25 and HK observations before random matching cannot be counted as executed trades",async()=>{
  const localnow="2026-11-16T01:24:30Z";
  for (const market of ["A股","港股"]) {
    const previousCloseAt=market==="A股"?"2026-11-13T07:00:00Z":"2026-11-13T08:00:00Z";
    const opts={market,data:rows.map(r=>({...r,market,quoteUpdatedAt:previousCloseAt,metrics:{...r.metrics,amount:40000000}})),
      asOf:localnow,cutoffAt:"2026-11-16T01:25:00Z",previousCloseAt};
    const early={...print,price:106,at:Date.parse("2026-11-16T01:19:59Z")};
    assert.equal((await build({...opts,tape:[early]})).jumped.length,0);
    const matched=await build({...opts,tape:[{...early,at:Date.parse("2026-11-16T01:21:00Z")}]});
    assert.equal(matched.jumped.length,market==="港股"?1:0);
  }
});

test("industry mapping cannot be used if it is future, stale or outside the reference pool",()=>{
  const snap={observedAt:"2026-11-15T00:00:00Z",markets:{"美股":{groups:{Pharma:["ABCD",code]}}}};
  assert.deepEqual([...datedIndustries(snap,"美股",[code],now)],[[code,"Pharma"]]);
  assert.equal(datedIndustries(snap,"美股",[code],Date.parse("2026-11-14")),null);
  assert.equal(datedIndustries(snap,"美股",[code],Date.parse("2026-12-30")),null);
});

test("exchange disclosures require exact times and positive titles; US releases must identify their issuer directly",async()=>{
  const row={art_code:"AN2026111300101",display_time:"2026-11-13 18:00:00:123",eiTime:"2026-11-13 18:20:00:456",
    notice_date:"2026-11-14 00:00:00",title:"关于签署重大合同的公告",codes:[{stock_code:"300750"}]};
  const cn=await readNews("A股",async()=>Response.json({success:1,data:{list:[row,{...row,title:"关于终止重大合同的公告"}]}}));
  assert.equal(cn.rows.length,2);assert.equal(cn.rows[0].at,Date.parse("2026-11-13T10:20:00.456Z"));
  const hk=await readNews("港股",async()=>Response.json({newsInfoLst:[{title:"正面盈利預告",relTime:"13/11/2026 22:55",
    stock:[{sc:"02683"}],webPath:"/listedco/listconews/sehk/2026/1113/123_c.pdf"}]}));
  assert.equal(hk.rows[0].code,"02683");assert.equal(hk.rows[0].at,Date.parse("2026-11-13T14:55:00Z"));
  const it=issuer=>'<item><title>Example raises full-year guidance</title><description>NEW YORK -- Example Medical Inc. (NASDAQ: TEST) announces ...</description>'+
    '<pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate><dc:contributor>'+issuer+'</dc:contributor><link>https://www.prnewswire.com/news-releases/abc.html</link></item>';
  const us=await readNews("美股",async()=>new Response("<rss>"+it("Example Medical")+it("Another Brand")+"</rss>"));
  assert.equal(us.rows.length,3);assert.equal(us.rows[0].code,code);
});

test("Nasdaq minute-only aggregate is conservatively dated and an empty last-sale tape is missing",async()=>{
  const data={lastUpdateInfo:["Data last updated Nov 16, 2026 09:24 AM ET."],infoTable:{rows:[{volume:"200,000",highPrice:"$106.45 (08:24:36 AM)"}]},
    previousInfo:" Market Close: $100.00",tradeDetailTable:{rows:["09:24:00","09:23:58","09:23:57"].map(nlsTime=>({nlsTime,nlsPrice:"$102.50"}))}};
  const r=await readAuction("美股",[code],common.tradeDate,cutoffAt,async()=>Response.json({data}));
  assert.equal(r.rows[0].amountAt,Date.parse("2026-11-16T14:24:59.999Z"));
  assert.equal(r.rows[0].highAt,Date.parse("2026-11-16T13:24:36Z"));
  assert.equal(r.rows[0].multiple,true);assert.equal(r.rows[0].liquid,true);
  const missing=await readAuction("美股",[code],common.tradeDate,cutoffAt,async()=>Response.json({data:{...data,tradeDetailTable:{rows:null}}}));
  assert.equal(missing.rows.length,0);
});
