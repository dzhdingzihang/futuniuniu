import assert from "node:assert/strict";
import test from "node:test";

import {
  HoldingsSyncError,
  applyHoldingOperation,
  createHoldingsDocument,
  sanitizeHoldings,
  syncHoldingsToGitHub,
} from "../functions/lib/github-holdings.js";
import { onRequestGet, onRequestPost } from "../functions/api/holdings-sync.js";

const authEnv = {
  BASIC_AUTH_USER: "我的花名",
  BASIC_AUTH_PASSWORD: "test-password",
  PIGGY_GITHUB_TOKEN: "server-token",
  PIGGY_GITHUB_OWNER: "example",
  PIGGY_GITHUB_REPO: "piggy",
  PIGGY_GITHUB_BRANCH: "main",
};

function encoded(document) {
  return Buffer.from(JSON.stringify(document), "utf8").toString("base64");
}

function githubFile(document, sha = "sha-before") {
  return {
    sha,
    encoding: "base64",
    content: encoded(document),
    html_url: "https://github.example/holdings.json",
  };
}

function startingDocument() {
  return {
    version: 2,
    newTradeFeeUsd: { buy: 20, sell: 20 },
    lots: [
      {
        id: "lot-old",
        market: "US",
        code: "NVDA",
        name: "英伟达",
        buy: {
          price: 100,
          qty: 4,
          date: "2026-08-01",
          purchaseCostCny: 3020,
          feeCny: 140,
          fxAsOf: "2026-08-01",
          fxSource: "Frankfurter",
          operationId: "buy-old",
        },
        fees: { buy: 20 },
      },
    ],
  };
}

test("enriched v2 metadata survives sanitization and readable-document conversion", () => {
  const source = startingDocument();
  const rows = sanitizeHoldings(source);
  assert.deepEqual(rows[0], {
    market: "美股",
    code: "NVDA",
    name: "英伟达",
    status: "holding",
    cost: 100,
    qty: 4,
    currency: "USD",
    sina: "gb_nvda",
    lotId: "lot-old",
    buyDate: "2026-08-01",
    buyOperationId: "buy-old",
    buyFxAsOf: "2026-08-01",
    buyFxSource: "Frankfurter",
    purchaseCostCny: 3020,
    buyFeeCny: 140,
    buyFeeUsd: 20,
  });
  assert.deepEqual(createHoldingsDocument(rows).lots, source.lots);
});

test("workbook metadata, lot quality, and included cost adjustment survive document conversion", () => {
  const source = {
    version: 2,
    asOf: "2026-11-08",
    valuationAsOf: "2026-11-06",
    source: { type: "excel", file: "20261108股票记录.xlsx", sheet: "全市场股票明细" },
    fx: { USD: 6.67885, HKD: 0.8516, asOf: "2026-11-08 10:30" },
    lots: [{
      id: "excel-us-nvda-open",
      market: "US",
      code: "NVDA",
      name: "英伟达",
      note: "工作簿锁定成本",
      quality: "verified",
      buy: {
        price: 100,
        qty: 4,
        purchaseCostCny: 4020,
        adjustmentCny: 1000,
      },
      fees: { buy: 0 },
    }],
  };

  const rows = sanitizeHoldings(source);
  assert.equal(rows[0].purchaseCostCny, 4020);
  assert.equal(rows[0].adjustmentCny, 1000);
  assert.equal(rows[0].note, "工作簿锁定成本");
  assert.equal(rows[0].quality, "verified");

  const document = createHoldingsDocument(source);
  assert.deepEqual(document.source, source.source);
  assert.deepEqual(document.fx, source.fx);
  assert.equal(document.asOf, source.asOf);
  assert.equal(document.valuationAsOf, source.valuationAsOf);
  assert.equal(document.lots[0].buy.purchaseCostCny, 4020);
  assert.equal(document.lots[0].buy.adjustmentCny, 1000);
  assert.equal(document.lots[0].note, "工作簿锁定成本");
  assert.equal(document.lots[0].quality, "verified");
});

