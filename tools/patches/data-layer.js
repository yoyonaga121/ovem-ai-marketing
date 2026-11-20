/* ============================================================
   数据层 v2.0：唯一来源 = data/ovem-data.js
   ------------------------------------------------------------
   v1 把产品、钩子、场景池、渠道模板内联在本文件里，配置后台只能改到其中
   7 个字段，导致「后台改了一半、前台另一半还是旧值」。v2 起前台不再内联
   任何业务数据，只做读取、派生与兜底。
   ------------------------------------------------------------
   优先级：本地草稿（配置后台预览） > data/ovem-data.js（已发布）
   ============================================================ */
const DRAFT_KEY = "ovem_data_draft";
let DISABLED_PAGES = {};

function resolveData(){
  const base = window.OVEM_DATA;
  if(!base) return { data: null, draft: false, version: "" };
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    if(raw){
      const pack = JSON.parse(raw);
      if(pack && pack.data && pack.meta && pack.meta.mode === "draft"){
        return { data: pack.data, draft: true, version: pack.meta.version || "" };
      }
    }
  }catch(e){ /* 草稿损坏时静默回退到已发布数据 */ }
  return { data: base, draft: false, version: (base.meta && base.meta.version) || "" };
}

const RESOLVED   = resolveData();
const DATA       = RESOLVED.data;
const DATA_OK    = !!DATA;
const IS_DRAFT   = RESOLVED.draft;

/* 派生结构：与 v1 同名，保证下游渲染代码零改动 */
const PRODUCTS     = ((DATA && DATA.products) || []).filter(p => p && p.enabled !== false);
const CHANNEL_DATA = ((DATA && DATA.channels) || []).filter(c => c && c.enabled !== false);
const CHANNELS     = CHANNEL_DATA.map(c => c.name);
const HOOKS        = PRODUCTS.reduce((o, p) => { o[p.id] = p.hook || p.oneliner || ""; return o; }, {});
const SCENE_POOL   = (DATA && DATA.scenes && DATA.scenes.pool) ? DATA.scenes.pool : {};
const CHANNEL_TPL  = CHANNEL_DATA.reduce((o, c, i) => {
  const n = Number(c.tpl);
  o[c.name] = Number.isInteger(n) ? n : i;
  return o;
}, {});
const GOALS        = (DATA && DATA.goals) ? DATA.goals : {};
