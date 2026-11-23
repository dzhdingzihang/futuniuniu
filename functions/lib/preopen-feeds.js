// Non-price announcements and exchange-session observations available before the cutoff.
import { bundledIndustries } from "../../assets/radar-bundled.cjs";
import { fetchTencentGrowthQuotes } from "./radar-tencent-quotes.js";

const FEEDS = {
  cn: "https://np-anotice-stock.eastmoney.com/api/security/ann",
  hk: "https://www1.hkexnews.hk/ncms/json/eds/",
  us: "https://www.prnewswire.com/rss/",
};
const quotesPage = "https://gu.qq.com/";
const UA = "Mozilla/5.0 (compatible; StockRadar/1.0)";
const headers = { "User-Agent": UA, Accept: "application/json, application/xml, text/xml, */*" };

async function request(fetcher,url,options={}) {
  const response = await fetcher(url, { headers, signal:AbortSignal.timeout(6500), cf:{cacheTtl:0}, ...options });
  if (!response.ok) { await response.body?.cancel(); throw Error("HTTP "+response.status); }
  return response;
}

function plain(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"')
    .replace(/&#39;|&apos;/g,"'").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
}

const positiveNews = [
  /(?:获(?:得|批)|取得|獲得|取得).{0,20}(?:上市许可|上市許可|藥品註冊|药品注册|注册批件|註冊批件)|(?:药品|藥品|新藥|新药).{0,20}(?:获批上市|獲批上市)/,
  /(?:中标|中標).{0,8}(?:重大|重要).{0,12}(?:合同|項目|项目)|(?:簽訂|签订|中標|中标|簽署|签署).{0,5}(?:重大|重要).{0,9}(?:合同|訂單|订单|合約)|(?:業績|业绩|盈利).{0,6}(?:預增|预增|向上修正|上修)|正面盈利預告|正面盈利预告|盈利喜訊|盈利喜讯/,
  /\b(?:raises?|increases?|boosts?)\s+(?:its\s+)?(?:full.year\s+|FY\s?\d+\s+|annual\s+|revenue\s+|earnings\s+|profit\s+){0,3}(?:guidance|outlook|forecast)\b|\b(?:receives?|secures?|obtains?)\s+(?:U\.S\.\s+)?FDA\s+approval\b|\bFDA\s+approves\b|\b(?:wins?|awarded|secures?)\s+(?:a\s+|new\s+|an?\s+)?\$[\d,.]+\s*(?:million|billion)\b/i,
];
const denyNews = /诉讼|訴訟|终止|終止|取消|撤回|更正|失敗|失败|未获|未獲|未能|风险提示|風險提示|下調|下调|下修|預減|预减|澄清|\b(?:lawsuit|law firm|investor alert|investigation|correction|rejects?|denial|withdraws?|termination|cuts?|lowers?|denies|rumou?r)\b/i;
function eligibleTitle(title) { return title && !denyNews.test(title) && positiveNews.some(re=>re.test(title)); }

function hkTime(time) {
  const date = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})$/.exec(time||"");
  return date ? Date.parse(date[3]+"-"+date[2]+"-"+date[1]+"T"+date[4]+":00+08:00") : NaN;
}

function mainlandTime(time) {
  const date = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?::(\d{3}))?$/.exec(time||"");
  return date ? Date.parse(date[1]+"T"+date[2]+"."+(date[3]||"000")+"+08:00") : NaN;
}

