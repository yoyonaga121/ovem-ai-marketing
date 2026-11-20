/* ============================================================
   OVEM 工作台 · 壳层 UI（S3）
   ------------------------------------------------------------
   职责：编排与呈现，不写业务数据；所有状态由 runtime 事件驱动。
   视图：工作台 / 执行 / 成果视图 / 评测 / 配置中台 / 架构说明。
   自检：workbench.html?selftest=1 → window.__WB_SELFTEST__（A3）
   ============================================================ */
window.OVEM_RT = window.OVEM_RT || {};
(function (RT) {
  "use strict";

  var DATA = window.OVEM_DATA;
  var AGENT = window.OVEM_AGENT;
  var SCHEMA = window.OVEM_SCHEMA;
  var PAGES = (SCHEMA && SCHEMA.pages) || [];

  var PAGE_GROUPS = [
    { key: "成果", ids: ["p0", "p3", "p4", "p7", "p13"], note: "可直接对外演示的成品页" },
    { key: "知识", ids: ["p2"], note: "品牌资产与规范底座" },
    { key: "策略", ids: ["p1", "p10", "p14", "p15"], note: "目标、产品线与商业判断" },
    { key: "执行", ids: ["p5", "p6", "p8", "p9"], note: "内容生产与渠道分发" },
    { key: "复盘", ids: ["p11"], note: "结果回看与 SOP 沉淀" },
    { key: "文档", ids: ["p12", "p16"], note: "PRD 与方法论" }
  ];

  var PRESETS = [
    {
      key: "A", missionId: "M-261120-01", title: "P01 · W3 旗舰物料包", tag: "正常链路", tone: "green",
      brief: "给 P01 出一套 W3 旗舰物料包：官网首屏（1920×1080）、移动端（750×1334）、小红书（3:4）三渠道，预算 ¥200。",
      productIds: ["p01"], channelIds: ["c01", "c02", "c06"], budget: 200,
      mustInclude: ["官网首屏", "社媒 3:4"], expect: "7 步 / 9 调用 · review"
    },
    {
      key: "B", missionId: "M-261120-02", title: "P01 · 质检重试", tag: "Critic 介入", tone: "amber",
      brief: "同一套物料，首轮质检注入「主色占比 33.4% < 35%」的失败。观察 Critic 如何给出修正指令、重跑 image.gen 并在第二轮通过。",
      productIds: ["p01"], channelIds: ["c01", "c02", "c06"], budget: 200,
      mustInclude: ["官网首屏", "社媒 3:4"], injectFail: true, expect: "重试 1 次 · 两轮 verdict"
    },
    {
      key: "C", missionId: "M-261120-03", title: "P01 · 预算闸门", tag: "Human-in-the-loop", tone: "cyan",
      brief: "把任务预算压到 ¥0.10，跑到第 5 步会越过 80% 闸门。工作台弹出审批，由你决定批准继续，还是驳回终止。",
      productIds: ["p01"], channelIds: ["c01", "c02", "c06"], budget: 0.1,
      mustInclude: [], expect: "pct≈108% · 人工决策"
    }
  ];

  var S = {
    view: "workbench", preset: "A", mode: "mock", speed: 8, running: false,
    plan: null, traces: [], artifacts: [], stats: null, retry: null, lastFail: null,
    status: "idle", runId: null, firstResult: false, startedAt: 0, gate: null, gateResolve: null,
    autoGate: false, seenStates: {}, sessionRuns: [], focusPage: null, currentBudget: 200
  };

  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function id(n) { return document.getElementById(n); }
  function txt(n, v) { var e = id(n); if (e) e.textContent = v; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function money(n) { return "¥" + (Number(n) || 0).toFixed(2); }
  function money4(n) { return "¥" + (Number(n) || 0).toFixed(4); }
  function ratioText(r) {
    if (!r) return "";
    if (typeof r === "string") return r;
    return (r.w && r.h) ? (r.w + ":" + r.h) : "";
  }
  function presetOf(key) { return PRESETS.filter(function (p) { return p.key === key; })[0] || PRESETS[0]; }
  function pageOf(pid) { return PAGES.filter(function (p) { return p.id === pid; })[0] || { id: pid, no: pid.toUpperCase(), name: pid }; }
  function channelOf(cid) {
    var idx = Number(String(cid || "").replace("c", "")) - 1;
    return (DATA.channels && DATA.channels[idx]) || { name: cid || "渠道", size: "" };
  }
  function pctText(n) { return Math.round((Number(n) || 0) * 100) + "%"; }

  /* ---------- 初始化 ---------- */
  function init() {
    buildPresets();
    buildSite();
    bind();
    selectPreset("A", true);
    updateProvider();
    route();
    refreshRail();
    renderAll();
    var qs = new URLSearchParams(location.search);
    if (qs.get("selftest") === "1") {
      runSelftest().then(showBadge);
    }
  }

  function bind() {
    qa("#modeSeg button").forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.dataset.mode); });
    });
    id("speedSelect").addEventListener("change", function (e) { setSpeed(e.target.value); });
    id("runBtn").addEventListener("click", function () { startRun(S.preset, {}).catch(function () {}); });
    id("refreshRuns").addEventListener("click", refreshHistory);
    id("copyTrace").addEventListener("click", copyTrace);
    id("gateApprove").addEventListener("click", function () { decideGate(true); });
    id("gateReject").addEventListener("click", function () { decideGate(false); });
    qa(".nav-item").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        location.hash = a.getAttribute("href");
      });
    });
    window.addEventListener("hashchange", route);
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); startRun(S.preset, {}).catch(function () {}); }
    });
  }

  function buildPresets() {
    var wrap = id("presetList");
    wrap.innerHTML = PRESETS.map(function (p) {
      return '<button type="button" class="preset" data-preset="' + p.key + '">' +
        '<div class="preset-top"><span class="preset-key">' + p.key + '</span><span class="preset-title">' + esc(p.title) + '</span>' +
        '<span class="preset-tag ' + p.tone + '">' + esc(p.tag) + '</span></div>' +
        '<div class="preset-meta"><span>' + p.channelIds.length + ' 渠道</span><span>预算 ' + money(p.budget) + '</span><span>' + esc(p.expect) + '</span></div>' +
        '</button>';
    }).join("");
    qa(".preset", wrap).forEach(function (b) {
      b.addEventListener("click", function () { selectPreset(b.dataset.preset); });
    });
  }

  function buildSite() {
    var wrap = id("siteGroups");
    var html = PAGE_GROUPS.map(function (g) {
      var pages = g.ids.map(pageOf);
      return '<div class="group-block" id="group-' + esc(g.key) + '">' +
        '<div class="group-head"><h3>' + esc(g.key) + '</h3><span>' + pages.length + ' PAGES</span><em>' + esc(g.note) + '</em></div>' +
        '<div class="page-grid">' + pages.map(function (p) {
          return '<a class="page-card page-link" data-page="' + esc(p.id) + '" href="index.html#' + esc(p.id) + '">' +
            '<span class="pc-arrow">↗</span><div class="pc-no">' + esc(p.no) + '</div><b>' + esc(p.name) + '</b><p>' + esc(p.desc || "") + '</p></a>';
        }).join("") + '</div></div>';
    }).join("");
    wrap.innerHTML = html;
    txt("siteCount", PAGES.length + "/17");
    txt("filterAllCount", String(PAGES.length));

    /* B1：17 个 tab 按 pages[] 排序；正文不复制，只换容器 */
    var tabs = id("pageTabs");
    tabs.innerHTML = PAGES.map(function (p) {
      var group = pageGroupOf(p.id);
      return '<button type="button" class="page-tab" role="tab" data-page="' + esc(p.id) + '" data-group="' + esc(group) +
        '" aria-selected="false" title="' + esc(p.name) + '">' +
        '<span class="pt-dot"></span><span class="pt-no">' + esc(p.no) + '</span><span>' + esc(p.name) + '</span></button>';
    }).join("");
    qa(".page-tab", tabs).forEach(function (b) {
      b.addEventListener("click", function () { selectPage(b.dataset.page, true); });
    });

    /* 隐藏的分组索引保留给 A3 自检与无障碍外链；页面正文仍只有 index.html 一份 */
    qa("#siteGroups .page-link").forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        selectPage(a.dataset.page, true);
      });
    });

    qa("#siteFilters .site-filter").forEach(function (b) {
      b.addEventListener("click", function () { filterSite(b.dataset.group); });
    });
    id("pageFrameReload").addEventListener("click", function () { reloadPageFrame(); });
    id("pageFrame").addEventListener("load", function () {
      var frame = id("pageFrame");
      if (frame.dataset.page) frame.dataset.loaded = frame.dataset.page;
      id("pageFrameFallback").hidden = true;
      if (S.pageLoadTimer) { clearTimeout(S.pageLoadTimer); S.pageLoadTimer = null; }
      txt("siteFrameState", "IFRAME · READY");
    });
    id("pageFrame").addEventListener("error", function () { showPageFallback(); });
  }

  function pageGroupOf(pid) {
    var g = PAGE_GROUPS.filter(function (x) { return x.ids.indexOf(pid) >= 0; })[0];
    return g ? g.key : "其他";
  }

  function filterSite(group) {
    qa("#siteFilters .site-filter").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.group === group);
    });
    qa(".page-tab").forEach(function (b) {
      b.hidden = group !== "全部" && b.dataset.group !== group;
    });
    if (group !== "全部") {
      var cur = q(".page-tab.is-active");
      if (!cur || cur.hidden) {
        var first = qa(".page-tab").filter(function (b) { return !b.hidden; })[0];
        if (first) selectPage(first.dataset.page, true);
      }
    }
  }

  function selectPage(pid, updateHash) {
    var p = pageOf(pid);
    if (!p || !PAGES.length) return;
    S.focusPage = p.id;
    qa(".page-tab").forEach(function (b) {
      var on = b.dataset.page === p.id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    qa("#siteGroups .page-link").forEach(function (a) { a.classList.toggle("is-focus", a.dataset.page === p.id); });
    txt("pageFrameNo", p.no);
    txt("pageFrameTitle", p.name);
    txt("pageFrameDesc", p.desc || "");
    txt("pageFrameMeta", "iframe · index.html#" + p.id);
    var open = id("pageOpenNew");
    open.href = "index.html#" + p.id;
    var fallback = id("pageFallbackOpen");
    fallback.href = "index.html#" + p.id;
    var frame = id("pageFrame");
    var next = "index.html#" + p.id;
    id("pageFrameFallback").hidden = true;
    txt("siteFrameState", frame.dataset.loaded === p.id ? "IFRAME · READY" : "IFRAME · LOADING");
    if (frame.dataset.page !== p.id) {
      frame.dataset.page = p.id;
      frame.dataset.loaded = "";
      frame.src = next;
      if (S.pageLoadTimer) clearTimeout(S.pageLoadTimer);
      S.pageLoadTimer = setTimeout(function () {
        if (frame.dataset.loaded !== p.id) showPageFallback();
      }, 3200);
    }
    if (updateHash && location.hash !== "#/site/" + p.id) location.hash = "#/site/" + p.id;
  }

  function reloadPageFrame() {
    var frame = id("pageFrame");
    var p = S.focusPage || (PAGES[0] && PAGES[0].id) || "p0";
    frame.dataset.page = "";
    frame.dataset.loaded = "";
    selectPage(p, false);
  }

  function showPageFallback() {
    id("pageFrameFallback").hidden = false;
    txt("siteFrameState", "IFRAME · FALLBACK");
  }

  function selectPreset(key, silent) {
    if (S.running) return;
    S.preset = key;
    var p = presetOf(key);
    qa(".preset").forEach(function (b) { b.classList.toggle("is-selected", b.dataset.preset === key); });
    txt("briefText", p.brief);
    id("briefChips").innerHTML = p.channelIds.map(function (c) { return '<span class="chip">' + esc(channelOf(c).name) + '</span>'; }).join("") +
      '<span class="chip">预算 ' + money(p.budget) + '</span><span class="chip">' + esc(p.expect) + '</span>';
    txt("agentName", "content-orchestrator");
    txt("agentBudget", "mock · " + money(p.budget) + " / task");
    S.currentBudget = p.budget;
    if (!silent) resetRunView();
  }

  function resetRunView() {
    S.plan = null; S.traces = []; S.artifacts = []; S.stats = null; S.retry = null;
    S.status = "idle"; S.runId = null; S.firstResult = false; S.running = false;
    S.seenStates = {}; S.gate = null; S.gateResolve = null; S.lastFail = null;
    renderAll();
  }

  /* ---------- 视图路由 ---------- */
  function route() {
    var hash = location.hash || "#/workbench";
    var m = /^#(p\d+)$/.exec(hash);
    if (m) {
      S.focusPage = m[1];
      showView("site");
      selectPage(m[1], false);
      return;
    }
    var site = /^#\/site(?:\/(p\d+))?$/.exec(hash);
    if (site) {
      showView("site");
      selectPage(site[1] || S.focusPage || (PAGES[0] && PAGES[0].id) || "p0", false);
      return;
    }
    var name = hash.replace(/^#\//, "");
    showView(name || "workbench");
  }

  function showView(name) {
    if (!id("view-" + name)) name = "workbench";
    S.view = name;
    qa(".view").forEach(function (v) {
      var on = v.id === "view-" + name;
      v.hidden = !on;
      v.classList.toggle("is-active", on);
    });
    qa(".nav-item").forEach(function (a) { a.classList.toggle("is-active", a.dataset.view === name); });
    if (name === "runs") refreshHistory();
    if (name === "site") {
      var p = S.focusPage || (PAGES[0] && PAGES[0].id) || "p0";
      if (!S.focusPage) S.focusPage = p;
      if (id("pageFrame").dataset.page !== p) selectPage(p, false);
    }
  }

  function highlightFocus() {
    qa(".page-card").forEach(function (c) { c.classList.toggle("is-focus", c.dataset.page === S.focusPage); });
    qa(".group-block").forEach(function (b) {
      var has = qa(".page-card.is-focus", b).length > 0;
      b.classList.toggle("is-focus", has);
    });
    var card = q(".page-card.is-focus");
    if (card) setTimeout(function () { card.scrollIntoView({ block: "center", behavior: "smooth" }); }, 120);
  }

  /* ---------- 运行 ---------- */
  function makePlan(mission) {
    var plan = RT.Executor.plan(mission, AGENT);
    return plan.steps.map(function (s) {
      return {
        no: s.no, label: s.label, tools: s.calls.map(function (c) { return c.tool; }),
        expected: s.calls.length, state: "pending", retried: false
      };
    });
  }

  function startRun(key, opts) {
    opts = opts || {};
    if (S.running) return Promise.reject(new Error("已有 run 正在执行"));
    var p = presetOf(key);
    S.preset = key;
    var mission = RT.Executor.demoMission({
      id: p.missionId, title: p.title, brief: p.brief,
      productIds: p.productIds.slice(), channelIds: p.channelIds.slice(),
      constraints: { budgetCny: p.budget, mustInclude: (p.mustInclude || []).slice() }
    });
    S.running = true; S.autoGate = !!opts.autoGate; S.startedAt = performance.now();
    S.traces = []; S.artifacts = []; S.stats = null; S.retry = null; S.lastFail = null;
    S.status = "planned"; S.runId = null; S.firstResult = false; S.seenStates = {}; S.gate = null; S.gateResolve = null;
    S.currentBudget = p.budget;
    S.plan = makePlan(mission);
    selectPreset(key, true);
    showView("workbench");
    renderAll();

    var speed = Number(opts.speed) || (S.mode === "replay" ? 20 : S.speed);
    var runOpts = {
      agent: AGENT, data: DATA, speed: speed, mode: S.mode,
      injectFail: !!p.injectFail, onEvent: handleEvent
    };
    if (p.key === "C") {
      runOpts.onHitl = S.autoGate
        ? function () { return Promise.resolve(true); }
        : askGate;
    }
    return RT.Executor.run(mission, runOpts).then(function (res) {
      finalize(res);
      return res;
    }).catch(function (err) {
      S.running = false; S.status = "failed";
      renderAll();
      throw err;
    });
  }

  function handleEvent(ev) {
    S.traces.push(ev);
    var pl = ev.payload || {};
    if (ev.type === "mission.created") { S.status = "planned"; }
    if (ev.type === "plan.compiled") { S.status = "planned"; }
    if (ev.type === "step.start") {
      S.plan.forEach(function (s) {
        if (s.no < pl.step && (s.state === "pending" || s.state === "running")) s.state = "ok";
      });
      var cur = S.plan.filter(function (s) { return s.no === pl.step; })[0];
      if (cur) cur.state = "running";
    }
    if (ev.type === "tool.result") { S.firstResult = true; }
    if (ev.type === "critic.verdict") {
      var v = S.plan.filter(function (s) { return s.no === pl.step; })[0];
      if (pl.verdict === "pass") {
        if (v) v.state = "ok";
        if (S.retry) S.retry.round2 = pl;
      } else {
        if (v) v.state = "fail";
        S.lastFail = pl;
      }
    }
    if (ev.type === "retry.scheduled") {
      S.retry = { attempt: pl.attempt, delta: pl.promptDelta || "", round1: S.lastFail, round2: null };
      var step6 = S.plan.filter(function (s) { return s.no === pl.step; })[0];
      if (step6) { step6.state = "fail"; step6.retried = true; }
    }
    if (ev.type === "artifact.landed") {
      S.plan.forEach(function (s) { if (s.state !== "fail") s.state = "ok"; });
      S.status = "review";
    }
    if (ev.type === "hitl.requested") {
      if (!S.gate) S.gate = { budgetCny: pl.budgetCny, costCny: pl.costCny, pct: pl.pct, threshold: pl.threshold, decision: "" };
      openGateVisual();
    }
    if (ev.type === "hitl.decided") {
      if (S.gate) S.gate.decision = pl.decision;
      showGateDecision(pl.decision, pl.by);
      setTimeout(closeGate, 900);
    }
    if (ev.type === "run.finished") {
      S.status = pl.status; S.stats = pl.stats;
      S.plan.forEach(function (s) {
        if (pl.status === "review") s.state = "ok";
        else if (s.state === "running") s.state = pl.status === "blocked" ? "blocked" : "fail";
        else if (s.state === "pending" && pl.status === "failed") s.state = "blocked";
      });
    }
    appendTrace(ev);
    renderPlan();
    renderRetry();
    renderCost();
    renderStatus();
  }

  function finalize(res) {
    S.running = false; S.autoGate = false; S.firstResult = true;
    S.runId = res.runId; S.status = res.state;
    S.stats = res.run.stats; S.artifacts = res.artifacts || [];
    S.traces = (res.traces || []).slice();
    if (!S.retry) S.retry = deriveRetry(S.traces);
    S.plan.forEach(function (s) {
      if (res.state === "review") s.state = "ok";
      else if (s.state === "running") s.state = res.state === "blocked" ? "blocked" : "fail";
      else if (s.state === "pending" && res.state === "failed") s.state = "blocked";
    });
    S.sessionRuns.push({ key: S.preset, runId: res.runId, state: res.state, cost: S.stats.costCny });
    renderTraceAll();
    renderAll();
    refreshRail();
    if (S.view === "runs") refreshHistory();
    if (S.gateResolve) decideGate(false, "run-ended");
  }

  function deriveRetry(traces) {
    var retryEv = traces.filter(function (e) { return e.type === "retry.scheduled"; })[0];
    if (!retryEv) return null;
    var verdicts = traces.filter(function (e) { return e.type === "critic.verdict"; });
    return {
      attempt: retryEv.payload.attempt, delta: retryEv.payload.promptDelta || "",
      round1: verdicts[0] || null, round2: verdicts[verdicts.length - 1] || null
    };
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderPresetState();
    renderPlan();
    renderRetry();
    renderTraceAll();
    renderArtifacts();
    renderCost();
    renderStatus();
  }

  function renderPresetState() {
    qa(".preset").forEach(function (b) { b.classList.toggle("is-selected", b.dataset.preset === S.preset); });
  }

  function renderPlan() {
    var empty = id("planEmpty"), grid = id("planGrid"), sk = id("planSkeleton");
    if (!S.plan || !S.plan.length) {
      empty.hidden = false; grid.hidden = true; sk.hidden = true;
      return;
    }
    empty.hidden = true;
    if (S.running && !S.firstResult) {
      sk.hidden = false; grid.hidden = true;
      return;
    }
    sk.hidden = true; grid.hidden = false;
    var stateText = { pending: "PENDING", running: "RUNNING", ok: "OK", fail: "FAIL", blocked: "BLOCKED" };
    grid.innerHTML = S.plan.map(function (s) {
      S.seenStates[s.state] = true;
      return '<div class="plan-step is-' + s.state + '" data-step="' + s.no + '">' +
        '<div class="ps-no"><span>' + String(s.no).padStart(2, "0") + '</span><span class="ps-dot"></span></div>' +
        '<div class="ps-label">' + esc(s.label) + '</div>' +
        '<div class="ps-tools">' + s.tools.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join("") + '</div>' +
        '<span class="ps-state">' + stateText[s.state] + '</span>' +
        (s.retried ? '<span class="retry-badge">RETRY</span>' : '') +
        '</div>';
    }).join("");
  }

  function renderRetry() {
    var panel = id("retryPanel");
    if (!S.retry || !S.retry.round1) { panel.hidden = true; return; }
    panel.hidden = false;
    var r1 = S.retry.round1, r2 = S.retry.round2;
    id("retryRound1").querySelector("b").textContent = "FAIL · " + (r1.score != null ? r1.score : "—");
    id("retryRound1").querySelector("p").textContent = (r1.issues || []).join("；") || "首轮质检未通过";
    id("retryRound2").querySelector("b").textContent = r2 ? ("PASS · " + (r2.score != null ? r2.score : "—")) : "等待第二轮…";
    id("retryRound2").querySelector("p").textContent = r2 ? ("round " + (r2.round || 2) + " · verdict " + r2.verdict) : "image.gen 重跑中";
    txt("retryDelta", "promptDelta · " + (S.retry.delta || "—"));
    txt("retryNote", "attempt " + S.retry.attempt + " · image.gen 重跑 · 第二轮通过");
    id("retryDelta").hidden = false;
  }

  function renderCost() {
    var cost = S.stats ? Number(S.stats.costCny) : S.traces.reduce(function (a, e) { return a + (e.costCny || 0); }, 0);
    var tokens = S.stats ? S.stats.tokens : 0;
    var images = S.stats ? S.stats.images : 0;
    var steps = S.stats ? S.stats.steps : (S.plan ? S.plan.filter(function (s) { return s.state !== "pending"; }).length : 0);
    var calls = S.stats ? S.stats.toolCalls : S.traces.filter(function (e) { return e.type === "tool.call"; }).length;
    var retries = S.stats ? S.stats.retries : (S.retry ? S.retry.attempt : 0);
    var dur = S.stats ? S.stats.durationMs : (S.running ? Math.round(performance.now() - S.startedAt) : 0);

    txt("costValue", cost.toFixed(2));
    id("costValue").dataset.cost = String(cost);
    txt("costBreak", "tokens " + tokens + " · images " + images);
    txt("statSteps", steps + " / 7");
    txt("statCalls", calls + " / 9");
    txt("statRetries", String(retries));
    txt("statDuration", dur ? (dur < 1000 ? dur + "ms" : (dur / 1000).toFixed(1) + "s") : "—");

    var budget = S.currentBudget || presetOf(S.preset).budget || 1;
    var pct = Math.min(100, (cost / budget) * 100);
    id("budgetFill").style.width = pct.toFixed(1) + "%";
    txt("budgetText", "预算 ¥" + budget + " · 闸门 80% · 已用 " + Math.round((cost / budget) * 100) + "%");
  }

  function renderStatus() {
    var st = S.running ? "running" : (S.status || "idle");
    var pill = id("runStatePill");
    var map = { idle: "未运行", running: "RUNNING", planned: "PLANNED", review: "REVIEW", blocked: "BLOCKED", failed: "FAILED", done: "DONE" };
    pill.className = "state-pill" + (["review", "running", "blocked", "failed"].indexOf(st) >= 0 ? " is-" + st : "");
    pill.textContent = map[st] || st.toUpperCase();
    txt("connState", S.running ? "RUNNING" : (st === "idle" ? "IDLE" : st.toUpperCase()));
    id("liveState").classList.toggle("is-on", S.running);
    id("runBtn").disabled = S.running;
  }

  function renderArtifacts() {
    var wrap = id("artifacts"), empty = id("artifactEmpty");
    txt("artifactCount", String(S.artifacts.length));
    if (!S.artifacts.length) { wrap.innerHTML = ""; empty.hidden = false; return; }
    empty.hidden = true;
    wrap.innerHTML = S.artifacts.map(function (a) {
      var ch = channelOf(a.channelId);
      var qa = (a.qa && a.qa.score) || 0;
      return '<div class="artifact">' +
        '<div class="art-thumb">' + esc(ch.name || "物料") + '<span>' + esc(ratioText(a.meta && a.meta.ratio)) + '</span></div>' +
        '<div class="art-info"><b>' + esc(ch.name) + ' · ' + esc(a.productId) + '</b>' +
        '<small>' + esc(a.id) + ' · ' + esc(a.kind) + '</small>' +
        '<div class="art-badges"><span class="art-badge">QA ' + qa + '</span><span class="art-badge amber">待审</span></div></div></div>';
    }).join("");
  }

  /* ---------- Trace ---------- */
  function traceMeta(ev) {
    var p = ev.payload || {};
    if (ev.type === "mission.created") return "mission " + (p.missionId || "");
    if (ev.type === "plan.compiled") return p.stepCount + " steps · " + p.callCount + " calls · " + (p.agentId || "");
    if (ev.type === "step.start") return "step " + p.step + " · " + (p.label || "");
    if (ev.type === "tool.call") return p.tool + "(" + (Object.keys(p.args || {}).join(",") || "—") + ")";
    if (ev.type === "tool.result") return p.tool + " · " + p.delayMs + "ms · " + (p.usage && p.usage.tokens) + "tk";
    if (ev.type === "critic.verdict") return "round " + (p.round || 1) + " · " + p.verdict + " · " + p.score;
    if (ev.type === "retry.scheduled") return "attempt " + p.attempt + " · " + p.tool + " · " + (p.reason || []).join("；");
    if (ev.type === "hitl.requested") return "pct " + pctText(p.pct) + " · " + money(p.costCny) + " / " + money(p.budgetCny);
    if (ev.type === "hitl.decided") return p.decision + " · " + p.by;
    if (ev.type === "artifact.landed") return p.count + " artifacts · " + (p.ids || []).join("、");
    if (ev.type === "run.finished") return p.status + " · " + money(p.stats && p.stats.costCny);
    return "";
  }

  function traceTypeClass(t) {
    if (/mission/.test(t)) return "t-mission";
    if (/plan/.test(t)) return "t-plan";
    if (/step/.test(t)) return "t-step";
    if (/tool.call/.test(t)) return "t-call";
    if (/tool.result/.test(t)) return "t-result";
    if (/critic/.test(t)) return "t-verdict";
    if (/retry/.test(t)) return "t-retry";
    if (/hitl/.test(t)) return "t-hitl";
    if (/artifact/.test(t)) return "t-artifact";
    if (/run.finished/.test(t)) return "t-finish";
    return "";
  }

  function traceRow(ev) {
    var d = document.createElement("details");
    d.className = "tr-row";
    d.dataset.type = ev.type;
    d.innerHTML = '<summary><span class="tr-seq">' + String(ev.seq || 0).padStart(2, "0") + '</span>' +
      '<span class="tr-type ' + traceTypeClass(ev.type) + '">' + esc(ev.type) + '</span>' +
      '<span class="tr-meta">' + esc(traceMeta(ev)) + '</span>' +
      '<span class="tr-cost">' + (ev.costCny != null ? money4(ev.costCny) : "—") + '</span></summary>';
    var pre = document.createElement("pre");
    pre.textContent = JSON.stringify(ev, null, 2);
    var body = document.createElement("div");
    body.className = "tr-body";
    body.appendChild(pre);
    d.appendChild(body);
    return d;
  }

  function appendTrace(ev) {
    id("traceEmpty").hidden = true;
    id("traceRows").appendChild(traceRow(ev));
    txt("traceCount", S.traces.length + " EVENTS");
  }

  function renderTraceAll() {
    var rows = id("traceRows");
    rows.innerHTML = "";
    id("traceEmpty").hidden = S.traces.length > 0;
    S.traces.forEach(function (ev) { rows.appendChild(traceRow(ev)); });
    txt("traceCount", S.traces.length + " EVENTS");
  }

  function copyTrace() {
    var text = JSON.stringify(S.traces, null, 2);
    var done = function () { var b = id("copyTrace"); b.textContent = "已复制"; setTimeout(function () { b.textContent = "复制 JSON"; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else done();
  }

  /* ---------- Provider ---------- */
  function setMode(mode) {
    S.mode = mode === "replay" ? "replay" : "mock";
    qa("#modeSeg button").forEach(function (b) { b.classList.toggle("is-active", b.dataset.mode === S.mode); });
    updateProvider();
  }

  function setSpeed(v) {
    S.speed = Number(v) || 8;
    var sel = id("speedSelect");
    if (sel && sel.value !== String(S.speed)) sel.value = String(S.speed);
    updateProvider();
  }

  function updateProvider() {
    var label = S.mode === "replay" ? "replay · 延迟 ×20" : "mock · 延迟 ×" + S.speed;
    txt("providerLabel", label);
    txt("costProvider", S.mode);
  }

  /* ---------- 闸门 ---------- */
  function askGate(info) {
    return new Promise(function (resolve) {
      S.gate = { budgetCny: info.budgetCny, costCny: info.costCny, pct: info.pct, threshold: info.threshold, decision: "" };
      S.gateResolve = resolve;
      openGateVisual();
      if (S.gateTimer) clearTimeout(S.gateTimer);
      S.gateTimer = setTimeout(function () { if (S.gateResolve) decideGate(false, "timeout"); }, 20000);
    });
  }

  function openGateVisual() {
    if (!S.gate) return;
    var card = id("gateCard");
    card.classList.remove("is-decided");
    id("gateDecision").textContent = "";
    id("gateRunId").textContent = S.runId || "RUNNING";
    id("gatePct").textContent = Math.round((S.gate.pct || 0) * 100) + "%";
    id("gateGauge").style.setProperty("--pct", String(Math.min(100, (S.gate.pct || 0) * 100)));
    id("gateBudget").textContent = money(S.gate.budgetCny);
    id("gateCost").textContent = "¥" + Number(S.gate.costCny || 0).toFixed(4);
    id("gateHint").textContent = "等待你的决定…";
    id("gateModal").classList.add("is-open");
  }

  function decideGate(approved, by) {
    if (!S.gateResolve) return;
    var resolve = S.gateResolve;
    S.gateResolve = null;
    if (S.gateTimer) { clearTimeout(S.gateTimer); S.gateTimer = null; }
    if (S.gate) S.gate.decision = approved ? "approve" : "reject";
    id("gateCard").classList.add("is-decided");
    var dec = id("gateDecision");
    dec.className = "gate-decision " + (approved ? "ok" : "no");
    dec.textContent = approved ? "✓ hitl.approve → running（by " + (by || "human:ui") + "）"
      : "✕ hitl.reject → failed（by " + (by || "human:ui") + "）";
    resolve(!!approved);
    setTimeout(closeGate, 900);
  }

  function showGateDecision(decision, by) {
    if (!S.gate) return;
    id("gateCard").classList.add("is-decided");
    var dec = id("gateDecision");
    dec.className = "gate-decision " + (decision === "approve" ? "ok" : "no");
    dec.textContent = decision === "approve"
      ? "✓ hitl.approve → running（by " + (by || "human:auto") + "）"
      : "✕ hitl.reject → failed（by " + (by || "human:auto") + "）";
  }

  function closeGate() {
    id("gateModal").classList.remove("is-open");
    id("gateCard").classList.remove("is-decided");
    S.gate = null;
  }

  /* ---------- 运行记录 ---------- */
  async function refreshRail() {
    try {
      var runs = await RT.Store.list("runs");
      txt("railRuns", String(runs.length));
      var latest = runs.slice().sort(function (a, b) { return String(b.startedAt).localeCompare(String(a.startedAt)); })[0];
      if (latest && latest.stats) txt("railCost", money(latest.stats.costCny));
    } catch (e) { /* 无 IDB 时降级 */ }
  }

  async function refreshHistory() {
    var wrap = id("runsWrap");
    try {
      var runs = (await RT.Store.list("runs")).sort(function (a, b) { return String(b.startedAt).localeCompare(String(a.startedAt)); });
      txt("runsCount", runs.length + " RUNS");
      if (!runs.length) { wrap.innerHTML = '<div class="empty-wide">还没有 run。回到工作台跑一条 Mission。</div>'; return; }
      wrap.innerHTML = '<table class="runs-table"><thead><tr><th>RUN</th><th>MISSION</th><th>STATUS</th><th>STEPS</th><th>CALLS</th><th>COST</th><th>STARTED</th><th></th></tr></thead><tbody>' +
        runs.map(function (r) {
          return '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.missionId) + '</td>' +
            '<td><span class="run-state ' + esc(r.status) + '">' + esc(r.status) + '</span></td>' +
            '<td>' + (r.stats ? r.stats.steps : "—") + '</td><td>' + (r.stats ? r.stats.toolCalls : "—") + '</td>' +
            '<td>' + (r.stats ? money(r.stats.costCny) : "—") + '</td><td>' + esc(String(r.startedAt || "").slice(11, 19)) + '</td>' +
            '<td><button class="link-btn" data-run="' + esc(r.id) + '">回放 →</button></td></tr>';
        }).join("") + '</tbody></table>';
      qa("[data-run]", wrap).forEach(function (b) { b.addEventListener("click", function () { loadRun(b.dataset.run); }); });
    } catch (e) {
      wrap.innerHTML = '<div class="empty-wide">读取失败：' + esc(e.message || e) + '</div>';
    }
  }

  async function loadRun(runId) {
    try {
      var run = await RT.Store.get("runs", runId);
      if (!run) return;
      var traces = (await RT.Store.list("traces", { index: "runId", value: runId })).sort(function (a, b) { return a.seq - b.seq; });
      var arts = await RT.Store.list("artifacts", { index: "runId", value: runId });
      var lastStep = 0;
      traces.forEach(function (e) { if (e.type === "step.start") lastStep = Math.max(lastStep, e.payload.step || 0); });
      S.running = false; S.runId = run.id; S.status = run.status; S.stats = run.stats;
      S.traces = traces; S.artifacts = arts; S.retry = deriveRetry(traces);
      S.plan = ((run.plan && run.plan.steps) || []).map(function (s) {
        var st = "pending";
        if (run.status === "review" || s.no <= lastStep) st = "ok";
        if (s.no === lastStep && run.status === "blocked") st = "blocked";
        if (s.no === lastStep && run.status === "failed") st = "fail";
        return { no: s.no, label: s.label, tools: (s.calls || []).map(function (c) { return c.tool; }), expected: (s.calls || []).length, state: st, retried: !!S.retry && s.no === 6 };
      });
      S.firstResult = true; S.seenStates = {};
      var p = PRESETS.filter(function (x) { return x.missionId === run.missionId; })[0];
      if (p) { S.preset = p.key; S.currentBudget = p.budget; selectPreset(p.key, true); }
      renderAll(); showView("workbench"); location.hash = "#/workbench";
    } catch (e) { /* 忽略回放错误 */ }
  }

  /* ---------- 自检 A3 ---------- */
  async function runSelftest() {
    var cases = [];
    var ctx = {};
    function add(cid, name, ok, detail) { cases.push({ id: cid, name: name, ok: !!ok, detail: detail }); }
    try {
      resetRunView(); showView("workbench"); S.sessionRuns = [];
      setSpeed(2); setMode("mock");

      var navs = qa(".nav-item[data-view]");
      var links = qa("#siteGroups .page-link");
      var want = PAGES.map(function (p) { return "index.html#" + p.id; });
      var hrefs = links.map(function (a) { return a.getAttribute("href"); });
      var allMatch = hrefs.length === 17 && want.every(function (h) { return hrefs.indexOf(h) >= 0; });
      add("A3-01", "6 组导航 + 17 页成果入口", navs.length === 6 && allMatch,
        "nav=" + navs.length + "/6 · links=" + hrefs.length + "/17 · href 全命中 index.html#pN");

      var emptyOk = !id("planEmpty").hidden && id("planGrid").hidden;

      var pA = startRun("A", { speed: 2 });
      await sleep(160);
      var skeletonOk = !id("planSkeleton").hidden && id("planEmpty").hidden;
      var rA = await pA;
      add("A3-07", "空态 → 骨架 → 运行态", emptyOk && skeletonOk,
        "空态=" + (emptyOk ? "显示" : "缺失") + " · 运行中骨架=" + (skeletonOk ? "显示" : "缺失") + " · 终态 " + rA.state);

      var rowsA = qa("#traceRows .tr-row").length;
      add("A3-04", "Trace 行数 = run 事件数，原始 JSON 可展开", rowsA === rA.traces.length,
        "rows=" + rowsA + " / events=" + rA.traces.length);

      var costShown = Number(id("costValue").textContent);
      var exact = Number(rA.run.stats.costCny);
      var costOk = Math.abs(costShown - Number(exact.toFixed(2))) === 0 && Number(id("costValue").dataset.cost) === exact;
      add("A3-06", "成本卡 = stats.costCny（两位小数）", costOk,
        "card=¥" + costShown.toFixed(2) + " / stats=¥" + exact.toFixed(4));

      var rB = await startRun("B", { speed: 12 });
      var seen = Object.assign({}, S.seenStates);
      var r1 = id("retryRound1").querySelector("b").textContent;
      var r2 = id("retryRound2").querySelector("b").textContent;
      var delta = id("retryDelta").textContent;
      add("A3-05", "重试链并排两轮 + promptDelta", !id("retryPanel").hidden && /FAIL/.test(r1) && /PASS/.test(r2) && /promptDelta/.test(delta),
        "round1=" + r1 + " · round2=" + r2 + " · " + delta.slice(0, 72));
      add("A3-03", "Plan 7 步，四态样式齐全", qa("#planGrid .plan-step").length === 7 && ["pending", "running", "ok", "fail"].every(function (k) { return seen[k]; }),
        "steps=" + qa("#planGrid .plan-step").length + "/7 · seen=" + Object.keys(seen).filter(function (k) { return seen[k]; }).join("/"));

      var rC = await startRun("C", { speed: 12, autoGate: true });
      var keys = S.sessionRuns.map(function (x) { return x.key; }).sort().join("");
      var stored = 0;
      for (var i = 0; i < S.sessionRuns.length; i++) {
        var rec = await RT.Store.get("runs", S.sessionRuns[i].runId);
        if (rec) stored++;
      }
      add("A3-02", "3 条预设可切换并生成 run", keys === "ABC" && stored === 3,
        "presets=" + keys + " · stored=" + stored + "/3 · states=" + S.sessionRuns.map(function (x) { return x.state; }).join("/"));

      setMode("mock"); setSpeed(1);
      var labelMock = id("providerLabel").textContent;
      var reg = RT.Tools.create({ data: DATA, agent: AGENT });
      var slow = await reg.call("product.get", { productId: "p01" }, { speed: 1 });
      setMode("replay");
      var labelReplay = id("providerLabel").textContent;
      var fast = await reg.call("product.get", { productId: "p01" }, { speed: 20 });
      add("A3-08", "replay：provider 标签与延迟同步变化", /mock/.test(labelMock) && /replay/.test(labelReplay) && slow.waitedMs > fast.waitedMs,
        "label: " + labelMock + " → " + labelReplay + " · wait: " + slow.waitedMs + "ms → " + fast.waitedMs + "ms");
    } catch (e) {
      add("SUITE", "A3 套件异常", false, String(e && e.message || e));
    }

    var summary = {
      total: cases.length,
      passed: cases.filter(function (c) { return c.ok; }).length,
      failed: cases.filter(function (c) { return !c.ok; }).length
    };
    var result = {
      suite: "A3", generatedAt: new Date().toISOString(), cases: cases, summary,
      runs: S.sessionRuns.map(function (x) { return { key: x.key, runId: x.runId, state: x.state, cost: x.cost }; }),
      metrics: {
        nav: qa(".nav-item[data-view]").length,
        pageLinks: qa("#siteGroups .page-link").length,
        planSteps: qa("#planGrid .plan-step").length,
        traceRows: qa("#traceRows .tr-row").length,
        provider: id("providerLabel").textContent
      }
    };
    window.__WB_SELFTEST__ = result;
    id("selftestJson").textContent = JSON.stringify(result, null, 2);
    return result;
  }

  function showBadge(res) {
    var badge = id("selftestBadge");
    badge.style.display = "flex";
    badge.classList.toggle("is-fail", res.summary.failed > 0);
    badge.title = "点击导出 A3 原始 JSON";
    badge.onclick = function () {
      var blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "S3.browser.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    };
    txt("selftestText", "A3 " + res.summary.passed + "/" + res.summary.total + (res.summary.failed ? " · FAIL" : " · PASS"));
  }

  /* ---------- 对外 API ---------- */
  window.OVEM_WB = {
    state: S,
    startRun: startRun,
    selectPreset: selectPreset,
    loadRun: loadRun,
    setMode: setMode,
    setSpeed: setSpeed,
    resetRun: function () { resetRunView(); showView("workbench"); },
    refreshHistory: refreshHistory,
    selftest: runSelftest,
    showView: showView
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.OVEM_RT);
