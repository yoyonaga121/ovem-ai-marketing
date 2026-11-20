/* ============================================================
   OVEM B3 · 本地 fake Ark（只用于 live adapter 契约测试）
   ------------------------------------------------------------
   不接真实模型：返回可解析的 JSON 文案和纯色 PNG，验证
   ark.js / live-tools.js / job-runner.js 的完整链路。
   启动：node tools/fake-ark.js
   ============================================================ */
"use strict";

const http = require("node:http");
const zlib = require("node:zlib");

const PORT = Number(process.env.FAKE_ARK_PORT) || 4399;
const HOST = "127.0.0.1";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { resolve({}); } });
  });
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u0 = new URL(req.url, "http://x");
  const isDown = u0.pathname.startsWith("/down/");
  const isRetry = u0.pathname.startsWith("/retry/");
  const prefix = isDown ? "/down" : (isRetry ? "/retry" : "");
  const u = new URL(u0.pathname.slice(prefix.length) + u0.search, "http://x");
  if (isDown) {
    json(res, 503, { error: { message: "fake ark: simulated outage" } });
    return;
  }
  if (isRetry && req.method === "POST" && !global.__retryOnce) {
    global.__retryOnce = true;
    json(res, 429, { error: { message: "fake ark: rate limited once" } });
    return;
  }
  if (req.method === "POST" && u.pathname === "/chat/completions") {
    const body = await readJson(req);
    const text = (body.messages || []).map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");
    let content = "{\"ok\":true}";
    if (/质检/.test(text)) {
      content = JSON.stringify({ verdict: "pass", score: 88, issues: [], checks: [{ name: "ratio", ok: true, detail: "fake" }, { name: "logo", ok: true, detail: "fake" }] });
    } else if (/prompts/.test(text)) {
      content = JSON.stringify({ prompts: [
        { channelId: "c01", body: "深蓝科技官网首屏，产品主体居中，冷光，留白，品牌色 #0B1F3A", negativePrompt: "文字、水印" },
        { channelId: "c02", body: "竖版移动端产品海报，深蓝背景，产品悬浮，光束，品牌色 #2F6FED", negativePrompt: "文字、水印" },
        { channelId: "c06", body: "3:4 社媒方图，产品场景化，克制留白，品牌色 #0B1F3A", negativePrompt: "文字、水印" }
      ] });
    } else if (/copies/.test(text)) {
      content = JSON.stringify({ copies: [
        { channelId: "c01", title: "把未来放在桌面", subtitle: "OVEM P01 旗舰款", body: "小体积，大场景。为日常空间留出呼吸感。" },
        { channelId: "c02", title: "掌心里的旗舰", subtitle: "OVEM P01 移动版", body: "随时唤醒，随手可用。" },
        { channelId: "c06", title: "一台就够", subtitle: "OVEM P01 社媒版", body: "把复杂留给自己，把简单交给用户。" }
      ] });
    }
    json(res, 200, { id: "fake", model: body.model || "fake", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 } });
    return;
  }
  if (req.method === "POST" && u.pathname === "/images/generations") {
    const body = await readJson(req);
    const m = /^(\d+)x(\d+)$/.exec(body.size || "1024x1024") || [0, "1024", "1024"];
    const id = "img-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    const w = Number(m[1]), h = Number(m[2]);
    const colors = { c01: [11, 31, 58], c02: [47, 111, 237], c06: [11, 31, 58] };
    const rgb = colors[(body.prompt || "").includes("移动端") ? "c02" : "c01"] || [11, 31, 58];
    global.__fakeImages = global.__fakeImages || {};
    global.__fakeImages[id] = png(w, h, rgb);
    json(res, 200, { model: body.model || "fake-image", data: [{ url: "http://" + HOST + ":" + PORT + "/img/" + id + ".png" }] });
    return;
  }
  if (req.method === "GET" && u.pathname.startsWith("/img/")) {
    const id = u.pathname.slice(5).replace(/\.png$/, "");
    const buf = global.__fakeImages && global.__fakeImages[id];
    if (!buf) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "content-type": "image/png", "content-length": buf.length });
    res.end(buf);
    return;
  }
  json(res, 404, { error: { message: "fake ark: not found" } });
});

server.listen(PORT, HOST, () => {
  console.log("[fake-ark] listening http://" + HOST + ":" + PORT);
});
