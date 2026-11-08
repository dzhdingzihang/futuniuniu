import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { onRequestGet } from "../functions/api/history.js";

test("a newly listed security uses fresh daily closes starting at its actual inception", async () => {
  const day = 86400;
  const today = Math.floor(Date.now() / 1000);
  const timestamps = [today - 15 * day, today - day];
  const calls = [];
  const response = await onRequestGet({
    request: new Request("https://example.test/api/history?symbols=gb_new&window=1095"),
    fetcher: async (input, { signal }) => {
      calls.push(new URL(input).host);
      assert.ok(signal instanceof AbortSignal);
      return Response.json({ chart: { result: [{ meta: { firstTradeDate: timestamps[0] }, timestamp: timestamps,
        indicators: { quote: [{ close: [10, 12] }] } }] } });
    },
  });
  assert.deepEqual(calls, ["query1.finance.yahoo.com"]);
  assert.equal((await response.json()).histories.gb_new.at(-1).close, 12);
});

test("stale long history cannot shadow a fresh alternative and a missing series does not hide its batch mates", async () => {
  const day = 86400000;
  const date = n => new Date(Date.now() - n * day).toISOString().slice(0, 10);
  const response = await onRequestGet({
    request: new Request("https://example.test/api/history?symbols=gb_mature,gb_missing&window=365"),
    fetcher: async input => {
      const url = new URL(input);
      if (/missing/i.test(url.toString())) return Response.json({});
      if (url.host.includes("yahoo")) {
        return Response.json({ chart: { result: [{
          timestamp: [367, 365, 33].map(n => Math.floor((Date.now() - n * day) / 1000)),
          indicators: { quote: [{ close: [8, 9, 10] }] },
        }] } });
      }
      return Response.json({ data: { klines: [365, 1].map(n => date(n) + ",21,22,23,19") } });
    },
  });
  const { histories } = await response.json();
  assert.deepEqual(Object.keys(histories), ["gb_mature"]);
  assert.equal(histories.gb_mature.at(-1).date, date(1));
});

test("annual and three-year requests return daily closes beyond the short-history cap", async () => {
  for (const [days, range] of [[365, "2y"], [1095, "5y"]]) {
    const count = Math.ceil(days * 5 / 7) + 12;
    const response = await onRequestGet({
      request: new Request("https://example.test/api/history?symbols=gb_abc&window=" + days),
      fetcher: async url => {
        assert.equal(new URL(url).searchParams.get("range"), range);
        const timestamps = Array.from({ length: count }, (_, index) => Math.floor(Date.now() / 1000) - (count - index) * 2 * 86400);
        return Response.json({ chart: { result: [{ timestamp: timestamps, indicators: { quote: [{ close: timestamps.map(() => 10) }] } }] } });
      }
    });
    const { histories } = await response.json();
    assert.equal(histories.gb_abc.length, count);
    assert.deepEqual(Object.keys(histories.gb_abc[0]), ["date", "close"]);
  }
});

test("long timeline clips calendar dates and starts only when all positions have a real close", async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const context = vm.createContext({ location: { hash: "" }, localStorage: { getItem: () => null } });
  vm.runInContext(source.slice(0, source.lastIndexOf("\nstart().catch")), context);
  const value = vm.runInContext(`(() => {
    calendarDateInTimeZone = () => "2026-11-08";
    state.rows = state.holdings = [{ status:"holding", sina:"sz000001", qty:2, currency:"CNY" },
                                   { status:"holding", sina:"gb_test", qty:1, currency:"USD" }];
    state.rates = {CNY:1, USD:7};
    const histories = {
      sz000001:[{date:"2023-11-08",close:100},{date:"2024-01-02",close:110},{date:"2024-01-05",close:120},{date:"2026-11-06",close:130}],
      gb_test:[{date:"2024-01-04",close:10},{date:"2026-11-06",close:12}]
    };
    return [365,1095].map(days => {
      longChartCache.set(longChartKey(days).key, {histories});
      return longPortfolioValues(days, state.rows, 344);
    });
  })()`, context);
  const now = { date: "当前", value: 344 };
  const recent = { date:"2026-11-06", value:344 };
  assert.deepEqual(JSON.parse(JSON.stringify(value)), [
    [recent, now],
    [{ date:"2024-01-04",value:290 }, { date:"2024-01-05",value:310 }, recent, now]
  ]);
});
