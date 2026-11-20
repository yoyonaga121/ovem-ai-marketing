# OVEM B3 · 完整系统验收记录

> 日期：2026-11-20  
> 范围：B0 路线图 → B1 单壳 → B2 本地 Node + SQLite → B3 真实 provider 执行链 → B4 发布审批 / 版本包 / 审计 → B5 验收。  
> 结论：**本地可运行、可追踪、可管理的主链路已闭环；真实火山方舟调用因缺 key / endpoint id 尚未实跑，当前 live 证据来自本地 fake Ark 契约测试。**

## 1. 自动化结果

| 套件 | 结果 | 报告 |
|---|---|---|
| B3/B4 集成验收（自起 fake Ark + 临时 SQLite） | **46 / 46 pass** | `docs/v3/reports/B3.json` |
| 当前服务只读 smoke | **10 / 10 pass** | `docs/v3/reports/B3-e2e.json` |

覆盖断言：

- B2：owner 登录、默认租户、2 租户、14 表、viewer 无创建 Job 权限。
- B3：无 key live 422、key 掩码 / SQLite AES-GCM 密文、live Job `queued → review`、7 step / 9 call / 9 result、模型名与 token、3 张真实图片 URL、像素主色 QA、成本对账、预算闸门 approve / reject、provider 失败降级（3 条 degraded）。
- B4：review run 提交 `pending`、editor 审批 403、admin 批准生成版本包 + manifest hash、包 HTTP 200、17 页 `index.html` 未被改写、同 run 二次发布 v2 不覆盖 v1、驳回保留原因且 run `failed`、非 review run 409、审计 request / approve / rollback、回滚状态。

## 2. 当前演示数据

| Job / Run | 场景 | 结果 |
|---|---|---|
| `J-0010 / R-0010` | fake Ark normal live | review，30 traces，3 PNG，`fake-text / fake-image / heuristic:pixel`，cost 0.1018 |
| `J-0011 / R-0011` | fake Ark `/down` 降级 | review，30 traces，3 PNG，3 条 degraded，cost 0.1036 |
| `J-0012 / R-0012` | 前端 live C 闸门 → 批准 | review，32 traces，3 PNG，cost 0.1018；已提交并批准 v1 版本包 |
| `J-0013 / R-0013` | 前端 live C 闸门 → 驳回 | failed，21 traces，step5 FAIL / step6-7 BLOCKED，artifacts 0，cost 0.1011 |

版本包：

- `published/ovem-demo/R-0012/v1/index.html` + `manifest.json` + `assets/`
- `published/ovem-demo/R-0002/v1/`（mock SVG 占位，可打开）
- `published/ovem-demo/R-0004/v1` / `v2`（历史审批 / 回滚证据）

## 3. 证据截图

| 文件 | 内容 |
|---|---|
| `docs/v3/evidence/B3_17tabs.png` | 17/17 成果视图、6 组筛选、P3 iframe |
| `docs/v3/evidence/B3_run.png` | live run、7/7、9/9、trace 中 `fake-image / heuristic:pixel / fake-text` |
| `docs/v3/evidence/B3_gate.png` | 预算闸门 101%、¥0.1011 / ¥0.10 |
| `docs/v3/evidence/B3_reject.png` | 闸门驳回：FAILED、step5 FAIL、step6-7 BLOCKED、Artifacts 0 |
| `docs/v3/evidence/B3_degraded.png` | `/down` 降级：`down-text`、`mock-fallback`、`DEGRADED` |
| `docs/v3/evidence/B3_mobile.png` | 390×844，无横向页面溢出 |
| `docs/v3/evidence/B4_publish.png` | 发布 v1 批准、版本包 / 回滚 / 审计入口 |
| `docs/v3/evidence/B4_audit.png` | R-0004 8 条审计时间线 + 版本列表 |

## 4. 复现命令

```powershell
cd 'D:\证件照\我的作品集\AI营销系统搭建\OVEM站点_v2.0'
node server/server.js          # 终端 1
npm run verify                 # 自包含 46 条
npm run e2e                    # 对 4318 只读 smoke
```

真实 provider：在「05 配置中台」填 base URL / key / 文本模型 / 图片模型，保存后启用，再跑 live。视觉模型可留空，QA 会走本地像素启发式。

## 5. 已验证与未验证

**已验证**

- 本地 Node + SQLite 14 表、WAL、HttpOnly 会话、CSRF、四角色、租户隔离、审计。
- live adapter 的 OpenAI 兼容请求、429 / 5xx 一次重试、图片下载、PNG 解析、主色占比、失败降级、模型 / token / 成本 trace。
- 服务端 Job UI 轮询、gate 审批、真实图片缩略图、双源历史、服务端 run 回放。
- 发布审批、版本号、manifest / hash、版本包 HTTP、驳回、回滚、审计时间线。
- 桌面 1440×900 与移动 390×844 主视图无横向溢出。

**未验证 / 边界**

- 真实火山方舟 `ARK_API_KEY`、`ARK_BASE_URL`、`ARK_TEXT_MODEL`、`ARK_IMAGE_MODEL`、`ARK_VISION_MODEL` 未提供；真实模型响应、真实图片 URL、真实 429、真实视觉质检尚未发生。
- 当前证据只能证明 provider 契约和本地链路；不能对外声称“已调用真实豆包模型”。
- 云部署、跨组织协作、计费、开放 API 属于原 C 阶段，不在 B3 范围。

## 6. 结论口径

> B3 交付的是一套**可本地运行的 AI 营销生产工作台**：17 页成果收进单壳；每次执行有 Job / Run / Trace / Artifact / 成本；每个租户数据隔离、每个角色权限受控；live provider 可替换、失败可降级；发布必须经过 admin / owner 审批，版本包有 manifest 与审计。
>
> 真实火山方舟调用是最后一步配置项，不是代码缺口；填入账号 key 与 endpoint id 后，同一 UI / API / trace / 发布链即可复跑。
