# 猪猪投资存钱罐 Render 部署版

这是只包含实时盈亏网站的发布包，不包含本地目录里的其他项目或数据。

## Render 设置

- Runtime: Python
- Build Command: 留空
- Start Command: `python server.py`
- Plan: Free

建议在 Render 的 Environment 里增加：

- `BASIC_AUTH_USER`: 你的登录用户名
- `BASIC_AUTH_PASSWORD`: 你的登录密码

如果不设置这两个变量，网站会公开访问。

## 修改持仓数据

持仓和已卖出记录都放在 `holdings.json`。同一只股票可以同时有一条 `holding` 持有中记录和多条 `sold` 已卖出记录；网站会把两类记录一起纳入总体收益。

字段含义：

- `market`: 市场，只填 `港股`、`A股`、`美股`
- `code`: 页面展示的股票代码
- `name`: 页面展示的股票名称
- `status`: 状态，`holding` 表示持有中，`sold` 表示已卖出；旧数据不填时默认按 `holding` 处理
- `cost`: 买入成本价
- `sellPrice`: 卖出价格，只在 `status` 为 `sold` 时必填
- `sellDate`: 卖出日期，可选，格式 `YYYY-MM-DD`
- `qty`: 数量；持有中为当前持仓数量，已卖出为该批卖出数量
- `currency`: 币种，港股填 `HKD`，A股填 `CNY`，美股填 `USD`
- `sina`: 行情代码，港股格式如 `hk00763`，A股深市如 `sz002217`，A股沪市如 `sh601138`，美股如 `gb_tsll`

示例：

```json
{ "market": "港股", "code": "00763", "name": "中兴通讯", "status": "holding", "cost": 30.5, "qty": 800, "currency": "HKD", "sina": "hk00763" }
{ "market": "美股", "code": "ASTX", "name": "2倍做多ASTS", "status": "sold", "cost": 52, "sellPrice": 47, "sellDate": "2026-06-01", "qty": 10, "currency": "USD", "sina": "gb_astx" }
```

收益计算规则：

- `holding`: 按 `实时市场价格 * qty - cost * qty` 计算未实现盈亏
- `sold`: 按 `sellPrice * qty - cost * qty` 计算已实现收益
- 非人民币资产按页面成本参考汇率折算人民币；如需纳入手续费，请将其计入成本或卖出金额后再填写。

注意：最后一行后面不要加逗号；数字不要加引号。

## 查看和维护卖出记录

`#trades` 页面只读取 `holdings.json` 中 `status: "sold"` 的记录，并展示买入成本、卖出金额、已实现盈亏和收益率。新增或修正一笔卖出记录时，请直接编辑对应的 `holdings.json` 条目。

`trades.json` 作为历史兼容文件保留，不参与当前卖出记录页和持仓盈亏汇总。
