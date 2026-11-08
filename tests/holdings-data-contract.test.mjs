import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createHoldingsDocument, sanitizeHoldings } from "../functions/lib/github-holdings.js";

const document = JSON.parse(await readFile(new URL("../holdings.json", import.meta.url), "utf8"));
const keyFor = (lot) => `${lot.market}:${lot.code}`;

test("Excel portfolio import matches the audited 2026-11-08 contract", () => {
  assert.equal(document.version, 2);
  assert.equal(document.source.type, "excel");
  assert.equal(document.source.file, "20261108股票记录.xlsx");
  assert.equal(document.source.asOf, "2026-11-08");
  assert.equal(document.source.valuationAsOf, "2026-11-06");
  assert.deepEqual(document.newTradeFeeUsd, { buy: 20, sell: 20 });

  assert.equal(document.lots.length, 93);
  assert.equal(new Set(document.lots.map((lot) => lot.id)).size, 93);
  const allKeys = new Set(document.lots.map(keyFor));
  assert.equal(allKeys.size, 80);

  const openLots = document.lots.filter((lot) => !lot.sell);
  assert.equal(openLots.length, 31);
  assert.deepEqual(
    Object.fromEntries(["A", "HK", "US"].map((market) => [market, openLots.filter((lot) => lot.market === market).length])),
    { A: 12, HK: 7, US: 12 },
  );
  const openKeys = new Set(openLots.map(keyFor));
  assert.equal([...allKeys].filter((key) => !openKeys.has(key)).length, 49);

  const adjustmentBySecurity = new Map();
  for (const lot of document.lots) {
    const adjustment = Number(lot.buy.adjustmentCny || 0);
    adjustmentBySecurity.set(keyFor(lot), (adjustmentBySecurity.get(keyFor(lot)) || 0) + adjustment);
    assert.ok(Number(lot.buy.purchaseCostCny) >= adjustment);
    assert.equal(lot.fees.buy, 0);
    if (lot.sell) assert.equal(lot.fees.sell, 0);
  }
  assert.equal(adjustmentBySecurity.size, 80);
  assert.ok([...adjustmentBySecurity.values()].every((amount) => amount === 1000));
  assert.equal([...adjustmentBySecurity.values()].reduce((sum, amount) => sum + amount, 0), 80000);

  assert.deepEqual(document.source.reconciliation, {
    securityCount: 80,
    openSecurityCount: 31,
    closedSecurityCount: 49,
    sourcePnlCny: -261399.85,
    adjustmentTotalCny: 80000,
    adjustedPnlCny: -341399.85,
  });
  assert.equal(document.lots.filter((lot) => lot.quality === "trade-details-missing").length, 6);
});

test("important online positions are represented by the newer Excel authority", () => {
  const eypT = document.lots.find((lot) => lot.market === "US" && lot.code === "EYPT" && !lot.sell);
  assert.ok(eypT);
  assert.equal(eypT.buy.qty, 190);
  assert.equal(eypT.buy.adjustmentCny, 1000);

  const intelLeveraged = document.lots.find((lot) => lot.market === "US" && lot.code === "INTW" && !lot.sell);
  const googleLeveraged = document.lots.find((lot) => lot.market === "US" && lot.code === "GOOX" && !lot.sell);
  assert.equal(intelLeveraged.buy.qty, 100);
  assert.equal(googleLeveraged.buy.qty, 50);

  const yingjie = document.lots.find((lot) => lot.market === "A" && lot.code === "300820");
  assert.ok(yingjie.sell);
  assert.equal(document.lots.some((lot) => lot.market === "A" && lot.code === "300820" && !lot.sell), false);
});

test("the GitHub writer can round-trip the imported document without losing provenance or adjustments", () => {
  const rows = sanitizeHoldings(document);
  const canonical = createHoldingsDocument(document);
  const canonicalRows = sanitizeHoldings(canonical);

  assert.equal(rows.length, 93);
  assert.equal(canonicalRows.length, rows.length);
  assert.deepEqual(canonical.source, document.source);
  assert.equal(
    canonicalRows.reduce((sum, row) => sum + (Number(row.adjustmentCny) || 0), 0),
    80000,
  );
  assert.equal(
    canonicalRows.reduce((sum, row) => sum + Number(row.purchaseCostCny), 0),
    rows.reduce((sum, row) => sum + Number(row.purchaseCostCny), 0),
  );
});
