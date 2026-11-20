/* ============================================================
   OVEM B4 · 发布审批链
   ------------------------------------------------------------
   review run → 提交 publication(pending) → admin/owner 批准 →
   版本包落盘 published/<slug>/<runId>/vN/ → 审计。
   驳回不落包，并把 run 回 failed；批准后 run 保持 review，
   允许同一 run 再提交 v2，不覆盖 v1。
   ============================================================ */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const dbm = require("./db");
const repo = require("./repo");
const audit = require("./audit");

const ROOT = path.resolve(__dirname, "..");
const PUBLISHED = path.join(ROOT, "published");

function parse(s, fallback) { try { return JSON.parse(s == null ? "" : s); } catch (e) { return fallback; } }
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tenantOf(tenantId) {
  return dbm.db.prepare("SELECT id,name,slug FROM tenants WHERE id = ?").get(tenantId);
}

function list(tenantId, runId) {
  const rows = runId
    ? dbm.db.prepare(
      "SELECT p.*,u.name AS creator_name,u.email AS creator_email,d.name AS decider_name FROM publications p " +
      "LEFT JOIN users u ON u.id=p.created_by LEFT JOIN users d ON d.id=p.decided_by " +
      "WHERE p.tenant_id = ? AND p.run_id = ? ORDER BY p.created_at DESC"
    ).all(tenantId, runId)
    : dbm.db.prepare(
      "SELECT p.*,u.name AS creator_name,u.email AS creator_email,d.name AS decider_name FROM publications p " +
      "LEFT JOIN users u ON u.id=p.created_by LEFT JOIN users d ON d.id=p.decided_by " +
      "WHERE p.tenant_id = ? ORDER BY p.created_at DESC LIMIT 60"
    ).all(tenantId);
  return rows.map(function (r) {
    return {
      id: r.id, tenantId: r.tenant_id, runId: r.run_id, version: r.version, status: r.status,
      path: r.path, manifest: parse(r.manifest_json, null), createdBy: r.created_by,
      creatorName: r.creator_name || "", creatorEmail: r.creator_email || "",
      createdAt: r.created_at, decidedBy: r.decided_by, deciderName: r.decider_name || "",
      decidedAt: r.decided_at, note: r.note || ""
    };
  });
}

function get(tenantId, id) {
  return list(tenantId).find(function (p) { return p.id === id; }) || null;
}

function submit(ctx, runId, note) {
  const run = repo.getRun(ctx.tenant.id, runId);
  if (!run) return { error: "not_found", status: 404, message: "run 不存在或不属于当前租户" };
  if (run.status !== "review") return { error: "bad_state", status: 409, message: "只有 review 状态的 run 才能提交发布，当前 " + run.status };
  const arts = repo.listArtifacts(ctx.tenant.id, runId);
  if (!arts.length) return { error: "no_artifacts", status: 409, message: "run 没有可发布物料" };
  const pending = dbm.db.prepare("SELECT id FROM publications WHERE tenant_id = ? AND run_id = ? AND status = 'pending'").get(ctx.tenant.id, runId);
  if (pending) return { error: "pending_exists", status: 409, message: "该 run 已有待审批发布" };
  const count = dbm.db.prepare("SELECT COUNT(*) AS c FROM publications WHERE tenant_id = ? AND run_id = ?").get(ctx.tenant.id, runId).c;
  const version = "v" + (count + 1);
  const now = dbm.nowIso();
  const id = dbm.newId("pub");
  dbm.db.prepare(
    "INSERT INTO publications (id,run_id,tenant_id,version,status,path,manifest_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(id, runId, ctx.tenant.id, version, "pending", "", "null", ctx.user.id, now);
  audit.write(ctx, "publication.request", "publication", id, { runId: runId, version: version, note: note || "" }, ctx.ip || "");
  return { ok: true, publication: get(ctx.tenant.id, id) };
}

function copyArtifacts(tenant, runId, versionDir, arts) {
  const files = [];
  const version = path.basename(versionDir);
  const dir = path.join(versionDir, "assets");
  fs.mkdirSync(dir, { recursive: true });
  arts.forEach(function (a, i) {
    let src = null;
    let ext = ".png";
    if (a.url && a.url.indexOf("/published/") === 0) {
      src = path.join(ROOT, decodeURIComponent(a.url));
    } else if (a.meta && a.meta.file) {
      src = path.join(PUBLISHED, "runs", runId, a.meta.file);
    }
    let name, dest, buf;
    if (src && fs.existsSync(src) && fs.statSync(src).isFile()) {
      ext = path.extname(src).toLowerCase() || ".png";
      name = (a.channelId || "artifact-" + (i + 1)) + ext;
      dest = path.join(dir, name);
      fs.copyFileSync(src, dest);
      buf = fs.readFileSync(dest);
    } else {
      /* mock run 没有真实图片：生成可打开的品牌占位 SVG，保证版本包可审 */
      ext = ".svg";
      name = (a.channelId || "artifact-" + (i + 1)) + ext;
      dest = path.join(dir, name);
      const ratio = (a.meta && a.meta.ratio) || { w: 4, h: 3 };
      const w = Number((a.meta && a.meta.w) || 1280);
      const h = Number((a.meta && a.meta.h) || 720);
      buf = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<rect width="100%" height="100%" fill="#0B1F3A"/>' +
        '<circle cx="' + Math.round(w * .78) + '" cy="' + Math.round(h * .30) + '" r="' + Math.round(Math.min(w, h) * .18) + '" fill="#2F6FED" opacity=".35"/>' +
        '<text x="48" y="' + Math.round(h * .48) + '" fill="#F5F7FA" font-family="monospace" font-size="' + Math.round(Math.min(w, h) * .05) + '">' + esc(a.channelId || "MOCK") + ' · QA ' + esc(a.qa && a.qa.score || 0) + '</text>' +
        '<text x="48" y="' + Math.round(h * .56) + '" fill="#8FB3D0" font-family="monospace" font-size="' + Math.round(Math.min(w, h) * .028) + '">' + esc(a.id || "") + ' · ' + esc(String(ratio.w) + ":" + String(ratio.h)) + '</text>' +
        '</svg>'
      );
      fs.writeFileSync(dest, buf);
    }
    files.push({
      artifactId: a.id, channelId: a.channelId, name: name,
      bytes: buf.length, sha256: sha256(buf),
      url: "/published/" + tenant.slug + "/" + runId + "/" + version + "/assets/" + name
    });
  });
  return files;
}

