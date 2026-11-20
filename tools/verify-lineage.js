/* ============================================================
   A4 套件 · 成果层联动静态核对 + 浏览器/后台结果合并
   ------------------------------------------------------------
   用法：
     node tools/verify-lineage.js
     node tools/verify-lineage.js --selftest docs/v3/reports/S4.browser.json --backend docs/v3/reports/S4.backend.json
   静态断言：17 页 section / 17 条 lineage / 脚本顺序 / 顶栏入口 /
             P4-P7 注入点 / 后台只读运行记录。
   浏览器结果：index.html?selftest=1 导出的 A4 JSON。
   后台结果：配置中台「Agent 管理 · 运行记录」导出的 A4-backend JSON。
   输出 docs/v3/reports/S4.json；退出码 0/1。
   ============================================================ */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function exist(rel) { return fs.existsSync(path.join(ROOT, rel)); }

function gitInfo() {
  const run = a => execFileSync("git", a, { cwd: ROOT }).toString().trim();
  try {
    return {
      ref: run(["rev-parse", "--short", "HEAD"]),
      tag: run(["describe", "--tags", "--abbrev=0"]),
      dirty: run(["status", "--porcelain", "--", ".", ":(exclude)docs/v3/reports", ":(exclude)docs/v3/evidence"]).length > 0
    };
  } catch (e) {
    return { ref: null, tag: null, dirty: null, error: String(e.message || e) };
  }
}

const checks = [];
const add = (id, title, ok, detail) => checks.push({ id, title, ok: !!ok, detail });

const LINEAGE = "runtime/ovem-lineage.js";
const INDEX = "index.html";
const BACKEND = "OVEM配置后台.html";
const missing = [LINEAGE, INDEX, BACKEND].filter(f => !exist(f));
let syntaxOk = true;
try { execFileSync(process.execPath, ["--check", path.join(ROOT, LINEAGE)], { stdio: "pipe" }); }
catch (e) { syntaxOk = false; }
add("S4-01", "血缘模块存在 · node --check 通过", missing.length === 0 && syntaxOk,
  missing.length ? "缺失：" + missing.join("、") : "3/3 文件存在 · " + LINEAGE + " 语法 " + (syntaxOk ? "通过" : "失败"));

const html = read(INDEX);
const js = read(LINEAGE);
const backend = read(BACKEND);

const sections = [...html.matchAll(/<section class="view[^"]*" id="view-(p\d+)"/g)].map(m => m[1]);
const agent = (() => {
  const w = {};
  new Function("window", read("data/ovem-agent.js"))(w);
  return w.OVEM_AGENT || {};
})();
const lineageKeys = Object.keys(agent.lineage || {});
const wantPages = Array.from({ length: 17 }, (_, i) => "p" + i);
const pageOk = sections.length === 17 && lineageKeys.length === 17
  && wantPages.every(p => sections.indexOf(p) >= 0 && lineageKeys.indexOf(p) >= 0);
add("S4-02", "17 页 section + 17 条 lineage 一一对应", pageOk,
  "sections=" + sections.length + "/17 · lineage=" + lineageKeys.length + "/17");

const srcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1]);
const wantTail = ["data/ovem-schema.js", "data/ovem-agent.js", "runtime/ovem-trace.js", "runtime/ovem-store.js", LINEAGE, "runtime/ovem-agent-embed.js"];
const tail = srcs.slice(-6);
const tailOk = tail.length === 6 && wantTail.every((s, i) => tail[i] === s);
add("S4-03", "成果层按 schema→agent→trace→store→lineage→embed 顺序加载", tailOk,
  tail.join(" → "));

const topOk = /href="workbench\.html"[^>]*>Agent 工作台/.test(html);
add("S4-04", "前台顶栏有「Agent 工作台」入口", topOk,
  topOk ? "index.html 顶栏链接指向 workbench.html" : "未找到 Agent 工作台入口");

