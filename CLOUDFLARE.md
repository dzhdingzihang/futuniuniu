# Cloudflare Pages 部署

这个版本可部署到 Cloudflare Pages，不需要 Render。

## 设置

- Framework preset: None
- Build command: 留空
- Build output directory: `/`
- Root directory: 留空，使用仓库根目录

建议添加环境变量：

- `BASIC_AUTH_USER`: 登录花名（本项目设为 `我的花名`，支持 UTF-8）
- `BASIC_AUTH_PASSWORD`: 登录密码

网页内“保存并同步”会直接更新仓库根目录的 `holdings.json`。Production 环境还需要：

- `PIGGY_GITHUB_TOKEN`: 仅授权本仓库、Contents Read and write 的 GitHub fine-grained token，必须使用 Encrypt
- `PIGGY_GITHUB_OWNER`: `dzhdingzihang`
- `PIGGY_GITHUB_REPO`: `futuniuniu`
- `PIGGY_GITHUB_HOLDINGS_PATH`: `holdings.json`
- `PIGGY_GITHUB_BRANCH`: `main`

`BASIC_AUTH_PASSWORD` 和 `PIGGY_GITHUB_TOKEN` 必须作为加密 Secret 保存。不要给 Preview 环境配置正式 GitHub Token，避免预览链接写入正式持仓。

登录后的页面启动时会优先通过 `/api/holdings-sync` 读取 GitHub 当前文件；只有 GitHub 暂时不可用时才回退到部署包内的静态 `holdings.json`，两者都不可用时才使用本机离线缓存。这样网页保存成功后无需等待 Pages 再部署，也不会被旧浏览器缓存反向覆盖。

如果登录变量缺少任何一项，当前版本会直接返回 `503`，不会退回公开访问。登录成功后，页面、静态资源和全部 `/api` 才可操作。
