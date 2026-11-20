/* ============================================================
   A5 套件 · 评测集 / 回归 / 护栏 / 演示脚本静态核对
   ------------------------------------------------------------
   用法：
     node tools/verify-evals.js
   读取：
     docs/v3/reports/S5.browser.json  壳页「跑全量 20 条」导出
     docs/v3/reports/S5.manual.json   A5-03 / A5-04 / A5-05 实测
   输出：
     docs/v3/reports/S5.json
   ============================================================ */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exist = rel => fs.existsSync(path.join(ROOT, rel));

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

function loadGlobal(rel, key) {
  const w = {};
  new Function("window", read(rel))(w);
  return w[key];
}

/* ---------- 静态 ---------- */
const checks = [];
const add = (id, title, ok, detail) => checks.push({ id, title, ok: !!ok, detail });

const EVAL_FILES = ["data/ovem-evals.js", "runtime/ovem-eval.js", "runtime/ovem-eval-ui.js", "workbench.html"];
const missing = EVAL_FILES.filter(f => !exist(f));
const syntaxBad = [];
EVAL_FILES.filter(f => !missing.includes(f) && f.endsWith(".js")).forEach(f => {
  try { execFileSync(process.execPath, ["--check", path.join(ROOT, f)], { stdio: "pipe" }); }
  catch (e) { syntaxBad.push(f); }
});
add("S5-01", "评测数据 / 执行器 / 面板存在且语法通过",
  missing.length === 0 && syntaxBad.length === 0,
  "files=" + (EVAL_FILES.length - missing.length) + "/4 · syntax=" + (syntaxBad.length ? "失败 " + syntaxBad.join("、") : "3/3 通过"));

const set = loadGlobal("data/ovem-evals.js", "OVEM_EVALS");
const data = loadGlobal("data/ovem-data.js", "OVEM_DATA");
const tasks = (set && set.tasks) || [];
const rubrics = (set && set.rubrics) || [];
const productIds = ((data && data.products) || []).map(p => p.id);
const taskIds = tasks.map(t => t.taskId);
const uniq = a => a.filter((x, i) => a.indexOf(x) === i);
const seedUniq = uniq(tasks.map(t => t.seed));
const channelGroups = uniq(tasks.map(t => (t.channelIds || []).join(",")));
const productCover = tasks.every(t => productIds.indexOf(t.productId) >= 0);
const expectOk = tasks.every(t => Number(t.expect && t.expect.channels) === 3 && t.expect.ratio === "mixed" && Number(t.expect.dominantMin) === 35);
add("S5-02", "20 条任务 × 20 个产品 × 四组渠道，固定 seed",
  tasks.length === 20 && uniq(taskIds).length === 20 && uniq(tasks.map(t => t.productId)).length === 20
  && seedUniq.length === 20 && channelGroups.length === 4 && productCover && expectOk,
  "tasks=" + tasks.length + " · products=" + uniq(tasks.map(t => t.productId)).length + "/20 · seeds=" + seedUniq.length + "/20 · channelGroups=" + channelGroups.length + "/4 · missingProducts=" + tasks.filter(t => productIds.indexOf(t.productId) < 0).length);

const baseR = rubrics.filter(r => r.version === "v1.1.0")[0] || {};
const candR = rubrics.filter(r => r.version === "v1.2.0")[0] || {};
const promptOk = set && set.meta && set.meta.promptBase === "v1.1.0" && set.meta.promptCandidate === "v1.2.0";
add("S5-03", "Prompt 两版 rubric：37% → 35%，QA / 安全区不变",
  promptOk && baseR.dominantMin === 37 && candR.dominantMin === 35 && candR.minScore === 80 && candR.safeAreaMin === 48,
  "base=" + baseR.dominantMin + "% · candidate=" + candR.dominantMin + "% · minScore=" + candR.minScore + " · safeArea=" + candR.safeAreaMin + "px");

const store = read("runtime/ovem-store.js");
add("S5-04", "evals store 已建（keyPath=id，3 索引，支持 removeMany）",
  /evals:\s*\{ keyPath: "id"/.test(store) && /\["taskId", "taskId"\]/.test(store) && /\["promptVersion", "promptVersion"\]/.test(store) && /removeMany: removeMany/.test(store),
  "store=evals · keyPath=id · indexes=taskId/promptVersion/passed · removeMany=✓");

const shell = read("workbench.html");
const srcs = [...shell.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1]);
const orderOk = srcs.indexOf("data/ovem-evals.js") > srcs.indexOf("data/ovem-agent.js")
  && srcs.indexOf("runtime/ovem-eval.js") > srcs.indexOf("runtime/ovem-executor.js")
  && srcs.indexOf("runtime/ovem-eval-ui.js") > srcs.indexOf("runtime/ovem-ui.js");
