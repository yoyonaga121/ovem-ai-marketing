# OVEM B3 本地服务

> Node 22 + SQLite（`node:sqlite`），零第三方依赖。默认只监听 `127.0.0.1`，用于本地演示与面试现场。

## 启动

```powershell
cd 'D:\证件照\我的作品集\AI营销系统搭建\OVEM站点_v2.0'
node server/server.js
```

打开 <http://127.0.0.1:4318/login.html>。

首次启动会自动建库、建表、写入两个演示租户与账号。数据库文件为 `server/ovem.db`，不进入 git。

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
| `ARK_TEXT_MODEL` | 空 | 文本模型 endpoint id |
| `ARK_IMAGE_MODEL` | 空 | 图片模型 endpoint id |
| `ARK_VISION_MODEL` | 空 | 视觉质检模型 endpoint id |
| `OVEM_SEED_PASSWORD` | `ovem-demo-2026` | 种子账号密码 |

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
- `server/`、`server/ovem.db`、`server/.secret`、`published/` 不进入 git。
