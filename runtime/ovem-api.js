/* ============================================================
   OVEM B3 · 前端 API 客户端
   ------------------------------------------------------------
   只在 http(s) 下启用；file:// 继续 A 的 IndexedDB 模式。
   统一处理 Cookie、CSRF、401 跳登录、租户/角色徽标。
   ============================================================ */
"use strict";

(function () {
  var S = {
    enabled: false, booted: false, user: null, tenant: null, role: null,
    csrf: "", tenants: [], provider: null, error: ""
  };

  function isHttp() { return /^https?:/.test(location.protocol); }
  function q(id) { return document.getElementById(id); }
  function setText(id, v) { var e = q(id); if (e) e.textContent = v; }

  function loginUrl() {
    var next = location.pathname + location.hash;
    return "/login.html?next=" + encodeURIComponent(next);
  }

  async function request(path, opt) {
    opt = opt || {};
    var headers = Object.assign({}, opt.headers || {});
    if (opt.body && !headers["content-type"]) headers["content-type"] = "application/json";
    if (S.csrf && opt.method && opt.method !== "GET") headers["x-ovem-csrf"] = S.csrf;
    var res = await fetch(path, {
      method: opt.method || "GET",
      headers: headers,
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      credentials: "same-origin"
    });
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401) {
      S.enabled = false;
      document.dispatchEvent(new CustomEvent("ovem:unauth"));
      if (!window.__OVEM_NO_REDIRECT__) location.href = loginUrl();
      throw Object.assign(new Error((data && data.message) || "未登录"), { status: 401, code: "unauthenticated", data: data });
    }
    if (!res.ok) throw Object.assign(new Error((data && data.message) || ("HTTP " + res.status)), { status: res.status, code: data && data.code, data: data });
    return data;
  }

  async function boot() {
    if (S.booted) return S;
    S.booted = true;
    if (!isHttp()) { renderSession(); return S; }
    try {
      await request("/api/health");
      var me = await request("/api/auth/me");
      apply(me);
      S.enabled = true;
      renderSession();
      document.dispatchEvent(new CustomEvent("ovem:ready", { detail: S }));
    } catch (e) {
      S.enabled = false; S.error = e && (e.message || String(e)) || "boot failed";
      try { console.warn("[ovem-api] boot failed", e); } catch (e2) {}
      renderSession();
      document.dispatchEvent(new CustomEvent("ovem:error", { detail: S }));
    }
    return S;
  }

  function apply(me) {
    S.user = me.user || null;
    S.tenant = me.tenant || null;
    S.role = me.role || null;
    S.csrf = me.csrf || "";
    S.tenants = me.tenants || [];
    S.provider = me.provider || null;
  }

  function roleLabel(r) {
    return { owner: "OWNER", admin: "ADMIN", editor: "EDITOR", viewer: "VIEWER" }[r] || String(r || "").toUpperCase();
  }

  function renderSession() {
    var chip = q("sessionChip");
    if (!chip) return;
    if (!S.enabled || !S.user) { chip.hidden = true; return; }
    chip.hidden = false;
    setText("sessionUser", S.user.name || S.user.email);
    setText("sessionTenant", S.tenant ? S.tenant.name : "—");
    var role = q("sessionRole");
    if (role) {
      role.textContent = roleLabel(S.role);
      role.className = "sc-role is-" + (S.role || "viewer");
    }
    setText("sessionTenants", String(S.tenants.length || 0));
    setText("versionTag", "v4.0 · B3");
    setText("agentRuntimeNote", "3 个 Agent / 9 个工具 / 4 条 Prompt，运行态写入 SQLite（多租户）。");
    var foot = q("railFoot");
    if (foot) foot.innerHTML = "OVEM OS · v4.0<br>node · SQLite · WAL<br>tenant · RBAC · audit";
  }

  async function refresh() {
    if (!S.enabled) return S;
    var me = await request("/api/auth/me");
    apply(me);
    renderSession();
    return S;
  }

  async function switchTenant(tenantId) {
    var me = await request("/api/tenants/switch", { method: "POST", body: { tenantId: tenantId } });
    apply(me);
    renderSession();
    document.dispatchEvent(new CustomEvent("ovem:tenant", { detail: S }));
    return S;
  }

  async function logout() {
    try { await request("/api/auth/logout", { method: "POST", body: {} }); } catch (e) {}
    location.href = "/login.html";
  }

  function bind() {
    var btn = q("logoutBtn");
    if (btn) btn.addEventListener("click", logout);
  }

  window.OVEM_API = {
    state: S,
    boot: boot,
    request: request,
    refresh: refresh,
    switchTenant: switchTenant,
    logout: logout,
    loginUrl: loginUrl,
    get: function (p) { return request(p); },
    post: function (p, body) { return request(p, { method: "POST", body: body || {} }); },
    put: function (p, body) { return request(p, { method: "PUT", body: body || {} }); },
    patch: function (p, body) { return request(p, { method: "PATCH", body: body || {} }); }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { bind(); boot(); });
  } else { bind(); boot(); }
})();
