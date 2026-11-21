// tests/core-foundation.test.ts
import assert from "node:assert/strict";
import path2 from "node:path";
import test from "node:test";

// src/core/schema/fieldSchema.ts
function defaultForSchema(schema) {
  switch (schema.type) {
    case "number":
    case "boolean":
    case "string":
    case "color":
    case "enum":
      return schema.default;
    case "vec2":
    case "vec3":
    case "vec4":
      return [...schema.default];
    case "texture":
    case "ref":
      return schema.default ?? null;
    case "list":
      return schema.default ? structuredClone(schema.default) : [];
    case "object": {
      const out = {};
      for (const [key, child] of Object.entries(schema.fields)) {
        out[key] = defaultForSchema(child);
      }
      return out;
    }
  }
}
function normalizeBySchema(schema, raw, options) {
  const clampNumbers = options?.clampNumbers ?? true;
  switch (schema.type) {
    case "number": {
      const num = typeof raw === "number" && Number.isFinite(raw) ? raw : schema.default;
      if (!clampNumbers) return num;
      let next = num;
      if (schema.min !== void 0) next = Math.max(schema.min, next);
      if (schema.max !== void 0) next = Math.min(schema.max, next);
      return next;
    }
    case "boolean":
      return typeof raw === "boolean" ? raw : schema.default;
    case "string":
      return typeof raw === "string" ? raw : schema.default;
    case "color":
      return typeof raw === "string" && /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : schema.default;
    case "vec2":
    case "vec3":
    case "vec4": {
      const len = schema.type === "vec2" ? 2 : schema.type === "vec3" ? 3 : 4;
      if (!Array.isArray(raw)) return [...schema.default];
      const out = [];
      for (let i = 0; i < len; i += 1) {
        const v = raw[i];
        out.push(typeof v === "number" && Number.isFinite(v) ? v : schema.default[i]);
      }
      return out;
    }
    case "enum": {
      if (typeof raw === "string" && schema.options.some((opt) => opt.value === raw)) {
        return raw;
      }
      return schema.default;
    }
    case "texture":
    case "ref":
      return typeof raw === "string" && raw.length > 0 ? raw : null;
    case "list": {
      if (!Array.isArray(raw)) return defaultForSchema(schema);
      return raw.map((entry) => normalizeBySchema(schema.item, entry, options));
    }
    case "object": {
      const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const out = {};
      for (const [key, child] of Object.entries(schema.fields)) {
        out[key] = normalizeBySchema(child, src[key], options);
      }
      return out;
    }
  }
}
function validateBySchema(schema, raw, path3 = "") {
  const issues = [];
  const value = validateInner(schema, raw, path3, issues);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value };
}
function validateInner(schema, raw, path3, issues) {
  const loc = path3 || "(root)";
  switch (schema.type) {
    case "number": {
      if (raw === void 0) return schema.default;
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        issues.push({
          path: loc,
          message: `${schema.label} \u5FC5\u987B\u662F\u6709\u6548\u6570\u5B57`,
          hint: `\u8BF7\u4F20\u5165\u6570\u5B57${schema.min !== void 0 || schema.max !== void 0 ? `\uFF08\u8303\u56F4 ${schema.min ?? "-\u221E"} ~ ${schema.max ?? "+\u221E"}\uFF09` : ""}`
        });
        return schema.default;
      }
      if (schema.min !== void 0 && raw < schema.min) {
        issues.push({
          path: loc,
          message: `${schema.label} \u4E0D\u80FD\u5C0F\u4E8E ${schema.min}\uFF08\u5F53\u524D\u4E3A ${raw}\uFF09`,
          hint: `\u8BF7\u8C03\u6574\u5230 ${schema.min} \u4EE5\u4E0A`
        });
      }
      if (schema.max !== void 0 && raw > schema.max) {
        issues.push({
          path: loc,
          message: `${schema.label} \u4E0D\u80FD\u5927\u4E8E ${schema.max}\uFF08\u5F53\u524D\u4E3A ${raw}\uFF09`,
          hint: `\u8BF7\u8C03\u6574\u5230 ${schema.max} \u4EE5\u4E0B`
        });
      }
      return raw;
    }
    case "boolean": {
      if (raw === void 0) return schema.default;
      if (typeof raw !== "boolean") {
        issues.push({ path: loc, message: `${schema.label} \u5FC5\u987B\u662F\u5E03\u5C14\u503C`, hint: "\u8BF7\u4F20\u5165 true \u6216 false" });
        return schema.default;
      }
      return raw;
    }
    case "string": {
      if (raw === void 0) return schema.default;
      if (typeof raw !== "string") {
        issues.push({ path: loc, message: `${schema.label} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32` });
        return schema.default;
      }
      if (schema.minLength !== void 0 && raw.length < schema.minLength) {
        issues.push({ path: loc, message: `${schema.label} \u957F\u5EA6\u4E0D\u80FD\u5C11\u4E8E ${schema.minLength}` });
      }
      if (schema.maxLength !== void 0 && raw.length > schema.maxLength) {
        issues.push({ path: loc, message: `${schema.label} \u957F\u5EA6\u4E0D\u80FD\u8D85\u8FC7 ${schema.maxLength}` });
      }
      return raw;
    }
    case "color": {
      if (raw === void 0) return schema.default;
      if (typeof raw !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(raw)) {
        issues.push({ path: loc, message: `${schema.label} \u5FC5\u987B\u662F\u5341\u516D\u8FDB\u5236\u989C\u8272\u503C`, hint: "\u683C\u5F0F\u5982 #ff5a1e" });
        return schema.default;
      }
      return raw;
    }
    case "vec2":
    case "vec3":
    case "vec4": {
      if (raw === void 0) return [...schema.default];
      const expected = schema.type === "vec2" ? 2 : schema.type === "vec3" ? 3 : 4;
      if (!Array.isArray(raw) || raw.length !== expected || raw.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
        issues.push({
          path: loc,
          message: `${schema.label} \u5FC5\u987B\u662F\u957F\u5EA6\u4E3A ${expected} \u7684\u6570\u5B57\u6570\u7EC4`,
          hint: `\u793A\u4F8B\uFF1A${JSON.stringify(schema.default)}`
        });
        return [...schema.default];
      }
      return [...raw];
    }
    case "enum": {
      if (raw === void 0) return schema.default;
      if (typeof raw !== "string" || !schema.options.some((opt) => opt.value === raw)) {
        const allowed = schema.options.map((o) => o.value).join(", ");
        issues.push({
          path: loc,
          message: `${schema.label} \u7684\u503C "${String(raw)}" \u4E0D\u5728\u53EF\u9009\u8303\u56F4\u5185`,
          hint: `\u53EF\u9009\u503C\uFF1A${allowed}`
        });
        return schema.default;
      }
      return raw;
    }
    case "texture":
    case "ref": {
      if (raw === void 0) {
        if (schema.type === "ref" && schema.required && !schema.default) {
          issues.push({ path: loc, message: `${schema.label} \u4E0D\u80FD\u4E3A\u7A7A` });
        }
        return schema.default ?? null;
      }
      if (raw === null) {
        if (schema.type === "ref" && schema.required) {
          issues.push({ path: loc, message: `${schema.label} \u4E0D\u80FD\u4E3A\u7A7A` });
        }
        return null;
      }
      if (typeof raw !== "string" || raw.length === 0) {
        issues.push({ path: loc, message: `${schema.label} \u5FC5\u987B\u662F\u6709\u6548\u5F15\u7528 ID \u6216 null` });
        return null;
      }
      return raw;
    }
    case "list": {
      if (raw === void 0) return defaultForSchema(schema);
      if (!Array.isArray(raw)) {
        issues.push({ path: loc, message: `${schema.label} \u5FC5\u987B\u662F\u6570\u7EC4` });
        return [];
      }
      if (schema.minItems !== void 0 && raw.length < schema.minItems) {
        issues.push({ path: loc, message: `${schema.label} \u81F3\u5C11\u9700\u8981 ${schema.minItems} \u9879` });
      }
      if (schema.maxItems !== void 0 && raw.length > schema.maxItems) {
        issues.push({ path: loc, message: `${schema.label} \u6700\u591A\u5141\u8BB8 ${schema.maxItems} \u9879` });
      }
      return raw.map((item, idx) => validateInner(schema.item, item, `${path3}[${idx}]`, issues));
    }
    case "object": {
      if (raw !== void 0 && (raw === null || typeof raw !== "object" || Array.isArray(raw))) {
        issues.push({ path: loc, message: `${schema.label ?? loc} \u5FC5\u987B\u662F\u5BF9\u8C61` });
        return defaultForSchema(schema);
      }
      const src = raw ?? {};
      const out = {};
      for (const [key, child] of Object.entries(schema.fields)) {
        if (child.optional && src[key] === void 0) {
          continue;
        }
        const nextPath = path3 ? `${path3}.${key}` : key;
        out[key] = validateInner(child, src[key], nextPath, issues);
      }
      return out;
    }
  }
}
function fieldSchemaToJsonSchema(schema) {
  const desc = schema.description ? `${schema.label ?? ""}\uFF1A${schema.description}` : schema.label;
  switch (schema.type) {
    case "number":
      return {
        type: "number",
        description: desc,
        default: schema.default,
        ...schema.min !== void 0 ? { minimum: schema.min } : {},
        ...schema.max !== void 0 ? { maximum: schema.max } : {}
      };
    case "boolean":
      return { type: "boolean", description: desc, default: schema.default };
    case "string":
      return {
        type: "string",
        description: desc,
        default: schema.default,
        ...schema.minLength !== void 0 ? { minLength: schema.minLength } : {},
        ...schema.maxLength !== void 0 ? { maxLength: schema.maxLength } : {}
      };
    case "color":
      return { type: "string", description: `${desc}\uFF08\u5341\u516D\u8FDB\u5236\u989C\u8272\u5982 #ffffff\uFF09`, default: schema.default };
    case "vec2":
    case "vec3":
    case "vec4": {
      const len = schema.type === "vec2" ? 2 : schema.type === "vec3" ? 3 : 4;
      return {
        type: "array",
        description: desc,
        items: { type: "number" },
        minItems: len,
        maxItems: len,
        default: [...schema.default]
      };
    }
    case "enum":
      return {
        type: "string",
        description: `${desc}\uFF08${schema.options.map((o) => `${o.value}:${o.label}`).join("\uFF0C")}\uFF09`,
        enum: schema.options.map((o) => o.value),
        default: schema.default
      };
    case "texture":
      return { type: ["string", "null"], description: `${desc}\uFF08\u8D34\u56FE\u8D44\u4EA7 ID\uFF09`, default: schema.default ?? null };
    case "ref":
      return {
        type: schema.required ? "string" : ["string", "null"],
        description: `${desc}\uFF08\u5F15\u7528\u76EE\u6807\uFF1A${schema.target}${schema.kinds?.length ? `\uFF0C\u79CD\u7C7B\uFF1A${schema.kinds.join("/")}` : ""}\uFF09`
      };
    case "list":
      return {
        type: "array",
        description: desc,
        items: fieldSchemaToJsonSchema(schema.item)
      };
    case "object": {
      const properties = {};
      const required = [];
      for (const [key, child] of Object.entries(schema.fields)) {
        properties[key] = fieldSchemaToJsonSchema(child);
        if (!child.optional && child.type === "ref" && child.required) {
          required.push(key);
        }
      }
      return {
        type: "object",
        ...desc ? { description: desc } : {},
        properties,
        ...required.length > 0 ? { required } : {},
        additionalProperties: false
      };
    }
  }
}

