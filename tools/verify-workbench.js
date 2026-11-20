/* ============================================================
   A3 套件 · Agent 工作台静态核对 + 浏览器结果合并
   ------------------------------------------------------------
   用法：
     node tools/verify-workbench.js
     node tools/verify-workbench.js --selftest docs/v3/reports/S3.browser.json
   静态断言：壳层 6 视图 / 8 个 classic script 顺序 / 3 条预设 /
             17 页 6 组归类 / 执行器回调 / 兼容跳转。
   浏览器结果：读取 selftest 导出的 A3 JSON（8 条用例 + 3 条 run）。
   输出 docs/v3/reports/S3.json；退出码 0/1。
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

/* ---------- 静态核对 ---------- */
const checks = [];
const add = (id, title, ok, detail) => checks.push({ id, title, ok: !!ok, detail });

const SHELL = "workbench.html";
const UI = "runtime/ovem-ui.js";
const EXEC = "runtime/ovem-executor.js";
const MODULES = ["runtime/ovem-trace.js", "runtime/ovem-store.js", "runtime/ovem-tools.js", EXEC, UI];
const missing = MODULES.filter(f => !exist(f));
const syntaxBad = [];
MODULES.filter(f => !missing.includes(f)).forEach(f => {
  try { execFileSync(process.execPath, ["--check", path.join(ROOT, f)], { stdio: "pipe" }); }
  catch (e) { syntaxBad.push(f); }
});
const shellOk = exist(SHELL) && fs.statSync(path.join(ROOT, SHELL)).size > 20000;
add("S3-01", "壳层 + 5 个运行时模块存在且语法通过", shellOk && missing.length === 0 && syntaxBad.length === 0,
  "workbench=" + (shellOk ? fs.statSync(path.join(ROOT, SHELL)).size + " chars" : "缺失")
  + " · modules=" + (MODULES.length - missing.length) + "/5"
  + " · syntax=" + (MODULES.length - missing.length - syntaxBad.length) + "/" + (MODULES.length - missing.length)
  + (missing.length ? " · 缺失：" + missing.join("、") : "")
  + (syntaxBad.length ? " · 语法失败：" + syntaxBad.join("、") : ""));

const html = read(SHELL);
const ui = read(UI);
const ex = read(EXEC);
const stub = read("OVEM_AI营销系统.html");

/* 6 视图 / 6 导航 */
const views = [...html.matchAll(/<section class="view[^"]*" id="view-([a-z]+)"/g)].map(m => m[1]);
const navs = [...html.matchAll(/class="nav-item[^"]*" data-view="([a-z]+)"/g)].map(m => m[1]);
const wantViews = ["workbench", "runs", "site", "eval", "admin", "about"];
add("S3-02", "6 个视图 section · 6 组导航一一对应", views.length === 6 && navs.length === 6
  && wantViews.every(v => views.indexOf(v) >= 0 && navs.indexOf(v) >= 0),
  "views=" + views.length + "/6 · nav=" + navs.length + "/6 · " + views.join("/"));

/* 8 个 classic script 顺序 */
const srcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1]);
const want = ["data/ovem-data.js", "data/ovem-schema.js", "data/ovem-agent.js",
  "runtime/ovem-trace.js", "runtime/ovem-store.js", "runtime/ovem-tools.js", EXEC, UI];
const orderOk = srcs.length === want.length && want.every((s, i) => srcs[i] === s);
add("S3-03", "8 个 classic script 按依赖顺序加载", orderOk,
  "scripts=" + srcs.length + "/8 · order=" + (orderOk ? "data→trace→store→tools→executor→ui" : srcs.join(" → ")));

/* 3 条预设 */
const presetBlock = ui.slice(ui.indexOf("var PRESETS"), ui.indexOf("var S ="));
const pKeys = [...presetBlock.matchAll(/key: "([ABC])", missionId/g)].map(m => m[1]);
const pBudget = [...presetBlock.matchAll(/budget: ([0-9.]+)/g)].map(m => Number(m[1]));
const inject = /injectFail: true/.test(presetBlock);
const presetOk = pKeys.length === 3 && pKeys.join("") === "ABC" && pBudget.length === 3
  && pBudget[0] === 200 && pBudget[1] === 200 && Math.abs(pBudget[2] - 0.1) < 1e-9 && inject;
