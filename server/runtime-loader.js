/* ============================================================
   OVEM B3 · 在 Node VM 中加载 A 的运行时
   ------------------------------------------------------------
   目的：不 fork Executor，服务端 Job 复用同一套
   7 步 / 9 调用 / 七态迁移 / 成本口径。
   每个 Job 新建 context，注入 SQLite Store 与 provider registry。
   ============================================================ */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const FILES = {
  data: ["data/ovem-data.js", "data/ovem-agent.js"],
  trace: ["runtime/ovem-trace.js", "runtime/ovem-tools.js"],
  executor: ["runtime/ovem-executor.js"]
};

const cache = {};
function read(rel) {
  if (!cache[rel]) cache[rel] = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return cache[rel];
}

function load(opt) {
  opt = opt || {};
  const sandbox = {
    window: { OVEM_RT: {} },
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    performance: performance,
    Date: Date,
    Math: Math,
    JSON: JSON,
    Promise: Promise,
    URL: URL,
    URLSearchParams: URLSearchParams,
    Buffer: Buffer,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  FILES.data.forEach(function (rel) { vm.runInContext(read(rel), sandbox, { filename: rel }); });
  FILES.trace.forEach(function (rel) { vm.runInContext(read(rel), sandbox, { filename: rel }); });

  const RT = sandbox.window.OVEM_RT;
  if (opt.store) RT.Store = opt.store;
  if (typeof opt.toolsFactory === "function") {
    const originalCreate = RT.Tools.create;
    RT.Tools.create = function (args) { return opt.toolsFactory(args, RT, originalCreate); };
  }

  FILES.executor.forEach(function (rel) { vm.runInContext(read(rel), sandbox, { filename: rel }); });

  return { window: sandbox.window, RT: RT, data: sandbox.window.OVEM_DATA, agent: sandbox.window.OVEM_AGENT };
}

module.exports = { load, FILES, ROOT };
