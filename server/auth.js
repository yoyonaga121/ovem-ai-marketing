/* ============================================================
   OVEM B3 · 会话 / 密码 / 租户身份
   ------------------------------------------------------------
   Cookie: ovem_session（HttpOnly + SameSite=Lax）
   写请求需要 X-OVEM-CSRF，CSRF 随会话落库。
   角色：owner / admin / editor / viewer
   ============================================================ */
"use strict";

const crypto = require("node:crypto");
const dbm = require("./db");

const COOKIE = "ovem_session";
const SESSION_HOURS = 8;
const ROLES = ["owner", "admin", "editor", "viewer"];
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };

function sha256(v) { return crypto.createHash("sha256").update(String(v)).digest("hex"); }
function randomToken() { return crypto.randomBytes(32).toString("base64url"); }
function randomCsrf() { return crypto.randomBytes(24).toString("base64url"); }

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function cookieHeader(token, maxAgeSec) {
  return COOKIE + "=" + encodeURIComponent(token) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAgeSec;
}

function clearCookieHeader() {
  return COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function membershipFor(userId, tenantId) {
  const db = dbm.db;
  return db.prepare("SELECT * FROM memberships WHERE user_id = ? AND tenant_id = ?").get(userId, tenantId) || null;
}

function tenantById(id) {
  return dbm.db.prepare("SELECT * FROM tenants WHERE id = ?").get(id) || null;
}

function roleFor(user, tenantId) {
  if (!user) return null;
  if (user.is_platform) return "owner";
  const m = membershipFor(user.id, tenantId);
  return m ? m.role : null;
}

function can(role, min) {
  return !!role && (ROLE_RANK[role] || 0) >= (ROLE_RANK[min] || 99);
}

function createSession(userId, tenantId, ip) {
  const db = dbm.db;
  const token = randomToken();
  const csrf = randomCsrf();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  db.prepare("INSERT INTO sessions (id,user_id,tenant_id,token_hash,csrf,expires_at,created_at,ip) VALUES (?,?,?,?,?,?,?,?)")
    .run(dbm.newId("s"), userId, tenantId, sha256(token), csrf, expires.toISOString(), now.toISOString(), ip || "");
  return { token, csrf, expiresAt: expires.toISOString(), maxAge: SESSION_HOURS * 3600 };
}

function lookupSession(token) {
  if (!token) return null;
  const db = dbm.db;
  const row = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.id);
    return null;
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  if (!user || user.disabled) return null;
  const tenant = tenantById(row.tenant_id);
  if (!tenant) return null;
  const role = roleFor(user, row.tenant_id);
  if (!role) return null;
  return { session: row, user, tenant, role, csrf: row.csrf };
}

function authenticate(req) {
  const cookies = parseCookies(req);
  return lookupSession(cookies[COOKIE]);
}

function requireCsrf(req, ctx) {
  if (!ctx) return false;
  const h = req.headers["x-ovem-csrf"];
  return typeof h === "string" && h.length > 0 && h === ctx.csrf;
}

function revoke(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE];
  if (token) dbm.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

function listTenantsFor(user) {
  const db = dbm.db;
  if (user.is_platform) {
    return db.prepare("SELECT id,name,slug,plan,created_at FROM tenants ORDER BY CASE WHEN id = 't-ovem' THEN 0 ELSE 1 END, created_at, id").all().map(function (t) {
      return { id: t.id, name: t.name, slug: t.slug, plan: t.plan, role: "owner" };
    });
  }
  return db.prepare(
    "SELECT t.id,t.name,t.slug,t.plan,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id = ? ORDER BY CASE WHEN t.id = 't-ovem' THEN 0 ELSE 1 END, t.created_at, t.id"
  ).all(user.id).map(function (t) { return { id: t.id, name: t.name, slug: t.slug, plan: t.plan, role: t.role }; });
}

function switchTenant(ctx, tenantId) {
  if (!ctx) return { ok: false, code: "unauthenticated" };
  const allowed = ctx.user.is_platform || !!membershipFor(ctx.user.id, tenantId);
  if (!allowed) return { ok: false, code: "forbidden" };
  const tenant = tenantById(tenantId);
  if (!tenant) return { ok: false, code: "not_found" };
  const csrf = randomCsrf();
  dbm.db.prepare("UPDATE sessions SET tenant_id = ?, csrf = ? WHERE id = ?").run(tenantId, csrf, ctx.session.id);
  return { ok: true, tenant, role: roleFor(ctx.user, tenantId), csrf };
}

function login(email, password, ip) {
  const db = dbm.db;
  const user = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(String(email || "").trim());
  if (!user || user.disabled || !dbm.verifyPassword(password, user.password_hash)) return null;
  const tenants = listTenantsFor(user);
  if (!tenants.length) return null;
  const tenantId = user.is_platform ? tenants[0].id : tenants[0].id;
  const session = createSession(user.id, tenantId, ip);
  return { user, tenant: tenantById(tenantId), role: roleFor(user, tenantId), tenants, session };
}

module.exports = {
  COOKIE, SESSION_HOURS, ROLES, ROLE_RANK,
  parseCookies, cookieHeader, clearCookieHeader,
  createSession, lookupSession, authenticate, requireCsrf, revoke,
  listTenantsFor, switchTenant, login, roleFor, membershipFor, can, tenantById
};