test("partial-sale conversion preserves locked CNY totals and operation metadata", () => {
  const source = {
    version: 2,
    lots: [{
      id: "partial-source",
      market: "HK",
      code: "00700",
      name: "腾讯控股",
      buy: {
        price: 500,
        qty: 10,
        date: "2026-08-01",
        purchaseCostCny: 4600,
        adjustmentCny: 1000,
        feeCny: 140,
        operationId: "buy-partial",
      },
      sell: {
        price: 600,
        qty: 4,
        date: "2026-08-20",
        sellProceedsCny: 2050,
        feeCny: 140,
        operationId: "sell-partial",
      },
      fees: { buy: 20, sell: 20 },
    }],
  };
  const document = createHoldingsDocument(sanitizeHoldings(source));
  const rows = sanitizeHoldings(document);
  assert.equal(rows.reduce((sum, row) => sum + row.purchaseCostCny, 0), 4600);
  assert.equal(rows.reduce((sum, row) => sum + row.adjustmentCny, 0), 1000);
  assert.equal(rows.filter((row) => row.status === "sold").reduce((sum, row) => sum + row.sellProceedsCny, 0), 2050);
  assert.equal(rows.reduce((sum, row) => sum + row.buyFeeUsd, 0), 20);
  assert.equal(rows.filter((row) => row.status === "sold").reduce((sum, row) => sum + row.sellFeeUsd, 0), 20);
  assert.equal(rows.some((row) => row.buyOperationId === "buy-partial"), true);
  assert.equal(rows.some((row) => row.sellOperationId === "sell-partial"), true);
});

test("partial sell operations preserve workbook metadata and split adjustment without duplication", () => {
  const source = {
    version: 2,
    asOf: "2026-11-08",
    valuationAsOf: "2026-11-06",
    source: { type: "excel", file: "20261108股票记录.xlsx" },
    fx: { USD: 6.67885, HKD: 0.8516 },
    lots: [{
      id: "excel-us-nvda-open",
      market: "US",
      code: "NVDA",
      name: "英伟达",
      note: "成本调整只计一次",
      quality: "verified",
      buy: {
        price: 100,
        qty: 4,
        date: "2026-08-01",
        purchaseCostCny: 4020,
        adjustmentCny: 1000,
      },
      fees: { buy: 0 },
    }],
  };

  const result = applyHoldingOperation(source, {
    type: "sell",
    operationId: "sell-adjusted-one",
    market: "US",
    code: "NVDA",
    price: 110,
    qty: 1,
    date: "2026-11-08",
    sellProceedsCny: 720,
    feeCny: 0,
  });

  assert.equal(result.asOf, source.asOf);
  assert.equal(result.valuationAsOf, source.valuationAsOf);
  assert.deepEqual(result.source, source.source);
  assert.deepEqual(result.fx, source.fx);
  assert.equal(result.lots.reduce((sum, lot) => sum + Number(lot.buy.adjustmentCny || 0), 0), 1000);
  assert.equal(result.lots.reduce((sum, lot) => sum + Number(lot.buy.purchaseCostCny || 0), 0), 4020);
  assert.deepEqual(result.lots.map((lot) => lot.note), ["成本调整只计一次", "成本调整只计一次"]);
  assert.deepEqual(result.lots.map((lot) => lot.quality), ["verified", "verified"]);
  assert.equal(result.lots.find((lot) => !lot.sell).buy.adjustmentCny, 750);
  assert.equal(result.lots.find((lot) => lot.sell).buy.adjustmentCny, 250);
});