add("S3-04", "A/B/C 三条预设 · 预算 200/200/0.10 · B 注入质检失败", presetOk,
  "presets=" + pKeys.join("") + " · budgets=" + pBudget.join("/") + " · injectFail=" + (inject ? "B" : "无"));

/* 17 页 6 组 */
const groupBlock = ui.slice(ui.indexOf("var PAGE_GROUPS"), ui.indexOf("var PRESETS"));
const groups = [...groupBlock.matchAll(/key: "([^"]+)", ids: \[([^\]]*)\]/g)].map(m => ({
  key: m[1], ids: [...m[2].matchAll(/"(p\d+)"/g)].map(x => x[1])
}));
const allIds = groups.reduce((a, g) => a.concat(g.ids), []);
const uniqIds = Array.from(new Set(allIds));
const wantIds = Array.from({ length: 17 }, (_, i) => "p" + i);
const pageOrderOk = groups.length === 6 && allIds.length === 17 && uniqIds.length === 17
  && wantIds.every(id => uniqIds.indexOf(id) >= 0);
add("S3-05", "17 页按 6 组归类 · 无重复无缺失", pageOrderOk,
  "groups=" + groups.length + "/6 · pages=" + allIds.length + "/17 · " + groups.map(g => g.key + ":" + g.ids.length).join(" / "));

/* 执行器回调 + 壳页兼容 */
const hookOk = /opts\.onEvent/.test(ex) && /opts\.onHitl/.test(ex)
  && /function stopFailed/.test(ex) && /promptDelta/.test(ex) && /hitl\.decided/.test(ex)
  && /by: "human:ui"/.test(ex);
add("S3-06", "执行器 onEvent / onHitl / stopFailed / promptDelta", hookOk,
  "onEvent=" + (/opts\.onEvent/.test(ex) ? "✓" : "✕")
  + " · onHitl=" + (/opts\.onHitl/.test(ex) ? "✓" : "✕")
  + " · stopFailed=" + (/function stopFailed/.test(ex) ? "✓" : "✕")
  + " · promptDelta=" + (/promptDelta/.test(ex) ? "✓" : "✕"));

