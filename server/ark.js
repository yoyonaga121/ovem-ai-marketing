/* ============================================================
   OVEM B3 · 火山方舟 / 豆包 OpenAI 兼容 adapter
   ------------------------------------------------------------
   只从服务端读取 key；支持文本、图片、视觉质检。
   base URL 与模型名全部走租户配置 / env，不硬编码模型。
   ============================================================ */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULTS = {
  baseUrl: process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
  textModel: process.env.ARK_TEXT_MODEL || "",
  imageModel: process.env.ARK_IMAGE_MODEL || "",
  visionModel: process.env.ARK_VISION_MODEL || ""
};

const SECRET_FILE = path.join(__dirname, ".secret");

function getSecret() {
  if (process.env.OVEM_SECRET) return process.env.OVEM_SECRET;
  try {
    if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf8").trim();
    const s = crypto.randomBytes(32).toString("base64url");
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  } catch (e) {
    return "ovem-local-fallback-secret";
  }
}

function keyFromSecret() {
  return crypto.createHash("sha256").update(getSecret()).digest();
}

function encrypt(text) {
  if (!text) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFromSecret(), iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return "v1:" + iv.toString("base64url") + ":" + cipher.getAuthTag().toString("base64url") + ":" + enc.toString("base64url");
}

function decrypt(payload) {
  if (!payload) return "";
  try {
    const parts = String(payload).split(":");
    if (parts.length !== 4 || parts[0] !== "v1") return "";
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const data = Buffer.from(parts[3], "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyFromSecret(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch (e) { return ""; }
}

function mask(key) { return key ? "••••••" + String(key).slice(-4) : ""; }

async function request(cfg, pathName, body, opt) {
  opt = opt || {};
  const base = String(cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, "");
  const url = base + pathName;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opt.timeoutMs || 60000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + cfg.apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      const msg = (json && (json.error && (json.error.message || json.error.code))) || text.slice(0, 220) || ("HTTP " + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return { json: json, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function chat(cfg, messages, opt) {
  opt = opt || {};
  const body = {
    model: cfg.textModel,
    messages: messages,
    temperature: opt.temperature == null ? 0.5 : opt.temperature,
    max_tokens: opt.maxTokens || 900
  };
  if (opt.responseFormat) body.response_format = { type: opt.responseFormat };
  const res = await request(cfg, "/chat/completions", body, opt);
  const json = res.json || {};
  const choice = (json.choices && json.choices[0]) || {};
  return {
    text: (choice.message && choice.message.content) || "",
    usage: json.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    model: json.model || cfg.textModel,
    raw: json
  };
}

async function image(cfg, prompt, size) {
  const body = {
    model: cfg.imageModel,
    prompt: prompt,
    size: size || "1024x1024",
    response_format: "url",
    n: 1
  };
  const res = await request(cfg, "/images/generations", body, { timeoutMs: 120000 });
  const json = res.json || {};
  const item = (json.data && json.data[0]) || {};
  return {
    url: item.url || "",
    b64: item.b64_json || "",
    revisedPrompt: item.revised_prompt || "",
    model: json.model || cfg.imageModel,
    raw: json
  };
}

async function vision(cfg, imageUrl, prompt) {
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: imageUrl } }
    ]
  }];
  return chat(Object.assign({}, cfg, { textModel: cfg.visionModel || cfg.textModel }), messages, { maxTokens: 500, temperature: 0.2 });
}

module.exports = { DEFAULTS, encrypt, decrypt, mask, getSecret, chat, image, vision, request };