async function cnNewsPage(page,fetcher,beginDate) {
  const url = new URL(FEEDS.cn);
  url.search = new URLSearchParams({ann_type:"CYB",client_source:"web",sr:"-1",page_size:"100",page_index:String(page)});
  if (beginDate) url.searchParams.set("begin_time",beginDate);
  const json = await (await request(fetcher,url)).json();
  if (json.success !== 1 || !Array.isArray(json.data?.list)) throw Error("公告列表缺失");
  const rows=[];
  for (const r of json.data.list) {
    const title=plain(r.title_ch || r.title), at=Math.max(mainlandTime(r.display_time),mainlandTime(r.eiTime));
    if (!eligibleTitle(title) || !/^AN\d+$/.test(r.art_code) || !Number.isFinite(at)) continue;
    for (const security of r.codes || []) rows.push({code:security.stock_code,title,at,source:"东方财富披露公告",
      url:"https://data.eastmoney.com/notices/detail/"+security.stock_code+"/"+r.art_code+".html"});
  }
  return {rows,documents:json.data.list.length,total:Number.isInteger(json.data.total_hits) ? json.data.total_hits : null};
}

async function cnNews(fetcher,{previousClose}) {
  // Notice dates and display times are not ordered alike. Query a date range
  // with room for backdated titles, then filter exact disclosure/ingestion times.
  const beginDate=Number.isFinite(previousClose) ? new Date(previousClose+8*3600000-86400000).toISOString().slice(0,10) : null;
  const readPage=n=>cnNewsPage(n,fetcher,beginDate);
  const head=await Promise.allSettled([readPage(1),readPage(2)]);
  const observed=head.filter(r=>r.status==="fulfilled").map(r=>r.value);
  if (!observed.length) throw Error("创业板公告来源请求失败。");
  const reportedTotal=observed.find(p=>p.total!==null)?.total;
  const limit=8;
  const requested=reportedTotal!==undefined ? Math.max(1,Math.ceil(reportedTotal/100)) : observed.some(p=>p.documents===100) ? limit : 2;
  const pages=Math.min(limit,requested);
  const rest=await settleLimited(Array.from({length:Math.max(0,pages-2)},(_,i)=>()=>readPage(i+3)),3);
  const chunks=[...head.slice(0,pages),...rest].filter(r=>r.status==="fulfilled").map(r=>r.value);
  if (!chunks.length) throw Error("查询范围内的创业板公告页均未取得。");
  const unique=new Map();
  for (const page of chunks) for (const row of page.rows) unique.set(row.code+"|"+row.url,row);
  return {rows:[...unique.values()],available:true,label:"创业板公司公告",url:"https://data.eastmoney.com/notices/",
    detail:"读取东方财富创业板公告 "+chunks.length+"/"+pages+" 页、"+chunks.reduce((n,c)=>n+c.documents,0)+
      " 条，每轮最多 8 页。逐条按展示和入库时间核验；未检索到的事件保留为未知。"};
}

