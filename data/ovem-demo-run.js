/* ============================================================
   OVEM P0 · GitHub Pages 静态演示数据
   ------------------------------------------------------------
   只用于没有 Node/SQLite 服务端的静态托管环境（如 GitHub Pages）。
   数据取自 B3 本地演示 run R-0012；P0 Agent 卡使用 stats / plan，
   P4 / P7 / P0 摘要使用同一组演示 artifacts（不伪造真实图片文件）。
   不是实时数据，也不代表真实调用。服务端可用时不会被优先使用。
   ============================================================ */
window.OVEM_DEMO_RUN = {
  id: "R-0012",
  missionId: "M-261120-03",
  agentId: "content-orchestrator",
  status: "review",
  mode: "live",
  startedAt: "2026-11-20T12:00:02.000Z",
  endedAt: "2026-11-20T12:00:20.000Z",
  stats: {
    steps: 7,
    toolCalls: 9,
    retries: 0,
    tokens: 2960,
    images: 3,
    costCny: 0.1018,
    durationMs: 18455
  },
  plan: {
    steps: [
      { no: 1, id: "s1", label: "取产品卡" },
      { no: 2, id: "s2", label: "召回品牌与渠道约束" },
      { no: 3, id: "s3", label: "选版式" },
      { no: 4, id: "s4", label: "编译 Prompt" },
      { no: 5, id: "s5", label: "生成图片" },
      { no: 6, id: "s6", label: "质检裁决" },
      { no: 7, id: "s7", label: "写文案并落库" }
    ]
  },
  artifacts: [
    {
      id: "A-0012-01", runId: "R-0012", channelId: "c01", productId: "P-07",
      kind: "image", status: "review", meta: { ratio: { w: 16, h: 9 } }, qa: { score: 92 }
    },
    {
      id: "A-0012-02", runId: "R-0012", channelId: "c02", productId: "P-07",
      kind: "image", status: "review", meta: { ratio: { w: 9, h: 16 } }, qa: { score: 90 }
    },
    {
      id: "A-0012-03", runId: "R-0012", channelId: "c06", productId: "P-07",
      kind: "image", status: "review", meta: { ratio: { w: 3, h: 4 } }, qa: { score: 88 }
    }
  ],
  _staticNote: "GitHub Pages 静态演示数据，非实时服务端记录"
};
