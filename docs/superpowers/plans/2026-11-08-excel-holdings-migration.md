# Excel Holdings Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the website portfolio data with the 2026-11-08 Excel workbook as the source of truth, add one CNY 1,000 purchase-cost adjustment per unique security, and make future `holdings.json` updates simpler and auditable.

**Architecture:** Keep the compatible v2 `lots` model so the existing form, FIFO sales, GitHub synchronization, and Cloudflare deployment continue to work. Import one aggregate open lot plus, where the workbook has realized history, one aggregate sold lot per security. Store the CNY 1,000 adjustment explicitly on exactly one lot per `market + code`; the locked `purchaseCostCny` already includes that adjustment, so calculations must never add it twice. Preserve compact user-entered fields separately from optional system audit fields.

**Tech Stack:** Static JavaScript, Cloudflare Pages Functions, Node.js built-in test runner, Python 3 with `openpyxl` for the repeatable workbook importer.

---

## Task 1: Lock the source contract and add regression tests

**Files:**
- Modify: `tests/holdings-operations.test.mjs`
- Modify: `tests/pages-functions.test.mjs`
- Create: `tests/holdings-data-contract.test.mjs`

- [ ] Add a failing server-side test proving `buy.adjustmentCny`, `note`, and workbook metadata survive parse/serialize and GitHub operations.
- [ ] Add a failing partial-sale test proving `purchaseCostCny` and `adjustmentCny` split proportionally without changing their totals.
- [ ] Add a browser-side test proving the adjustment is descriptive only and is not added a second time.
- [ ] Add a data-contract test requiring 80 unique securities, 31 current holdings, market counts A 12 / HK 7 / US 12, and exactly CNY 80,000 of stock-level adjustments.
- [ ] Run `node --test tests/holdings-operations.test.mjs tests/pages-functions.test.mjs tests/holdings-data-contract.test.mjs` and confirm the new tests initially expose unsupported fields or wrong counts.

## Task 2: Extend the compatible v2 schema without duplicating cost

**Files:**
- Modify: `functions/lib/github-holdings.js`
- Modify: `assets/app.js`

- [ ] Parse optional `buy.adjustmentCny` as a non-negative audit amount already included in `buy.purchaseCostCny`.
- [ ] Preserve optional lot `note` and `quality` fields and root workbook metadata during canonical serialization.
- [ ] Split `adjustmentCny` proportionally when a lot is partially sold, exactly as locked purchase cost is split.
- [ ] Keep the six-field manual entry path compatible: market, code, name, buy date, buy price, and quantity; currency, status, quote code, and default fee remain generated.
- [ ] Update holding cost labels to say that locked cost includes fees and any cost adjustment.
- [ ] Run `node --check assets/app.js` and the focused Node tests.

## Task 3: Build a repeatable Excel importer

**Files:**
- Create: `scripts/import_holdings_from_excel.py`
- Create: `scripts/requirements.txt`

- [ ] Read `全市场股票明细` as the 80-security index and normalize `A / HK / US` codes.
- [ ] Read `持仓估值` for the 12 A-share open positions and broker cost bases.
- [ ] Read `当前实盘持仓`, `人民币成本明细`, and `实盘逐笔成交` for the 19 HK/US open positions, realized cost/proceeds, quantities, and dates.
- [ ] Read `股票总表` for A-share closed records; where trade details are absent, derive only the locked CNY cost/proceeds from broker P&L and return rate, mark `quality: "trade-details-missing"`, and do not pretend the native price is known.
- [ ] Assign `adjustmentCny: 1000` to exactly one lot for every unique security and include it once in that lot's `purchaseCostCny`.
- [ ] Emit stable ordering, rounded monetary values, source timestamps, FX metadata, notes, and a concise v2 guide.
- [ ] Fail loudly on duplicate securities, count mismatches, negative quantities, adjustment duplication, or an unbalanced locked P&L.

## Task 4: Generate and verify the authoritative portfolio

**Files:**
- Modify: `holdings.json`

- [ ] Run `python3 scripts/import_holdings_from_excel.py "/Users/dingzihang/Documents/个人小项目/outputs/futu-01a1bb13-769b-7902-ac16-57c47c74c49b/20261108股票记录.xlsx" --output holdings.json --additional-cost-cny 1000`.
- [ ] Verify 80 unique securities, 31 current holdings, 49 fully closed securities, and CNY 80,000 of adjustments.
- [ ] Verify source cumulative P&L is approximately CNY -261,399.85 before adjustment and approximately CNY -341,399.85 after adjustment, with workbook caveats retained.
- [ ] Verify EYPT and the 2026-11-08 英杰电气 sale from the current online file are represented by the newer Excel source rather than silently lost.

## Task 5: Document the simpler write path

**Files:**
- Modify: `README.md`

- [ ] Document the minimal manual lot shape and explain that system audit fields are optional and auto-generated.
- [ ] Document the workbook import command, sheet precedence, the CNY 1,000 once-per-security rule, and missing-data behavior.
- [ ] Document that `adjustmentCny` is already included in `purchaseCostCny` and must not be summed again.
- [ ] Document verification totals and how future website form writes remain compatible.

## Task 6: Full verification and production handoff

**Files:**
- Verify only: all modified files

- [ ] Run `node --check assets/app.js`.
- [ ] Run `node --test tests/*.test.mjs`.
- [ ] Run `git diff --check`.
- [ ] Start the local site and verify login, overview totals, 31 current holdings, sold records, and a dry-run buy/sell operation without writing to GitHub.
- [ ] Stage only the intended files; never include `.playwright-cli/` or `output/`.
- [ ] Commit and push `main`, wait for Cloudflare Pages, then verify `https://alixjd.com/#overview` and `https://alixjd.com/#actions` against the new data contract.