async function hkPage(board,page,fetcher) {
  const json = await (await request(fetcher,FEEDS.hk+"lci"+board+"7relsdc_"+page+".json")).json();
  if (!Array.isArray(json.newsInfoLst)) throw Error("港交所公告列表缺失");
  const rows=[];
  for (const r of json.newsInfoLst) {
    const title=plain(r.title), at=hkTime(r.relTime);
    if (!eligibleTitle(title) || !Number.isFinite(at) || !/^\/listedco\/listconews\/[^?#]+\.pdf$/i.test(r.webPath||"")) continue;
    for(const s of r.stock || []) rows.push({code:s.sc,title,at,source:"港交所披露易",url:"https://www1.hkexnews.hk"+r.webPath});
  }
  const times=json.newsInfoLst.map(r=>hkTime(r.relTime)).filter(Number.isFinite);
  return {rows, oldest:times.length ? Math.min(...times) : null, max:Number(json.maxNumOfFile), generated:Number(json.genDate)};
}

async function hkNews(board,fetcher,{previousClose,asOf}) {
  let page=await hkPage(board,1,fetcher);
  const generated=page.generated, max=page.max, rows=[...page.rows];
  let pages=1, failed=false;
  // The HKEX latest-seven-days index is split into 500-document pages. Bound the fetches on busy reporting days.
  while (Number.isFinite(previousClose) && page.oldest>previousClose && pages<Math.min(4,max)) {
    try {
      const next=await hkPage(board,pages+1,fetcher);
      if (next.generated!==generated || next.oldest===null || next.oldest>page.oldest) {failed=true;break;}
      page=next; rows.push(...page.rows); pages++;
    } catch {failed=true;break;}
  }
  // Absence can be asserted only when both boards' indexes cover the full interval up to the scan.
  // The indexes themselves cover seven days even when a quiet board has no older documents.
  const full=!failed && Number.isFinite(previousClose) && generated>=asOf && previousClose>=generated-7*86400000 &&
    (page.oldest!==null && page.oldest<=previousClose || pages===max);
  return {rows,pages,full};
}


function xmlTag(item,tag) {
  return plain(new RegExp("<"+tag+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+tag+">","i").exec(item)?.[1]);
}
async function usNews(feed,fetcher) {
  const xml=await (await request(fetcher,FEEDS.us+feed)).text();
  if (!/<rss\b/i.test(xml)) throw Error("公司新闻稿缺失");
  const result=[];
  for (const [item] of xml.matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi)) {
    const title=xmlTag(item,"title"), issuer=xmlTag(item,"dc:contributor");
    const description=xmlTag(item,"description");
    const url=xmlTag(item,"link"), at=Date.parse(xmlTag(item,"pubDate"));
    if (!eligibleTitle(title) || !issuer || denyNews.test(issuer) || !Number.isFinite(at) || !/^https:\/\/www\.prnewswire\.com\/news-releases\//i.test(url)) continue;
    // A news release can reference another issuer's ticker. Require the distributing
    // company's name in the same introductory clause immediately before its ticker.
    const refs=[...description.matchAll(/\(\s*Nasdaq(?:GS|GM|CM)?\s*:\s*([A-Z][A-Z0-9.-]{0,9})\s*\)/gi)];
    if (refs.length!==1) continue;
    const words=str=>str.toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(v=>v.length>1&&!["inc","corp","corporation","plc","company","limited","ltd","the","holdings"].includes(v));
    const intro=words(description.slice(Math.max(0,refs[0].index-160),refs[0].index));
    const identity=words(issuer);
    if (!identity.length || !identity.every(word=>intro.includes(word))) continue;
    result.push({code:refs[0][1].toUpperCase(),title,at,url,source:issuer+" · PR Newswire"});
  }
  return result;
}

export async function readNews(market,fetcher,window={}) {
  if (market==="港股") {
    const boards=await Promise.allSettled(["sehk","gem"].map(board=>hkNews(board,fetcher,window)));
    const read=boards.filter(r=>r.status==="fulfilled").map(r=>r.value);
    return {rows:read.flatMap(b=>b.rows),available:read.length>0,windowComplete:read.length===2 && read.every(b=>b.full),
      label:"港交所披露易",url:"https://www.hkexnews.hk/",
      detail:"沿主板及 GEM 最新披露目录向前核查，共读取 "+read.reduce((n,b)=>n+b.pages,0)+" 页。"};
  }
  if (market==="A股") return cnNews(fetcher,window);
  const jobs=["financial-services-latest-news/earnings-list.rss","health-latest-news/pharmaceuticals-list.rss","news-releases-list.rss"].map(path=>usNews(path,fetcher));
  const output=await Promise.allSettled(jobs);
  const rows=output.filter(r=>r.status==="fulfilled").flatMap(r=>r.value);
  return {rows, available:output.some(r=>r.status==="fulfilled"),
    label:"发行人限量新闻稿",
    url:"https://www.prnewswire.com/news-releases/",
    detail:"扫描三个公开新闻稿频道；仅采用发行人标识与代码均可核对的正面标题。"};
}

export function datedIndustries(snapshot,market,codes,asOf) {
  const observed=Date.parse(snapshot?.observedAt);
  const data=snapshot?.markets?.[market];
  if (!Number.isFinite(observed) || observed>asOf || asOf-observed>30*86400000 || !data?.groups) return null;
  const members=new Set(codes), result=new Map();
  for (const [group,symbols] of Object.entries(data.groups)) {
    for (const code of symbols) if (members.has(code)) result.set(code,group);
  }
  if (!result.size) return null;
  result.observedAt=observed;
  result.description="分类采集于 "+new Date(observed).toISOString().slice(0,10)+"。";
  return result;
}

export async function readIndustries(market,codes,fetcher,asOf=Date.now()) {
  const bundled=datedIndustries(bundledIndustries,market,codes,asOf);
  if (bundled && asOf-bundled.observedAt<=7*86400000 && bundled.size>=codes.length*0.9) return bundled;
  try {
    const response=await request(fetcher,"https://alixjd.com/assets/radar-industries.json",{cf:{cacheTtl:3600}});
    const fresh=datedIndustries(await response.json(),market,codes,asOf);
    if (fresh && (!bundled || fresh.observedAt>=bundled.observedAt)) return fresh;
  } catch { /* The Worker can keep using its still-valid, dated copy. */ }
  if (bundled) return bundled;
  // Both dated copies are unavailable. A live classification is valid only for
  // this sealed run and must never be used to reconstruct an earlier session.

  const [country,exchange]=market==="A股"?["china","SZSE"]:market==="港股"?["hongkong","HKEX"]:["america","NASDAQ"];
  const marketUrl="https://scanner.tradingview.com/"+country+"/scan";
  const symbols=codes.map(code=>exchange+":"+(market==="港股"?String(Number(code)):code));
  const json=await (await request(fetcher,marketUrl,{method:"POST",headers:{...headers,"Content-Type":"application/json",Origin:"https://www.tradingview.com",Referer:"https://www.tradingview.com/"},
    body:JSON.stringify({symbols:{tickers:symbols},columns:["industry"],range:[0,symbols.length]})})).json();
  if (!Array.isArray(json.data)) throw Error("缺少行业分类");
  const result=new Map();
  for (const row of json.data) {
    if (!row.s.startsWith(exchange+":") || !row.d?.[0]) continue;
    const raw=row.s.slice(exchange.length+1);
    result.set(market==="港股"?raw.padStart(5,"0"):raw,row.d[0]);
  }
  result.observedAt=asOf;
  result.description="本次盘前实时读取行业分类。";
  return result;
}

const num=value=>{
  if (typeof value==="number") return Number.isFinite(value)?value:null;
  if (typeof value!=="string" || !/^\$?[\d,]+(?:\.\d+)?$/.test(value.trim())) return null;
  const n=Number(value.replace(/[$,]/g,""));return Number.isFinite(n)?n:null;
};
async function nasdaqAuction(code,tradeDate,cutoffAt,fetcher,asOf) {
  const url="https://api.nasdaq.com/api/quote/"+encodeURIComponent(code)+"/extended-trading?assetclass=stocks&markettype=pre&time=11&limit=20";
  const data=(await (await request(fetcher,url,{headers:{...headers,Accept:"application/json",Referer:"https://www.nasdaq.com/"}})).json()).data;
  const last=data?.lastUpdateInfo?.[0]?.match(/\b([A-Za-z]{3}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM) ET\b/i);
  if (!last || last[7].toUpperCase()!=="AM") return null;
  const date=new Date(last[1]+" "+last[2]+", "+last[3]+" 00:00:00 GMT");
  if (!Number.isFinite(+date) || date.toISOString().slice(0,10)!==tradeDate) return null;
  // Convert observed exchange clock times using the official 09:25 ET cutoff.
  const fromEt=(hr,min,sec)=>Date.parse(cutoffAt)+(hr*60+min-565)*60_000+sec*1000;
  const updatedAt=fromEt(Number(last[4])%12,Number(last[5]),Number(last[6]||0));
  const top=data?.infoTable?.rows?.[0];
  const tape=data?.tradeDetailTable?.rows;
  if (!Array.isArray(tape)|| !top || !Number.isFinite(updatedAt)) return null;
  const entries=tape.flatMap(row=>{
    const t=String(row.nlsTime || row.time || "").match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\s*AM)?$/i);
    const price=num(row.nlsPrice || row.price);
    if (!t || !price || Number(t[1])<4 || Number(t[1])>9) return [];
    const at=fromEt(+t[1],+t[2],+t[3]);
    return at<=asOf && at<=updatedAt+59_999 ? [{at,price}] : [];
  }).sort((a,b)=>b.at-a.at);
  const shares=num(top.volume), prevClose=num(data.previousInfo?.match(/\$[\d,.]+/)?.[0]);
  if (!entries.length || !(prevClose>0)) return null;
  // Price evidence is time-stamped from the tape; cumulative volume may update later.
  const high = /^\$([\d,.]+) \((\d{1,2}):(\d{2}):(\d{2}) AM\)$/i.exec(top.highPrice || "");
  return {code,price:entries[0].price,at:entries[0].at,
    high:high ? num(high[1]) : null, highAt:high ? fromEt(+high[2],+high[3],+high[4]) : null,
    amountAt:updatedAt+(last[6] ? 0 : 59999),amount:shares,unit:"股",
    liquid:shares>0 && shares*entries[0].price>=1e6, multiple:entries.length>=3, prevClose,source:"Nasdaq 盘前成交",
    url:"https://www.nasdaq.com/market-activity/stocks/"+code.toLowerCase()+"/pre-market"};
}

