# OVEM B3 · 7 分钟面试演示脚本

> 目标：用一条可运行、可追踪、可管理的链路，把 A 阶段的“能跑通”升级为 B3 的“能交给不同租户、不同角色、真实模型去跑，并且发布前必须有人签字”。

## 演示前 2 分钟检查

```powershell
cd 'D:\证件照\我的作品集\AI营销系统搭建\OVEM站点_v2.0'
node server/server.js
```

- 打开 <http://127.0.0.1:4318/login.html>，用 `owner@ovem.local` / `ovem-demo-2026` 登录。
- 确认「05 配置中台」Provider 已启用，文本 / 图片模型有值；无真实 key 时用本地 fake Ark（见 README）。
- 浏览器建议 1440×900，提前打开 `workbench.html#/runs`，避免现场输入长 URL。
- 备用证据：`docs/v3/evidence/B3_*.png`、`B4_*.png`、`docs/v3/reports/B3.json`。

## 0:00–0:45 · 开场：为什么从 A 到 B3

一句话：A 证明“这条链路跑得通、算得清、评得了”；B3 增加“租户、角色、真实 provider、发布审批、审计”。

打开工作台，指出左侧 6 个视图：工作台 / 执行记录 / 17 页成果 / 评测 / 配置中台 / 架构说明。

## 0:45–1:45 · 17 页收进单一工作台（B1）

进入「03 成果视图」：

- 顶部 `17/17`，6 组筛选：成果 5、知识 1、策略 4、执行 4、复盘 1、文档 2。
- 点 P3「产品矩阵」，右侧 iframe 直接显示 `index.html#p3`，不新开窗口。
- 指出 `IFRAME · READY`、页面标题 / 描述 / P 编号，以及「刷新 / 新窗口 / 失败回退」。
- 一句话：正文仍是 `index.html` 单一源，工作台只换容器，没有复制第二套 17 页。

## 1:45–2:30 · 多租户与 RBAC（B2）

进入「05 配置中台」：

- 顶部会话徽标：`OVEM Owner`、`光谷效应 · 演示租户`、角色 `OWNER`、租户数 2。
- 切到「北辰品牌 · 客户租户」：运行记录 / 成员 / Provider 都变为该租户数据；切回。
- 讲角色：owner / admin / editor / viewer，rank viewer=1、editor=2、admin=3、owner=4。
- 审计：谁在何时切租户、建 Job、审批发布，都落 `audit_logs`。

可选 15 秒：用 `viewer@ovem.local` 登录，点「运行 Mission」应被 403 / 按钮禁用，证明不是前端隐藏。

## 2:30–4:00 · 真实 provider Job（B3）

回到「01 工作台」：

1. 选预设 C「预算闸门」，点 `live`，点「运行 Mission」。
2. Job 进入 `queued → running`，顶部出现 `live · <text-model>`，run 卡显示 `live · ark`。
3. 约 3 秒后预算闸门弹出：`101% / 预算 ¥0.10 / 已花 ¥0.1011 / 阈值 80%`。
4. 点「批准并继续」，Job 继续到 `review`；trace 32 条，7 step / 9 call / 9 result。
5. 滚动 Trace：
   - `prompt.compile` 的 meta 带文本模型名；
   - `image.gen` 带图片模型名；
   - `qa.check` 带 `heuristic:pixel`，展开原始 JSON 可看到主色占比 `#0B1F3A 100%`；
   - artifacts 三张真实图片缩略图，URL 为 `/published/runs/R-xxxx/...`。
6. 一句话：不是“假进度条”，每一步都有 tool.call / tool.result、模型名、token、成本、图片落盘路径。

如果现场网络不可用：把 Provider 切到 fake Ark 的 `/down`，重跑一条 live，展示 `degraded` 标记和“失败不中断、但必须标出来”；再切回 normal。备用截图 `B3_degraded.png`。

## 4:00–5:15 · 发布审批与审计（B4）

进入「02 执行记录」：

1. 在「发布审批 · B4」下拉选一条 `review` run（如 R-0012），填写备注，点「提交发布」。
2. 生成 `pending v1`；指出只有 admin / owner 出现「批准 / 驳回」按钮。
3. 点「批准」，状态变 `approved`，出现「打开包 ↗」和「回滚」。
4. 点「打开包」，浏览器打开 `published/<tenantSlug>/<runId>/v1/index.html`。
5. 点该版本「审计」，底部出现 `AUDIT TIMELINE`：`job.create → publication.request → publication.approve`，含 actor、时间、hash、note。
6. 讲驳回：editor 提交后不能自批（403）；admin 驳回会保留原因、run 回 `failed`、不落包。备用截图 `B4_audit.png`。
7. 讲版本：同一 run 二次发布生成 `v2`，不覆盖 `v1`；已批准版本可回滚。

## 5:15–6:15 · 验收证据（B5）

打开 `docs/v3/reports/B3.json`：

- 46/46 通过：B2 登录 / 租户 / 14 表 / RBAC；B3 live / 模型字段 / 真实图片 / 像素 QA / 成本对账 / 预算闸门 approve+reject / 降级；B4 提交 / editor 403 / 批准 / v1-v2 / 驳回原因 / 409 / 审计 / 回滚。
- `B3-e2e.json` 10/10：health、登录、17 页 schema、runs、publications、版本包 200、未登录 401。
- 代码入口：`server/ark.js`、`server/live-tools.js`、`server/publish.js`、`runtime/ovem-ui.js`、`runtime/ovem-publish.js`。

## 6:15–7:00 · 诚实边界与下一步

- 已做：B0 路线图、B1 单壳、B2 多租户/RBAC、B3 live adapter + Job + 图片/QA/降级、B4 发布审批/版本包/审计、B5 验收/证据。
- 未做：真实火山方舟 key 与 endpoint id 尚未在仓库配置；当前 live 证据来自本地 fake Ark 契约测试。填入 key 后可按同一 UI 重跑真实 Job。
- 不在 B3：云部署、跨组织协作、计费、开放 API（原 C 阶段）。
- 收尾一句：这套系统的价值不在“生成了几张图”，而在“每一步可追踪、每个租户隔离、每次发布有人签字”。

## 现场故障兜底

| 现象 | 处理 |
|---|---|
| live 按钮灰色 | 05 配置中台检查 key / 文本模型 / 图片模型 / 启用；或先用 mock |
| Job 一直 running | 看 `server.err`；确认 fake Ark 4399 或真实 Ark 网络 |
| 预算闸门不弹 | 预设必须选 C，预算 ¥0.10；或直接看 `B3_gate.png` |
| 发布按钮不出现 | 当前 run 必须是 `review` 且来自服务端 Job（有 jobId） |
| 审计为空 | 点版本行「审计」；或调 `GET /api/audit?runId=...` |
| 数据被测试污染 | `npm run seed` 重建演示库（会清空已有发布记录，演示前先备份） |
