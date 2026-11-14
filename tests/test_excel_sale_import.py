import json
import unittest
from types import SimpleNamespace

from scripts.import_holdings_from_excel import ImportContractError, SaleHistory, incremental_sales


class ExcelSaleImportTests(unittest.TestCase):
    def setUp(self):
        self.master = SimpleNamespace(key="US:EX", market="US", code="EX", name="Example",
                                      currency="USD", note="", sell_qty=13)
        self.events = [
            {"事件日期": "2026-09-10", "项目": "买入"},
            {"事件日期": "2026-10-05", "项目": "卖出", "本次卖出成本 CNY": 450, "折合人民币净额": 550},
        ]
        self.fills = []
        for deal, qty, price, order, day in [
            ("private-fill-a", 1, 20, "private-order-a", "2026-11-09"),
            ("private-fill-b", 2, 17, "private-order-a", "2026-11-09"),
            ("private-fill-c", 5, 22, "private-order-b", "2026-11-10"),
        ]:
            gross = qty * price
            fee = 0.1 * qty
            self.fills.append({"成交时间": day, "业务账户": "private-account", "成交数量": qty,
                               "成交单价": price, "成交金额": gross, "分摊订单费": fee,
                               "本笔已实现盈亏": gross - fee - qty * 10, "币种": "USD",
                               "订单号": order, "成交号": deal})
            self.events.append({"项目": "卖出", "事件日期": day, "原始成交号": deal,
                                "业务账户": "private-account", "交易原币": "USD", "汇率 CNY／原币": 7,
                                "本次卖出成本 CNY": qty * 69, "折合人民币净额": (gross - fee) * 7})
        self.history = SaleHistory("2026-11-08",
                                   {"US:EX": {"买入均价": 13, "卖出均价": 16, "卖出数量": 5}},
                                   {"US:EX": self.fills}, {})

    def test_baseline_and_distinct_new_orders_are_reproducible(self):
        lots = incremental_sales(self.master, self.events, self.history)
        base, first, second = lots
        self.assertEqual(base["buy"], {"price": 13, "qty": 5, "purchaseCostCny": 450, "date": "2026-09-10"})
        self.assertEqual(base["sell"], {"price": 16, "qty": 5, "date": "2026-10-05", "sellProceedsCny": 550})
        self.assertEqual(first["buy"], {"price": 10, "qty": 3, "purchaseCostCny": 207})
        self.assertEqual(first["sell"], {"price": 18, "qty": 3, "date": "2026-11-09",
                                         "sellProceedsCny": 375.9, "feeCny": 2.1})
        self.assertEqual(first["fees"], {"buy": 0, "sell": 0.3})
        self.assertEqual(second["sell"]["date"], "2026-11-10")
        self.assertNotIn("private-", json.dumps(lots))
        self.fills.reverse()
        self.assertEqual(lots, incremental_sales(self.master, list(reversed(self.events)), self.history))

    def test_missing_execution_and_subsequent_split_fail_reconciliation(self):
        with self.assertRaisesRegex(ImportContractError, "缺少逐笔成交"):
            incremental_sales(self.master, self.events, SaleHistory(self.history.cutoff, self.history.baseline, {}, {}))
        with self.assertRaisesRegex(ImportContractError, "拆合股"):
            incremental_sales(self.master, self.events + [{"项目": "拆合股", "事件日期": "2026-11-11"}], self.history)
