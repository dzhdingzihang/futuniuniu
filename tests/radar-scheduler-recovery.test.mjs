import assert from "node:assert/strict";
import test from "node:test";
import { createRadarScheduler, runScheduledRadarRefresh } from "../workers/radar-scheduler/index.js";

const markets = ["A股", "港股", "美股"];
const mainTime = "2026-11-14T00:10:00.000Z";
const recoveryTime = "2026-11-14T00:40:00.000Z";

function setup() {
  let value = null;
  const env = { RADAR_SNAPSHOTS: {
    async get() { return value; },
    async put(_, text) { value = text; },
  } };
  const calls = [];
  const run = (time, fail = []) => {
    const scheduler = createRadarScheduler(options => runScheduledRadarRefresh({
      ...options,
      async scanMarket(market) {
        calls.push(market);
        if (fail.includes(market)) throw Error("source unavailable");
        return { market, fetchedAt: time, candidates: [{ code: market + time }] };
      },
    }));
    let result;
    scheduler.scheduled({ scheduledTime: Date.parse(time), cron: time.includes("T00:40") ? "40 0 * * *" : "10 0 * * *" },
      env, { waitUntil(job) { result = job; } });
    return result;
  };
  return { env, calls, run };
}

test("08:40 retry scans only missing markets, preserves successful market snapshots and skips duplicate events", async () => {
  const { calls, run } = setup();
  const first = await run(mainTime, ["港股"]);
  assert.deepEqual(first.envelope.status.unavailableMarkets, ["港股"]);
  const retry = await run(recoveryTime);
  assert.deepEqual(calls, [...markets, "港股"]);
  assert.deepEqual(retry.envelope.status.freshMarkets, markets);
  assert.deepEqual(retry.envelope.markets["A股"], first.envelope.markets["A股"]);
  assert.deepEqual(retry.envelope.markets["美股"], first.envelope.markets["美股"]);
  assert.equal(retry.envelope.markets["港股"].fetchedAt, recoveryTime);
  assert.equal(retry.envelope.publishedAt, recoveryTime);
  assert.equal((await run(recoveryTime)).written, false);
  assert.equal((await run(mainTime)).written, false);
  assert.equal(calls.length, 4);
});

test("failure on the retry exposes its timestamp, keeps the latest successful publication and old HK candidates", async () => {
  const { calls, run } = setup();
  const old = await run("2026-11-13T00:10:00.000Z");
  const first = await run(mainTime, ["港股"]);
  const retry = await run(recoveryTime, ["港股"]);
  assert.deepEqual(calls, [...markets, ...markets, "港股"]);
  assert.equal(retry.envelope.attemptedAt, recoveryTime);
  assert.equal(retry.envelope.publishedAt, mainTime);
  assert.deepEqual(retry.envelope.markets["港股"].candidates, old.envelope.markets["港股"].candidates);
  assert.equal(retry.envelope.markets["港股"].error.at, recoveryTime);
  assert.deepEqual(retry.envelope.status, first.envelope.status);
});

test("recovery catches a missed primary run and leaves a completed run alone", async () => {
  const { calls, run } = setup();
  await run("2026-11-13T00:10:00.000Z");
  const result = await run(recoveryTime);
  assert.equal(result.written, true);
  assert.deepEqual(calls, [...markets, ...markets]);
  const current = setup();
  const first = await current.run(mainTime);
  const skip = await current.run(recoveryTime);
  assert.deepEqual(current.calls, markets);
  assert.equal(skip.written, false);
  assert.deepEqual(skip.envelope, first.envelope);
});

test("a failed KV read cannot replace a previous dataset with an empty failure envelope", async () => {
  const { env, run, calls } = setup();
  env.RADAR_SNAPSHOTS.get = async () => { throw Error("storage unavailable"); };
  await assert.rejects(run(mainTime), /storage unavailable/);
  assert.deepEqual(calls, []);
});
