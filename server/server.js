/* ============================================================
   OVEM B3 · 本地 Node 服务
   ------------------------------------------------------------
   - 静态服务：workbench / index / login / docs / published
   - API：auth / tenants / jobs / runs / members / audit / provider
   - 零第三方依赖；SQLite 由 node:sqlite 提供
   - 仅监听 127.0.0.1，默认端口 4318
   ============================================================ */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");

const dbm = require("./db");
const auth = require("./auth");
const repo = require("./repo");
const audit = require("./audit");
const provider = require("./provider");
const { JobRunner } = require("./job-runner");

const ROOT = path.resolve(__dirname, "..");
const HOST = process.env.OVEM_HOST || "127.0.0.1";
const PORT = Number(process.env.OVEM_PORT) || 4318;
const VERSION = "4.0.0-b3";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

function sendJson(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }, extraHeaders || {}));
  res.end(payload);
}

function sendError(res, status, code, message, detail) {
  sendJson(res, status, { ok: false, code: code, message: message, detail: detail || undefined });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { reject(Object.assign(new Error("body too large"), { code: "bad_request" })); req.destroy(); return; }
      raw += chunk;
    });
    req.on("end", function () {
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch (e) { reject(Object.assign(new Error("invalid json"), { code: "bad_request" })); }
    });
    req.on("error", reject);
  });
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
}

function ctxOf(req) {
  const c = auth.authenticate(req);
  return c;
}

function requireAuth(res, ctx) {
  if (!ctx) { sendError(res, 401, "unauthenticated", "请先登录"); return false; }
  return true;
}

function requireRole(res, ctx, minRole) {
  if (!requireAuth(res, ctx)) return false;
  if (!auth.can(ctx.role, minRole)) { sendError(res, 403, "forbidden", "当前角色无权限：" + ctx.role + " < " + minRole); return false; }
  return true;
}

function requireWrite(req, res, ctx) {
  if (!requireAuth(res, ctx)) return false;
  if (!auth.requireCsrf(req, ctx)) { sendError(res, 403, "forbidden", "CSRF token 缺失或失效"); return false; }
  return true;
}

function publicUser(ctx) {
  return {
    id: ctx.user.id, email: ctx.user.email, name: ctx.user.name,
    isPlatform: !!ctx.user.is_platform
  };
}

function publicTenant(ctx) {
  return { id: ctx.tenant.id, name: ctx.tenant.name, slug: ctx.tenant.slug, plan: ctx.tenant.plan };
}

function sessionBody(ctx, tenants) {
  return {
    ok: true,
    user: publicUser(ctx),
    tenant: publicTenant(ctx),
    role: ctx.role,
    csrf: ctx.csrf,
    tenants: tenants || auth.listTenantsFor(ctx.user)
  };
}

/* ---------- 登录限流 ---------- */
const loginAttempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, reset: now + 300000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 300000; }
  return rec.count < 5;
}
function noteLogin(ip, ok) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, reset: now + 300000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 300000; }
  if (ok) rec.count = 0; else rec.count += 1;
  loginAttempts.set(ip, rec);
}

/* ---------- 静态文件 ---------- */
function safeStaticPath(pathname) {
  let rel = decodeURIComponent(pathname || "/");
  if (rel === "/") rel = "/workbench.html";
  if (rel.indexOf("\0") >= 0) return null;
  const abs = path.resolve(ROOT, "." + rel);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;
  const first = path.relative(ROOT, abs).split(path.sep)[0];
  if (first === "server" || first === ".git" || first === "node_modules") return null;
  if (/\.env/i.test(path.basename(abs)) || /\.db($|-)/i.test(path.basename(abs)) || path.basename(abs) === ".secret") return null;
  return abs;
}

function serveStatic(req, res, pathname) {
  const abs = safeStaticPath(pathname);
  if (!abs) { sendError(res, 404, "not_found", "路径不可访问"); return; }
  fs.stat(abs, function (err, st) {
    if (err || !st.isFile()) { sendError(res, 404, "not_found", "文件不存在"); return; }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin"
    });
    fs.createReadStream(abs).pipe(res);
  });
}

