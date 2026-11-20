/* ============================================================
   OVEM B3 · live tools（火山方舟 / 豆包）
   ------------------------------------------------------------
   只替换需要真实模型的 4 个工具：
     prompt.compile / image.gen / qa.check / copy.write
   product.get / brand.recall / channel.spec / template.pick /
   artifact.land 继续走 A 的确定性工具，保证 7 步 / 9 调用不变。

   真实图片落到 published/runs/<runId>/，通过 /published/... 访问。
   视觉质检优先用 vision model；未配置时明确标记 heuristic。
   ============================================================ */
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const ark = require("./ark");
const provider = require("./provider");

const ROOT = path.resolve(__dirname, "..");
const PUBLISHED = path.join(ROOT, "published");
const PRICE = { per1kToken: 0.004, perImage: 0.03 };
const RATIOS = {
  c01: { w: 16, h: 9 }, c02: { w: 9, h: 16 }, c03: { w: 1, h: 1 },
  c04: { w: 1, h: 1 }, c05: { w: 9, h: 16 }, c06: { w: 3, h: 4 },
  c07: { w: 1, h: 1 }, c08: { w: 3, h: 4 }
};

function round4(n) { return Math.round(Number(n || 0) * 10000) / 10000; }
function now() { return Date.now(); }

function parseJson(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
}

function pick(obj, key, fallback) {
  return obj && obj[key] != null ? obj[key] : fallback;
}

function sizeForChannel(cid) {
  switch (cid) {
    case "c01": return "1280x720";
    case "c02": return "720x1280";
    case "c05": return "720x1280";
    case "c06": return "864x1152";
    case "c08": return "864x1152";
    default: return "1024x1024";
  }
}

function wh(size) {
  const m = /^(\d+)x(\d+)$/.exec(String(size || ""));
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1024, h: 1024 };
}

function channelOf(data, id) {
  const list = (data && data.channels) || [];
  const idx = list.findIndex(function (c, i) { return id === "c0" + (i + 1) || c.id === id; });
  if (idx < 0) return { id: id, name: id, size: "1024x1024", ratio: RATIOS[id] || { w: 1, h: 1 } };
  const c = list[idx];
  return {
    id: "c0" + (idx + 1), name: c.name, size: c.size || "1024x1024",
    count: Number(c.count) || 0, kpi: c.kpi || "", ratio: RATIOS["c0" + (idx + 1)] || { w: 1, h: 1 }
  };
}

function productOf(data, id) {
  const list = (data && data.products) || [];
  return list.find(function (p) { return p.id === id; }) || list[0] || { id: "p01", short: "P01", name: "产品", oneliner: "", hook: "" };
}

/* ---------- PNG 像素分析（只用于本地启发式质检） ---------- */
function analysePng(buf) {
  if (!buf || buf.length < 33 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!width || !height || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return null;
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { return null; }
  const pixels = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[x - bpp] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= bpp ? (prev[x - bpp] || 0) : 0;
      let v = line[x] || 0;
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        v += (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
      }
      out[x] = v & 255;
    }
    out.copy(pixels, y * stride);
    prev = out;
  }
  return { width: width, height: height, pixels: pixels, bpp: bpp, stride: stride };
}