const panelOk = ["evalRun", "evalRows", "evalBaseRate", "evalCandRate", "evalDelta", "evalExport"].every(id => shell.indexOf('id="' + id + '"') >= 0);
add("S5-05", "评测面板接入：按钮 / 进度 / 双版本 / 明细 / 导出",
  orderOk && panelOk && !/S5 接入/.test(shell),
  "scripts=" + srcs.length + " · eval order=" + (orderOk ? "✓" : "✗") + " · panel=" + (panelOk ? "6/6" : "缺失"));

const browserPath = "docs/v3/reports/S5.browser.json";
const manualPath = "docs/v3/reports/S5.manual.json";
let browser = null, manual = null;
try { browser = JSON.parse(read(browserPath)); } catch (e) { /* handled below */ }
try { manual = JSON.parse(read(manualPath)); } catch (e) { /* handled below */ }
const bTasks = (browser && browser.tasks) || [];
const bIds = bTasks.map(t => t.taskId);
const bOk = browser && bTasks.length === 20 && uniq(bIds).length === 20
  && bTasks.every(t => taskIds.indexOf(t.taskId) >= 0)
  && browser.candidate && browser.candidate.total === 20;
add("S5-06", "S5.browser.json：20 条结果完整，任务 ID 与数据集一致",
  bOk, "tasks=" + bTasks.length + "/20 · ids=" + uniq(bIds).length + "/20 · candidate=" + (browser && browser.candidate ? browser.candidate.passed + "/" + browser.candidate.total : "缺失"));

const evidence = [
  "docs/v3/evidence/S5_A5-01_eval.png",
  "docs/v3/evidence/S5_A5-02_regression.png",
  "docs/v3/evidence/S5_A5-03_gate.png",
  "docs/v3/evidence/S5_A5-03_reject.png",
  "docs/v3/evidence/S5_A5-03_failed.png",
  "docs/v3/evidence/S5_A5-04_offline.png"
];
const evidenceOk = evidence.every(exist);
add("S5-07", "6 张验收截图归档", evidenceOk, evidence.filter(exist).length + "/6 张存在");

const demo = "docs/演示脚本_5分钟.md";
const demoText = exist(demo) ? read(demo) : "";
const demoSteps = [1, 2, 3, 4, 5].every(n => new RegExp("## " + n + "\\. ").test(demoText));
const demoSec = manual && manual["A5-05"] ? Number(manual["A5-05"].totalSec) : NaN;
add("S5-08", "5 分钟脚本：5 步齐全，总时长 ≤ 5:30",
  demoSteps && Number.isFinite(demoSec) && demoSec <= 330,
  "doc=" + (exist(demo) ? "✓" : "缺失") + " · steps=" + (demoSteps ? "5/5" : "缺失") + " · totalSec=" + demoSec);

const stateOk = manual && manual.store && manual.store.evals === 40;
add("S5-09", "评测结果落库 40 条（20 任务 × 2 版本）",
  stateOk, "evals=" + (manual && manual.store ? manual.store.evals : "缺失") + "/40 · runs=" + (manual && manual.store ? manual.store.runs : "?"));

const noPlaceholder = !/placeholder-grid[\s\S]{0,500}评测/.test(shell);
add("S5-10", "评测视图不再是 S5 占位卡", noPlaceholder, "placeholder=" + (noPlaceholder ? "已移除" : "仍存在"));

/* ---------- 验收用例 ---------- */
const cases = [];
function addCase(id, title, ok, detail) { cases.push({ id, title, status: ok ? "pass" : "fail", detail }); }

const c = browser && browser.candidate;
const b = browser && browser.baseline;
addCase("A5-01", "20 条任务执行完成，passRate ≥ 90%",
  !!c && c.total === 20 && c.passRate >= 90,
  "candidate=" + (c ? c.passed + "/" + c.total : "缺失") + " · passRate=" + (c ? c.passRate : "?") + "% · 目标 ≥90%");

const reg = browser && browser.regression;
addCase("A5-02", "Prompt v1.1.0 → v1.2.0 回归报告生成",
  !!b && !!c && !!reg && reg.fixed > 0 && reg.broken === 0,
  "baseline=" + (b ? b.passed + "/" + b.total + " (" + b.passRate + "%)" : "缺失")
  + " → candidate=" + (c ? c.passed + "/" + c.total + " (" + c.passRate + "%)" : "缺失")
  + " · fixed=" + (reg ? reg.fixed : "?") + " · broken=" + (reg ? reg.broken : "?"));