/* ---------- 业务路由 ---------- */
async function handleApi(req, res, pathname) {
  const method = req.method;
  const ctx = ctxOf(req);
  const ip = clientIp(req);

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true, service: "ovem-b3", version: VERSION, time: dbm.nowIso(),
      auth: "sqlite", tenants: dbm.db ? dbm.db.prepare("SELECT COUNT(*) AS c FROM tenants").get().c : 0
    });
    return;
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    if (!loginAllowed(ip)) { sendError(res, 429, "rate_limited", "登录尝试过多，请 5 分钟后再试"); return; }
    let body;
    try { body = await readJson(req); } catch (e) { sendError(res, 400, "bad_request", "JSON 解析失败"); return; }
    const result = auth.login(body.email, body.password, ip);
    if (!result) { noteLogin(ip, false); sendError(res, 401, "unauthenticated", "邮箱或密码错误"); return; }
    noteLogin(ip, true);
    const ctx2 = { user: result.user, tenant: result.tenant, role: result.role, csrf: result.session.csrf, session: { id: "" } };
    audit.write(ctx2, "auth.login", "user", result.user.id, { role: result.role, tenant: result.tenant.id }, ip);
    sendJson(res, 200, sessionBody(ctx2, result.tenants), {
      "set-cookie": auth.cookieHeader(result.session.token, result.session.maxAge)
    });
    return;
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    if (!requireAuth(res, ctx)) return;
    sendJson(res, 200, sessionBody(ctx));
    return;
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    if (!requireWrite(req, res, ctx)) return;
    audit.write(ctx, "auth.logout", "user", ctx.user.id, {}, ip);
    auth.revoke(req);
    sendJson(res, 200, { ok: true }, { "set-cookie": auth.clearCookieHeader() });
    return;
  }

  if (method === "GET" && pathname === "/api/tenants") {
    if (!requireAuth(res, ctx)) return;
    sendJson(res, 200, { ok: true, tenants: auth.listTenantsFor(ctx.user), current: ctx.tenant.id });
    return;
  }

  if (method === "POST" && pathname === "/api/tenants/switch") {
    if (!requireWrite(req, res, ctx)) return;
    let body;
    try { body = await readJson(req); } catch (e) { sendError(res, 400, "bad_request", "JSON 解析失败"); return; }
    const result = auth.switchTenant(ctx, String(body.tenantId || ""));
    if (!result.ok) {
      sendError(res, result.code === "forbidden" ? 403 : 404, result.code, result.code === "forbidden" ? "不能切换到该租户" : "租户不存在");
      return;
    }
    audit.write(ctx, "tenant.switch", "tenant", result.tenant.id, { from: ctx.tenant.id, to: result.tenant.id }, ip);
    const ctx2 = { user: ctx.user, tenant: result.tenant, role: result.role, csrf: result.csrf, session: ctx.session };
    sendJson(res, 200, sessionBody(ctx2));
    return;
  }

  if (method === "GET" && pathname === "/api/runs") {
    if (!requireAuth(res, ctx)) return;
    const limit = new URL(req.url, "http://localhost").searchParams.get("limit");
    sendJson(res, 200, { ok: true, runs: repo.listRuns(ctx.tenant.id, limit), tenant: publicTenant(ctx) });
    return;
  }

  const runMatch = /^\/api\/runs\/([^/]+)$/.exec(pathname);
  if (method === "GET" && runMatch) {
    if (!requireAuth(res, ctx)) return;
    const run = repo.getRun(ctx.tenant.id, decodeURIComponent(runMatch[1]));
    if (!run) { sendError(res, 404, "not_found", "运行不存在或不属于当前租户"); return; }
    sendJson(res, 200, {
      ok: true, run: run,
      traces: repo.listTraces(ctx.tenant.id, run.id),
      artifacts: repo.listArtifacts(ctx.tenant.id, run.id),
      reviews: repo.listReviews(ctx.tenant.id, run.id)
    });
    return;
  }

  if (method === "GET" && pathname === "/api/jobs") {
    if (!requireAuth(res, ctx)) return;
    sendJson(res, 200, { ok: true, jobs: repo.listJobs(ctx.tenant.id, 30) });
    return;
  }

  if (method === "POST" && pathname === "/api/jobs") {
    if (!requireRole(res, ctx, "editor")) return;
    if (!requireWrite(req, res, ctx)) return;
    let body;
    try { body = await readJson(req); } catch (e) { sendError(res, 400, "bad_request", "JSON 解析失败"); return; }
    const mode = body.mode === "live" ? "live" : (body.mode === "replay" ? "replay" : "mock");
    if (mode === "live") {
      const cfg = provider.getRuntime(ctx.tenant.id);
      if (!cfg.ready) { sendError(res, 422, "provider_error", "live 未就绪：请先在平台配置 Provider（key / 文本模型 / 图片模型）"); return; }
    }
    const mission = body.mission || {};
    if (!mission.id || !mission.title) { sendError(res, 400, "bad_request", "mission 缺少 id/title"); return; }
    const result = jobRunner.createJob({
      tenantId: ctx.tenant.id, userId: ctx.user.id, mission: mission, mode: mode,
      budgetCny: body.budgetCny != null ? body.budgetCny : (mission.constraints && mission.constraints.budgetCny),
      speed: body.speed, ip: ip
    });
    if (result && result.error) {
      sendError(res, 422, result.error, result.error === "live_unavailable" ? "live adapter 尚未加载" : "Job 创建失败");
      return;
    }
    sendJson(res, 201, { ok: true, job: result });
    return;
  }

  const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(pathname);
  if (method === "GET" && jobMatch) {
    if (!requireAuth(res, ctx)) return;
    const detail = jobRunner.detail(decodeURIComponent(jobMatch[1]), ctx.tenant.id);
    if (!detail) { sendError(res, 404, "not_found", "Job 不存在或不属于当前租户"); return; }
    sendJson(res, 200, Object.assign({ ok: true }, detail));
    return;
  }

  const decideMatch = /^\/api\/jobs\/([^/]+)\/decide$/.exec(pathname);
  if (method === "POST" && decideMatch) {
    if (!requireRole(res, ctx, "editor")) return;
    if (!requireWrite(req, res, ctx)) return;
    let body;
    try { body = await readJson(req); } catch (e) { sendError(res, 400, "bad_request", "JSON 解析失败"); return; }
    const result = jobRunner.decide(decodeURIComponent(decideMatch[1]), ctx.tenant.id, body.decision, body.note, ctx.user.id, ip);
    if (result.error) { sendError(res, result.error === "no_gate" ? 409 : 400, result.error, result.error === "no_gate" ? "当前没有等待审批的闸门" : "decision 必须为 approve / reject"); return; }
    sendJson(res, 200, { ok: true, decision: result.decision });
    return;
  }

  if (method === "GET" && pathname === "/api/members") {
    if (!requireRole(res, ctx, "admin")) return;
    sendJson(res, 200, { ok: true, members: repo.listMembers(ctx.tenant.id) });
    return;
  }

  if (method === "POST" && pathname === "/api/members") {
    if (!requireRole(res, ctx, "admin")) return;
    if (!requireWrite(req, res, ctx)) return;
    let body;
    try { body = await readJson(req); } catch (e) { sendError(res, 400, "bad_request", "JSON 解析失败"); return; }
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim() || email;
    const role = String(body.role || "viewer");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { sendError(res, 400, "bad_request", "邮箱格式不合法"); return; }
    if (auth.ROLES.indexOf(role) < 0 || role === "owner") { sendError(res, 400, "bad_request", "角色必须为 admin/editor/viewer"); return; }
    const existing = dbm.db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email);
    if (existing) { sendError(res, 409, "conflict", "该邮箱已存在"); return; }
    const uid = dbm.newId("u");
    const now = dbm.nowIso();
    dbm.db.prepare("INSERT INTO users (id,email,name,password_hash,is_platform,disabled,created_at) VALUES (?,?,?,?,0,0,?)")
      .run(uid, email, name, dbm.hashPassword(body.password || "ovem-demo-2026"), now);
    dbm.db.prepare("INSERT INTO memberships (id,user_id,tenant_id,role,created_at) VALUES (?,?,?,?,?)")
      .run(dbm.newId("m"), uid, ctx.tenant.id, role, now);
    audit.write(ctx, "member.create", "user", uid, { email: email, role: role }, ip);
    sendJson(res, 201, { ok: true, member: { userId: uid, email: email, name: name, role: role } });
    return;
  }

  const memberMatch = /^\/api\/members\/([^/]+)$/.exec(pathname);
  if (method === "PATCH" && memberMatch) {
    if (!requireRole(res, ctx, "admin")) return;
    if (!requireWrite(req, res, ctx)) return;
    let body;
    try { body = await readJson(req); } catch (e) { sendError(res, 400, "bad_request", "JSON 解析失败"); return; }
    const memberId = decodeURIComponent(memberMatch[1]);
    const m = dbm.db.prepare("SELECT * FROM memberships WHERE tenant_id = ? AND id = ?").get(ctx.tenant.id, memberId);
    if (!m) { sendError(res, 404, "not_found", "成员不存在"); return; }
    const role = body.role != null ? String(body.role) : m.role;
    if (auth.ROLES.indexOf(role) < 0 || role === "owner") { sendError(res, 400, "bad_request", "角色必须为 admin/editor/viewer"); return; }
    dbm.db.prepare("UPDATE memberships SET role = ? WHERE id = ?").run(role, memberId);
    if (body.disabled != null) dbm.db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(body.disabled ? 1 : 0, m.user_id);
    audit.write(ctx, "member.role", "user", m.user_id, { role: role, disabled: !!body.disabled }, ip);
    sendJson(res, 200, { ok: true, member: { id: memberId, role: role, disabled: !!body.disabled } });
    return;
  }

  if (method === "GET" && pathname === "/api/audit") {
    if (!requireRole(res, ctx, "admin")) return;
    const q = new URL(req.url, "http://localhost").searchParams;
    const runId = q.get("runId");
    if (runId) { sendJson(res, 200, { ok: true, timeline: audit.timeline(ctx.tenant.id, runId), runId: runId }); return; }
    sendJson(res, 200, { ok: true, logs: audit.list(ctx.tenant.id, { limit: q.get("limit") }) });
    return;
  }

  if (method === "GET" && pathname === "/api/provider") {
    if (!requireRole(res, ctx, "admin")) return;
    sendJson(res, 200, { ok: true, provider: provider.getPublic(ctx.tenant.id) });
    return;
  }

  if (method === "PUT" && pathname === "/api/provider") {
    if (!requireRole(res, ctx, "admin")) return;
    if (!requireWrite(req, res, ctx)) return;
    let body;
    try { body = await readJson(req); } catch (e) { sendError(res, 400, "bad_request", "JSON 解析失败"); return; }
    const saved = provider.save(ctx.tenant.id, ctx.user.id, body);
    audit.write(ctx, "provider.update", "provider", "ark", {
      enabled: saved.enabled, textModel: saved.textModel, imageModel: saved.imageModel,
      keyMasked: saved.keyMasked
    }, ip);
    sendJson(res, 200, { ok: true, provider: saved });
    return;
  }

  if (method === "POST" && pathname === "/api/provider/test") {
    if (!requireRole(res, ctx, "admin")) return;
    if (!requireWrite(req, res, ctx)) return;
    const result = await provider.test(ctx.tenant.id);
    audit.write(ctx, "provider.test", "provider", "ark", { ok: result.ok, code: result.code || "" }, ip);
    sendJson(res, result.ok ? 200 : 422, result);
    return;
  }

  sendError(res, 404, "not_found", "API 不存在：" + pathname);
}

