# OVEM · 光谷效应

AI 营销操作系统 · 虚拟品牌全案作品集（**v3.0 Agent 工作台**）

OVEM（Optics Valley Effect）是一个虚构的消费级生活机器人品牌。本项目把一次品牌全案做成**可配置的内容产线**：17 页营销系统前台 + 一套 schema 驱动的配置中台，覆盖 20 款产品、8 个内容渠道、160 个基础物料位与 480 个 A/B 变体。

---

## 一、这个版本做了什么

v1.0 的问题是「看起来能配，其实配了个寂寞」：前台和后台各存一份产品数据，后台改一半、前台另一半不生效；两份主站 HTML 靠手工同步；页面下线只删导航项、内容还留在 DOM；所有「生成 / 质检」都是写死的演示动画。

v2.0 只做一件事：**把品牌数据收敛成一个可校验、可追溯、可回滚的单一数据源**（方案 A｜配置中台化）。前台所有业务数字与页面结构都从这一个文件派生，后台所有编辑、校验、发布都围绕它进行。

| v1.0 的病灶 | v2.0 的处理 |
| --- | --- |
| `index.html` 与 `OVEM_AI营销系统.html` 是两份 190KB 同哈希副本，靠手工同步 | 只保留 `index.html` 一份真身；`OVEM_AI营销系统.html` 降级为兼容跳转桩（v3.0 起跳 `workbench.html`），带 hash 透传 |
| 产品数据双源（HTML 内联 13 字段 vs `ovem-config.js` 8 字段），按交集合并 | 删除 `ovem-config.js`；前台与后台都只读 `data/ovem-data.js` |
| 后台改产品一半字段不生效 | 字段契约 `data/ovem-schema.js` 定义每字段的类型、必填、上限、受影响页面 |
| 页面下线只 `splice` 导航项，section 仍在 DOM | 下线页面同时从导航移除并从 DOM 摘除，路由访问会 toast 提示并回落到 P0 |
| 「生成 / 质检」全部是 `setInterval` 假进度 + 预生成图 + 公式假数 | 本版不动演示逻辑，但已把假数据与真数据彻底隔离，并在文档中标明（属方案 B 范围） |
| 配置无校验、无版本、无回滚 | 必填校验 256 项、跨字段规则 5 条、版本快照最多 20 份、发布前逐字段 diff 与影响面统计 |

> 详细的缺陷取证、改造清单、验证记录与后续路线，见 **[`升级说明_v2.0.md`](升级说明_v2.0.md)**。

---

## 二、目录