async function settleLimited(jobs,limit) {
  const results=new Array(jobs.length);
  let cursor=0;
  async function work() {
    while (cursor<jobs.length) {
      const index=cursor++;
      try {results[index]={status:"fulfilled",value:await jobs[index]()};}
      catch (reason) {results[index]={status:"rejected",reason};}
    }
  }
  await Promise.all(Array.from({length:Math.min(jobs.length,limit)},work));
  return results;
}

const cnbcBatch=300, discoveryBatch=400, auctionBudget=32, tapeLimit=24;

// TradingView marks this public feed as delayed. Its 04:00 ET session anchor
// identifies the trading day, not the time of the last trade. Use it only to
// choose which official timestamped tapes to look up, never to qualify a name.
async function discoverNasdaq(codes,tradeDate,asOf,fetcher) {
  const rows=[], jobs=[];
  for (let i=0;i<codes.length;i+=discoveryBatch) {
    const symbols=codes.slice(i,i+discoveryBatch).map(code=>"NASDAQ:"+code);
    jobs.push(()=>request(fetcher,"https://scanner.tradingview.com/america/scan",{method:"POST",
      headers:{...headers,"Content-Type":"application/json",Origin:"https://www.tradingview.com",Referer:"https://www.tradingview.com/"},
      body:JSON.stringify({symbols:{tickers:symbols},columns:["premarket_time","premarket_close","premarket_volume","premarket_change"],range:[0,symbols.length]})})
      .then(r=>r.json()).then(j=>{if(!Array.isArray(j.data))throw Error("盘前筛选无数据");return j.data;}));
  }
  const source=await settleLimited(jobs,3), members=new Set(codes);
  for (const chunk of source) {
    if(chunk.status!=="fulfilled")continue;
    for (const row of chunk.value) {
      if (!row.s?.startsWith("NASDAQ:") || !Array.isArray(row.d)) continue;
      const code=row.s.slice(7), [session,price,volume,change]=row.d;
      if(!members.has(code) || ![session,price,volume,change].every(Number.isFinite) ||
        session*1000>asOf || session*1000<Date.parse(tradeDate+"T00:00:00Z") ||
        session*1000>=Date.parse(tradeDate+"T00:00:00Z")+86400000 || price<=0 || volume<=0) continue;
      members.delete(code);rows.push({code,change,amount:price*volume});
    }
  }
  return rows.sort((a,b)=>b.amount-a.amount || a.code.localeCompare(b.code));
}

