/* ============================================================
   OVEM B3 · 审计日志
   ------------------------------------------------------------
   所有写动作由路由层显式调用，不依赖触发器。
   detail 中禁止出现 API key、cookie、密码。
   ============================================================ */
"use strict";

const dbm = require("./db");

function write(ctx, action, targetType, targetId, detail, ip) {
  if (!ctx || !ctx.tenant) return null;
  const id = dbm.newId("audit");
  const createdAt = dbm.nowIso();
  dbm.db.prepare(
    "INSERT INTO audit_logs (id,tenant_id,actor_id,action,target_type,target_id,detail_json,ip,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(id, ctx.tenant.id, ctx.user ? ctx.user.id : null, action, targetType || "", targetId || "", JSON.stringify(detail || {}), ip || "", createdAt);
  return id;
}

function list(tenantId, opt) {
  opt = opt || {};
  const limit = Math.min(200, Math.max(1, Number(opt.limit) || 50));
  const rows = dbm.db.prepare(
    "SELECT id,tenant_id,actor_id,action,target_type,target_id,detail_json,ip,created_at FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(tenantId, limit);
  return rows.map(function (r) {
    return {
      id: r.id, tenantId: r.tenant_id, actorId: r.actor_id, action: r.action,
      targetType: r.target_type, targetId: r.target_id,
      detail: safeJson(r.detail_json), ip: r.ip, createdAt: r.created_at
    };
  });
}

function timeline(tenantId, runId) {
  const rows = dbm.db.prepare(
    "SELECT id,actor_id,action,target_type,target_id,detail_json,created_at FROM audit_logs WHERE tenant_id = ? AND (target_id = ? OR detail_json LIKE ?) ORDER BY created_at ASC"
  ).all(tenantId, runId, "%" + runId + "%");
  return rows.map(function (r) {
    return { id: r.id, actorId: r.actor_id, action: r.action, targetId: r.target_id, detail: safeJson(r.detail_json), createdAt: r.created_at };
  });
}

function safeJson(s) {
  try { return JSON.parse(s || "{}"); } catch (e) { return {}; }
}

module.exports = { write, list, timeline };
