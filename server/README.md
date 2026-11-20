# OVEM B3 本地服务

> Node 22 + SQLite（`node:sqlite`），零第三方依赖。默认只监听 `127.0.0.1`，用于本地演示与面试现场。

## 启动

```powershell
cd 'D:\证件照\我的作品集\AI营销系统搭建\OVEM站点_v2.0'
node server/server.js
```

打开 <http://127.0.0.1:4318/login.html>。

首次启动会自动建库、建表、写入两个演示租户与账号。数据库文件为 `server/ovem.db`，不进入 git。

演示一键启动（会自动复用已占用端口，不修改数据库）：

```powershell
cd 'D:\证件照\我的作品集\AI营销系统搭建\OVEM站点_v2.0'
.\tools\demo-start.ps1
```

## 三种运行模式

| 模式 | 是否需要网络 | 说明 |
|---|---|---|
| `mock` | 否 | A 阶段确定性工具，30 条 trace，3 个物料，默认演示 |
| `replay` | 否 | 复用 A 事件与延迟倍率，用于复盘 |
| `live` | 需要 provider | 服务端 Job Runner 调火山方舟 / 豆包；图片下载到 `published/runs/<runId>/`，失败自动降级并在 trace 标 `degraded` |

`live` 需要先在「05 配置中台」保存 Provider：base URL、API key、文本模型、图片模型；视觉模型可留空（留空时 QA 走 `heuristic:pixel` 本地像素分析）。

## 真实 provider 配置

在 UI 中填：

| 字段 | 火山方舟示例 |
|---|---|
| Base URL | `https://ark.cn-beijing.volces.com/api/v3` |
| API Key | 控制台创建的 key（只存 AES-256-GCM 密文，前端只回掩码） |
| 文本模型 | 文本 endpoint id 或模型名，如 `doubao-seed-...` |
| 图片模型 | 图片 endpoint id 或模型名，如 `doubao-seedream-...` |
| 视觉模型 | 可选；留空则 QA 用本地像素启发式 |

也可用环境变量兜底：`ARK_BASE_URL`、`ARK_API_KEY`、`ARK_TEXT_MODEL`、`ARK_IMAGE_MODEL`、`ARK_VISION_MODEL`；UI 配置优先。

> 当前仓库不包含真实 key。`live` 适配器已用本地 fake Ark 验证契约；真实火山方舟调用需填入账号实际 key 与 endpoint id。

## 本地 fake Ark（契约测试）

```powershell
# 终端 1
$env:FAKE_ARK_PORT='4399'; node tools/fake-ark.js

# 终端 2
node server/server.js
```

Provider 配 `http://127.0.0.1:4399`，key 任意非空，文本 / 图片模型任意名字即可。

内置故障路径：

- `http://127.0.0.1:4399/retry`：首次 POST 429，验证一次重试。
- `http://127.0.0.1:4399/down`：全部 503，验证降级与 `degraded` 标记。

## 发布审批（B4）

1. `editor` 以上角色在「执行记录」选择 `review` run，提交发布，生成 `pending`。
2. `admin` / `owner` 审批。`editor` 不能自批（API 返回 403）。
3. 批准后生成 `published/<tenantSlug>/<runId>/<version>/index.html` + `manifest.json` + `assets/`，manifest 含每文件 sha256 与 manifestHash。
4. 驳回会保留原因，run 回 `failed`，不生成版本包；已批准版本可回滚。
5. 发布 / 驳回 / 回滚都写 `audit_logs`，可按 `runId` 拉时间线。

## 验证

```powershell
npm run verify   # 自起 fake Ark + 临时 SQLite，跑 B2/B3/B4 46 条断言
npm run e2e      # 对当前 4318 服务做只读 smoke
```

报告输出：`docs/v3/reports/B3.json`、`docs/v3/reports/B3-e2e.json`。

## 演示账号

| 租户 | 角色 | 账号 | 密码 |
|---|---|---|---|
| 光谷效应 · 演示租户 | owner | `owner@ovem.local` | `ovem-demo-2026` |
| 光谷效应 · 演示租户 | admin | `admin@ovem.local` | `ovem-demo-2026` |
| 光谷效应 · 演示租户 | editor | `editor@ovem.local` | `ovem-demo-2026` |
| 光谷效应 · 演示租户 | viewer | `viewer@ovem.local` | `ovem-demo-2026` |
| 北辰品牌 · 客户租户 | owner | `owner@beichen.local` | `ovem-demo-2026` |
| 北辰品牌 · 客户租户 | editor | `editor@beichen.local` | `ovem-demo-2026` |

> 可用 `OVEM_SEED_PASSWORD` 覆盖种子密码。生产环境不要使用这些默认账号。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OVEM_PORT` | `4318` | 监听端口 |
| `OVEM_HOST` | `127.0.0.1` | 监听地址 |
| `OVEM_DB` | `server/ovem.db` | SQLite 文件 |
| `OVEM_SECRET` | 自动生成 `server/.secret` | Provider key 加密密钥 |
| `ARK_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3` | 火山方舟 OpenAI 兼容 base |
| `ARK_API_KEY` | 空 | 服务端兜底 key；UI 配置优先 |
| `ARK_TEXT_MODEL` | 空 | 文本模型 / endpoint id |
| `ARK_IMAGE_MODEL` | 空 | 图片模型 / endpoint id |
| `ARK_VISION_MODEL` | 空 | 视觉质检模型 / endpoint id |
| `OVEM_SEED_PASSWORD` | `ovem-demo-2026` | 种子账号密码 |
| `FAKE_ARK_PORT` | `4399` | fake Ark 端口（仅测试） |

## 目录

| 路径 | 说明 |
|---|---|
| `published/runs/<runId>/` | live 原始图片，HTTP `/published/runs/...` |
| `published/<tenantSlug>/<runId>/<version>/` | 批准后的版本包 |
| `server/ovem.db` | SQLite（WAL），不入 git |
| `server/.secret` | AES key 文件，不入 git |

## 备份与恢复

```powershell
# 备份（建议在服务停止时执行）
Copy-Item server/ovem.db server/ovem.db.bak

# 恢复
Copy-Item server/ovem.db.bak server/ovem.db -Force
```

## 安全边界

- 仅监听本机，不对公网开放。
- 会话 Cookie 为 HttpOnly + SameSite=Lax；写请求需要 CSRF header。
- API key 使用 AES-256-GCM 加密后写入 SQLite；前端只看到掩码。
- `server/ovem.db`、`server/.secret`、`published/`、`*.log` / `*.err` 不进入 git。
- 默认种子密码只用于本地演示；公开演示前应改 `OVEM_SEED_PASSWORD`。