test("buy operations append a new lot without replacing an existing position", () => {
  const result = applyHoldingOperation(startingDocument(), {
    type: "buy",
    operationId: "buy-new",
    market: "US",
    code: "NVDA",
    name: "英伟达",
    price: 120,
    qty: 2,
    date: "2026-08-30",
    purchaseCostCny: 1750,
    feeCny: 134.4,
    fxAsOf: "2026-08-29",
    fxSource: "Frankfurter",
  });

  assert.equal(result.lots.length, 2);
  assert.equal(result.lots[0].id, "lot-old");
  assert.deepEqual(result.lots[1], {
    id: "lot-buy-new",
    market: "US",
    code: "NVDA",
    name: "英伟达",
    buy: {
      price: 120,
      qty: 2,
      date: "2026-08-30",
      purchaseCostCny: 1750,
      feeCny: 134.4,
      fxAsOf: "2026-08-29",
      fxSource: "Frankfurter",
      operationId: "buy-new",
    },
    fees: { buy: 20 },
  });
});

test("operations accept legacy v1 row arrays without losing the old position", () => {
  const legacy = [{
    market: "A股",
    code: "601138",
    name: "工业富联",
    status: "holding",
    cost: 64,
    qty: 100,
    currency: "CNY",
    sina: "sh601138",
  }];
  const result = applyHoldingOperation(legacy, {
    type: "buy",
    operationId: "legacy-append",
    market: "A",
    code: "601138",
    name: "工业富联",
    price: 60,
    qty: 50,
    date: "2026-08-30",
  });
  assert.equal(result.lots.length, 2);
  assert.deepEqual(result.lots.map((lot) => lot.buy.qty), [100, 50]);
  assert.equal(result.lots[0].id.startsWith("legacy-a-601138-"), true);
});

test("security costs follow the first acquisition through FIFO splits and only the first sale event", () => {
  const source = startingDocument();
  source.costPolicy = { buyCny: 2000, sellCny: 1000 };
  const add = applyHoldingOperation(source, {
    type: "buy", operationId: "buy-next", market: "US", code: "NVDA",
    date: "2026-08-02", price: 110, qty: 2, purchaseCostCny: 1600,
  });
  const sell = {
    type: "sell", operationId: "sell-first", market: "US", code: "NVDA",
    date: "2026-08-04", price: 120, qty: 2, sellProceedsCny: 270,
  };
  const firstSale = applyHoldingOperation(add, sell);
  const firstRows = sanitizeHoldings(firstSale);
  assert.deepEqual(firstRows.map((row) => row.adjustmentCny), [1000, 1000, 0]);
  assert.equal(firstRows.find((row) => row.status === "sold").sellProceedsCny, -730);
  assert.deepEqual(applyHoldingOperation(firstSale, sell), firstSale);
  const final = applyHoldingOperation(firstSale, {
    ...sell, operationId: "sell-rest", date: "2026-08-05", qty: 4, sellProceedsCny: 2000,
  });
  const rows = sanitizeHoldings(final);
  assert.equal(rows.reduce((sum, row) => sum + row.adjustmentCny, 0), 2000);
  assert.equal(rows.reduce((sum, row) => sum + row.sellAdjustmentCny, 0), 1000);
  assert.equal(rows.reduce((sum, row) => sum + row.purchaseCostCny, 0), 6620);
  assert.equal(rows.reduce((sum, row) => sum + row.sellProceedsCny, 0), 1270);
  assert.equal(final.lots.reduce((sum, lot) => sum + lot.buy.purchaseCostCny, 0), 4620);
  assert.equal(final.lots.some((lot) => "adjustmentCny" in lot.buy), false);
  assert.deepEqual(sanitizeHoldings(createHoldingsDocument(final)), rows);

  final.costPolicy = { buyCny: 500, sellCny: 100 };
  const repriced = sanitizeHoldings(final);
  assert.equal(repriced.reduce((sum, row) => sum + row.purchaseCostCny, 0), 5120);
  assert.equal(repriced.reduce((sum, row) => sum + row.sellProceedsCny, 0), 2170);
});

