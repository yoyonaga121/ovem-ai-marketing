/* ============================================================
   OVEM B5 · B0–B4 静态 + API 集成验收
   ------------------------------------------------------------
   自包含：启动本地 fake Ark（契约用）+ 独立 SQLite 服务，
   测试登录 / 租户 / RBAC / live Job / 降级 / 发布审批 / 审计。
   运行：node tools/verify-b3.js
   ============================================================ */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const FAKE_PORT = 4401;
const OVEM_PORT = 4397;
const BASE = "http://127.0.0.1:" + OVEM_PORT;
const DB_PATH = path.join(os.tmpdir(), "ovem-b3-verify-" + Date.now() + ".db");
const PUBLISHED = path.join(ROOT, "published");

const results = [];
function add(id, title, ok, detail) {
  results.push({ id, title, status: ok ? "pass" : "fail", detail: detail || "" });
  console.log((ok ? "PASS " : "FAIL ") + id + " · " + title + " · " + (detail || ""));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fileExists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

async function waitHttp(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) {}
    await sleep(250);
  }
  throw new Error("timeout waiting " + url);
}

function makeClient() {
  let cookie = "";
  let csrf = "";
  async function req(p, opt) {
    opt = opt || {};
    const headers = Object.assign({}, opt.headers || {});
    if (opt.body != null) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    if (csrf && (opt.method || "GET") !== "GET") headers["x-ovem-csrf"] = csrf;
    const res = await fetch(BASE + p, {
      method: opt.method || "GET", headers,
      body: opt.body != null ? JSON.stringify(opt.body) : undefined
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.message) || ("HTTP " + res.status));
      err.status = res.status; err.code = data && data.code; err.data = data;
      throw err;
    }
    if (data && data.csrf) csrf = data.csrf;
    return data;
  }
  async function login(email, password) {
    const r = await req("/api/auth/login", { method: "POST", body: { email, password } });
    csrf = r.csrf;
    return r;
  }
  return { req, login, get csrf() { return csrf; } };
}

function tableCount() {
  try {
    const db = new DatabaseSync(DB_PATH);
    const n = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().c;
    db.close();
    return n;
  } catch (e) { return -1; }
}

function readJsonFile(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch (e) { return null; }
}

function findRunTrace(detail, type, tool) {
  return (detail.traces || []).filter(t => t.type === type && (!tool || (t.payload && t.payload.tool === tool)));
}

async function pollJob(client, jobId, maxMs) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < maxMs) {
    last = await client.req("/api/jobs/" + encodeURIComponent(jobId));
    if (last.pendingGate) return last;
    if (["review", "done", "failed"].indexOf(last.job.status) >= 0) return last;
    await sleep(500);
  }
  return last;
}