// src/core/commands/bus.ts
var DEFAULT_ADAPTER = {
  isPlaying: () => false,
  captureSnapshot: () => null,
  restoreSnapshot: () => {
  }
};
var CommandBus = class {
  commands = /* @__PURE__ */ new Map();
  txStack = [];
  logs = [];
  adapter = DEFAULT_ADAPTER;
  seq = 0;
  setAdapter(adapter) {
    this.adapter = adapter;
  }
  register(def) {
    this.commands.set(def.id, def);
    return () => {
      if (this.commands.get(def.id) === def) {
        this.commands.delete(def.id);
      }
    };
  }
  unregister(id) {
    this.commands.delete(id);
  }
  get(id) {
    return this.commands.get(id);
  }
  list() {
    return Array.from(this.commands.values()).map((cmd) => ({
      id: cmd.id,
      title: cmd.title,
      description: cmd.description,
      params: cmd.params,
      risk: cmd.risk,
      mutatesDocument: cmd.mutatesDocument ?? true
    }));
  }
  getLogs(limit = 100) {
    if (this.logs.length <= limit) return [...this.logs];
    return this.logs.slice(this.logs.length - limit);
  }
  clearLogs() {
    this.logs.length = 0;
  }
  hasActiveTransaction() {
    return this.txStack.length > 0;
  }
  beginTransaction(label) {
    this.seq += 1;
    const tx = {
      id: `tx_${this.seq}`,
      label,
      beforeSnapshot: this.adapter.captureSnapshot(),
      fileBackups: /* @__PURE__ */ new Map(),
      changes: []
    };
    this.txStack.push(tx);
    return tx.id;
  }
  commitTransaction() {
    const tx = this.txStack.pop();
    if (!tx) return {};
    const merged = mergeChanges(tx.changes);
    if (this.txStack.length > 0) {
      const parent = this.txStack[this.txStack.length - 1];
      parent.changes.push(merged);
      for (const [path3, content] of tx.fileBackups) {
        if (!parent.fileBackups.has(path3)) {
          parent.fileBackups.set(path3, content);
        }
      }
    } else if (hasAnyChange(merged)) {
      this.adapter.commitUndoStep?.(tx.label, tx.beforeSnapshot);
    }
    return merged;
  }
  async rollbackTransaction() {
    const tx = this.txStack.pop();
    if (!tx) return;
    this.adapter.restoreSnapshot(tx.beforeSnapshot);
    if (tx.fileBackups.size > 0 && this.adapter.restoreFiles) {
      const entries = [];
      for (const [relativePath, previousContent] of tx.fileBackups) {
        entries.push({ relativePath, previousContent });
      }
      await this.adapter.restoreFiles(entries);
    }
  }
  async dispatch(commandId, rawParams = {}) {
    const started = performance.now();
    const cmd = this.commands.get(commandId);
    if (!cmd) {
      return this.recordLog(commandId, rawParams, started, {
        ok: false,
        code: "command.notFound",
        message: `\u672A\u627E\u5230\u6307\u4EE4 "${commandId}"`,
        hint: "\u8BF7\u5148\u8C03\u7528\u5DE5\u5177\u6E05\u5355\u786E\u8BA4\u53EF\u7528\u7684\u6307\u4EE4 ID"
      });
    }
    const mutates = cmd.mutatesDocument ?? true;
    if (mutates && this.adapter.isPlaying()) {
      return this.recordLog(commandId, rawParams, started, {
        ok: false,
        code: "play.locked",
        message: `\u8BD5\u73A9\u8FDB\u884C\u4E2D\uFF0C\u7981\u6B62\u6267\u884C\u4FEE\u6539\u5DE5\u7A0B\u7684\u6307\u4EE4 "${commandId}"`,
        hint: "\u8BF7\u5148\u505C\u6B62\u8BD5\u73A9\uFF0C\u6216\u53EA\u8C03\u7528\u53EA\u8BFB\u67E5\u8BE2/\u8BD5\u73A9\u63A2\u9488\u63A5\u53E3"
      });
    }
    const validated = validateBySchema(cmd.params, rawParams);
    if (!validated.ok) {
      const first = validated.issues[0];
      const detail = validated.issues.map((i) => `${i.path}: ${i.message}`).join("\uFF1B");
      return this.recordLog(commandId, rawParams, started, {
        ok: false,
        code: "params.invalid",
        message: `\u6307\u4EE4 "${commandId}" \u53C2\u6570\u6821\u9A8C\u5931\u8D25\uFF1A${detail}`,
        hint: first?.hint ?? "\u8BF7\u6309\u6307\u4EE4\u7684 FieldSchema \u4FEE\u6B63\u53C2\u6570\u7C7B\u578B\u4E0E\u8303\u56F4"
      });
    }
    const autoTx = mutates && this.txStack.length === 0;
    if (autoTx) {
      this.beginTransaction(cmd.title);
    }
    const ctx = {
      transactionLabel: this.txStack[this.txStack.length - 1]?.label ?? null,
      isPlaying: () => this.adapter.isPlaying(),
      recordFileBeforeChange: (relativePath, previousContent) => {
        const top = this.txStack[this.txStack.length - 1];
        if (top && !top.fileBackups.has(relativePath)) {
          top.fileBackups.set(relativePath, previousContent);
        }
      }
    };
    let result;
    try {
      result = await cmd.run(ctx, validated.value);
    } catch (error) {
      result = {
        ok: false,
        code: "command.exception",
        message: error instanceof Error ? error.message : String(error),
        hint: "\u8BF7\u68C0\u67E5\u53C2\u6570\u6216\u5DE5\u7A0B\u5F53\u524D\u72B6\u6001\u540E\u91CD\u8BD5"
      };
    }
    if (result.ok) {
      const top = this.txStack[this.txStack.length - 1];
      if (top) {
        top.changes.push(result.changed);
      }
      if (autoTx) {
        this.commitTransaction();
      }
    } else if (autoTx) {
      await this.rollbackTransaction();
    }
    return this.recordLog(commandId, validated.value, started, result);
  }
  recordLog(commandId, params, started, result) {
    this.seq += 1;
    this.logs.push({
      id: `log_${this.seq}`,
      commandId,
      params,
      ok: result.ok,
      ...result.ok ? { changed: result.changed } : { code: result.code, message: result.message },
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      timestamp: Date.now()
    });
    if (this.logs.length > 500) {
      this.logs.splice(0, this.logs.length - 500);
    }
    return result;
  }
};
var commandBus = new CommandBus();
function mergeChanges(items) {
  const nodesAdded = /* @__PURE__ */ new Set();
  const nodesUpdated = /* @__PURE__ */ new Set();
  const nodesRemoved = /* @__PURE__ */ new Set();
  const assetsChanged = /* @__PURE__ */ new Set();
  const tablesChanged = /* @__PURE__ */ new Set();
  const filesChanged = /* @__PURE__ */ new Set();
  let pictureChanged = false;
  let projectChanged = false;
  const summaries = [];
  for (const item of items) {
    item.nodesAdded?.forEach((id) => nodesAdded.add(id));
    item.nodesUpdated?.forEach((id) => nodesUpdated.add(id));
    item.nodesRemoved?.forEach((id) => nodesRemoved.add(id));
    item.assetsChanged?.forEach((id) => assetsChanged.add(id));
    item.tablesChanged?.forEach((id) => tablesChanged.add(id));
    item.filesChanged?.forEach((id) => filesChanged.add(id));
    if (item.pictureChanged) pictureChanged = true;
    if (item.projectChanged) projectChanged = true;
    if (item.summary) summaries.push(item.summary);
  }
  return {
    ...nodesAdded.size > 0 ? { nodesAdded: Array.from(nodesAdded) } : {},
    ...nodesUpdated.size > 0 ? { nodesUpdated: Array.from(nodesUpdated) } : {},
    ...nodesRemoved.size > 0 ? { nodesRemoved: Array.from(nodesRemoved) } : {},
    ...assetsChanged.size > 0 ? { assetsChanged: Array.from(assetsChanged) } : {},
    ...tablesChanged.size > 0 ? { tablesChanged: Array.from(tablesChanged) } : {},
    ...filesChanged.size > 0 ? { filesChanged: Array.from(filesChanged) } : {},
    ...pictureChanged ? { pictureChanged: true } : {},
    ...projectChanged ? { projectChanged: true } : {},
    ...summaries.length > 0 ? { summary: summaries.join("\uFF1B") } : {}
  };
}
function hasAnyChange(c) {
  return Boolean(
    c.nodesAdded && c.nodesAdded.length > 0 || c.nodesUpdated && c.nodesUpdated.length > 0 || c.nodesRemoved && c.nodesRemoved.length > 0 || c.assetsChanged && c.assetsChanged.length > 0 || c.tablesChanged && c.tablesChanged.length > 0 || c.filesChanged && c.filesChanged.length > 0 || c.pictureChanged || c.projectChanged
  );
}

