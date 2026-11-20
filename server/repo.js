/* ============================================================
   OVEM B3 · 租户隔离的数据访问层
   ------------------------------------------------------------
   约定：所有函数第一个参数是 tenantId；SQL 必须带 tenant_id。
   路由层不允许绕过 repo 直接查 runs / artifacts / audit。
   ============================================================ */
"use strict";

const dbm = require("./db");

function parse(s, fallback) {
  try { return JSON.parse(s == null ? "" : s); } catch (e) { return fallback; }
}

function listRuns(tenantId, limit) {
  limit = Math.min(100, Math.max(1, Number(limit) || 30));
  return dbm.db.prepare(
    "SELECT id,tenant_id,job_id,mission_id,agent_id,status,mode,plan_json,stats_json,started_at,ended_at,created_at FROM runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?"
  ).all(tenantId, limit).map(function (r) {
    return {
      id: r.id, tenantId: r.tenant_id, jobId: r.job_id, missionId: r.mission_id, agentId: r.agent_id,
      status: r.status, mode: r.mode,
      plan: parse(r.plan_json, null), stats: parse(r.stats_json, null),
      startedAt: r.started_at, endedAt: r.ended_at, createdAt: r.created_at
    };
  });
}

function getRun(tenantId, runId) {
  const r = dbm.db.prepare(
    "SELECT id,tenant_id,job_id,mission_id,agent_id,status,mode,plan_json,stats_json,started_at,ended_at,created_at FROM runs WHERE tenant_id = ? AND id = ?"
  ).get(tenantId, runId);
  if (!r) return null;
  return {
    id: r.id, tenantId: r.tenant_id, jobId: r.job_id, missionId: r.mission_id, agentId: r.agent_id,
    status: r.status, mode: r.mode,
    plan: parse(r.plan_json, null), stats: parse(r.stats_json, null),
    startedAt: r.started_at, endedAt: r.ended_at, createdAt: r.created_at
  };
}

function listTraces(tenantId, runId) {
  return dbm.db.prepare(
    "SELECT id,run_id,seq,type,level,payload_json,cost_cny,ts FROM traces WHERE tenant_id = ? AND run_id = ? ORDER BY seq ASC"
  ).all(tenantId, runId).map(function (r) {
    return {
      id: r.id, runId: r.run_id, seq: r.seq, type: r.type, level: r.level,
      payload: parse(r.payload_json, {}), costCny: r.cost_cny, ts: r.ts
    };
  });
}

function listArtifacts(tenantId, runId) {
  return dbm.db.prepare(
    "SELECT id,run_id,kind,product_id,channel_id,name,url,meta_json,qa_json,status,created_at FROM artifacts WHERE tenant_id = ? AND run_id = ? ORDER BY created_at, id"
  ).all(tenantId, runId).map(function (r) {
    return {
      id: r.id, runId: r.run_id, kind: r.kind, productId: r.product_id, channelId: r.channel_id,
      name: r.name, url: r.url, meta: parse(r.meta_json, {}), qa: parse(r.qa_json, {}),
      status: r.status, createdAt: r.created_at
    };
  });
}

function listReviews(tenantId, runId) {
  return dbm.db.prepare(
    "SELECT id,run_id,gate,decision,actor_id,note,pct,created_at,decided_at FROM reviews WHERE tenant_id = ? AND run_id = ? ORDER BY created_at"
  ).all(tenantId, runId).map(function (r) {
    return {
      id: r.id, runId: r.run_id, gate: r.gate, decision: r.decision, actorId: r.actor_id,
      note: r.note, pct: r.pct, createdAt: r.created_at, decidedAt: r.decided_at
    };
  });
}

function getJob(tenantId, jobId) {
  const r = dbm.db.prepare(
    "SELECT id,tenant_id,run_id,mission_json,mode,status,budget_cny,cost_cny,created_by,created_at,updated_at,error FROM jobs WHERE tenant_id = ? AND id = ?"
  ).get(tenantId, jobId);
  if (!r) return null;
  return {
    id: r.id, tenantId: r.tenant_id, runId: r.run_id, mission: parse(r.mission_json, {}),
    mode: r.mode, status: r.status, budgetCny: r.budget_cny, costCny: r.cost_cny,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, error: r.error
  };
}

function listJobs(tenantId, limit) {
  limit = Math.min(100, Math.max(1, Number(limit) || 30));
  return dbm.db.prepare(
    "SELECT id,tenant_id,run_id,mission_json,mode,status,budget_cny,cost_cny,created_by,created_at,updated_at,error FROM jobs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(tenantId, limit).map(function (r) {
    return {
      id: r.id, tenantId: r.tenant_id, runId: r.run_id, mission: parse(r.mission_json, {}),
      mode: r.mode, status: r.status, budgetCny: r.budget_cny, costCny: r.cost_cny,
      createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, error: r.error
    };
  });
}

function listMembers(tenantId) {
  return dbm.db.prepare(
    "SELECT m.id,m.user_id,m.role,m.created_at,u.email,u.name,u.disabled FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id = ? ORDER BY m.created_at, u.email"
  ).all(tenantId).map(function (r) {
    return { id: r.id, userId: r.user_id, email: r.email, name: r.name, role: r.role, disabled: !!r.disabled, createdAt: r.created_at };
  });
}

module.exports = {
  listRuns, getRun, listTraces, listArtifacts, listReviews,
  getJob, listJobs, listMembers
};
