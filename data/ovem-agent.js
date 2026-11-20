/* ============================================================
   OVEM Agent 配置 · v3.0.0
   ------------------------------------------------------------
   本文件是 Agent / 工具 / Prompt / 护栏 / 血缘的唯一配置源。
   读取方：OVEM配置后台.html（第 12 分区）、runtime/*（S2 起）、
           tools/verify-agent-config.js（A1 套件）
   约束：壳页与运行时不得内联同名常量；运行态一律走 IndexedDB，
         不回写本文件。Prompt 的 hash 由编译期对 body 计算 SHA-256。
   ============================================================ */
window.OVEM_AGENT = {
  "meta": {
    "version": "v3.0.0",
    "updated": "2026-11-20",
    "owner": "OVEM 配置中台",
    "mode": "published",
    "schema": "data/ovem-agent.schema.js",
    "note": "Agent 层唯一配置源；运行态不写回本文件"
  },
  "providers": [
    {
      "id": "mock-primary",
      "name": "Mock 网关",
      "kind": "mock",
      "enabled": true,
      "pricing": {
        "per1kToken": 0.004,
        "perImage": 0.03
      },
      "note": "演示默认：不产生真实调用与费用"
    },
    {
      "id": "ark-primary",
      "name": "方舟网关（预留）",
      "kind": "http",
      "enabled": false,
      "pricing": {
        "per1kToken": 0.006,
        "perImage": 0.05
      },
      "note": "接入真实模型时启用，由 S2 注入 adapter"
    }
  ],
  "agents": [
    {
      "id": "content-orchestrator",
      "name": "内容编排 Agent",
      "role": "planner",
      "providerId": "mock-primary",
      "enabled": true,
      "tools": [
        "product.get",
        "brand.recall",
        "channel.spec",
        "template.pick",
        "prompt.compile"
      ],
      "limits": {
        "maxSteps": 12,
        "budgetCny": 0.15
      },
      "promptRef": {
        "id": "prompt.orchestrator",
        "version": "v1.2.0"
      },
      "hitl": {
        "requireBefore": [
          "artifact.land"
        ],
        "onBudgetPct": 0.8
      },
      "note": "唯一能发计划的角色；不直接生成图片或文案"
    },
    {
      "id": "content-critic",
      "name": "内容裁决 Agent",
      "role": "critic",
      "providerId": "mock-primary",
      "enabled": true,
      "tools": [
        "qa.check",
        "brand.recall",
        "product.get"
      ],
      "limits": {
        "maxSteps": 6,
        "budgetCny": 0.06
      },
      "promptRef": {
        "id": "prompt.critic",
        "version": "v1.1.0"
      },
      "hitl": {
        "requireBefore": [],
        "onBudgetPct": 0.8
      },
      "note": "只读裁决，不写任何产物；reject 时回传修改点"
    },
    {
      "id": "channel-copywriter",
      "name": "渠道文案 Agent",
      "role": "writer",
      "providerId": "mock-primary",
      "enabled": true,
      "tools": [
        "product.get",
        "channel.spec",
        "prompt.compile",
        "copy.write"
      ],
      "limits": {
        "maxSteps": 8,
        "budgetCny": 0.05
      },
      "promptRef": {
        "id": "prompt.copywriter",
        "version": "v1.3.0"
      },
      "hitl": {
        "requireBefore": [
          "copy.write"
        ],
        "onBudgetPct": 0.8
      },
      "note": "写文案但不落库；落库由编排 Agent 收口"
    }
  ],
  "tools": [
    {
      "id": "product.get",
      "name": "取产品卡",
      "io": {
        "in": "Query",
        "out": "Product"
      },
      "perm": "read",
      "timeoutMs": 800,
      "retry": 0,
      "mockable": true,
      "consumers": [
        "p3",
        "p4",
        "p5",
        "p10",
        "p13",
        "p15"
      ],
      "note": "读 data/ovem-data.js 的 products，不落库"
    },
    {
      "id": "brand.recall",
      "name": "召回品牌约束",
      "io": {
        "in": "Query",
        "out": "Constraint"
      },
      "perm": "read",
      "timeoutMs": 600,
      "retry": 0,
      "mockable": true,
      "consumers": [
        "p2",
        "p4",
        "p16"
      ],
      "note": "品牌语调、禁用词、视觉基线"
    },
    {
      "id": "channel.spec",
      "name": "取渠道规范",
      "io": {
        "in": "Query",
        "out": "Constraint"
      },
      "perm": "read",
      "timeoutMs": 500,
      "retry": 0,
      "mockable": true,
      "consumers": [
        "p0",
        "p1",
        "p6",
        "p7",
        "p8",
        "p14"
      ],
      "note": "尺寸、字数、KPI 口径"
    },
    {
      "id": "template.pick",
      "name": "选模板",
      "io": {
        "in": "Prompt",
        "out": "Template"
      },
      "perm": "read",
      "timeoutMs": 700,
      "retry": 0,
      "mockable": true,
      "consumers": [
        "p5"
      ],
      "note": "按渠道与产品线选版式"
    },
    {
      "id": "prompt.compile",
      "name": "编译 Prompt",
      "io": {
        "in": "Template",
        "out": "Prompt"
      },
      "perm": "read",
      "timeoutMs": 900,
      "retry": 0,
      "mockable": true,
      "consumers": [
        "p5",
        "p12",
        "p16"
      ],
      "note": "变量填充 + 快照 hash"
    },
    {
      "id": "image.gen",
      "name": "生成图片",
      "io": {
        "in": "Prompt",
        "out": "Image"
      },
      "perm": "write",
      "timeoutMs": 5000,
      "retry": 1,
      "mockable": true,
      "consumers": [
        "p4",
        "p5",
        "p7",
        "p8"
      ],
      "note": "演示为 mock 占位图，不产生真实费用"
    },
    {
      "id": "qa.check",
      "name": "合规与一致性检查",
      "io": {
        "in": "Image+Copy",
        "out": "Verdict"
      },
      "perm": "read",
      "timeoutMs": 1200,
      "retry": 0,
      "mockable": true,
      "consumers": [
        "p4",
        "p5",
        "p11"
      ],
      "note": "品牌一致性、尺寸、禁用词、事实一致"
    },
    {
      "id": "copy.write",
      "name": "写渠道文案",
      "io": {
        "in": "Prompt+Constraint",
        "out": "Copy"
      },
      "perm": "write",
      "timeoutMs": 2400,
      "retry": 1,
      "mockable": true,
      "consumers": [
        "p4",
        "p5",
        "p9"
      ],
      "note": "标题/副标题/正文，按渠道字数"
    },
    {
      "id": "artifact.land",
      "name": "落库与发布",
      "io": {
        "in": "Copy+Image",
        "out": "Artifact"
      },
      "perm": "publish",
      "timeoutMs": 1500,
      "retry": 0,
      "mockable": false,
      "consumers": [
        "p4",
        "p5",
        "p7",
        "p8",
        "p9",
        "p11",
        "p13"
      ],
      "note": "写 artifacts store；发布前需人工确认"
    }
  ],
  "prompts": [
    {
      "id": "prompt.orchestrator",
      "version": "v1.2.0",
      "hash": "sha256:b048538df8da424f67b9ad6d51ac26ad161b190748e0e4dd5a7d2aa89cae6517",
      "body": "你是 OVEM 内容编排 Agent（planner）。\n输入：{{product.name}} / {{product.tier}} / {{channel.count}} / {{brand.tone}} / {{guardrail.maxSteps}}\n任务：把一次内容生产拆成 7 个计划步骤，每步只调用一个工具，输出计划 JSON（steps[]）。\n硬约束：\n1) 不得跳步：image.gen 之前必须先完成 prompt.compile；\n2) 任一步返回 blocked 时立即停止后续步骤，把控制权交回人工；\n3) 计划步数不得超过 {{guardrail.maxSteps}}，超限即拒绝编排；\n4) 只使用 agents.tools 中列出的工具，不得自行发明工具名。",
      "variables": [
        "product.name",
        "product.tier",
        "channel.count",
        "brand.tone",
        "guardrail.maxSteps"
      ],
      "changelog": [
        {
          "v": "v1.2.0",
          "at": "2026-11-20",
          "note": "加入 guardrail.maxSteps 变量，步数超限即拒绝编排"
        },
        {
          "v": "v1.1.0",
          "at": "2026-11-19",
          "note": "明确 blocked 交回人工的顺序约束"
        },
        {
          "v": "v1.0.0",
          "at": "2026-11-18",
          "note": "首版：7 步编排骨架"
        }
      ]
    },
    {
      "id": "prompt.critic",
      "version": "v1.1.0",
      "hash": "sha256:d905f18beb2a935ac007be021241433d1b026d5dd5e9dcc5bc2b284831e48609",
      "body": "你是 OVEM 内容裁决 Agent（critic）。\n输入：{{image.prompt}} / {{channel.rule}} / {{brand.tone}}\n逐项判定四件事：品牌一致性、渠道尺寸合规、文案与产品卡事实一致、禁用词命中。\n输出：verdict ∈ pass / revise / reject；reject 必须给出可执行的修改点，revise 必须指出重跑哪一个工具。\n裁决只依据输入证据，不依据主观喜好；无法判定时输出 reject 并说明缺哪份证据。",
      "variables": [
        "image.prompt",
        "channel.rule",
        "brand.tone"
      ],
      "changelog": [
        {
          "v": "v1.1.0",
          "at": "2026-11-20",
          "note": "补「缺证据即 reject」条款，避免无依据放行"
        },
        {
          "v": "v1.0.0",
          "at": "2026-11-18",
          "note": "首版：四项裁决"
        }
      ]
    },
    {
      "id": "prompt.copywriter",
      "version": "v1.3.0",
      "hash": "sha256:bd7d7219e5cc25bc3bac849c3a13814735cf370dedb4c650353b684c005b61f8",
      "body": "你是 OVEM 渠道文案 Agent（writer）。\n输入：{{product.name}} / {{channel.name}} / {{channel.size}} / {{brand.tone}}\n输出：主标题（≤ 14 字）、副标题（≤ 28 字）、正文（≤ 90 字），逐条对齐渠道规范。\n硬约束：\n1) 产品参数只能引用产品卡，不得编造数字或功效；\n2) 不使用绝对化用语与医疗暗示；\n3) 同一产品在不同渠道的卖点顺序保持一致，只调整语气与长度。",
      "variables": [
        "product.name",
        "channel.name",
        "channel.size",
        "brand.tone"
      ],
      "changelog": [
        {
          "v": "v1.3.0",
          "at": "2026-11-20",
          "note": "增加「跨渠道卖点顺序一致」约束"
        },
        {
          "v": "v1.2.0",
          "at": "2026-11-19",
          "note": "字数上限改为渠道 size 推导"
        },
        {
          "v": "v1.0.0",
          "at": "2026-11-18",
          "note": "首版：标题/副标题/正文三段式"
        }
      ]
    },
    {
      "id": "prompt.qa-explainer",
      "version": "v1.0.0",
      "hash": "sha256:431c7cdb33a59177976bf683682a270fbad584bc0eca023c347ea0626a2ac4ba",
      "body": "你是 OVEM 裁决解释器。\n输入：{{verdict.code}} / {{verdict.reason}} / {{brand.rule}}\n输出：60 字以内的中文解释，说明这次为什么通过或不通过，写入 P5 时间线。\n要求：先给结论，再给依据；不复述整段规则，只引用命中的那一条。",
      "variables": [
        "verdict.code",
        "verdict.reason",
        "brand.rule"
      ],
      "changelog": [
        {
          "v": "v1.0.0",
          "at": "2026-11-19",
          "note": "首版：裁决解释，供 P5 时间线"
        }
      ]
    }
  ],
  "lineage": {
    "p0": [
      "product.get",
      "channel.spec"
    ],
    "p1": [
      "product.get",
      "channel.spec"
    ],
    "p2": [
      "brand.recall"
    ],
    "p3": [
      "product.get"
    ],
    "p4": [
      "product.get",
      "copy.write",
      "image.gen",
      "artifact.land"
    ],
    "p5": [
      "template.pick",
      "prompt.compile",
      "image.gen",
      "qa.check",
      "copy.write"
    ],
    "p6": [
      "product.get",
      "channel.spec"
    ],
    "p7": [
      "channel.spec",
      "artifact.land"
    ],
    "p8": [
      "channel.spec",
      "artifact.land"
    ],
    "p9": [
      "copy.write",
      "artifact.land"
    ],
    "p10": [
      "product.get"
    ],
    "p11": [
      "qa.check",
      "artifact.land"
    ],
    "p12": [
      "prompt.compile"
    ],
    "p13": [
      "product.get",
      "artifact.land"
    ],
    "p14": [
      "product.get",
      "channel.spec"
    ],
    "p15": [
      "product.get"
    ],
    "p16": [
      "prompt.compile"
    ]
  },
  "guardrails": {
    "dailyBudgetCny": 300,
    "maxConcurrency": 2,
    "maxSteps": 12,
    "maxRetryPerStep": 1,
    "requireHumanOnPublish": true,
    "bannedTools": []
  }
};