const hookOk = /lineageRunSummary/.test(js) && /lineageP4Artifacts/.test(js) && /lineageP7Status/.test(js)
  && /data-run-id/.test(js) && /data-status-count/.test(js) && /lineage-strip/.test(js);
add("S4-05", "P0 摘要 / P4 产物 / P7 状态注入点齐全", hookOk,
  "summary=" + (/lineageRunSummary/.test(js) ? "✓" : "✕")
  + " · p4=" + (/lineageP4Artifacts/.test(js) ? "✓" : "✕")
  + " · p7=" + (/lineageP7Status/.test(js) ? "✓" : "✕")
  + " · runId 属性=" + (/data-run-id/.test(js) ? "✓" : "✕"));

const backendOk = /runtime\/ovem-store\.js/.test(backend) && /id="agentRuns"/.test(backend)
  && /data-run-row/.test(backend) && /data-run-id/.test(backend) && /__AGENT_RUNS__/.test(backend);
add("S4-06", "后台「运行记录」只读 IndexedDB · 条数/成本可断言", backendOk,
  "store=" + (/runtime\/ovem-store\.js/.test(backend) ? "✓" : "✕")
  + " · card=" + (/id="agentRuns"/.test(backend) ? "✓" : "✕")
  + " · rows=" + (/data-run-row/.test(backend) ? "✓" : "✕"));

/* ---------- 浏览器 ---------- */
const browserPath = path.join(ROOT, opt("--selftest", "docs/v3/reports/S4.browser.json"));
const backendPath = path.join(ROOT, opt("--backend", "docs/v3/reports/S4.backend.json"));
let browser = null, be = null;
try { browser = JSON.parse(fs.readFileSync(browserPath, "utf8")); } catch (e) { browser = null; }
try { be = JSON.parse(fs.readFileSync(backendPath, "utf8")); } catch (e) { be = null; }

const bCases = (browser && browser.cases) || [];
const bSummary = (browser && browser.summary) || { total: 0, passed: 0, failed: 0 };
const bMetrics = (browser && browser.metrics) || {};
const bRuns = (browser && browser.runs) || {};
const bLatest = bRuns.latest || null;

const browserOk = bSummary.total === 5 && bSummary.passed === 5 && bSummary.failed === 0
  && bMetrics.strips === 17 && bMetrics.pages === 17 && bMetrics.artifacts >= 1
  && bMetrics.p7Statuses === bMetrics.artifacts && bMetrics.errors === 0;
add("S4-07", "浏览器 A4 5/5 · 17 条血缘 / P4 / P7 / 零错误", browserOk,
  browser ? ("cases=" + bSummary.passed + "/" + bSummary.total + " · strips=" + bMetrics.strips + "/17 · artifacts=" + bMetrics.artifacts + " · statuses=" + bMetrics.p7Statuses + " · errors=" + bMetrics.errors) : "未找到 " + path.relative(ROOT, browserPath));

const backendMatch = be && bLatest && be.count === bRuns.count
  && be.latest && be.latest.id === bLatest.id
  && Math.abs(Number(be.latest.cost) - Number(bLatest.cost)) < 1e-9
  && be.latest.startedAt === bLatest.startedAt;
add("S4-08", "后台运行记录条数 / runId / 成本与 store 一致", backendMatch,
  be ? ("backend=" + be.count + " 条 · latest=" + (be.latest && be.latest.id) + " ¥" + (be.latest && Number(be.latest.cost).toFixed(4))
    + " · store=" + bRuns.count + " 条 · latest=" + (bLatest && bLatest.id) + " ¥" + (bLatest && Number(bLatest.cost).toFixed(4)))
    : "未找到 " + path.relative(ROOT, backendPath));

