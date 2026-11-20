/* ============================================================
   OVEM P0 · Agent 嵌入卡（B3 运行态）
   ------------------------------------------------------------
   默认占据 P0 原“企业宣传片”位置，展示 content-orchestrator
   最近一条可用运行；品牌片仍保留在同一位置，可切换查看。
   数据优先级：IndexedDB 成果层 → 同源 /api/runs（登录后）
                → data/ovem-demo-run.js 静态演示 → 空态
   优先使用成果层，保证 P0 卡与 P4/P7、P0 血缘摘要始终是同一 run；
   仅在没有本地 run 时采用服务端或静态演示数据。
   静态托管（GitHub Pages）没有 Node/SQLite，使用固定演示 run；
   不修改 17 页正文以外的任何页面。
   ============================================================ */
(function () {
  "use strict";

  var CARD = document.getElementById("p0AgentCard");
  if (!CARD) return;

  var STEP_LABELS = ["取产品卡", "召回约束", "选版式", "编译 Prompt", "生成图片", "质检裁决", "落库"];
  var STEP_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];

  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function money(n) {
    var v = Number(n);
    return "¥" + (isFinite(v) ? v.toFixed(2) : "0.00");
  }
  function timeText(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return d.toLocaleString("zh-CN", {
        hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
      });
    } catch (e) { return String(iso); }
  }
  function durationText(ms) {
    var n = Number(ms) || 0;
    return n >= 1000 ? (Math.round(n / 100) / 10).toFixed(1) + "s" : n + "ms";
  }
  function statusText(s) {
    return ({
      review: "待审", done: "已发布", failed: "失败", blocked: "预算暂停",
      running: "运行中", planned: "已计划"
    })[s] || "READY";
  }
  function statusClass(s) {
    return ({ review: "is-review", done: "is-done", failed: "is-failed", blocked: "is-failed" })[s] || "";
  }
  function sourceLabel(s) {
    return ({ server: "服务端", local: "本地回放", static: "静态演示" })[s] || "服务端";
  }
  function isGithubPages() {
    return /\.github\.io$/i.test(location.hostname);
  }
  function pickRun(runs) {
    if (!runs || !runs.length) return null;
    return runs.filter(function (r) { return r.status === "review"; })[0]
      || runs.filter(function (r) { return r.status === "done"; })[0]
      || runs[0];
  }
  function artifactCount(run, fallback) {
    if (fallback != null) return Number(fallback) || 0;
    var st = run && run.stats || {};
    var meta = run && run.plan && run.plan.meta || {};
    return Number(st.images || (meta.channelIds || []).length || 0);
  }
  function stepState(run, index, done) {
    if (!run) return "";
    var status = run.status;
    if (status === "review" || status === "done") return "is-ok";
    if (status === "failed") {
      if (index <= done) return "is-ok";
      if (index === done + 1) return "is-fail";
      return "is-blocked";
    }
    if (status === "blocked") {
      if (index <= done) return "is-ok";
      return "is-blocked";
    }
    if (status === "running") {
      if (index <= done) return "is-ok";
      if (index === done + 1) return "is-run";
    }
    return "";
  }

  function renderSteps(run, done) {
    var host = q("#paSteps");
    if (!host) return;
    var planSteps = run && run.plan && run.plan.steps || [];
    host.innerHTML = STEP_LABELS.map(function (label, i) {
      var actual = planSteps[i] && planSteps[i].label;
      var text = actual ? actual.replace(/^s[0-9]+$/, label) : label;
      if (text.length > 9) text = text.slice(0, 8) + "…";
      var cls = stepState(run, i + 1, done);
      return '<span data-step="' + (i + 1) + '"' + (STEP_KEYS[i] ? ' data-id="' + STEP_KEYS[i] + '"' : "")
        + ' class="' + cls + '"><b>' + ("0" + (i + 1)).slice(-2) + "</b> " + esc(text) + "</span>";
    }).join("");
  }

  /* 展示 run 优先时，同步 P0 顶部血缘条与底部摘要，避免同一屏两套口径 */
  function syncP0Run(run, source) {
    if (!run) return;
    var st = run.stats || {};
    var done = Math.max(0, Math.min(7, Number(st.steps) || 0));
    var status = run.status || "review";
    var count = artifactCount(run);
    var src = sourceLabel(source);

    var strip = q("#view-p0 .ln-strip");
    if (strip) {
      strip.setAttribute("data-run-id", run.id || "");
      var meta = q(".ln-meta", strip);
      if (meta) {
        meta.innerHTML = '<span class="ln-run">' + esc(run.id || "—") + " · "
          + esc(timeText(run.endedAt || run.startedAt)) + "</span>"
          + '<span class="ln-badge ' + (status === "review" ? "is-review" : status === "done" ? "is-done" : status === "failed" ? "is-failed" : status === "blocked" ? "is-blocked" : "is-idle") + '">● '
          + esc(statusText(status)) + "</span>"
          + '<a class="ln-link" href="workbench.html#/runs">运行档案 →</a>';
      }
    }

    var sum = q("#lineageRunSummary");
    if (sum) {
      sum.setAttribute("data-run-id", run.id || "");
      sum.setAttribute("data-cost", String(st.costCny == null ? "" : st.costCny));
      sum.innerHTML = '<div><h4>P0 展示运行 · ' + esc(run.id || "—") + " · " + esc(run.missionId || "") + "</h4>"
        + "<p>" + esc(timeText(run.startedAt)) + " → " + esc(timeText(run.endedAt)) + " · " + esc(run.agentId || "content-orchestrator")
        + " · " + esc(run.mode || "mock") + " · <span style=\"color:var(--brand-2);font-weight:600\">" + esc(statusText(status)) + "</span>"
        + " · " + esc(src) + "</p></div>"
        + '<div class="ln-sum-stats">'
        + "<div><b>" + done + "/7</b><span>步骤</span></div>"
        + "<div><b>" + Number(st.toolCalls || 0) + "</b><span>工具调用</span></div>"
        + "<div><b>" + money(st.costCny) + "</b><span>成本</span></div>"
        + "<div><b>" + count + "</b><span>产物</span></div>"
        + "<div><b>" + durationText(st.durationMs) + "</b><span>耗时</span></div>"
        + "</div>";
    }
  }

  function render(data) {
    var run = data && data.run;
    var st = run && run.stats || {};
    var done = Math.max(0, Math.min(7, Number(st.steps) || 0));
    var status = run ? (run.status || "review") : "ready";
    var count = artifactCount(run, data && data.artifactCount);
    var source = data && data.source;
    var src = run ? sourceLabel(source) : "本地演示";
    var sourceNode = q("#p0MediaSource");
    if (sourceNode) sourceNode.textContent = source === "static" ? "B3 · STATIC" : "B3 · LOCAL";

    var statusNode = q("#paStatus");
    if (statusNode) {
      statusNode.textContent = statusText(status);
      statusNode.className = "pa-state " + statusClass(status);
    }
    var meta = q("#paMeta");
    if (meta) {
      meta.textContent = run
        ? [run.id || "—", run.missionId || "—", run.mode || "mock", done + "/7 步"].join(" · ")
        : "等待一条 Mission · 7 步 / 9 调用";
    }
    var stepCount = q("#paStepCount");
    if (stepCount) stepCount.textContent = run ? done + "/7" : "—";
    var calls = q("#paCalls");
    if (calls) calls.textContent = run ? String(Number(st.toolCalls) || 0) : "—";
    var cost = q("#paCost");
    if (cost) cost.textContent = run ? money(st.costCny) : "—";
    var artifacts = q("#paArtifacts");
    if (artifacts) artifacts.textContent = run ? String(count) : "—";
    var runNode = q("#paRun");
    if (runNode) runNode.textContent = run
      ? run.id + " · " + statusText(status) + " · " + src
      : "尚无运行记录 · 去跑一条";
    renderSteps(run, done);
  }

  async function loadServer() {
    if (!/^https?:/.test(location.protocol) || isGithubPages()) return null;
    try {
      var res = await fetch("/api/runs", {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) return null;
      var body = await res.json();
      var run = pickRun(body && body.runs || []);
      if (!run) return null;
      return { run: run, source: "server", artifactCount: artifactCount(run) };
    } catch (e) {
      return null;
    }
  }

  async function loadLocal() {
    if (!window.OVEM_LINEAGE) return null;
    try {
      await window.OVEM_LINEAGE.refresh();
      var state = window.OVEM_LINEAGE.state || {};
      if (!state.run) return null;
      return {
        run: state.run,
        source: "local",
        artifactCount: (state.artifacts || []).length
      };
    } catch (e) {
      return null;
    }
  }

  function loadStatic() {
    var demo = window.OVEM_DEMO_RUN;
    if (!demo || !demo.id) return null;
    return {
      run: demo,
      source: "static",
      artifacts: demo.artifacts || [],
      artifactCount: artifactCount(demo)
    };
  }

  /* 静态演示时把同一 run/artifacts 写回成果层，避免 P0 与 P4/P7 口径分裂 */
  function applyStaticRun(stat) {
    if (!stat || !window.OVEM_LINEAGE || !window.OVEM_LINEAGE.applyDisplayRun) return;
    window.OVEM_LINEAGE.applyDisplayRun(stat.run, stat.artifacts, "static");
  }

  async function waitLineage() {
    if (!window.OVEM_LINEAGE) return false;
    try {
      await window.OVEM_LINEAGE.refresh();
      return !!(window.OVEM_LINEAGE.state && window.OVEM_LINEAGE.state.run);
    } catch (e) {
      return false;
    }
  }

  function setMedia(mode) {
    var agent = q("#p0AgentCard");
    var film = q('[data-p0media-panel="film"]');
    var video = q("#heroVideo");
    var caption = q("#p0MediaCaption");
    var tabs = qa("[data-p0media]");
    var isFilm = mode === "film";
    if (agent) agent.hidden = isFilm;
    if (film) film.hidden = !isFilm;
    tabs.forEach(function (btn) {
      var on = btn.getAttribute("data-p0media") === mode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (caption) {
      caption.innerHTML = isFilm
        ? '品牌主视觉 · 企业宣传片 / 2025–2026 Edition'
        : 'Agent runtime · content-orchestrator / B3 演示 · <a href="workbench.html#/runs">运行档案 →</a>';
    }
    if (video) {
      if (isFilm) {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        video.pause();
      }
    }
  }

  function bindTabs() {
    qa("[data-p0media]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setMedia(btn.getAttribute("data-p0media") === "film" ? "film" : "agent");
      });
    });
    setMedia("agent");
  }

  async function boot() {
    bindTabs();
    render(null);
    /* 成果层优先：P0 卡与 P4/P7、P0 摘要共用同一条 run */
    var local = await loadLocal();
    if (local) {
      render(local);
      return;
    }
    var server = await loadServer();
    if (server) {
      await waitLineage();
      render(server);
      syncP0Run(server.run, server.source);
      return;
    }
    var stat = loadStatic();
    if (stat) {
      await waitLineage();
      applyStaticRun(stat);
      render(stat);
      syncP0Run(stat.run, stat.source);
      return;
    }
    render(null);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
