/* ============================================================
   OVEM B3 · Job Runner
   ------------------------------------------------------------
   - 每个 Job 在 Node VM 中加载 A 的 runtime，复用 7 步 / 9 调用
   - 事件写入 SQLite；状态由事件推进
   - 预算闸门通过 onHitl 暂停，等待 /api/jobs/:id/decide
   - live 模式由注入的 liveToolsFactory 提供真实工具
   ============================================================ */
"use strict";

const dbm = require("./db");
const repo = require("./repo");
const storeAdapter = require("./store-adapter");
const runtimeLoader = require("./runtime-loader");
const audit = require("./audit");

class JobRunner {
  constructor(opt) {
    opt = opt || {};
    this.maxConcurrency = Math.max(1, Number(opt.maxConcurrency) || 2);
    this.liveToolsFactory = opt.liveToolsFactory || null;
    this.active = 0;
    this.queue = [];
    this.pendingGates = new Map();
  }

  createJob(params) {
    const tenantId = params.tenantId;
    const userId = params.userId;
    const mode = params.mode === "live" ? "live" : (params.mode === "replay" ? "replay" : "mock");
    if (mode === "live" && !this.liveToolsFactory) return { error: "live_unavailable" };
    const mission = params.mission || {};
    const budget = Number(params.budgetCny != null ? params.budgetCny : (mission.constraints && mission.constraints.budgetCny) || 200);
    const jobId = dbm.nextJobId();
    const runId = dbm.nextRunId();
    const now = dbm.nowIso();
    const missionCopy = Object.assign({}, mission, { runId: runId, status: "draft", updatedAt: now });
    if (!missionCopy.constraints) missionCopy.constraints = {};
    missionCopy.constraints.budgetCny = budget;

    dbm.db.prepare(
      "INSERT INTO jobs (id,tenant_id,run_id,mission_json,mode,status,budget_cny,cost_cny,created_by,created_at,updated_at,error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(jobId, tenantId, runId, JSON.stringify(missionCopy), mode, "queued", budget, 0, userId || "", now, now, "");
    audit.write({ tenant: { id: tenantId }, user: { id: userId } }, "job.create", "job", jobId, { mode: mode, runId: runId, budgetCny: budget }, params.ip || "");

    this.queue.push({ jobId: jobId, runId: runId, tenantId: tenantId, userId: userId, mission: missionCopy, mode: mode, budgetCny: budget, speed: params.speed });
    setImmediate(() => this.pump());
    return repo.getJob(tenantId, jobId);
  }

  pump() {
    while (this.active < this.maxConcurrency && this.queue.length) {
      const item = this.queue.shift();
      this.active += 1;
      this.execute(item).catch(() => {}).finally(() => {
        this.active -= 1;
        setImmediate(() => this.pump());
      });
    }
  }

  async execute(item) {
    const db = dbm.db;
    const updateJob = (status, cost, error) => {
      db.prepare("UPDATE jobs SET status = ?, cost_cny = ?, updated_at = ?, error = ? WHERE id = ?")
        .run(status, Number(cost) || 0, dbm.nowIso(), error || "", item.jobId);
    };
    updateJob("running", 0, "");

    const store = storeAdapter.create({ tenantId: item.tenantId, jobId: item.jobId, runId: item.runId });
    let runtime;
    try {
      runtime = runtimeLoader.load({
        store: store,
        toolsFactory: (args, RT, originalCreate) => {
          if (item.mode === "live" && this.liveToolsFactory) {
            return this.liveToolsFactory({
              tenantId: item.tenantId, jobId: item.jobId, runId: item.runId,
              mission: item.mission, data: args.data, agent: args.agent, RT: RT, store: store,
              originalCreate: originalCreate
            });
          }
          return originalCreate(args);
        }
      });
    } catch (e) {
      updateJob("failed", 0, "runtime: " + (e && e.message || e));
      return;
    }

    const RT = runtime.RT;
    const mission = item.mission;
    let status = "running";
    let cost = 0;

    const onEvent = (ev) => {
      try {
        store.putMany("traces", [ev]);
        if (ev.costCny != null) cost += ev.costCny;
        if (ev.type === "hitl.requested") status = "blocked";
        if (ev.type === "hitl.decided") status = "running";
        if (ev.type === "artifact.landed") status = "review";
        if (ev.type === "run.finished" && ev.payload && ev.payload.status) status = ev.payload.status;
        updateJob(status, Math.round(cost * 10000) / 10000, "");
      } catch (e) { /* 审计/落库失败不阻断执行；最终 run 会再写一次 */ }
    };

    const onHitl = (info) => {
      status = "blocked";
      updateJob("blocked", cost, "");
      return new Promise((resolve) => {
        this.pendingGates.set(item.jobId, { resolve: resolve, info: info, createdAt: dbm.nowIso() });
      });
    };

    try {
      const result = await RT.Executor.run(mission, {
        runId: item.runId, agent: runtime.agent, data: runtime.data,
        speed: item.mode === "mock" || item.mode === "replay" ? (Number(item.speed) || 8) : 1,
        mode: item.mode, onEvent: onEvent, onHitl: onHitl
      });
      const finalStatus = result.state || status;
      const finalCost = result.run && result.run.stats ? result.run.stats.costCny : cost;
      updateJob(finalStatus, finalCost, "");
    } catch (e) {
      updateJob("failed", cost, String(e && e.message || e));
      try {
        const failedRun = {
          id: item.runId, missionId: mission.id, agentId: "content-orchestrator", mode: item.mode,
          status: "failed", plan: null,
          stats: { steps: 0, toolCalls: 0, retries: 0, tokens: 0, images: 0, costCny: cost, durationMs: 0 },
          startedAt: dbm.nowIso(), endedAt: dbm.nowIso()
        };
        db.prepare("INSERT OR REPLACE INTO runs (id,tenant_id,job_id,mission_id,agent_id,status,mode,plan_json,stats_json,started_at,ended_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(item.runId, item.tenantId, item.jobId, mission.id, "content-orchestrator", "failed", item.mode, "null", JSON.stringify(failedRun.stats), failedRun.startedAt, failedRun.endedAt, dbm.nowIso());
      } catch (e2) {}
    } finally {
      this.pendingGates.delete(item.jobId);
    }
  }

  decide(jobId, tenantId, decision, note, userId, ip) {
    const gate = this.pendingGates.get(jobId);
    if (!gate) return { error: "no_gate" };
    if (decision !== "approve" && decision !== "reject") return { error: "bad_decision" };
    this.pendingGates.delete(jobId);
    gate.resolve(decision === "approve");
    audit.write({ tenant: { id: tenantId }, user: { id: userId } }, "job.decide", "job", jobId,
      { decision: decision, note: note || "", pct: gate.info && gate.info.pct }, ip || "");
    return { ok: true, decision: decision };
  }

  detail(jobId, tenantId) {
    const job = repo.getJob(tenantId, jobId);
    if (!job) return null;
    const run = repo.getRun(tenantId, job.runId);
    const gate = this.pendingGates.get(jobId);
    return {
      job: job,
      run: run,
      traces: run ? repo.listTraces(tenantId, run.id) : [],
      artifacts: run ? repo.listArtifacts(tenantId, run.id) : [],
      reviews: run ? repo.listReviews(tenantId, run.id) : [],
      pendingGate: gate ? Object.assign({}, gate.info, { since: gate.createdAt }) : null
    };
  }

  pending(jobId) { return this.pendingGates.has(jobId); }
}

module.exports = { JobRunner };
