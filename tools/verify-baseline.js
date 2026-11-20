#!/usr/bin/env node
/* ============================================================
   S0 基线核对脚本（A0-01 ~ A0-04）
   ------------------------------------------------------------
   用法：
     node tools/verify-baseline.js
     node tools/verify-baseline.js --out docs/v3/reports/S0.json
     node tools/verify-baseline.js --idb pass --idb-note "6 stores / 9 indexes"
   说明：
     A0-05（file:// 下 IndexedDB 建库）由浏览器测试台 tools/selftest.html?suite=A0
     产生结果，通过 --idb pass|fail 合并进同一份报告，保证一次任务一份证据。
   ============================================================ */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");                       // OVEM站点_v2.0
const V1_DIR = path.resolve(ROOT, "..", "OVEM站点_v1.0_冻结_20261120");
const REPORT_DIR = path.join(ROOT, "docs", "v3", "reports");

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const OUT = path.resolve(ROOT, arg("out", "docs/v3/reports/S0.json"));
const IDB = arg("idb", "pending");                                 // pass | fail | pending
const IDB_NOTE = arg("idb-note", "");

const EXPECTED_V1_MD5 = "77D55499DA0095B83163E4BA6DD37967";
const cases = [];

function add(id, ok, detail, ms) {
  cases.push({ id, ok: ok === true, detail: String(detail), ms: ms === undefined ? 0 : ms });
}

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function gitInfo() {
  const { execFileSync } = require("child_process");
  const run = args => execFileSync("git", args, { cwd: ROOT }).toString().trim();
  try {
    const ref = run(["rev-parse", "--short", "HEAD"]);
    const tag = run(["describe", "--tags", "--abbrev=0"]);
    const dirty = run([
      "status", "--porcelain", "--", ".",
      ":(exclude)docs/v3/reports", ":(exclude)docs/v3/evidence"
    ]).length > 0;
    return { ref, dirty, tag };
  } catch (e) {
    return { ref: null, dirty: null, tag: null, error: String(e.message || e) };
  }
}

/* A0-01  v1 冻结副本未被改动 */
(function () {
  const t0 = Date.now();
  const f = path.join(V1_DIR, "index.html");
  if (!fs.existsSync(f)) return add("A0-01", false, "未找到 v1 冻结副本：" + f, Date.now() - t0);
  const md5 = crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex").toUpperCase();
  add("A0-01", md5 === EXPECTED_V1_MD5, "v1 index.html MD5=" + md5 + (md5 === EXPECTED_V1_MD5 ? "（与基线一致）" : "（与基线不符）"), Date.now() - t0);
})();

/* A0-02  v2 前台内联脚本可解析 */
(function () {
  const t0 = Date.now();
  const html = read("index.html");
  const scripts = inlineScripts(html);
  if (!scripts.length) return add("A0-02", false, "未找到内联 <script>", Date.now() - t0);
  let compiled = 0, error = null;
  for (let i = 0; i < scripts.length; i++) {
    try { new Function(scripts[i]); compiled++; }
    catch (e) { error = "第 " + (i + 1) + " 段：" + (e.message || e); break; }
  }
  add("A0-02", !error, error ? error : scripts.length + " 段内联脚本全部可编译", Date.now() - t0);
})();

/* A0-03  17 个页 section 齐全；导航页序以契约为准（DOM 顺序按内容分组，不参与断言） */
(function () {
  const t0 = Date.now();
  const html = read("index.html");
  const ids = [];
  const re = /id="view-(p\d+)"/g;
  let m;
  while ((m = re.exec(html))) if (!ids.includes(m[1])) ids.push(m[1]);

  const win = {};
  new Function("window", read("data/ovem-schema.js"))(win);
  const order = (win.OVEM_SCHEMA && win.OVEM_SCHEMA.pages || []).map(p => p.id);
  const expect = Array.from({ length: 17 }, (_, i) => "p" + i);

  const missing = expect.filter(x => !ids.includes(x));
  const extra = ids.filter(x => !expect.includes(x));
  const ordered = order.join(",") === expect.join(",");
  const sameSet = order.length === ids.length && order.every(x => ids.includes(x));

  add("A0-03",
    ids.length === 17 && !missing.length && !extra.length && ordered && sameSet,
    "DOM " + ids.length + "/17" + (missing.length ? " 缺 " + missing.join(",") : "") + (extra.length ? " 多 " + extra.join(",") : "") +
    " · 契约页序 p0–p16 " + (ordered ? "连续" : "断裂") + " · 集合" + (sameSet ? "一致" : "不一致"),
    Date.now() - t0);
})();

