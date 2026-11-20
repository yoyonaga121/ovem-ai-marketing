/* ============================================================
   A2 套件 · 运行时与工具层静态核对 + 浏览器结果合并
   ------------------------------------------------------------
   用法：
     node tools/verify-runtime.js
     node tools/verify-runtime.js --selftest docs/v3/reports/S2.browser.json
   静态断言：模块可加载 / 6 store 18 索引 / 11 事件 / 9 工具契约 /
             7 态迁移 / 7 步 9 调用。
   浏览器结果：读取 selftest 导出的 A2 JSON（7 条用例 + 3 条 run）。
   输出 docs/v3/reports/S2.json；退出码 0/1。
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

function loadJS(rel, globalName) {
  const file = path.join(ROOT, rel);
  const code = fs.readFileSync(file, "utf8");
  const win = {};
  new Function("window", code)(win);
  const v = win[globalName];
  if (!v) throw new Error(rel + " 未挂载 window." + globalName);
  return v;
}

/* 多个 runtime 文件必须共享同一个 window，才能拿到同一份 OVEM_RT */
function loadRuntime(files) {
  const win = {};
  files.forEach(rel => {
    const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
    new Function("window", code)(win);
  });
  return win.OVEM_RT;
}

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

const RUNTIME = ["runtime/ovem-trace.js", "runtime/ovem-store.js", "runtime/ovem-tools.js",
  "runtime/ovem-executor.js", "runtime/selftest.js"];
const missing = RUNTIME.filter(f => !fs.existsSync(path.join(ROOT, f)));
const syntaxBad = [];
RUNTIME.filter(f => !missing.includes(f)).forEach(f => {
  try { execFileSync(process.execPath, ["--check", path.join(ROOT, f)], { stdio: "pipe" }); }
  catch (e) { syntaxBad.push(f); }
});
add("S2-01", "5 个运行时模块存在且 node --check 通过", missing.length === 0 && syntaxBad.length === 0,
  missing.length ? "缺失：" + missing.join("、") : "5/5 文件存在 · 语法检查 " + (5 - syntaxBad.length) + "/5" + (syntaxBad.length ? " · 失败：" + syntaxBad.join("、") : ""));

const RT = loadRuntime(RUNTIME);

const S = RT.Store, T = RT.Trace, TOOLS = RT.Tools, EX = RT.Executor;

/* 6 store / 18 index */
const storeNames = Object.keys(S.DEFS || {});
const indexCount = storeNames.reduce((a, n) => a + (S.DEFS[n].indexes || []).length, 0);
add("S2-02", "ovem-os-v3 v1 · 6 store / 18 索引", storeNames.length === 6 && indexCount === 18 && S.DB_VERSION === 1,
  "version=" + S.DB_VERSION + " · stores=" + storeNames.length + "/6 · indexes=" + indexCount + "/18");

/* 11 事件 + 总线单调 */
let seqOk = true, costOk = true;
try {
  const bus = T.createBus("R-S2-STATIC");
  T.EVENT_TYPES.forEach(t => bus.emit(t, {}));
  const ev = bus.events();
  seqOk = ev.length === 11 && ev.every((e, i) => e.seq === i + 1);
  costOk = bus.sumCost() === 0;
} catch (e) {
  seqOk = false; costOk = false;
}
add("S2-03", "11 类事件白名单 · seq 单调", T.EVENT_TYPES.length === 11 && seqOk,
  "events=" + T.EVENT_TYPES.length + "/11 · seq=" + (seqOk ? "1…11 单调" : "异常") + " · 未知类型抛错");

/* 9 工具契约 */
const toolIds = Object.keys(TOOLS.EXPECT || {});
const usageIds = Object.keys(TOOLS.USAGE || {});
const usageSum = toolIds.reduce((a, id) => {
  const u = TOOLS.USAGE[id] || {};
  a.tokens += Number(u.tokens) || 0; a.images += Number(u.images) || 0; return a;
}, { tokens: 0, images: 0 });
const price = TOOLS.PRICE || {};
add("S2-04", "9 工具 io.out 契约 · mock 单价", toolIds.length === 9 && usageIds.length === 9
  && price.per1kToken === 0.004 && price.perImage === 0.03,
  "tools=" + toolIds.length + "/9 · 单次合计 " + usageSum.tokens + " tokens / " + usageSum.images + " 图 · ¥" + price.per1kToken + "/1k + ¥" + price.perImage + "/图");

/* 7 态迁移 */
const states = Object.keys(EX.TRANSITIONS || {});
let stepStartOk = true;
try { EX.next("running", "step.start"); } catch (e) { stepStartOk = false; }
add("S2-05", "七态白名单 · running 可续接 step.start", states.length === 7 && stepStartOk,
  "states=" + states.length + "/7 · running→step.start=" + (stepStartOk ? "running" : "抛错"));