// CNBC's session-specific Last Sale feed includes the actual trade time and cumulative
// extended-hours volume. Regular-session prices, date-only stamps and POST_MKT rows are never substituted.
async function cnbcPremarket(codes,tradeDate,cutoffAt,asOf,fetcher) {
  const jobs=[], start=Date.parse(cutoffAt)-325*60000;
  for (let i=0;i<codes.length;i+=cnbcBatch) {
    const url=new URL("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol");
    url.search=new URLSearchParams({symbols:codes.slice(i,i+cnbcBatch).join("|"),requestMethod:"itv",partnerId:"2",
      fund:"1",exthrs:"1",entitlement:"0",output:"json"});
    jobs.push(()=>request(fetcher,url).then(r=>r.json()).then(j=>{
      const rows=j.FormattedQuoteResult?.FormattedQuote;
      if(!Array.isArray(rows))throw Error("CNBC 缺少报价列表");
      return rows;
    }));
  }
  const results=await settleLimited(jobs,3), rows=new Map(), members=new Set(codes), returned=new Set();
  for (const page of results) {
    if(page.status!=="fulfilled")continue;
    for (const q of page.value) {
      const ext=q.ExtendedMktQuote, code=q.symbol;
      if (!members.has(code) || q.code!==0 || q.exchange!=="NASDAQ" || q.currencyCode!=="USD") continue;
      returned.add(code);
      if (
        String(q.realTime)!=="true" || ext?.type!=="PRE_MKT" || !ext.last_time?.startsWith(tradeDate+"T") ||
        !/(?:Z|[+-]\d{2}:?\d{2})$/.test(ext.last_time)) continue;
      const at=Date.parse(ext.last_time), price=num(ext.last), amount=num(ext.volume);
      const delta=/^[+-]?[\d,]+(?:\.\d+)?$/.test(ext.change) ? Number(String(ext.change).replace(/,/g,"")) : NaN;
      // The extended-session price change is relative to the latest regular close;
      // previous_day_closing refers to the day before that while premarket is active.
      const prevClose=num(q.last);
      if(!Number.isFinite(at) || at<start || at>asOf || !(price>0 && prevClose>0) ||
        !Number.isFinite(delta) || Math.abs(price-delta-prevClose)>0.011) continue;
      rows.set(code,{code,price,prevClose,at,amount,amountAt:at,unit:"股",basis:"cnbc-consolidated-shares",
        liquid:amount>0 ? price*amount>=1e6 : null,multiple:null,source:"CNBC 盘前成交",
        url:"https://www.cnbc.com/quotes/"+encodeURIComponent(code)});
    }
  }
  return {rows,returned:returned.size,failedCount:results.filter(r=>r.status==="rejected").length};
}

