/* ============================================================
   OVEM 运行时 · Selftest（A2 套件）
   ------------------------------------------------------------
   RT.selftest.run() → { suite, at, cases[], summary, runs[] }
   A2-01 建库与索引 / A2-02 九工具契约 / A2-03 延迟与计价
   A2-04 端到端 7 步 9 调用 / A2-05 质检重试 / A2-06 预算闸门
   A2-07 成本对账
   自检默认 speed=8（仅缩短实际等待，不改变契约 delayMs）。
   ============================================================ */
window.OVEM_RT = window.OVEM_RT || {};
(function (RT) {
  "use strict";

  function typeOk(v, t) {
    if (t === "array") return Array.isArray(v) && v.length > 0;
    if (t === "number") return typeof v === "number" && isFinite(v);
    if (t === "boolean") return typeof v === "boolean";
    if (t === "string") return typeof v === "string" && v.length > 0;
    return false;
  }
  function pad(n, w) { return String(n).padStart(w || 3, "0"); }

  async function run(ids) {
    var wanted = ids && ids.length ? ids : ["A2-01", "A2-02", "A2-03", "A2-04", "A2-05", "A2-06", "A2-07"];
    var cases = [];
    var ctx = { samples: [], run04: null, run05: null, run06: null };

    async function step(id, name, fn) {
      if (wanted.indexOf(id) < 0) return;
      var t0 = performance.now();
      var r;
      try { r = await fn(); } catch (e) { r = { ok: false, detail: "异常：" + (e && e.message || e) }; }
      cases.push({ id: id, name: name, ok: !!r.ok, ms: Math.round(performance.now() - t0), detail: r.detail || "" });
    }

    /* A2-01 建库与索引（只验证结构，不 reset：避免自检抹掉工作台历史 run） */
    await step("A2-01", "6 store / 18 索引 · version=1", async function () {
      var info = await RT.Store.info();
      var ok = info.mode === "idb" && info.version === 1 && info.storeCount === 6 && info.indexCount === 18;
      return { ok: ok, detail: "mode=" + info.mode + " · version=" + info.version + " · stores=" + info.storeCount + "/6 · indexes=" + info.indexCount + "/18" };
    });

    /* A2-02 九工具契约 */
    await step("A2-02", "9 个工具 happy path 结构符合 io.out", async function () {
      var reg = RT.Tools.create({ data: window.OVEM_DATA, agent: window.OVEM_AGENT });
      var chs = ["c01", "c02", "c06"];
      var calls = [];
      var out = {};
      out.product = (await reg.call("product.get", { productId: "p01" }, { speed: 20 })).out;
      out.brand = (await reg.call("brand.recall", {}, { speed: 20 })).out;
      out.spec = (await reg.call("channel.spec", { channelIds: chs }, { speed: 20 })).out;
      out.tpl = (await reg.call("template.pick", { channelIds: chs }, { speed: 20 })).out;
      out.prompts = (await reg.call("prompt.compile", { productId: "p01", channelIds: chs }, { speed: 20 })).out;
      out.images = (await reg.call("image.gen", { prompts: out.prompts.prompts }, { speed: 20 })).out;
      out.qa = (await reg.call("qa.check", { images: out.images.images }, { speed: 20 })).out;
      out.copies = (await reg.call("copy.write", { productId: "p01", channelIds: chs }, { speed: 20 })).out;
      out.arts = (await reg.call("artifact.land", { productId: "p01", copies: out.copies.copies, images: out.images.images, qa: out.qa, seqBase: 1, runId: "R-S2" }, { speed: 20 })).out;

      var pairs = [
        ["product.get", out.product], ["brand.recall", out.brand], ["channel.spec", out.spec],
        ["template.pick", out.tpl], ["prompt.compile", out.prompts], ["image.gen", out.images],
        ["qa.check", out.qa], ["copy.write", out.copies], ["artifact.land", out.arts]
      ];
      var bad = [];
      pairs.forEach(function (pair) {
        var id = pair[0], obj = pair[1], exp = RT.Tools.EXPECT[id] || {};
        Object.keys(exp).forEach(function (k) {
          if (!typeOk(obj[k], exp[k])) bad.push(id + "." + k + "≠" + exp[k]);
        });
      });
      ctx.samples = pairs.map(function (p) { return p[0]; });
      return { ok: bad.length === 0, detail: bad.length ? bad.join("；") : "9/9 工具结构符合 · artifact " + out.arts.artifacts.length + " 个" };
    });

    /* A2-03 延迟范围与计价 */
    await step("A2-03", "mock 延迟 ∈ [800,2400] · 计价按单价累加误差 0", async function () {
      var reg = RT.Tools.create({ data: window.OVEM_DATA, agent: window.OVEM_AGENT });
      var chs = ["c01", "c02", "c06"];
      var samples = [];
      var outs = {};
      async function c(id, args) {
        var r = await reg.call(id, args, { speed: 20 });
        samples.push({ id: id, delayMs: r.delayMs, usage: r.usage });
        return r.out;
      }
      outs.p = await c("product.get", { productId: "p01" });
      await c("brand.recall", {});
      var spec = await c("channel.spec", { channelIds: chs });
      await c("template.pick", { channelIds: chs });
      var prompts = await c("prompt.compile", { productId: "p01", channelIds: chs });
      var imgs = await c("image.gen", { prompts: prompts.prompts });
      var qa = await c("qa.check", { images: imgs.images });
      var copies = await c("copy.write", { productId: "p01", channelIds: chs });
      await c("artifact.land", { productId: "p01", copies: copies.copies, images: imgs.images, qa: qa, seqBase: 1 });

      var outOfRange = samples.filter(function (s) { return s.delayMs < 800 || s.delayMs > 2400; }).map(function (s) { return s.id + "=" + s.delayMs; });
      var tokens = samples.reduce(function (a, s) { return a + s.usage.tokens; }, 0);
      var images = samples.reduce(function (a, s) { return a + (s.usage.images || 0); }, 0);
      var expect = Math.round(((tokens / 1000) * 0.004 + images * 0.03) * 10000) / 10000;
      var actual = RT.Executor.costOf({ tokens: tokens, images: images }, RT.Tools.PRICE);
      ctx.cost03 = { tokens: tokens, images: images, expect: expect, actual: actual };
      return {
        ok: outOfRange.length === 0 && Math.abs(expect - actual) === 0,
        detail: "9 次延迟 " + Math.min.apply(null, samples.map(function (s) { return s.delayMs; })) + "–" + Math.max.apply(null, samples.map(function (s) { return s.delayMs; }))
          + "ms · " + tokens + " tokens · " + images + " 图 · ¥" + actual + "（误差 0）"
      };
    });

    /* A2-04 端到端 */
    await step("A2-04", "一条 M-A 端到端：7 步 / 9 调用 / 终态 review", async function () {
      var mission = RT.Executor.demoMission({ id: "M-261120-01" });
      var r = await RT.Executor.run(mission, { speed: 8, mode: "mock" });
      ctx.run04 = r;
      var ev = r.traces;
      var steps = ev.filter(function (e) { return e.type === "step.start"; }).length;
      var calls = ev.filter(function (e) { return e.type === "tool.call"; }).length;
      var results = ev.filter(function (e) { return e.type === "tool.result"; }).length;
      return {
        ok: steps === 7 && calls === 9 && results === 9 && r.state === "review" && r.run.stats.steps === 7,
        detail: steps + " steps / " + calls + " calls / " + results + " results · 终态 " + r.state + " · ¥" + r.run.stats.costCny + " · " + r.run.stats.durationMs + "ms"
      };
    });

    /* A2-05 质检不通过 → 重试一次 */
    await step("A2-05", "注入质检不通过 → retry.scheduled → 第二轮通过", async function () {
      var mission = RT.Executor.demoMission({ id: "M-261120-02", title: "P01 质检重试演示" });
      var r = await RT.Executor.run(mission, { speed: 8, injectFail: 1 });
      ctx.run05 = r;
      var retry = r.traces.filter(function (e) { return e.type === "retry.scheduled"; }).length;
      var gen = r.traces.filter(function (e) { return e.type === "tool.call" && e.payload.tool === "image.gen"; }).length;
      var verdicts = r.traces.filter(function (e) { return e.type === "critic.verdict"; });
      var last = verdicts[verdicts.length - 1];
      return {
        ok: retry >= 1 && gen === 2 && r.state === "review" && last && last.payload.verdict === "pass",
        detail: "retry=" + retry + " · image.gen=" + gen + " 次 · 终态 " + r.state + " · 最后一轮 " + (last ? last.payload.verdict : "?")
      };
    });

    /* A2-06 预算闸门 */
    await step("A2-06", "预算 ≥80% → hitl.requested，状态 blocked", async function () {
      var mission = RT.Executor.demoMission({
        id: "M-261120-03", title: "预算闸门演示",
        constraints: { budgetCny: 0.1, mustInclude: [] }
      });
      var r = await RT.Executor.run(mission, { speed: 8, autoApproveBudget: false });
      ctx.run06 = r;
      var hitl = r.traces.filter(function (e) { return e.type === "hitl.requested"; })[0];
      return {
        ok: !!hitl && r.state === "blocked" && hitl.payload.gate === "budget" && hitl.payload.pct >= 0.8,
        detail: "hitl=" + (hitl ? "1 次 · pct=" + hitl.payload.pct : "无") + " · 终态 " + r.state + " · 已花费 ¥" + (hitl ? hitl.payload.costCny : "-")
      };
    });

    /* A2-07 成本对账 */
    await step("A2-07", "run.finished 存在，stats.costCny = trace 累加值", async function () {
      var r = ctx.run04;
      if (!r) return { ok: false, detail: "A2-04 未执行，无对账样本" };
      var fin = r.traces.filter(function (e) { return e.type === "run.finished"; })[0];
      var sum = Math.round(r.traces.reduce(function (a, e) { return a + (e.costCny || 0); }, 0) * 10000) / 10000;
      var diff = Math.round((r.run.stats.costCny - sum) * 10000) / 10000;
      return {
        ok: !!fin && diff === 0,
        detail: "run.finished " + (fin ? "存在" : "缺失") + " · stats ¥" + r.run.stats.costCny + " / trace ¥" + sum + " · 差值 " + diff
      };
    });

    var summary = {
      total: cases.length,
      passed: cases.filter(function (c) { return c.ok; }).length,
      failed: cases.filter(function (c) { return !c.ok; }).length
    };
    return {
      suite: "A2",
      generatedAt: new Date().toISOString(),
      cases: cases,
      summary: summary,
      runs: [ctx.run04, ctx.run05, ctx.run06].filter(Boolean).map(function (r) {
        return {
          runId: r.runId, state: r.state,
          stats: r.run.stats,
          traceCount: r.traces.length,
          artifactIds: (r.artifacts || []).map(function (a) { return a.id; })
        };
      })
    };
  }

  RT.selftest = { run: run };
})(window.OVEM_RT);

