/* ============================================================
   OVEM 运行时 · Trace（事件总线）
   ------------------------------------------------------------
   零 DOM 依赖；classic script，挂 window.OVEM_RT.Trace。
   职责：发事件、保证 seq 单调、计算成本累加、导出 JSON。
   事件类型固定 11 类，未知类型直接抛错（防止运行时自造事件）。
   ============================================================ */
window.OVEM_RT = window.OVEM_RT || {};
(function (RT) {
  "use strict";

  var EVENT_TYPES = [
    "mission.created", "plan.compiled", "step.start", "tool.call", "tool.result",
    "critic.verdict", "retry.scheduled", "hitl.requested", "hitl.decided",
    "artifact.landed", "run.finished"
  ];
  var LEVELS = ["debug", "info", "warn", "error"];

  RT.util = RT.util || {};
  RT.util.round4 = function (n) {
    var v = Number(n) || 0;
    return Math.round(v * 10000) / 10000;
  };
  RT.util.pad = function (n, w) {
    return String(n).padStart(w || 3, "0");
  };
  RT.util.nowIso = function () { return new Date().toISOString(); };

  function levelOf(type, payload) {
    if (payload && LEVELS.indexOf(payload.level) >= 0) return payload.level;
    if (type === "retry.scheduled") return "warn";
    if (type === "hitl.requested") return "warn";
    if (type === "run.finished" && payload && payload.status === "failed") return "error";
    return "info";
  }

  function createBus(runId) {
    var seq = 0;
    var events = [];
    var listeners = [];

    function emit(type, payload, costCny) {
      if (EVENT_TYPES.indexOf(type) < 0) throw new Error("未知事件类型：" + type);
      seq += 1;
      var ev = {
        id: "T-" + runId + "-" + RT.util.pad(seq, 3),
        runId: runId,
        seq: seq,
        ts: RT.util.nowIso(),
        type: type,
        level: levelOf(type, payload),
        payload: payload || {}
      };
      if (costCny !== undefined && costCny !== null) ev.costCny = RT.util.round4(costCny);
      events.push(ev);
      listeners.forEach(function (fn) { try { fn(ev); } catch (e) {} });
      return ev;
    }

    return {
      runId: runId,
      emit: emit,
      on: function (fn) { listeners.push(fn); },
      events: function () { return events.slice(); },
      size: function () { return events.length; },
      sumCost: function () {
        return RT.util.round4(events.reduce(function (a, e) { return a + (e.costCny || 0); }, 0));
      },
      byType: function (type) { return events.filter(function (e) { return e.type === type; }); },
      toJSON: function () {
        return { runId: runId, count: events.length, events: events };
      }
    };
  }

  RT.Trace = {
    EVENT_TYPES: EVENT_TYPES,
    LEVELS: LEVELS,
    createBus: createBus,
    validate: function (ev) {
      return !!(ev && ev.id && ev.runId && ev.type && EVENT_TYPES.indexOf(ev.type) >= 0
        && typeof ev.seq === "number" && ev.seq > 0 && ev.ts);
    }
  };
})(window.OVEM_RT);
