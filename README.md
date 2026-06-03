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

持仓数据放在 `holdings.json`。买卖股票后，只需要改这个文件里的成本和数量，网站刷新后会自动按新数据计算。

字段含义：

- `market`: 市场，只填 `港股`、`A股`、`美股`
- `code`: 页面展示的股票代码
- `name`: 页面展示的股票名称
- `cost`: 持仓成本价
- `qty`: 当前持仓数量
- `currency`: 币种，港股填 `HKD`，A股填 `CNY`，美股填 `USD`
- `sina`: 行情代码，港股格式如 `hk00763`，A股深市如 `sz002217`，A股沪市如 `sh601138`，美股如 `gb_tsll`

示例：

```json
{ "market": "港股", "code": "00763", "name": "中兴通讯", "cost": 30.5, "qty": 800, "currency": "HKD", "sina": "hk00763" }
```

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
