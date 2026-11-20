/* ============================================================
   OVEM B3 · 平台治理视图（租户 / 成员 / 审计 / Provider）
   ------------------------------------------------------------
   放在 workbench 的「配置中台」内，不新增导航项，保持 A3 回归。
   所有内容来自 /api，前端不拼 SQL、不读 key 明文。
   ============================================================ */
"use strict";

(function () {
  var S = { section: "tenants", ready: false, busy: false };
  function q(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function api() { return window.OVEM_API; }
  function roleText(r) { return { owner: "OWNER", admin: "ADMIN", editor: "EDITOR", viewer: "VIEWER" }[r] || String(r || "—").toUpperCase(); }

  function start() {
    if (!api()) return;
    var p = q("platformPanel");
    if (!p) return;
    var tabs = Array.prototype.slice.call(document.querySelectorAll("#platformTabs .platform-tab"));
    tabs.forEach(function (b) {
      b.addEventListener("click", function () {
        S.section = b.dataset.section;
        tabs.forEach(function (x) { x.classList.toggle("is-active", x === b); });
        render();
      });
    });
    document.addEventListener("ovem:ready", function () { S.ready = true; p.hidden = false; render(); });
    document.addEventListener("ovem:tenant", function () { render(); });
    document.addEventListener("ovem:unauth", function () { p.hidden = true; });
    if (api().state && api().state.enabled) { S.ready = true; p.hidden = false; render(); }
  }

  async function render() {
    if (!api() || !api().state.enabled) return;
    var body = q("platformBody");
    var meta = q("platformMeta");
    if (!body) return;
    var st = api().state;
    if (meta) meta.textContent = roleText(st.role) + " · " + (st.tenant ? st.tenant.name : "—") + " · SQLITE";
    body.innerHTML = '<div class="platform-empty">加载中…</div>';
    try {
      if (S.section === "tenants") await renderTenants(body);
      else if (S.section === "members") await renderMembers(body);
      else if (S.section === "audit") await renderAudit(body);
      else await renderProvider(body);
    } catch (e) {
      body.innerHTML = '<div class="platform-empty">加载失败：' + esc(e.message || e) + '<br>当前角色：' + esc(roleText(st.role)) + '</div>';
    }
  }

  async function renderTenants(body) {
    var st = api().state;
    var tenants = st.tenants || [];
    body.innerHTML = '<p class="platform-note">当前会话只带一个租户上下文；owner 可切换自己拥有的租户，admin 只能在当前租户内管理。</p>' +
      '<div class="tenant-grid">' + tenants.map(function (t) {
        var current = st.tenant && st.tenant.id === t.id;
        return '<div class="tenant-card ' + (current ? "is-current" : "") + '">' +
          '<div class="tc-top"><b>' + esc(t.name) + '</b><span>' + esc(t.role) + '</span>' + (current ? '<span style="color:var(--green);border-color:rgba(52,211,153,.3)">CURRENT</span>' : '') + '</div>' +
          '<div class="tc-meta">' + esc(t.slug) + ' · ' + esc(t.plan || "demo") + '<br>tenant_id · ' + esc(t.id) + '</div>' +
          '<div class="tc-actions">' + (current ? '<span class="tiny-btn" style="cursor:default">已连接</span>' : '<button type="button" class="tiny-btn" data-switch="' + esc(t.id) + '">切换到此租户 →</button>') + '</div>' +
          '</div>';
      }).join("") + '</div>' +
      '<p class="platform-note" style="margin-top:12px">跨租户示例：在 A 租户创建的 Job 不会出现在 B 租户的运行列表；直接请求跨租户 id 返回 404。</p>';
    Array.prototype.slice.call(body.querySelectorAll("[data-switch]")).forEach(function (b) {
      b.addEventListener("click", function () {
        b.disabled = true; b.textContent = "切换中…";
        api().switchTenant(b.dataset.switch).then(function () { location.reload(); }).catch(function (e) {
          b.disabled = false; b.textContent = "切换失败：" + (e.message || e);
        });
      });
    });
  }

  async function renderMembers(body) {
    var st = api().state;
    var data = await api().get("/api/members");
    var canWrite = st.role === "owner" || st.role === "admin";
    var rows = data.members || [];
    body.innerHTML = '<p class="platform-note">成员与角色写入 SQLite；editor 可执行、admin 可审批与管成员、viewer 只读。owner 不在成员表中直接降级。</p>' +
      (canWrite ? '<div class="inline-form" id="memberForm">' +
        '<input id="mEmail" type="email" placeholder="new@ovem.local">' +
        '<input id="mName" type="text" placeholder="显示名">' +
        '<select id="mRole"><option value="editor">editor</option><option value="admin">admin</option><option value="viewer">viewer</option></select>' +
        '<button type="button" class="tiny-btn" id="mAdd">添加成员</button></div>' : '') +
      '<table class="member-table"><thead><tr><th>EMAIL</th><th>NAME</th><th>ROLE</th><th>STATUS</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (m) {
        return '<tr><td>' + esc(m.email) + '</td><td>' + esc(m.name) + '</td><td>' +
          (canWrite ? '<select class="role-select" data-member="' + esc(m.id) + '">' +
            ["viewer", "editor", "admin"].map(function (r) { return '<option value="' + r + '"' + (m.role === r ? " selected" : "") + '>' + r + '</option>'; }).join("") +
            '</select>' : '<span class="sc-role is-' + esc(m.role) + '">' + esc(roleText(m.role)) + '</span>') +
          '</td><td>' + (m.disabled ? "disabled" : "active") + '</td>' +
          '<td><button class="link-btn" data-disable="' + esc(m.id) + '" data-disabled="' + (m.disabled ? "1" : "0") + '">' + (m.disabled ? "启用" : "停用") + '</button></td></tr>';
      }).join("") : '<tr><td colspan="5" class="platform-empty">当前租户还没有成员</td></tr>') +
      '</tbody></table>';

    var add = q("mAdd");
    if (add) add.addEventListener("click", function () {
      var email = q("mEmail").value.trim();
      var name = q("mName").value.trim();
      var role = q("mRole").value;
      if (!email) return;
      add.disabled = true;
      api().post("/api/members", { email: email, name: name, role: role, password: "ovem-demo-2026" }).then(function () {
        render(); document.dispatchEvent(new CustomEvent("ovem:tenant"));
      }).catch(function (e) { alert(e.message || e); add.disabled = false; });
    });
    Array.prototype.slice.call(body.querySelectorAll("[data-member]")).forEach(function (sel) {
      sel.addEventListener("change", function () {
        api().patch("/api/members/" + encodeURIComponent(sel.dataset.member), { role: sel.value }).then(render).catch(function (e) { alert(e.message || e); });
      });
    });
    Array.prototype.slice.call(body.querySelectorAll("[data-disable]")).forEach(function (b) {
      b.addEventListener("click", function () {
        api().patch("/api/members/" + encodeURIComponent(b.dataset.disable), { disabled: b.dataset.disabled !== "1" }).then(render).catch(function (e) { alert(e.message || e); });
      });
    });
  }

  async function renderAudit(body) {
    var data = await api().get("/api/audit?limit=80");
    var logs = data.logs || [];
    body.innerHTML = '<p class="platform-note">最近 80 条审计。登录、切租户、建 Job、审批、Provider 更新都会落库；详情已脱敏，不含 key。</p>' +
      '<div class="audit-list">' + (logs.length ? logs.map(function (l) {
        return '<div class="audit-row"><span>' + esc(l.createdAt.replace("T", " ").slice(0, 19)) + '</span>' +
          '<span class="aa">' + esc(l.action) + '</span>' +
          '<span class="at">' + esc(l.targetType) + ' · ' + esc(l.targetId) + '<span class="ad">' + esc(JSON.stringify(l.detail || {})) + '</span></span>' +
          '<span class="ai">' + esc(l.actorId || "system") + '</span></div>';
      }).join("") : '<div class="platform-empty">还没有审计记录</div>') + '</div>';
  }

  async function renderProvider(body) {
    var data = await api().get("/api/provider");
    var p = data.provider || {};
    var canWrite = api().state.role === "owner" || api().state.role === "admin";
    body.innerHTML = '<p class="platform-note">Provider 只从服务端调用。key 写入 SQLite 前用 AES-256-GCM 加密，前端只能看到掩码。无 key 时 mock / replay 仍可演示。</p>' +
      '<div class="provider-form">' +
      '<div class="provider-field"><label>BASE URL</label><input id="pBase" value="' + esc(p.baseUrl || "") + '"' + (canWrite ? "" : " disabled") + '></div>' +
      '<div class="provider-field"><label>TEXT MODEL · ENDPOINT ID</label><input id="pText" value="' + esc(p.textModel || "") + '" placeholder="按账号填写" ' + (canWrite ? "" : "disabled") + '></div>' +
      '<div class="provider-field"><label>IMAGE MODEL · ENDPOINT ID</label><input id="pImage" value="' + esc(p.imageModel || "") + '" placeholder="按账号填写" ' + (canWrite ? "" : "disabled") + '></div>' +
      '<div class="provider-field"><label>VISION MODEL · 可选</label><input id="pVision" value="' + esc(p.visionModel || "") + '" placeholder="留空则跳过视觉质检" ' + (canWrite ? "" : "disabled") + '></div>' +
      '<div class="provider-field full"><label>API KEY · ' + (p.hasKey ? "已配置 " + esc(p.keyMasked) + "，留空不修改" : "未配置") + '</label><input id="pKey" type="password" placeholder="sk-..." autocomplete="new-password" ' + (canWrite ? "" : "disabled") + '></div>' +
      '<div class="provider-field full"><label><input id="pEnabled" type="checkbox" ' + (p.enabled ? "checked" : "") + (canWrite ? "" : " disabled") + '> 启用 live 模式</label></div>' +
      '<div class="provider-actions">' +
      (canWrite ? '<button type="button" class="btn-run" id="pSave">保存配置</button><button type="button" class="btn-ghost" id="pTest">测试连接</button>' : '') +
      '<span class="provider-status" id="pStatus">' + (p.hasKey ? "key 已配置 · 掩码 " + esc(p.keyMasked) : "尚未配置 key") + '</span></div>' +
      '</div>' +
      '<p class="platform-note" style="margin-top:12px">env 兜底：<code>ARK_BASE_URL</code> / <code>ARK_API_KEY</code> / <code>ARK_TEXT_MODEL</code> / <code>ARK_IMAGE_MODEL</code>。保存 key 后，服务端只返回掩码。</p>';

    var save = q("pSave"), test = q("pTest");
    if (save) save.addEventListener("click", function () {
      save.disabled = true;
      var status = q("pStatus"); status.className = "provider-status"; status.textContent = "保存中…";
      api().put("/api/provider", {
        baseUrl: q("pBase").value.trim(), textModel: q("pText").value.trim(),
        imageModel: q("pImage").value.trim(), visionModel: q("pVision").value.trim(),
        apiKey: q("pKey").value.trim(), enabled: q("pEnabled").checked
      }).then(function () {
        status.className = "provider-status ok"; status.textContent = "已保存 · key 只存密文";
        var key = q("pKey"); if (key && key.value) { key.value = ""; key.placeholder = "已保存（不回显）"; }
        save.disabled = false;
      })
        .catch(function (e) { status.className = "provider-status fail"; status.textContent = e.message || e; save.disabled = false; });
    });
    if (test) test.addEventListener("click", function () {
      test.disabled = true;
      var status = q("pStatus"); status.className = "provider-status"; status.textContent = "调用中…";
      api().post("/api/provider/test", {}).then(function (r) {
        status.className = "provider-status ok"; status.textContent = "连接成功 · " + (r.model || "") + " · " + ((r.usage && r.usage.total_tokens) || 0) + " tokens";
      }).catch(function (e) {
        status.className = "provider-status fail"; status.textContent = "失败 · " + (e.message || e);
      }).finally(function () { test.disabled = false; });
    });
  }

  window.OVEM_PLATFORM = { state: S, render: render, section: function (s) { S.section = s; render(); } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
