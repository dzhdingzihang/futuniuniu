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
