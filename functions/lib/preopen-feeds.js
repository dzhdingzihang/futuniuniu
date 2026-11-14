// Non-price announcements and exchange-session observations available before the cutoff.
import bundledIndustries from "../../assets/radar-industries.json" with {type:"json"};
import { fetchTencentGrowthQuotes } from "./radar-tencent-quotes.js";

const FEEDS = {
  cn: "https://np-anotice-stock.eastmoney.com/api/security/ann",
  hk: "https://www1.hkexnews.hk/ncms/json/eds/lcisehk7relsdc_",
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

async function cnNews(page,fetcher) {
  const url = new URL(FEEDS.cn);
  url.search = new URLSearchParams({ann_type:"CYB",client_source:"web",sr:"-1",page_size:"100",page_index:String(page)});
  const json = await (await request(fetcher,url)).json();
  if (json.success !== 1 || !Array.isArray(json.data?.list)) throw Error("公告列表缺失");
  const rows=[];
  for (const r of json.data.list) {
    const title=plain(r.title_ch || r.title), at=Math.max(mainlandTime(r.display_time),mainlandTime(r.eiTime));
    if (!eligibleTitle(title) || !/^AN\d+$/.test(r.art_code) || !Number.isFinite(at)) continue;
    for (const security of r.codes || []) rows.push({code:security.stock_code,title,at,source:"东方财富披露公告",
      url:"https://data.eastmoney.com/notices/detail/"+security.stock_code+"/"+r.art_code+".html"});
  }
  return rows;
}

async function hkNews(page,fetcher) {
  const json = await (await request(fetcher,FEEDS.hk+page+".json")).json();
  if (!Array.isArray(json.newsInfoLst)) throw Error("港交所公告列表缺失");
  const rows=[];
  for (const r of json.newsInfoLst) {
    const title=plain(r.title), at=hkTime(r.relTime);
    if (!eligibleTitle(title) || !Number.isFinite(at) || !/^\/listedco\/listconews\/[^?#]+\.pdf$/i.test(r.webPath||"")) continue;
    for(const s of r.stock || []) rows.push({code:s.sc,title,at,source:"港交所披露易",url:"https://www1.hkexnews.hk"+r.webPath});
  }
  return rows;
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

export async function readNews(market,fetcher) {
  const jobs=market==="美股"
    ? ["financial-services-latest-news/earnings-list.rss","health-latest-news/pharmaceuticals-list.rss","news-releases-list.rss"].map(path=>usNews(path,fetcher))
    : (market==="A股"?[1,2]:[1]).map(n=>market==="A股"?cnNews(n,fetcher):hkNews(n,fetcher));
  const output=await Promise.allSettled(jobs);
  const rows=output.filter(r=>r.status==="fulfilled").flatMap(r=>r.value);
  return {rows, available:output.some(r=>r.status==="fulfilled"),
    label:market==="A股"?"创业板公司公告":market==="港股"?"港交所披露易":"发行人限量新闻稿",
    url:market==="A股"?"https://data.eastmoney.com/notices/":market==="港股"?"https://www.hkexnews.hk/":"https://www.prnewswire.com/news-releases/",
    detail:market==="A股"?"扫描最近两页创业板公告，核对展示、入库时间。":market==="港股"?"扫描最新一页主板披露标题，保留正面催化及原始公告。":"扫描三个公开新闻稿频道；仅采用发行人标识与代码均可核对的正面标题。"};
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
async function nasdaqAuction(code,tradeDate,cutoffAt,fetcher) {
  const url="https://api.nasdaq.com/api/quote/"+encodeURIComponent(code)+"/extended-trading?assetclass=stocks&markettype=pre&limit=20";
  const data=(await (await request(fetcher,url)).json()).data;
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
    return [{at:fromEt(+t[1],+t[2],+t[3]),price}];
  }).sort((a,b)=>b.at-a.at);
  const shares=num(top.volume), prevClose=num(data.previousInfo?.match(/\$[\d,.]+/)?.[0]);
  if (!entries.length || !(shares>0) || !(prevClose>0) || entries[0].at>updatedAt+59_999) return null;
  // Price evidence is time-stamped from the tape; cumulative volume may update later.
  const high = /^\$([\d,.]+) \((\d{1,2}):(\d{2}):(\d{2}) AM\)$/i.exec(top.highPrice || "");
  return {code,price:entries[0].price,at:entries[0].at,
    high:high ? num(high[1]) : null, highAt:high ? fromEt(+high[2],+high[3],+high[4]) : null,
    amountAt:updatedAt+(last[6] ? 0 : 59999),amount:shares,unit:"股",
    liquid:shares*entries[0].price>=1e6, multiple:entries.length>=3, prevClose,source:"Nasdaq 盘前成交",
    url:"https://www.nasdaq.com/market-activity/stocks/"+code.toLowerCase()+"/pre-market"};
}

export async function readAuction(market,codes,tradeDate,cutoffAt,fetcher) {
  if (market==="美股") {
    const out=await Promise.allSettled(codes.map(code=>nasdaqAuction(code,tradeDate,cutoffAt,fetcher)));
    return {rows:out.filter(r=>r.status==="fulfilled"&&r.value).map(r=>r.value), attempted:codes.length, available:out.some(r=>r.status==="fulfilled")};
  }
  const jobs=[];
  for(let i=0;i<codes.length;i+=380) jobs.push(fetchTencentGrowthQuotes({market,codes:codes.slice(i,i+380),fetcher,timeoutMs:6500}));
  const out=await Promise.allSettled(jobs);
  const rows=out.filter(r=>r.status==="fulfilled").flatMap(r=>r.value).filter(r=>r.f17>0&&r.f6>0&&r.f2===r.f17&&r.f18>0)
    .map(r=>({code:r.f12,price:r.f2,at:r.f124*1000,amountAt:r.f124*1000,amount:r.f6,unit:"原币",
      liquid:r.f6>=(market==="港股"?1e6:2e6), multiple:true, prevClose:r.f18,
      source:"腾讯竞价成交快照",url:quotesPage}));
  return {rows,attempted:codes.length,available:out.some(r=>r.status==="fulfilled")};
}