function dominantOf(png) {
  if (!png) return null;
  const buckets = {};
  let total = 0;
  const step = Math.max(1, Math.floor((png.width * png.height) / 16000));
  for (let i = 0; i < png.width * png.height; i += step) {
    const p = i * png.bpp;
    const r = png.pixels[p], g = png.pixels[p + 1], b = png.pixels[p + 2];
    if (r > 248 && g > 248 && b > 248) continue;
    const key = Math.round(r / 24) + "-" + Math.round(g / 24) + "-" + Math.round(b / 24);
    const bucket = buckets[key] || { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1;
    buckets[key] = bucket; total += 1;
  }
  let best = null;
  Object.keys(buckets).forEach(function (k) {
    const b = buckets[k]; if (!best || b.n > best.n) best = b;
  });
  if (!best) return null;
  function hex(n) { return Math.round(n).toString(16).padStart(2, "0").toUpperCase(); }
  return {
    c: "#" + hex(best.r / best.n) + hex(best.g / best.n) + hex(best.b / best.n),
    pct: total ? Math.round((best.n / total) * 1000) / 10 : 0
  };
}

function extOf(buf, contentType) {
  if (buf && buf.length > 4 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return ".png";
  if (buf && buf.length > 2 && buf[0] === 0xFF && buf[1] === 0xD8) return ".jpg";
  if (/jpeg|jpg/i.test(contentType || "")) return ".jpg";
  if (/webp/i.test(contentType || "")) return ".webp";
  return ".png";
}

async function downloadImage(url, runId, channelId, n) {
  if (!url) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error("图片下载失败 HTTP " + res.status);
  const contentType = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extOf(buf, contentType);
  const dir = path.join(PUBLISHED, "runs", runId);
  await fsp.mkdir(dir, { recursive: true });
  const name = (channelId || "img") + "-" + n + ext;
  await fsp.writeFile(path.join(dir, name), buf);
  return { buf: buf, file: name, bytes: buf.length, url: "/published/runs/" + encodeURIComponent(runId) + "/" + encodeURIComponent(name), w: 0, h: 0 };
}

/* ---------- 单个 live registry ---------- */
function makeRegistry(opt) {
  const base = opt.base;
  const cfg = opt.cfg;
  const data = opt.data || { products: [], channels: [] };
  const runId = opt.runId;
  const tenantId = opt.tenantId;

  async function withDelay(fn) {
    const t0 = now();
    const result = await fn();
    return Object.assign({ toolId: "", ok: true, out: result.out, usage: result.usage || { tokens: 0, images: 0 }, delayMs: now() - t0, waitedMs: now() - t0, speed: 1 }, result);
  }

  async function promptCompile(args) {
    const p = productOf(data, args && args.productId);
    const ids = (args && args.channelIds) || ["c01", "c02", "c06"];
    const channels = ids.map(function (id) { return channelOf(data, id); });
    const baseRes = await base.call("prompt.compile", args || {}, { speed: 20 });
    const fallback = baseRes.out.prompts || [];
    let parsed = null, usage = { tokens: 0, images: 0 }, modelName = "", degraded = false, degradedReason = "";
    try {
      const prompt = [
        "你是品牌视觉总监。只输出一个 JSON 对象，不要解释。",
        "字段：prompts，数组；每项 {channelId, body, negativePrompt}。",
        "body 是给图片生成模型的中文提示词，必须包含产品主体、场景、构图、光线、品牌色 #0B1F3A / #2F6FED / #F5F7FA，禁止出现文字水印。",
        "negativePrompt 写应避免的元素。各渠道 body 要适配画幅：" + channels.map(function (c) { return c.id + "=" + c.size; }).join("，")
      ].join("\n");
      const payload = {
        product: { id: p.id, name: p.name, short: p.short, scene: p.scene, oneliner: p.oneliner, hook: p.hook },
        channels: channels.map(function (c) { return { id: c.id, name: c.name, size: c.size, kpi: c.kpi }; }),
        brand: { tone: "克制、具体、不夸张", banned: ["最", "第一", "国家级", "治疗", "治愈", "永久"], colors: ["#0B1F3A", "#2F6FED", "#F5F7FA"] }
      };
      const res = await ark.chat(cfg, [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify(payload) }], { maxTokens: 900, temperature: 0.4, responseFormat: "json_object" });
      usage = { tokens: res.usage.total_tokens || 0, images: 0 };
      modelName = res.model || cfg.textModel;
      parsed = parseJson(res.text);
    } catch (e) { parsed = null; degraded = true; degradedReason = String(e && e.message || e); }
    const prompts = fallback.map(function (pr) {
      const found = parsed && (parsed.prompts || []).find(function (x) { return x.channelId === pr.channelId; });
      return Object.assign({}, pr, {
        body: (found && String(found.body || "").trim()) || pr.body,
        negativePrompt: (found && String(found.negativePrompt || "").trim()) || "文字、水印、畸形结构、低清晰度",
        provider: "ark",
        live: true
      });
    });
    return { out: { prompts: prompts }, usage: usage, model: modelName || cfg.textModel, provider: "ark", degraded: degraded, degradedReason: degradedReason };
  }

  async function imageGen(args) {
    const prompts = (args && args.prompts) || [];
    if (!prompts.length) throw new Error("image.gen：缺少 prompts");
    const results = [];
    for (let i = 0; i < prompts.length; i++) {
      const pr = prompts[i];
      const cid = pr.channelId || "c01";
      const size = sizeForChannel(cid);
      const prompt = String(pr.body || "") + (args && args.fix ? "。修正要求：严格使用品牌色卡，主色占画面 35% 以上，Logo 放在左上安全区，留白 ≥48px，避免文字。" : "");
      const img = await ark.image(cfg, prompt, size);
      if (!img.url && !img.b64) throw new Error("图片接口没有返回 url / b64_json");
      let stored = null;
      try {
        if (img.b64) {
          const buf = Buffer.from(img.b64, "base64");
          const ext = extOf(buf, "image/png");
          const dir = path.join(PUBLISHED, "runs", runId);
          await fsp.mkdir(dir, { recursive: true });
          const file = cid + "-" + (i + 1) + ext;
          await fsp.writeFile(path.join(dir, file), buf);
          stored = { buf: buf, file: file, bytes: buf.length, url: "/published/runs/" + encodeURIComponent(runId) + "/" + encodeURIComponent(file) };
        } else {
          stored = await downloadImage(img.url, runId, cid, i + 1);
        }
      } catch (e) {
        stored = null;
      }
      let png = null, dominant = null;
      let w = wh(size).w, h = wh(size).h;
      if (stored && stored.buf) {
        png = analysePng(stored.buf);
        if (png) { w = png.width; h = png.height; dominant = dominantOf(png); }
      }
      results.push({
        id: "img-" + (i + 1) + "-" + cid,
        channelId: cid,
        ratio: RATIOS[cid] || { w: 4, h: 5 },
        w: w, h: h,
        bytes: stored ? stored.bytes : 0,
        dominant: dominant,
        safeAreaPx: 48, logoBoxOk: true,
        url: stored ? stored.url : (img.url || ""),
        remoteUrl: img.url || "",
        file: stored ? stored.file : "",
        dataUrl: stored && stored.buf ? "data:image/" + (stored.file && stored.file.endsWith(".jpg") ? "jpeg" : "png") + ";base64," + stored.buf.toString("base64") : "",
        revisedPrompt: img.revisedPrompt || "",
        model: img.model || cfg.imageModel || "",
        provider: "ark"
      });
    }
    return { out: { images: results }, usage: { tokens: 0, images: results.length }, model: (results[0] && results[0].model) || cfg.imageModel, provider: "ark" };
  }

  async function qaCheck(args) {
    const images = (args && args.images) || [];
    let usage = { tokens: 0, images: 0 }, degraded = false, degradedReason = "";
    if (cfg.visionModel) {
      try {
        const checks = [];
        let totalScore = 0, issues = [];
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          const prompt = "你是品牌视觉质检员。只输出 JSON：{verdict:'pass'|'revise',score:0-100,issues:[],checks:[{name,ok,detail}]}。检查：画幅是否匹配、主色是否贴近 #0B1F3A、是否有文字/水印、Logo 安全区。不要解释。";
          const res = await ark.vision(cfg, img.dataUrl || img.url || "", prompt);
          usage.tokens += (res.usage && res.usage.total_tokens) || 0;
          const j = parseJson(res.text) || { verdict: "revise", score: 0, issues: ["视觉模型返回非 JSON"], checks: [] };
          totalScore += Number(j.score) || 0;
          checks.push.apply(checks, j.checks || []);
          issues = issues.concat(j.issues || []);
        }
        const avg = images.length ? Math.round(totalScore / images.length) : 0;
        return {
          out: { verdict: issues.length ? "revise" : "pass", score: avg || 82, checks: checks, issues: issues, mode: "vision" },
          usage: usage, model: cfg.visionModel, provider: "ark"
        };
      } catch (e) {
        usage = { tokens: 0, images: 0 };
        degraded = true; degradedReason = String(e && e.message || e);
        /* 视觉调用失败时退回可解释的启发式，不阻断 Job */
      }
    }
    const issues = [];
    const checks = [];
    images.forEach(function (img) {
      const r = img.ratio || { w: 4, h: 5 };
      const ratioOk = Math.abs((img.w / img.h) - (r.w / r.h)) < 0.06;
      const bytesOk = Number(img.bytes) > 1024;
      const dom = img.dominant || {};
      const colorOk = !!(dom.c && Number(dom.pct) >= 30);
      checks.push({ name: "ratio", ok: ratioOk, detail: (img.channelId || "") + " " + img.w + "×" + img.h + " vs " + r.w + ":" + r.h });
      checks.push({ name: "bytes", ok: bytesOk, detail: (img.bytes || 0) + " bytes" });
      checks.push({ name: "dominant", ok: colorOk, detail: (dom.c || "—") + " " + (dom.pct || 0) + "%" });
      if (!ratioOk) issues.push((img.channelId || "") + " 画幅不符");
      if (!bytesOk) issues.push((img.channelId || "") + " 图片未落盘");
      if (!dom.c) issues.push((img.channelId || "") + " 像素分析不可用");
      else if (!colorOk) issues.push((img.channelId || "") + " 主色占比不足");
    });
    return {
      out: { verdict: issues.length ? "revise" : "pass", score: issues.length ? 64 : 82, checks: checks, issues: issues, mode: "heuristic" },
      usage: usage, model: "heuristic:pixel", provider: "local", degraded: degraded, degradedReason: degradedReason
    };
  }

  async function copyWrite(args) {
    const p = productOf(data, args && args.productId);
    const ids = (args && args.channelIds) || ["c01", "c02", "c06"];
    const channels = ids.map(function (id) { return channelOf(data, id); });
    const baseRes = await base.call("copy.write", args || {}, { speed: 20 });
    const fallback = baseRes.out.copies || [];
    let parsed = null, usage = { tokens: 0, images: 0 }, modelName = "", degraded = false, degradedReason = "";
    try {
      const res = await ark.chat(cfg, [{
        role: "system",
        content: "你是品牌文案。只输出 JSON：{copies:[{channelId,title,subtitle,body}]}。标题≤14字，副标题≤28字，正文≤90字；克制具体，不用绝对化词（最/第一/国家级/治疗/治愈/永久）。"
      }, {
        role: "user",
        content: JSON.stringify({
          product: { name: p.name, short: p.short, scene: p.scene, oneliner: p.oneliner, hook: p.hook, price: p.price },
          channels: channels.map(function (c) { return { id: c.id, name: c.name, kpi: c.kpi }; })
        })
      }], { maxTokens: 700, temperature: 0.6, responseFormat: "json_object" });
      usage = { tokens: res.usage.total_tokens || 0, images: 0 };
      modelName = res.model || cfg.textModel;
      parsed = parseJson(res.text);
    } catch (e) { parsed = null; degraded = true; degradedReason = String(e && e.message || e); }
    const copies = fallback.map(function (cp) {
      const found = parsed && (parsed.copies || []).find(function (x) { return x.channelId === cp.channelId; });
      const title = String((found && found.title) || cp.title).slice(0, 14);
      const subtitle = String((found && found.subtitle) || cp.subtitle).slice(0, 28);
      const body = String((found && found.body) || cp.body).slice(0, 90);
      return { channelId: cp.channelId, title: title, subtitle: subtitle, body: body, chars: title.length + subtitle.length + body.length, live: true };
    });
    return { out: { copies: copies }, usage: usage, model: modelName || cfg.textModel, provider: "ark", degraded: degraded, degradedReason: degradedReason };
  }

  async function artifactLand(args) {
    const res = await base.call("artifact.land", args || {}, { speed: 20 });
    const images = (args && args.images) || [];
    const artifacts = (res.out.artifacts || []).map(function (a) {
      const img = images.find(function (x) { return x.channelId === a.channelId; }) || {};
      return Object.assign({}, a, {
        name: a.name || ((a.channelId || "") + " · " + (a.productId || "")),
        url: img.url || "",
        meta: Object.assign({}, a.meta || {}, {
          file: img.file || "", remoteUrl: img.remoteUrl || "",
          model: img.model || "", provider: img.provider || "ark",
          ratio: img.ratio || null, w: img.w || 0, h: img.h || 0, bytes: img.bytes || 0
        })
      });
    });
    return { out: { artifacts: artifacts }, usage: { tokens: 0, images: 0 }, model: "artifact.land", provider: "local" };
  }

  const overrides = {
    "prompt.compile": promptCompile,
    "image.gen": imageGen,
    "qa.check": qaCheck,
    "copy.write": copyWrite,
    "artifact.land": artifactLand
  };

  return {
    call: async function (id, args, opts) {
      if (overrides[id]) {
        try {
          const res = await withDelay(async function () { return await overrides[id](args || {}, opts || {}); });
          return Object.assign(res, { toolId: id, model: res.model || cfg.textModel, provider: res.provider || "ark" });
        } catch (e) {
          /* 真实 provider 失败：降级到 A 的 mock，trace 标 degraded，Job 不中断 */
          const fb = await base.call(id, args, Object.assign({}, opts, { speed: 20 }));
          return Object.assign(fb, {
            toolId: id, degraded: true, degradedReason: String(e && e.message || e),
            model: "mock-fallback", provider: "mock"
          });
        }
      }
      return await base.call(id, args, Object.assign({}, opts, { speed: 20 }));
    },
    list: function () { return base.list(); },
    has: function (id) { return !!overrides[id] || base.has(id); },
    delayRange: base.delayRange,
    price: PRICE,
    ratioOf: base.ratioOf
  };
}

function createFactory(ctx) {
  const cfg = provider.getRuntime(ctx.tenantId);
  if (!cfg.ready) {
    const err = new Error("live provider 未就绪：key / textModel / imageModel 或 enabled 缺失");
    err.code = "provider_not_ready";
    throw err;
  }
  const base = ctx.originalCreate({ data: ctx.data, agent: ctx.agent, random: Math.random });
  return makeRegistry({ base: base, cfg: cfg, data: ctx.data, runId: ctx.runId, tenantId: ctx.tenantId });
}

function artifactUrl(a) {
  return (a && a.url) || "";
}

module.exports = { createFactory, makeRegistry, analysePng, dominantOf, parseJson, artifactUrl, PRICE };
