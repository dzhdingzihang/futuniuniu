# 猪猪存钱罐

个人持仓、盈亏、市场机会和复盘页面，部署在 Cloudflare Pages。

## 登录

打开网站后会先看到“猪猪存钱罐”登录页。页面固定展示配置好的花名，只需要输入密码；密码正确后即可使用全部页面、行情接口和修改持仓功能。

密码只保存在 Cloudflare 加密 Secret 中，不会写入网页或仓库。登录成功后浏览器只保存一个 7 天有效、不可被前端脚本读取的签名会话 Cookie；顶部“退出”按钮可立即清除会话。

## 修改持仓

网页右上角的“修改持仓”会打开简化表单：

- 选择 A股、港股或美股
- 输入代码并自动识别名称、币种和行情代码
- 选择持有中或已卖出
- 填写买入价格、数量；已卖出时再填写卖出价格、数量
- 新表单记录自动计入买入 `US$20`、卖出 `US$20` 固定手续费

点击“保存并同步”后，页面会先等待 GitHub 确认根目录 `holdings.json` 已写入。GitHub 未成功时，表单不会关闭，本机持仓也不会修改。

页面重新打开时以 GitHub 当前文件为准；部署包内的静态文件和浏览器本地缓存只作为断网/上游故障时的后备，不会覆盖已经成功读取的远端数据。

## 清晰版 holdings.json

`holdings.json` 使用 v2 批次格式。每条通常只维护：

- `market`: `A` / `HK` / `US`
- `code` 与 `name`
- `buy`: 买入价格和数量
- `sell`: 仅卖出记录需要
- `fees`: 仅新表单记录需要，系统自动写入

持有状态、币种和行情服务代码不再重复填写，由网页自动生成。旧版数组和旧浏览器数据仍可读取；历史 39 条不会被追溯补收手续费。

## Cloudflare Pages

部署设置和生产环境变量见 [CLOUDFLARE.md](CLOUDFLARE.md)。同步接口由 Pages Functions 提供：

- `POST /api/login`：验证密码并建立安全会话
- `POST /api/logout`：退出并清除会话
- `GET /api/security-lookup`：识别股票名称
- `GET /api/holdings-sync`：只读检查 GitHub 同步配置
- `POST /api/holdings-sync`：原子更新 `holdings.json`

GitHub Token 只允许存放在 Cloudflare 的加密 Secret，不能写入前端代码。仓库公开时，`holdings.json` 中的持仓、成本和数量也会公开。

## 验证

```bash
node --check assets/app.js
node --test tests/pages-functions.test.mjs
```