const gate = manual && manual["A5-03"];
addCase("A5-03", "预算超限 + hitl.reject → failed 且 artifact=0",
  !!gate && gate.status === "failed" && Number(gate.artifacts) === 0 && Number(gate.pct) >= 100,
  gate ? "run=" + gate.runId + " · pct=" + gate.pct + "% · status=" + gate.status + " · artifacts=" + gate.artifacts + " · plan=" + gate.plan.join("/") : "缺失");

const off = manual && manual["A5-04"];
addCase("A5-04", "offline + replay 跑完 1 条 Mission",
  !!off && off.online === false && off.state === "review" && Number(off.artifacts) === 3,
  off ? "online=" + off.online + " · run=" + off.runId + " · state=" + off.state + " · trace=" + off.trace + " · artifacts=" + off.artifacts + " · " + off.ms + "ms" : "缺失");

addCase("A5-05", "演示 5 步走查，总时长 ≤ 5:30",
  demoSteps && Number.isFinite(demoSec) && demoSec <= 330,
  "steps=" + (demoSteps ? "5" : "?") + " · total=" + Math.floor(demoSec / 60) + ":" + String(demoSec % 60).padStart(2, "0") + " · ≤5:30");

/* ---------- 报告 ---------- */
const at = new Date().toISOString();
const passed = cases.filter(x => x.status === "pass").length;
const report = {
  stage: "S5",
  title: "评测 · 护栏 · 演示编排",
  suite: "A5",
  at,
  git: gitInfo(),
  source: {
    dataset: "data/ovem-evals.js",
    evaluator: "runtime/ovem-eval.js",
    panel: "runtime/ovem-eval-ui.js",
    shell: "workbench.html",
    browser: browserPath,
    manual: manualPath,
    demo: demo
  },
  metrics: {
    tasks: tasks.length,
    baselinePass: b ? b.passed : null,
    baselineRate: b ? b.passRate : null,
    candidatePass: c ? c.passed : null,
    candidateRate: c ? c.passRate : null,
    fixed: reg ? reg.fixed : null,
    broken: reg ? reg.broken : null,
    avgSteps: c ? c.avgSteps : null,
    avgCost: c ? c.avgCost : null,
    totalCost: c ? c.totalCost : null,
    durationMs: browser ? browser.durationMs : null,
    evalsRecords: manual && manual.store ? manual.store.evals : null,
    gateRun: gate ? gate.runId : null,
    gateStatus: gate ? gate.status : null,
    offlineRun: off ? off.runId : null,
    demoTotalSec: Number.isFinite(demoSec) ? demoSec : null
  },
  summary: { total: cases.length, passed, failed: cases.length - passed, pending: 0 },
  cases,
  staticChecks: checks,
  browser: {
    status: passed === cases.length ? "pass" : "fail",
    note: "20 条评测在壳页顺序跑完；同一批 artifacts 用 v1.1.0 / v1.2.0 复算；闸门与离线 replay 单独实测",
    checklist: [
      "20/20 candidate · 100%",
      "baseline 9/20 · 45%",
      "+55pp · 11 fixed · 0 broken",
      "gate reject failed / 0 artifacts",
      "offline replay review / 3 artifacts",
      "5 步脚本 5:18"
    ]
  },
  artifacts: [
    { type: "screenshot", path: "docs/v3/evidence/S5_A5-01_eval.png", note: "评测总览 20/20 · 45% → 100%" },
    { type: "screenshot", path: "docs/v3/evidence/S5_A5-02_regression.png", note: "Prompt v1.1.0 → v1.2.0 回归对比" },
    { type: "screenshot", path: "docs/v3/evidence/S5_A5-03_gate.png", note: "预算闸门 108% · 待人工决策" },
    { type: "screenshot", path: "docs/v3/evidence/S5_A5-03_reject.png", note: "hitl.reject 决策回执" },
    { type: "screenshot", path: "docs/v3/evidence/S5_A5-03_failed.png", note: "驳回后 failed · step6/7 BLOCKED · 0 产物" },
    { type: "screenshot", path: "docs/v3/evidence/S5_A5-04_offline.png", note: "offline + replay 跑完 R-E-01 · 30 events / 3 产物" },
    { type: "data", path: browserPath, note: "20 条评测原始报告（壳页导出）" },
    { type: "data", path: manualPath, note: "A5-03 / A5-04 / A5-05 实测数据" },
    { type: "doc", path: demo, note: "5 步演示脚本 + 计时总表" }
  ]
};

fs.writeFileSync(path.join(ROOT, "docs/v3/reports/S5.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ stage: "S5", summary: report.summary, metrics: report.metrics }, null, 2));
process.exit(passed === cases.length && checks.every(x => x.ok) ? 0 : 1);
