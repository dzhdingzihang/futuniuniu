# Design QA

- Source visual truth: /Users/dingzihang/.codex/generated_images/019f7529-2fd7-7f60-b3a2-3ea17add287b/exec-795830f5-ac19-42cf-a105-ac68f10d2207.png
- Implementation screenshot: /tmp/futuniuniu-overview-qa.png
- Viewport: 1280 × 720 desktop
- State: 总览，实时行情已加载

## Comparison history

### Pass 1

- [P2] 顶栏“修改持仓”和“刷新”在 1280px 宽度下发生中文换行。
  - Fix: 将顶栏操作区固定为不换行，并在中等桌面宽度隐藏更新时间文本。

### Pass 2

- Fonts and typography: source与实现均使用高对比标题、紧凑导航与人民币主指标；实现使用 Noto Sans SC 保持中文数值可读性。
- Spacing and layout rhythm: 保持 72px 顶栏、左侧三指标卡 / 右侧行动卡、左大趋势图 / 右侧贡献栏的同一桌面布局。
- Colors and visual tokens: 白色表面、浅蓝灰页面、蓝色主导航、红绿盈亏语义和细描边均与设计稿一致。
- Image quality and asset fidelity: 使用项目已有的 pig-logo.png，没有以临时图形替代品牌资产。
- Copy and content: 顶部导航、总览标题、三项核心资产指标、行动入口、趋势与市场贡献均采用视觉稿的信息层级；数值替换为真实持仓、行情和汇率计算结果。
- Responsive: 已在 390 × 844 验证；导航可横向滚动，持仓和行情模块单列；表格保留横向滚动以防内容截断。
- Primary interactions verified: 五个 Tab 均能切换；市场筛选、实时刷新、交易记录、观察池加入和交易 JSON 备份均已接线。
- Console: 无应用脚本错误。

### Pass 3

- [P1] 累计收益率分母只包含当前持仓成本，但累计盈亏包含已卖出记录；首项“总资产”也会让人误以为已纳入现金。
  - Fix: 累计收益率改为使用全部已投入成本；首项改为“持仓市值（人民币）”，并明确“仅含当前持仓”。
- [P1] 趋势图绘制的是持仓市值，却标作“组合累计盈亏”。
  - Fix: 图表改为每日持仓盈亏序列，蓝线改为 0 轴“盈亏平衡线”；最大回撤继续基于组合市值序列计算。
- Interaction regression: 已复测持仓行动的 A 股筛选、机会雷达加入观察、交易表单展开、复盘切换。
- Production verification: 已在 https://alixjd.com/ 使用最新持仓、行情和汇率加载总览；无相关控制台 error/warn。

## Follow-up polish

- [P3] 如需更接近视觉稿中的装饰图标，可在下一轮补充统一图标资源；当前不影响核心决策和交易工作流。

final result: passed
