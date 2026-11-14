#!/usr/bin/env python3
"""Import the portfolio workbook into the website's readable v2 holdings file.

The workbook is the accounting source of truth.  The generated JSON keeps
native prices for display, while ``purchaseCostCny`` and ``sellProceedsCny``
lock the workbook's original RMB amounts. Per-security buy and sale costs are
stored once in the root costPolicy and applied by the application at read time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

from openpyxl import load_workbook


MARKET_ORDER = {"A": 0, "HK": 1, "US": 2}
FUTURE_TRADE_FEE_USD = 20
FALLBACK_A_SOLD_AS_OF = "2026-11-05"
INITIAL_HK_US_LEDGER_DATE = "2026-11-08"


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


@dataclass
class SaleHistory:
    cutoff: str
    baseline: dict[str, dict[str, Any]]
    fills: dict[str, list[dict[str, Any]]]
    rates: dict[str, dict[str, Any]]


def read_sale_history(workbook: Any) -> SaleHistory | None:
    if "历史卖出基准" not in workbook.sheetnames:
        return None
    baseline = {}
    dates = set()
    for row in table_rows(workbook["历史卖出基准"], 1):
        key = security_key(*market_and_code(row.get("股票代码")))
        if key in baseline:
            raise ImportContractError(f"{key} 历史卖出基准重复")
        baseline[key] = row
        dates.add(iso_date(row.get("基准日期")))
    if len(dates) != 1 or "" in dates:
        raise ImportContractError("历史卖出基准缺少统一的基准日期")
    cutoff = dates.pop()
    if not {"实盘逐笔成交", "历史汇率"}.issubset(workbook.sheetnames):
        raise ImportContractError("逐单导入需要实盘逐笔成交和历史汇率")
    fills = defaultdict(list)
    for row in table_rows(workbook["实盘逐笔成交"], 5):
        if row.get("方向") == "卖出" and iso_date(row.get("成交时间")) > cutoff:
            key = security_key(*market_and_code(row.get("原始股票代码")))
            fills[key].append(row)
    rates = {iso_date(row["取价日期"]): row for row in table_rows(workbook["历史汇率"], 5)}
    return SaleHistory(cutoff, baseline, fills, rates)


def aggregate_sale(
    master: MasterSecurity, events: list[dict[str, Any]], buy_price: Any, sell_price: Any, qty: Any
) -> dict[str, Any]:
    cost = sum_field(events, "卖出", "本次卖出成本 CNY")
    proceeds = sum_field(events, "卖出", "折合人民币净额")
    sell_date = last_ledger_sale_date(events)
    if cost <= 0 or proceeds < 0 or not sell_date:
        raise ImportContractError(f"{master.key} 历史卖出缺少有效成本、净额或日期")
    qty = quantity(qty, field=f"{master.key} 历史卖出数量")
    sale = lot_common(master, "sold", "ledger-reconciled", master.note)
    sale["buy"] = {
        "price": native_number(buy_price, field=f"{master.key} 历史买入均价"),
        "qty": qty,
        "purchaseCostCny": rounded(cost, 2),
    }
    buy_date = first_ledger_entry_date(events)
    if buy_date:
        sale["buy"]["date"] = buy_date
    sale["sell"] = {
        "price": native_number(sell_price, field=f"{master.key} 历史卖出均价"),
        "qty": qty,
        "date": sell_date,
        "sellProceedsCny": rounded(proceeds, 2),
    }
    sale["fees"] = locked_fees(sold=True)
    return sale


def broker_order_sale(
    master: MasterSecurity, order_key: tuple[str, str, str],
    executions: list[tuple[dict[str, Any], dict[str, Any]]], rates: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    day, account, order = order_key
    qty = gross = native_cost = cost_cny = proceeds = fee_cny = fee_usd = 0.0
    for fill, ledger in executions:
        units = quantity(fill.get("成交数量"), field="成交数量")
        price = number(fill.get("成交单价"), field="成交单价")
        amount = number(fill.get("成交金额"), field="成交金额")
        fee = number(fill.get("分摊订单费"), field="分摊订单费")
        pnl = number(fill.get("本笔已实现盈亏"), field="本笔已实现盈亏")
        fx = number(ledger.get("汇率 CNY／原币"), field="交易币种兑人民币汇率")
        net = number(ledger.get("折合人民币净额"), field="折合人民币净额")
        currency = clean_text(fill.get("币种"))
        if (price <= 0 or fee < 0 or fx <= 0 or currency != master.currency
                or currency != ledger.get("交易原币") or day != iso_date(ledger.get("事件日期"))
                or not math.isclose(amount, price * units, abs_tol=0.005)
                or not math.isclose(net, (amount - fee) * fx, abs_tol=0.015)):
            raise ImportContractError(f"{master.key} {day} 成交、费用、币种或人民币净额无法核对")
        if currency == "USD":
            usd_fee = fee
        else:
            usd_fx = number(rates.get(day, {}).get("1 USD 折合 CNY"), field=f"{day} 美元汇率")
            if usd_fx <= 0:
                raise ImportContractError(f"{day} 美元汇率必须大于零")
            usd_fee = fee * fx / usd_fx
        qty += units
        gross += amount
        native_cost += amount - fee - pnl
        cost_cny += number(ledger.get("本次卖出成本 CNY"), field="本次卖出成本 CNY")
        proceeds += net
        fee_cny += fee * fx
        fee_usd += usd_fee
    # The workbook keeps broker identifiers private. The website only needs a stable lot ID.
    digest = hashlib.sha256(json.dumps([account, order], ensure_ascii=False).encode()).hexdigest()[:16]
    lot = lot_common(master, f"sold-{day}-{digest}", "ledger-reconciled",
                     "富途实际成交；同日同单合并，人民币成本按移动平均法结转，卖出净额已扣实际费用")
    lot["buy"] = {"price": rounded(native_cost / qty, 6), "qty": rounded(qty, 6),
                  "purchaseCostCny": rounded(cost_cny, 2)}
    lot["sell"] = {"price": rounded(gross / qty, 6), "qty": rounded(qty, 6), "date": day,
                   "sellProceedsCny": rounded(proceeds, 2), "feeCny": rounded(fee_cny, 6)}
    lot["fees"] = {"buy": 0, "sell": rounded(fee_usd, 6)}
    return lot


def incremental_sales(
    master: MasterSecurity, events: list[dict[str, Any]], history: SaleHistory
) -> list[dict[str, Any]]:
    previous = []
    entries = {}
    first_sale = ""
    share_changes = []
    for row in events:
        day = iso_date(row.get("事件日期"))
        if not day:
            raise ImportContractError(f"{master.key} 成本明细缺少事件日期")
        if day <= history.cutoff:
            previous.append(row)
            continue
        kind = row.get("项目")
        if kind in {"拆合股", "代码变更"}:
            share_changes.append(day)
        if kind == "卖出":
            key = (clean_text(row.get("业务账户")), clean_text(row.get("原始成交号")))
            if not all(key) or key in entries:
                raise ImportContractError(f"{master.key} 成本明细的成交标识缺失或重复")
            entries[key] = row
            first_sale = min(first_sale or day, day)
    baseline = history.baseline.get(master.key)
    if bool(baseline) != bool(last_ledger_sale_date(previous)):
        raise ImportContractError(f"{master.key} 历史卖出基准与成本明细不一致")
    if share_changes and (baseline or (first_sale and first_sale <= max(share_changes))):
        raise ImportContractError(f"{master.key} 卖出后发生拆合股或代码变更，需先核对不同股数单位")
    sales = []
    if baseline:
        sales.append(aggregate_sale(master, previous, baseline["买入均价"], baseline["卖出均价"], baseline["卖出数量"]))
    orders = defaultdict(list)
    for fill in history.fills.get(master.key, []):
        account = clean_text(fill.get("业务账户"))
        ledger = entries.pop((account, clean_text(fill.get("成交号"))), None)
        order = clean_text(fill.get("订单号"))
        if ledger is None or not order:
            raise ImportContractError(f"{master.key} 逐笔成交缺少订单号，或无法与成本明细逐笔匹配")
        orders[(iso_date(fill.get("成交时间")), account, order)].append((fill, ledger))
    if entries:
        raise ImportContractError(f"{master.key} 成本明细有卖出，但缺少逐笔成交")
    sales.extend(broker_order_sale(master, key, orders[key], history.rates) for key in sorted(orders))
    if not math.isclose(sum(lot["sell"]["qty"] for lot in sales), master.sell_qty or 0, abs_tol=1e-6):
        raise ImportContractError(f"{master.key} 历史与逐单卖出股数之和不等于总表卖出数量")
    return sales


def build_hk_us_lots(
    master: MasterSecurity,
    events: list[dict[str, Any]],
    current_row: dict[str, Any] | None,
    history: SaleHistory | None = None,
) -> tuple[list[dict[str, Any]], float]:
    if not events:
        raise ImportContractError(f"{master.key} 缺少人民币成本明细")
    lots: list[dict[str, Any]] = []
    buy_date = first_ledger_entry_date(events)
    sold_cost = sum_field(events, "卖出", "本次卖出成本 CNY")
    sold_proceeds = sum_field(events, "卖出", "折合人民币净额")
    remaining_cost = sum_field(events, "期末估值", "剩余成本 CNY")
    valuation_cny = sum_field(events, "期末估值", "折合人民币净额")

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
        open_lot["fees"] = locked_fees(sold=False)
        lots.append(open_lot)
    elif remaining_cost or valuation_cny:
        raise ImportContractError(f"{master.key} 已清仓但人民币成本明细仍有期末余额")

    if history is not None:
        lots.extend(incremental_sales(master, events, history))
    elif (master.sell_qty or 0) > 0:
        lots.append(aggregate_sale(master, events, master.buy_avg, master.sell_avg, master.sell_qty))
    elif not master.is_open:
        raise ImportContractError(f"{master.key} 已清仓但没有卖出数量")

    generated_pnl = sold_proceeds - sold_cost + valuation_cny - remaining_cost
    return lots, generated_pnl


def build_a_open_lots(
    master: MasterSecurity,
    valuation_row: dict[str, Any],
    dates: dict[str, list[str]],
) -> tuple[list[dict[str, Any]], float]:
    qty = quantity(valuation_row.get("持仓数量（股）"), field=f"{master.key} 持仓数量")
    if not math.isclose(float(qty), master.current_qty, abs_tol=1e-6):
        raise ImportContractError(f"{master.key} A 股持仓数量不一致：{qty} != {master.current_qty}")
    market_value = number(valuation_row.get("最新市值（元）"), field=f"{master.key} 最新市值")
    pnl = number(valuation_row.get("最新盈亏（元）"), field=f"{master.key} 最新盈亏")
    net_investment = market_value - pnl
    broker_unit_cost = native_number(valuation_row.get("券商成本价（元）"), field=f"{master.key} 券商成本价")
    buy = {
        "price": broker_unit_cost,
        "qty": qty,
        "purchaseCostCny": rounded(net_investment, 2),
    }
    if dates["buy"]:
        buy["date"] = min(dates["buy"])
    lot = lot_common(master, "open", "broker-position", master.note)
    lot["buy"] = buy
    lot["fees"] = locked_fees(sold=False)
    if not master.sell_qty:
        return [lot], market_value - buy["purchaseCostCny"]

    # The broker position sheet supplies a per-share cost for the shares still
    # held. Its P&L already incorporates past sales. Split that P&L explicitly
    # between the remaining shares and the observed sale without adding it twice.
    if not dates["sell"] or not master.buy_avg or not master.sell_avg or not master.cumulative_sell_native:
        raise ImportContractError(f"{master.key} 缺少部分卖出的日期、均价或成交金额")
    open_cost = rounded(float(qty) * broker_unit_cost, 2)
    proceeds = rounded(master.cumulative_sell_native, 2)
    sold_cost = rounded(net_investment - open_cost + proceeds, 2)
    if sold_cost <= 0:
        raise ImportContractError(f"{master.key} 券商盈亏推导的已卖成本不正确：{sold_cost}")
    buy["purchaseCostCny"] = open_cost
    note = "剩余成本按券商持仓成本价×剩余股数；卖出按可见成交总额，已卖成本按券商盈亏反推，未单列历史费用。"
    lot["note"] = combine_notes(master.note, note)
    sold = lot_common(master, "sold", "broker-partial-reconciled", note)
    sold["buy"] = {"price": master.buy_avg, "qty": master.sell_qty, "purchaseCostCny": sold_cost}
    if dates["buy"]:
        sold["buy"]["date"] = min(dates["buy"])
    sold["sell"] = {
        "price": master.sell_avg,
        "qty": master.sell_qty,
        "date": max(dates["sell"]),
        "sellProceedsCny": proceeds,
    }
    sold["fees"] = locked_fees(sold=True)
    return [lot, sold], market_value - open_cost + proceeds - sold_cost


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
    lot["buy"] = buy
    lot["sell"] = {
        "price": rounded(sell_price, 6),
        "qty": qty,
        "date": actual_sell_date or FALLBACK_A_SOLD_AS_OF,
        "sellProceedsCny": rounded(proceeds, 2),
    }
    lot["fees"] = locked_fees(sold=True)
    return lot, proceeds - base_cost


def workbook_date_from_name(path: Path) -> str:
    match = re.match(r"^(\d{4})(\d{2})(\d{2})", path.stem)
    if not match:
        raise ImportContractError("工作簿文件名必须以 YYYYMMDD 开头")
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"


def build_document(workbook_path: Path, buy_cny: float, sell_cny: float) -> tuple[dict[str, Any], dict[str, Any]]:
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
    if not masters:
        raise ImportContractError("全市场股票明细中没有可导入的证券")

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
    history = read_sale_history(workbook)
    if history:
        market_keys = {m.key for m in masters if m.market in {"HK", "US"}}
        if (set(history.fills) | set(history.baseline)) - market_keys:
            raise ImportContractError("卖出基准或近期成交存在总表未列示的证券，请核对代码变更")
    elif any(last_ledger_sale_date(events) > INITIAL_HK_US_LEDGER_DATE for events in ledgers.values()):
        raise ImportContractError("基准建账后的港美股卖出需要历史卖出基准表，无法使用历史聚合均价")
    a_dates = raw_a_dates(table_rows(workbook["成交原始记录"], 7))

    lots: list[dict[str, Any]] = []
    generated_pnl = 0.0
    source_pnl = sum(master.pnl_cny for master in masters)
    valuation_dates: dict[str, list[str]] = defaultdict(list)
    for row in current_a.values():
        value = iso_date(row.get("估值日期"))
        if value:
            valuation_dates["A"].append(value)
    for key, row in current_hk_us.items():
        value = iso_date(row.get("行情更新时间"))
        if value:
            valuation_dates[key.split(":")[0]].append(value)

    ordered = sorted(masters, key=lambda item: (MARKET_ORDER[item.market], 0 if item.is_open else 1, item.order))
    for master in ordered:
        if master.market in {"HK", "US"}:
            created, pnl = build_hk_us_lots(
                master,
                ledgers.get(master.key, []),
                current_hk_us.get(master.key),
                history,
            )
        elif master.is_open:
            valuation = current_a.get(master.key)
            if valuation is None:
                raise ImportContractError(f"{master.key} 缺少 A 股持仓估值")
            created, pnl = build_a_open_lots(master, valuation, a_dates[master.code])
        else:
            sold_lot, pnl = build_a_sold_lot(master, a_dates[master.code])
            created = [sold_lot]
        if not math.isclose(pnl, master.pnl_cny, abs_tol=1.0):
            raise ImportContractError(f"{master.key} 锁定盈亏与来源不一致：{pnl:.2f} != {master.pnl_cny:.2f}")
        lots.extend(created)
        generated_pnl += pnl

    as_of = workbook_date_from_name(workbook_path)
    latest_by_market = {market: max(days) for market, days in valuation_dates.items()}
    valuation_as_of = max(latest_by_market.values(), default="")
    document = {
        "version": 2,
        "costPolicy": {"buyCny": buy_cny, "sellCny": sell_cny},
        "guide": (
            "统一调整人民币买卖成本只改 costPolicy 的 buyCny、sellCny，每只股票分别计一次。"
            "lots 保存调整前的成交数据；日常买卖请使用网页上的「记录交易」。"
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
            "reconciliation": {
                "securityCount": len(masters),
                "openSecurityCount": len([master for master in masters if master.is_open]),
                "closedSecurityCount": len([master for master in masters if not master.is_open]),
                "soldSecurityCount": len({security_key(lot["market"], lot["code"]) for lot in lots if lot.get("sell")}),
                "sourcePnlCny": rounded(source_pnl, 2),
            },
        },
        "newTradeFeeUsd": {"buy": FUTURE_TRADE_FEE_USD, "sell": FUTURE_TRADE_FEE_USD},
        "lots": lots,
    }
    if history is not None:
        document["source"]["valuationAsOfByMarket"] = latest_by_market
        document["source"]["sheets"].extend(["历史卖出基准", "实盘逐笔成交", "历史汇率"])
    workbook.close()
    summary = validate_document(document, masters, source_pnl, generated_pnl)
    return document, summary


def validate_document(
    document: dict[str, Any],
    masters: list[MasterSecurity],
    source_pnl: float,
    generated_pnl: float,
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
        for market in MARKET_ORDER
    }

    for lot in lots:
        buy = lot.get("buy") or {}
        key = security_key(lot["market"], lot["code"])
        cost = number(buy.get("purchaseCostCny"), field=f"{key} purchaseCostCny")
        if cost < 0:
            raise ImportContractError(f"{key} purchaseCostCny 小于零")
        if not is_number(buy.get("price")) or float(buy["price"]) <= 0:
            raise ImportContractError(f"{key} 缺少兼容格式所需的正数买入价")
        if not is_number(buy.get("qty")) or float(buy["qty"]) <= 0:
            raise ImportContractError(f"{key} 缺少兼容格式所需的正数数量")
    sold_keys = {security_key(lot["market"], lot["code"]) for lot in lots if lot.get("sell")}
    expected_sold = {m.key for m in masters if not m.is_open or (m.sell_qty or 0) > 0}
    if sold_keys != expected_sold:
        raise ImportContractError(f"生成卖出集合与全市场股票明细不一致：{sorted(sold_keys ^ expected_sold)}")
    if not math.isclose(generated_pnl, source_pnl, abs_tol=1.0):
        raise ImportContractError(
            f"生成锁定盈亏不平：{generated_pnl:.2f} != {source_pnl:.2f}"
        )
    closed_count = len(source_keys - open_keys)
    buy_total = len(source_keys) * document["costPolicy"]["buyCny"]
    sell_total = len(sold_keys) * document["costPolicy"]["sellCny"]
    return {
        "securityCount": len(source_keys),
        "lotCount": len(lots),
        "openSecurityCount": len(open_keys),
        "closedSecurityCount": closed_count,
        "openByMarket": open_counts,
        "soldSecurityCount": len(sold_keys),
        "buyAdjustmentTotalCny": rounded(buy_total, 2),
        "sellAdjustmentTotalCny": rounded(sell_total, 2),
        "adjustmentTotalCny": rounded(buy_total + sell_total, 2),
        "sourcePnlCny": rounded(source_pnl, 2),
        "adjustedPnlCny": rounded(source_pnl - buy_total - sell_total, 2),
        "missingTradeDetailLots": len([lot for lot in lots if lot.get("quality") == "trade-details-missing"]),
    }


def write_json(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=path.parent) as temp_dir:
        temp_path = Path(temp_dir) / "holdings.json"
        temp_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp_path.replace(path)


def read_target(path: Path | None) -> tuple[dict[str, Any], bool]:
    if path is None or not path.exists():
        return {}, False
    try:
        existing = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ImportContractError(f"无法读取已有输出 {path}：{error}") from error
    # Legacy arrays and manually appended lots have no Excel import ID.
    if not isinstance(existing, dict) or not isinstance(existing.get("lots"), list):
        return {}, True

    def is_manual(lot: Any) -> bool:
        if not isinstance(lot, dict) or not str(lot.get("id", "")).startswith("excel-"):
            return True
        return any(isinstance(item, dict) and item.get("operationId")
                   for item in (lot, lot.get("buy"), lot.get("sell")))

    policy = existing.get("costPolicy", {})
    if not isinstance(policy, dict):
        raise ImportContractError("已有文件的 costPolicy 格式不正确")
    return policy, any(is_manual(lot) for lot in existing["lots"])


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="从股票记录 Excel 生成网站 holdings.json")
    result.add_argument("workbook", type=Path, help="20261108股票记录.xlsx 路径")
    result.add_argument("--output", type=Path, help="输出 JSON 路径；非 dry-run 时必填")
    result.add_argument("--buy-cost-cny", "--additional-cost-cny", type=float, help="每只股票一次的买入成本；默认沿用输出文件，首次为 2000")
    result.add_argument("--sell-cost-cny", type=float, help="每只卖出股票一次的卖出成本；默认沿用输出文件，首次为 1000")
    result.add_argument("--replace-trades", action="store_true", help="明确以工作簿替换已有输出中的网站交易或手工记录")
    result.add_argument("--dry-run", action="store_true", help="只校验和打印摘要，不写文件")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if not args.workbook.is_file():
        print(f"错误：工作簿不存在：{args.workbook}", file=sys.stderr)
        return 2
    if not args.dry_run and args.output is None:
        print("错误：非 dry-run 模式必须提供 --output", file=sys.stderr)
        return 2
    try:
        policy, manual_trades = read_target(args.output)
        if manual_trades and not args.dry_run and not args.replace_trades:
            raise ImportContractError("输出文件含网站录入或手工交易。请先导入新文件核对；确认以该工作簿完全替换时使用 --replace-trades。")
        buy_cny = policy.get("buyCny", 2000) if args.buy_cost_cny is None else args.buy_cost_cny
        sell_cny = policy.get("sellCny", 1000) if args.sell_cost_cny is None else args.sell_cost_cny
        if any(not is_number(amount) or amount < 0 or round(amount, 2) != amount for amount in (buy_cny, sell_cny)):
            raise ImportContractError("买卖成本必须是非负人民币金额，最多保留两位小数")
        document, summary = build_document(args.workbook, rounded(buy_cny, 2), rounded(sell_cny, 2))
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