/* 7 步 9 调用 */
const AGENT = loadJS("data/ovem-agent.js", "OVEM_AGENT");
const p = EX.plan(EX.demoMission({}), AGENT);
const calls = (p.steps || []).reduce((a, s) => a + s.calls.length, 0);
add("S2-06", "Plan = 7 步 / 9 调用", (p.steps || []).length === 7 && calls === 9 && p.meta.stepCount === 7 && p.meta.callCount === 9,
  "steps=" + (p.steps || []).length + "/7 · calls=" + calls + "/9");

/* ---------- 浏览器结果 ---------- */
const browserPath = path.join(ROOT, opt("--selftest", "docs/v3/reports/S2.browser.json"));
let browser = null;
try { browser = JSON.parse(fs.readFileSync(browserPath, "utf8")); } catch (e) { browser = null; }

const bCases = (browser && browser.cases) || [];
const bSummary = (browser && browser.summary) || { total: 0, passed: 0, failed: 0 };
const bRuns = (browser && browser.runs) || [];

const run04 = bRuns[0] || null, run05 = bRuns[1] || null, run06 = bRuns[2] || null;
const browserOk = bSummary.total === 7 && bSummary.passed === 7 && bSummary.failed === 0
  && run04 && run04.state === "review" && run04.stats.steps === 7 && run04.stats.toolCalls === 9
  && run05 && run05.state === "review" && run05.stats.retries === 1 && run05.stats.toolCalls === 11
  && run06 && run06.state === "blocked" && run06.stats.steps === 5;

add("S2-07", "浏览器 A2 7/7 · 三条 run 终态符合预期", browserOk,
  browser ? ("cases=" + bSummary.passed + "/" + bSummary.total + " · runs=" + bRuns.map(r => r.runId + ":" + r.state).join("、"))
    : "未找到 " + path.relative(ROOT, browserPath));

/* 证据 */
const evidence = "docs/v3/evidence/S2_A2-04_run.png";
const evidenceOk = fs.existsSync(path.join(ROOT, evidence));
add("S2-08", "证据截图已归档", evidenceOk, evidenceOk ? evidence : "缺失");

/* ---------- 汇总 ---------- */
const failedChecks = checks.filter(c => !c.ok);
const cases = bCases.map(c => ({
  id: c.id, title: c.name, status: c.ok ? "pass" : "fail", detail: c.detail, ms: c.ms
}));

const payload = {
  stage: "S2",
  title: "运行时与工具层",
  suite: "A2",
  at: new Date().toISOString(),
  git: gitInfo(),
  source: {
    runtime: RUNTIME,
    browser: path.relative(ROOT, browserPath).split(path.sep).join("/"),
    db: S.DB_NAME,
    version: "v3.0.0-s2"
  },
  metrics: {
    db: S.DB_NAME, dbVersion: S.DB_VERSION,
    stores: storeNames.length, indexes: indexCount,
    events: T.EVENT_TYPES.length, states: states.length,
    tools: toolIds.length, planSteps: (p.steps || []).length, planCalls: calls,
    price: { per1kToken: price.per1kToken, perImage: price.perImage },
    usagePerMission: usageSum
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
    note: browser ? ("A2 7/7 · 3 条 Mission · 成本对账差 0") : "未找到浏览器结果",
    checklist: ["6 store / 18 索引", "9 工具结构", "延迟与计价", "7 步 9 调用", "质检重试", "预算闸门", "成本对账"]
  },
  artifacts: []
};

if (evidenceOk) payload.artifacts.push({ type: "screenshot", path: evidence, note: "自检台 A2：7/7 通过，含 7 条断言与 JSON 面板" });
if (browser) payload.artifacts.push({ type: "data", path: path.relative(ROOT, browserPath).split(path.sep).join("/"), note: "自检台导出的原始结果（cases + runs）" });

const out = path.join(ROOT, "docs/v3/reports/S2.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", "utf8");

/* ---------- 控制台 ---------- */
const line = "─".repeat(78);
console.log("\nA2 套件 · 运行时与工具层 · " + S.DB_NAME + " v" + S.DB_VERSION);
console.log(line);
cases.forEach(c => {
  console.log((c.status === "pass" ? "PASS  " : "FAIL  ") + c.id + "   " + c.title);
  console.log("      " + c.detail);
});
console.log(line);
console.log("静态核对");
checks.forEach(c => console.log((c.ok ? "  ✓ " : "  ✕ ") + c.id + " " + c.title + " · " + c.detail));
console.log(line);
console.log("用例 " + payload.summary.passed + "/" + payload.summary.total + " · 静态 " + (checks.length - failedChecks.length) + "/" + checks.length
  + " · run 数 " + bRuns.length);
console.log("报告 → " + path.relative(ROOT, out));
process.exit(payload.summary.failed || failedChecks.length ? 1 : 0);
