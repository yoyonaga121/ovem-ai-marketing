/* ============================================================
   OVEM B3 · 服务端 Store 适配器
   ------------------------------------------------------------
   给 A 的 Executor 注入与 IndexedDB 同名的 RT.Store API。
   只实现 Executor 实际使用的方法；所有写入带 tenant_id。
   ============================================================ */
"use strict";

const dbm = require("./db");

function json(v) { return JSON.stringify(v == null ? null : v); }
function parse(s, fallback) { try { return JSON.parse(s == null ? "" : s); } catch (e) { return fallback; } }

function create(opt) {
  opt = opt || {};
  const tenantId = opt.tenantId;
  const jobId = opt.jobId || "";
  const runId = opt.runId;
  const db = dbm.db;

  function put(store, obj) {
    if (store === "missions") {
      const mid = tenantId + ":" + obj.id;
      db.prepare(
        "INSERT INTO missions (id,tenant_id,data_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?) " +
        "ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,status=excluded.status,updated_at=excluded.updated_at"
      ).run(mid, tenantId, json(obj), obj.status || "draft", obj.createdAt || dbm.nowIso(), obj.updatedAt || dbm.nowIso());
      return Promise.resolve(obj);
    }
    if (store === "runs") {
      db.prepare(
        "INSERT INTO runs (id,tenant_id,job_id,mission_id,agent_id,status,mode,plan_json,stats_json,started_at,ended_at,created_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,stats_json=excluded.stats_json,ended_at=excluded.ended_at"
      ).run(obj.id, tenantId, jobId, obj.missionId || "", obj.agentId || "", obj.status || "draft", obj.mode || "mock",
        json(obj.plan || null), json(obj.stats || null), obj.startedAt || "", obj.endedAt || "", dbm.nowIso());
      return Promise.resolve(obj);
    }
    return Promise.resolve(obj);
  }

  function putMany(store, list) {
    if (!list || !list.length) return Promise.resolve(0);
    if (store === "traces") {
      list.forEach(function (ev) {
        db.prepare(
          "INSERT INTO traces (id,run_id,tenant_id,seq,type,level,payload_json,cost_cny,ts) VALUES (?,?,?,?,?,?,?,?,?) " +
          "ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,cost_cny=excluded.cost_cny"
        ).run(ev.id, runId, tenantId, ev.seq, ev.type, ev.level || "info", json(ev.payload || {}), ev.costCny == null ? null : ev.costCny, ev.ts);
      });
      return Promise.resolve(list.length);
    }
    if (store === "artifacts") {
      list.forEach(function (a) {
        const dbid = runId + "-" + a.id;
        db.prepare(
          "INSERT INTO artifacts (id,run_id,tenant_id,kind,product_id,channel_id,name,url,meta_json,qa_json,status,created_at) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET meta_json=excluded.meta_json,qa_json=excluded.qa_json,status=excluded.status"
        ).run(dbid, runId, tenantId, a.kind || "bundle", a.productId || "", a.channelId || "",
          a.name || (a.channelId + " · " + a.productId), a.url || "", json(a.meta || {}), json(a.qa || {}),
          a.status || "review", dbm.nowIso());
      });
      return Promise.resolve(list.length);
    }
    if (store === "reviews") {
      list.forEach(function (r) {
        const dbid = runId + "-" + r.id;
        db.prepare(
          "INSERT INTO reviews (id,run_id,tenant_id,gate,decision,actor_id,note,pct,created_at,decided_at) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET decision=excluded.decision,actor_id=excluded.actor_id,note=excluded.note,decided_at=excluded.decided_at"
        ).run(dbid, runId, tenantId, r.gate || "budget", r.decision || "", r.by || "", r.note || "", r.pct == null ? null : r.pct, r.requestedAt || dbm.nowIso(), r.decidedAt || "");
      });
      return Promise.resolve(list.length);
    }
    return Promise.resolve(0);
  }

  function count(store) {
    const table = { runs: "runs", traces: "traces", artifacts: "artifacts", reviews: "reviews", missions: "missions" }[store];
    if (!table) return Promise.resolve(0);
    return Promise.resolve(db.prepare("SELECT COUNT(*) AS c FROM " + table + " WHERE tenant_id = ?").get(tenantId).c);
  }

  function get(store, key) {
    if (store === "runs") return Promise.resolve(require("./repo").getRun(tenantId, key));
    return Promise.resolve(null);
  }

  function list(store, opt) {
    if (store === "runs") return Promise.resolve(require("./repo").listRuns(tenantId, 200));
    return Promise.resolve([]);
  }

  return {
    mode: function () { return "sqlite"; },
    put: put,
    putMany: putMany,
    get: get,
    list: list,
    count: count,
    clear: function () { return Promise.resolve(false); },
    removeMany: function () { return Promise.resolve(0); },
    reset: function () { return Promise.resolve(false); }
  };
}

module.exports = { create };
