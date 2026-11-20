/* ============================================================
   OVEM 评测面板（S5）
   - 跑全量 20 条、进度、双版本回归、失败样例、明细回放
   - 只操作 DOM 与 OVEM_EVAL，不重复实现执行逻辑
   ============================================================ */
(function () {
  "use strict";
  var E = window.OVEM_EVAL;
  if (!E) return;
  var WB = window.OVEM_WB || {};
  var TASKS = E.tasks || [];
  var lastResult = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function money(n) { return "¥" + (Number(n) || 0).toFixed(4); }
  function rateText(s) { return s ? (s.passed + "/" + s.total + " · " + s.passRate + "%") : "—"; }

  function setBadge(text, cls) {
    var el = $("evalStateBadge");
    if (!el) return;
    el.textContent = text;
    el.className = "eval-badge" + (cls ? " " + cls : "");
  }

  function renderInitial() {
    var count = $("evalCount");
    if (count) count.textContent = String(TASKS.length);
    var head = $("evalProgressPanel");
    if (head) head.hidden = true;
    renderRows(null);
    setBadge("NOT RUN", "");
  }

  function renderProgress(p) {
    var panel = $("evalProgressPanel");
    if (!panel) return;
    panel.hidden = false;
    var done = p.passed === null ? p.index - 1 : p.index;
    var pct = Math.round(done / p.total * 100);
    var text = p.passed === null
      ? ("跑批 " + String(p.index).padStart(2, "0") + "/" + p.total + " · " + p.taskId + " " + p.title)
      : ("完成 " + String(p.index).padStart(2, "0") + "/" + p.total + " · " + p.taskId + " " + (p.passed ? "PASS" : "FAIL"));
    $("evalProgressText").textContent = text;
    $("evalProgressPct").textContent = pct + "%";
    $("evalProgressBar").style.width = pct + "%";
  }

  function renderRows(result) {
    var body = $("evalRows");
    if (!body) return;
    var rows = result ? result.tasks : TASKS.map(function (t) {
      return { taskId: t.taskId, title: t.title, productId: t.productId, channels: t.channelIds, runId: "", state: "", costCny: 0, steps: 0, base: null, candidate: null, issues: [], baseIssues: [] };
    });
    body.innerHTML = rows.map(function (r) {
      var base = r.base === null ? '<span class="eval-na">—</span>' : '<span class="' + (r.base ? "eval-pass" : "eval-fail") + '">' + (r.base ? "PASS" : "FAIL") + "</span>";
      var cand = r.candidate === null ? '<span class="eval-na">—</span>' : '<span class="' + (r.candidate ? "eval-pass" : "eval-fail") + '">' + (r.candidate ? "PASS" : "FAIL") + "</span>";
      var issue = "—";
      if (!r.candidate && r.issues && r.issues.length) issue = esc(r.issues.join("；"));
      else if (r.candidate && !r.base && r.baseIssues && r.baseIssues.length) issue = "v1.1: " + esc(r.baseIssues[0]);
      return '<tr data-run-id="' + esc(r.runId) + '" data-task-id="' + esc(r.taskId) + '">' +
        '<td><span class="task-id">' + esc(r.taskId) + '</span><span class="sub">' + esc(r.title) + "</span></td>" +
        '<td>' + esc(r.productId) + '<span class="sub">' + esc((r.channels || []).join(" / ")) + "</span></td>" +
        '<td>' + (r.runId ? esc(r.runId) : "—") + '<span class="sub">' + (r.runId ? esc(r.state) + " · " + r.steps + " 步" : "待跑") + "</span></td>" +
        '<td>' + (r.runId ? money(r.costCny) : "—") + "</td>" +
        "<td>" + base + "</td><td>" + cand + "</td>" +
        '<td class="eval-issue">' + issue + "</td></tr>";
    }).join("");
  }

  function renderResult(result) {
    lastResult = result;
    window.__EVAL_REPORT__ = result;
    var c = result.candidate, b = result.baseline;
    setBadge((c.passRate >= 90 ? "PASS " : "FAIL ") + c.passed + "/" + c.total, c.passRate >= 90 ? "pass" : "fail");
    $("evalBaseRate").textContent = b.passRate + "%";
    $("evalCandRate").textContent = c.passRate + "%";
    $("evalDelta").textContent = (result.regression.passRate >= 0 ? "+" : "") + result.regression.passRate + "pp";
    $("evalBaseMeta").textContent = b.passed + "/" + b.total + " · 平均 " + b.avgSteps + " 步 · " + money(b.avgCost);
    $("evalCandMeta").textContent = c.passed + "/" + c.total + " · 平均 " + c.avgSteps + " 步 · " + money(c.avgCost);
    $("evalDeltaMeta").textContent = result.regression.fixed + " 条修复 · " + result.regression.broken + " 条回归 · " + result.durationMs + "ms";
    $("evalBaseBig").textContent = b.passRate + "%";
    $("evalCandBig").textContent = c.passRate + "%";
    $("evalBaseSmall").textContent = b.passed + "/" + b.total + " · dominant ≥ 37%";
    $("evalCandSmall").textContent = c.passed + "/" + c.total + " · dominant ≥ 35%";
    $("evalExport").disabled = false;

    var fails = result.tasks.filter(function (t) { return !t.candidate || !t.base; });
    var baselineFails = result.tasks.filter(function (t) { return !t.base; });
    $("evalFailCount").textContent = "baseline 失败 " + baselineFails.length + " 条";
    $("evalFailList").innerHTML = fails.length ? fails.map(function (t) {
      var issue = (!t.candidate && t.issues && t.issues.length) ? t.issues.join("；") : ((t.baseIssues && t.baseIssues[0]) || "—");
      return '<div class="eval-fail-item"><b>' + esc(t.taskId) + '</b><div>' + esc(t.title) +
        '<em>' + esc(issue) + "</em></div></div>";
    }).join("") : '<div class="empty-wide">20/20 全部通过，无失败样例。</div>';

    renderRows(result);
    renderProgress({ index: TASKS.length, total: TASKS.length, taskId: TASKS[TASKS.length - 1].taskId, title: TASKS[TASKS.length - 1].title, passed: c.passRate >= 90 });
    $("evalProgressText").textContent = "完成 " + TASKS.length + "/" + TASKS.length + " · candidate " + c.passed + "/" + c.total + " · " + result.durationMs + "ms";
    $("evalProgressPct").textContent = "100%";
    $("evalProgressBar").style.width = "100%";
  }

  async function runAll() {
    if (E.state.running) return;
    var btn = $("evalRun");
    btn.disabled = true; btn.textContent = "跑批中…";
    $("evalExport").disabled = true;
    $("evalFailList").innerHTML = '<div class="empty-wide">正在顺序执行 20 条评测任务…</div>';
    $("evalFailCount").textContent = "RUNNING";
    setBadge("RUNNING", "run");
    try {
      var result = await E.runAll({ speed: 300, onProgress: renderProgress });
      renderResult(result);
    } catch (e) {
      setBadge("ERROR", "fail");
      $("evalFailList").innerHTML = '<div class="empty-wide">跑批失败：' + esc(e && e.message || e) + "</div>";
      $("evalFailCount").textContent = "ERROR";
    } finally {
      btn.disabled = false; btn.textContent = "重跑全量 20 条";
    }
  }

  function exportJson() {
    if (!lastResult) return;
    var blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "A5_eval_report.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function bind() {
    var run = $("evalRun");
    if (!run) return;
    run.addEventListener("click", runAll);
    $("evalExport").addEventListener("click", exportJson);
    $("evalRows").addEventListener("click", function (ev) {
      var tr = ev.target.closest("tr[data-run-id]");
      if (!tr) return;
      var runId = tr.getAttribute("data-run-id");
      if (runId && WB.loadRun) WB.loadRun(runId);
    });
    if (E.result && E.result()) renderResult(E.result());
    else renderInitial();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.OVEM_EVAL_UI = { run: runAll, render: renderResult, initial: renderInitial };
})();