```
OVEM站点_v2.0/
├─ workbench.html           # v3.0 统一入口：6 组导航 + Mission / Plan / Trace / Artifacts / 成本卡 + 闸门
├─ index.html               # 前台 17 页成果层（唯一真身，版式与内容在 v3.0 中冻结）
├─ OVEM配置后台.html         # 配置中台（schema 驱动表单 / 校验 / diff / 快照 / 发布）
├─ OVEM_AI营销系统.html      # 兼容跳转桩（v3.0 起指向 workbench.html 并透传 hash）
├─ data/
│  ├─ ovem-data.js         # 单一数据源（meta + brand/hero/metrics/goals/channels/products/scenes）
│  ├─ ovem-schema.js       # 字段契约（7 个配置分区 / 17 页定义 / 5 条跨字段规则 / 每字段 consumers）
│  ├─ ovem-agent.js        # v3.0：Agent 配置（3 Agent / 9 工具 / 4 Prompt / 6 护栏 / 17 页血缘）
│  └─ ovem-agent.schema.js # v3.0：Agent 字段契约 + R1–R7 七条跨字段规则
├─ runtime/                # v3.0：零 DOM 运行时 + 壳层渲染 + 成果层联动
│  ├─ ovem-trace.js        # 事件总线（11 类事件 / 单调 seq / 成本累加）
│  ├─ ovem-store.js        # IndexedDB 封装（ovem-os-v3 v1 · 6 store / 18 索引）
│  ├─ ovem-tools.js        # 9 工具 mock（可注入延迟、单价与失败）
│  ├─ ovem-executor.js     # 计划 / 执行 / 裁决 / 重试 / 预算闸门 / 人工审批回调
│  ├─ ovem-ui.js           # 工作台壳层：渲染 Plan / Trace / Artifacts、闸门弹窗、A3 自检
│  ├─ ovem-lineage.js      # 成果层：17 页血缘条 / P0 run 摘要 / P4 产物 / P7 渠道状态 / A4 自检
│  └─ selftest.js          # A2 七条运行时用例
├─ docs/v3/                # 阶段报告（reports/）与验收证据（evidence/）+ 三张架构图
├─ tools/                  # 迁移、自检与验收脚本（保留作证据，可重跑）
│  ├─ migrate-v1-data.js   # 从 v1 HTML 内联 const 块抽取数据 → data/ovem-data.js
│  ├─ refactor-v2.js       # 按标记位把 v1 前台改造成 v2 数据层
│  ├─ check-syntax.js      # 两个 HTML 的内联脚本语法自检
│  ├─ verify-baseline.js   # S0：基线冻结核对（A0 套件）
│  ├─ verify-agent-config.js # S1：Agent 配置核对（A1 套件 + R1–R7 矩阵）
│  ├─ verify-runtime.js    # S2：运行时静态核对 + 浏览器 A2 结果合并
│  ├─ verify-workbench.js  # S3：壳层静态核对 + 浏览器 A3 结果合并
│  ├─ verify-lineage.js    # S4：血缘静态核对 + A4/后台结果合并
│  └─ selftest.html        # 浏览器自检台（A0 基线 / A2 运行时）
├─ assets/                 # 品牌视觉、产品设定图、渠道物料、宣传片
└─ _backup/ _preview/ _tools/  # 本地工作目录（已 gitignore，不参与部署）
```

---

## 三、配置闭环（五分钟跑通）

1. **打开后台** `OVEM配置后台.html`，左侧 12 个分区：概览 / 品牌与标识 / 封面文案 / 封面指标 / 年度目标 / 产品矩阵 / 渠道矩阵 / 页面与导航 / **Agent 管理** / 版本信息 / 版本与快照 / 变更与发布。
2. **改一个字段**，顶栏立刻出现 `待发布 N 项 · 影响 M 页` 徽标；概览页给出逐字段 diff（旧值 → 新值 + 影响页面）。
3. **存草稿**（`Ctrl+S`，写入 `localStorage.ovem_data_draft`）→ 前台刷新即可看到「草稿预览」浮条与改动效果，**不动正式数据**。
4. **发布**：填版本号与变更说明 → 点击发布 → 自动下载 `ovem-data.js`（内含 `meta.version` 与新 `changelog` 条目）。
5. **覆盖** `data/ovem-data.js` → 前台刷新 → 改动正式生效，版本号回到「数据 v2.0.x」。
6. 中途想反悔：进「版本与快照」一键回滚到任意历史快照（最多保留 20 份）。

---

## 四、数据结构约定

- `window.OVEM_DATA` 是唯一入口。前台通过 `PRODUCTS / CHANNELS / CHANNEL_DATA / HOOKS / GOALS / SCENES` 等派生常量消费，派生时按 `enabled !== false` 过滤。
- `window.OVEM_SCHEMA` 描述后台怎么渲染表单、怎么校验、改动会波及哪些页面（`consumers`），以及 5 条跨字段规则：
  - `products.enabled`：至少保留 1 款启用产品
  - `channels.enabled`：至少保留 1 个启用渠道
  - `pages.p0`：P0 系统总览不可下线（唯一入口）
  - `products.unique`：产品 ID 不可重复
  - `channels.unique`：渠道 ID 不可重复
- 草稿包只在 `pack.meta.mode === "draft"` 时才覆盖正式数据，避免把正式导出文件误读成草稿。

---

## 五、已知边界（v2.0 仍未具备）

