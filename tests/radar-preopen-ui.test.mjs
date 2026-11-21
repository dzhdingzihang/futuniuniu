import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";

const app = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
function ui(search = "") {
  const ctx = vm.createContext({URL, location:{hash:"#radar",search},localStorage:{getItem:()=>null}});
  vm.runInContext(app.slice(0, app.lastIndexOf("\nstart().catch")),ctx);
  return (expr, value) => {ctx.data = value; return vm.runInContext(expr,ctx);};
}
const cutoffAt = "2026-11-13T14:25:00Z";
const snapshot = {tradeDate:"2026-11-13",cutoffAt,publishedAt:cutoffAt,status:"frozen",candidates:[
  {code:"DEMO",name:"测试样本",prevClose:12.53,prePrice:null,preChangePct:null,
    evidence:[{label:"业绩指引",detail:"调高预期",at:"2026-11-13T13:30:00Z",source:"测试公告",url:"https://example.org/event"},
      {label:"同业线索",detail:"同业走强",at:"2026-11-13T14:23:00Z",source:"报价",url:"javascript:alert(1)"},
      {label:"盘后信息",at:"2026-11-13T15:30:00Z"}],risks:["流动性"]}],
    jumped:[{name:"测试跳涨",code:"JUMP",prevClose:100,jumpPrice:106.1,preChangePct:2,jumpAt:"2026-11-13T14:17:00Z"}],sources:[{kind:"event",label:"公司公告",status:"partial",detail:"仅覆盖部分"}],
    coverage:{referenceCount:220,eventCount:17,auctionCount:0,contextCount:80}};
test("default radar offers pre-open predictions, distinct confirmations and a segregated fictional example",()=>{
  const run=ui();
  assert.equal(run("state.radarScope"),"preopen");
  for (const name of ["intraday","growth","market","preopen"]) assert.equal(ui("?radar="+name)("state.radarScope"),name);
  const page=run("radarPage()");
  assert.match(page,/data-radar-scope="preopen" aria-pressed="true"/);
  assert.match(page,/盘中确认/);
  assert.match(page,/虚构股票 · 独立演示/);
  assert.doesNotMatch(page.slice(page.indexOf("三地盘前冻结名单"),page.indexOf("看判读示例")),/乙股/);
});
test("frozen cards show sourced timed evidence, coverage and separate gaps with no invented missing preprice",()=>{
  const html=ui()('preopenFrozen(data,"美股")',snapshot);
  const visibleText=html.replace(/<[^>]+>/g, "");
  for(const label of ["业绩指引","同业线索","08:30","09:23","盘前价待核对","流动性","测试跳涨","盘前达标价","（+6.10%）","冻结前最新 +2.00%","竞价或盘前成交 0 只","部分可用"]) assert.ok(visibleText.includes(label),label);
  assert.match(html,/href="https:\/\/example.org\/event"/);
  assert.doesNotMatch(html,/javascript:|盘后信息/);
  assert.match(html,/触及线[^<]*13\.1565/);
});
test("upcoming sessions keep last published date separate and distinguish a frozen empty list from a missed archive",()=>{
  const run=ui();
  run('Date.now = () => Date.parse("2026-11-16T15:00:00Z")');
  const board={market:"美股",label:"纳斯达克",sessionDate:"2026-11-16",scope:"测试范围",total:220,
    cutoffAt:"2026-11-16T14:25:00Z",phase:"waiting",reason:"等待盘前窗口",latest:snapshot};
  const draw=data=>run('(state.preopenData={markets:{"美股":data}},preopenMarketCard("美股"))',data);
  assert.match(draw(board),/最近收盘日 <time>2026-11-13<\/time>/);
  assert.match(draw({...board,latest:null}),/尚无历史冻结记录/);
  const empty={...snapshot,tradeDate:board.sessionDate,cutoffAt:board.cutoffAt,selectionStatus:"confirmed_empty",candidates:[],jumped:[],reason:"证据不足"};
  assert.match(draw({...board,phase:"frozen",latest:empty}),/本次冻结为空榜/);
  assert.doesNotMatch(draw({...board,phase:"missed",reason:"冻结缺档",latest:null}),/本次冻结为空榜/);
});
test("evaluation reports denominators, missing quotes, opening hits and fading distinctly",()=>{
  const stats={count:7,verified:5,missing:2,hits:4,hitRate:80,openHits:1,intradayHits:3,held:2,faded:2};
  const args={evaluation:{days:2,emptyDays:1,fromDate:"2026-11-12",toDate:"2026-11-13",groups:{
    picks:stats,pool:stats,yesterdayLeaders:{...stats,verified:0,hits:0,hitRate:null}}},
    results:[{tradeDate:"2026-11-13",rows:[{name:"甲测试",groups:["picks"],status:"verified",highChangePct:9,closeChangePct:2,
      openToClosePct:-1,hit:true,held:false,firstTouch:{kind:"open"}}]}]};
  const html=ui()('preopenReview(data,"美股")',args);
  for(const label of ["盘前主榜","全候选池","昨日涨幅前三","4 / 5","80.0%","开盘即触及 1 笔","收盘回落 2 笔","甲测试","缺数据"]) assert.ok(html.includes(label),label);
  assert.match(html,/0 \/ 0<\/td><td>—/);
});

