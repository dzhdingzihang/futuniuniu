import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHoldingsDocument, sanitizeHoldings } from "../functions/lib/github-holdings.js";

const document = JSON.parse(await readFile(new URL("../holdings.json", import.meta.url), "utf8"));
const keyFor = (row) => `${row.market}:${row.code}`;
const cents = (amount) => Math.round(Number(amount) * 100);

test("the ledger's editable policy is finite and independent of each lot's historical locks", () => {
  assert.equal(document.version, 2);
  for (const key of ["buyCny", "sellCny"]) {
    assert.equal(typeof document.costPolicy[key], "number");
    assert.ok(Number.isFinite(document.costPolicy[key]) && document.costPolicy[key] >= 0);
  }
  assert.deepEqual(document.newTradeFeeUsd, { buy: 20, sell: 20 });
  for (const lot of document.lots) {
    assert.ok(!Object.hasOwn(lot.buy, "adjustmentCny"));
    if (lot.sell) assert.ok(!Object.hasOwn(lot.sell, "adjustmentCny"));
  }
});

// These are immutable facts about the import. New trades and policy edits can
// change current portfolio counts and P&L without modifying this source snapshot.
test("the 2026-11-08 Excel reconciliation records source values and includes partially sold stocks", {
  skip: document.source?.file !== "20261108股票记录.xlsx",
}, () => {
  assert.equal(document.source.type, "excel");
  assert.equal(document.source.asOf, "2026-11-08");
  assert.equal(document.source.valuationAsOf, "2026-11-06");
  assert.deepEqual(document.source.reconciliation, {
    securityCount: 80, openSecurityCount: 31, closedSecurityCount: 49,
    soldSecurityCount: 63, sourcePnlCny: -261399.85,
  });
  const sale = document.lots.find((lot) => lot.id === "excel-a-600869-sold");
  assert.equal(sale.sell.date, "2026-05-29");
  assert.equal(sale.sell.qty, 100);
  assert.equal(sale.sell.price, 24.1);
  assert.equal(sale.sell.sellProceedsCny, 2410);
  assert.equal(sale.buy.purchaseCostCny, 2218.49);
  assert.match(sale.note, /反推/);
});

test("changing only the two root values recalculates every eligible stock and round trips without drift", () => {
  const raw = sanitizeHoldings({ ...document, costPolicy: { buyCny: 0, sellCny: 0 } });
  const policyDocument = { ...document, costPolicy: { buyCny: 2000, sellCny: 1000 } };
  const adjusted = sanitizeHoldings(policyDocument);
  const buckets = new Map();
  for (const row of adjusted) {
    const key = keyFor(row);
    const entry = buckets.get(key) ?? { buy: 0, sell: 0, hasSale: false };
    entry.buy += cents(row.adjustmentCny ?? 0);
    entry.sell += cents(row.sellAdjustmentCny ?? 0);
    entry.hasSale ||= row.status === "sold";
    buckets.set(key, entry);
  }
  for (const [key, entry] of buckets) {
    assert.equal(entry.buy, 200000, key);
    assert.equal(entry.sell, entry.hasSale ? 100000 : 0, key);
  }
  const acquire = (rows) => rows.reduce((total, row) => total + Number(row.purchaseCostCny ?? 0), 0);
  const dispose = (rows) => rows.reduce((total, row) => total + Number(row.sellProceedsCny ?? 0), 0);
  const soldKeys = [...buckets.values()].filter((entry) => entry.hasSale);
  // Raw amount checks only apply where the original document supplies locked
  // CNY amounts. Manually appended minimal lots derive those amounts from FX.
  if (document.lots.every((lot) => lot.buy.purchaseCostCny !== undefined)) {
    assert.equal(cents(acquire(adjusted) - acquire(raw)), buckets.size * 200000);
  }
  if (document.lots.every((lot) => !lot.sell || lot.sell.sellProceedsCny !== undefined)) {
    assert.equal(cents(dispose(raw) - dispose(adjusted)), soldKeys.length * 100000);
  }
  const canonical = createHoldingsDocument(policyDocument);
  assert.deepEqual(canonical.source, document.source);
  assert.deepEqual(canonical.costPolicy, policyDocument.costPolicy);
  const roundTrip = sanitizeHoldings(canonical);
  assert.equal(cents(acquire(roundTrip)), cents(acquire(adjusted)));
  assert.equal(cents(dispose(roundTrip)), cents(dispose(adjusted)));
  assert.deepEqual(createHoldingsDocument(canonical), canonical);
});
