/* ============================================================
   OVEM 运行时 · Tools（9 个工具 + mock provider）
   ------------------------------------------------------------
   每个工具返回 { out, usage:{tokens,images}, delayMs }：
     - out     结构化结果，字段符合 data/ovem-agent.js 的 io.out
     - usage   计费口径（token 数与图片张数）
     - delayMs mock 契约延迟，恒定落在 [800, 2400]
   实际等待由执行器按 speed 缩放（自检用 0.12，演示用 1），
   trace 同时记录 delayMs（契约值）与 waitedMs（实际值），不混口径。
   ============================================================ */
window.OVEM_RT = window.OVEM_RT || {};
(function (RT) {
  "use strict";

  var PRICE = { per1kToken: 0.004, perImage: 0.03 };
  var DELAY = { min: 800, max: 2400 };

  var USAGE = {
    "product.get":   { tokens: 600,  images: 0 },
    "brand.recall":  { tokens: 700,  images: 0 },
    "channel.spec":  { tokens: 800,  images: 0 },
    "template.pick": { tokens: 500,  images: 0 },
    "prompt.compile":{ tokens: 1200, images: 0 },
    "image.gen":     { tokens: 800,  images: 3 },
    "qa.check":      { tokens: 900,  images: 0 },
    "copy.write":    { tokens: 900,  images: 0 },
    "artifact.land": { tokens: 300,  images: 0 }
  };

  var RATIOS = {
    c01: { w: 16, h: 9 }, c02: { w: 9, h: 16 }, c03: { w: 1, h: 1 },
    c04: { w: 1, h: 1 },  c05: { w: 9, h: 16 }, c06: { w: 3, h: 4 },
    c07: { w: 1, h: 1 },  c08: { w: 3, h: 4 }
  };

  var BANNED = ["最", "第一", "国家级", "治疗", "治愈", "永久"];
  var BRAND_COLORS = ["#0B1F3A", "#2F6FED", "#F5F7FA"];

  function round2(n) { return Math.round(n * 100) / 100; }

  function create(opt) {
    opt = opt || {};
    var data = opt.data || window.OVEM_DATA || { products: [], channels: [] };
    var agent = opt.agent || window.OVEM_AGENT || { prompts: [], providers: [] };
    var rnd = opt.random || Math.random;
    var products = data.products || [];
    var channels = data.channels || [];

    function productById(id) {
      var p = products.filter(function (x) { return x.id === id; })[0] || products[0];
      if (!p) throw new Error("product.get：产品不存在 " + id);
      return {
        id: p.id, no: p.no, name: p.name, short: p.short, scene: p.scene,
        tier: p.tier, wave: p.wave, price: String(p.price), tags: p.tags || [],
        oneliner: p.oneliner || "", hook: p.hook || "", enabled: p.enabled !== false
      };
    }

    function channelById(id) {
      var idx = channels.findIndex(function (c, i) { return id === "c0" + (i + 1) || c.id === id; });
      if (idx < 0) idx = 0;
      var c = channels[idx];
      var cid = "c0" + (idx + 1);
      return { id: cid, name: c.name, size: c.size, count: Number(c.count) || 0, kpi: c.kpi || "", ratio: RATIOS[cid] || { w: 4, h: 5 } };
    }

    function normalizeChannelIds(args) {
      var ids = (args && args.channelIds) || ["c01", "c02", "c06"];
      return ids.map(channelById);
    }

    var impl = {
      "product.get": function (args) {
        var p = productById(args && args.productId);
        return { out: p, usage: USAGE["product.get"] };
      },

      "brand.recall": function () {
        return {
          out: {
            tone: "克制、具体、不夸张；先说场景再说参数",
            bannedWords: BANNED.slice(),
            colors: BRAND_COLORS.slice(),
            logoRule: "左上安全区 ≥ 48px；禁止压在产品主体上"
          },
          usage: USAGE["brand.recall"]
        };
      },

      "channel.spec": function (args) {
        var list = normalizeChannelIds(args).map(function (c) {
          return { id: c.id, name: c.name, size: c.size, count: c.count, kpi: c.kpi, ratio: c.ratio };
        });
        return { out: { channels: list }, usage: USAGE["channel.spec"] };
      },

      "template.pick": function (args) {
        var list = normalizeChannelIds(args).map(function (c, i) {
          return {
            id: "tpl-" + c.id + "-" + (i + 1),
            name: c.name + " 标准版式",
            channelId: c.id,
            ratio: c.ratio,
            layout: i === 0 ? "左文右图 · 参数压底" : (i === 1 ? "上图下文 · 竖版单列" : "方图 + 三行卖点")
          };
        });
        return { out: { templates: list }, usage: USAGE["template.pick"] };
      },

      "prompt.compile": function (args) {
        var p = productById(args && args.productId);
        var base = (agent.prompts || []).filter(function (x) { return x.id === "prompt.copywriter"; })[0]
          || { id: "prompt.copywriter", version: "v1.0.0", hash: "sha256:" + "0".repeat(64), variables: [] };
        var chs = normalizeChannelIds(args);
        var prompts = chs.map(function (c) {
          return {
            id: "pr-" + c.id + "-" + base.version.replace(/\./g, ""),
            promptId: base.id,
            version: base.version,
            hash: base.hash,
            templateId: "tpl-" + c.id + "-1",
            channelId: c.id,
            body: "为「" + p.short + "」生成 " + c.name + " 素材：" + p.oneliner + "；渠道尺寸 " + c.size + "。",
            variables: (base.variables || []).slice()
          };
        });
        return { out: { prompts: prompts }, usage: USAGE["prompt.compile"] };
      },

      "image.gen": function (args) {
        var prompts = (args && args.prompts) || [];
        if (!prompts.length) throw new Error("image.gen：缺少 prompts");
        var images = prompts.map(function (pr, i) {
          var w = pr.channelId === "c01" ? 1920 : (pr.channelId === "c02" ? 750 : 1080);
          var h = pr.channelId === "c01" ? 1080 : (pr.channelId === "c02" ? 1334 : 1440);
          return {
            id: "img-" + (i + 1) + "-" + pr.channelId,
            channelId: pr.channelId,
            ratio: RATIOS[pr.channelId] || { w: 4, h: 5 },
            w: w, h: h,
            bytes: Math.round((320 + rnd() * 180) * 1024),
            dominant: { c: BRAND_COLORS[0], pct: round2(34 + rnd() * 8) },
            safeAreaPx: 48, logoBoxOk: true
          };
        });
        return { out: { images: images }, usage: USAGE["image.gen"] };
      },

      "qa.check": function (args) {
        var images = (args && args.images) || [];
        var fail = !!(args && args.forceFail);
        var issues = fail ? ["主色占比 33.4% < 阈值 35%"] : [];
        var checks = [
          { name: "ratio", ok: true, detail: images.length + " 张比例与渠道一致" },
          { name: "dominant", ok: !fail, detail: "主色 #0B1F3A 占比 " + (fail ? "33.4%" : "36.2%") },
          { name: "safeArea", ok: true, detail: "安全区 ≥ 48px" },
          { name: "logoBox", ok: true, detail: "Logo 未压主体" }
        ];
        return {
          out: { verdict: fail ? "revise" : "pass", score: fail ? 64 : 86, checks: checks, issues: issues },
          usage: USAGE["qa.check"]
        };
      },

      "copy.write": function (args) {
        var p = productById(args && args.productId);
        var chs = normalizeChannelIds(args);
        var copies = chs.map(function (c) {
          var title = p.short + "｜" + c.name + "版";
          var subtitle = p.oneliner || ("给 " + (p.scene || "家庭") + " 的一套解法");
          var body = (p.hook || "") + " " + (p.diff || "").slice(0, 46);
          return {
            channelId: c.id,
            title: title.slice(0, 14),
            subtitle: subtitle.slice(0, 28),
            body: body.trim().slice(0, 90),
            chars: title.length + subtitle.length + body.trim().length
          };
        });
        return { out: { copies: copies }, usage: USAGE["copy.write"] };
      },

      "artifact.land": function (args) {
        var p = productById(args && args.productId);
        var qa = (args && args.qa) || { verdict: "pass", score: 86, checks: [], issues: [] };
        var copies = (args && args.copies) || [];
        var images = (args && args.images) || [];
        var base = Number(args && args.seqBase) || 1;
        var artifacts = copies.map(function (cp, i) {
          var img = images.filter(function (x) { return x.channelId === cp.channelId; })[0] || images[i] || {};
          return {
            id: "A-" + String(base + i).padStart(4, "0"),
            runId: (args && args.runId) || "",
            kind: "bundle",
            productId: p.id,
            channelId: cp.channelId,
            templateId: "tpl-" + cp.channelId + "-1",
            blobKey: img.id || "",
            meta: { ratio: img.ratio || null, w: img.w || 0, h: img.h || 0, bytes: img.bytes || 0 },
            qa: {
              ratioOk: true, dominant: img.dominant || { c: BRAND_COLORS[0], pct: 36 },
              safeAreaPx: img.safeAreaPx || 48, logoBoxOk: true,
              verdict: qa.verdict, score: qa.score
            },
            promptSnapshot: { promptId: "prompt.copywriter", version: "v1.3.0", hash: "" },
            status: "review"
          };
        });
        return { out: { artifacts: artifacts }, usage: USAGE["artifact.land"] };
      }
    };

    function delayMs() {
      return Math.round(DELAY.min + rnd() * (DELAY.max - DELAY.min));
    }

    function call(id, args, opts) {
      return new Promise(function (resolve, reject) {
        var fn = impl[id];
        if (!fn) { reject(new Error("未注册的工具：" + id)); return; }
        var planned = delayMs();
        var speed = (opts && opts.speed) || 1;
        var wait = Math.max(1, Math.round(planned / speed));
        var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
        setTimeout(function () {
          try {
            var res = fn(args || {});
            var t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
            resolve({
              toolId: id, ok: true, out: res.out, usage: res.usage,
              delayMs: planned, waitedMs: Math.round(t1 - t0), speed: speed
            });
          } catch (e) { reject(e); }
        }, wait);
      });
    }

    return {
      call: call,
      list: function () { return Object.keys(impl); },
      has: function (id) { return !!impl[id]; },
      delayRange: DELAY,
      price: PRICE,
      ratioOf: function (cid) { return RATIOS[cid] || { w: 4, h: 5 }; }
    };
  }

  /* A2-02 用的类型契约：字段名 → 期望类型 */
  var EXPECT = {
    "product.get":   { id: "string", name: "string", price: "string", tier: "string", enabled: "boolean" },
    "brand.recall":  { tone: "string", bannedWords: "array", colors: "array", logoRule: "string" },
    "channel.spec":  { channels: "array" },
    "template.pick": { templates: "array" },
    "prompt.compile":{ prompts: "array" },
    "image.gen":     { images: "array" },
    "qa.check":      { verdict: "string", score: "number", checks: "array" },
    "copy.write":    { copies: "array" },
    "artifact.land": { artifacts: "array" }
  };

  RT.Tools = { create: create, PRICE: PRICE, DELAY: DELAY, USAGE: USAGE, EXPECT: EXPECT };
})(window.OVEM_RT);