// electron/services/pathGuard.ts
import path from "node:path";
var PathGuard = class {
  roots = /* @__PURE__ */ new Set();
  constructor(initialRoots = []) {
    for (const root of initialRoots) {
      this.authorizeRoot(root);
    }
  }
  authorizeRoot(dirPath) {
    const resolved = path.resolve(dirPath);
    this.roots.add(normalizeForCompare(resolved));
    return resolved;
  }
  listRoots() {
    return Array.from(this.roots);
  }
  isAllowed(targetPath) {
    if (!targetPath || typeof targetPath !== "string") return false;
    const resolved = path.resolve(targetPath);
    const normalized = normalizeForCompare(resolved);
    for (const root of this.roots) {
      if (normalized === root) return true;
      const rel = path.relative(root, normalized);
      if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        return true;
      }
    }
    return false;
  }
  assertAllowed(targetPath, action = "\u8BBF\u95EE\u6587\u4EF6") {
    if (!this.isAllowed(targetPath)) {
      throw new Error(`\u62D2\u7EDD${action}\uFF1A\u8DEF\u5F84 "${targetPath}" \u4E0D\u5728\u5DF2\u6388\u6743\u7684\u5DE5\u7A0B\u6216\u7528\u6237\u5E93\u76EE\u5F55\u5185`);
    }
    return path.resolve(targetPath);
  }
};
function normalizeForCompare(p) {
  const cleaned = path.resolve(p);
  return process.platform === "win32" ? cleaned.toLowerCase() : cleaned;
}