function packageHtml(tenant, run, version, pub, files) {
  const cards = files.map(function (f) {
    return '<figure><img src="./assets/' + esc(f.name) + '" alt="' + esc(f.channelId) + '"><figcaption>' +
      esc(f.channelId) + ' · ' + esc(f.artifactId) + ' · ' + Math.round(f.bytes / 1024) + ' KB</figcaption></figure>';
  }).join("");
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(run.id) + ' · ' + esc(version) + ' · OVEM 发布包</title>' +
    '<style>body{margin:0;background:#06101E;color:#DCE9F7;font-family:Inter,system-ui,sans-serif}main{max-width:1120px;margin:0 auto;padding:48px 28px}' +
    'h1{font-size:28px;margin:0 0 10px}p{color:#7C93AC;font-size:12px}header{border-bottom:1px solid #1B3148;padding-bottom:24px;margin-bottom:24px}' +
    'ul{display:flex;gap:10px;flex-wrap:wrap;padding:0;list-style:none;font-family:ui-monospace,monospace;font-size:10px;color:#8FB3D0}' +
    'li{border:1px solid #1B3148;border-radius:6px;padding:6px 8px}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}' +
    'figure{margin:0;border:1px solid #16314A;background:#091827;border-radius:10px;overflow:hidden}img{width:100%;display:block;aspect-ratio:4/3;object-fit:cover}' +
    'figcaption{font-family:ui-monospace,monospace;font-size:10px;color:#7C93AC;padding:10px 12px}</style></head><body><main>' +
    '<header><div style="font-family:ui-monospace;font-size:10px;letter-spacing:.16em;color:#22D3EE">OVEM · PUBLISHED VERSION</div>' +
    '<h1>' + esc(run.id) + ' · ' + esc(version) + '</h1>' +
    '<p>' + esc(tenant.name) + ' · ' + esc(run.missionId || "") + ' · 审批 ' + esc(pub.decided_by || "") + ' · ' + esc(pub.decided_at || "") + '</p>' +
    '<ul><li>status ' + esc(pub.status) + '</li><li>artifacts ' + files.length + '</li><li>run ' + esc(run.id) + '</li><li>17 页成果层未改写</li></ul></header>' +
    '<section>' + cards + '</section></main></body></html>';
}

