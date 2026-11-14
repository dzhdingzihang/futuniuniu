import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIntradayPool } from "../functions/lib/radar-intraday.js";

const market = "A股";
const first = new Date("2026-11-16T02:00:00Z");
const second = new Date("2026-11-16T02:05:00Z");
const MIN = 60_000;

function clock(now = second, change = {}) {
  const start = Date.parse("2026-11-16T01:30:00Z");
  return { tradeDate:"2026-11-16", sessionKey:"am", phase:"trading", elapsedMinutes:(now-start)/MIN,
    remainingMinutes:240-(now-start)/MIN, sessionStartAt:new Date(start).toISOString(), closeAt:"2026-11-16T07:00:00Z", ...change };
}

function quote(index, now, change = {}) {
  const code = String(300001 + index);
  const isLeader = index === 0;
  const firstPrice = isLeader ? 100.2 : 100;
  const price = now <= first ? firstPrice : isLeader ? 101.3 : 100 + index * 0.001;
  const amount = now <= first ? 5_000_000 : isLeader ? 7_500_000 : 5_650_000;
  return { market, code, name:"股票" + index, quoteUpdatedAt:now.toISOString(), metrics:{
    price, prevClose:100, open:100, high:Math.max(100.6,price), low:99.8, amount,
    volumeRatio:isLeader ? 1.9 : 1, changePct:price-100, ...change,
  }};
}
function quotes(now) { return Array.from({length:80}, (_,i)=>quote(i,now)); }
function run(now, rows, previousBaseline = null, options = {}) {
  return evaluateIntradayPool({market,rows,now,previousBaseline,sessionOverride:clock(now),...options});
}
function base() { return run(first,quotes(first)).baseline; }

test("first poll is a baseline, the second poll ranks actionable relative momentum rather than a prior close winner", () => {
  const firstResult = run(first,quotes(first));
  assert.equal(firstResult.state,"insufficient_pairs");
  assert.equal(firstResult.candidates.length,0);
  const secondResult = run(second,quotes(second),JSON.parse(JSON.stringify(firstResult.baseline)));
  assert.equal(secondResult.state,"ready");
  assert.equal(secondResult.qualifiedCount,1);
  const [row] = secondResult.candidates;
  assert.equal(row.code,"300001");
  assert.equal(row.signal.price,101.3);
  assert.equal(row.signal.intervalMinutes,5);
  assert.equal(row.signal.neededPct,3.65);
  assert.ok(row.score>=65 && row.score<=100);
  assert.ok(row.signal.relativeMovePct>=0.15);
  assert.ok(row.signal.turnoverPace>1 && row.signal.volumeRatio>1);
  assert.ok(row.reasons.length && row.risks.length);
});

test("late or future quotes, incoherent prices and undersized comparable cohorts cannot create a signal", () => {
  const rows = quotes(second);
  const baseline = base();
  for (const stamp of [new Date(second.getTime()+5_000),new Date(second.getTime()-3*MIN-1)]) {
    const updated = rows.map(r=>({...r,quoteUpdatedAt:stamp.toISOString()}));
    assert.equal(run(second,updated,baseline).state,"insufficient_quotes");
  }
  for (const change of [{open:null}, {high:100}, {amount:0}, {changePct:10}, {volumeRatio:null}]) {
    assert.equal(run(second,[quote(0,second,change),...rows.slice(1)],baseline).qualifiedCount,0);
  }
  assert.equal(run(second,rows,baseline,{total:500}).state,"insufficient_quotes");
  assert.equal(run(second,rows, {...baseline, rows:Object.fromEntries(Object.entries(baseline.rows).slice(0,20))}).state,"insufficient_pairs");
});

test("regular off-session, before confirmation, lunch reset, old quotes, and late session all abstain", () => {
  const rows = quotes(second);
  const prior = base();
  for (const phase of ["preopen","break","closed","holiday"]) {
    assert.equal(run(second,rows,prior,{sessionOverride:clock(second,{phase})}).state,"off_session");
  }
  assert.equal(run(second,rows,prior,{sessionOverride:clock(second,{elapsedMinutes:10})}).state,"warming_up");
  assert.equal(run(second,rows,prior,{sessionOverride:clock(second,{remainingMinutes:60})}).state,"late");
  assert.equal(run(second,rows,{...prior,tradeDate:"2026-11-13"}).state,"insufficient_pairs");
  assert.equal(run(second,rows,{...prior,sessionKey:"pm"}).state,"insufficient_pairs");
  const later = new Date(first.getTime()+17*MIN);
  assert.equal(run(later,quotes(later),prior).state,"insufficient_pairs");
});

test("rapid repeat polls do not reset the reference, a duplicate ticker is counted once", () => {
  const tooEarly = new Date(second.getTime()-3*MIN);
  const initial = base();
  const early = run(tooEarly, quotes(tooEarly),initial);
  assert.equal(early.state,"insufficient_pairs");
  assert.deepEqual(early.baseline.rows,initial.rows);
  const rows=quotes(second);
  const finished = run(second,[...rows,rows[0]],early.baseline,{total:80});
  assert.equal(finished.quotedCount,80);
  assert.equal(finished.qualifiedCount,1);
});

test("already spiked, gapped, thin or unconfirmed issues and a weak market are excluded", () => {
  const rows=quotes(second), prior=base();
  const reject = changes => run(second,[quote(0, second, changes),...rows.slice(1)],prior).qualifiedCount;
  for (const changes of [
    {high:105}, {price:103.5,high:103.5,changePct:3.5},
    {price:102.7,open:102.5,high:102.9,changePct:2.7},
    {volumeRatio:1.19}, {amount:5_100_000}, {amount:5_000_000},
    {high:103.3},
  ]) assert.equal(reject(changes),0,JSON.stringify(changes));
  const weak = rows.map((row,i)=>i===0 ? row : quote(i,second,{price:98,open:98,high:100,low:97.9,changePct:-2}));
  assert.equal(run(second,weak,prior).state,"weak_market");
  assert.equal(run(second,weak,prior).qualifiedCount,0);
});

test("interval size is normalized for mixed quote timestamps and flat-price liquid peers count", () => {
  const prior = base();
  const rows = quotes(second);
  for (const row of rows.slice(1)) {
    row.metrics.price=100;
    row.metrics.changePct=0;
    row.metrics.amount=prior.rows[row.code][2];
  }
  const r = run(second,rows,prior);
  assert.equal(r.universeMedianPct,0);
  assert.equal(r.comparedCount,80);
  assert.equal(r.qualifiedCount,1);
});

test("HK and Nasdaq liquidity and minimum price filters use listing currency", () => {
  for (const [localMarket, minPrice] of [["港股",1],["美股",3]]) {
    const probe = (priceScale, amountScale) => {
      const convert = row => {
        const metrics={...row.metrics};
        for (const field of ["prevClose","open","high","low","price"]) metrics[field] *= priceScale;
        metrics.amount *= amountScale;
        return {...row, market:localMarket, metrics};
      };
      const firstResult = run(first,quotes(first).map(convert),null,{market:localMarket});
      return run(second,quotes(second).map(convert),firstResult.baseline,{market:localMarket});
    };
    assert.equal(probe(1,1).qualifiedCount,1);
    assert.equal(probe(minPrice/200,1).qualifiedCount,0);
    assert.equal(probe(1,0.001).qualifiedCount,0);
  }
});
