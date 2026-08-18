# Cloudflare Pages 部署

这个版本可部署到 Cloudflare Pages，不需要 Render。

## 设置

- Framework preset: None
- Build command: 留空
- Build output directory: `/`
- Root directory: 留空，使用仓库根目录

建议添加环境变量：

- `BASIC_AUTH_USER`: 登录页展示的密码提示文字（保留旧变量名，支持 UTF-8）
- `BASIC_AUTH_PASSWORD`: 登录页验证的密码，只能使用 Encrypt

网站不会再弹出浏览器原生账号密码框。未登录访问页面会跳到 `/login`，登录页固定展示密码提示并只提供密码输入；验证成功后服务端签发 7 天有效的 `HttpOnly`、`Secure`、`SameSite=Strict` 会话 Cookie。`POST /api/logout` 会立即清除会话。

网页内“保存并同步”会直接更新仓库根目录的 `holdings.json`。Production 环境还需要：

- `PIGGY_GITHUB_TOKEN`: 仅授权本仓库、Contents Read and write 的 GitHub fine-grained token，必须使用 Encrypt
- `PIGGY_GITHUB_OWNER`: `dzhdingzihang`
- `PIGGY_GITHUB_REPO`: `futuniuniu`
- `PIGGY_GITHUB_HOLDINGS_PATH`: `holdings.json`
- `PIGGY_GITHUB_BRANCH`: `main`

`BASIC_AUTH_PASSWORD` 和 `PIGGY_GITHUB_TOKEN` 必须作为加密 Secret 保存，绝不能写入前端、文档或 Git 历史。不要给 Preview 环境配置正式 GitHub Token，避免预览链接写入正式持仓。

登录后的页面会先使用本机缓存快速完成首屏；没有本机缓存时使用部署包内的静态 `holdings.json`。随后 `/api/holdings-sync` 在后台读取 GitHub 当前文件并作为权威数据更新页面。这样网页保存成功后无需等待 Pages 再部署，成功读取的 GitHub 数据也不会被旧浏览器缓存反向覆盖。

如果登录变量缺少任何一项，当前版本会直接返回 `503`，不会退回公开访问。登录成功后，页面、`holdings.json` 和除登录接口外的全部 `/api` 才可操作；`/assets/*` 与 `/pet/*` 是公开的版本化静态资源。

## Pages Functions

- `/api/quotes`：当前/延时报价
- `/api/history`：日线和市场基准
- `/api/rates`：最新可用汇率
- `/api/radar`：机会雷达候选池与研究评分
- `/api/security-lookup`：股票代码识别
- `/api/holdings-sync`：GitHub 持仓读取与写入
- `/api/login`、`/api/logout`：会话登录与退出

建议在 Cloudflare WAF 或 Rate Limiting 中限制 `POST /api/login` 的尝试频率。

## 自动部署

Cloudflare Pages 连接 GitHub 仓库 `dzhdingzihang/futuniuniu` 的 `main` 分支。推送到 `main` 后自动创建部署；部署成功后再检查：

- `https://alixjd.com/login` 返回登录页；
- 未登录访问受保护 API 返回 `401`；
- 登录后四个页面和行情 API 正常；
- 页面加载的 JS/CSS 查询版本与本次提交一致。
