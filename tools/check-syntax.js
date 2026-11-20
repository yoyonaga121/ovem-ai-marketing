/* 语法自检：把 index.html 里的内联脚本抽出来过一遍 node --check */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const files = [
  "index.html",
  "workbench.html",
  "login.html",
  "OVEM配置后台.html",
  "OVEM_AI营销系统.html",
  "tools/selftest.html"
];

for (const f of files) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) { console.log("跳过（不存在）:", f); continue; }
  const html = fs.readFileSync(full, "utf8");
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, idx = 0, bad = 0;
  while ((m = re.exec(html))) {
    idx++;
    const code = m[1];
    if (!code.trim()) continue;
    const tmp = path.join(__dirname, "_check_" + idx + ".js");
    fs.writeFileSync(tmp, code, "utf8");
    try {
      execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
      console.log("✓ " + f + " 内联脚本 #" + idx + " 语法通过（" + code.split("\n").length + " 行）");
    } catch (e) {
      bad++;
      console.log("✗ " + f + " 内联脚本 #" + idx + " 语法错误：");
      console.log(String(e.stderr || e.message).split("\n").slice(0, 8).join("\n"));
    } finally {
      fs.unlinkSync(tmp);
    }
  }
  if (!idx) console.log("（" + f + " 没有内联脚本）");
}
