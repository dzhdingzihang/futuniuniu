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
  for(const label of ["业绩指引","同业线索","08:30","09:23","盘前价待核对","流动性","测试跳涨","盘前达标价","（+6.10%）","最多逐只核验 8 只","冻结前最新 +2.00%","竞价或盘前成交 0 只","部分可用"]) assert.ok(html.includes(label),label);
  assert.match(html,/href="https:\/\/example.org\/event"/);
  assert.doesNotMatch(html,/javascript:|盘后信息/);
  assert.match(html,/触及线[^<]*13\.1565/);
});
test("upcoming sessions keep last published date separate and distinguish a frozen empty list from a missed archive",()=>{
  const run=ui();
  const board={market:"美股",label:"纳斯达克",sessionDate:"2026-11-16",scope:"测试范围",total:220,
    cutoffAt:"2026-11-16T14:25:00Z",phase:"waiting",reason:"等待盘前窗口",latest:snapshot};
  const draw=data=>run('(state.preopenData={markets:{"美股":data}},preopenMarketCard("美股"))',data);
  assert.match(draw(board),/上一次记录 · 2026-11-13/);
  assert.match(draw({...board,latest:null}),/尚无历史冻结记录/);
  const empty={...snapshot,tradeDate:board.sessionDate,candidates:[],jumped:[],reason:"证据不足"};
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
