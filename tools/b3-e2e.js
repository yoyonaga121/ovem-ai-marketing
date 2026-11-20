/* ============================================================
   OVEM B5 · 浏览器前置 smoke（只读，不创建 Job / 不发布）
   ------------------------------------------------------------
   运行：node tools/b3-e2e.js
   环境：OVEM_BASE 默认 http://127.0.0.1:4318
   ============================================================ */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.OVEM_BASE || "http://127.0.0.1:4318";
const ROOT = path.resolve(__dirname, "..");
const cases = [];

function add(id, title, ok, detail) {
  cases.push({ id, title, status: ok ? "pass" : "fail", detail: detail || "" });
  console.log((ok ? "PASS " : "FAIL ") + id + " · " + title + " · " + (detail || ""));
}

async function main() {
  let cookie = "";
  let csrf = "";
  async function req(p, opt) {
    opt = opt || {};
    const headers = Object.assign({}, opt.headers || {});
    if (opt.body) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    if (csrf && (opt.method || "GET") !== "GET") headers["x-ovem-csrf"] = csrf;
    const res = await fetch(BASE + p, { method: opt.method || "GET", headers, body: opt.body ? JSON.stringify(opt.body) : undefined, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (e) {}
    if (!res.ok) {
      const e = new Error((data && data.message) || ("HTTP " + res.status));
      e.status = res.status; e.data = data; throw e;
    }
    if (data && data.csrf) csrf = data.csrf;
    return { status: res.status, data: data, text: text };
  }

  const health = await req("/api/health");
  add("E2E-01", "health 服务在线 · live 标记", health.status === 200 && health.data.ok && health.data.live === true, JSON.stringify(health.data).slice(0, 120));

  const loginPage = await req("/login.html");
  add("E2E-02", "登录页 200", loginPage.status === 200, "bytes=" + loginPage.text.length);

  const login = await req("/api/auth/login", { method: "POST", body: { email: "owner@ovem.local", password: "ovem-demo-2026" } });
  add("E2E-03", "owner 登录 + CSRF", login.status === 200 && login.data.tenant.id === "t-ovem" && !!login.data.csrf, login.data.tenant.id);

  const workbench = await req("/workbench.html");
  const schema = await req("/data/ovem-schema.js");
  const pageCount = (schema.text.match(/\{ id: "p\d+"/g) || []).length;
  const groupSet = {}; (schema.text.match(/group: "([^"]+)"/g) || []).forEach(function (m) { groupSet[m] = true; });
  add("E2E-04", "schema 17 页 / 6 组，工作台有 tab 容器", workbench.status === 200 && pageCount === 17 && Object.keys(groupSet).length === 6 && /id="pageTabs"/.test(workbench.text), pageCount + "/" + Object.keys(groupSet).length);
  add("E2E-05", "B3 live / B4 发布脚本已加载", /ovem-publish\.js/.test(workbench.text) && /ovem-ui\.js/.test(workbench.text), "ok");

  const me = await req("/api/auth/me");
  add("E2E-06", "会话回读 owner / t-ovem", me.status === 200 && me.data.role === "owner" && me.data.tenant.id === "t-ovem", me.data.role);

  const runs = await req("/api/runs");
  add("E2E-07", "runs 列表可读", runs.status === 200 && Array.isArray(runs.data.runs), "runs=" + runs.data.runs.length);

  const pubs = await req("/api/publications");
  add("E2E-08", "publications 可读", pubs.status === 200 && Array.isArray(pubs.data.publications), "publications=" + pubs.data.publications.length);

  const approved = pubs.data.publications.filter(function (p) { return p.status === "approved" && p.path; })[0];
  if (approved) {
    const pkg = await req(approved.path);
    add("E2E-09", "B4 已批准版本包 HTTP 200", pkg.status === 200, approved.path + " · bytes=" + pkg.text.length);
  } else {
    add("E2E-09", "B4 暂无已批准版本包（可选）", true, "no approved publication yet");
  }

  let unauth = null;
  try { await req("/api/jobs"); } catch (e) { unauth = e; }
  // 上一请求带 cookie，改用无 cookie 的裸 fetch 验证 401
  const raw = await fetch(BASE + "/api/jobs", { headers: {} });
  add("E2E-10", "未登录 /api/jobs 401", raw.status === 401, "status=" + raw.status);

  const summary = { total: cases.length, passed: cases.filter(c => c.status === "pass").length, failed: cases.filter(c => c.status === "fail").length };
  fs.writeFileSync(path.join(ROOT, "docs/v3/reports/B3-e2e.json"), JSON.stringify({
    stage: "B3", at: new Date().toISOString(), base: BASE,
    summary: summary, cases: cases,
    note: "只读 smoke；交互式浏览器验收见 B3_workbench.png / B4_publish.png 与 B3 report。"
  }, null, 2));
  console.log("\n" + summary.passed + "/" + summary.total + " passed");
  if (summary.failed) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
