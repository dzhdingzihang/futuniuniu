# Cloudflare 部署与运行说明

本项目不需要 Render。完整架构由 Cloudflare Pages、Pages Functions、一个独立 Cron Worker 和一个共享 KV namespace 组成：

```text
GitHub main ─→ Cloudflare Pages / Pages Functions ─→ alixjd.com
                                  │
                                  └── 只读 RADAR_SNAPSHOTS KV

Cron Worker（每日 00:10 UTC / 北京时间 08:10）
            └── 扫描 A 股、港股、美股 ─→ 写入同一 RADAR_SNAPSHOTS KV
```

> 本文档只记录部署步骤。修改本地文件不会自动部署；在没有明确的生产发布授权时，不要推送 `main`、不要部署 Worker，也不要修改生产 KV 绑定。

## 1. Pages 设置

- Framework preset: `None`
- Build command: 留空
- Build output directory: `/`
- Root directory: 留空，使用仓库根目录
- Production branch: `main`

Pages Production 环境需要以下变量：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `BASIC_AUTH_USER` | Variable | 登录页展示的密码提示文字（保留旧变量名，支持 UTF-8） |
| `BASIC_AUTH_PASSWORD` | **Encrypt / Secret** | 网站登录密码 |
| `PIGGY_GITHUB_TOKEN` | **Encrypt / Secret** | 仅授权本仓库 `Contents: Read and write` 的 fine-grained token |
| `PIGGY_GITHUB_OWNER` | Variable | GitHub owner，当前为 `dzhdingzihang` |
| `PIGGY_GITHUB_REPO` | Variable | GitHub repo，当前为 `futuniuniu` |
| `PIGGY_GITHUB_HOLDINGS_PATH` | Variable | 持仓文件，当前为 `holdings.json` |
| `PIGGY_GITHUB_BRANCH` | Variable | 写入分支，当前为 `main` |
| `RADAR_SNAPSHOTS` | **KV namespace binding** | 读取每日机会雷达快照；必须指向 Cron Worker 使用的同一 namespace |

`BASIC_AUTH_PASSWORD` 和 `PIGGY_GITHUB_TOKEN` 绝不能写入前端、文档、`wrangler.jsonc` 或 Git 历史。不要给 Preview 环境配置正式 GitHub Token，避免预览链接写入生产持仓。

## 2. 登录、持仓与 GitHub 同步

未登录访问页面会跳到 `/login`。验证成功后，服务器签发 7 天有效的 `HttpOnly`、`Secure`、`SameSite=Strict` 会话 Cookie；`POST /api/logout` 会清除会话。若登录变量缺少任意一项，服务器返回 `503`，不降级为公开访问。

登录后页面先用浏览器缓存完成快速首屏，没有缓存时使用部署包内的静态 `holdings.json`；随后 `GET /api/holdings-sync` 读取 GitHub 文件作为权威数据。

顶部“记录交易”每次只提交一笔 `operation`：

- 买入追加 lot；卖出按 `buy.date` FIFO 跨 lot 扣减。
- 每笔买入、每笔卖出固定计 `US$20`。
- `operationId` 保证重试幂等；`expectedFileSha` 防止两个页面静默覆盖彼此。
- SHA 过期时返回 `409 HOLDINGS_SHA_CONFLICT` 和最新权威文档。
- 前端写入等待超时后会先 GET 核对同一 `operationId`，不会盲目生成第二笔交易。
- 交易时的人民币成本/净额、手续费、汇率日期与来源一同锁定到 `holdings.json`。

如果 GitHub 仓库是公开的，`holdings.json` 仍可被绕过网站密码直接读取。界面会显示公开仓库隐私提醒，但这不是存储加密。若要隐藏持仓、成本和数量，需要把仓库改为私有，并重新确认 Pages Git 集成和 fine-grained token 对私有仓库的权限。

## 3. 机会雷达 KV 协议

Pages 和 Cron Worker 必须绑定同一个 KV namespace，且绑定名都为 `RADAR_SNAPSHOTS`。

```text
KV key: radar:latest:v1
schema: radar-snapshot-v2
markets: A股 / 港股 / 美股
```

Worker 每次按市场扫描。某个市场失败时，如果 KV 中有上一份有效快照，则继承它并标记 `stale`；没有可继承数据则标记 `unavailable`。三个市场全部失败时，Worker **不写入 KV**，保留上一份完整可用快照。

Pages Functions 行为：

- `GET /api/radar`：只读 KV 快照；缺少绑定或尚未生成快照时返回 `503 RADAR_SNAPSHOT_UNAVAILABLE`。
- `GET /api/radar?market=A股|港股|美股`：保留为页面“刷新”的逐市场实时扫描通道；实时扫描失败时可回退到 KV 中该市场的快照并标记 `stale`。

## 4. 创建 KV 并配置 Worker