test("compact lots acquire a separate policy per normalized market and ticker", () => {
  const doc = {
    version: 2, costPolicy: { buyCny: 2000, sellCny: 1000 }, lots: [
      { market: "HK", code: "700", buy: { qty: 2, price: 5 },
        sell: { qty: 1, price: 4, date: "2026-08-05" }, fees: { buy: 0, sell: 0 } },
      { market: "HK", code: "00700", buy: { qty: 1, price: 4 }, fees: { buy: 0 } },
      { market: "US", code: "00700", buy: { qty: 2, price: 3 }, fees: { buy: 0 } },
    ],
  };
  const rows = sanitizeHoldings(doc);
  assert.deepEqual(rows.map((row) => row.adjustmentCny), [1000, 1000, 0, 2000]);
  assert.equal(rows[1].sellProceedsCny, 4 * 0.92 - 1000);
  assert.equal(rows[3].purchaseCostCny, 6 * 7.22 + 2000);
  assert.deepEqual(sanitizeHoldings(createHoldingsDocument(doc)), rows);
  assert.throws(() => sanitizeHoldings({ ...doc, costPolicy: { buyCny: -1, sellCny: 1000 } }), /成本规则/);
});

test("remote sync keeps raw base amounts, workbook metadata and the cost policy across a GitHub write", async () => {
  const source = startingDocument();
  source.costPolicy = { buyCny: 2000, sellCny: 1000 };
  source.source = { file: "verified.xlsx" };
  let remote = source;
  const fetcher = async (_url, options) => {
    if (options.method === "PUT") {
      remote = JSON.parse(Buffer.from(JSON.parse(options.body).content, "base64").toString());
      return Response.json({ commit: { sha: "new" }, content: { sha: "new-file" } });
    }
    return Response.json(githubFile(remote));
  };
  const response = await onRequestPost({
    env: authEnv, fetcher,
    request: new Request("https://example.test/api/holdings-sync", {
      method: "POST", body: JSON.stringify({ expectedFileSha: "sha-before", operation: {
        type: "sell", operationId: "sell-real", market: "US", code: "NVDA",
        price: 120, qty: 4, date: "2026-08-08", sellProceedsCny: 3100,
      } }),
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(remote.source, source.source);
  assert.deepEqual(remote.costPolicy, source.costPolicy);
  assert.equal(remote.lots[0].buy.purchaseCostCny, 3020);
  assert.equal(remote.lots[0].sell.sellProceedsCny, 3100);
  assert.equal(result.holdings[0].purchaseCostCny, 5020);
  assert.equal(result.holdings[0].sellProceedsCny, 2100);
});

test("changing cost settings migrates old baked-in amounts once; retries with a stale SHA do not create another commit", async () => {
  let remote = startingDocument();
  remote.lots[0].buy.purchaseCostCny += 1000;
  remote.lots[0].buy.adjustmentCny = 1000;
  let sha = "original";
  let writes = 0;
  const fetcher = async (_url, options) => {
    if (options.method === "PUT") {
      writes++;
      remote = JSON.parse(Buffer.from(JSON.parse(options.body).content, "base64").toString());
      sha = "written-" + writes;
      return Response.json({ commit: { sha: "commit-" + writes }, content: { sha } });
    }
    return Response.json(githubFile(remote, sha));
  };
  const operation = { type: "cost-policy", operationId: "policy-first", buyCny: 2000, sellCny: 1000 };
  const post = (op, expected) => onRequestPost({ env: authEnv, fetcher,
    request: new Request("https://example.test/api/holdings-sync", {
      method: "POST", body: JSON.stringify({operation: op, expectedFileSha: expected}),
    }),
  });
  const first = await (await post(operation, "original")).json();
  assert.equal(first.holdings[0].purchaseCostCny, 5020);
  assert.equal(remote.lots[0].buy.purchaseCostCny, 3020);
  assert.equal(remote.costPolicy.lastOperationId, "policy-first");
  const replay = await (await post(operation, "original")).json();
  assert.equal(replay.alreadyCurrent, true);
  assert.equal(writes, 1);
  assert.equal((await post({ ...operation, operationId: "different" }, "original")).status, 409);
  assert.equal((await post({ ...operation, operationId: "bad-policy", buyCny: -10 }, sha)).status, 400);
  const changed = await (await post({ ...operation, operationId: "zero", buyCny: 0, sellCny: 0 }, sha)).json();
  assert.equal(changed.holdings[0].purchaseCostCny, 3020);
});

test("legacy full-document writes cannot overwrite a policy file", async () => {
  const current = startingDocument();
  current.costPolicy = { buyCny: 2000, sellCny: 1000 };
  const fetcher = async (_url, options) => {
    assert.notEqual(options.method, "PUT");
    return Response.json(githubFile(current));
  };
  await assert.rejects(syncHoldingsToGitHub([], { token: "test" }, fetcher),
    (error) => error instanceof HoldingsSyncError && error.status === 409);
});

test("sell operations consume open lots FIFO and charge one 20 USD sell fee", () => {
  const source = startingDocument();
  source.lots.push({
    id: "lot-newer",
    market: "US",
    code: "NVDA",
    name: "英伟达",
    buy: {
      price: 150,
      qty: 5,
      date: "2026-08-20",
      purchaseCostCny: 5200,
      feeCny: 140,
      operationId: "buy-newer",
    },
    fees: { buy: 20 },
  });

  const result = applyHoldingOperation(source, {
    type: "sell",
    operationId: "sell-six",
    market: "US",
    code: "NVDA",
    price: 180,
    qty: 6,
    date: "2026-08-30",
    sellProceedsCny: 7120,
    feeCny: 134.4,
    fxAsOf: "2026-08-29",
    fxSource: "Frankfurter",
  });

  const sold = result.lots.filter((lot) => lot.sell?.operationId === "sell-six");
  const holding = result.lots.filter((lot) => !lot.sell);
  assert.deepEqual(sold.map((lot) => [lot.parentLotId, lot.sell.qty]), [
    ["lot-old", 4],
    ["lot-newer", 2],
  ]);
  assert.equal(holding.length, 1);
  assert.equal(holding[0].id, "lot-newer");
  assert.equal(holding[0].buy.qty, 3);
  assert.equal(holding[0].buy.purchaseCostCny, 3120);
  assert.equal(holding[0].fees.buy, 12);
  assert.equal(sold.reduce((sum, lot) => sum + lot.fees.sell, 0), 20);
  assert.equal(sold.reduce((sum, lot) => sum + lot.sell.sellProceedsCny, 0), 7120);
  assert.equal(sold.reduce((sum, lot) => sum + lot.sell.feeCny, 0), 134.4);
  assert.equal(sold[0].buy.date, "2026-08-01");
  assert.equal(sold[1].buy.date, "2026-08-20");
});

test("small sales preserve negative net proceeds when the fixed fee exceeds gross value", () => {
  const result = applyHoldingOperation(startingDocument(), {
    type: "sell",
    operationId: "sell-small-net-negative",
    market: "US",
    code: "NVDA",
    price: 1,
    qty: 1,
    date: "2026-08-30",
    sellProceedsCny: -137.18,
    feeCny: 144.4,
  });

  const soldLot = result.lots.find((lot) => lot.sell?.operationId === "sell-small-net-negative");
  assert.equal(soldLot.sell.sellProceedsCny, -137.18);
  const soldRow = sanitizeHoldings(result).find((row) => row.sellOperationId === "sell-small-net-negative");
  assert.equal(soldRow.sellProceedsCny, -137.18);
});

test("legacy custom fees stay on old cost lots while every new sale costs exactly 20 USD", () => {
  const source = {
    version: 2,
    newTradeFeeUsd: { buy: 11, sell: 13 },
    lots: [{ market: "US", code: "AAA", name: "AAA", buy: { price: 10, qty: 10, date: "2026-08-01" } }],
  };
  const result = applyHoldingOperation(source, {
    type: "sell",
    operationId: "sell-fixed-fee",
    market: "US",
    code: "AAA",
    price: 12,
    qty: 4,
    date: "2026-08-30",
  });
  const rows = sanitizeHoldings(result);
  assert.equal(rows.reduce((sum, row) => sum + row.buyFeeUsd, 0), 11);
  assert.equal(rows.reduce((sum, row) => sum + (row.sellFeeUsd || 0), 0), 20);
  assert.deepEqual(result.newTradeFeeUsd, { buy: 20, sell: 20 });
});

test("operationId makes buy and sell operations idempotent", () => {
  const buyOperation = {
    type: "buy",
    operationId: "buy-once",
    market: "A",
    code: "601138",
    name: "工业富联",
    price: 64,
    qty: 100,
    date: "2026-08-30",
  };
  const once = applyHoldingOperation(startingDocument(), buyOperation);
  const twice = applyHoldingOperation(once, buyOperation);
  assert.deepEqual(twice, once);

  const sellOperation = {
    type: "sell",
    operationId: "sell-once",
    market: "US",
    code: "NVDA",
    price: 110,
    qty: 1,
    date: "2026-08-30",
  };
  const soldOnce = applyHoldingOperation(once, sellOperation);
  const soldTwice = applyHoldingOperation(soldOnce, sellOperation);
  assert.deepEqual(soldTwice, soldOnce);
});

test("sell operations reject quantities larger than the open FIFO position", () => {
  assert.throws(
    () => applyHoldingOperation(startingDocument(), {
      type: "sell",
      operationId: "sell-too-many",
      market: "US",
      code: "NVDA",
      price: 110,
      qty: 5,
      date: "2026-08-30",
    }),
    (error) => error instanceof HoldingsSyncError && error.status === 400 && /可卖数量/.test(error.message),
  );
});

test("operation POST rejects stale expectedFileSha without issuing a PUT", async () => {
  const calls = [];
  const response = await onRequestPost({
    request: new Request("https://example.test/api/holdings-sync", {
      method: "POST",
      body: JSON.stringify({
        expectedFileSha: "stale-sha",
        operation: {
          type: "buy",
          operationId: "buy-conflict",
          market: "US",
          code: "AMD",
          name: "AMD",
          price: 100,
          qty: 1,
          date: "2026-08-30",
        },
      }),
    }),
    env: authEnv,
    fetcher: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET" });
      return Response.json(githubFile(startingDocument(), "fresh-sha"));
    },
  });

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.code, "HOLDINGS_SHA_CONFLICT");
  assert.equal(payload.fileSha, "fresh-sha");
  assert.deepEqual(payload.document.lots, startingDocument().lots);
  assert.equal(calls.filter((call) => call.method === "PUT").length, 0);
});

test("a retry with an old SHA succeeds without PUT when operationId is already present", async () => {
  const operation = {
    type: "buy",
    operationId: "buy-retried",
    market: "US",
    code: "AMD",
    name: "AMD",
    price: 100,
    qty: 1,
    date: "2026-08-30",
  };
  const savedDocument = applyHoldingOperation(startingDocument(), operation);
  const calls = [];
  const response = await onRequestPost({
    request: new Request("https://example.test/api/holdings-sync", {
      method: "POST",
      body: JSON.stringify({ expectedFileSha: "sha-before", operation }),
    }),
    env: authEnv,
    fetcher: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET" });
      return Response.json(githubFile(savedDocument, "sha-after"));
    },
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.alreadyCurrent, true);
  assert.equal(payload.fileSha, "sha-after");
  assert.equal(payload.document.lots.filter((lot) => lot.buy.operationId === "buy-retried").length, 1);
  assert.equal(calls.filter((call) => call.method === "PUT").length, 0);
});

test("operation POST returns the authoritative saved document, rows, and file SHA", async () => {
  const calls = [];
  const response = await onRequestPost({
    request: new Request("https://example.test/api/holdings-sync", {
      method: "POST",
      body: JSON.stringify({
        expectedFileSha: "sha-before",
        operation: {
          type: "buy",
          operationId: "buy-api",
          market: "HK",
          code: "00700",
          name: "腾讯控股",
          price: 600,
          qty: 10,
          date: "2026-08-30",
          purchaseCostCny: 5280,
          feeCny: 134.4,
          fxAsOf: "2026-08-29",
          fxSource: "Frankfurter",
        },
      }),
    }),
    env: authEnv,
    fetcher: async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "PUT") {
        return Response.json({
          commit: { sha: "commit-after" },
          content: { sha: "sha-after", html_url: "https://github.example/holdings.json" },
        });
      }
      return Response.json(githubFile(startingDocument()));
    },
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.fileSha, "sha-after");
  assert.equal(payload.document.lots.at(-1).buy.operationId, "buy-api");
  assert.equal(payload.holdings.at(-1).code, "00700");
  const put = calls.find((call) => call.options.method === "PUT");
  assert.equal(JSON.parse(put.options.body).sha, "sha-before");
});

test("a GitHub PUT race reloads the latest document before returning 409", async () => {
  const operation = {
    type: "buy",
    operationId: "buy-raced",
    market: "US",
    code: "AMD",
    name: "AMD",
    price: 100,
    qty: 1,
    date: "2026-08-30",
  };
  let getCount = 0;
  let putCount = 0;
  const response = await onRequestPost({
    request: new Request("https://example.test/api/holdings-sync", {
      method: "POST",
      body: JSON.stringify({ expectedFileSha: "sha-before", operation }),
    }),
    env: authEnv,
    fetcher: async (url, options = {}) => {
      if (options.method === "PUT") {
        putCount += 1;
        return Response.json({ message: "sha does not match" }, { status: 409 });
      }
      getCount += 1;
      return Response.json(githubFile(startingDocument(), getCount === 1 ? "sha-before" : "sha-winner"));
    },
  });

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.code, "HOLDINGS_SHA_CONFLICT");
  assert.equal(payload.fileSha, "sha-winner");
  assert.deepEqual(payload.document.lots, startingDocument().lots);
  assert.equal(getCount, 2);
  assert.equal(putCount, 1);
});

