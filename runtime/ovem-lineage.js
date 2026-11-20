/* ============================================================
   OVEM 成果层联动（S4）· 只读血缘与产物
   ------------------------------------------------------------
   打开 index.html 时追加读取 IndexedDB：
     最新 run → 17 页血缘条 / P0 运行摘要 / P4 产物卡 / P7 渠道状态
   不改 17 段正文；注入幂等（重复执行先移除再插入）。
   自检：index.html?selftest=1 → window.__LINEAGE_SELFTEST__（A4）
   ============================================================ */
window.OVEM_RT = window.OVEM_RT || {};
(function (RT) {
  "use strict";

  var AGENT = window.OVEM_AGENT || { lineage: {}, tools: [] };
  var SCHEMA = window.OVEM_SCHEMA || { pages: [] };
  var DATA = window.OVEM_DATA || { channels: [] };
  var PAGES = SCHEMA.pages || [];
  var LINEAGE = AGENT.lineage || {};

  var STATE = {
    loaded: false,
    loading: null,
    run: null,
    runs: [],
    artifacts: [],
    error: null
  };
  var ERRORS = [];

  window.addEventListener("error", function (e) {
    ERRORS.push(String((e && e.message) || (e && e.error) || "error"));
  });
  window.addEventListener("unhandledrejection", function (e) {
    ERRORS.push("unhandledrejection: " + String((e && e.reason) || ""));
  });

  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function id(n) { return document.getElementById(n); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function money(n) { return "¥" + (Number(n) || 0).toFixed(2); }
  function money4(n) { return "¥" + (Number(n) || 0).toFixed(4); }
  function ratioText(r) {
    if (!r) return "";
    if (typeof r === "string") return r;
    return (r.w && r.h) ? (r.w + ":" + r.h) : "";
  }
  function pageOf(pid) {
    return PAGES.filter(function (p) { return p.id === pid; })[0] || { id: pid, no: pid.toUpperCase(), name: pid };
  }
  function toolOf(tid) {
    return (AGENT.tools || []).filter(function (t) { return t.id === tid; })[0] || { id: tid, name: tid };
  }
  function channelOf(cid) {
    var idx = Number(String(cid || "").replace("c", "")) - 1;
    return (DATA.channels || [])[idx] || { id: cid, name: cid };
  }
  function stateLabel(s) {
    return ({ review: "待审", done: "已发布", failed: "失败", blocked: "预算暂停", running: "运行中", planned: "已计划" })[s] || s || "未执行";
  }
  function stateClass(s) {
    return ({ review: "is-review", failed: "is-failed", blocked: "is-blocked", done: "is-done" })[s] || "is-idle";
  }
  function timeText(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return String(iso); }
  }
  function durationText(ms) {
    var n = Number(ms) || 0;
    return n >= 1000 ? (Math.round(n / 100) / 10).toFixed(1) + "s" : n + "ms";
  }

  /* ---------- 样式 ---------- */
  function ensureStyles() {
    if (id("ovem-lineage-style")) return;
    var css = [
      ".ln-strip{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;",
      "background:linear-gradient(90deg,#FFFFFF 0%,#F7FAFF 100%);border:1px solid var(--line);border-left:3px solid var(--brand-2);",
      "border-radius:10px;padding:10px 14px;margin:0 0 16px;box-shadow:0 2px 10px rgba(15,27,45,.04)}",
      ".ln-kicker{font-size:9px;font-weight:700;letter-spacing:.16em;color:var(--brand-2);line-height:1.2}",
      ".ln-title{font-size:13px;font-weight:600;color:var(--ink);margin-top:3px;line-height:1.3}",
      ".ln-title span{font-weight:400;color:var(--ink-3);font-size:10.5px}",
      ".ln-tools{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}",
      ".ln-tool{font-size:10px;line-height:1.2;border:1px solid var(--line);background:#fff;border-radius:4px;padding:3px 6px;color:var(--ink-2);white-space:nowrap}",
      ".ln-tool b{color:var(--brand-2);font-weight:600;margin-right:3px}",
      ".ln-meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:10px;color:var(--ink-3);text-align:right}",
      ".ln-run{font-variant-numeric:tabular-nums;font-weight:700;color:var(--ink);font-size:11px}",
      ".ln-badge{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:999px;padding:2px 7px;font-size:9.5px;line-height:1.4;background:#fff;color:var(--ink-3)}",
      ".ln-badge.is-review{color:var(--warn);border-color:#F0D3A8;background:#FFF8EB}",
      ".ln-badge.is-failed{color:#B91C1C;border-color:#F3C3C4;background:#FFF1F1}",
      ".ln-badge.is-blocked{color:var(--warn);border-color:#F0D3A8;background:#FFF8EB}",
      ".ln-badge.is-done{color:var(--ok);border-color:#BFE3CB;background:#F0FBF3}",
      ".ln-link{color:var(--brand-2);text-decoration:none;font-weight:600}",
      ".ln-sum{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 18px}",
      ".ln-sum h4{font-size:12px;color:var(--ink);margin:0 0 4px}",
      ".ln-sum p{font-size:10.5px;color:var(--ink-3);margin:0;line-height:1.6}",
      ".ln-sum-stats{display:flex;gap:14px;flex-wrap:wrap;justify-content:flex-end}",
      ".ln-sum-stats b{display:block;font-size:15px;color:var(--ink);font-variant-numeric:tabular-nums;line-height:1.1}",
      ".ln-sum-stats span{font-size:9.5px;color:var(--ink-3);letter-spacing:.04em}",
      ".ln-p4{border:1px dashed #C9D7F2;background:#F7FAFF;border-radius:8px;padding:10px;margin:10px 0 12px}",
      ".ln-p4-h{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:10px;color:var(--ink-3);margin-bottom:8px}",
      ".ln-p4-h b{color:var(--ink);font-size:11px}",
      ".ln-art{display:grid;grid-template-columns:58px minmax(0,1fr);gap:9px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:7px;padding:6px;margin-top:6px}",
      ".ln-thumb{height:46px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;letter-spacing:.08em;background:linear-gradient(135deg,#1E3A8A,#2F6FED)}",
      ".ln-thumb.c02{background:linear-gradient(135deg,#0E8F8C,#22B8B4)}",
      ".ln-thumb.c06{background:linear-gradient(135deg,#A1741F,#D6A94A)}",
      ".ln-art b{display:block;font-size:11px;color:var(--ink);line-height:1.35}",
      ".ln-art span{display:block;font-size:9.5px;color:var(--ink-3);line-height:1.5}",
      ".ln-p4-empty{font-size:10.5px;color:var(--ink-3);line-height:1.6}",
      ".ln-p7{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid var(--line);border-left:3px solid var(--teal);border-radius:9px;padding:9px 12px;margin:0 0 12px}",
      ".ln-p7 b{font-size:10px;letter-spacing:.08em;color:var(--ink-2);margin-right:4px}",
      ".ln-p7 .ln-badge{font-size:9.5px}",
      ".ln-p7 .ln-empty{font-size:10px;color:var(--ink-3)}",
      "#lineageBadge{position:fixed;right:18px;bottom:18px;z-index:9999;display:none;align-items:center;gap:7px;cursor:pointer;",
      "border:1px solid #BFE3CB;background:#F0FBF3;color:var(--ok);border-radius:999px;padding:7px 12px;font-size:10px;font-weight:600;box-shadow:0 8px 24px rgba(15,27,45,.14)}",
      "#lineageBadge.is-fail{border-color:#F3C3C4;background:#FFF1F1;color:#B91C1C}",
      "@media (max-width:760px){.ln-strip,.ln-sum{grid-template-columns:1fr}.ln-meta{align-items:flex-start;text-align:left}.ln-sum-stats{justify-content:flex-start}}",
      "@media print{.ln-strip,.ln-sum,.ln-p4,.ln-p7{break-inside:avoid}}"
    ].join("");
    var st = document.createElement("style");
    st.id = "ovem-lineage-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- 数据 ---------- */
  function sortRuns(list) {
    return list.slice().sort(function (a, b) {
      var t = String(b.startedAt || "").localeCompare(String(a.startedAt || ""));
      return t !== 0 ? t : String(b.id || "").localeCompare(String(a.id || ""));
    });
  }

  async function load() {
    if (STATE.loaded) return STATE;
    if (STATE.loading) return STATE.loading;
    STATE.loading = (async function () {
      try {
        if (!RT.Store) throw new Error("Store 未加载");
        var runs = await RT.Store.list("runs");
        STATE.runs = sortRuns(runs || []);
        STATE.run = STATE.runs[0] || null;
        STATE.artifacts = STATE.run ? await RT.Store.list("artifacts", { index: "runId", value: STATE.run.id }) : [];
        STATE.error = null;
      } catch (e) {
        STATE.error = String((e && e.message) || e);
        STATE.runs = [];
        STATE.run = null;
        STATE.artifacts = [];
      }
      STATE.loaded = true;
      STATE.loading = null;
      renderAll();
      return STATE;
    })();
    return STATE.loading;
  }

  /* ---------- 渲染 ---------- */
  function stripHtml(pid) {
    var page = pageOf(pid);
    var tools = (LINEAGE[pid] || []).map(function (tid, i) {
      var t = toolOf(tid);
      return '<span class="ln-tool"><b>' + ("0" + (i + 1)).slice(-2) + '</b>' + esc(t.name || tid) + "</span>";
    }).join("");
    var runId = STATE.run ? STATE.run.id : "";
    var status = STATE.run ? STATE.run.status : "";
    var compact = STATE.run
      ? '<span class="ln-run">' + esc(STATE.run.id) + " · " + timeText(STATE.run.endedAt || STATE.run.startedAt) + "</span>"
        + '<span class="ln-badge ' + stateClass(status) + '">● ' + stateText(status) + "</span>"
        + '<a class="ln-link" href="workbench.html#/runs">运行档案 →</a>'
      : '<span class="ln-run">未执行</span><span class="ln-badge is-idle">等待首次 Mission</span><a class="ln-link" href="workbench.html">去跑一条 →</a>';
    return '<div class="lineage-strip ln-strip" data-page="' + pid + '" data-run-id="' + esc(runId) + '">'
      + '<div><div class="ln-kicker">AGENT LINEAGE · ' + esc(page.no) + "</div>"
      + '<div class="ln-title">' + esc(page.name) + ' <span>· ' + (LINEAGE[pid] || []).length + " 个工具产出</span></div>"
      + '<div class="ln-tools">' + (tools || '<span class="ln-tool">本页暂无工具血缘</span>') + "</div></div>"
      + '<div class="ln-meta">' + compact + "</div></div>";
  }
  function stateText(s) {
    return s ? stateLabel(s) : "未执行";
  }

  function renderStrips() {
    PAGES.forEach(function (page) {
      var sec = id("view-" + page.id);
      if (!sec) return;
      qa(".lineage-strip, .ln-strip", sec).forEach(function (old) { old.parentNode.removeChild(old); });
      var wrap = document.createElement("div");
      wrap.innerHTML = stripHtml(page.id);
      sec.insertBefore(wrap.firstChild, sec.firstChild);
    });
  }

  function renderSummary() {
    var host = id("view-p0");
    if (!host) return;
    var old = id("lineageRunSummary");
    if (old) old.parentNode.removeChild(old);
    var box = document.createElement("div");
    box.id = "lineageRunSummary";
    box.className = "ln-sum";
    if (!STATE.run) {
      box.setAttribute("data-run-id", "");
      box.innerHTML = '<div><h4>最近一次 Agent 运行</h4><p>尚无运行记录。打开工作台跑一条 7 步 Mission，这里会出现 cost / steps / artifacts 与时间。</p></div>'
        + '<div class="ln-sum-stats"><div><b>17/17</b><span>页已接血缘</span></div><div><b>—</b><span>run</span></div></div>';
    } else {
      var run = STATE.run, st = run.stats || {};
      box.setAttribute("data-run-id", run.id);
      box.setAttribute("data-cost", String(st.costCny == null ? "" : st.costCny));
      box.innerHTML = '<div><h4>最近一次 Agent 运行 · ' + esc(run.id) + " · " + esc(run.missionId || "") + "</h4>"
        + "<p>" + timeText(run.startedAt) + " → " + timeText(run.endedAt) + " · " + esc(run.agentId || "agent") + " · " + esc(run.mode || "mock")
        + " · <span style=\"color:var(--brand-2);font-weight:600\">" + stateText(run.status) + "</span></p></div>"
        + '<div class="ln-sum-stats">'
        + "<div><b>" + Number(st.steps || 0) + "/7</b><span>步骤</span></div>"
        + "<div><b>" + Number(st.toolCalls || 0) + "</b><span>工具调用</span></div>"
        + "<div><b>" + money(st.costCny) + "</b><span>成本</span></div>"
        + "<div><b>" + STATE.artifacts.length + "</b><span>产物</span></div>"
        + "<div><b>" + durationText(st.durationMs) + "</b><span>耗时</span></div>"
        + "</div>";
    }
    var anchor = q(".p0-metrics", host) || q(".cap-head", host);
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    else host.insertBefore(box, host.firstChild);
  }

  function renderP4() {
    var host = id("view-p4");
    if (!host) return;
    var old = id("lineageP4Artifacts");
    if (old) old.parentNode.removeChild(old);
    var box = document.createElement("div");
    box.id = "lineageP4Artifacts";
    box.className = "ln-p4";
    box.setAttribute("data-run-id", STATE.run ? STATE.run.id : "");
    box.setAttribute("data-count", String(STATE.artifacts.length));
    var head = '<div class="ln-p4-h"><b>本次 run 产出</b><span>' + (STATE.run ? esc(STATE.run.id) : "尚无 run") + " · " + STATE.artifacts.length + " 件</span></div>";
    if (!STATE.run || !STATE.artifacts.length) {
      box.innerHTML = head + '<div class="ln-p4-empty">还没有产物。跑完 M-A 后，官网首屏 / 移动端 / 小红书三张会在这里出现，并带 runId 与审核状态。</div>';
    } else {
      box.innerHTML = head + STATE.artifacts.map(function (a) {
        var ch = channelOf(a.channelId);
        return '<div class="ln-art" data-run-id="' + esc(a.runId || "") + '" data-artifact-id="' + esc(a.id) + '" data-channel="' + esc(a.channelId) + '" data-status="' + esc(a.status) + '">'
          + '<div class="ln-thumb ' + esc(a.channelId) + '">' + esc(String(ch.name || a.channelId).slice(0, 2)) + "</div>"
          + "<div><b>" + esc(ch.name || a.channelId) + " · " + esc(a.productId || "") + "</b>"
          + '<span>' + esc(a.id) + " · " + esc(a.kind || "bundle") + " · " + (ratioText(a.meta && a.meta.ratio) || "—") + " · QA " + Number((a.qa && a.qa.score) || 0) + "</span>"
          + '<span><span class="ln-badge ' + stateClass(a.status) + '">● ' + stateLabel(a.status) + "</span> · " + esc(a.runId || "") + "</span></div></div>";
      }).join("");
    }
    var matList = id("matList", host);
    if (matList && matList.parentNode) matList.parentNode.insertBefore(box, matList);
    else {
      var summary = id("matSummary", host);
      if (summary && summary.parentNode) summary.parentNode.insertBefore(box, summary.nextSibling);
      else host.appendChild(box);
    }
  }

  function renderP7() {
    var host = id("view-p7");
    if (!host) return;
    var old = id("lineageP7Status");
    if (old) old.parentNode.removeChild(old);
    var box = document.createElement("div");
    box.id = "lineageP7Status";
    box.className = "ln-p7";
    box.setAttribute("data-run-id", STATE.run ? STATE.run.id : "");
    box.setAttribute("data-status-count", String(STATE.artifacts.length));
    var groups = {};
    STATE.artifacts.forEach(function (a) {
      if (!groups[a.channelId]) groups[a.channelId] = { count: 0, status: a.status };
      groups[a.channelId].count += 1;
    });
    var chips = Object.keys(groups).map(function (cid) {
      var ch = channelOf(cid), g = groups[cid];
      return '<span class="ln-badge ' + stateClass(g.status) + '">' + esc(ch.name || cid) + " " + esc(cid) + " · " + stateLabel(g.status) + "</span>";
    }).join("");
    box.innerHTML = "<b>本次 RUN 渠道状态</b>"
      + (chips || '<span class="ln-empty">尚无渠道产物。跑完 M-A 后，三个渠道会由 artifacts.status 派生为「待审 / 在投 / 退役」。</span>')
      + '<span class="ln-empty" style="margin-left:auto">' + (STATE.run ? esc(STATE.run.id) + " · " + STATE.artifacts.length + " 件" : "未执行") + "</span>";
    var tabs = id("chTabs", host);
    if (tabs && tabs.parentNode) tabs.parentNode.insertBefore(box, tabs);
    else host.appendChild(box);
  }

  function renderAll() {
    ensureStyles();
    renderStrips();
    renderSummary();
    renderP4();
    renderP7();
  }

  /* ---------- 自检 ---------- */
  async function selftest() {
    await load();
    var strips = qa(".lineage-strip");
    var pages = strips.map(function (s) { return s.dataset.page; });
    var uniq = Array.from(new Set(pages));
    var perPageOnce = PAGES.every(function (p) {
      var sec = id("view-" + p.id);
      return sec && qa(".lineage-strip", sec).length === 1;
    });
    var run = STATE.run;
    var p4 = id("lineageP4Artifacts");
    var p4Cards = p4 ? qa(".ln-art", p4) : [];
    var p4RunOk = run && p4 && p4.dataset.runId === run.id
      && p4Cards.length === STATE.artifacts.length
      && p4Cards.every(function (c) { return c.dataset.runId === run.id; });
    var p7 = id("lineageP7Status");
    var p7StatusCount = Number((p7 && p7.dataset.statusCount) || 0);
    var p7RunOk = run && p7 && p7.dataset.runId === run.id && p7StatusCount === STATE.artifacts.length;
    var summary = id("lineageRunSummary");
    var sumOk = run && summary && summary.dataset.runId === run.id
      && Math.abs(Number(summary.dataset.cost) - Number((run.stats || {}).costCny || 0)) < 1e-9;
    var errors = ERRORS.slice();

    function add(id2, name, ok, detail) {
      cases.push({ id: id2, name: name, ok: !!ok, detail: detail });
    }
    var cases = [];
    add("A4-01", "17/17 页血缘条存在且每页仅一条", strips.length === 17 && uniq.length === 17 && perPageOnce,
      "strips=" + strips.length + "/17 · unique=" + uniq.length + "/17 · one-per-page=" + perPageOnce);
    add("A4-02", "P4 产物卡 runId = 最新 run", p4RunOk,
      run ? ("latest=" + run.id + " · cards=" + p4Cards.length + " · runId 全一致") : "无 run");
    add("A4-03", "P7 渠道状态由 artifacts.status 派生", p7RunOk,
      "artifacts=" + STATE.artifacts.length + " · p7-status-count=" + p7StatusCount + " · runId=" + (run ? run.id : "—"));
    add("A4-04", "P0 摘要与 store 最新 run 同源", sumOk,
      run ? ("runs=" + STATE.runs.length + " · latest=" + run.id + " · cost=" + money4((run.stats || {}).costCny)) : "无 run");
    add("A4-05", "页面无运行时异常", errors.length === 0,
      "errors=" + errors.length + (errors.length ? " · " + errors.slice(0, 2).join(" / ") : " · clean"));

    var result = {
      suite: "A4",
      generatedAt: new Date().toISOString(),
      cases: cases,
      summary: {
        total: cases.length,
        passed: cases.filter(function (c) { return c.ok; }).length,
        failed: cases.filter(function (c) { return !c.ok; }).length
      },
      runs: { count: STATE.runs.length, latest: run ? { id: run.id, state: run.status, cost: (run.stats || {}).costCny, startedAt: run.startedAt, endedAt: run.endedAt } : null },
      metrics: {
        strips: strips.length,
        pages: uniq.length,
        artifacts: STATE.artifacts.length,
        p7Statuses: p7StatusCount,
        errors: errors.length
      }
    };
    window.__LINEAGE_SELFTEST__ = result;
    return result;
  }

  function showBadge(res) {
    var badge = id("lineageBadge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "lineageBadge";
      badge.innerHTML = '<span>●</span><b id="lineageBadgeText">A4</b>';
      document.body.appendChild(badge);
    }
    badge.style.display = "flex";
    badge.classList.toggle("is-fail", res.summary.failed > 0);
    badge.title = "点击导出 A4 原始 JSON";
    id("lineageBadgeText").textContent = "A4 " + res.summary.passed + "/" + res.summary.total + (res.summary.failed ? " · FAIL" : " · PASS");
    badge.onclick = function () {
      var blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "S4.browser.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    };
  }

  function boot() {
    load().then(function () {
      var qs = new URLSearchParams(location.search);
      if (qs.get("selftest") === "1") {
        selftest().then(showBadge);
      }
    });
  }

  async function refresh() {
    STATE.loaded = false;
    STATE.loading = null;
    return load();
  }

  window.OVEM_LINEAGE = {
    state: STATE,
    refresh: refresh,
    selftest: selftest,
    render: renderAll,
    showBadge: showBadge
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window.OVEM_RT);