/* A0-04  数据与契约版本、数量 */
(function () {
  const t0 = Date.now();
  const win = {};
  new Function("window", read("data/ovem-data.js"))(win);
  new Function("window", read("data/ovem-schema.js"))(win);
  const D = win.OVEM_DATA, S = win.OVEM_SCHEMA;
  if (!D || !S) return add("A0-04", false, "数据或契约未挂载到 window", Date.now() - t0);
  const checks = [
    D.meta && D.meta.version === "v2.0.0",
    S.version === "2.0.0",
    Array.isArray(D.products) && D.products.length === 20,
    Array.isArray(D.channels) && D.channels.length === 8,
    Array.isArray(S.pages) && S.pages.length === 17,
    Array.isArray(S.sections) && S.sections.length === 7,
    Array.isArray(S.rules) && S.rules.length === 5
  ];
  const detail = "data=" + (D.meta && D.meta.version) + "/schema=" + S.version +
    " · 产品" + D.products.length + " 渠道" + D.channels.length +
    " · 契约页" + S.pages.length + " 分区" + S.sections.length + " 规则" + S.rules.length;
  add("A0-04", checks.every(Boolean), detail, Date.now() - t0);
})();

/* A0-05  IndexedDB（浏览器项，由 --idb 合并） */
(function () {
  const ok = IDB === "pass";
  add("A0-05", ok, IDB === "pending"
    ? "待浏览器执行：tools/selftest.html?suite=A0"
    : (IDB === "pass" ? "file:// 下 IndexedDB 建库成功" + (IDB_NOTE ? "（" + IDB_NOTE + "）" : "")
                     : "失败：" + (IDB_NOTE || "见测试台输出")), 0);
})();

/* 汇总与落盘 */
const summary = {
  total: cases.length,
  passed: cases.filter(c => c.ok).length,
  failed: cases.filter(c => !c.ok && c.id !== "A0-05").length,
  pending: cases.filter(c => !c.ok && c.id === "A0-05" && IDB === "pending").length
};
const report = {
  stage: "S0",
  generatedAt: new Date().toISOString(),
  git: gitInfo(),
  cases,
  summary,
  artifacts: ["docs/v3/reports/S0.json"]
};
const EVIDENCE = "docs/v3/evidence/S0_A0-05_idb.png";
if (fs.existsSync(path.join(ROOT, EVIDENCE))) report.artifacts.push(EVIDENCE);

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n", "utf8");

/* 控制台输出 */
const pad = (s, n) => String(s).padEnd(n, " ");
console.log("\nS0 基线核对 · " + report.generatedAt);
console.log("git: " + (report.git.tag || "-") + " @ " + (report.git.ref || "-") + (report.git.dirty ? "（dirty）" : ""));
console.log("─".repeat(72));
cases.forEach(c => {
  const flag = c.ok ? "PASS" : (c.id === "A0-05" && IDB === "pending" ? "WAIT" : "FAIL");
  console.log(pad(flag, 6) + pad(c.id, 8) + c.detail);
});
console.log("─".repeat(72));
console.log("通过 " + summary.passed + " / 失败 " + summary.failed + " / 待执行 " + summary.pending);
console.log("报告 → " + path.relative(ROOT, OUT));
process.exit(summary.failed > 0 ? 1 : 0);