// src/editor/project/disk.ts
import { create } from "zustand";
var CACHE_ROOT = ".cache/t3d";
var IMPORT_ARTIFACTS = `${CACHE_ROOT}/import-artifacts`;
var TEXTURE_ARTIFACTS = `${CACHE_ROOT}/texture-artifacts`;
var TEXTURE_ORIGINALS = `${CACHE_ROOT}/texture-originals`;
var CACHE_INDEX_PATH = `${CACHE_ROOT}/editor-library/v1/cache-index.json`;
var CACHE_INDEX_VERSION = 1;
var useProjectDirectory = create(() => ({
  active: false,
  name: ""
}));
var cacheIndex = emptyIndex();
var ioChain = Promise.resolve();
function emptyIndex() {
  return { schemaVersion: CACHE_INDEX_VERSION, generatedAt: Date.now(), artifacts: {} };
}

// src/core/project/designMemory.ts
var memoryDesign = createDefaultDesignDoc();
function createDefaultDesignDoc() {
  return {
    title: "\u672A\u547D\u540D\u6E38\u620F\u5DE5\u7A0B",
    genre: "",
    perspective: "",
    coreLoop: "",
    winLose: "",
    artStyle: "",
    colorPalette: [],
    controls: "WASD \u79FB\u52A8\uFF0C\u7A7A\u683C\u8DF3\u8DC3\uFF0C\u9F20\u6807\u5DE6\u952E\u4EA4\u4E92/\u653B\u51FB",
    namingRules: "\u573A\u666F\u8282\u70B9\u4F7F\u7528\u4E2D\u6587\u8BED\u4E49\u547D\u540D\uFF08\u5982 \u4E3B\u89D2\u3001\u5DE1\u903B\u5175_01\u3001\u5730\u9762\uFF09\uFF0C\u811A\u672C\u4E0E\u7740\u8272\u5668\u4F7F\u7528\u82F1\u6587\u9A7C\u5CF0\u547D\u540D",
    notes: "",
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function formatDesignMarkdown(doc) {
  return [
    `# ${doc.title || "\u672A\u547D\u540D\u6E38\u620F\u5DE5\u7A0B"}`,
    "",
    `- **\u7C7B\u578B**\uFF1A${doc.genre || "\u5F85\u5B9A"}`,
    `- **\u89C6\u89D2**\uFF1A${doc.perspective || "\u5F85\u5B9A"}`,
    `- **\u6838\u5FC3\u5FAA\u73AF**\uFF1A${doc.coreLoop || "\u5F85\u5B9A"}`,
    `- **\u80DC\u8D1F\u6761\u4EF6**\uFF1A${doc.winLose || "\u5F85\u5B9A"}`,
    `- **\u7F8E\u672F\u98CE\u683C**\uFF1A${doc.artStyle || "\u5F85\u5B9A"}`,
    `- **\u8272\u5F69\u677F**\uFF1A${doc.colorPalette.length > 0 ? doc.colorPalette.join(", ") : "\u5F85\u5B9A"}`,
    `- **\u64CD\u4F5C\u6620\u5C04**\uFF1A${doc.controls || "\u5F85\u5B9A"}`,
    `- **\u547D\u540D\u7EA6\u5B9A**\uFF1A${doc.namingRules || "\u5F85\u5B9A"}`,
    `- **\u66F4\u65B0\u65F6\u95F4**\uFF1A${doc.updatedAt}`,
    "",
    "## \u8865\u5145\u8BF4\u660E",
    doc.notes || "\uFF08\u6682\u65E0\uFF09",
    ""
  ].join("\n");
}
function parseDesignMarkdown(md) {
  const doc = createDefaultDesignDoc();
  const lines = md.split(/\r?\n/);
  const heading = lines.find((l) => l.startsWith("# "));
  if (heading) doc.title = heading.slice(2).trim();
  const readField = (prefix) => {
    const marker = `- **${prefix}**\uFF1A`;
    const line = lines.find((l) => l.startsWith(marker));
    if (!line) return null;
    const val = line.slice(marker.length).trim();
    return val === "\u5F85\u5B9A" ? "" : val;
  };
  doc.genre = readField("\u7C7B\u578B") ?? doc.genre;
  doc.perspective = readField("\u89C6\u89D2") ?? doc.perspective;
  doc.coreLoop = readField("\u6838\u5FC3\u5FAA\u73AF") ?? doc.coreLoop;
  doc.winLose = readField("\u80DC\u8D1F\u6761\u4EF6") ?? doc.winLose;
  doc.artStyle = readField("\u7F8E\u672F\u98CE\u683C") ?? doc.artStyle;
  const palette = readField("\u8272\u5F69\u677F");
  if (palette) {
    doc.colorPalette = palette.split(",").map((s) => s.trim()).filter(Boolean);
  }
  doc.controls = readField("\u64CD\u4F5C\u6620\u5C04") ?? doc.controls;
  doc.namingRules = readField("\u547D\u540D\u7EA6\u5B9A") ?? doc.namingRules;
  const notesIdx = lines.findIndex((l) => l.trim() === "## \u8865\u5145\u8BF4\u660E");
  if (notesIdx >= 0) {
    const notesText = lines.slice(notesIdx + 1).join("\n").trim();
    doc.notes = notesText === "\uFF08\u6682\u65E0\uFF09" ? "" : notesText;
  }
  return doc;
}

// tests/core-foundation.test.ts
test("FieldSchema: \u9ED8\u8BA4\u503C\u3001\u6821\u9A8C\u3001\u53EF\u9009\u5B57\u6BB5\u4E0E JSON Schema \u8F6C\u6362", () => {
  const schema = {
    type: "object",
    fields: {
      speed: { type: "number", default: 5, min: 0, max: 20, label: "\u901F\u5EA6" },
      color: { type: "color", default: "#ffffff", label: "\u989C\u8272" },
      offset: { type: "vec3", default: [0, 1, 0], optional: true, label: "\u504F\u79FB" },
      mode: {
        type: "enum",
        options: [
          { value: "lit", label: "\u53D7\u5149" },
          { value: "unlit", label: "\u4E0D\u53D7\u5149" }
        ],
        default: "lit",
        label: "\u6A21\u5F0F"
      }
    }
  };
  const defaults = defaultForSchema(schema);
  assert.equal(defaults.speed, 5);
  assert.deepEqual(defaults.offset, [0, 1, 0]);
  const normalized = normalizeBySchema(schema, { speed: 99, color: "bad", mode: "unknown" });
  assert.equal(normalized.speed, 20);
  assert.equal(normalized.color, "#ffffff");
  assert.equal(normalized.mode, "lit");
  const valid = validateBySchema(schema, { speed: 12 });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.speed, 12);
    assert.equal("offset" in valid.value, false);
  }
  const invalid = validateBySchema(schema, { speed: -3 });
  assert.equal(invalid.ok, false);
  const jsonSchema = fieldSchemaToJsonSchema(schema);
  assert.deepEqual(jsonSchema.properties.mode.enum, ["lit", "unlit"]);
});
test("CommandBus: \u53C2\u6570\u6821\u9A8C\u3001\u8BD5\u73A9\u62E6\u622A\u3001\u5D4C\u5957\u4E8B\u52A1\u4E0E\u78C1\u76D8\u6587\u4EF6\u56DE\u6EDA", async () => {
  const bus = new CommandBus();
  let playing = false;
  let count = 0;
  const undoSteps = [];
  const disk = /* @__PURE__ */ new Map([["scripts/a.ts", "old"]]);
  bus.setAdapter({
    isPlaying: () => playing,
    captureSnapshot: () => count,
    restoreSnapshot: (snap) => {
      count = snap;
    },
    commitUndoStep: (label, before) => {
      undoSteps.push({ label, before });
    },
    restoreFiles: (files) => {
      for (const f of files) {
        if (f.previousContent === null) disk.delete(f.relativePath);
        else disk.set(f.relativePath, f.previousContent);
      }
    }
  });
  bus.register({
    id: "test.add",
    title: "\u7D2F\u52A0\u8BA1\u6570",
    risk: "safe",
    params: {
      type: "object",
      fields: {
        delta: { type: "number", default: 1, min: 1, max: 10, label: "\u589E\u91CF" }
      }
    },
    run(ctx, p) {
      ctx.recordFileBeforeChange?.("scripts/a.ts", disk.get("scripts/a.ts") ?? null);
      disk.set("scripts/a.ts", `updated:${count + p.delta}`);
      count += p.delta;
      return { ok: true, value: count, changed: { nodesUpdated: ["n1"], filesChanged: ["scripts/a.ts"] } };
    }
  });
  const badParams = await bus.dispatch("test.add", { delta: 99 });
  assert.equal(badParams.ok, false);
  if (!badParams.ok) assert.equal(badParams.code, "params.invalid");
  playing = true;
  const locked = await bus.dispatch("test.add", { delta: 2 });
  assert.equal(locked.ok, false);
  if (!locked.ok) assert.equal(locked.code, "play.locked");
  playing = false;
  bus.beginTransaction("AI \u4E00\u8F6E\u64CD\u4F5C");
  const step1 = await bus.dispatch("test.add", { delta: 3 });
  assert.equal(step1.ok, true);
  bus.beginTransaction("\u5B50\u6B65\u9AA4");
  await bus.dispatch("test.add", { delta: 4 });
  assert.equal(count, 7);
  await bus.rollbackTransaction();
  assert.equal(count, 3);
  assert.equal(disk.get("scripts/a.ts"), "updated:3");
  await bus.rollbackTransaction();
  assert.equal(count, 0);
  assert.equal(disk.get("scripts/a.ts"), "old");
  assert.equal(undoSteps.length, 0);
  bus.beginTransaction("\u6B63\u5E38\u63D0\u4EA4");
  await bus.dispatch("test.add", { delta: 2 });
  await bus.dispatch("test.add", { delta: 3 });
  const merged = bus.commitTransaction();
  assert.equal(count, 5);
  assert.deepEqual(merged.nodesUpdated, ["n1"]);
  assert.equal(undoSteps.length, 1);
  assert.equal(undoSteps[0].before, 0);
});
test("PathGuard: \u4EC5\u5141\u8BB8\u5DF2\u6388\u6743\u5DE5\u7A0B\u4E0E\u7528\u6237\u5E93\u76EE\u5F55", () => {
  const projectDir = path2.resolve("e:/Temp/MyGame");
  const libDir = path2.resolve("e:/Temp/UserData/T3D");
  const guard = new PathGuard([libDir]);
  guard.authorizeRoot(projectDir);
  assert.equal(guard.isAllowed(path2.join(projectDir, "scripts/patrol.ts")), true);
  assert.equal(guard.isAllowed(path2.join(libDir, "library/packs/rts.zip")), true);
  assert.equal(guard.isAllowed(path2.join(projectDir, "../OtherProject/secret.txt")), false);
  assert.equal(guard.isAllowed(path2.resolve("C:/Windows/System32/drivers/etc/hosts")), false);
  assert.throws(() => guard.assertAllowed(path2.resolve("C:/Windows/win.ini")));
});
test("design.md \u5E8F\u5217\u5316\u4E0E\u53CD\u5E8F\u5217\u5316\u5F80\u8FD4\u4E00\u81F4", () => {
  const md = formatDesignMarkdown({
    title: "\u9057\u8FF9\u8DF3\u8DC3\u8005",
    genre: "3D \u5E73\u53F0\u8DF3\u8DC3",
    perspective: "\u7B2C\u4E09\u4EBA\u79F0\u8FFD\u5C3E",
    coreLoop: "\u8DF3\u8DC3\u8FC7\u969C \u2192 \u6536\u96C6\u6676\u4F53 \u2192 \u62B5\u8FBE\u4F20\u9001\u95E8",
    winLose: "\u5230\u8FBE\u7EC8\u70B9\u83B7\u80DC\uFF0C\u6389\u843D\u6DF1\u6E0A\u590D\u6D3B",
    artStyle: "\u4F4E\u591A\u8FB9\u5F62\u9057\u8FF9 + \u6696\u9633\u6C34\u4F53",
    colorPalette: ["#2dd4bf", "#f59e0b"],
    controls: "WASD \u79FB\u52A8\uFF0CSpace \u8DF3\u8DC3",
    namingRules: "\u4E2D\u6587\u573A\u666F\u8282\u70B9\u540D",
    notes: "\u7B2C\u4E00\u5173\u5148\u505A 4 \u4E2A\u5E73\u53F0",
    updatedAt: "2026-11-21T00:00:00.000Z"
  });
  const parsed = parseDesignMarkdown(md);
  assert.equal(parsed.title, "\u9057\u8FF9\u8DF3\u8DC3\u8005");
  assert.equal(parsed.genre, "3D \u5E73\u53F0\u8DF3\u8DC3");
  assert.deepEqual(parsed.colorPalette, ["#2dd4bf", "#f59e0b"]);
  assert.equal(parsed.notes, "\u7B2C\u4E00\u5173\u5148\u505A 4 \u4E2A\u5E73\u53F0");
});
