/* ============================================================
   v2.0 应用层：把单一数据源渲染到页面
   ① 品牌 / 封面 / 指标（含自动推导）  ② 年度目标  ③ 页面可见性
   ④ 草稿态标识  ⑤ 数据缺失保护
   ============================================================ */
function fmtNum(n){
  const v = Number(String(n).replace(/,/g, ""));
  if(!isFinite(v)) return String(n);
  return v.toLocaleString("zh-CN");
}

function derivedMetric(m){
  const pc = PRODUCTS.length, cc = CHANNEL_DATA.length;
  switch(m.derive){
    case "products": return pc;
    case "channels": return cc;
    case "slots":    return pc * cc;
    case "variants": return pc * cc * 3;
    default:         return m.v;
  }
}

function setKpi(id, v, unit){
  const node = el(id);
  if(!node || v === null || v === undefined || v === "") return;
  const num = fmtNum(v);
  node.innerHTML = unit === "¥"
    ? "¥" + num
    : num + (unit ? "<span>" + unit + "</span>" : "");
}

function renderDraftBanner(){
  if(document.getElementById("draftBanner")) return;
  const b = document.createElement("div");
  b.id = "draftBanner";
  b.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;"
    + "display:flex;gap:12px;align-items:center;padding:8px 12px;border-radius:8px;"
    + "background:#7C2D12;color:#fff;font-size:12px;box-shadow:0 10px 28px rgba(0,0,0,.28);max-width:92vw";
  b.innerHTML = '<b style="font-weight:600;white-space:nowrap">草稿预览</b>'
    + '<span style="opacity:.85">数据来自配置后台本地草稿，尚未发布</span>';
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "清除草稿";
  btn.style.cssText = "border:0;border-radius:5px;padding:4px 9px;background:#fff;color:#7C2D12;"
    + "font-size:11px;cursor:pointer;white-space:nowrap";
  btn.addEventListener("click", ()=>{
    localStorage.removeItem(DRAFT_KEY);
    location.reload();
  });
  b.appendChild(btn);
  document.body.appendChild(b);
}

function showDataError(){
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;"
    + "background:#F5F7FA;z-index:99999;padding:24px";
  box.innerHTML = '<div style="max-width:560px;border:1px solid #E3E8EF;border-radius:10px;background:#fff;'
    + 'padding:24px;font-size:14px;line-height:1.9;color:#333">'
    + '<h2 style="margin:0 0 10px;font-size:18px;color:#1E3A8A">数据源未加载</h2>'
    + '<p style="margin:0 0 10px">前台没有找到 <code>data/ovem-data.js</code>，页面已停止渲染，避免展示过期数据。</p>'
    + '<p style="margin:0;color:#666">请确认 <code>data/ovem-data.js</code> 与 <code>index.html</code> 在同一目录内；'
    + '或在 <a href="OVEM配置后台.html" style="color:#1E3A8A">配置后台</a> 导出发布包后覆盖该文件。</p>'
    + '</div>';
  document.body.appendChild(box);
}

function applyData(){
  if(!DATA) return;

  /* —— 品牌标识 —— */
  const bn = document.querySelector(".brand-name");
  const bs = document.querySelector(".brand-sub");
  const brand = DATA.brand || {};
  if(bn && brand.name) bn.textContent = brand.name;
  if(bs && brand.sub) bs.innerHTML = escapeHtml(brand.sub) + "<br>" + escapeHtml(brand.sub2 || "");

  /* —— 封面文案 —— */
  const hero = DATA.hero || {};
  const kicker = document.querySelector(".p0-kicker");
  const h1 = document.querySelector(".p0-h1");
  const sub = document.querySelector(".p0-sub");
  const roles = document.querySelector(".p0-roles");
  if(kicker && hero.kicker) kicker.textContent = hero.kicker;
  if(h1 && hero.title) h1.innerHTML = String(hero.title).split("\n").map(t=>escapeHtml(t)).join("<br>");
  if(sub && hero.sub) sub.textContent = hero.sub;
  if(roles && hero.roles && hero.roles.length){
    roles.innerHTML = hero.roles.filter(Boolean).map(r=>"<span>" + escapeHtml(r) + "</span>").join("");
  }
  const edNode = el("kvEdition");
  if(edNode && brand.edition) edNode.textContent = brand.edition;

  /* —— 封面五项指标：带推导来源的按当前数量实时算 —— */
  const metrics = DATA.metrics || [];
  const box = el("p0Metrics");
  if(box && metrics.length){
    box.innerHTML = metrics.map(m =>
      '<div><b class="tnum">' + escapeHtml(derivedMetric(m))
      + (m.unit ? "<em>" + escapeHtml(m.unit) + "</em>" : "")
      + "</b><span>" + escapeHtml(m.label) + "</span></div>"
    ).join("");
  }

  /* —— 年度目标 → P1 四张 KPI 卡 —— */
  const g = DATA.goals || {};
  setKpi("kpiExposure",   g.exposure,   "万");
  setKpi("kpiEngagement", g.engagement, "万");
  setKpi("kpiFirstOrder", g.firstOrder, "万");
  setKpi("kpiCac",        g.cac,        "¥");

  /* —— 上市甘特：数量按批次实际统计，改批次不用再手改文案 —— */
  ["W1","W2","W3"].forEach(w=>{
    const node = el("gant" + w);
    if(node){
      const n = PRODUCTS.filter(p=>p.wave === w).length;
      node.textContent = n + " 款";
    }
  });

  /* —— 页面可见性：导航移除 + DOM 移除（v1 只移导航，内容仍可从源码读到） —— */
  const pagesCfg = DATA.pages || {};
  for(let i = PAGES.length - 1; i >= 0; i--){
    const p = PAGES[i];
    if(pagesCfg[p.id] === false){
      DISABLED_PAGES[p.id] = p.name;
      const sec = document.getElementById("view-" + p.id);
      if(sec) sec.remove();
      PAGES.splice(i, 1);
    }
  }

  /* —— 顶栏计数与数据版本 —— */
  const countChip = el("chipCount");
  if(countChip) countChip.textContent = PRODUCTS.length + " SKU · " + CHANNEL_DATA.length + " 渠道";
  const verChip = el("chipVersion");
  if(verChip && DATA.meta && DATA.meta.version) verChip.textContent = "数据 " + DATA.meta.version;

  /* —— 侧栏页脚：可见页数随配置变化 —— */
  const sideFoot = el("sideFoot");
  if(sideFoot) sideFoot.innerHTML = "2026.11 · 作品样张<br>按当前配置显示 " + PAGES.length + " 页";

  /* —— 草稿态 —— */
  if(IS_DRAFT) renderDraftBanner();

  /* —— 样板产品被停用时回退 —— */
  if(!PRODUCTS.find(p=>p.id === battleId) && PRODUCTS.length) battleId = PRODUCTS[0].id;
}
