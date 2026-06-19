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

- `holding`: 按 `实时市场价格 * qty - cost * qty - 30 美金手续费` 计算未实现盈亏
- `sold`: 按 `sellPrice * qty - cost * qty - 30 美金手续费` 计算已实现收益
- 手续费统一按 30 美金折算到该股票币种和人民币汇总里

注意：最后一行后面不要加逗号；数字不要加引号。

## 修改交易记录

买入和卖出流水放在 `trades.json`。网页里可以新增、编辑、删除记录；这些操作会先保存到当前浏览器。需要同步到 GitHub 时，点击网页里的“导出 JSON”，把内容复制到 `trades.json`。

网页新增的交易会自动联动本机里的当前持仓：买入会新增或加仓并重算平均成本，卖出会减少数量，数量归零会移出持仓。联动后的持仓不会直接写回 GitHub；需要同步时点击“导出持仓”，把内容复制到 `holdings.json`。

字段含义：

- `date`: 交易日期，格式 `YYYY-MM-DD`
- `action`: `buy` 表示买入，`sell` 表示卖出
- `market`: 市场，只填 `港股`、`A股`、`美股`
- `code`: 页面展示的股票代码
- `name`: 页面展示的股票名称
- `price`: 成交价格
- `qty`: 成交数量
- `currency`: 币种，港股填 `HKD`，A股填 `CNY`，美股填 `USD`
- `sina`: 行情代码，和 `holdings.json` 一致
- `note`: 备注，可留空
- `affectsHoldings`: 是否参与自动联动当前持仓；网页新增的记录默认为 `true`，历史说明记录可设为 `false`