这些不是 bug，是范围外，已列入下一阶段：

1. 前台「AI 内容工厂 / 质检」仍是**演示态**：`setInterval` 进度、6 张预生成图、公式算出的质检分。方案 B 会替换为 Job 模型 + 真 Prompt 编译 + 可复现的质检口径。
2. 投放页预算与实际投放模型尚未联动重算。属方案 D。
3. 无服务端：配置存 `localStorage`，多人协作 / 审计日志 / RBAC / 发布状态机需要方案 C。
4. 本地 `file://` 与 GitHub Pages 属不同源，`localStorage` 不互通；跨端演示请统一在同一环境下操作。

---

## 六、版本与部署

- **v1.0（线上现存）**：https://yoyonaga121.github.io/ovem-ai-marketing/ ，对应冻结副本 `../OVEM站点_v1.0_冻结_20261120/`（未再改动）。
- **v2.0（本目录）**：静态托管即可，无需构建、无需服务端。若要上线，把本目录文件覆盖到 Pages 仓库根目录后推送 `main` 分支即可。
- 本地直接双击 `workbench.html`、`index.html` 或 `OVEM配置后台.html` 均可运行，无需任何依赖；旧入口 `OVEM_AI营销系统.html` 会自动跳到工作台。

---

## 七、v3.0 · Agent 工作台改造（进行中）

完整路线见仓库根目录 `../04_Agent工作台_方案A执行路线图.md`（六阶段 / 12 工作日 / 37 条验收用例）。

**当前进度：S0 基线冻结（5/5）、S1 Agent 配置层（6/6 + A1-07）、S2 运行时与工具层（7/7 + 静态 8/8）、S3 工作台壳层（8/8 + 静态 9/9）、S4 成果层联动（5/5 + 静态 9/9）已完成**

| 阶段 | 内容 | commit / tag | 报告 | 证据 |
|---|---|---|---|---|
| S0 | 基线冻结与契约设计 | `c7290f9`（S0 完成点 `5dc38d8`）/ `v3.0-s0` | `docs/v3/reports/S0.json` | `docs/v3/evidence/S0_A0-05_idb.png` |
| S1 | Agent 配置层（第 12 分区） | `0d31779` / `v3.0-s1` | `docs/v3/reports/S1.json` | `docs/v3/evidence/S1_A1-07_agent.png` |
| S2 | 运行时与工具层（5 模块 + A2 自检） | `d1383d8` / `v3.0-s2` | `docs/v3/reports/S2.json` | `docs/v3/evidence/S2_A2-04_run.png` |
| S3 | 工作台壳层（6 视图 / 3 预设 / 闸门 / A3 自检） | `88c6ddb` / `v3.0-s3` | `docs/v3/reports/S3.json` + `S3.browser.json` | `docs/v3/evidence/S3_*.png`（8 张） |
| S4 | 成果层联动（17 页血缘 / P4 / P7 / 后台运行记录） | 见 tag `v3.0-s4` | `docs/v3/reports/S4.json` + `S4.browser.json` | `docs/v3/evidence/S4_*.png`（5 张） |

**Agent 配置（S1 交付）**

- `data/ovem-agent.js`（v3.0.0）：3 个 Agent、9 个工具、4 条 Prompt、6 项护栏、17 页血缘；Prompt 的 `hash` 由正文 SHA-256 实算。
- `data/ovem-agent.schema.js`：字段契约 + R1–R7 七条跨字段规则，与数据层 5 条规则相互独立。
- 后台第 12 分区「Agent 管理」：角色卡、工具表、Prompt 表、护栏、血缘表、规则矩阵、逐字段 diff、快照与「发布并导出 ovem-agent.js」。

**自检方式**

