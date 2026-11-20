# OVEM · 光谷效应

AI 营销操作系统 · 虚拟品牌全案作品集（**v2.0 配置中台版**）

OVEM（Optics Valley Effect）是一个虚构的消费级生活机器人品牌。本项目把一次品牌全案做成**可配置的内容产线**：17 页营销系统前台 + 一套 schema 驱动的配置中台，覆盖 20 款产品、8 个内容渠道、160 个基础物料位与 480 个 A/B 变体。

---

## 一、这个版本做了什么

v1.0 的问题是「看起来能配，其实配了个寂寞」：前台和后台各存一份产品数据，后台改一半、前台另一半不生效；两份主站 HTML 靠手工同步；页面下线只删导航项、内容还留在 DOM；所有「生成 / 质检」都是写死的演示动画。

v2.0 只做一件事：**把品牌数据收敛成一个可校验、可追溯、可回滚的单一数据源**（方案 A｜配置中台化）。前台所有业务数字与页面结构都从这一个文件派生，后台所有编辑、校验、发布都围绕它进行。

| v1.0 的病灶 | v2.0 的处理 |
| --- | --- |
| `index.html` 与 `OVEM_AI营销系统.html` 是两份 190KB 同哈希副本，靠手工同步 | 只保留 `index.html` 一份真身；`OVEM_AI营销系统.html` 降级为 1.1KB 跳转桩，带 hash 透传 |
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
├─ index.html              # 前台 17 页主站（唯一真身，179KB）
├─ OVEM配置后台.html        # 配置中台（schema 驱动表单 / 校验 / diff / 快照 / 发布）
├─ OVEM_AI营销系统.html      # 兼容跳转桩（1.1KB，重定向到 index.html 并透传 hash）
├─ data/
│  ├─ ovem-data.js         # 单一数据源（meta + brand/hero/metrics/goals/channels/products/scenes）
│  └─ ovem-schema.js       # 字段契约（7 个配置分区 / 17 页定义 / 5 条跨字段规则 / 每字段 consumers）
├─ tools/                  # 一次性迁移与自检脚本（保留作数据来源证据，可重跑）
│  ├─ migrate-v1-data.js   # 从 v1 HTML 内联 const 块抽取数据 → data/ovem-data.js
│  ├─ refactor-v2.js       # 按标记位把 v1 前台改造成 v2 数据层
│  └─ check-syntax.js      # 两个 HTML 的内联脚本语法自检
├─ assets/                 # 品牌视觉、产品设定图、渠道物料、宣传片
└─ _backup/ _preview/ _tools/  # 本地工作目录（已 gitignore，不参与部署）
```

---

## 三、配置闭环（五分钟跑通）

1. **打开后台** `OVEM配置后台.html`，左侧 11 个分区：概览 / 品牌与标识 / 封面文案 / 封面指标 / 年度目标 / 产品矩阵 / 渠道矩阵 / 页面与导航 / 版本信息 / 版本与快照 / 变更与发布。
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
- 本地直接双击 `index.html` 或 `OVEM配置后台.html` 均可运行，无需任何依赖。

---

## 七、v3.0 · Agent 工作台改造（进行中）

完整路线见仓库根目录 `../04_Agent工作台_方案A执行路线图.md`（六阶段 / 12 工作日 / 37 条验收用例）。

**当前进度：S0 基线冻结与契约设计 已完成（A0 5/5 通过）**

| 项 | 值 |
|---|---|
| 基线 commit | `c7290f9` |
| 基线 tag | `v3.0-s0` |
| 阶段报告 | `docs/v3/reports/S0.json` |
| 验收证据 | `docs/v3/evidence/S0_A0-05_idb.png` |

**自检方式（S0）**

```bash
# 静态核对：v1 冻结副本哈希、前台脚本可解析、17 页齐全、数据与契约版本
node tools/verify-baseline.js --idb pass --idb-note "stores=6/6 · indexes=18/18"

# 运行态前置确认：file:// 下 IndexedDB 建库（6 store / 18 索引）
# 浏览器打开：tools/selftest.html?suite=A0
```

**已冻结的边界**

- 17 页成果层（`index.html`）版式与内容不动，壳页不计入页数。
- 业务数据 `data/ovem-data.js` 保持 v2.0.x，不随 Agent 配置升版。
- 运行态（missions / runs / traces / artifacts / reviews / evals）将落 IndexedDB，不进 git。

**后续阶段**：S1 Agent 配置层 → S2 运行时与工具层 → S3 工作台壳 → S4 成果层联动 → S5 评测与演示编排。

