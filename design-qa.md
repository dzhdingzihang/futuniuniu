# Design QA — 持仓明细与行内两周展望

## Evidence

- Source visual truth: `/Users/dingzihang/Documents/个人小项目/futuniuniu/docs/design/holdings-visual-options/holdings-option-1-expanded-reference.png`
- Desktop implementation: `/Users/dingzihang/Documents/个人小项目/futuniuniu/docs/design/holdings-detail-desktop-final.png`
- Desktop side-by-side comparison: `/Users/dingzihang/Documents/个人小项目/futuniuniu/docs/design/holdings-detail-comparison-final.jpg`
- Mobile 390 top: `/Users/dingzihang/Documents/个人小项目/futuniuniu/docs/design/holdings-detail-mobile-390-final.png`
- Mobile 390 expanded detail: `/Users/dingzihang/Documents/个人小项目/futuniuniu/docs/design/holdings-detail-mobile-390-expanded-final.png`
- Mobile 320 filters and cards: `/Users/dingzihang/Documents/个人小项目/futuniuniu/docs/design/holdings-detail-mobile-320-final.png`

The source and desktop implementation are both 1487 × 1058 pixels. The browser viewport was 1487 × 1058 CSS pixels at DPR 1, so the side-by-side comparison required no scaling. Mobile checks used 390 × 844 and 320 × 844 CSS pixels at DPR 1.

State: `#actions`, real portfolio data, overall market, all profit states, holding-weight descending. The desktop evidence expands 东山精密; the mobile evidence expands 2倍做多海力士. Missing same-day quotes are intentionally rendered as `--` rather than copied from a stale cache.

## Findings

No actionable P0, P1, or P2 visual, interaction, data-integrity, or accessibility differences remain.

- Information hierarchy matches the chosen layout: portfolio snapshot, market allocation and concentration, compact filter/sort controls, holdings table/cards, then one in-context two-week analysis.
- Desktop at 1487 px has zero horizontal overflow, zero clipped table cells, one visible expanded analysis, no duplicate IDs, and no raw `NaN` or `undefined` text.
- Mobile uses semantic holding cards instead of a horizontally scrolling desktop table. At both 390 and 320 px, `scrollWidth === clientWidth`.
- At 320 px, market buttons are 55 px wide and profit-state buttons are about 73 px wide; every label is fully visible. The prior fieldset/legend grid collapse is fixed.
- Numeric columns use tabular figures and Chinese-market red-profit/green-loss semantics with explicit signs and text, not color alone.
- Two-week output is deliberately honest: 上涨倾向, 下跌倾向, or 无法分析. It shows a rule-model score and a non-target-price volatility band, but no fabricated probability.
- Current value and cumulative P/L accept only a recent provider-dated quote or a recent daily close. Stale cached prices remain labeled as reference data and do not enter totals.
- Today P/L requires the quote provider's trading date to match the current date in the relevant market timezone. Missing or non-current data displays `--`.
- The reference has decorative KPI icons and optimistic demonstration values. The implementation retains the existing product's text-first KPI treatment and real, fail-closed data. This is an intentional content-integrity choice, not a missing state.

## Comparison history

1. P0 — The original holdings page was a 1510 px-wide table, which forced horizontal scrolling on desktop and made today/cumulative P/L unreachable on mobile. Fix: responsive fixed-layout table on desktop and native holding cards on mobile.
2. P1 — The initial implementation could let stale quote caches, future history dates, incomplete valuation, and missing review data create misleading totals, actions, or `NaN%` CSS. Fix: provider dates, timezone-aware today checks, recent-price gates, fail-closed summary/review/ranking logic, and pending-valuation notices.
3. P1 — The old simplistic three-day action rule could consume stale intraday change data. Fix: daily change survives only for a valid current-market-day quote; the two-week panel uses dated daily history and explicitly returns 无法分析 when inputs are insufficient.
4. P1 — At 320 px, `fieldset > legend` special layout behavior collapsed the market and P/L button groups into 38 px. Fix: explicitly place the legend in grid column 1 and the button group in column 2. Final buttons show complete labels with no overflow.
5. P2 — The first comparison pass expanded a different row than the reference and had stale asset evidence. Fix: the final desktop capture uses the same second-row expanded state and current asset hashes.
6. Final comparison — passed. The selected visual hierarchy, spacing, table density, expansion placement, borders, radii, blue emphasis, and responsive reading order are preserved.

## Interaction and accessibility checks

- Searching `东山` returns only 东山精密 and preserves input focus/caret.
- Combining A股 + 亏损 produces one correct row in the current dataset; clearing restores all 26 holdings.
- Clicking 总成本 twice changes `aria-sort` from `descending` to `ascending` and changes the first row.
- Opening another stock closes the previous stock; only one analysis is visible. Escape closes it and restores focus to the triggering button.
- Desktop and mobile controls use real buttons, `aria-pressed`, `aria-sort`, `aria-expanded`, labeled regions, and visible focus states.
- Browser console warnings/errors: zero.

## Automated checks

- Production Pages suite: 34/34 passed.
- Local preview/Sites suite: 32/32 passed.
- `node --check assets/app.js`: passed.
- `node --check functions/api/quotes.js`: passed.
- `python3 -m py_compile server.py`: passed.
- `git diff --check`: passed.
- Production and preview JS/CSS bytes and cache-busting hashes match.

final result: passed

## 2026-08-17 今日分布与双币值增量验收

- 快照区现为 6 项：新增“今日盈亏分布”，原分布明确为“累计盈亏分布”。缺当日行情单列为“待行情”，不会归入持平。
- 港股、美股每只股票的今日与累计盈亏均使用两行展示：人民币主值、市场原币副值，并保留收益率；A 股避免重复人民币金额。
- 1487 px：6 张快照卡、持仓表格及所有双币值单元格均无裁切，表格 `scrollWidth === clientWidth === 1421`。
- 390 px 与 320 px：两个分布项各自全宽，持仓卡片无水平溢出，页面 `scrollWidth === clientWidth`，无原始 `NaN` 文本。
- 自动化验证保持通过：Production 34/34，Preview 32/32。
