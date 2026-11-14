import { readAuction, readIndustries, readNews } from "./preopen-feeds.js";
import { GROWTH_SEGMENTS } from "./radar-segment.js";

const minute = 60000;
const day = 86400000;
const iso = ms => new Date(ms).toISOString();
const finite = Number.isFinite;
const pct = value => value.toFixed(1) + "%";

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function closeRows(rows, market, previousClose, previousDate, asOf) {
  const format = new Intl.DateTimeFormat("en-CA", {timeZone: market === "美股" ? "America/New_York" : "Asia/Shanghai",
    year:"numeric", month:"2-digit", day:"2-digit"});
  const date = previousDate || format.format(previousClose);
  const result = new Map();
  for (const row of rows) {
    const time = Date.parse(row.quoteUpdatedAt);
    const m = row.metrics;
    if (row.market !== market || !finite(time) || time > asOf || format.format(time) !== date ||
        !m || !finite(m.price) || m.price <= 0 || !finite(m.changePct) || !(m.amount > 0)) continue;
    result.set(row.code, row);
  }
  return [...result.values()];
}

function liquidStock(row, market) {
  return row.metrics.amount >= GROWTH_SEGMENTS[market].amountFloor &&
    (market !== "美股" || row.metrics.price >= 3) && !/^(?:S\*?ST|\*?ST)|退市/.test(row.name);
}

function contextFor(rows, industries, previousClose) {
  const groups = new Map();
  for (const row of rows) {
    const industry = industries.get(row.code);
    if (!industry) continue;
    if (!groups.has(industry)) groups.set(industry, []);
    groups.get(industry).push(row);
  }
  const contexts = new Map();
  const tested = new Set();
  for (const [industry, group] of groups) {
    if (group.length < 6) continue;
    // Sort once, then remove the company itself when measuring its industry's peers.
    const sorted = group.slice().sort((a,b) => a.metrics.changePct - b.metrics.changePct);
    const advancing = sorted.filter(r=>r.metrics.changePct>0).length;
    const count = sorted.length - 1;
    for (const [index, row] of sorted.entries()) {
      const middle = Math.floor(count/2);
      const adjust = i=>sorted[i+(i>=index ? 1 : 0)].metrics.changePct;
      const peerMedian = count % 2 ? adjust(middle) : (adjust(middle-1)+adjust(middle))/2;
      const breadth = (advancing - Number(row.metrics.changePct>0))/count;
      const {price, high, low, changePct} = row.metrics;
      if (!(high >= price && price >= low && low > 0 && high > low)) continue;
      tested.add(row.code);
      if (peerMedian < 0.5 || breadth < 0.60 || (price-low)/(high-low) < 0.7 || changePct < peerMedian) continue;
      contexts.set(row.code, {strength:Math.min(3,peerMedian) + breadth,
        item:{kind:"context",type:"context",label:"昨日同行与个股共振",at:iso(Math.max(previousClose,industries.observedAt || previousClose)),
          source:"TradingView 行业分类／候选池昨收快照",url:"https://www.tradingview.com/screener/",
          detail:industry+" 组内其余 "+count+" 只的昨日涨幅中位数 "+pct(peerMedian)+"，上涨占比 "+pct(breadth*100)+"。个股昨日涨 "+pct(changePct)+"，收在当日振幅的上部。"}});
    }
  }
  return {contexts,tested};
}

function acceptedEvents(news, previousClose, now, pool) {
  const events = new Map();
  for (const event of news.rows) {
    if (!pool.has(event.code) || !finite(event.at) || event.at <= previousClose || event.at > now) continue;
    if (!events.has(event.code) || event.at > events.get(event.code).at) events.set(event.code, event);
  }
  return events;
}

function readVolumeRatio(history, tradeDate, amount) {
  const days = new Map();
  for (const point of history || []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(point.date) && point.date < tradeDate &&
        Date.parse(tradeDate)-Date.parse(point.date)<=40*day && finite(point.amount) && point.amount > 0) days.set(point.date, point.amount);
  }
  if (days.size < 5) return null;
  const baseline = [...days].sort(([a],[b])=>b.localeCompare(a)).slice(0,10).map(pair=>pair[1]);
  return {ratio:amount/median(baseline), count:baseline.length};
}

function eventItem(event) {
  return {kind:"event",type:"event",label:"收盘后公司披露",source:event.source,url:event.url,at:iso(event.at),detail:event.title};
}

