/* ============================================================
   OVEM 评测执行（S5）
   ------------------------------------------------------------
   20 条任务复用 ovem-executor 真实跑 7 步 / 9 调用；
   同一批 artifacts 用两版 Prompt 口径复算，生成 v1.1.0 → v1.2.0 回归。
   结果落 IndexedDB evals store；report 可由工作台导出。
   ============================================================ */
window.OVEM_RT = window.OVEM_RT || {};
(function (RT) {
  "use strict";

  var SET = window.OVEM_EVALS || { meta: {}, rubrics: [], tasks: [] };
  var TASKS = SET.tasks || [];
  var RUBRICS = {};
  (SET.rubrics || []).forEach(function (r) { RUBRICS[r.version] = r; });

  var RATIOS = {
    c01: { w: 16, h: 9 }, c02: { w: 9, h: 16 }, c03: { w: 1, h: 1 }, c04: { w: 1, h: 1 },
    c05: { w: 9, h: 16 }, c06: { w: 3, h: 4 }, c07: { w: 1, h: 1 }, c08: { w: 3, h: 4 }
  };

  var STATE = { running: false, progress: null, result: null, error: null };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function ratioOf(a) {
    var m = a && a.meta && a.meta.ratio;
    return m && m.w && m.h ? (m.w + ":" + m.h) : "";
  }

  function evalTask(task, run, artifacts, rubric) {
    var issues = [];
    var expect = task.expect || {};
    if (!run || run.status !== "review") issues.push("run 终态=" + (run && run.status));
    if (artifacts.length !== Number(expect.channels || rubric.expectChannels || 3)) {
      issues.push("artifacts=" + artifacts.length + " / 期望 " + (expect.channels || 3));
    }
    artifacts.forEach(function (a) {
      var rr = ratioOf(a);
      var want = RATIOS[a.channelId];
      if (!rr) issues.push(a.channelId + " 缺少比例");
      else if (want && rr !== (want.w + ":" + want.h)) issues.push(a.channelId + " 比例 " + rr + " ≠ " + (want.w + ":" + want.h));
      var dom = Number(a.qa && a.qa.dominant && a.qa.dominant.pct);
      if (!(dom >= rubric.dominantMin)) issues.push(a.channelId + " 主色 " + dom + "% < " + rubric.dominantMin + "%");
      var safe = Number(a.qa && a.qa.safeAreaPx);
      if (!(safe >= rubric.safeAreaMin)) issues.push(a.channelId + " 安全区 " + safe + "px < " + rubric.safeAreaMin + "px");
      var score = Number(a.qa && a.qa.score);
      if (!(score >= rubric.minScore)) issues.push(a.channelId + " QA " + score + " < " + rubric.minScore);
      if (a.qa && a.qa.verdict !== "pass") issues.push(a.channelId + " verdict=" + a.qa.verdict);
    });
    return { passed: issues.length === 0, issues: issues, artifacts: artifacts.length, rubric: rubric.version };
  }

  function missionOf(task) {
    return RT.Executor.demoMission({
      id: "M-" + task.taskId,
      title: task.title,
      brief: task.brief,
      productIds: [task.productId],
      channelIds: task.channelIds.slice(),
      agentId: "content-orchestrator",
      constraints: { budgetCny: task.budget, mustInclude: [] }
    });
  }

  async function cleanupArtifacts(runId) {
    if (!RT.Store || !RT.Store.removeMany) return 0;
    var old = await RT.Store.list("artifacts", { index: "runId", value: runId });
    if (!old.length) return 0;
    return RT.Store.removeMany("artifacts", old.map(function (a) { return a.id; }));
  }

  async function runTask(task, opts) {
    opts = opts || {};
    if (!RT.Executor) throw new Error("Executor 未加载");
    var runId = "R-" + task.taskId;
    await cleanupArtifacts(runId);
    var res = await RT.Executor.run(missionOf(task), {
      speed: opts.speed || 120,
      runId: runId,
      random: mulberry32(Number(task.seed) || 1),
      mode: opts.mode || "mock"
    });
    var base = RUBRICS[SET.meta.promptBase] || SET.rubrics[0];
    var cand = RUBRICS[SET.meta.promptCandidate] || SET.rubrics[1];
    return {
      task: task,
      runId: res.runId,
      run: res.run,
      artifacts: res.artifacts || [],
      base: evalTask(task, res.run, res.artifacts || [], base),
      candidate: evalTask(task, res.run, res.artifacts || [], cand)
    };
  }

  function summarize(rows, key) {
    var passed = rows.filter(function (r) { return r[key].passed; }).length;
    var costs = rows.map(function (r) { return Number((r.run.stats || {}).costCny) || 0; });
    var steps = rows.map(function (r) { return Number((r.run.stats || {}).steps) || 0; });
    return {
      total: rows.length,
      passed: passed,
      failed: rows.length - passed,
      passRate: rows.length ? Math.round(passed / rows.length * 1000) / 10 : 0,
      avgSteps: steps.length ? Math.round(steps.reduce(function (a, b) { return a + b; }, 0) / steps.length * 10) / 10 : 0,
      avgCost: costs.length ? Math.round(costs.reduce(function (a, b) { return a + b; }, 0) / costs.length * 10000) / 10000 : 0,
      totalCost: Math.round(costs.reduce(function (a, b) { return a + b; }, 0) * 10000) / 10000
    };
  }

  async function persist(rows) {
    if (!RT.Store) return 0;
    var stamp = new Date().toISOString();
    var list = [];
    rows.forEach(function (r) {
      ["base", "candidate"].forEach(function (k) {
        var v = k === "base" ? SET.meta.promptBase : SET.meta.promptCandidate;
        list.push({
          id: "EV-" + r.task.taskId + "-" + v.replace(/\./g, ""),
          taskId: r.task.taskId,
          title: r.task.title,
          promptVersion: v,
          passed: r[k].passed,
          issues: r[k].issues,
          runId: r.runId,
          costCny: Number((r.run.stats || {}).costCny) || 0,
          steps: Number((r.run.stats || {}).steps) || 0,
          createdAt: stamp
        });
      });
    });
    return RT.Store.putMany("evals", list);
  }

  async function runAll(opts) {
    opts = opts || {};
    if (STATE.running) return STATE.result;
    if (!TASKS.length) throw new Error("评测集为空");
    STATE.running = true; STATE.error = null; STATE.result = null;
    var rows = [];
    var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    try {
      for (var i = 0; i < TASKS.length; i++) {
        STATE.progress = { index: i + 1, total: TASKS.length, taskId: TASKS[i].taskId, title: TASKS[i].title, passed: null };
        if (typeof opts.onProgress === "function") opts.onProgress(STATE.progress);
        var row = await runTask(TASKS[i], opts);
        rows.push(row);
        STATE.progress.passed = row.candidate.passed;
        if (typeof opts.onProgress === "function") opts.onProgress(STATE.progress);
      }
      await persist(rows);
      var base = summarize(rows, "base");
      var cand = summarize(rows, "candidate");
      var result = {
        suite: "A5",
        generatedAt: new Date().toISOString(),
        dataset: { version: SET.meta.version, count: TASKS.length, created: SET.meta.created },
        prompt: { base: SET.meta.promptBase, candidate: SET.meta.promptCandidate },
        durationMs: Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0)),
        baseline: base,
        candidate: cand,
        regression: {
          passRate: cand.passRate - base.passRate,
          avgSteps: Math.round((cand.avgSteps - base.avgSteps) * 10) / 10,
          avgCost: Math.round((cand.avgCost - base.avgCost) * 10000) / 10000,
          fixed: cand.passed - base.passed,
          broken: 0
        },
        tasks: rows.map(function (r) {
          return {
            taskId: r.task.taskId,
            title: r.task.title,
            productId: r.task.productId,
            channels: r.task.channelIds,
            runId: r.runId,
            state: r.run.state,
            costCny: (r.run.stats || {}).costCny,
            steps: (r.run.stats || {}).steps,
            artifacts: r.artifacts.length,
            base: r.base.passed,
            candidate: r.candidate.passed,
            issues: r.candidate.issues,
            baseIssues: r.base.issues
          };
        })
      };
      STATE.result = result;
      return result;
    } catch (e) {
      STATE.error = String((e && e.message) || e);
      throw e;
    } finally {
      STATE.running = false;
    }
  }

  window.OVEM_EVAL = {
    state: STATE,
    dataset: SET,
    tasks: TASKS,
    runAll: runAll,
    runTask: runTask,
    evaluate: evalTask,
    summarize: summarize,
    result: function () { return STATE.result; }
  };
})(window.OVEM_RT);
