/* ============================================================
   v2.0 前台重构：按标记替换 index.html 中的数据结构与应用层
   一次性脚本；执行完可保留，作为「改了什么」的证据。
   用法：node tools/refactor-v2.js
   ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "index.html");
const P = f => fs.readFileSync(path.join(__dirname, "patches", f), "utf8").trimEnd();

let html = fs.readFileSync(FILE, "utf8");
const log = [];

function once(find, repl, label) {
  const i = html.indexOf(find);
  if (i < 0) throw new Error("标记未找到: " + label);
  if (html.indexOf(find, i + 1) >= 0) throw new Error("标记不唯一: " + label);
  html = html.slice(0, i) + repl + html.slice(i + find.length);
  log.push("✓ " + label);
}

function span(startMark, endMark, repl, label) {
  const i = html.indexOf(startMark);
  if (i < 0) throw new Error("起点未找到: " + label);
  const j = html.indexOf(endMark, i);
  if (j < 0) throw new Error("终点未找到: " + label);
  html = html.slice(0, i) + repl + html.slice(j + endMark.length);
  log.push("✓ " + label);
}

/* 1 · 数据脚本入口 */
once(
  '<!-- V2 配置层：文件配置（由 OVEM配置后台.html 导出，缺失时不影响页面） -->\n<script src="ovem-config.js"></script>',
  '<!-- 数据层 v2.0：唯一业务数据源，由 OVEM配置后台.html 发布后覆盖 -->\n<script src="data/ovem-data.js"></script>',
  "数据脚本入口 → data/ovem-data.js"
);

/* 2 · 内联数据块（PRODUCTS / HOOKS / SCENE_POOL / CHANNEL_TPL）→ 派生 */
span(
  "/* ============================================================\n   数据层：20 款产品的结构化模型",
  'const CHANNEL_TPL = {"官网":5,"移动端":2,"私域":3,"电商":2,"直播":4,"社媒":1,"投放":0,"线下":5};',
  P("data-layer.js"),
  "内联产品/钩子/场景/模板 → 数据层派生"
);

/* 3 · 内联渠道数据 → 单一数据源 */
span(
  "const CHANNEL_DATA = [",
  "\n];",
  "/* 渠道数据 v2.0：来自 data/ovem-data.js 的 channels 字段，已在上方数据层派生，此处不再重复定义 */",
  "内联渠道数据 → 单一数据源"
);

/* 4 · 顶栏两个 chip 加 id */
once('<span class="chip chip-muted">样张 v0.2</span>',
     '<span class="chip chip-muted" id="chipVersion">样张 v0.2</span>', "顶栏版本 chip");
once('<span class="chip">20 SKU · 8 渠道</span>',
     '<span class="chip" id="chipCount">20 SKU · 8 渠道</span>', "顶栏计数 chip");

/* 5 · 侧栏页脚加 id */
once('<div class="side-foot">2026.11 · 作品样张<br>P0–P16 · 全 17 页</div>',
     '<div class="side-foot" id="sideFoot">2026.11 · 作品样张<br>P0–P16 · 全 17 页</div>', "侧栏页脚");

/* 6 · P1 四张 KPI 卡加 id，改由 goals 驱动 */
once(
  '<div class="kpi"><div class="kpi-num tnum">1,200<span>万</span></div><div class="kpi-label">年度曝光目标</div></div>\n'
+ '          <div class="kpi"><div class="kpi-num tnum">96<span>万</span></div><div class="kpi-label">内容互动</div></div>\n'
+ '          <div class="kpi"><div class="kpi-num tnum">2.7<span>万</span></div><div class="kpi-label">首购单量</div></div>\n'
+ '          <div class="kpi"><div class="kpi-num tnum">¥186</div><div class="kpi-label">获客成本</div></div>',
  '<div class="kpi"><div class="kpi-num tnum" id="kpiExposure">1,200<span>万</span></div><div class="kpi-label">年度曝光目标</div></div>\n'
+ '          <div class="kpi"><div class="kpi-num tnum" id="kpiEngagement">96<span>万</span></div><div class="kpi-label">内容互动</div></div>\n'
+ '          <div class="kpi"><div class="kpi-num tnum" id="kpiFirstOrder">2.7<span>万</span></div><div class="kpi-label">首购单量</div></div>\n'
+ '          <div class="kpi"><div class="kpi-num tnum" id="kpiCac">¥186</div><div class="kpi-label">获客成本</div></div>',
  "P1 KPI 卡 → goals 驱动"
);