const feeds = {readNews, readIndustries, readAuction};
export async function buildPreopenEvidence({market, tradeDate, cutoffAt, asOf, previousCloseAt, previousTradeDate, rows = [],
  historyAmounts = {}, fetcher = fetch, providers = feeds}) {
  const now = Date.parse(asOf), cutoff = Date.parse(cutoffAt), previousClose = Date.parse(previousCloseAt);
  const coverage = {referenceCount:0, eligibleCount:0, industryCount:0, auctionAttempted:0, auctionCount:0,
    eventCount:0, contextCount:0, abnormalVolumeCount:0, comparablePriceRejected:0};
  const result = {candidates:[], jumped:[], evidenceAvailable:false, reason:"", sources:[], coverage, observations:{}};
  if (![now,cutoff,previousClose].every(finite) || now > cutoff || now <= previousClose || !Object.hasOwn(GROWTH_SEGMENTS,market)) {
    result.reason="缺少可核实的盘前时点或前收。"; return result;
  }
  const refs = closeRows(rows, market, previousClose, previousTradeDate, now);
  coverage.referenceCount = refs.length;
  const eligible = refs.filter(r=>liquidStock(r,market));
  coverage.eligibleCount = eligible.length;
  if (!eligible.length) {result.reason="缺少同一交易日前收和符合流动性门槛的股票。";return result;}
  const allCodes = refs.map(r=>r.code);
  const [newsResult, industryResult] = await Promise.allSettled([
    providers.readNews(market,fetcher), providers.readIndustries(market,allCodes,fetcher,now),
  ]);
  const news = newsResult.status==="fulfilled" ? newsResult.value : {rows:[],available:false,label:"公司公告／新闻稿",detail:"本次来源请求失败。"};
  const events = acceptedEvents(news,previousClose,now,new Set(eligible.map(r=>r.code)));
  const industries = industryResult.status==="fulfilled" ? industryResult.value : new Map();
  const {contexts,tested} = contextFor(refs,industries,previousClose);
  coverage.industryCount=industries.size; coverage.eventCount=events.size;
  coverage.contextCount=eligible.filter(r=>contexts.has(r.code)).length;
  coverage.contextTestableCount=eligible.filter(r=>tested.has(r.code)).length;
  coverage.auctionTestableCount=0;
  const ordered = eligible.slice().sort((a,b)=>Number(events.has(b.code))-Number(events.has(a.code)) ||
    (contexts.get(b.code)?.strength||0)-(contexts.get(a.code)?.strength||0) ||
    b.metrics.amount-a.metrics.amount || a.code.localeCompare(b.code));
  // Nasdaq's exchange tape is per security. The Asian matched-price feed supports bulk quotes.
  const codes = ordered.slice(0,market==="美股" ? 8 : 3000).map(row=>row.code);
  let auction;
  try {auction=await providers.readAuction(market,codes,tradeDate,cutoffAt,fetcher);}
  catch {auction={rows:[],attempted:codes.length,available:false};}
  coverage.auctionAttempted=auction.attempted;
  const byCode = new Map(auction.rows.map(q=>[q.code,q]));
  // Only executed trades can establish an auction price. HK begins matching at 09:20.
  // A-share auction indications before 09:25 are not executions.
  const start = cutoff - (market==="美股" ? 325 : market==="港股" ? 5 : 0)*minute;
  for (const row of eligible) {
    const {code,name,currency} = row;
    const prevClose = row.metrics.price;
    const raw = byCode.get(code);
    const sessionQuote = raw?.at >= start && raw.at <= now && raw.price>0 ? raw : null;
    const quote = sessionQuote && now-raw.at<=5*minute ? sessionQuote : null;
    // A different ex-date reference can create a fictitious jump. Exclude the affected security entirely.
    if (sessionQuote && (!(sessionQuote.prevClose>0) || Math.abs(sessionQuote.prevClose/prevClose-1)>0.001)) {
      coverage.comparablePriceRejected++; continue;
    }
    const change = quote ? (quote.price/prevClose-1)*100 : null;
    const targetPrice=prevClose*1.05;
    const observedHigh=sessionQuote && raw.highAt>=start && raw.highAt<=now && raw.high>0 ? raw.high : null;
    // A stale same-session trade cannot establish the current price, but can prove the target was already touched.
    const alreadyJumped=sessionQuote && (raw.price+1e-9>=targetPrice || observedHigh+1e-9>=targetPrice);
    const items=[], risks=[];
    let ratio=null;
    if (quote) {
      coverage.auctionCount++;
      if (quote.amountAt>=start && quote.amountAt<=now && now-quote.amountAt<=5*minute && finite(quote.amount) && quote.amount>0) {
        result.observations[code]={amount:quote.amount,at:iso(quote.amountAt),price:quote.price};
        ratio=readVolumeRatio(historyAmounts[code],tradeDate,quote.amount);
      }
    } else risks.push(alreadyJumped ? "当前价待核对；已取得较早的盘前触及记录。" : "盘前价未核实，无法排除已跳涨。");
    if (ratio) coverage.auctionTestableCount++;
    if (Number(news.available) + Number(tested.has(code)) + Number(Boolean(ratio)) >= 2) result.evidenceAvailable=true;
    const event=events.get(code);
    if (event) items.push(eventItem(event));
    if (quote && ratio?.ratio>=1.8 && quote.liquid && quote.multiple && change>=0.5 && change<5) {
      items.push({kind:"auction",type:"auction",label:"盘前买盘响应",source:quote.source,url:quote.url,at:iso(Math.max(quote.at,quote.amountAt)),
        detail:"盘前涨 "+pct(change)+"，同一时点累计"+(market==="美股"?"成交量":"成交额")+"为前 "+ratio.count+" 个可比交易日中位数的 "+ratio.ratio.toFixed(1)+" 倍。"});
      coverage.abnormalVolumeCount++;
    } else if(quote && !ratio) risks.push("同一时点的历史成交样本不足，或累计成交尚无可核实的时间。");
    const context=contexts.get(code);
    if(context) items.push(context.item);
    if(!alreadyJumped && items.length<2) continue;
    const candidate={code,name,currency,prevClose,targetPrice,prePrice:quote?.price??null,preChangePct:change,
      prePriceAt:quote ? iso(quote.at):null, evidence:items,reasons:items.map(e=>e.detail),risks};
    if(alreadyJumped) {
      const highCrossed=observedHigh!==null && observedHigh>=targetPrice;
      candidate.jumpPrice=highCrossed ? observedHigh : raw.price;
      candidate.jumpAt=iso(highCrossed ? raw.highAt : raw.at);
      candidate.jumpSource=raw.source; candidate.jumpUrl=raw.url;
      result.jumped.push(candidate);
    } else {
      // Evidence count dominates; confirmed participation then peer breadth break ties.
      candidate.score=items.length*10+(items.some(e=>e.kind==="auction")?Math.min(4,ratio.ratio):0)+(context?.strength||0);
      result.candidates.push(candidate);
    }
  }
  result.candidates.sort((a,b)=>b.score-a.score || a.code.localeCompare(b.code));
  result.candidates=result.candidates.slice(0,3).map((r,i)=>({...r,rank:i+1}));
  result.jumped.sort((a,b)=>b.jumpPrice/b.prevClose-a.jumpPrice/a.prevClose || a.code.localeCompare(b.code));
  const auctionLabel=market==="美股"?"Nasdaq 盘前成交":"开盘集合竞价成交";
  result.sources=[
    {kind:"event",label:news.label,status:news.available?"partial":"unavailable",url:news.url,detail:news.detail+" 时间窗内命中 "+events.size+" 只。"},
    {kind:"context",label:"细分行业与昨日收盘",status:industries.size===0?"unavailable":industries.size===refs.length?"available":"partial",
      url:"https://www.tradingview.com/screener/",detail:(industries.description || "")+"已取得 "+industries.size+"/"+refs.length+" 只的行业映射，"+coverage.contextCount+" 只符合同行共振条件。"},
    {kind:"auction",label:auctionLabel,status:!coverage.auctionCount?"unavailable":coverage.auctionCount===eligible.length?"available":"partial",
      url:market==="美股"?"https://www.nasdaq.com/market-activity/pre-market":"https://gu.qq.com/",
      detail:"已查询 "+codes.length+"/"+eligible.length+" 只，"+coverage.auctionCount+" 只有新鲜可比成交。"+
        (market==="美股"?"按公司事件、昨日同行共振和流动性优先逐只核验。":market==="A股"?"09:25 撮合前的虚拟申报价不计入成交。":"只采用 09:20 起已撮合且能核对前收的报价。")+
        " 其中 "+coverage.abnormalVolumeCount+" 只确认异常资金；前收不一致排除 "+coverage.comparablePriceRejected+" 只。"},
  ];
  result.reason=!result.evidenceAvailable ? "没有任何股票可同时核验两类独立证据，本次缺数据。" : result.candidates.length ? "至少两类独立证据同时成立，按证据数量、盘前放量和同行强度排序。" :
    "本次采集范围内，尚未跳涨且同时满足两类独立证据的股票为 0 只。";
  return result;
}