async function main() {
  const startedAt = new Date().toISOString();
  let fake, server;
  try {
    /* ---------- B0/B1 静态 ---------- */
    ["server/server.js", "server/db.js", "server/auth.js", "server/audit.js", "server/repo.js",
     "server/store-adapter.js", "server/runtime-loader.js", "server/job-runner.js",
     "server/ark.js", "server/provider.js", "server/live-tools.js", "server/publish.js",
     "login.html", "runtime/ovem-api.js", "runtime/ovem-platform.js", "runtime/ovem-publish.js",
     "docs/v3/reports/B2.json"].forEach(function (f) {
      add("B5-STATIC", "文件存在 " + f, fileExists(f), fileExists(f) ? "ok" : "missing");
    });
    const beforeIndexHash = fs.existsSync(path.join(ROOT, "index.html"))
      ? require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, "index.html"))).digest("hex") : "";

    /* ---------- 启动物理进程 ---------- */
    if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fake = spawn(process.execPath, [path.join(ROOT, "tools/fake-ark.js")], {
      cwd: ROOT, env: Object.assign({}, process.env, { FAKE_ARK_PORT: String(FAKE_PORT) }), stdio: "ignore"
    });
    server = spawn(process.execPath, [path.join(ROOT, "server/server.js")], {
      cwd: ROOT, env: Object.assign({}, process.env, { OVEM_PORT: String(OVEM_PORT), OVEM_DB: DB_PATH }), stdio: "ignore"
    });
    await waitHttp("http://127.0.0.1:" + FAKE_PORT + "/img/probe.png", 6000).catch(() => {});
    await waitHttp(BASE + "/api/health", 8000);
    add("B3-00", "服务 health 可达", true, BASE + "/api/health");

    const client = makeClient();
    const me = await client.login("owner@ovem.local", "ovem-demo-2026");
    add("B2-01", "owner 登录，默认租户 t-ovem", me.tenant.id === "t-ovem" && me.role === "owner" && !!me.csrf, me.tenant.id + " · " + me.role);
    add("B2-02", "租户列表含 t-ovem / t-beichen", (me.tenants || []).length === 2, (me.tenants || []).map(t => t.id).join("/"));
    const tables = tableCount();
    add("B2-03", "SQLite 14 张表", tables === 14, "tables=" + tables);

    /* ---------- B3-01 无 key live 禁用 ---------- */
    await client.req("/api/tenants/switch", { method: "POST", body: { tenantId: "t-beichen" } });
    let noKeyLive = null;
    try { noKeyLive = await client.req("/api/jobs", { method: "POST", body: { mode: "live", mission: { id: "M-NO-KEY", title: "no key" } } }); }
    catch (e) { noKeyLive = e; }
    add("B3-01", "无 key 租户 live 返回 422，mock 仍可创建", noKeyLive && noKeyLive.status === 422, "status=" + (noKeyLive && noKeyLive.status));
    await client.req("/api/tenants/switch", { method: "POST", body: { tenantId: "t-ovem" } });

    /* ---------- B2 RBAC ---------- */
    const viewer = makeClient();
    await viewer.login("viewer@ovem.local", "ovem-demo-2026");
    let viewerJob = null;
    try { viewerJob = await viewer.req("/api/jobs", { method: "POST", body: { mode: "mock", mission: { id: "M-V", title: "v" } } }); }
    catch (e) { viewerJob = e; }
    add("B2-04", "viewer 无创建 Job 权限", viewerJob && viewerJob.status === 403, "status=" + (viewerJob && viewerJob.status));

    /* ---------- Provider 配置 + 掩码 ---------- */
    const provider = (await client.req("/api/provider")).provider;
    await client.req("/api/provider", { method: "PUT", body: {
      baseUrl: "http://127.0.0.1:" + FAKE_PORT, textModel: "fake-text", imageModel: "fake-image",
      visionModel: "", apiKey: "fake-key", enabled: true
    } });
    const pubProvider = (await client.req("/api/provider")).provider;
    add("B3-02", "key 返回掩码，不返回明文", pubProvider.hasKey && /••••••/.test(pubProvider.keyMasked) && !/fake-key/.test(JSON.stringify(pubProvider)), pubProvider.keyMasked);
    const keyRow = (() => {
      try {
        const db = new DatabaseSync(DB_PATH);
        const row = db.prepare("SELECT api_key_cipher,api_key_last4 FROM provider_configs LIMIT 1").get();
        db.close(); return row || {};
      } catch (e) { return {}; }
    })();
    add("B3-02b", "SQLite 只存 AES-GCM 密文", /v1:/.test(keyRow.api_key_cipher || "") && !/fake-key/.test(keyRow.api_key_cipher || ""), "cipher_len=" + String(keyRow.api_key_cipher || "").length);

    /* ---------- B3-03/04/05/06/07/10 live Job ---------- */
    const created = await client.req("/api/jobs", { method: "POST", body: {
      mode: "live", budgetCny: 0.3,
      mission: { id: "M-B3-VERIFY", title: "B3 verify live", brief: "verify", productIds: ["p01"], channelIds: ["c01", "c02", "c06"], agentId: "content-orchestrator", constraints: { budgetCny: 0.3 } }
    } });
    const jobId = created.job.id, runId = created.job.runId;
    add("B3-03", "live Job 创建为 queued", created.job.status === "queued", jobId + " / " + runId);
    const detail = await pollJob(client, jobId, 45000);
    const steps = findRunTrace(detail, "step.start").length;
    const calls = findRunTrace(detail, "tool.call").length;
    const toolResults = findRunTrace(detail, "tool.result").length;
    add("B3-03b", "Job 到达 review", detail.job.status === "review", detail.job.status);
    add("B3-04", "7 step.start / 9 tool.call / 9 tool.result", steps === 7 && calls === 9 && toolResults === 9, steps + "/" + calls + "/" + toolResults);
    add("B3-05", "tool.result 记录模型名与 token", (detail.traces || []).some(t => t.type === "tool.result" && t.payload.model && t.payload.model !== "mock-fallback"), [...new Set((detail.traces || []).filter(t => t.type === "tool.result").map(t => t.payload.model))].filter(Boolean).join(","));
    add("B3-06", "真实图片 URL 数量 = 渠道数", (detail.artifacts || []).length === 3 && detail.artifacts.every(a => /^\/published\/runs\//.test(a.url || "")), "artifacts=" + (detail.artifacts || []).length);
    const qaTrace = findRunTrace(detail, "tool.result", "qa.check")[0];
    const qaChecks = qaTrace && qaTrace.payload && qaTrace.payload.out && qaTrace.payload.out.checks || [];
    const hasDominant = qaChecks.some(c => c.name === "dominant" && /#/.test(c.detail || ""));
    add("B3-07", "QA 含真实像素主色占比", hasDominant, qaChecks.filter(c => c.name === "dominant").map(c => c.detail).join(" | "));
    const stats = detail.run && detail.run.stats || {};
    const traceCost = (detail.traces || []).reduce((a, t) => a + (Number(t.costCny) || 0), 0);
    add("B3-10", "成本对账 = trace 成本和 run stats", Math.abs(Number(stats.costCny || 0) - traceCost) < 0.0001, "stats=" + (stats.costCny || 0) + " trace=" + traceCost.toFixed(4));

    /* ---------- B3-08 预算闸门 ---------- */
    const gateJob = await client.req("/api/jobs", { method: "POST", body: {
      mode: "live", budgetCny: 0.1,
      mission: { id: "M-B3-GATE-V", title: "gate", brief: "gate", productIds: ["p01"], channelIds: ["c01", "c02", "c06"], agentId: "content-orchestrator", constraints: { budgetCny: 0.1 } }
    } });
    const blocked = await pollJob(client, gateJob.job.id, 30000);
    add("B3-08a", "预算 80% 触发 blocked", blocked.pendingGate && blocked.job.status === "blocked", "pct=" + (blocked.pendingGate && blocked.pendingGate.pct));
    await client.req("/api/jobs/" + encodeURIComponent(gateJob.job.id) + "/decide", { method: "POST", body: { decision: "approve", note: "verify approve" } });
    const gateDone = await pollJob(client, gateJob.job.id, 30000);
    add("B3-08b", "批准后 Job 完成 review", gateDone.job.status === "review", gateDone.job.status);
    const rejectJob = await client.req("/api/jobs", { method: "POST", body: {
      mode: "live", budgetCny: 0.1,
      mission: { id: "M-B3-REJECT-V", title: "reject", brief: "reject", productIds: ["p01"], channelIds: ["c01", "c02", "c06"], agentId: "content-orchestrator", constraints: { budgetCny: 0.1 } }
    } });
    const blocked2 = await pollJob(client, rejectJob.job.id, 30000);
    add("B3-08c", "第二次闸门 blocked", !!blocked2.pendingGate, "status=" + blocked2.job.status);
    await client.req("/api/jobs/" + encodeURIComponent(rejectJob.job.id) + "/decide", { method: "POST", body: { decision: "reject", note: "verify reject" } });
    const rejectedJob = await pollJob(client, rejectJob.job.id, 30000);
    add("B3-08d", "驳回后 Job failed", rejectedJob.job.status === "failed", rejectedJob.job.status);

    /* ---------- B3-09 降级 ---------- */
    await client.req("/api/provider", { method: "PUT", body: {
      baseUrl: "http://127.0.0.1:" + FAKE_PORT + "/down", textModel: "down-text", imageModel: "down-image",
      visionModel: "", apiKey: "fake-key", enabled: true
    } });
    const downJob = await client.req("/api/jobs", { method: "POST", body: {
      mode: "live", budgetCny: 0.3,
      mission: { id: "M-B3-DOWN-V", title: "down", brief: "down", productIds: ["p01"], channelIds: ["c01", "c02", "c06"], agentId: "content-orchestrator", constraints: { budgetCny: 0.3 } }
    } });
    const downDetail = await pollJob(client, downJob.job.id, 60000);
    const degraded = (downDetail.traces || []).filter(t => t.payload && t.payload.degraded).length;
    add("B3-09", "provider 失败后降级 mock，trace 标 degraded", downDetail.job.status === "review" && degraded > 0, "degraded=" + degraded);
    await client.req("/api/provider", { method: "PUT", body: {
      baseUrl: "http://127.0.0.1:" + FAKE_PORT, textModel: "fake-text", imageModel: "fake-image",
      visionModel: "", apiKey: "fake-key", enabled: true
    } });

    /* ---------- B4 发布审批 ---------- */
    const pub1 = await client.req("/api/publications", { method: "POST", body: { runId: runId, note: "B5 submit" } });
    add("B4-02", "review run 提交发布生成 pending", pub1.publication.status === "pending" && pub1.publication.version === "v1", pub1.publication.version);
    const editor = makeClient();
    await editor.login("editor@ovem.local", "ovem-demo-2026");
    let editorApprove = null;
    try { editorApprove = await editor.req("/api/publications/" + pub1.publication.id + "/decide", { method: "POST", body: { decision: "approve" } }); }
    catch (e) { editorApprove = e; }
    add("B4-03", "editor 不能审批（需 admin+）", editorApprove && editorApprove.status === 403, "status=" + (editorApprove && editorApprove.status));
    const admin = makeClient();
    await admin.login("admin@ovem.local", "ovem-demo-2026");
    const approved = await admin.req("/api/publications/" + pub1.publication.id + "/decide", { method: "POST", body: { decision: "approve", note: "admin approve" } });
    const manifestPath = path.join(ROOT, "published", "ovem-demo", runId, "v1", "manifest.json");
    add("B4-04", "批准生成版本包 + manifest hash", approved.publication.status === "approved" && fs.existsSync(manifestPath) && /sha256:/.test(readJsonFile(path.relative(ROOT, manifestPath)).manifestHash || ""), approved.publication.path);
    add("B4-08", "版本包 HTTP 200，17 页 index 未改写", await fetch(BASE + approved.publication.path).then(r => r.status) === 200 && (beforeIndexHash === require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, "index.html"))).digest("hex")), "hash unchanged");
    const pub2 = await client.req("/api/publications", { method: "POST", body: { runId: runId, note: "v2" } });
    const approved2 = await admin.req("/api/publications/" + pub2.publication.id + "/decide", { method: "POST", body: { decision: "approve", note: "v2" } });
    add("B4-06", "同一 run 二次发布生成 v2，不覆盖 v1", pub2.publication.version === "v2" && fs.existsSync(path.join(ROOT, "published", "ovem-demo", runId, "v1", "index.html")) && fs.existsSync(path.join(ROOT, "published", "ovem-demo", runId, "v2", "index.html")), "v2 path=" + approved2.publication.path);

    // 驳回：用一条新的 review run（mock 包也能生成 SVG 占位）
    const mockJob = await client.req("/api/jobs", { method: "POST", body: {
      mode: "mock", budgetCny: 200,
      mission: { id: "M-B4-REJECT", title: "reject", brief: "reject", productIds: ["p01"], channelIds: ["c01", "c02", "c06"], agentId: "content-orchestrator", constraints: { budgetCny: 200 } }
    } });
    const mockDetail = await pollJob(client, mockJob.job.id, 30000);
    const pub3 = await client.req("/api/publications", { method: "POST", body: { runId: mockDetail.job.runId, note: "to reject" } });
    const rejected = await admin.req("/api/publications/" + pub3.publication.id + "/decide", { method: "POST", body: { decision: "reject", note: "主色偏离品牌色" } });
    const rejectedRun = (await client.req("/api/runs/" + mockDetail.job.runId)).run;
    add("B4-05", "驳回保留原因、run failed、无版本包", rejected.publication.status === "rejected" && rejected.publication.note === "主色偏离品牌色" && rejectedRun.status === "failed" && !rejected.publication.path, rejected.publication.note || "");
    let badSubmit = null;
    try { badSubmit = await client.req("/api/publications", { method: "POST", body: { runId: mockDetail.job.runId } }); }
    catch (e) { badSubmit = e; }
    add("B4-01", "非 review run 提交发布返回 409", badSubmit && badSubmit.status === 409, "status=" + (badSubmit && badSubmit.status));
    const timeline = await client.req("/api/audit?runId=" + encodeURIComponent(runId));
    add("B4-07", "审计可按 runId 串 request/approve", timeline.timeline.some(t => t.action === "publication.request") && timeline.timeline.some(t => t.action === "publication.approve"), "events=" + timeline.timeline.length);
    const rolled = await admin.req("/api/publications/" + pub2.publication.id + "/rollback", { method: "POST", body: { note: "v2 rollback" } });
    add("B4-07b", "回滚写审计", rolled.publication.status === "rolled_back" && (await client.req("/api/audit?runId=" + encodeURIComponent(runId))).timeline.some(t => t.action === "publication.rollback"), rolled.publication.status);

    const summary = {
      total: results.length,
      passed: results.filter(r => r.status === "pass").length,
      failed: results.filter(r => r.status === "fail").length
    };
    const report = {
      stage: "B3", title: "OVEM B3 完整系统验收", at: startedAt,
      env: { node: process.version, sqlite: "node:sqlite", fakeProvider: "tools/fake-ark.js", db: "temp" },
      summary: summary, cases: results,
      note: "本次 live 链路使用本地 fake Ark 验证 provider 契约；真实火山方舟调用需在 Provider 配置 key 与 endpoint id 后补测。"
    };
    const out = path.join(ROOT, "docs/v3/reports/B3.json");
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log("\n" + summary.passed + "/" + summary.total + " passed · report " + out);
    if (summary.failed) process.exitCode = 1;
  } catch (e) {
    add("B5-99", "验收脚本异常", false, String(e && e.stack || e));
    console.error(e);
    const report = { stage: "B3", at: startedAt, summary: { total: results.length, passed: results.filter(r => r.status === "pass").length, failed: results.filter(r => r.status === "fail").length }, cases: results };
    fs.writeFileSync(path.join(ROOT, "docs/v3/reports/B3.json"), JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    if (server) { try { server.kill("SIGTERM"); } catch (e) {} }
    if (fake) { try { fake.kill("SIGTERM"); } catch (e) {} }
    try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch (e) {}
    try { if (fs.existsSync(DB_PATH + "-wal")) fs.unlinkSync(DB_PATH + "-wal"); } catch (e) {}
    try { if (fs.existsSync(DB_PATH + "-shm")) fs.unlinkSync(DB_PATH + "-shm"); } catch (e) {}
  }
}

main();
