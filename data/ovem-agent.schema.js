/* ============================================================
   OVEM Agent 字段契约 · v3.0.0
   ------------------------------------------------------------
   与 data/ovem-agent.js 配套：只定义字段形状与跨字段规则，
   不复制配置值。后台第 12 分区、A1 校验脚本、S2 运行时共用本文件。
   7 条规则（R1–R7）与数据层 5 条规则相互独立，互不影响。
   ============================================================ */
window.OVEM_AGENT_SCHEMA = {
  version: "3.0.0",
  source: "data/ovem-agent.js",

  sections: [
    {
      id: "agents", type: "array", target: "agents", title: "Agent 角色",
      desc: "三个角色各管一段：planner 发计划、critic 只裁决、writer 只写文案。工具集必须来自 tools 清单，不能自造。",
      itemFields: [
        { key:"id", label:"Agent ID", type:"text", required:true, unique:true, pattern:"^[a-z][a-z0-9-]{2,}$",
          hint:"kebab-case，例如 content-orchestrator", consumers:["P5","P17"] },
        { key:"name", label:"名称", type:"text", required:true, max:20, consumers:["P5","P17"] },
        { key:"role", label:"角色", type:"select", required:true,
          options:[{v:"planner",label:"planner · 编排"},{v:"critic",label:"critic · 裁决"},{v:"writer",label:"writer · 撰写"}],
          consumers:["P5"] },
        { key:"providerId", label:"模型提供方", type:"select", required:true, optionsFrom:"providers", consumers:["P5","P17"] },
        { key:"enabled", label:"启用", type:"switch", consumers:["P5"] },
        { key:"tools", label:"可用工具", type:"tags", required:true, minItems:1,
          hint:"写工具 id，用顿号分隔；必须是 tools 清单的子集", consumers:["P5","P17"] },
        { key:"promptRef.id", label:"Prompt 引用", type:"text", required:true, hint:"必须是 prompts 中已登记的 id（如 prompt.critic）", consumers:["P5"] },
        { key:"promptRef.version", label:"Prompt 版本", type:"text", required:true, pattern:"^v\\d+\\.\\d+\\.\\d+$",
          hint:"必须与 prompts 中该 id 的 version 一致", consumers:["P5"] },
        { key:"limits.maxSteps", label:"单任务步数上限", type:"number", required:true, min:1, max:12, step:1,
          hint:"不得超过护栏 maxSteps（R6）", consumers:["P5","P17"] },
        { key:"limits.budgetCny", label:"单任务预算（¥）", type:"number", required:true, min:0.01, max:0.3, step:0.01,
          hint:"不得超过护栏 dailyBudgetCny（R6）", consumers:["P5","P17"] },
        { key:"hitl.onBudgetPct", label:"预算闸门阈值", type:"number", required:true, min:0.1, max:1, step:0.05,
          hint:"花到单任务预算的该比例时暂停等人工", consumers:["P5"] },
        { key:"hitl.requireBefore", label:"人工闸门位置", type:"tags", hint:"在这些工具执行前要求人工确认，可留空", consumers:["P5"] },
        { key:"note", label:"职责备注", type:"textarea", rows:2, max:80, consumers:["P5","P17"] }
      ]
    },
    {
      id: "tools", type: "array", target: "tools", title: "工具清单",
      desc: "9 个工具覆盖取数、约束、编译、生成、检查、落库。perm=publish 的工具必须过人工闸门。",
      itemFields: [
        { key:"id", label:"工具 ID", type:"text", required:true, unique:true, pattern:"^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]+)+$",
          hint:"domain.action，例如 image.gen", consumers:["P5","P17"] },
        { key:"name", label:"名称", type:"text", required:true, max:20, consumers:["P5"] },
        { key:"io.in", label:"输入类型", type:"text", required:true, hint:"Product / Constraint / Prompt …", consumers:["P17"] },
        { key:"io.out", label:"输出类型", type:"text", required:true, hint:"Image / Copy / Artifact …", consumers:["P17"] },
        { key:"perm", label:"权限", type:"select", required:true,
          options:[{v:"read",label:"read"},{v:"write",label:"write"},{v:"publish",label:"publish"}],
          consumers:["P5","P17"] },
        { key:"timeoutMs", label:"超时（ms）", type:"number", required:true, min:500, max:5000, step:100, consumers:["P17"] },
        { key:"retry", label:"重试次数", type:"number", required:true, min:0, max:1, step:1,
          hint:"护栏上限 maxRetryPerStep", consumers:["P17"] },
        { key:"mockable", label:"允许 mock", type:"switch", consumers:["P5","P17"] },
        { key:"consumers", label:"消费页面", type:"tags", hint:"哪些页面读它的输出（血缘条用）", consumers:["P5"] },
        { key:"note", label:"实现备注", type:"text", max:60, consumers:["P17"] }
      ]
    },
    {
      id: "prompts", type: "array", target: "prompts", title: "Prompt 版本",
      desc: "只存正文与版本，不内联到代码里。hash 由 body 计算，变量必须与正文占位符完全一致。",
      itemFields: [
        { key:"id", label:"Prompt ID", type:"text", required:true, unique:true, pattern:"^prompt\\.[a-z][a-z0-9-]+$",
          consumers:["P5","P16"] },
        { key:"version", label:"版本", type:"text", required:true, pattern:"^v\\d+\\.\\d+\\.\\d+$", consumers:["P5","P16"] },
        { key:"hash", label:"内容哈希", type:"text", required:true, pattern:"^sha256:[0-9a-f]{64}$",
          hint:"编译期对 body 计算，不手工填", consumers:["P16"] },
        { key:"variables", label:"变量清单", type:"tags", required:true, minItems:1,
          hint:"必须与 {{…}} 占位符一一对应（R5）", consumers:["P5","P16"] },
        { key:"body", label:"Prompt 正文", type:"textarea", rows:8, required:true, max:4000,
          hint:"变量写成 {{product.name}} 形式", consumers:["P5","P16"] }
      ]
    }
  ],

  /* 护栏是对象而非数组：6 项阈值同属一份配置 */
  guardrails: {
    id: "guardrails", type: "object", target: "guardrails", title: "护栏阈值",
    desc: "六项阈值是运行时的硬边界：预算、并发、步数、重试、发布闸门、禁用工具。",
    fields: [
      { key:"dailyBudgetCny", label:"当日总预算（¥）", type:"number", required:true, min:1, max:10000, step:10,
        hint:"超出即拒绝新 Mission", consumers:["P5","P17"] },
      { key:"maxConcurrency", label:"并发 run 上限", type:"number", required:true, min:1, max:8, step:1, consumers:["P17"] },
      { key:"maxSteps", label:"单任务步数上限", type:"number", required:true, min:1, max:20, step:1,
        hint:"所有 Agent 的 limits.maxSteps 不得超过它（R6）", consumers:["P5","P17"] },
      { key:"maxRetryPerStep", label:"单步重试上限", type:"number", required:true, min:0, max:3, step:1, consumers:["P17"] },
      { key:"requireHumanOnPublish", label:"发布前强制人工确认", type:"switch", consumers:["P5","P17"] },
      { key:"bannedTools", label:"禁用工具", type:"tags", hint:"命中即阻断；留空表示不禁用", consumers:["P5","P17"] }
    ]
  },

  /* lineage 用表格渲染：17 页 × 工具多选 */
  lineage: { id:"lineage", type:"map", target:"lineage", title:"页面血缘", desc:"每一页的数据由哪些工具产出。发布前用它推理影响面，前台用它渲染血缘条。" },

  rules: [
    { id:"R1", code:"E_TOOL_DUP", level:"error", msg:"工具 id 必须唯一",
      check(c){
        const seen = {}, dup = [];
        (c.tools || []).forEach(t => { if(t && t.id){ if(seen[t.id]) dup.push(t.id); seen[t.id] = 1; } });
        return { ok: dup.length === 0, detail: dup.length ? "重复：" + dup.join("、") : "9 个工具 id 互不重复" };
      } },
    { id:"R2", code:"E_AGENT_DUP", level:"error", msg:"Agent id 必须唯一",
      check(c){
        const seen = {}, dup = [];
        (c.agents || []).forEach(a => { if(a && a.id){ if(seen[a.id]) dup.push(a.id); seen[a.id] = 1; } });
        return { ok: dup.length === 0, detail: dup.length ? "重复：" + dup.join("、") : "3 个 Agent id 互不重复" };
      } },
    { id:"R3", code:"E_TOOL_UNKNOWN", level:"error", msg:"Agent 引用了不存在的工具",
      check(c){
        const ids = (c.tools || []).map(t => t.id);
        const miss = [];
        (c.agents || []).forEach(a => (a.tools || []).forEach(t => { if(ids.indexOf(t) < 0) miss.push(a.id + " → " + t); }));
        return { ok: miss.length === 0, detail: miss.length ? "未登记：" + miss.join("；") : "全部工具引用命中 tools 清单" };
      } },
    { id:"R4", code:"E_PROMPT_MISS", level:"error", msg:"Prompt 引用未命中",
      check(c){
        const miss = [];
        (c.agents || []).forEach(a => {
          const ref = a.promptRef || {};
          const hit = (c.prompts || []).some(p => p.id === ref.id && p.version === ref.version);
          if(!hit) miss.push(a.id + " → " + (ref.id || "?") + "@" + (ref.version || "?"));
        });
        return { ok: miss.length === 0, detail: miss.length ? "未命中：" + miss.join("；") : "3 条 promptRef 命中同版本 Prompt" };
      } },
    { id:"R5", code:"E_PROMPT_VAR", level:"error", msg:"变量清单与正文占位符不一致",
      check(c){
        const bad = [];
        (c.prompts || []).forEach(p => {
          const inBody = {};
          String(p.body || "").replace(/\{\{([^}]+)\}\}/g, (_, k) => { inBody[k.trim()] = 1; return ""; });
          const declared = {};
          (p.variables || []).forEach(v => { declared[v] = 1; });
          const missing = Object.keys(inBody).filter(k => !declared[k]);
          const extra = Object.keys(declared).filter(k => !inBody[k]);
          if(missing.length || extra.length) bad.push(p.id + (missing.length ? " 缺声明 " + missing.join("/") : "") + (extra.length ? " 多声明 " + extra.join("/") : ""));
        });
        return { ok: bad.length === 0, detail: bad.length ? bad.join("；") : "4 条 Prompt 变量双向一致" };
      } },
    { id:"R6", code:"E_LIMIT_OVER", level:"error", msg:"Agent 单任务上限超过护栏",
      check(c){
        const g = c.guardrails || {}, over = [];
        (c.agents || []).forEach(a => {
          const l = a.limits || {};
          if(Number(l.maxSteps) > Number(g.maxSteps)) over.push(a.id + " maxSteps " + l.maxSteps + " > " + g.maxSteps);
          if(Number(l.budgetCny) > Number(g.dailyBudgetCny)) over.push(a.id + " budget ¥" + l.budgetCny + " > ¥" + g.dailyBudgetCny);
        });
        return { ok: over.length === 0, detail: over.length ? "超限：" + over.join("；") : "3 个 Agent 的步数与预算均在护栏内" };
      } },
    { id:"R7", code:"E_LINEAGE_GAP", level:"error", msg:"页面血缘未覆盖全部页面",
      check(c, pages){
        const ids = (pages || []).map(p => p.id);
        const keys = Object.keys(c.lineage || {});
        const missing = ids.filter(id => keys.indexOf(id) < 0);
        const extra = keys.filter(k => ids.indexOf(k) < 0);
        return { ok: missing.length === 0 && extra.length === 0,
          detail: missing.length ? "缺页：" + missing.join("、") : (extra.length ? "多余：" + extra.join("、") : "17/17 页均有血缘") };
      } }
  ]
};
