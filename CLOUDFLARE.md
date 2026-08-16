# Cloudflare Pages 部署

这个版本可部署到 Cloudflare Pages，不需要 Render。

## 设置

- Framework preset: None
- Build command: 留空
- Build output directory: `/`
- Root directory: 留空，使用仓库根目录

建议添加环境变量：

- `BASIC_AUTH_USER`: 登录用户名
- `BASIC_AUTH_PASSWORD`: 登录密码

网页内“保存并同步”会直接更新仓库根目录的 `holdings.json`。Production 环境还需要：

- `PIGGY_GITHUB_TOKEN`: 仅授权本仓库、Contents Read and write 的 GitHub fine-grained token，必须使用 Encrypt
- `PIGGY_GITHUB_OWNER`: `dzhdingzihang`
- `PIGGY_GITHUB_REPO`: `futuniuniu`
- `PIGGY_GITHUB_HOLDINGS_PATH`: `holdings.json`
- `PIGGY_GITHUB_BRANCH`: `main`

`BASIC_AUTH_PASSWORD` 和 `PIGGY_GITHUB_TOKEN` 必须作为加密 Secret 保存。不要给 Preview 环境配置正式 GitHub Token，避免预览链接写入正式持仓。

如果不设置 `BASIC_AUTH_USER` 和 `BASIC_AUTH_PASSWORD`，网站会公开访问，持仓写入接口也会拒绝工作。
