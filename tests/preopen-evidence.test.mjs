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

function build({news=[],groups=industries,tape=[],historyAmounts={},data=rows,newsOk=true,windowComplete=false,...opts}={}) {
  return buildPreopenEvidence({...common,rows:data,historyAmounts,providers:{
    readNews:async()=>({rows:news,available:newsOk,windowComplete,label:"源",detail:"摘要"}),
    readIndustries:async()=>groups,
    readAuction:async(_market,codes)=>({rows:tape.filter(q=>codes.includes(q.code)),available:true,attempted:codes.length})
  },...opts});
}

test("generic RSS reachability and yesterday's moves never establish a complete empty list",async()=>{
  const r=await build();
  assert.equal(r.evidenceAvailable,false);assert.equal(r.candidates.length,0);
  assert.equal(r.coverage.contextCount,9);assert.equal(r.coverage.auctionAttempted,9);
  assert.equal(r.coverage.unresolvedCount,9); assert.equal(r.coverage.confirmedMissCount,0);
  const none=await build({groups:new Map(),newsOk:false});
  assert.equal(none.evidenceAvailable,false);
  const bearish=rows.map(r=>({...r,metrics:{...r.metrics,changePct:-2}}));
  const covered=await build({data:bearish,windowComplete:true});
  assert.equal(covered.evidenceAvailable,true);assert.equal(covered.coverage.confirmedMissCount,9);
  const partial=await build({data:bearish,windowComplete:true,total:10});
  assert.equal(partial.evidenceAvailable,false);assert.equal(partial.coverage.missingReferenceCount,1);
  const mixed=await build({data:bearish,tape:[print,{...print,code:"BBB",price:99},{...print,code:"CCC",price:106}]});
  assert.equal(mixed.coverage.confirmedMissCount,1);assert.equal(mixed.coverage.unresolvedCount,7);
  assert.equal(mixed.coverage.jumpedCount,1);assert.equal(mixed.evidenceAvailable,false);
  const allFiltered=await build({data:rows.map(r=>({...r,excluded:true}))});
  assert.equal(allFiltered.evidenceAvailable,true);assert.equal(allFiltered.coverage.eligibleCount,0);
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

test("before the Shenzhen uncross only issuer and peer evidence are possible; a missing event does not resurrect a failed peer test",async()=>{
  const market="A股", previousCloseAt="2026-11-13T07:00:00Z";
  const data=rows.map(r=>({...r,market,quoteUpdatedAt:previousCloseAt,metrics:{...r.metrics,amount:4e7,changePct:-1}}));
  const groups=new Map(data.slice(0,7).map(r=>[r.code,"软件"]));
  const opts={market,data,groups,total:10,previousCloseAt,asOf:"2026-11-16T01:22:41Z",cutoffAt:"2026-11-16T01:25:00Z"};
  const r=await build(opts);
  assert.equal(r.coverage.auctionApplicable,false);
  assert.equal(r.coverage.auctionAttempted,0);
  assert.equal(r.coverage.auctionTestableCount,0);
  assert.equal(r.coverage.twoClassTestableCount,0);
  assert.deepEqual([r.coverage.confirmedMissCount,r.coverage.unresolvedCount,r.coverage.missingReferenceCount],[7,2,1]);
  assert.equal(r.sources.find(s=>s.kind==="auction").status,"not_applicable");
  assert.equal(r.evidenceAvailable,false);
  const positive=await build({...opts,data:data.map(r=>({...r,metrics:{...r.metrics,changePct:2}})),news:[{...announcement,at:Date.parse("2026-11-16T00:30:00Z")}]});
  assert.deepEqual(positive.candidates.map(r=>r.code),[code]);
  const boundary=await build({...opts,asOf:opts.cutoffAt});
  assert.equal(boundary.coverage.auctionApplicable,true);
  assert.equal(boundary.coverage.unresolvedCount,data.length);
});

test("ChiNext disclosures include a later weekend page, deduplicate and preserve unknown coverage on a failed page",async()=>{
  const disclosure={art_code:"AN202611201111",display_time:"2026-11-20 17:50:00:120",eiTime:"2026-11-20 17:50:01:000",
    codes:[{stock_code:"300750"}],title:"关于签署重大合同的公告"};
  const readPages=[];
  const source=await readNews("A股",async url=>{
    const n=Number(url.searchParams.get("page_index"));readPages.push(n);
    assert.equal(url.searchParams.get("begin_time"),"2026-11-19");
    if(n===1) throw Error("failed page");
    const list=n>=3 ? [disclosure] : [];
    return Response.json({success:1,data:{list,total_hits:990}});
  },{previousClose:Date.parse("2026-11-20T07:00:00Z"),asOf:Date.parse("2026-11-23T01:22:41Z")});
  assert.deepEqual(readPages.sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
  assert.equal(source.rows.length,1);
  assert.equal(source.rows[0].at,Date.parse("2026-11-20T09:50:01Z"));
  assert.match(source.detail,/7\/8 页/);
  assert.notEqual(source.windowComplete,true);
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
  assert.equal(cn.rows.length,1);assert.equal(cn.rows[0].at,Date.parse("2026-11-13T10:20:00.456Z"));
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

test("full-pool real-time premarket quotes require a timestamp, exchange, session and matching reference price",async()=>{
  const q={code:0,symbol:code,exchange:"NASDAQ",currencyCode:"USD",realTime:"true",last:"100",
    ExtendedMktQuote:{last_time:"2026-11-16T09:24:05.000-0500",type:"PRE_MKT",last:"102",change:"+2",volume:"125,000"}};
  const extras=["BBB","CCC","DDD","EEE","FFF","GGG"];
  const invalid=[
    {...q,exchange:"NYSE"},{...q,ExtendedMktQuote:{...q.ExtendedMktQuote,type:"POST_MKT"}},
    {...q,ExtendedMktQuote:{...q.ExtendedMktQuote,last_time:"2026-11-16"}},
    {...q,ExtendedMktQuote:{...q.ExtendedMktQuote,last_time:"2026-11-16T09:24:50.000-0500"}},
    {...q,last:"99"}, {...q,realTime:"false"}
  ].map((r,i)=>({...r,symbol:extras[i]}));
  const lateTape={lastUpdateInfo:["Data last updated Nov 16, 2026 09:08 AM ET."],previousInfo:"Close: $100",infoTable:{rows:[{volume:"60,000",highPrice:"$106 (09:07:10 AM)"}]},
    tradeDetailTable:{rows:["09:08:00","09:07:50","09:07:40"].map(time=>({time,price:"$101"}))}};
  const urls=[];
  const fetcher=async u=>{
    const url=new URL(u);urls.push(url);
    if(url.hostname==="quote.cnbc.com")return Response.json({FormattedQuoteResult:{FormattedQuote:[q,...invalid]}});
    return Response.json({data:url.pathname.includes("/TEST/")?lateTape:null});
  };
  const a=await readAuction("美股",[code,...extras],common.tradeDate,cutoffAt,fetcher,{asOf:now});
  assert.equal(a.rows.length,1);assert.equal(a.rows[0].source,"CNBC 盘前成交");assert.equal(a.rows[0].multiple,true);
  assert.equal(a.rows[0].amount,125000);assert.equal(a.rows[0].high,106);assert.equal(a.rows[0].highSource,"Nasdaq 盘前成交");
  assert.equal(a.rows[0].at,Date.parse("2026-11-16T14:24:05Z"));
  const noHigh={...a.rows[0],high:null};
  const old=await build({tape:[noHigh],historyAmounts:{[code]:history}});
  assert.equal(old.coverage.abnormalVolumeCount,0);assert.equal(old.observations[code].basis,"cnbc-consolidated-shares");
  const warm=await build({tape:[noHigh],historyAmounts:{[code]:history.map(h=>({...h,basis:"cnbc-consolidated-shares"}))}});
  assert.equal(warm.coverage.abnormalVolumeCount,1);assert.equal(warm.coverage.volumeBaselineCount,1);
  lateTape.infoTable.rows[0].highPrice=null;
  lateTape.tradeDetailTable.rows[0].price="$107";
  const priorTouch=await readAuction("美股",[code],common.tradeDate,cutoffAt,fetcher,{asOf:now,references:new Map([[code,100]])});
  assert.equal(priorTouch.rows[0].high,107);assert.equal(priorTouch.rows[0].highSource,"Nasdaq 盘前成交");
  assert.equal((await build({tape:priorTouch.rows})).jumped[0].jumpPrice,107);
  q.last="50";q.ExtendedMktQuote.last="52";
  const exDate=await readAuction("美股",[code],common.tradeDate,cutoffAt,fetcher,{asOf:now,references:new Map([[code,100]])});
  assert.equal(exDate.rows[0].source,"Nasdaq 盘前成交");assert.equal(exDate.rows[0].price,107);
});

test("bulk discovery scans the whole eligible Nasdaq pool, gives a low-ranked mover a tape, and fits the request budget",async()=>{
  const codes=Array.from({length:3395},(_,i)=>"T"+i);
  const mover=codes.at(-1);
  let cnbcCount=0,discoveryCount=0,requests=0;const tapes=[];
  const r=await readAuction("美股",codes,common.tradeDate,cutoffAt,async(u,o)=>{
    requests++;const url=new URL(u);
    if(url.hostname==="quote.cnbc.com"){
      cnbcCount+=url.searchParams.get("symbols").split("|").length;
      return Response.json({FormattedQuoteResult:{FormattedQuote:[]}});
    }
    if(url.hostname==="scanner.tradingview.com"){
      const req=JSON.parse(o.body);discoveryCount+=req.symbols.tickers.length;
      return Response.json({data:req.symbols.tickers.includes("NASDAQ:"+mover) ? [{s:"NASDAQ:"+mover,d:[Date.parse(common.tradeDate+"T09:00:00Z")/1000,10,100000,2]}] : []});
    }
    tapes.push(url.pathname.split("/")[3]);return Response.json({data:null});
  },{asOf:now});
  assert.equal(cnbcCount,3395);assert.equal(discoveryCount,3395);assert.equal(requests,32);
  assert.equal(r.attempted,3395);assert.equal(r.discoveryCount,1);assert.ok(tapes.includes(mover));
  assert.equal(r.rows.length,0);
});

test("both HKEX boards paginate across the previous close and mark incomplete windows as partial",async()=>{
  const r={title:"正面盈利預告",relTime:"16/11/2026 08:00",stock:[{sc:"02683"}],webPath:"/listedco/listconews/sehk/2026/1116/a_c.pdf"};
  const previousClose=Date.parse("2026-11-13T08:00:00Z"), asOf=Date.parse("2026-11-16T01:20:00Z");
  const run=fail=>readNews("港股",async u=>{
    const more=String(u).endsWith("_2.json");
    if(fail && more && String(u).includes("gem"))throw Error("missing");
    return Response.json({genDate:String(asOf+100),maxNumOfFile:3,newsInfoLst:[more?{...r,relTime:"13/11/2026 14:00"}:r]});
  },{previousClose,asOf});
  assert.equal((await run(false)).windowComplete,true);assert.equal((await run(true)).windowComplete,false);
});

test("HK backup needs an executed auction and all OHLC at that price; outside-session quotes and incorrect previous closes do not displace a real match",async()=>{
  const cn="00700",tradeDate="2026-11-16",cutoff="2026-11-16T01:25:00Z",asOf=Date.parse("2026-11-16T01:24:00Z");
  const row={f13:116,f12:cn,f2:103,f17:103,f15:103,f16:103,f18:100,f6:12000000,f124:Date.parse("2026-11-16T01:22:00Z")/1000};
  const read=async(east,tencent="")=>readAuction("港股",[cn],tradeDate,cutoff,async u=>String(u).includes("eastmoney")
    ? Response.json({rc:0,data:{diff:[east]}}) : new Response(tencent),{asOf,references:new Map([[cn,100]])});
  const backup=await read(row);
  assert.equal(backup.rows[0].source,"东方财富港股竞价快照");assert.equal(backup.rows[0].basis,"eastmoney-hk-turnover");
  assert.equal((await read({...row,f15:105})).rows.length,0);
  assert.equal((await read({...row,f124:asOf/1000+1})).rows.length,0);
  const f=Array(75).fill("");
  for(const [k,v] of Object.entries({1:"腾讯控股",2:cn,3:106,4:100,5:106,30:"2026/11/16 09:21:40",33:106,34:106,37:6000000}))f[k]=String(v);
  const earlier='v_hk00700="'+f.join("~")+'";';
  const merge=await read(row,earlier);assert.equal(merge.rows[0].price,103);assert.equal(merge.rows[0].high,106);
  const invalid=await read({...row,f18:88},earlier);assert.equal(invalid.rows[0].price,106);
});