test("a prior session or failed refresh never presents archived names as current candidates", () => {
  const run=ui();
  run('Date.now = () => Date.parse("2026-11-16T15:00:00Z")');
  const board={market:"美股",sessionDate:snapshot.tradeDate,phase:"frozen",latest:snapshot};
  const draw=()=>run('(state.preopenData={markets:{"美股":data}}, [preopenHeadline(), preopenMarketCard("美股")])', board);
  const [headline, card]=draw();
  assert.doesNotMatch(headline,/股票入选/);
  assert.match(card,/最近收盘日 <time>2026-11-13<\/time>/);
  assert.doesNotMatch(card,/核对盘中信号/);
  run('Date.now = () => Date.parse("2026-11-13T15:00:00Z"); state.preopenError="读取失败"');
  assert.doesNotMatch(draw()[1],/核对盘中信号/);
});

test("verified candidates have a specific next step and aggregate only open lots in the same market", () => {
  const run=ui();
  run('Date.now = () => Date.parse("2026-11-13T15:00:00Z")');
  run('state.holdings = data', [
    {market:"美股",code:"DEMO",qty:5},{market:"美股",code:"demo",qty:2},
    {market:"美股",code:"DEMO",qty:4,status:"sold"},{market:"港股",code:"DEMO",qty:20}
  ]);
  const html=run('(state.preopenData={markets:{"美股":{sessionDate:data.tradeDate,phase:"frozen",latest:data}}}, preopenMarketCard("美股"))',snapshot);
  assert.match(html,/已持有 7 股/);
  assert.match(html,/data-radar-jump="intraday" data-research-market="美股"/);
  assert.match(html,/调高预期/);
  const broken={...snapshot,candidates:[{...snapshot.candidates[0],evidence:[snapshot.candidates[0].evidence[0]]}]};
  const card=run('(state.preopenData={markets:{"美股":{sessionDate:data.tradeDate,phase:"frozen",latest:data}}}, preopenMarketCard("美股"))',broken);
  assert.match(card,/候选证据待核实/);
  assert.doesNotMatch(card,/本次冻结为空榜|核对盘中信号/);
});

test("intraday state excludes an earlier trigger from a fresh scan and earlier-session archives from the headline",()=>{
  const run=ui();
  const now="2026-11-13T15:00:00Z";
  const row={code:"DEMO",name:"模拟标的",triggerAt:now,triggerPrice:10,targetPrice:10.5};
  const snap={market:"美股",sessionDate:"2026-11-13",phase:"open",status:"live",scannedAt:now,
    closeAt:"2026-11-13T21:00:00Z",candidates:[row,{...row,code:"STALE",triggerAt:"2026-11-13T13:45:00Z"}]};
  run('Date.now=()=>Date.parse("2026-11-13T15:00:01Z");state.intradayData={markets:{"美股":data}}',snap);
  assert.match(run('intradayPage()'),/本轮有 1 只股票触发/);
  assert.doesNotMatch(run('intradayPage()'),/STALE/);
  run('state.intradayError="读取失败"');
  assert.doesNotMatch(run('intradayPage()'),/本轮已触发|本轮有 1 只股票触发/);
});

const saturday = "2026-11-14T08:00:00Z";
const monday = "2026-11-16";
const friday = "2026-11-13";
function restingBoard(market, latest) {
  return {market,total:230,localDate:"2026-11-14", marketPhase:"holiday", sessionDate:monday, lastClosedDate:friday,
    cutoffAt:monday + (market === "美股" ? "T14:25:00Z" : "T01:25:00Z"), phase:"waiting", latest,results:[]};
}

test("weekend lead distinguishes exact-date unverified names, confirmed non-hits, published empty lists and lost issues", () => {
  const run=ui();
  run('Date.now=(time=>()=>time)(Date.parse(data))',saturday);
  const us=restingBoard("美股",snapshot);
  const cn=restingBoard("A股",{...snapshot,selectionStatus:"confirmed_empty",candidates:[]});
  const hk=restingBoard("港股",{...snapshot,tradeDate:"2026-11-12"});
  us.results=[{tradeDate:"2026-11-12",rows:[{code:"DEMO",name:"错日记录",groups:["picks"],status:"verified",hit:true}]}];
  const draw=()=>run('(state.preopenData=data,preopenPage())',{asOf:saturday,markets:{"A股":cn,"港股":hk,"美股":us}});
  let page=draw(), summary=page.slice(page.indexOf("radar-session-heading"),page.indexOf("radar-market-picker"));
  assert.match(summary,/休市 · 最近一期盘前名单/);
  assert.match(summary,/已验证 0 只/);
  assert.match(page,/盘前记录缺档/); assert.match(page,/已发布空榜/);
  assert.match(page,/2026-11-16 09:25 美东时间/); assert.match(page,/2026-11-16 22:25 北京时间/);
  assert.doesNotMatch(page.slice(page.indexOf("radar-board-美股"),page.indexOf("card preopen-review")),/错日记录|未触及/);
  assert.ok(page.indexOf('class="card preopen-review"') < page.indexOf("虚构股票 · 独立演示"));
  assert.ok(page.indexOf("card preopen-review") < page.indexOf("preopen-universe"));
  us.results.push({tradeDate:friday,rows:[{code:"DEMO",groups:["picks"],status:"verified",hit:false,held:false}]});
  page=draw(); assert.match(page,/已验证 1 只，其中 0 只盘中触及/); assert.match(page,/未触及/);
});

