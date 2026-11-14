import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { applyHoldingOperation } from "../functions/lib/github-holdings.js";

const asset = name => readFile(new URL("../assets/" + name, import.meta.url), "utf8");
const [app, policy] = await Promise.all([asset("app.js"), asset("holding-cost-policy.js")]);

function evaluate(document, hasQuotes = true) {
  const context = vm.createContext({ ledger: document, hasQuotes, location: { hash: "" }, localStorage: { getItem: () => null } });
  vm.runInContext(policy, context);
  vm.runInContext(app.slice(0, app.lastIndexOf("\nstart().catch")), context);
  const result = vm.runInContext(`(() => {
    state.holdingsDocument = ledger;
    state.rows = holdingsFromDocument(ledger).map(row => ({
      ...row, valueCny: hasQuotes ? (row.status === "sold" ? 0 : row.qty * 100) : NaN,
      saleProceedsCny: row.sellProceedsCny || 0
    }));
    const data = summary();
    return { primary: data.totalPnl, comparison: orderFeeComparison(data) };
  })()`, context);
  return JSON.parse(JSON.stringify(result));
}

test("the comparison is independent of policy edits and counts FIFO fragments as one order", () => {
  const start = { version: 2, costPolicy: { buyCny: 2000, sellCny: 1000 },
    source: { asOf: "2026-11-14", reconciliation: { sourcePnlCny: 10 },
      orderFeeScenario: { feeUsdPerOrder: 2, buyOrderCount: 1, sellOrderCount: 0, recordedOrderFeesCny: 30, scenarioOrderFeesCny: 14 } },
    lots: [{ id: "excel-us-t-open", market: "US", code: "T", name: "T",
      buy: { price: 100, qty: 1, date: "2026-11-01", purchaseCostCny: 90 }, fees: { buy: 0 } }] };
  const buy = applyHoldingOperation(start, { type: "buy", operationId: "new-buy", market: "US", code: "T",
    date: "2026-11-15", qty: 2, price: 10, purchaseCostCny: 280, feeCny: 140 });
  const sold = applyHoldingOperation(buy, { type: "sell", operationId: "new-sell", market: "US", code: "T",
    date: "2026-11-16", qty: 2, price: 30, sellProceedsCny: 280, feeCny: 140 });
  const before = JSON.stringify(sold);
  const normal = evaluate(sold);
  const noPolicy = evaluate({ ...sold, costPolicy: { buyCny: 0, sellCny: 0 } });
  assert.equal(noPolicy.primary - normal.primary, 3000);
  assert.deepEqual(normal.comparison, { pnl: noPolicy.primary + 16 + 2 * (140 - 14), count: 3, asOf: "" });
  assert.deepEqual(noPolicy.comparison, normal.comparison);
  assert.deepEqual(evaluate(sold, false).comparison, { pnl: 26, count: 1, asOf: "2026-11-14" });
  assert.equal(evaluate({ ...sold, source: {} }).comparison, null);
  assert.equal(JSON.stringify(sold), before);
});
