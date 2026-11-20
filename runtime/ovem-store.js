/* ============================================================
   OVEM 运行时 · Store（IndexedDB 封装）
   ------------------------------------------------------------
   库：ovem-os-v3 · version 1 · 6 个 store / 18 个索引
   API：open / info / put / putMany / get / list / clear / count / reset
   零 DOM 依赖；不读写 localStorage（运行态只进 IndexedDB）。
   若环境无 indexedDB，自动降级内存 store，并在 info().mode 标注 memory。
   ============================================================ */
window.OVEM_RT = window.OVEM_RT || {};
(function (RT) {
  "use strict";

  var DB_NAME = "ovem-os-v3";
  var DB_VERSION = 1;

  /* 与路线图 4.5 一一对应：6 store / 18 index */
  var DEFS = {
    missions:  { keyPath: "id", indexes: [["status", "status"], ["createdAt", "createdAt"]] },
    runs:      { keyPath: "id", indexes: [["missionId", "missionId"], ["status", "status"], ["startedAt", "startedAt"]] },
    traces:    { keyPath: "id", indexes: [["runId", "runId"], ["type", "type"], ["ts", "ts"]] },
    artifacts: { keyPath: "id", indexes: [["runId", "runId"], ["productId", "productId"], ["channelId", "channelId"], ["status", "status"]] },
    reviews:   { keyPath: "id", indexes: [["runId", "runId"], ["gate", "gate"], ["decision", "decision"]] },
    evals:     { keyPath: "id", indexes: [["taskId", "taskId"], ["promptVersion", "promptVersion"], ["passed", "passed"]] }
  };

  var dbPromise = null;
  var mode = (typeof indexedDB !== "undefined") ? "idb" : "memory";
  var mem = {};

  function memStore(name) {
    if (!mem[name]) mem[name] = new Map();
    return mem[name];
  }

  function open() {
    if (dbPromise) return dbPromise;
    if (mode === "memory") { dbPromise = Promise.resolve(null); return dbPromise; }
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        Object.keys(DEFS).forEach(function (name) {
          if (db.objectStoreNames.contains(name)) return;
          var st = db.createObjectStore(name, { keyPath: DEFS[name].keyPath });
          DEFS[name].indexes.forEach(function (pair) {
            st.createIndex(pair[0], pair[1], { unique: false });
          });
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("IndexedDB 打开失败")); };
      req.onblocked = function () { reject(new Error("IndexedDB 被其他标签页占用")); };
    });
    return dbPromise;
  }

  function tx(store, mode2, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode2);
        var os = t.objectStore(store);
        var result;
        try { result = fn(os); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error || new Error("事务失败：" + store)); };
        t.onabort = function () { reject(t.error || new Error("事务中止：" + store)); };
      });
    });
  }

  function put(store, obj) {
    if (mode === "memory") { memStore(store).set(obj[DEFS[store].keyPath], obj); return Promise.resolve(obj); }
    return tx(store, "readwrite", function (os) { os.put(obj); return obj; });
  }

  function putMany(store, list) {
    if (!list || !list.length) return Promise.resolve(0);
    if (mode === "memory") { list.forEach(function (o) { memStore(store).set(o[DEFS[store].keyPath], o); }); return Promise.resolve(list.length); }
    return tx(store, "readwrite", function (os) {
      list.forEach(function (o) { os.put(o); });
      return list.length;
    });
  }

  function get(store, key) {
    if (mode === "memory") return Promise.resolve(memStore(store).get(key) || null);
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, "readonly");
        var req = t.objectStore(store).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function list(store, opt) {
    opt = opt || {};
    if (mode === "memory") {
      var arr = Array.from(memStore(store).values());
      if (opt.index && opt.value !== undefined) arr = arr.filter(function (o) { return o[opt.index] === opt.value; });
      return Promise.resolve(arr);
    }
    return open().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, "readonly");
        var os = t.objectStore(store);
        var req = (opt.index && opt.value !== undefined)
          ? os.index(opt.index).getAll(opt.value)
          : os.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function count(store) {
    if (mode === "memory") return Promise.resolve(memStore(store).size);
    return open().then(function (db) {
      if (!db) return 0;
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, "readonly");
        var req = t.objectStore(store).count();
        req.onsuccess = function () { resolve(req.result || 0); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function clear(store) {
    if (mode === "memory") { memStore(store).clear(); return Promise.resolve(true); }
    return tx(store, "readwrite", function (os) { os.clear(); return true; });
  }

  function info() {
    if (mode === "memory") {
      return Promise.resolve({
        mode: "memory", version: 0,
        stores: Object.keys(DEFS).map(function (n) { return { name: n, keyPath: DEFS[n].keyPath, indexes: DEFS[n].indexes.map(function (p) { return p[0]; }) }; }),
        storeCount: Object.keys(DEFS).length,
        indexCount: Object.keys(DEFS).reduce(function (a, n) { return a + DEFS[n].indexes.length; }, 0)
      });
    }
    return open().then(function (db) {
      var stores = Array.from(db.objectStoreNames).map(function (name) {
        var t = db.transaction(name, "readonly");
        var os = t.objectStore(name);
        return { name: name, keyPath: os.keyPath, indexes: Array.from(os.indexNames) };
      });
      return {
        mode: "idb",
        version: db.version,
        stores: stores,
        storeCount: stores.length,
        indexCount: stores.reduce(function (a, s) { return a + s.indexes.length; }, 0)
      };
    });
  }

  function reset() {
    if (mode === "memory") { mem = {}; return Promise.resolve(true); }
    return open().then(function (db) {
      return new Promise(function (resolve) {
        if (db) db.close();
        var req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = function () { dbPromise = null; resolve(true); };
        req.onerror = function () { resolve(false); };
        req.onblocked = function () { dbPromise = null; resolve(false); };
      });
    });
  }

  RT.Store = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    DEFS: DEFS,
    open: open,
    info: info,
    put: put,
    putMany: putMany,
    get: get,
    list: list,
    count: count,
    clear: clear,
    reset: reset,
    mode: function () { return mode; }
  };
})(window.OVEM_RT);
