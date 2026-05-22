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
