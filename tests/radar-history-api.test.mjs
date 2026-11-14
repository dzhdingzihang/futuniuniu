import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "../functions/api/history.js";

const saturday = Date.parse("2026-11-14T10:00:00Z");

function sessions(count, lastDay = "2026-11-13") {
  const day = new Date(lastDay + "T13:00:00Z");
  const dates = [];
  while (dates.length < count) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.unshift(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return dates;
}

function yahoo(dates, { realOhlc = true } = {}) {
  const quote = { close: dates.map(() => 12) };
  if (realOhlc) Object.assign(quote, {
    open: dates.map(() => 11), high: dates.map(() => 13), low: dates.map(() => 10),
  });
  return Response.json({ chart: { result: [{
    timestamp: dates.map(day => Date.parse(day + "T14:30:00Z") / 1000), indicators: { quote: [quote] },
  }] } });
}

function eastmoney(dates, prices = "11,12,13,10") {
  return Response.json({ data: { klines: dates.map(day => day + "," + prices) } });
}

function query(symbols, fetcher, strict = true) {
  const request = new Request("https://example.test/api/history?days=90&symbols=" + symbols + (strict ? "&ohlc=1" : ""));
  return onRequestGet({ request, fetcher }).then(response => response.json());
}

test("radar uses fresh genuine OHLC from a fallback and maps punctuated US share classes for Yahoo", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const dates = sessions(85);
  for (const symbol of ["gb_brk.b", "gb_brk-b"]) {
    const calls = [];
    const { histories } = await query(symbol, (input, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      const url = new URL(input);
      calls.push(url.hostname);
      if (url.hostname.includes("yahoo")) {
        assert.equal(url.pathname, "/v8/finance/chart/BRK-B");
        return yahoo(dates, { realOhlc: false });
      }
      return eastmoney(dates);
    });
    assert.deepEqual(calls, ["query1.finance.yahoo.com", "push2his.eastmoney.com"]);
    assert.deepEqual(histories[symbol].at(-1), { date: dates.at(-1), time: "", open: 11, high: 13, low: 10, close: 12 });
  }
});

test("a stale full source does not shadow a current source or a recent short listing", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const old = sessions(85, "2026-10-15");
  for (const length of [85, 12, 0]) {
    const recent = sessions(length);
    const { histories } = await query("sh600001", input => {
      const url = new URL(input);
      if (url.hostname.includes("eastmoney")) return eastmoney(old);
      if (url.hostname.includes("yahoo")) return yahoo(recent);
      return Response.json({});
    });
    const expected = length ? recent : old;
    assert.deepEqual(histories.sh600001.map(bar => bar.date), expected);
  }
});

test("no invented ranges, duplicates, future bars or joins across malformed bars in the strict mode", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const dates = sessions(85);
  const prices = "11,12,13,10";
  const { histories } = await query("sh600001", input => {
    if (!new URL(input).hostname.includes("eastmoney")) return Response.json({});
    const klines = dates.map((date, index) => date + "," + (index === 81 ? "11,12,8,20" : prices));
    klines.push(klines.at(-1), "2026-11-16," + prices);
    return Response.json({ data: { klines } });
  });
  assert.deepEqual(histories.sh600001.map(bar => bar.date), dates.slice(82));
  const closeOnly = input => new URL(input).hostname.includes("yahoo") ? yahoo(dates, { realOhlc: false }) : Response.json({});
  assert.deepEqual((await query("gb_example", closeOnly)).histories, {});
  assert.equal((await query("gb_example", closeOnly, false)).histories.gb_example.length, 85);
});

test("a stalled first provider is aborted and a second provider supplies completed sessions", async t => {
  // 10:30 New York, so the last finalized session was the previous weekday.
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-11-13T15:30:00Z") });
  let aborted = false;
  const result = query("gb_example", (input, { signal }) => {
    if (new URL(input).hostname.includes("yahoo")) {
      return new Promise((_, reject) => signal.addEventListener("abort", () => {
        aborted = true;
        reject(Error("aborted"));
      }));
    }
    return eastmoney(sessions(85));
  });
  t.mock.timers.tick(4000);
  const { histories } = await result;
  assert.equal(aborted, true);
  assert.equal(histories.gb_example.at(-1).date, "2026-11-12");
});