function mergeTrades(a,b,reference,start,asOf) {
  if (!a)return b;
  if (!b)return a;
  const latest=b.at>a.at ? b : a, earlier=latest===a ? b : a;
  if(earlier.at<start && latest.at>=start)return latest;
  if (reference>0) {
    const matches=q=>q.prevClose>0 && Math.abs(q.prevClose/reference-1)<=0.001;
    if(matches(a)!==matches(b))return matches(a) ? a : b;
    if(!matches(a))return latest;
  }
  if(Math.abs(earlier.prevClose/latest.prevClose-1)>0.001 || earlier.at<start)return latest;
  const merged={...latest};
  if(earlier.multiple===true)merged.multiple=true;
  let high=null;
  for(const q of [a,b]) {
    for(const point of [{price:q.price,at:q.at,source:q.source,url:q.url},
      {price:q.high,at:q.highAt,source:q.highSource || q.source,url:q.highUrl || q.url}]) {
      if(point.price>0 && point.at>=start && point.at<=asOf &&
        (!high || point.price>high.price || point.price===high.price && point.at<high.at)) high=point;
    }
  }
  if(high) Object.assign(merged,{high:high.price,highAt:high.at,highSource:high.source,highUrl:high.url});
  return merged;
}

async function readHongKongBatches(batches, cutoffAt, clock) {
  const providers = Object.fromEntries(["tencent","eastmoney"].map(name=>[name,{
    batches:0,firstFailed:0,retried:0,recovered:0,unavailable:0,errors:{}
  }]));
  const results = await Promise.allSettled(batches.map(batch=>batch.read()));
  const failed = [];
  function recordFailure(stats,error) {
    const status = /HTTP (\d{3})/.exec(error?.message || "")?.[1];
    const kind = status ? "http_" + status : ["TimeoutError","AbortError"].includes(error?.name) ? "timeout" :
      error instanceof SyntaxError || error?.message?.includes("缺失") ? "invalid_response" : "transport";
    stats.errors[kind] = (stats.errors[kind] || 0) + 1;
  }
  for (const [i, result] of results.entries()) {
    const stats = providers[batches[i].provider];
    stats.batches++;
    if (result.status === "rejected") {
      stats.firstFailed++;
      stats.unavailable++;
      recordFailure(stats,result.reason);
      failed.push(i);
    }
  }
  // Both sources time out at 6.5s. Leave another 1.5s to parse and seal the completed stage.
  // Retry the broadest failed requests first, at most three subrequests in this sampling round.
  if (failed.length && Date.parse(cutoffAt) - clock() >= 8000) {
    const retries = failed.sort((a,b)=>batches[b].size-batches[a].size).slice(0,3);
    const attempts = await Promise.allSettled(retries.map(i=>batches[i].read()));
    for (const [r, i] of retries.entries()) {
      const stats = providers[batches[i].provider];
      stats.retried++;
      if (attempts[r].status === "fulfilled") {
        stats.recovered++;
        stats.unavailable--;
        results[i] = attempts[r];
      } else recordFailure(stats,attempts[r].reason);
    }
  }
  const failedCount = Object.values(providers).reduce((n, s)=>n+s.firstFailed+s.retried-s.recovered,0);
  return {results,providers,failedCount};
}