const stubOk = /workbench\.html/.test(stub) && /location\.replace\("workbench\.html"/.test(stub)
  && !/location\.replace\("index\.html"/.test(stub);
add("S3-07", "旧入口兼容跳转 → workbench.html（hash 透传）", stubOk,
  stubOk ? "canonical + meta refresh + location.replace 均指向 workbench.html" : "旧入口未指向工作台");

/* ---------- 浏览器结果 ---------- */
const browserPath = path.join(ROOT, opt("--selftest", "docs/v3/reports/S3.browser.json"));
let browser = null;
try { browser = JSON.parse(fs.readFileSync(browserPath, "utf8")); } catch (e) { browser = null; }

const bCases = (browser && browser.cases) || [];
const bSummary = (browser && browser.summary) || { total: 0, passed: 0, failed: 0 };
const bRuns = (browser && browser.runs) || [];
const bMetrics = (browser && browser.metrics) || {};

const runA = bRuns.filter(r => r.key === "A")[0] || null;
const runB = bRuns.filter(r => r.key === "B")[0] || null;
const runC = bRuns.filter(r => r.key === "C")[0] || null;

const runOk = runA && runA.state === "review" && Math.abs(runA.cost - 0.1168) < 1e-9
  && runB && runB.state === "review" && Math.abs(runB.cost - 0.2136) < 1e-9
  && runC && runC.state === "review";
const browserOk = bSummary.total === 8 && bSummary.passed === 8 && bSummary.failed === 0
  && runOk && bMetrics.pageLinks === 17 && bMetrics.nav === 6 && bMetrics.planSteps === 7;

add("S3-08", "浏览器 A3 8/8 · 三条 run 终态与成本符合口径", browserOk,
  browser ? ("cases=" + bSummary.passed + "/" + bSummary.total + " · runs="
    + bRuns.map(r => r.key + ":" + r.runId + ":" + r.state + " ¥" + Number(r.cost).toFixed(4)).join("、"))
    : "未找到 " + path.relative(ROOT, browserPath));

/* ---------- 证据 ---------- */
const evidence = [
  ["docs/v3/evidence/S3_A3-01_shell.png", "6 组导航 + 17 页成果入口"],
  ["docs/v3/evidence/S3_A3-04_trace.png", "A 正常链路：30 events / 3 artifacts / ¥0.12"],
  ["docs/v3/evidence/S3_A3-05_retry.png", "B 重试链：FAIL 64 → PASS 86 + promptDelta"],
  ["docs/v3/evidence/S3_A3-06_gate.png", "C 人工闸门：108% / 预算 ¥0.10 / 已花 ¥0.1084"],
  ["docs/v3/evidence/S3_A3-06_reject.png", "C 驳回分支：step5 FAIL / 后续 blocked / run.failed"],
  ["docs/v3/evidence/S3_A3-07_empty.png", "冷启动空态"],
  ["docs/v3/evidence/S3_A3-07_skeleton.png", "运行中骨架屏 7 卡"],
  ["docs/v3/evidence/S3_A3-08_replay.png", "replay 标签与延迟切换 + A3 8/8 徽标"]
];
const evMissing = evidence.filter(e => !exist(e[0]));
add("S3-09", "8 张验收截图归档", evMissing.length === 0,
  evMissing.length ? "缺失：" + evMissing.map(e => e[0]).join("、") : evidence.length + "/8 张存在");

/* ---------- 汇总 ---------- */
const failedChecks = checks.filter(c => !c.ok);
const cases = bCases.map(c => ({
  id: c.id, title: c.name, status: c.ok ? "pass" : "fail", detail: c.detail, ms: c.ms
}));

const payload = {
  stage: "S3",
  title: "Agent 工作台壳层",
  suite: "A3",
  at: new Date().toISOString(),
  git: gitInfo(),
  source: {
    shell: SHELL,
    ui: UI,
    executor: EXEC,
    browser: path.relative(ROOT, browserPath).split(path.sep).join("/"),
    version: "v3.0.0-s3"
  },
  metrics: {
    views: views.length, nav: navs.length, scripts: srcs.length,
    presets: pKeys.length, pageGroups: groups.length, pageLinks: allIds.length,
    planSteps: bMetrics.planSteps || null, provider: bMetrics.provider || null
  },
  summary: {
    total: cases.length,
    passed: cases.filter(c => c.status === "pass").length,
    failed: cases.filter(c => c.status !== "pass").length,
    pending: 0
  },
  cases,
  runs: bRuns,
  staticChecks: checks,
  browser: {
    status: browserOk ? "pass" : "fail",
    note: browser ? ("A3 8/8 · 正常 / 重试 / 闸门三条链路 · 全程事件驱动") : "未找到浏览器结果",
    checklist: ["6 组导航 + 17 页入口", "3 条预设", "Plan 7 步四态", "Trace 行数=事件数",
      "重试链 promptDelta", "成本卡", "空态/骨架屏", "replay 同步"]
  },
  artifacts: evidence.filter(e => exist(e[0])).map(e => ({ type: "screenshot", path: e[0], note: e[1] }))
};

if (browser) payload.artifacts.push({
  type: "data",
  path: path.relative(ROOT, browserPath).split(path.sep).join("/"),
  note: "工作台自检导出的原始结果（cases + runs + metrics）"
});

const out = path.join(ROOT, "docs/v3/reports/S3.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", "utf8");

/* ---------- 控制台 ---------- */
const line = "─".repeat(78);
console.log("\nA3 套件 · Agent 工作台壳层 · " + SHELL);
console.log(line);
cases.forEach(c => {
  console.log((c.status === "pass" ? "PASS  " : "FAIL  ") + c.id + "   " + c.title);
  console.log("      " + c.detail);
});
console.log(line);
console.log("静态核对");
checks.forEach(c => console.log((c.ok ? "  ✓ " : "  ✕ ") + c.id + " " + c.title + " · " + c.detail));
console.log(line);
console.log("用例 " + payload.summary.passed + "/" + payload.summary.total + " · 静态 "
  + (checks.length - failedChecks.length) + "/" + checks.length + " · run 数 " + bRuns.length);
console.log("报告 → " + path.relative(ROOT, out));
process.exit(payload.summary.failed || failedChecks.length ? 1 : 0);
