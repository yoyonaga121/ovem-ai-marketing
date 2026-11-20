/* ============================================================
   v1 → v2 数据迁移脚本（一次性）
   作用：从 v1 的 index.html + ovem-config.js 中抽取散落的数据字面量，
        合并为单一数据源 data/ovem-data.js。
   用法：node tools/migrate-v1-data.js
   说明：迁移后前台不再内联数据，本脚本保留作为「数据来源可追溯」的证据。
   ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "index.html");
const CFG = path.join(ROOT, "ovem-config.js");
const OUT = path.join(ROOT, "data", "ovem-data.js");

const html = fs.readFileSync(SITE, "utf8");
const cfgSrc = fs.readFileSync(CFG, "utf8");

/* --- 1. 按名字抽取 const 字面量块 --- */
function block(name) {
  const re = new RegExp("const\\s+" + name + "\\s*=\\s*");
  const m = re.exec(html);
  if (!m) throw new Error("未找到数据块: " + name);
  const lines = html.slice(m.index).split("\n");
  let acc = "";
  for (let i = 0; i < lines.length; i++) {
    acc += lines[i] + "\n";
    /* 兼容单行声明：整行以 ]; 或 }; 结尾即视为声明结束 */
    if (/[\]\}];\s*$/.test(lines[i])) break;
  }
  return acc.trim();
}

const NAMES = ["PRODUCTS", "HOOKS", "SCENE_POOL", "CHANNEL_TPL", "CHANNEL_DATA"];
const src = NAMES.map(block).join("\n");
const v1 = new Function(src + "\nreturn {PRODUCTS,HOOKS,SCENE_POOL,CHANNEL_TPL,CHANNEL_DATA};")();

/* --- 2. 读取 v1 配置文件 --- */
const cfg = new Function("window", cfgSrc + "\nreturn window.OVEM_CONFIG;")({});

/* --- 3. 合并产品：把 hook 收进产品对象，补 enabled --- */
const products = v1.PRODUCTS.map(p => Object.assign({}, p, {
  hook: v1.HOOKS[p.id] || p.oneliner,
  enabled: true
}));

/* --- 4. 合并渠道：v1 的 count 是 "12 条" 字符串，配置层用数字，统一成数字 --- */
const channels = v1.CHANNEL_DATA.map((c, i) => {
  const cc = (cfg.channels || []).find(x => x && (x.origName || x.name) === c.name) || (cfg.channels || [])[i] || {};
  const n = Number(cc.count);
  return Object.assign({}, c, {
    count: isNaN(n) ? parseInt(String(c.count), 10) || 0 : n,
    kpi: cc.kpi || c.kpi,
    cycle: cc.cycle || c.cycle,
    tpl: v1.CHANNEL_TPL[c.name] != null ? v1.CHANNEL_TPL[c.name] : i,
    enabled: cc.enabled !== false
  });
});

/* --- 5. 封面指标：标注可推导来源 --- */
const DERIVE = ["products", "channels", "slots", "variants", null];
const metrics = (cfg.metrics || []).map((m, i) => Object.assign({}, m, { derive: DERIVE[i] || null }));

/* --- 6. 组装单一数据源 --- */
const data = {
  meta: {
    version: "v2.0.0",
    updated: "2026-11-20",
    mode: "published",
    source: "OVEM 配置中台 · 数据迁移",
    note: "本文件是前台唯一的业务数据来源；由配置后台编辑并发布后覆盖。",
    changelog: [
      { v: "v2.0.0", at: "2026-11-20", by: "迁移", note: "v1 分散数据合并为单一数据源；产品补齐 hook/enabled；渠道 count 统一为数字" }
    ]
  },
  brand: cfg.brand,
  hero: cfg.hero,
  metrics: metrics,
  goals: cfg.goals,
  scenes: {
    order: ["厨房", "客厅", "卧室", "卫浴个护", "阳台玄关", "出行宠物", "收纳"],
    pool: v1.SCENE_POOL
  },
  pages: cfg.pages,
  channels: channels,
  products: products
};

/* --- 7. 输出 --- */
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const body = JSON.stringify(data, null, 2);
const file = [
  "/* ============================================================",
  "   OVEM 单一数据源 · 由配置后台（OVEM配置后台.html）维护",
  "   前台 index.html 与本后台共用此文件，禁止在其他文件里重复定义同类字段",
  "   生成时间：" + new Date().toISOString(),
  "   ============================================================ */",
  "window.OVEM_DATA = " + body + ";",
  ""
].join("\n");

fs.writeFileSync(OUT, file, "utf8");

/* --- 8. 自检 --- */
const bad = [];
products.forEach(p => {
  if (!p.tags || p.tags.length !== 3) bad.push(p.id + " tags 数量异常");
  if (!p.pain || !p.diff || !p.audience) bad.push(p.id + " 文案字段缺失");
});
console.log("已生成: " + OUT);
console.log("产品 " + products.length + " 条 / 渠道 " + channels.length + " 条 / 指标 " + metrics.length + " 项");
console.log("体检问题: " + (bad.length ? bad.join("; ") : "无"));
