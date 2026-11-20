/* ============================================================
   A1 套件 · Agent 配置层静态核对
   ------------------------------------------------------------
   用法：
     node tools/verify-agent-config.js
     node tools/verify-agent-config.js --browser pass --browser-note "3/9/4 行 · 校验通过"
   断言 A1-01 … A1-06，并把 7 条跨字段规则（R1–R7）打成矩阵。
   输出 docs/v3/reports/S1.json；退出码 0/1。
   ============================================================ */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

const A = loadJS("data/ovem-agent.js", "OVEM_AGENT");
const S = loadJS("data/ovem-agent.schema.js", "OVEM_AGENT_SCHEMA");
const DATA_SCHEMA = loadJS("data/ovem-schema.js", "OVEM_SCHEMA");
const PAGES = DATA_SCHEMA.pages || [];

const cases = [];
const add = (id, title, ok, detail) => cases.push({ id, title, status: ok ? "pass" : "fail", detail });

/* A1-01 工具 9 条且 id 唯一 */
{
  const tools = A.tools || [];
  const ids = tools.map(t => t.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  add("A1-01", "tools = 9 且 id 唯一", tools.length === 9 && dup.length === 0,
    "tools=" + tools.length + " · 重复=" + (dup.length ? dup.join("、") : "0"));
}

/* A1-02 Agent 3 条，工具引用为 tools 子集 */
{
  const ids = new Set((A.tools || []).map(t => t.id));
  const missing = [];
  (A.agents || []).forEach(a => (a.tools || []).forEach(t => { if (!ids.has(t)) missing.push(a.id + "→" + t); }));
  add("A1-02", "agents = 3，agents[].tools ⊆ tools.id", (A.agents || []).length === 3 && missing.length === 0,
    "agents=" + (A.agents || []).length + " · 差集=" + (missing.length ? missing.join("；") : "空"));
}

/* A1-03 promptRef 命中 + hash 非空且可复算 */
{
  const miss = [], hashBad = [];
  (A.agents || []).forEach(a => {
    const r = a.promptRef || {};
    const p = (A.prompts || []).find(x => x.id === r.id && x.version === r.version);
    if (!p) miss.push(a.id + "→" + r.id + "@" + r.version);
  });
  (A.prompts || []).forEach(p => {
    if (!/^sha256:[0-9a-f]{64}$/.test(p.hash || "")) {
      hashBad.push(p.id + " 格式不符");
      return;
    }
    const real = "sha256:" + crypto.createHash("sha256").update(String(p.body || ""), "utf8").digest("hex");
    if (real !== p.hash) hashBad.push(p.id + " 哈希与正文不一致");
  });
  add("A1-03", "promptRef 命中 + hash 非空（复算一致）", miss.length === 0 && hashBad.length === 0,
    "命中 " + (A.agents || []).length + "/" + (A.agents || []).length + " · hash 复算 " + ((A.prompts || []).length - hashBad.length) + "/" + (A.prompts || []).length
    + (miss.length ? " · 未命中：" + miss.join("；") : "") + (hashBad.length ? " · " + hashBad.join("；") : ""));
}

/* A1-04 步数/预算不越护栏 */
{
  const g = A.guardrails || {};
  const rows = (A.agents || []).map(a => {
    const l = a.limits || {};
    return a.id + " steps=" + l.maxSteps + "/" + g.maxSteps + " budget=¥" + l.budgetCny + "/¥" + g.dailyBudgetCny;
  });
  const over = (A.agents || []).filter(a => {
    const l = a.limits || {};
    return Number(l.maxSteps) > Number(g.maxSteps) || Number(l.budgetCny) > Number(g.dailyBudgetCny);
  });
  add("A1-04", "maxSteps ≤ 12 且 budgetCny ≤ dailyBudgetCny", over.length === 0, rows.join(" · "));
}

/* A1-05 护栏 6 项齐全且类型正确 */
{
  const want = [
    ["dailyBudgetCny", "number"], ["maxConcurrency", "number"], ["maxSteps", "number"],
    ["maxRetryPerStep", "number"], ["requireHumanOnPublish", "boolean"], ["bannedTools", "array"]
  ];
  const g = A.guardrails || {};
  const bad = want.filter(([k, t]) => {
    const v = g[k];
    if (t === "array") return !Array.isArray(v);
    if (t === "boolean") return typeof v !== "boolean";
    return typeof v !== "number" || !isFinite(v);
  });
  const extra = Object.keys(g).filter(k => !want.some(([w]) => w === k));
  add("A1-05", "guardrails 6 项齐全且类型正确", bad.length === 0 && extra.length === 0,
    "字段 " + Object.keys(g).length + "/6 · 类型错=" + (bad.length ? bad.map(x => x[0]).join("、") : "0") + " · 多余=" + (extra.length ? extra.join("、") : "0"));
}

/* A1-06 lineage 覆盖 17/17 页 */
{
  const ids = PAGES.map(p => p.id);
  const keys = Object.keys(A.lineage || {});
  const missing = ids.filter(id => keys.indexOf(id) < 0);
  const extra = keys.filter(k => ids.indexOf(k) < 0);
  add("A1-06", "lineage 覆盖 17/17 页", missing.length === 0 && extra.length === 0,
    "覆盖 " + (ids.length - missing.length) + "/" + ids.length + " · 缺失=" + (missing.length ? missing.join("、") : "空集") + " · 多余=" + (extra.length ? extra.join("、") : "0"));
}

/* R1–R7 规则矩阵（与 A1 分列，避免重复计数） */
const rules = (S.rules || []).map(r => {
  let res;
  try { res = r.check(A, PAGES); } catch (e) { res = { ok: false, detail: "执行异常：" + (e.message || e) }; }
  return { id: r.id, code: r.code, ok: !!res.ok, detail: res.detail || "", msg: r.msg };
});

/* 汇总 */
const passed = cases.filter(c => c.status === "pass").length;
const failed = cases.length - passed;

const payload = {
  stage: "S1",
  title: "Agent 配置层",
  suite: "A1",
  at: new Date().toISOString(),
  git: gitInfo(),
  source: { config: "data/ovem-agent.js", schema: "data/ovem-agent.schema.js", version: (A.meta && A.meta.version) || "" },
  metrics: {
    agents: (A.agents || []).length, tools: (A.tools || []).length, prompts: (A.prompts || []).length,
    guardrails: Object.keys(A.guardrails || {}).length, lineage: Object.keys(A.lineage || {}).length,
    providers: (A.providers || []).length
  },
  summary: { total: cases.length, passed, failed, pending: 0 },
  cases,
  rules,
  browser: {
    id: "A1-07",
    status: opt("--browser", "pending"),
    note: opt("--browser-note", ""),
    checklist: ["Agent 3 行", "工具 9 行", "Prompt 4 行", "徽标「校验通过」"]
  },
  artifacts: []
};

const out = path.join(ROOT, "docs/v3/reports/S1.json");
const evidence = "docs/v3/evidence/S1_A1-07_agent.png";
if (payload.browser.status === "pass" && fs.existsSync(path.join(ROOT, evidence))) {
  payload.artifacts.push({ type: "screenshot", path: evidence, note: "后台第 12 分区：3 Agent / 9 工具 / 4 Prompt / 徽标校验通过" });
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", "utf8");

/* 控制台输出 */
const line = "─".repeat(78);
console.log("\nA1 套件 · Agent 配置层 · " + (A.meta && A.meta.version));
console.log(line);
cases.forEach(c => {
  console.log((c.status === "pass" ? "PASS  " : "FAIL  ") + c.id + "   " + c.title);
  console.log("      " + c.detail);
});
console.log(line);
console.log("规则矩阵（R1–R7）");
rules.forEach(r => console.log((r.ok ? "  ✓ " : "  ✕ ") + r.id + " " + r.code + " · " + r.detail));
console.log(line);
console.log("通过 " + passed + " / 失败 " + failed + " / 待执行 0  ·  浏览器项 A1-07=" + payload.browser.status);
console.log("报告 → " + path.relative(ROOT, out));
process.exit(failed ? 1 : 0);