let jobRunner = null;

function createServer() {
  dbm.open();
  dbm.migrate();
  dbm.seed();
  let liveToolsFactory = null;
  try {
    liveToolsFactory = require("./live-tools").createFactory;
  } catch (e) {}
  jobRunner = new JobRunner({ maxConcurrency: 2, liveToolsFactory: liveToolsFactory });

  const server = http.createServer((req, res) => {
    res.setHeader("x-ovem-service", "b3");
    const parsed = url.parse(req.url || "/");
    const pathname = parsed.pathname || "/";
    if (pathname.startsWith("/api/")) {
      handleApi(req, res, pathname).catch((e) => {
        sendError(res, 500, "internal_error", String(e && e.message || e));
      });
      return;
    }
    serveStatic(req, res, pathname);
  });
  server.on("error", (e) => {
    console.error("[ovem] server error:", e.message);
  });
  return server;
}

function start() {
  const server = createServer();
  server.listen(PORT, HOST, function () {
    console.log("[ovem] B3 service listening http://" + HOST + ":" + PORT);
    console.log("[ovem] db:", dbm.dbPath);
    console.log("[ovem] login: http://" + HOST + ":" + PORT + "/login.html");
  });
  return server;
}

if (require.main === module) start();

module.exports = { createServer, start, ROOT, PORT, HOST, VERSION };