test("a GitHub PUT race is an idempotent success when the winning file contains operationId", async () => {
  const operation = {
    type: "buy",
    operationId: "buy-raced-saved",
    market: "US",
    code: "AMD",
    name: "AMD",
    price: 100,
    qty: 1,
    date: "2026-08-30",
  };
  const winningDocument = applyHoldingOperation(startingDocument(), operation);
  let getCount = 0;
  const response = await onRequestPost({
    request: new Request("https://example.test/api/holdings-sync", {
      method: "POST",
      body: JSON.stringify({ expectedFileSha: "sha-before", operation }),
    }),
    env: authEnv,
    fetcher: async (url, options = {}) => {
      if (options.method === "PUT") return Response.json({ message: "sha does not match" }, { status: 409 });
      getCount += 1;
      return Response.json(githubFile(getCount === 1 ? startingDocument() : winningDocument, getCount === 1 ? "sha-before" : "sha-saved"));
    },
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.alreadyCurrent, true);
  assert.equal(payload.fileSha, "sha-saved");
  assert.equal(payload.document.lots.filter((lot) => lot.buy.operationId === "buy-raced-saved").length, 1);
  assert.equal(getCount, 2);
});

test("GET reports whether the configured GitHub repository is private", async () => {
  const calls = [];
  const response = await onRequestGet({
    env: authEnv,
    fetcher: async (url) => {
      calls.push(url);
      if (/\/contents\/holdings\.json/.test(url)) return Response.json(githubFile(startingDocument()));
      return Response.json({ private: true, visibility: "private", html_url: "https://github.example/piggy" });
    },
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.repository, {
    private: true,
    visibility: "private",
    url: "https://github.example/piggy",
  });
  assert.equal(calls.some((url) => /\/repos\/example\/piggy$/.test(url)), true);
});
