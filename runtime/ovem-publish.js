/* ============================================================
   OVEM B4 · 发布审批 UI
   ------------------------------------------------------------
   - 执行记录页：review run 提交发布、审批/驳回、版本包打开、回滚
   - 工作台：当前服务端 run review 后出现「提交发布」
   - 审计：按 runId 拉时间线，串起 request / approve / reject
   ============================================================ */
"use strict";

(function () {
  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function api() { return window.OVEM_API; }
  function wb() { return window.OVEM_WB; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function setStatus(s) { var e = q("#publishStatus"); if (e) e.textContent = s || ""; }

  function ready() { return !!(api() && api().state && api().state.enabled); }
  function canApprove() { var r = api() && api().state && api().state.role; return r === "owner" || r === "admin"; }

  async function serverRuns() {
    try { var r = await api().get("/api/runs"); return r.runs || []; } catch (e) { return []; }
  }

  function currentRunId() {
    var s = wb() && wb().state;
    return s && s.runId && s.jobId ? s.runId : "";
  }

  function refreshPublishButton() {
    var b = q("#publishRunBtn");
    if (!b) return;
    var s = wb() && wb().state;
    b.hidden = !(ready() && s && s.jobId && s.runId && s.status === "review");
  }

  async function refresh() {
    var panel = q("#publishPanel");
    if (!panel) return;
    if (!ready()) { panel.hidden = true; refreshPublishButton(); return; }
    panel.hidden = false;
    refreshPublishButton();
    var runs = await serverRuns();
    var review = runs.filter(function (r) { return r.status === "review"; });
    var sel = q("#publishRunSelect");
    if (sel) {
      var cur = currentRunId();
      sel.innerHTML = review.length
        ? review.map(function (r) {
          return '<option value="' + esc(r.id) + '"' + (r.id === cur ? " selected" : "") + '>' + esc(r.id + " · " + r.missionId + " · " + r.mode) + '</option>';
        }).join("")
        : '<option value="">— 没有 review run —</option>';
    }
    try {
      var res = await api().get("/api/publications");
      renderList(res.publications || []);
    } catch (e) {
      renderList([]);
      setStatus("发布列表读取失败：" + (e.message || e));
    }
  }

  function renderList(pubs) {
    var wrap = q("#publishList");
    var count = q("#publishCount");
    if (count) count.textContent = pubs.length + " VERSIONS";
    if (!wrap) return;
    if (!pubs.length) {
      wrap.innerHTML = '<div class="empty-wide">还没有发布记录。选择一条 review run 提交发布，再由 admin / owner 审批。</div>';
      return;
    }
    wrap.innerHTML = pubs.map(function (p) {
      var statusClass = p.status === "approved" ? "ok" : (p.status === "rejected" ? "fail" : "pending");
      var actions = [];
      if (p.status === "pending" && canApprove()) {
        actions.push('<button class="ok" data-pub-action="approve" data-pub="' + esc(p.id) + '" data-run="' + esc(p.runId) + '">批准</button>');
        actions.push('<button class="no" data-pub-action="reject" data-pub="' + esc(p.id) + '" data-run="' + esc(p.runId) + '">驳回</button>');
      }
      if (p.status === "approved" && canApprove()) {
        actions.push('<button class="no" data-pub-action="rollback" data-pub="' + esc(p.id) + '" data-run="' + esc(p.runId) + '">回滚</button>');
      }
      actions.push('<button data-pub-action="audit" data-run="' + esc(p.runId) + '">审计</button>');
      var open = p.path ? '<a class="link-btn" href="' + esc(p.path) + '" target="_blank" rel="noopener">打开包 ↗</a>' : "—";
      return '<div class="publish-row">' +
        '<div><b>' + esc(p.version) + '</b> · ' + esc(p.runId) + '<br><span class="muted">' + esc(p.creatorName || p.createdBy) + ' · ' + esc(p.createdAt) + '</span></div>' +
        '<div><span class="run-state ' + statusClass + '">' + esc(p.status) + '</span></div>' +
        '<div>' + open + '</div>' +
        '<div class="muted">' + esc(p.status === "rejected" ? (p.note || "无原因") : (p.deciderName || "—")) + '</div>' +
        '<div class="pub-actions">' + actions.join("") + '</div></div>';
    }).join("");
    qa("[data-pub-action]").forEach(function (b) {
      b.addEventListener("click", function () { action(b.dataset.pubAction, b.dataset.pub, b.dataset.run); });
    });
  }

  async function submit(runId) {
    if (!ready()) { setStatus("需要登录 HTTP 工作台"); return; }
    if (!runId) { setStatus("没有可提交的 run"); return; }
    var note = (q("#pubNote") && q("#pubNote").value.trim()) || "";
    try {
      setStatus("提交中…");
      var r = await api().post("/api/publications", { runId: runId, note: note });
      setStatus("已提交 " + (r.publication && r.publication.version) + " · 等待 admin / owner 审批");
      if (q("#pubNote")) q("#pubNote").value = "";
      await refresh();
      await showAudit(runId);
    } catch (e) {
      setStatus("提交失败：" + (e.message || e));
    }
  }

  async function action(kind, pubId, runId) {
    if (kind === "audit") { showAudit(runId); return; }
    if (!ready() || !canApprove()) { setStatus("只有 admin / owner 可以审批"); return; }
    var note = (q("#pubNote") && q("#pubNote").value.trim()) || "";
    try {
      setStatus(kind === "approve" ? "批准中…" : (kind === "reject" ? "驳回中…" : "回滚中…"));
      if (kind === "rollback") {
        await api().post("/api/publications/" + encodeURIComponent(pubId) + "/rollback", { note: note });
      } else {
        await api().post("/api/publications/" + encodeURIComponent(pubId) + "/decide", { decision: kind, note: note });
      }
      setStatus(kind === "approve" ? "已批准，版本包已生成" : (kind === "reject" ? "已驳回，run 回 failed" : "已回滚"));
      if (q("#pubNote")) q("#pubNote").value = "";
      await refresh();
      if (runId) await showAudit(runId);
    } catch (e) {
      setStatus("操作失败：" + (e.message || e));
    }
  }

  async function showAudit(runId) {
    var box = q("#auditTimeline");
    if (!box || !runId) return;
    try {
      var res = await api().get("/api/audit?runId=" + encodeURIComponent(runId));
      var rows = res.timeline || [];
      box.hidden = false;
      box.innerHTML = '<div class="muted">AUDIT TIMELINE · ' + esc(runId) + ' · ' + rows.length + ' EVENTS</div>' +
        rows.map(function (r) {
          return '<div class="at-row"><b>' + esc(String(r.createdAt || "").slice(11, 19)) + '</b> · ' + esc(r.action) +
            ' · ' + esc(r.actorId || "system") + ' · ' + esc(JSON.stringify(r.detail || {})) + '</div>';
        }).join("");
    } catch (e) {
      box.hidden = false;
      box.textContent = "审计读取失败：" + (e.message || e);
    }
  }

  function bind() {
    var b = q("#publishRunBtn");
    if (b) b.addEventListener("click", function () {
      var s = wb() && wb().state;
      submit(s && s.runId);
    });
    var submitBtn = q("#publishSubmit");
    if (submitBtn) submitBtn.addEventListener("click", function () {
      var sel = q("#publishRunSelect");
      submit(sel && sel.value);
    });
    var refreshBtn = q("#refreshRuns");
    if (refreshBtn) refreshBtn.addEventListener("click", function () { setTimeout(refresh, 300); });
    window.addEventListener("hashchange", function () {
      if (/^#\/runs/.test(location.hash || "")) setTimeout(refresh, 120);
      refreshPublishButton();
    });
    document.addEventListener("ovem:ready", refresh);
    document.addEventListener("ovem:tenant", refresh);
  }

  window.OVEM_PUBLISH = { refresh: refresh, submit: submit, showAudit: showAudit };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bind(); refresh(); });
  else { bind(); refresh(); }
})();