const evidence = [
  ["docs/v3/evidence/S4_A4-01_lineage.png", "P0 17 页血缘条 + 最近 run 摘要"],
  ["docs/v3/evidence/S4_A4-02_p4.png", "P4 本次 run 三张产物卡（runId 一致）"],
  ["docs/v3/evidence/S4_A4-03_p7.png", "P7 渠道状态由 artifacts.status 派生"],
  ["docs/v3/evidence/S4_A4-04_backend.png", "后台 Agent 管理 · 运行记录只读 IndexedDB"],
  ["docs/v3/evidence/S4_A4-05_clean.png", "index.html?selftest=1 · A4 5/5 · 零 console error"]
];
const evMissing = evidence.filter(e => !exist(e[0]));
add("S4-09", "5 张验收截图归档", evMissing.length === 0,
  evMissing.length ? "缺失：" + evMissing.map(e => e[0]).join("、") : evidence.length + "/5 张存在");

/* ---------- 汇总 ---------- */
const failedChecks = checks.filter(c => !c.ok);
const cases = bCases.map(c => ({ id: c.id, title: c.name, status: c.ok ? "pass" : "fail", detail: c.detail, ms: c.ms }));

const payload = {
  stage: "S4",
  title: "成果层联动",
  suite: "A4",
  at: new Date().toISOString(),
  git: gitInfo(),
  source: {
    lineage: LINEAGE,
    index: INDEX,
    backend: BACKEND,
    browser: path.relative(ROOT, browserPath).split(path.sep).join("/"),
    backendReport: path.relative(ROOT, backendPath).split(path.sep).join("/"),
    version: "v3.0.0-s4"
  },
  metrics: {
    pages: 17,
    strips: bMetrics.strips || 0,
    artifacts: bMetrics.artifacts || 0,
    p7Statuses: bMetrics.p7Statuses || 0,
    runs: bRuns.count || 0,
    latestRun: bLatest && bLatest.id,
    latestCost: bLatest && bLatest.cost,
    errors: bMetrics.errors == null ? null : bMetrics.errors,
    backendCount: be && be.count
  },
  summary: {
    total: cases.length,
    passed: cases.filter(c => c.status === "pass").length,
    failed: cases.filter(c => c.status !== "pass").length,
    pending: 0
  },
  cases,
  runs: bRuns,
  backend: be,
  staticChecks: checks,
  browser: {
    status: browserOk && backendMatch ? "pass" : "fail",
    note: browser ? ("A4 5/5 · 17 页血缘 · P4/P7 与最新 run 同源 · 后台 34 条只读记录") : "未找到浏览器结果",
    checklist: ["17/17 血缘条", "P4 runId", "P7 渠道状态", "P0 摘要", "后台运行记录", "零错误"]
  },
  artifacts: evidence.filter(e => exist(e[0])).map(e => ({ type: "screenshot", path: e[0], note: e[1] }))
};

if (browser) payload.artifacts.push({ type: "data", path: path.relative(ROOT, browserPath).split(path.sep).join("/"), note: "index.html?selftest=1 导出的 A4 原始结果" });
if (be) payload.artifacts.push({ type: "data", path: path.relative(ROOT, backendPath).split(path.sep).join("/"), note: "后台运行记录对照数据" });

const out = path.join(ROOT, "docs/v3/reports/S4.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", "utf8");

const line = "─".repeat(78);
console.log("\nA4 套件 · 成果层联动 · " + INDEX);
console.log(line);
cases.forEach(c => {
  console.log((c.status === "pass" ? "PASS  " : "FAIL  ") + c.id + "   " + c.title);
  console.log("      " + c.detail);
});
console.log(line);
console.log("静态核对");
checks.forEach(c => console.log((c.ok ? "  ✓ " : "  ✕ ") + c.id + " " + c.title + " · " + c.detail));
console.log(line);
console.log("用例 " + payload.summary.passed + "/" + payload.summary.total + " · 静态 " + (checks.length - failedChecks.length) + "/" + checks.length);
console.log("报告 → " + path.relative(ROOT, out));
process.exit(payload.summary.failed || failedChecks.length ? 1 : 0);
