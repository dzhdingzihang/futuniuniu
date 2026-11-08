#!/usr/bin/env python3
"""Import the portfolio workbook into the website's readable v2 holdings file.

The workbook is the accounting source of truth.  The generated JSON keeps
native prices for display, while ``purchaseCostCny`` and ``sellProceedsCny``
lock the historical RMB accounting amounts.  ``adjustmentCny`` is descriptive:
it is already included in ``purchaseCostCny`` and must never be added again.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

from openpyxl import load_workbook


EXPECTED_SECURITY_COUNT = 80
EXPECTED_OPEN_COUNTS = {"A": 12, "HK": 7, "US": 12}
MARKET_ORDER = {"A": 0, "HK": 1, "US": 2}
FUTURE_TRADE_FEE_USD = 20
FALLBACK_A_SOLD_AS_OF = "2026-11-05"


class ImportContractError(RuntimeError):
    """Raised when the workbook no longer matches the audited contract."""


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def number(value: Any, *, field: str) -> float:
    if not is_number(value):
        raise ImportContractError(f"{field} 不是有效数字：{value!r}")
    return float(value)


def rounded(value: float, digits: int = 2) -> int | float:
    result = round(float(value), digits)
    if digits == 0 or math.isclose(result, round(result), abs_tol=10 ** (-(digits + 1))):
        return int(round(result))
    return result


def native_number(value: Any, *, field: str) -> int | float:
    return rounded(number(value, field=field), 6)


def quantity(value: Any, *, field: str) -> int | float:
    result = number(value, field=field)
    if result <= 0:
        raise ImportContractError(f"{field} 必须大于 0：{result}")
    return rounded(result, 6)


def iso_date(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", text)
    return match.group(1) if match else ""


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def combine_notes(*values: Any) -> str:
    notes: list[str] = []
    for value in values:
        text = clean_text(value)
        if text and text not in notes:
            notes.append(text)
    return "；".join(notes)


def table_rows(sheet: Any, header_row: int) -> list[dict[str, Any]]:
    headers = [clean_text(cell.value) for cell in sheet[header_row]]
    if not any(headers):
        raise ImportContractError(f"{sheet.title} 第 {header_row} 行没有表头")
    rows: list[dict[str, Any]] = []
    for cells in sheet.iter_rows(min_row=header_row + 1, values_only=True):
        if not any(value is not None for value in cells):
            continue
        rows.append({headers[index]: value for index, value in enumerate(cells) if index < len(headers) and headers[index]})
    return rows


def market_and_code(raw_code: Any) -> tuple[str, str]:
    text = clean_text(raw_code).upper()
    if "." not in text:
        raise ImportContractError(f"股票代码缺少市场前缀：{text!r}")
    prefix, code = text.split(".", 1)
    market = {"SH": "A", "SZ": "A", "HK": "HK", "US": "US"}.get(prefix)
    if not market:
        raise ImportContractError(f"不支持的股票市场：{text!r}")
    if market == "A":
        code = code.zfill(6)
    elif market == "HK":
        code = code.zfill(5)
    else:
        code = code.upper()
    return market, code


def full_code(market: str, code: str) -> str:
    if market == "A":
        prefix = "SH" if code.startswith(("5", "6", "9")) else "SZ"
        return f"{prefix}.{code}"
    return f"{market}.{code}"


def security_key(market: str, code: str) -> str:
    return f"{market}:{code}"


def stable_lot_id(market: str, code: str, kind: str) -> str:
    return f"excel-{market.lower()}-{code.lower()}-{kind}"


@dataclass(frozen=True)
class MasterSecurity:
    order: int
    market: str
    code: str
    name: str
    status: str
    pnl_cny: float
    return_rate: float | None
    currency: str
    buy_avg: float | None
    buy_qty: float | None
    sell_avg: float | None
    sell_qty: float | None
    current_qty: float
    latest_price: float | None
    market_value_native: float
    cumulative_buy_native: float | None
    cumulative_sell_native: float | None
    note: str
    pnl_basis: str

    @property
    def key(self) -> str:
        return security_key(self.market, self.code)

    @property
    def is_open(self) -> bool:
        return self.current_qty > 0


def optional_float(value: Any) -> float | None:
    return float(value) if is_number(value) else None


def parse_master(rows: Iterable[dict[str, Any]]) -> list[MasterSecurity]:
    securities: list[MasterSecurity] = []
    seen: set[str] = set()
    for index, row in enumerate(rows):
        raw_code = row.get("股票代码")
        if not clean_text(raw_code):
            continue
        market, code = market_and_code(raw_code)
        key = security_key(market, code)
        if key in seen:
            raise ImportContractError(f"全市场股票明细存在重复代码：{key}")
        seen.add(key)
        current_qty = optional_float(row.get("现持股数")) or 0.0
        market_value = optional_float(row.get("持仓市值")) or 0.0
        securities.append(
            MasterSecurity(
                order=index,
                market=market,
                code=code,
                name=clean_text(row.get("股票名称")) or code,
                status=clean_text(row.get("状态")),
                pnl_cny=number(row.get("盈亏人民币"), field=f"{key} 盈亏人民币"),
                return_rate=optional_float(row.get("盈亏比例（原币）")),
                currency=clean_text(row.get("币种")),
                buy_avg=optional_float(row.get("买入均价")),
                buy_qty=optional_float(row.get("买入数量")),
                sell_avg=optional_float(row.get("卖出均价")),
                sell_qty=optional_float(row.get("卖出数量")),
                current_qty=current_qty,
                latest_price=optional_float(row.get("最新市价")),
                market_value_native=market_value,
                cumulative_buy_native=optional_float(row.get("累计买入金额")),
                cumulative_sell_native=optional_float(row.get("累计卖出金额")),
                note=clean_text(row.get("核对说明")),
                pnl_basis=clean_text(row.get("盈亏口径")),
            )
        )
    return securities


def parse_fx(workbook: Any) -> dict[str, Any]:
    text = clean_text(workbook["股票盈亏"]["A2"].value)
    stamp = re.search(r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})（北京）", text)
    usd = re.search(r"1\s+USD\s*=\s*([0-9.]+)\s*CNY", text)
    hkd = re.search(r"1\s+HKD\s*=\s*([0-9.]+)\s*CNY", text)
    if not stamp or not usd or not hkd:
        raise ImportContractError("无法从 股票盈亏!A2 读取汇率和时间")
    return {
        "CNY": 1,
        "HKD": rounded(float(hkd.group(1)), 6),
        "USD": rounded(float(usd.group(1)), 6),
        "asOf": f"{stamp.group(1)} Asia/Shanghai",
    }


def raw_a_dates(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, list[str]]]:
    result: dict[str, dict[str, list[str]]] = defaultdict(lambda: {"buy": [], "sell": []})
    for row in rows:
        code = clean_text(row.get("归集代码")).zfill(6)
        if not code.strip("0"):
            continue
        business = clean_text(row.get("业务类型"))
        event_date = iso_date(row.get("日期"))
        if not event_date:
            continue
        if "买入" in business:
            result[code]["buy"].append(event_date)
        elif "卖出" in business:
            result[code]["sell"].append(event_date)
    return result


def ledger_groups(rows: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        raw_code = clean_text(row.get("股票代码"))
        if raw_code:
            market, code = market_and_code(raw_code)
            groups[security_key(market, code)].append(row)
    return groups


def first_ledger_entry_date(events: list[dict[str, Any]]) -> str:
    excluded = {"卖出", "期末估值", "拆合股", "代码变更"}
    dates = sorted(
        value
        for event in events
        if clean_text(event.get("项目")) not in excluded
        for value in [iso_date(event.get("事件日期"))]
        if value
    )
    return dates[0] if dates else ""


def last_ledger_sale_date(events: list[dict[str, Any]]) -> str:
    dates = sorted(
        value
        for event in events
        if clean_text(event.get("项目")) == "卖出"
        for value in [iso_date(event.get("事件日期"))]
        if value
    )
    return dates[-1] if dates else ""


def sum_field(events: Iterable[dict[str, Any]], project: str, field: str) -> float:
    return sum(float(event.get(field) or 0) for event in events if clean_text(event.get("项目")) == project)


def lot_common(master: MasterSecurity, kind: str, quality: str, note: str) -> dict[str, Any]:
    return {
        "id": stable_lot_id(master.market, master.code, kind),
        "market": master.market,
        "code": master.code,
        "name": master.name,
        "quality": quality,
        "note": note,
    }


def locked_fees(*, sold: bool) -> dict[str, int]:
    # Historical RMB costs/proceeds already contain the workbook's actual fees.
    # Explicit zero prevents the v2 default US$20 from being retroactively added.
    fees = {"buy": 0}
    if sold:
        fees["sell"] = 0
    return fees


def add_adjustment(buy: dict[str, Any], amount: float) -> None:
    buy["purchaseCostCny"] = rounded(number(buy["purchaseCostCny"], field="purchaseCostCny") + amount, 2)
    buy["adjustmentCny"] = rounded(amount, 2)


def build_hk_us_lots(
    master: MasterSecurity,
    events: list[dict[str, Any]],
    current_row: dict[str, Any] | None,
    adjustment: float,
) -> tuple[list[dict[str, Any]], float]:
    if not events:
        raise ImportContractError(f"{master.key} 缺少人民币成本明细")
    lots: list[dict[str, Any]] = []
    buy_date = first_ledger_entry_date(events)
    sold_cost = sum_field(events, "卖出", "本次卖出成本 CNY")
    sold_proceeds = sum_field(events, "卖出", "折合人民币净额")
    remaining_cost = sum_field(events, "期末估值", "剩余成本 CNY")
    valuation_cny = sum_field(events, "期末估值", "折合人民币净额")
    assigned_adjustment = 0.0

    if master.is_open:
        if current_row is None:
            raise ImportContractError(f"{master.key} 在全市场表中持仓，但当前实盘持仓缺失")
        current_qty = quantity(current_row.get("持仓数量"), field=f"{master.key} 当前持仓数量")
        if not math.isclose(float(current_qty), master.current_qty, abs_tol=1e-6):
            raise ImportContractError(f"{master.key} 当前数量不一致：{current_qty} != {master.current_qty}")
        open_lot = lot_common(master, "open", "ledger-reconciled", master.note)
        open_lot["buy"] = {
            "price": native_number(current_row.get("券商平均成本"), field=f"{master.key} 券商平均成本"),
            "qty": current_qty,
            "purchaseCostCny": rounded(remaining_cost, 2),
        }
        if buy_date:
            open_lot["buy"]["date"] = buy_date
        add_adjustment(open_lot["buy"], adjustment)
        assigned_adjustment = adjustment
        open_lot["fees"] = locked_fees(sold=False)
        lots.append(open_lot)
    elif remaining_cost or valuation_cny:
        raise ImportContractError(f"{master.key} 已清仓但人民币成本明细仍有期末余额")

    if (master.sell_qty or 0) > 0:
        if sold_cost <= 0 or sold_proceeds < 0:
            raise ImportContractError(f"{master.key} 卖出成本或净额不正确")
        if not master.buy_avg or not master.sell_avg:
            raise ImportContractError(f"{master.key} 港美股聚合成交均价缺失")
        sold_lot = lot_common(master, "sold", "ledger-reconciled", master.note)
        sold_lot["buy"] = {
            "price": rounded(master.buy_avg, 6),
            "qty": quantity(master.sell_qty, field=f"{master.key} 卖出数量"),
            "purchaseCostCny": rounded(sold_cost, 2),
        }
        if buy_date:
            sold_lot["buy"]["date"] = buy_date
        if not master.is_open:
            add_adjustment(sold_lot["buy"], adjustment)
            assigned_adjustment = adjustment
        sell_date = last_ledger_sale_date(events)
        if not sell_date:
            raise ImportContractError(f"{master.key} 缺少卖出日期")
        sold_lot["sell"] = {
            "price": rounded(master.sell_avg, 6),
            "qty": quantity(master.sell_qty, field=f"{master.key} 卖出数量"),
            "date": sell_date,
            "sellProceedsCny": rounded(sold_proceeds, 2),
        }
        sold_lot["fees"] = locked_fees(sold=True)
        lots.append(sold_lot)
    elif not master.is_open:
        raise ImportContractError(f"{master.key} 已清仓但没有卖出数量")

    if not math.isclose(assigned_adjustment, adjustment, abs_tol=1e-6):
        raise ImportContractError(f"{master.key} 未能分配一次成本调整")
    generated_pnl = sold_proceeds - sold_cost + valuation_cny - remaining_cost - adjustment
    return lots, generated_pnl


def build_a_open_lot(
    master: MasterSecurity,
    valuation_row: dict[str, Any],
    dates: dict[str, list[str]],
    adjustment: float,
) -> tuple[dict[str, Any], float]:
    qty = quantity(valuation_row.get("持仓数量（股）"), field=f"{master.key} 持仓数量")
    if not math.isclose(float(qty), master.current_qty, abs_tol=1e-6):
        raise ImportContractError(f"{master.key} A 股持仓数量不一致：{qty} != {master.current_qty}")
    market_value = number(valuation_row.get("最新市值（元）"), field=f"{master.key} 最新市值")
    pnl = number(valuation_row.get("最新盈亏（元）"), field=f"{master.key} 最新盈亏")
    base_cost = market_value - pnl
    buy = {
        "price": native_number(valuation_row.get("券商成本价（元）"), field=f"{master.key} 券商成本价"),
        "qty": qty,
        "purchaseCostCny": rounded(base_cost, 2),
    }
    if dates["buy"]:
        buy["date"] = min(dates["buy"])
    add_adjustment(buy, adjustment)
    lot = lot_common(master, "open", "broker-position", master.note)
    lot["buy"] = buy
    lot["fees"] = locked_fees(sold=False)
    return lot, market_value - base_cost - adjustment


def implied_a_sold_cost(master: MasterSecurity) -> float:
    if master.cumulative_buy_native and master.cumulative_buy_native > 0:
        return master.cumulative_buy_native
    if master.return_rate and not math.isclose(master.return_rate, 0, abs_tol=1e-12):
        implied = master.pnl_cny / master.return_rate
        if implied > 0:
            return implied
    if master.cumulative_sell_native and master.cumulative_sell_native > 0:
        implied = master.cumulative_sell_native - master.pnl_cny
        if implied > 0:
            return implied
    raise ImportContractError(f"{master.key} 无法从券商盈亏推导已清仓成本")


def build_a_sold_lot(
    master: MasterSecurity,
    dates: dict[str, list[str]],
    adjustment: float,
) -> tuple[dict[str, Any], float]:
    base_cost = implied_a_sold_cost(master)
    proceeds = base_cost + master.pnl_cny
    if proceeds < 0:
        raise ImportContractError(f"{master.key} 推导卖出净额为负数")
    raw_qty = master.sell_qty if master.sell_qty and master.sell_qty > 0 else master.buy_qty
    placeholder_qty = raw_qty is None or raw_qty <= 0
    qty = quantity(raw_qty if not placeholder_qty else 1, field=f"{master.key} 卖出数量")
    missing_trade_detail = any(
        value is None or value <= 0
        for value in (master.buy_avg, master.buy_qty, master.sell_avg, master.sell_qty)
    )
    actual_sell_date = max(dates["sell"]) if dates["sell"] else ""
    if not actual_sell_date:
        missing_trade_detail = True
    quality = "trade-details-missing" if missing_trade_detail else "broker-closed-pnl"
    placeholder_note = ""
    if missing_trade_detail:
        placeholder_note = "原始成交明细不完整；内部占位价格/数量仅为兼容格式，页面应显示未见"
    if master.pnl_basis == "费前毛差":
        quality = "gross-trade-difference"
    lot = lot_common(master, "sold", quality, combine_notes(master.note, placeholder_note))
    buy_price = master.buy_avg if master.buy_avg and master.buy_avg > 0 else base_cost / float(qty)
    sell_price = master.sell_avg if master.sell_avg and master.sell_avg > 0 else proceeds / float(qty)
    buy = {
        "price": rounded(buy_price, 6),
        "qty": qty,
        "purchaseCostCny": rounded(base_cost, 2),
    }
    if dates["buy"]:
        buy["date"] = min(dates["buy"])
    add_adjustment(buy, adjustment)
    lot["buy"] = buy
    lot["sell"] = {
        "price": rounded(sell_price, 6),
        "qty": qty,
        "date": actual_sell_date or FALLBACK_A_SOLD_AS_OF,
        "sellProceedsCny": rounded(proceeds, 2),
    }
    lot["fees"] = locked_fees(sold=True)
    return lot, proceeds - base_cost - adjustment


def workbook_date_from_name(path: Path) -> str:
    match = re.match(r"^(\d{4})(\d{2})(\d{2})", path.stem)
    if not match:
        raise ImportContractError("工作簿文件名必须以 YYYYMMDD 开头")
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"


def build_document(workbook_path: Path, adjustment: float) -> tuple[dict[str, Any], dict[str, Any]]:
    workbook = load_workbook(workbook_path, data_only=True, read_only=True)
    required_sheets = {
        "全市场股票明细",
        "股票盈亏",
        "当前实盘持仓",
        "人民币成本明细",
        "持仓估值",
        "成交原始记录",
    }
    missing = sorted(required_sheets - set(workbook.sheetnames))
    if missing:
        raise ImportContractError("工作簿缺少工作表：" + "、".join(missing))

    masters = parse_master(table_rows(workbook["全市场股票明细"], 5))
    if len(masters) != EXPECTED_SECURITY_COUNT:
        raise ImportContractError(f"股票数量应为 {EXPECTED_SECURITY_COUNT}，实际为 {len(masters)}")

    current_hk_us: dict[str, dict[str, Any]] = {}
    for row in table_rows(workbook["当前实盘持仓"], 5):
        raw_code = clean_text(row.get("股票代码"))
        if not raw_code:
            continue
        market, code = market_and_code(raw_code)
        current_hk_us[security_key(market, code)] = row

    current_a: dict[str, dict[str, Any]] = {}
    for row in table_rows(workbook["持仓估值"], 7):
        raw_code = clean_text(row.get("代码"))
        if not re.fullmatch(r"\d{6}", raw_code):
            continue
        market, code = market_and_code(("SH." if raw_code.startswith(("5", "6", "9")) else "SZ.") + raw_code)
        current_a[security_key(market, code)] = row

    ledgers = ledger_groups(table_rows(workbook["人民币成本明细"], 5))
    a_dates = raw_a_dates(table_rows(workbook["成交原始记录"], 7))

    lots: list[dict[str, Any]] = []
    generated_pnl = 0.0
    source_pnl = sum(master.pnl_cny for master in masters)
    source_valuation_dates: list[str] = []
    for row in current_a.values():
        value = iso_date(row.get("估值日期"))
        if value:
            source_valuation_dates.append(value)
    for row in current_hk_us.values():
        value = iso_date(row.get("行情更新时间"))
        if value:
            source_valuation_dates.append(value)

    ordered = sorted(masters, key=lambda item: (MARKET_ORDER[item.market], 0 if item.is_open else 1, item.order))
    for master in ordered:
        if master.market in {"HK", "US"}:
            created, pnl = build_hk_us_lots(
                master,
                ledgers.get(master.key, []),
                current_hk_us.get(master.key),
                adjustment,
            )
            lots.extend(created)
            generated_pnl += pnl
        elif master.is_open:
            valuation = current_a.get(master.key)
            if valuation is None:
                raise ImportContractError(f"{master.key} 缺少 A 股持仓估值")
            created, pnl = build_a_open_lot(master, valuation, a_dates[master.code], adjustment)
            lots.append(created)
            generated_pnl += pnl
        else:
            created, pnl = build_a_sold_lot(master, a_dates[master.code], adjustment)
            lots.append(created)
            generated_pnl += pnl

    as_of = workbook_date_from_name(workbook_path)
    valuation_as_of = max(source_valuation_dates) if source_valuation_dates else ""
    document = {
        "version": 2,
        "guide": (
            "日常新增只填 market、code、name 和 buy.date/price/qty；没有 sell 表示持有。"
            "导入记录的 purchaseCostCny 已锁定人民币成本，且已包含 adjustmentCny，请勿重复相加。"
        ),
        "source": {
            "type": "excel",
            "file": workbook_path.name,
            "asOf": as_of,
            "valuationAsOf": valuation_as_of,
            "fx": parse_fx(workbook),
            "sheets": [
                "全市场股票明细",
                "股票盈亏",
                "持仓估值",
                "当前实盘持仓",
                "人民币成本明细",
                "成交原始记录",
            ],
            "costAdjustment": {
                "amountCny": rounded(adjustment, 2),
                "scope": "每个唯一 market+code 一次",
                "includedInPurchaseCostCny": True,
            },
            "reconciliation": {
                "securityCount": len(masters),
                "openSecurityCount": len([master for master in masters if master.is_open]),
                "closedSecurityCount": len([master for master in masters if not master.is_open]),
                "sourcePnlCny": rounded(source_pnl, 2),
                "adjustmentTotalCny": rounded(adjustment * len(masters), 2),
                "adjustedPnlCny": rounded(source_pnl - adjustment * len(masters), 2),
            },
        },
        "newTradeFeeUsd": {"buy": FUTURE_TRADE_FEE_USD, "sell": FUTURE_TRADE_FEE_USD},
        "lots": lots,
    }
    summary = validate_document(document, masters, source_pnl, generated_pnl, adjustment)
    return document, summary


def validate_document(
    document: dict[str, Any],
    masters: list[MasterSecurity],
    source_pnl: float,
    generated_pnl: float,
    adjustment: float,
) -> dict[str, Any]:
    lots = document["lots"]
    ids = [clean_text(lot.get("id")) for lot in lots]
    if len(ids) != len(set(ids)):
        raise ImportContractError("生成结果存在重复 lot id")

    source_keys = {master.key for master in masters}
    generated_keys = {security_key(lot["market"], lot["code"]) for lot in lots}
    if generated_keys != source_keys:
        missing = sorted(source_keys - generated_keys)
        extra = sorted(generated_keys - source_keys)
        raise ImportContractError(f"生成证券集合不一致；缺少={missing}；多出={extra}")

    open_keys = {
        security_key(lot["market"], lot["code"])
        for lot in lots
        if not isinstance(lot.get("sell"), dict)
    }
    expected_open_keys = {master.key for master in masters if master.is_open}
    if open_keys != expected_open_keys:
        raise ImportContractError("生成持仓集合与全市场股票明细不一致")
    open_counts = {
        market: len([key for key in open_keys if key.startswith(market + ":")])
        for market in EXPECTED_OPEN_COUNTS
    }
    if open_counts != EXPECTED_OPEN_COUNTS:
        raise ImportContractError(f"持仓市场数量不正确：{open_counts}")

    adjustment_by_key: dict[str, float] = defaultdict(float)
    for lot in lots:
        buy = lot.get("buy") or {}
        key = security_key(lot["market"], lot["code"])
        adjustment_by_key[key] += float(buy.get("adjustmentCny") or 0)
        cost = number(buy.get("purchaseCostCny"), field=f"{key} purchaseCostCny")
        if cost < float(buy.get("adjustmentCny") or 0):
            raise ImportContractError(f"{key} purchaseCostCny 小于 adjustmentCny")
        if not is_number(buy.get("price")) or float(buy["price"]) <= 0:
            raise ImportContractError(f"{key} 缺少兼容格式所需的正数买入价")
        if not is_number(buy.get("qty")) or float(buy["qty"]) <= 0:
            raise ImportContractError(f"{key} 缺少兼容格式所需的正数数量")
    bad_adjustments = {
        key: amount
        for key, amount in adjustment_by_key.items()
        if not math.isclose(amount, adjustment, abs_tol=0.01)
    }
    if bad_adjustments:
        raise ImportContractError(f"成本调整没有按每只股票一次分配：{bad_adjustments}")

    adjustment_total = sum(adjustment_by_key.values())
    expected_adjusted_pnl = source_pnl - adjustment_total
    if not math.isclose(generated_pnl, expected_adjusted_pnl, abs_tol=1.0):
        raise ImportContractError(
            f"生成锁定盈亏不平：{generated_pnl:.2f} != {expected_adjusted_pnl:.2f}"
        )

    closed_count = len(source_keys - open_keys)
    if closed_count != EXPECTED_SECURITY_COUNT - sum(EXPECTED_OPEN_COUNTS.values()):
        raise ImportContractError(f"已清仓股票数量不正确：{closed_count}")
    return {
        "securityCount": len(source_keys),
        "lotCount": len(lots),
        "openSecurityCount": len(open_keys),
        "closedSecurityCount": closed_count,
        "openByMarket": open_counts,
        "adjustedSecurityCount": len(adjustment_by_key),
        "adjustmentTotalCny": rounded(adjustment_total, 2),
        "sourcePnlCny": rounded(source_pnl, 2),
        "adjustedPnlCny": rounded(generated_pnl, 2),
        "missingTradeDetailLots": len([lot for lot in lots if lot.get("quality") == "trade-details-missing"]),
    }


def write_json(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="从股票记录 Excel 生成网站 holdings.json")
    result.add_argument("workbook", type=Path, help="20261108股票记录.xlsx 路径")
    result.add_argument("--output", type=Path, help="输出 JSON 路径；非 dry-run 时必填")
    result.add_argument("--additional-cost-cny", type=float, default=1000, help="每个唯一股票增加一次的人民币成本")
    result.add_argument("--dry-run", action="store_true", help="只校验和打印摘要，不写文件")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if not args.workbook.is_file():
        print(f"错误：工作簿不存在：{args.workbook}", file=sys.stderr)
        return 2
    if args.additional_cost_cny < 0 or not math.isfinite(args.additional_cost_cny):
        print("错误：additional-cost-cny 必须是非负数", file=sys.stderr)
        return 2
    if not args.dry_run and args.output is None:
        print("错误：非 dry-run 模式必须提供 --output", file=sys.stderr)
        return 2
    try:
        document, summary = build_document(args.workbook, args.additional_cost_cny)
        if not args.dry_run and args.output is not None:
            write_json(args.output, document)
            summary["output"] = str(args.output.resolve())
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    except ImportContractError as error:
        print(f"导入失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