可以在 Cloudflare Dashboard 创建一个 KV namespace，也可以在仓库根目录使用 Wrangler：

```bash
npx wrangler kv namespace create RADAR_SNAPSHOTS
```

把返回的 namespace `id` 写入 `workers/radar-scheduler/wrangler.jsonc` 中现有的 `kv_namespaces` 条目：

```json
{
  "binding": "RADAR_SNAPSHOTS",
  "id": "由 Cloudflare 返回的 namespace id"
}
```

Worker 配置已包含：

```json
{
  "name": "futuniuniu-radar-scheduler",
  "main": "index.js",
  "triggers": { "crons": ["10 0 * * *"] }
}
```

Cloudflare Cron 使用 UTC，`10 0 * * *` 即 UTC 00:10，对应北京时间每日 08:10。在获得明确发布授权后，Worker 部署命令为：

```bash
npx wrangler deploy --config workers/radar-scheduler/wrangler.jsonc
```

部署后可在 Cloudflare Dashboard 的 Worker Triggers / Logs 查看定时执行结果。等待首次成功执行后，确认 KV 中出现 `radar:latest:v1`；也可以使用已配置的 Wrangler 远程读取：

```bash
npx wrangler kv key get "radar:latest:v1" --binding RADAR_SNAPSHOTS --remote --config workers/radar-scheduler/wrangler.jsonc
```

读取结果应包含 `"schema":"radar-snapshot-v2"`、`publishedAt`、`markets` 和 `status`。

## 5. 把同一 KV 绑定给 Pages

在 Cloudflare Dashboard 中打开 Pages 项目的 Settings / Functions / Bindings（界面名称可能随 Dashboard 版本调整），新增 KV namespace binding：

- Variable name: `RADAR_SNAPSHOTS`
- KV namespace: 选择第 4 步创建、已经由 Cron Worker 写入的**同一个** namespace
- Environment: 先配置 Production；Preview 如需测试，建议使用独立的测试 KV，不要绑定正式 GitHub Token

绑定变更通常需要一次新 Pages deployment 才能在 Function 中生效。

## 6. 零停机上线顺序

为避免 Pages 先读取一个空 KV，生产发布应按以下顺序进行：

1. 创建 `RADAR_SNAPSHOTS` KV namespace，此时不改变现有 Pages。
2. 把 namespace id 写入 Worker 配置，部署 `futuniuniu-radar-scheduler`。
3. 等待或在 Dashboard 中触发一次 scheduled 测试，确认 KV 已有 `radar:latest:v1` 且 schema 为 `radar-snapshot-v2`。
4. 将这个已有有效快照的同一 KV 以 `RADAR_SNAPSHOTS` 绑定给 Pages Production。
5. 在获得明确发布授权后，推送经测试的代码并等待 Pages 自动部署。
6. 登录 `alixjd.com` 后验证 `/api/radar` 返回统一快照，机会雷达展示快照更新时间和三地 Top 3。
7. 点击顶部“刷新”，确认三个 `?market=` 手动实时扫描通道仍然可用。

该顺序不需要关闭旧站：Worker 和 KV 可先独立准备，现有 Pages 在新部署生效前仍可继续服务。

## 7. Pages Functions 路由

- `/api/quotes`：当前/延时报价
- `/api/history`：日线、市场基准与价位模型
- `/api/rates`：最新可用汇率
- `/api/radar`：读取 KV 统一快照；带 `market` 参数时手动实时扫描
- `/api/security-lookup`：股票代码识别
- `/api/holdings-sync`：GitHub 持仓权威读取与幂等交易写入
- `/api/login`、`/api/logout`：会话登录与退出

建议在 Cloudflare WAF 或 Rate Limiting 中限制 `POST /api/login` 的尝试频率。

## 8. 发布前与发布后检查

本地发布前：

```bash
node --check assets/app.js
node --test tests/*.test.mjs
git diff --check
```

Cloudflare Pages 连接 GitHub 仓库 `dzhdingzihang/futuniuniu` 的 `main` 分支。经授权推送到 `main` 后会自动创建 Pages deployment。部署成功后检查：

- `https://alixjd.com/login` 返回自定义登录页；
- 未登录访问受保护 API 返回 `401`；
- 登录后四个页面、行情 API 和持仓同步正常；
- `/api/radar` 返回 `radar-snapshot-v2`，`status.freshMarkets` / `staleMarkets` / `unavailableMarkets` 与 Worker 日志一致；
- 机会雷达 Top 3 和当前页候选能懒加载当前价、10 日参考上沿和止损参考；
- 页面加载的 JS/CSS 查询版本与本次提交一致。

如果新 Pages 版本异常，优先在 Cloudflare Pages 回滚到上一份已验证部署。Cron Worker 与 KV 可保留：它们不会修改 GitHub 持仓，也不会影响旧 Pages 读写链路。