test("mixed sessions keep the NY board live and Asian archives historical; early closes suppress follow-up trading prompts",()=>{
  const run=ui();
  const now="2026-11-13T16:00:00Z";
  run('Date.now=(time=>()=>time)(Date.parse(data))',now);
  const asia={...restingBoard("A股",snapshot),localDate:"2026-11-14"};
  const us={market:"美股",localDate:friday,marketPhase:"trading",closeAt:friday+"T18:00:00Z",
    lastClosedDate:"2026-11-12",sessionDate:friday,phase:"frozen",latest:snapshot,nextCutoffAt:monday+"T14:25:00Z"};
  const views=()=>run('(state.preopenData=data,[preopenPage(),preopenMarketCard("美股"),preopenMarketCard("港股")])',
    {markets:{"A股":asia,"港股":asia,"美股":us}});
  let [page, card, hk]=views();
  assert.match(page,/交易中 · 盘前候选与盘中确认/);
  assert.match(card,/调高预期/);assert.match(card,/报价过期或量价转弱/);assert.match(card,/核对盘中信号/);
  assert.doesNotMatch(hk,/核对盘中信号/);
  run('Date.now=()=>Date.parse("2026-11-13T18:01:00Z")');
  us.lastClosedDate=friday;
  [page,card]=views();
  assert.match(card,/已收盘/);assert.match(card,/可验证 0 \/ 1/);assert.doesNotMatch(card,/核对盘中信号/);
});

test("the latest pointer cannot replace a missing previous trading date; an exact-date backup can restore it",()=>{
  const run=ui();
  run('Date.now=(time=>()=>time)(Date.parse(data))',saturday);
  const snap=restingBoard("美股",{...snapshot,tradeDate:"2026-11-10"});
  const closed=()=>run('preopenArchive(preopenClosedIssue(data,"美股"))',snap);
  assert.match(closed(),/盘前记录缺档/);
  snap.lastClosedRecord={...snapshot,tradeDate:"2026-11-12"};
  assert.doesNotMatch(closed(),/测试样本/);
  snap.lastClosedRecord=snapshot;
  assert.match(closed(),/测试样本/);
});

test("legacy zero-pick archives report actual coverage in the market cards, current heading and weekend digest",()=>{
  const run=ui();
  const empty=(market,eligibleCount,auctionAttempted) => ({...snapshot,market,candidates:[],jumped:[],
    coverage:{eligibleCount,auctionAttempted,auctionCount:0,eventCount:market==="港股"?1:0,contextCount:0}});
  const hk=empty("港股",228,228), us=empty("美股",1215,8);
  run('Date.now=(time=>()=>time)(Date.parse(data))',saturday);
  const boards={"港股":restingBoard("港股",hk),"美股":restingBoard("美股",us),"A股":restingBoard("A股",{...snapshot,status:"unavailable",coverage:null,candidates:[]})};
  const page=run('(state.preopenData={markets:data},preopenPage())',boards);
  assert.match(page,/港股科技、纳斯达克证据覆盖不足/);
  assert.match(page,/已查 8 只，可核验 0 只/);
  assert.match(page,/事件命中 1 只/);
  assert.doesNotMatch(page,/已发布空榜|上期空榜/);
  run('Date.now=()=>Date.parse("2026-11-13T15:00:00Z")');
  assert.match(run('(state.preopenData={markets:{"美股":data}},preopenHeadline())',{sessionDate:friday,phase:"frozen",latest:us}),/部分证据未能核实/);
});

test("archived capture detail distinguishes missing close references from retained successful slots",()=>{
  const run=ui();
  assert.match(run("preopenCaptureSummary(data)",{market:"A股",referenceDate:"2026-11-19",reference:null,stages:[]}),/11-19 的昨收参考目前查不到。.*查不到截止前完成的采样档/);
  assert.match(run("preopenCaptureSummary(data)",{market:"港股",referenceDate:"2026-11-19",reference:{observedAt:"2026-11-20T01:11:00Z",validCount:268},stages:[{slot:555},{slot:560}]}),/09:11 入库，共 268 只。.*09:15、09:20/);
});