```bash
# S0：静态核对（v1 冻结副本哈希、前台脚本可解析、17 页齐全、数据与契约版本）
node tools/verify-baseline.js --idb pass --idb-note "stores=6/6 · indexes=18/18"

# S1：Agent 配置核对（A1-01…06 + R1–R7 规则矩阵）
node tools/verify-agent-config.js --browser pass --browser-note "agents=3 / tools=9 / prompts=4"

# S2：运行时核对（静态 8 项 + 浏览器 A2 7/7 合并）
node tools/verify-runtime.js

# S3：工作台壳层核对（静态 9 项 + 浏览器 A3 8/8 合并）
node tools/verify-workbench.js

# S4：成果层联动核对（静态 9 项 + A4 5/5 + 后台运行记录对照）
node tools/verify-lineage.js

# 浏览器：tools/selftest.html?suite=A0（基线建库）；?suite=A2（9 工具 / 7 步 / 重试 / 闸门 / 对账）
# 浏览器：workbench.html?selftest=1（A3 八条；右下角徽标可点击导出 S3.browser.json）
# 浏览器：index.html?selftest=1（A4 五条；右下角徽标可点击导出 S4.browser.json）
```

**运行态口径（S2 落地）**

- 一条 Mission = **7 个计划步骤 / 9 次工具调用**，状态只能由事件迁移（七态白名单）。
- 成本：`costCny = tokens/1000 × 0.004 + images × 0.03`，mock 单任务约 **¥0.1168**，K5 上限 ¥0.15。
- 预算闸门按任务 `constraints.budgetCny` 计算；演示用 ¥0.10 才能在 mock 量级触发 `hitl.requested`（¥200 是业务预算口径）。
- 自检页的 `speed` 是等待缩放系数（>1 加速），只改实际等待，不改契约 `delayMs`。

**已冻结的边界**

- 17 页成果层（`index.html`）版式与内容不动，壳页不计入页数。
- 业务数据 `data/ovem-data.js` 保持 v2.0.x，不随 Agent 配置升版。
- 运行态（missions / runs / traces / artifacts / reviews / evals）将落 IndexedDB，不进 git。

**S3 工作台（已交付）**

- 入口 `workbench.html`：左侧 6 组导航（工作台 / 执行 / 成果视图 / 评测 / 配置中台 / 架构说明），主区四块（Mission / Plan / Trace / Artifacts）+ 顶部成本卡。
- 3 条预设对应三种可讲链路：A 正常 7 步、B 注入质检失败后重试、C 预算 ¥0.10 触发 108% 闸门并由人决定批准 / 驳回。
- 状态只由事件迁移：`run.finished` 之后 Plan 才落终态；批准走 `hitl.approve → running`，驳回走 `hitl.reject → failed`，后续步骤标 `BLOCKED`。
- `mock / replay` 可切换，provider 标签与工具延迟同步变化；`?selftest=1` 跑 A3 八条，结果写入 `window.__WB_SELFTEST__`，右下角徽标可点击导出 JSON。
- 验收：A3 **8/8**、静态 **9/9**；正常 ¥0.1168、重试 ¥0.2136、闸门批准后 ¥0.1168；证据 8 张见 `docs/v3/evidence/S3_*.png`。

**S4 成果层（已交付）**

- `runtime/ovem-lineage.js` 只读 `ovem-os-v3`：17 页各注入一条血缘条（工具链 + 最新 run + 状态），每页有且仅有一条，重复渲染先删后插。
- P0 增「最近一次 Agent 运行」摘要：runId、时间、7 步 / 9 调用、成本、产物数、耗时；P4 增本次 run 三张产物卡（`data-run-id` 与最新 run 一致）；P7 增渠道状态条（`review → 待审`、`done → 在投`、`retired → 退役`）。
- 后台「Agent 管理 · 运行记录」只读 IndexedDB：条数、runId、状态、步骤 / 调用、成本、开始时间，与前台 / store 三方对齐。
- 验收：A4 **5/5**、静态 **9/9**；最新 run `R-0034`（review / ¥0.1168 / 3 artifacts）；后台 34 条、`console error=0`；截图 5 张见 `docs/v3/evidence/S4_*.png`。

**后续阶段**：S5 评测与演示编排。



