/* ============================================================
   OVEM B3 · Provider 配置（租户级）
   ------------------------------------------------------------
   API key 使用 AES-256-GCM 加密；前端只拿掩码。
   环境变量作为无 UI 配置时的兜底。
   ============================================================ */
"use strict";

const dbm = require("./db");
const ark = require("./ark");

function defaults(tenantId) {
  return {
    provider: "ark",
    baseUrl: ark.DEFAULTS.baseUrl,
    textModel: ark.DEFAULTS.textModel,
    imageModel: ark.DEFAULTS.imageModel,
    visionModel: ark.DEFAULTS.visionModel,
    enabled: false,
    hasKey: false,
    keyMasked: "",
    updatedAt: "",
    updatedBy: ""
  };
}

function getRow(tenantId) {
  return dbm.db.prepare("SELECT * FROM provider_configs WHERE tenant_id = ?").get(tenantId) || null;
}

function getPublic(tenantId) {
  const row = getRow(tenantId);
  if (!row) return defaults(tenantId);
  const key = ark.decrypt(row.api_key_cipher) || process.env.ARK_API_KEY || "";
  return {
    provider: row.provider || "ark",
    baseUrl: row.base_url || ark.DEFAULTS.baseUrl,
    textModel: row.text_model || "",
    imageModel: row.image_model || "",
    visionModel: row.vision_model || "",
    enabled: !!row.enabled,
    hasKey: !!key,
    keyMasked: key ? ark.mask(key) : "",
    updatedAt: row.updated_at || "",
    updatedBy: row.updated_by || ""
  };
}

function getRuntime(tenantId) {
  const row = getRow(tenantId);
  const envKey = process.env.ARK_API_KEY || "";
  const key = (row && ark.decrypt(row.api_key_cipher)) || envKey;
  const baseUrl = (row && row.base_url) || ark.DEFAULTS.baseUrl;
  const textModel = (row && row.text_model) || ark.DEFAULTS.textModel;
  const imageModel = (row && row.image_model) || ark.DEFAULTS.imageModel;
  const visionModel = (row && row.vision_model) || ark.DEFAULTS.visionModel;
  return {
    provider: (row && row.provider) || "ark",
    baseUrl: baseUrl,
    textModel: textModel,
    imageModel: imageModel,
    visionModel: visionModel,
    apiKey: key,
    enabled: !!(row && row.enabled) || !!envKey,
    hasKey: !!key,
    ready: !!key && !!textModel && !!imageModel && (!!(row && row.enabled) || !!envKey)
  };
}

function save(tenantId, userId, input) {
  const now = dbm.nowIso();
  const existing = getRow(tenantId);
  const apiKey = String(input.apiKey || "").trim();
  const cipher = apiKey ? ark.encrypt(apiKey) : (existing ? existing.api_key_cipher : "");
  const last4 = apiKey ? apiKey.slice(-4) : (existing ? existing.api_key_last4 : "");
  const enabled = input.enabled === true || input.enabled === "true" || input.enabled === 1;
  const baseUrl = String(input.baseUrl || ark.DEFAULTS.baseUrl).replace(/\/+$/, "");
  const textModel = String(input.textModel || "");
  const imageModel = String(input.imageModel || "");
  const visionModel = String(input.visionModel || "");
  dbm.db.prepare(
    "INSERT INTO provider_configs (id,tenant_id,provider,base_url,text_model,image_model,vision_model,api_key_cipher,api_key_last4,enabled,updated_at,updated_by) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET base_url=excluded.base_url,text_model=excluded.text_model,image_model=excluded.image_model,vision_model=excluded.vision_model,api_key_cipher=excluded.api_key_cipher,api_key_last4=excluded.api_key_last4,enabled=excluded.enabled,updated_at=excluded.updated_at,updated_by=excluded.updated_by"
  ).run(existing ? existing.id : dbm.newId("prov"), tenantId, "ark", baseUrl, textModel, imageModel, visionModel, cipher, last4, enabled ? 1 : 0, now, userId || "");
  return getPublic(tenantId);
}

async function test(tenantId) {
  const cfg = getRuntime(tenantId);
  if (!cfg.apiKey) return { ok: false, code: "no_key", message: "未配置 API key" };
  if (!cfg.textModel) return { ok: false, code: "no_model", message: "未配置文本模型 endpoint id" };
  try {
    const res = await ark.chat(cfg, [{ role: "user", content: "只回复 JSON：{\"ok\":true}" }], { maxTokens: 32, temperature: 0, responseFormat: "json_object" });
    return { ok: true, model: res.model, usage: res.usage, sample: String(res.text || "").slice(0, 120) };
  } catch (e) {
    return { ok: false, code: "provider_error", status: e.status || 0, message: String(e.message || e) };
  }
}

module.exports = { defaults, getPublic, getRuntime, save, test };
