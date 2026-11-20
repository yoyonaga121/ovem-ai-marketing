/* ============================================================
   OVEM 运行时 · Executor（计划 / 执行 / 裁决 / 重试 / 闸门）
   ------------------------------------------------------------
   一条 Mission = 7 个计划步骤 / 9 次工具调用（ADR-007）。
   状态只允许由事件迁移，禁止直改 status（白名单见 TRANSITIONS）。
   成本口径：costCny = tokens/1000 × per1kToken + images × perImage。
   持久化：missions / runs / traces / artifacts / reviews 五个 store。
   ============================================================ */
window.OVEM_RT = window.OVEM_RT || {};
(function (RT) {
  "use strict";

  var T = RT.Trace;
  var S = RT.Store;

  /* 七态 × 事件白名单 */
  var TRANSITIONS = {
    draft:   { "plan.compiled": "planned" },
    planned: { "step.start": "running", "plan.reject": "failed" },
    running: {
      "step.start": "running",
      "retry.scheduled": "running",
      "hitl.requested": "blocked",
      "artifact.landed": "review",
      "tool.failed": "failed"
    },
    blocked: { "hitl.approve": "running", "hitl.reject": "failed" },
    review:  { "review.approve": "done", "review.reject": "failed" },
    done:    {},
    failed:  { "failed.replan": "planned" }
  };

  function next(state, event) {
    var map = TRANSITIONS[state] || {};
    var to = map[event];
    if (!to) throw new Error("非法迁移：" + state + " --" + event + "--> ?");
    return to;
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg); }

  /* 计划：7 个步骤，9 次调用 */
  function plan(mission, agentCfg) {
    var productIds = (mission.productIds && mission.productIds.length) ? mission.productIds : ["p01"];
    var channelIds = (mission.channelIds && mission.channelIds.length) ? mission.channelIds : ["c01", "c02", "c06"];
    var tools = (agentCfg && agentCfg.tools) || [];
    var ids = tools.map(function (t) { return t.id; });
    ["product.get", "brand.recall", "channel.spec", "template.pick", "prompt.compile",
     "image.gen", "qa.check", "copy.write", "artifact.land"].forEach(function (id) {
      assert(ids.indexOf(id) >= 0, "计划引用了未注册的工具：" + id);
    });
    assert(((agentCfg && agentCfg.prompts) || []).length >= 1, "计划引用了未注册的 Prompt");

    var steps = [
      { no: 1, id: "s1", label: "取产品卡", calls: [{ tool: "product.get", args: { productId: productIds[0] } }] },
      { no: 2, id: "s2", label: "召回品牌与渠道约束", calls: [
        { tool: "brand.recall", args: {} },
        { tool: "channel.spec", args: { channelIds: channelIds } }
      ] },
      { no: 3, id: "s3", label: "选版式", calls: [{ tool: "template.pick", args: { channelIds: channelIds } }] },
      { no: 4, id: "s4", label: "编译 Prompt", calls: [{ tool: "prompt.compile", args: { productId: productIds[0], channelIds: channelIds } }] },
      { no: 5, id: "s5", label: "生成图片", calls: [{ tool: "image.gen", args: {} }] },
      { no: 6, id: "s6", label: "质检裁决", calls: [{ tool: "qa.check", args: {} }] },
      { no: 7, id: "s7", label: "写文案并落库", calls: [
        { tool: "copy.write", args: { productId: productIds[0], channelIds: channelIds } },
        { tool: "artifact.land", args: { productId: productIds[0] } }
      ] }
    ];
    return { steps: steps, meta: { stepCount: 7, callCount: 9, productIds: productIds, channelIds: channelIds } };
  }

  function demoMission(over) {
    var base = {
      id: "M-261120-01",
      title: "P01 W3 旗舰物料包",
      brief: "给 P01 出一套 W3 旗舰物料包，官网 / 移动端 / 社媒三渠道，预算 ¥200",
      productIds: ["p01"],
      channelIds: ["c01", "c02", "c06"],
      agentId: "content-orchestrator",
      constraints: { budgetCny: 200, mustInclude: ["官网首屏", "社媒 3:4"] },
      status: "draft",
      runId: null,
      createdAt: RT.util.nowIso(),
      updatedAt: RT.util.nowIso()
    };
    return Object.assign(base, over || {});
  }

  function summariseOut(toolId, out) {
    if (!out) return null;
    switch (toolId) {
      case "product.get": return { id: out.id, name: out.name, price: out.price };
      case "channel.spec": return { channels: out.channels.length, names: out.channels.map(function (c) { return c.name; }) };
      case "template.pick": return { templates: out.templates.length, ids: out.templates.map(function (t) { return t.id; }) };
      case "prompt.compile": return { prompts: out.prompts.length, hashes: out.prompts.map(function (p) { return String(p.hash).slice(0, 12) + "…"; }) };
      case "image.gen": return { images: out.images.length, ratio: out.images[0] && out.images[0].ratio, bytes: out.images.reduce(function (a, x) { return a + x.bytes; }, 0) };
      case "qa.check": return { verdict: out.verdict, score: out.score, issues: out.issues, checks: out.checks, mode: out.mode };
      case "copy.write": return { copies: out.copies.length, chars: out.copies.reduce(function (a, x) { return a + x.chars; }, 0) };
      case "artifact.land": return { artifacts: out.artifacts.length, ids: out.artifacts.map(function (a) { return a.id; }) };
      default: return { keys: Object.keys(out) };
    }
  }

  function costOf(usage, price) {
    var u = usage || { tokens: 0, images: 0 };
    return RT.util.round4((u.tokens / 1000) * price.per1kToken + (u.images || 0) * price.perImage);
  }

  function pickAgent(agentCfg, agentId) {
    var list = (agentCfg && agentCfg.agents) || [];
    return list.filter(function (a) { return a.id === agentId; })[0] || list[0];
  }

  async function execute(mission, opts) {
    opts = opts || {};
    var agentCfg = opts.agent || window.OVEM_AGENT;
    var data = opts.data || window.OVEM_DATA;
    var agent = pickAgent(agentCfg, mission.agentId || "content-orchestrator");
    assert(agent, "未找到 Agent：" + (mission.agentId || "content-orchestrator"));
    assert(agent.enabled !== false, "Agent 已停用：" + agent.id);

    var guard = (agentCfg && agentCfg.guardrails) || {};
    var maxRetry = Number(guard.maxRetryPerStep || 1);
    var maxBudget = Number(guard.dailyBudgetCny || 300);
    var banned = guard.bannedTools || [];
    var budget = Number((mission.constraints && mission.constraints.budgetCny) || 0);
    assert(budget <= maxBudget, "任务预算 ¥" + budget + " 超过当日护栏 ¥" + maxBudget);

    var p = plan(mission, agentCfg);
    var steps = p.steps, meta = p.meta;

    var runId = opts.runId;
    if (!runId) {
      var n = await S.count("runs");
      runId = "R-" + String(n + 1).padStart(4, "0");
    }

    var bus = T.createBus(runId);
    if (typeof opts.onEvent === "function") bus.on(opts.onEvent);
    var registry = RT.Tools.create({ data: data, agent: agentCfg, random: opts.random });
    var price = registry.price;
    var speed = opts.speed || 1;

    var state = "draft";
    var stats = { steps: 0, toolCalls: 0, retries: 0, tokens: 0, images: 0, costCny: 0, durationMs: 0 };
    var startedAt = RT.util.nowIso();
    var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    var gateFired = false;
    var drafts = [];
    var reviews = [];
    var reviewSeq = 0;
    var ctx = { channelIds: meta.channelIds, prompts: [], images: [], copies: [], qa: null };

    mission = Object.assign({}, mission, { runId: runId, status: state, updatedAt: RT.util.nowIso() });
    bus.emit("mission.created", { missionId: mission.id, title: mission.title, budgetCny: budget });
    await S.put("missions", mission);

    bus.emit("plan.compiled", { stepCount: 7, callCount: 9, agentId: agent.id, promptRef: agent.promptRef });
    state = next(state, "plan.compiled");

    async function checkBudget() {
      if (gateFired || budget <= 0 || state !== "running") return null;
      var pct = RT.util.round4(stats.costCny / budget);
      if (pct < 0.8) return null;
      gateFired = true;
      bus.emit("hitl.requested", { gate: "budget", budgetCny: budget, costCny: stats.costCny, pct: pct, threshold: 0.8 });
      state = next(state, "hitl.requested");
      reviewSeq += 1;
      var vn = (await S.count("reviews")) + reviewSeq;
      var rev = {
        id: "V-" + String(vn).padStart(4, "0"),
        runId: runId, gate: "budget", decision: "", by: "", note: "",
        requestedAt: RT.util.nowIso(), decidedAt: "", pct: pct
      };
      reviews.push(rev);

      /* 工作台人工闸门：把决策权交给 UI，拿到结果后再迁移状态 */
      if (typeof opts.onHitl === "function") {
        var approved = await opts.onHitl({
          gate: "budget", budgetCny: budget, costCny: stats.costCny, pct: pct, threshold: 0.8
        });
        var decision = approved ? "approve" : "reject";
        bus.emit("hitl.decided", {
          gate: "budget", decision: decision, by: "human:ui", note: "工作台审批", pct: pct
        });
        state = next(state, approved ? "hitl.approve" : "hitl.reject");
        rev.decision = decision; rev.by = "human:ui"; rev.decidedAt = RT.util.nowIso();
        rev.note = "工作台审批";
        return { pct: pct, handled: true, rejected: !approved };
      }
      return { pct: pct, handled: false, rejected: false };
    }

    async function callTool(toolId, args, stepNo) {
      if (banned.indexOf(toolId) >= 0) throw new Error("工具被护栏禁用：" + toolId);
      bus.emit("tool.call", { step: stepNo, tool: toolId, args: args || {} });
      var res = await registry.call(toolId, args || {}, { speed: speed });
      var c = costOf(res.usage, price);
      stats.toolCalls += 1;
      stats.tokens += res.usage.tokens;
      stats.images += res.usage.images || 0;
      stats.costCny = RT.util.round4(stats.costCny + c);
      bus.emit("tool.result", {
        step: stepNo, tool: toolId, ok: true,
        delayMs: res.delayMs, waitedMs: res.waitedMs,
        usage: res.usage, out: summariseOut(toolId, res.out),
        model: res.model || "", provider: res.provider || "",
        degraded: !!res.degraded, degradedReason: res.degradedReason || ""
      }, c);
      return res;
    }

    async function stopBlocked() {
      stats.durationMs = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0));
      var runBlocked = buildRun("blocked");
      await S.put("runs", runBlocked);
      await S.putMany("traces", bus.events());
      if (reviews.length) await S.putMany("reviews", reviews);
      mission.status = "blocked"; mission.updatedAt = RT.util.nowIso();
      await S.put("missions", mission);
      return { runId: runId, state: "blocked", stopped: true, run: runBlocked, traces: bus.events(), artifacts: [], reviews: reviews };
    }

    async function stopFailed() {
      stats.durationMs = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0));
      var runFailed = buildRun("failed");
      await S.put("runs", runFailed);
      await S.putMany("traces", bus.events());
      if (reviews.length) await S.putMany("reviews", reviews);
      mission.status = "failed"; mission.updatedAt = RT.util.nowIso();
      await S.put("missions", mission);
      return { runId: runId, state: "failed", stopped: true, run: runFailed, traces: bus.events(), artifacts: [], reviews: reviews };
    }

    function buildRun(status) {
      return {
        id: runId, missionId: mission.id, agentId: agent.id, mode: opts.mode || "mock",
        status: status, plan: { steps: steps, meta: meta }, stats: Object.assign({}, stats),
        startedAt: startedAt, endedAt: RT.util.nowIso()
      };
    }

    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      stats.steps += 1;
      bus.emit("step.start", { step: step.no, label: step.label, calls: step.calls.length });
      state = next(state, "step.start");

      for (var j = 0; j < step.calls.length; j++) {
        var call = step.calls[j];

        if (call.tool === "image.gen" && !call.args.prompts) call.args.prompts = ctx.prompts;
        if (call.tool === "qa.check" && !call.args.images) {
          call.args.images = ctx.images;
          if (opts.injectFail && !ctx.qaFailedOnce) { call.args.forceFail = true; ctx.qaFailedOnce = true; }
        }
        if (call.tool === "copy.write" && !call.args.channelIds) call.args.channelIds = ctx.channelIds;
        if (call.tool === "artifact.land") {
          call.args.copies = ctx.copies;
          call.args.images = ctx.images;
          call.args.qa = ctx.qa || { verdict: "pass", score: 0, checks: [], issues: [] };
          call.args.seqBase = (await S.count("artifacts")) + 1;
          call.args.runId = runId;
        }

        var res = await callTool(call.tool, call.args, step.no);

        if (call.tool === "product.get") ctx.product = res.out;
        if (call.tool === "brand.recall") ctx.brand = res.out;
        if (call.tool === "channel.spec") { ctx.channelIds = res.out.channels.map(function (c) { return c.id; }); }
        if (call.tool === "template.pick") ctx.templates = res.out.templates;
        if (call.tool === "prompt.compile") ctx.prompts = res.out.prompts;
        if (call.tool === "image.gen") ctx.images = res.out.images;
        if (call.tool === "copy.write") ctx.copies = res.out.copies;

        if (call.tool === "qa.check") {
          ctx.qa = res.out;
          bus.emit("critic.verdict", { step: step.no, round: 1, verdict: res.out.verdict, score: res.out.score, issues: res.out.issues });
          if (res.out.verdict !== "pass" && stats.retries < maxRetry) {
            stats.retries += 1;
            var promptDelta = "修正：" + res.out.issues.join("；") + "；按品牌色卡重绘，目标主色 ≥35%、安全区 ≥48px";
            bus.emit("retry.scheduled", { step: step.no, attempt: stats.retries, tool: "image.gen", reason: res.out.issues, promptDelta: promptDelta });
            state = next(state, "retry.scheduled");
            var fix = await callTool("image.gen", { prompts: ctx.prompts, fix: true }, step.no);
            ctx.images = fix.out.images;
            var again = await callTool("qa.check", { images: ctx.images, forceFail: false }, step.no);
            ctx.qa = again.out;
            bus.emit("critic.verdict", { step: step.no, verdict: again.out.verdict, score: again.out.score, issues: again.out.issues, round: 2 });
          }
        }

        if (call.tool === "artifact.land") {
          drafts = res.out.artifacts.map(function (a) { return Object.assign({}, a, { runId: runId, status: "review" }); });
          bus.emit("artifact.landed", { count: drafts.length, ids: drafts.map(function (a) { return a.id; }), gate: "publish" });
          state = next(state, "artifact.landed");
        }

        var gate = await checkBudget();
        if (gate) {
          if (gate.rejected) return await stopFailed();
          if (gate.handled) continue;
          if (opts.autoApproveBudget === false) return await stopBlocked();
          bus.emit("hitl.decided", { gate: "budget", decision: "approve", by: "human:auto", note: "自检自动放行", pct: gate.pct });
          state = next(state, "hitl.approve");
          var r0 = reviews[reviews.length - 1];
          r0.decision = "approve"; r0.by = "human:auto"; r0.decidedAt = RT.util.nowIso();
        }
      }
    }

    stats.durationMs = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0));
    stats.costCny = bus.sumCost();
    bus.emit("run.finished", { status: state, stats: Object.assign({}, stats) });

    var finalRun = buildRun(state);
    finalRun.stats = Object.assign({}, stats);

    await S.putMany("traces", bus.events());
    await S.putMany("artifacts", drafts);
    if (reviews.length) await S.putMany("reviews", reviews);
    await S.put("runs", finalRun);
    mission.status = state;
    mission.updatedAt = RT.util.nowIso();
    await S.put("missions", mission);

    return { runId: runId, state: state, run: finalRun, traces: bus.events(), artifacts: drafts, reviews: reviews };
  }

  RT.Executor = {
    TRANSITIONS: TRANSITIONS,
    PLAN_STEPS: 7,
    PLAN_CALLS: 9,
    next: next,
    plan: plan,
    demoMission: demoMission,
    run: function (mission, opts) { return execute(mission, opts); },
    costOf: costOf
  };
})(window.OVEM_RT);