/* 7 · 甘特数量加 id，按批次实际计数 */
once('<div class="gantt-bar" style="left:0;width:25%">6 款 · 轻场景</div>',
     '<div class="gantt-bar" style="left:0;width:25%"><span id="gantW1">6 款</span> · 轻场景</div>', "甘特 W1");
once('<div class="gantt-bar w2" style="left:25%;width:50%">8 款 · 家务主力</div>',
     '<div class="gantt-bar w2" style="left:25%;width:50%"><span id="gantW2">8 款</span> · 家务主力</div>', "甘特 W2");
once('<div class="gantt-bar w3" style="left:75%;width:25%">6 款 · 个护旗舰</div>',
     '<div class="gantt-bar w3" style="left:75%;width:25%"><span id="gantW3">6 款</span> · 个护旗舰</div>', "甘特 W3");

/* 8 · P0 指标条与图注加 id */
once('<div class="p0-metrics">', '<div class="p0-metrics" id="p0Metrics">', "P0 指标条");
once('企业宣传片 / 2025–2026 Edition',
     '企业宣传片 / <span id="kvEdition">2025–2026</span> Edition', "封面图注年份");

/* 9 · applyConfig → applyData */
span(
  "/* ============================================================\n   V2 配置层：读取配置后台写入的配置",
  "\nfunction escapeHtml(s){",
  P("apply-data.js") + "\n\nfunction escapeHtml(s){",
  "applyConfig → applyData"
);

/* 10 · 初始化加数据缺失保护 */
once('applyConfig();\nbuildNav();', 'applyData();\nif(DATA_OK){\nbuildNav();', "初始化入口");
once('renderEntries();\nfunction bindHeroVideo(){',
     'renderEntries();\n} else {\n  showDataError();\n}\n\nfunction bindHeroVideo(){', "初始化数据保护");

/* 11 · 路由：下线页面给出明确提示，而不是静默回首页 */
once(
  'function route(){\n'
+ '  const hash = (location.hash || "#p0").replace("#","");\n'
+ '  const page = PAGES.find(p=>p.id===hash);\n'
+ '  if(page && page.built){ setActive(hash); }\n'
+ '  else if(page){ setActive("p0"); toast(page.no + " · " + page.name + "：下一批次交付"); }\n'
+ '  else { setActive("p0"); }\n'
+ '}',
  'function route(){\n'
+ '  const hash = (location.hash || "#p0").replace("#","");\n'
+ '  const page = PAGES.find(p=>p.id===hash);\n'
+ '  if(page && page.built){ setActive(hash); }\n'
+ '  else if(page){ setActive("p0"); toast(page.no + " · " + page.name + "：下一批次交付"); }\n'
+ '  else if(DISABLED_PAGES[hash]){ setActive("p0"); toast("「" + DISABLED_PAGES[hash] + "」已在配置后台下线"); }\n'
+ '  else { setActive("p0"); toast("「" + hash + "」不是有效页面，已回到系统总览"); }\n'
+ '}',
  "路由提示"
);

/* 12 · 渠道条数显示单位（v1 数字覆盖后丢了「条」） */
once('+ "<dt>已入库</dt><dd>" + c.count + "</dd>"',
     '+ "<dt>已入库</dt><dd>" + c.count + " 条</dd>"', "渠道条数单位");

fs.writeFileSync(FILE, html, "utf8");
console.log(log.join("\n"));
console.log("\n完成，输出: " + FILE);
