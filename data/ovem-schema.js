/* ============================================================
   OVEM 配置字段契约 · v2.0
   ------------------------------------------------------------
   这个文件定义「系统里有哪些可配置字段、每个字段什么类型、什么约束、
   影响前台哪一页」。配置后台用它自动渲染表单 + 校验 + 影响面分析；
   字段增删只改这里，不改后台代码。
   ============================================================ */
window.OVEM_SCHEMA = {
  version: "2.0.0",
  updated: "2026-11-20",

  /* 页面清单：后台「页面与导航」用，同时用于影响面分析 */
  pages: [
    { id: "p0",  no: "P0",  name: "系统总览",     group: "概览", desc: "封面 KV、五项指标、三重能力入口" },
    { id: "p1",  no: "P1",  name: "作战室",       group: "概览", desc: "年度目标、预算、节奏、漏斗" },
    { id: "p2",  no: "P2",  name: "品牌资产中枢", group: "资产", desc: "色卡、字体、Logo 安全区、图库" },
    { id: "p3",  no: "P3",  name: "产品矩阵",     group: "资产", desc: "20 款产品按场景 / 梯队 / 批次筛选" },
    { id: "p4",  no: "P4",  name: "单品作战页",   group: "生产", desc: "单品三层信息 + 全物料包" },
    { id: "p5",  no: "P5",  name: "AI 内容工厂",  group: "生产", desc: "Brief → 模板 → 生成与质检" },
    { id: "p6",  no: "P6",  name: "产能地图",     group: "生产", desc: "20×8 热力矩阵与工时对比" },
    { id: "p7",  no: "P7",  name: "全渠道分发",   group: "分发", desc: "8 渠道规范、尺寸与已入库" },
    { id: "p8",  no: "P8",  name: "智能投放",     group: "分发", desc: "素材 A/B、预算分配、归因" },
    { id: "p9",  no: "P9",  name: "私域旅程",     group: "分发", desc: "五段旅程 + 自动化 SOP" },
    { id: "p10", no: "P10", name: "产品线规划",   group: "经营", desc: "梯队金字塔、上市甘特、组合逻辑" },
    { id: "p11", no: "P11", name: "复盘沉淀",     group: "经营", desc: "月度复盘、SOP 库、迭代建议" },
    { id: "p12", no: "P12", name: "系统 PRD",     group: "经营", desc: "画像、需求池、功能树、埋点" },
    { id: "p13", no: "P13", name: "单品入口页",   group: "扩展", desc: "单品落地页入口" },
    { id: "p14", no: "P14", name: "品类机会",     group: "扩展", desc: "场景覆盖缺口与下一批建议" },
    { id: "p15", no: "P15", name: "定价与成本",   group: "扩展", desc: "价格梯队与成本结构" },
    { id: "p16", no: "P16", name: "AI 方法论",    group: "扩展", desc: "8 阶段 SOP 与工具链" }
  ],

  /* 配置分区：后台左侧导航按这个顺序生成 */
  sections: [
    {
      id: "brand", title: "品牌与标识", target: "brand", type: "object",
      desc: "侧栏品牌块、顶栏与封面共用这一套字段。",
      fields: [
        { key: "name",    label: "品牌缩写", type: "text", required: true, max: 12, hint: "出现在侧栏与顶栏，建议 ≤6 字符", consumers: ["P0 封面", "全局侧栏", "顶栏计数区"] },
        { key: "sub",     label: "英文名",   type: "text", required: true, max: 40, hint: "侧栏第二行", consumers: ["全局侧栏"] },
        { key: "sub2",    label: "业务线",   type: "text", max: 24, hint: "侧栏第三行，可留空", consumers: ["全局侧栏"] },
        { key: "full",    label: "品牌全称", type: "text", required: true, max: 16, hint: "封面副标与文案拼装", consumers: ["P0 封面", "P12 PRD"] },
        { key: "edition", label: "版本年份", type: "text", max: 24, hint: "封面图注年份", consumers: ["P0 封面图注"] }
      ]
    },
    {
      id: "hero", title: "封面文案", target: "hero", type: "object",
      desc: "P0 深色封面带的三段文字与身份标签。",
      fields: [
        { key: "kicker", label: "眉标",   type: "text", max: 80, hint: "建议保留署名与时间", consumers: ["P0 封面"] },
        { key: "title",  label: "主标",   type: "textarea", required: true, max: 40, rows: 2, hint: "换行即控制分行，建议 2 行内", consumers: ["P0 封面"] },
        { key: "sub",    label: "副标",   type: "textarea", max: 100, rows: 2, hint: "一句话讲清品牌 + 规模", consumers: ["P0 封面"] },
        { key: "roles",  label: "身份标签", type: "tags", maxItems: 3, required: true, hint: "最多 3 个，用顿号或逗号分隔", consumers: ["P0 封面"] }
      ]
    },
    {
      id: "metrics", title: "封面指标", target: "metrics", type: "array",
      desc: "P0 封面底部数据条。带推导来源的指标会按当前启用数量自动计算。",
      minItems: 3, maxItems: 6,
      itemFields: [
        { key: "label", label: "指标名", type: "text", required: true, max: 14, consumers: ["P0 封面"] },
        { key: "v",     label: "数值",   type: "number", required: true, min: 0, step: 1, consumers: ["P0 封面"] },
        { key: "unit",  label: "单位",   type: "text", max: 4, hint: "如 % / 万 / 空", consumers: ["P0 封面"] },
        { key: "derive", label: "推导来源", type: "select", options: [
          { v: "", label: "手工填写" },
          { v: "products", label: "启用产品数" },
          { v: "channels", label: "启用渠道数" },
          { v: "slots", label: "产品×渠道 物料位" },
          { v: "variants", label: "物料位×3 变体" }
        ], hint: "选自动推导后，数值随产品与渠道启用数实时变化", consumers: ["P0 封面"] }
      ]
    },
    {
      id: "goals", title: "年度目标", target: "goals", type: "object",
      desc: "P1 作战室顶部四张 KPI 卡的目标口径。",
      fields: [
        { key: "exposure",   label: "年度曝光目标", type: "number", required: true, min: 0, unit: "万", consumers: ["P1 作战室 KPI"] },
        { key: "engagement", label: "内容互动",     type: "number", required: true, min: 0, unit: "万", consumers: ["P1 作战室 KPI"] },
        { key: "firstOrder", label: "首购单量",     type: "number", required: true, min: 0, unit: "万", consumers: ["P1 作战室 KPI"] },
        { key: "cac",        label: "获客成本",     type: "number", required: true, min: 0, unit: "元", consumers: ["P1 作战室 KPI"] },
        { key: "budget",     label: "年度预算",     type: "number", min: 0, unit: "万", consumers: ["P1 预算分配"] }
      ]
    },
    {
      id: "channels", title: "渠道矩阵", target: "channels", type: "array",
      desc: "8 个内容渠道的规范、物料条数、KPI 与更新节奏。停用后从前台渠道页、产能矩阵与内容工厂下拉同步移除。",
      minItems: 1,
      itemFields: [
        { key: "name",    label: "渠道名",   type: "text", required: true, max: 8, unique: true, consumers: ["P7 渠道页", "P6 产能矩阵", "P5 渠道下拉", "P8 投放"] },
        { key: "img",     label: "规范图",   type: "select", options: [
          { v: "ch-doc.jpg", label: "官网" }, { v: "ch-mobile.jpg", label: "移动端" },
          { v: "ch-crm.jpg", label: "私域" }, { v: "ch-shop.jpg", label: "电商" },
          { v: "ch-live.jpg", label: "直播" }, { v: "ch-social.jpg", label: "社媒" },
          { v: "ch-ad.jpg", label: "投放" }, { v: "ch-offline.jpg", label: "线下" }
        ], required: true, consumers: ["P7 渠道页大图"] },
        { key: "caption", label: "图注",     type: "text", max: 30, consumers: ["P7 渠道页大图"] },
        { key: "size",    label: "尺寸规格", type: "text", max: 40, consumers: ["P7 渠道页规格"] },
        { key: "count",   label: "已入库条数", type: "number", min: 0, step: 1, consumers: ["P7 渠道页", "P6 产能矩阵"] },
        { key: "kpi",     label: "核心 KPI", type: "text", max: 24, consumers: ["P7 渠道页"] },
        { key: "cycle",   label: "更新节奏", type: "select", options: [
          { v: "日更", label: "日更" }, { v: "每日", label: "每日" },
          { v: "周更", label: "周更" }, { v: "双周", label: "双周" },
          { v: "三日一换", label: "三日一换" }, { v: "月更", label: "月更" }
        ], consumers: ["P7 渠道页"] },
        { key: "rule",    label: "渠道规范", type: "textarea", rows: 2, max: 120, hint: "一句话讲清这条渠道的硬约束", consumers: ["P7 渠道页"] },
        { key: "tpl",     label: "默认模板序号", type: "number", min: 0, max: 5, step: 1, hint: "对应 P5 的 6 套 Prompt 模板，切渠道时自动高亮", consumers: ["P5 模板高亮"] },
        { key: "enabled", label: "启用",     type: "switch", consumers: ["P7", "P6", "P5", "P8"] }
      ]
    },
    {
      id: "products", title: "产品矩阵", target: "products", type: "array",
      desc: "20 款产品的完整字段。这里是产品语言的唯一来源：矩阵卡、作战页、内容工厂 Brief、定价页都读它。",
      minItems: 1,
      itemFields: [
        { key: "name",     label: "产品名",   type: "text", required: true, max: 20, consumers: ["P3", "P4", "P5", "P13"] },
        { key: "short",    label: "简称",     type: "text", required: true, max: 8, consumers: ["P3 卡片标签", "P4 物料名"] },
        { key: "scene",    label: "场景",     type: "select", required: true, options: [
          { v: "厨房", label: "厨房" }, { v: "客厅", label: "客厅" }, { v: "卧室", label: "卧室" },
          { v: "卫浴个护", label: "卫浴个护" }, { v: "阳台玄关", label: "阳台玄关" },
          { v: "出行宠物", label: "出行宠物" }, { v: "收纳", label: "收纳" }
        ], consumers: ["P3 场景筛选", "P10 场景分布", "P14 机会缺口"] },
        { key: "tier",     label: "梯队",     type: "select", required: true, options: [
          { v: "引流", label: "引流" }, { v: "主力", label: "主力" }, { v: "旗舰", label: "旗舰" }
        ], consumers: ["P3 梯队筛选", "P10 金字塔", "P15 定价带"] },
        { key: "wave",     label: "上市批次", type: "select", required: true, options: [
          { v: "W1", label: "W1 一期" }, { v: "W2", label: "W2 二期" }, { v: "W3", label: "W3 三期" }
        ], consumers: ["P1 上市甘特", "P3 批次筛选", "P10 甘特"] },
        { key: "price",    label: "价格",     type: "text", required: true, pattern: "^\\d{1,3}(,\\d{3})*$", hint: "只填数字，千分位用逗号，如 4,999", consumers: ["P3 卡片", "P15 定价带", "P4 参数区"] },
        { key: "oneliner", label: "一句话卖点", type: "text", required: true, max: 30, consumers: ["P3 卡片", "P4 首层信息", "P13 入口页"] },
        { key: "hook",     label: "传播钩子", type: "text", max: 40, hint: "短视频与社媒的情绪入口，不填则回退一句话卖点", consumers: ["P5 文案生成", "P4 首层信息"] },
        { key: "tags",     label: "能力标签", type: "tags", minItems: 3, maxItems: 3, required: true, hint: "固定 3 个，用于 P4 证据层与脚本分镜", consumers: ["P3 悬停", "P4 证据层", "P5 口播脚本"] },
        { key: "pain",     label: "用户痛点", type: "textarea", rows: 2, required: true, max: 80, consumers: ["P4 第二层", "P5 文案生成"] },
        { key: "diff",     label: "差异化",   type: "textarea", rows: 2, required: true, max: 120, consumers: ["P4 第二层", "P5 口播脚本"] },
        { key: "audience", label: "目标人群", type: "textarea", rows: 2, required: true, max: 60, consumers: ["P4 第二层", "P5 Brief 默认值"] },
        { key: "enabled",  label: "启用",     type: "switch", consumers: ["P3", "P4", "P5", "P6", "P13"] }
      ]
    },
    {
      id: "meta", title: "版本信息", target: "meta", type: "object",
      desc: "发布时自动写入，不需要手改。",
      fields: [
        { key: "version", label: "配置版本", type: "text", required: true, max: 16, hint: "建议 v2.0.1 递增", consumers: ["顶栏版本标记"] },
        { key: "note",    label: "版本说明", type: "text", max: 60, consumers: ["顶栏版本标记"] }
      ]
    }
  ],

  /* 跨字段规则：单字段校验管不到的整体约束 */
  rules: [
    { id: "products.enabled",  level: "error", msg: "至少要有 1 款产品处于启用状态",
      test: d => (d.products || []).filter(p => p.enabled !== false).length >= 1 },
    { id: "channels.enabled",  level: "error", msg: "至少要有 1 个渠道处于启用状态",
      test: d => (d.channels || []).filter(c => c.enabled !== false).length >= 1 },
    { id: "pages.p0",          level: "error", msg: "P0 系统总览必须保持可见（它是演示入口）",
      test: d => !d.pages || d.pages.p0 !== false },
    { id: "products.unique",   level: "error", msg: "产品 id 不能重复",
      test: d => { const ids = (d.products || []).map(p => p.id); return ids.length === new Set(ids).size; } },
    { id: "channels.unique",   level: "error", msg: "渠道名不能重复",
      test: d => { const ns = (d.channels || []).map(c => c.name); return ns.length === new Set(ns).size; } }
  ]
};