export async function readAuction(market,codes,tradeDate,cutoffAt,fetcher,{asOf=Date.parse(cutoffAt),eventCodes=new Set(),contextCodes=new Set(),references=new Map(),clock=Date.now}={}) {
  if (market==="美股") {
    const [cnbc,scan]=await Promise.all([
      cnbcPremarket(codes,tradeDate,cutoffAt,asOf,fetcher),
      codes.length>tapeLimit ? discoverNasdaq(codes,tradeDate,asOf,fetcher) : [],
    ]);
    const movers=new Map(scan.map(r=>[r.code,r]));
    for(const q of cnbc.rows.values()) {
      movers.set(q.code,{code:q.code,amount:q.amount*q.price,change:(q.price/q.prevClose-1)*100});
    }
    const observations=[...movers.values()].sort((a,b)=>b.amount-a.amount || a.code.localeCompare(b.code));
    const events=codes.filter(code=>eventCodes.has(code)), contexts=codes.filter(code=>contextCodes.has(code));
    const moving=observations.filter(r=>r.change>=0.5 && r.change<5).map(r=>r.code);
    const jumped=observations.filter(r=>r.change>=5).map(r=>r.code);
    const movingCodes=new Set(moving);
    const priorRequests=Math.ceil(codes.length/cnbcBatch)+(codes.length>tapeLimit ? Math.ceil(codes.length/discoveryBatch) : 0);
    const remainingTapes=Math.max(0,Math.min(tapeLimit,auctionBudget-priorRequests));
    const selected=[...new Set([...events.slice(0,6),...contexts.filter(code=>movingCodes.has(code)).slice(0,6),
      ...moving.slice(0,10),...jumped.slice(0,2),...contexts.slice(0,6),...events,...moving,...codes])].slice(0,remainingTapes);
    const out=await settleLimited(selected.map(code=>()=>nasdaqAuction(code,tradeDate,cutoffAt,fetcher,asOf)),6);
    const quotes=new Map(cnbc.rows);
    for (const response of out) {
      const tape=response.status==="fulfilled" && response.value;
      if(!tape)continue;
      // Confirm earlier prints and target crossings without borrowing timestamps or volume.
      quotes.set(tape.code,mergeTrades(quotes.get(tape.code),tape,references.get(tape.code),Date.parse(cutoffAt)-325*60000,asOf));
    }
    return {rows:[...quotes.values()],attempted:codes.length,tapeAttempted:selected.length,
      cnbcReturnedCount:cnbc.returned,cnbcSessionCount:cnbc.rows.size,
      cnbcFreshCount:[...cnbc.rows.values()].filter(q=>asOf-q.at<=5*60000).length,
      tapeReturnedCount:out.filter(r=>r.status==="fulfilled" && r.value).length,
      failedCount:cnbc.failedCount+out.filter(r=>r.status==="rejected").length,discoveryCount:observations.length,
      available:cnbc.rows.size>0 || out.some(r=>r.status==="fulfilled"&&r.value)};
  }
  const batches=[];
  // Both providers must show a dated execution, positive turnover and the auction price.
  if (market==="港股") {
    for(let i=0;i<codes.length;i+=100) {
      const members=codes.slice(i,i+100);
      const url=new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
      url.search=new URLSearchParams({fltt:"2",secids:members.map(code=>"116."+code).join(","),fields:"f12,f13,f2,f17,f18,f6,f15,f16,f124"});
      batches.push({provider:"eastmoney",size:members.length,read:async()=>{
        const j=await (await request(fetcher,url)).json();
        if(j.rc!==0 || !Array.isArray(j.data?.diff))throw Error("东方财富竞价报价缺失");
        return j.data.diff.filter(r=>r.f13===116 && members.includes(r.f12)).map(r=>({...r,basis:"eastmoney-hk-turnover"}));
      }});
    }
  }
  for(let i=0;i<codes.length;i+=380) {
    const members=codes.slice(i,i+380);
    batches.push({provider:"tencent",size:members.length,read:()=>fetchTencentGrowthQuotes({market,codes:members,fetcher,timeoutMs:6500})});
  }
  const hk = market==="港股" ? await readHongKongBatches(batches,cutoffAt,clock) : null;
  const out = hk?.results || await Promise.allSettled(batches.map(batch=>batch.read()));
  const byCode=new Map(), sourceSymbols=new Set();
  for(const result of out) {
    if(result.status!=="fulfilled")continue;
    for(const r of result.value) {
      sourceSymbols.add(r.f12);
      const at=r.f124*1000;
      if(!(r.f17>0 && r.f6>0 && r.f2===r.f17 && r.f18>0 && at>0 && at<=asOf) ||
        (market==="港股" && (r.f15!==r.f2 || r.f16!==r.f2))) continue;
      const quote={code:r.f12,price:r.f2,at,amountAt:at,amount:r.f6,unit:"原币",basis:r.basis,
        liquid:r.f6>=(market==="港股"?1e6:2e6),multiple:true,prevClose:r.f18,
        source:r.basis ? "东方财富港股竞价快照" : "腾讯竞价成交快照",
        url:r.basis ? "https://quote.eastmoney.com/hk/"+r.f12+".html" : quotesPage};
      const prior=byCode.get(r.f12), start=Date.parse(cutoffAt)-(market==="港股"?5:0)*60000;
      // Prefer turnover continuity from Tencent when both publish the same instant.
      byCode.set(r.f12,prior?.at===at && !quote.basis ? mergeTrades(quote,prior,references.get(r.f12),start,asOf)
        : mergeTrades(prior,quote,references.get(r.f12),start,asOf));
    }
  }
  return {rows:[...byCode.values()],attempted:codes.length,providerQuotedCount:sourceSymbols.size,
    ...(hk ? {providers:hk.providers} : {}),
    failedCount:hk?.failedCount ?? out.filter(r=>r.status==="rejected").length,available:out.some(r=>r.status==="fulfilled")};
}
