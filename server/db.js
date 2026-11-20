/* ============================================================
   OVEM B3 · SQLite 数据层
   ------------------------------------------------------------
   Node 22 内置 node:sqlite，零第三方依赖。
   表：tenants / users / memberships / sessions / provider_configs
       jobs / missions / runs / traces / artifacts / reviews
       publications / audit_logs / meta
   ============================================================ */
"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DB = process.env.OVEM_DB || path.join(__dirname, "ovem.db");
const SEED_PASSWORD = process.env.OVEM_SEED_PASSWORD || "ovem-demo-2026";

let db = null;
let dbPath = DEFAULT_DB;

function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return prefix + "-" + crypto.randomUUID(); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return "scrypt$" + salt + "$" + hash;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const salt = parts[1];
    const expected = Buffer.from(parts[2], "hex");
    const actual = crypto.scryptSync(String(password), salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (e) { return false; }
}

function open(file) {
  if (db) return db;
  dbPath = file || DEFAULT_DB;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

function migrate() {
  open();
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL DEFAULT 'demo',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_platform INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),
      created_at TEXT NOT NULL,
      UNIQUE(user_id, tenant_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      csrf TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ip TEXT
    );

    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'ark',
      base_url TEXT NOT NULL,
      text_model TEXT,
      image_model TEXT,
      vision_model TEXT,
      api_key_cipher TEXT,
      api_key_last4 TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL UNIQUE,
      mission_json TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'mock',
      status TEXT NOT NULL DEFAULT 'queued',
      budget_cny REAL NOT NULL DEFAULT 0,
      cost_cny REAL NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      data_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      job_id TEXT,
      mission_id TEXT,
      agent_id TEXT,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      plan_json TEXT,
      stats_json TEXT,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      payload_json TEXT,
      cost_cny REAL,
      ts TEXT NOT NULL,
      UNIQUE(run_id, seq)
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'bundle',
      product_id TEXT,
      channel_id TEXT,
      name TEXT,
      url TEXT,
      meta_json TEXT,
      qa_json TEXT,
      status TEXT NOT NULL DEFAULT 'review',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      gate TEXT NOT NULL,
      decision TEXT,
      actor_id TEXT,
      note TEXT,
      pct REAL,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      path TEXT,
      manifest_json TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      decided_by TEXT,
      decided_at TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      actor_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail_json TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_runs_tenant_started ON runs(tenant_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_traces_run_seq ON traces(run_id, seq);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_run ON reviews(run_id);
    CREATE INDEX IF NOT EXISTS idx_publications_run ON publications(run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(tenant_id, created_at);
  `);
  return db;
}

function seed() {
  open();
  const count = db.prepare("SELECT COUNT(*) AS c FROM tenants").get().c;
  if (count > 0) return false;

  const createdAt = nowIso();
  const password = hashPassword(SEED_PASSWORD);

  const tenants = [
    { id: "t-ovem", name: "光谷效应 · 演示租户", slug: "ovem-demo", plan: "demo" },
    { id: "t-beichen", name: "北辰品牌 · 客户租户", slug: "beichen-demo", plan: "demo" }
  ];
  const users = [
    { id: "u-owner", email: "owner@ovem.local", name: "OVEM Owner", platform: 1, tenants: ["t-ovem", "t-beichen"] },
    { id: "u-admin", email: "admin@ovem.local", name: "OVEM Admin", platform: 0, tenants: ["t-ovem"] },
    { id: "u-editor", email: "editor@ovem.local", name: "OVEM Editor", platform: 0, tenants: ["t-ovem"] },
    { id: "u-viewer", email: "viewer@ovem.local", name: "OVEM Viewer", platform: 0, tenants: ["t-ovem"] },
    { id: "u-beichen-owner", email: "owner@beichen.local", name: "北辰 Owner", platform: 0, tenants: ["t-beichen"] },
    { id: "u-beichen-editor", email: "editor@beichen.local", name: "北辰 Editor", platform: 0, tenants: ["t-beichen"] }
  ];

  const insertTenant = db.prepare("INSERT INTO tenants (id,name,slug,plan,created_at) VALUES (?,?,?,?,?)");
  const insertUser = db.prepare("INSERT INTO users (id,email,name,password_hash,is_platform,disabled,created_at) VALUES (?,?,?,?,?,0,?)");
  const insertMember = db.prepare("INSERT INTO memberships (id,user_id,tenant_id,role,created_at) VALUES (?,?,?,?,?)");
  const roles = { "u-owner": "owner", "u-admin": "admin", "u-editor": "editor", "u-viewer": "viewer", "u-beichen-owner": "owner", "u-beichen-editor": "editor" };

  tenants.forEach(function (t) { insertTenant.run(t.id, t.name, t.slug, t.plan, createdAt); });
  users.forEach(function (u) {
    insertUser.run(u.id, u.email, u.name, password, u.platform, createdAt);
    u.tenants.forEach(function (tid) {
      insertMember.run(newId("m"), u.id, tid, roles[u.id], createdAt);
    });
  });

  db.prepare("INSERT INTO meta (key,value) VALUES ('run_seq','0') ON CONFLICT(key) DO NOTHING").run();
  db.prepare("INSERT INTO meta (key,value) VALUES ('job_seq','0') ON CONFLICT(key) DO NOTHING").run();
  return true;
}

function nextSeq(key) {
  open();
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  const n = Number(row ? row.value : 0) + 1;
  db.prepare("INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(n));
  return n;
}

function nextRunId() { return "R-" + String(nextSeq("run_seq")).padStart(4, "0"); }
function nextJobId() { return "J-" + String(nextSeq("job_seq")).padStart(4, "0"); }

function close() { if (db) { try { db.close(); } catch (e) {} db = null; } }

module.exports = {
  ROOT, DEFAULT_DB, SEED_PASSWORD,
  open, migrate, seed, close,
  hashPassword, verifyPassword,
  nowIso, newId, nextRunId, nextJobId,
  get db() { return db; },
  get dbPath() { return dbPath; }
};