function approve(ctx, pubId, note) {
  const pub = get(ctx.tenant.id, pubId);
  if (!pub) return { error: "not_found", status: 404, message: "发布记录不存在" };
  if (pub.status !== "pending") return { error: "bad_state", status: 409, message: "只有 pending 发布可以批准" };
  if (pub.createdBy === ctx.user.id && ctx.role === "editor") return { error: "self_approve", status: 403, message: "editor 提交后不能自批，请 admin / owner 批准" };
  const run = repo.getRun(ctx.tenant.id, pub.runId);
  if (!run) return { error: "not_found", status: 404, message: "run 不存在" };
  const arts = repo.listArtifacts(ctx.tenant.id, pub.runId);
  if (!arts.length) return { error: "no_artifacts", status: 409, message: "run 没有可发布物料" };
  const tenant = tenantOf(ctx.tenant.id);
  const versionDir = path.join(PUBLISHED, tenant.slug, pub.runId, pub.version);
  fs.mkdirSync(versionDir, { recursive: true });
  const files = copyArtifacts(tenant, pub.runId, versionDir, arts);
  if (!files.length) return { error: "no_files", status: 409, message: "物料文件未落盘，无法生成版本包" };
  const now = dbm.nowIso();
  const decidedBy = ctx.user.id;
  const manifest = {
    schema: "ovem-publication-v1",
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    runId: pub.runId,
    missionId: run.missionId,
    version: pub.version,
    status: "approved",
    publicationId: pub.id,
    createdBy: pub.createdBy,
    approvedBy: decidedBy,
    approvedAt: now,
    artifacts: files.map(function (f) {
      return { id: f.artifactId, channelId: f.channelId, file: f.name, bytes: f.bytes, sha256: f.sha256, url: f.url };
    })
  };
  const body = packageHtml(tenant, run, pub.version, { status: "approved", decided_by: decidedBy, decided_at: now }, files);
  fs.writeFileSync(path.join(versionDir, "index.html"), body);
  manifest.contentHash = "sha256:" + sha256(body);
  manifest.files = files;
  const written = JSON.stringify(manifest, null, 2);
  manifest.manifestHash = "sha256:" + sha256(written);
  fs.writeFileSync(path.join(versionDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const url = "/published/" + tenant.slug + "/" + pub.runId + "/" + pub.version + "/index.html";
  dbm.db.prepare(
    "UPDATE publications SET status='approved',path=?,manifest_json=?,decided_by=?,decided_at=?,note=? WHERE tenant_id=? AND id=?"
  ).run(url, JSON.stringify(manifest), decidedBy, now, note || "", ctx.tenant.id, pub.id);
  audit.write(ctx, "publication.approve", "publication", pub.id, { runId: pub.runId, version: pub.version, path: url, hash: manifest.manifestHash }, ctx.ip || "");
  return { ok: true, publication: get(ctx.tenant.id, pub.id), manifest: manifest };
}

function reject(ctx, pubId, note) {
  const pub = get(ctx.tenant.id, pubId);
  if (!pub) return { error: "not_found", status: 404, message: "发布记录不存在" };
  if (pub.status !== "pending") return { error: "bad_state", status: 409, message: "只有 pending 发布可以驳回" };
  if (pub.createdBy === ctx.user.id && ctx.role === "editor") return { error: "self_approve", status: 403, message: "editor 提交后不能自批，请 admin / owner 驳回" };
  const now = dbm.nowIso();
  dbm.db.prepare("UPDATE publications SET status='rejected',decided_by=?,decided_at=?,note=? WHERE tenant_id=? AND id=?")
    .run(ctx.user.id, now, note || "未填写原因", ctx.tenant.id, pub.id);
  dbm.db.prepare("UPDATE runs SET status='failed',ended_at=? WHERE tenant_id=? AND id=?").run(now, ctx.tenant.id, pub.runId);
  dbm.db.prepare("UPDATE artifacts SET status='rejected' WHERE tenant_id=? AND run_id=?").run(ctx.tenant.id, pub.runId);
  audit.write(ctx, "publication.reject", "publication", pub.id, { runId: pub.runId, version: pub.version, reason: note || "未填写原因" }, ctx.ip || "");
  return { ok: true, publication: get(ctx.tenant.id, pub.id) };
}

function rollback(ctx, pubId, note) {
  const pub = get(ctx.tenant.id, pubId);
  if (!pub) return { error: "not_found", status: 404, message: "发布记录不存在" };
  if (pub.status !== "approved") return { error: "bad_state", status: 409, message: "只有 approved 版本可以回滚" };
  const now = dbm.nowIso();
  dbm.db.prepare("UPDATE publications SET status='rolled_back',note=? WHERE tenant_id=? AND id=?")
    .run(note || "回滚", ctx.tenant.id, pub.id);
  audit.write(ctx, "publication.rollback", "publication", pub.id, { runId: pub.runId, version: pub.version, note: note || "" }, ctx.ip || "");
  return { ok: true, publication: get(ctx.tenant.id, pub.id) };
}

module.exports = { list, get, submit, approve, reject, rollback };
