// tests/asset-import-memory.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import zlib2 from "node:zlib";

// electron/services/packageArchive.ts
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
var BLOCK = 512;
var TarIndexer = class {
  constructor(shouldInline = () => false) {
    this.shouldInline = shouldInline;
  }
  shouldInline;
  entries = [];
  /** 已处理的 tar 字节数 */
  position = 0;
  header = Buffer.alloc(BLOCK);
  headerFill = 0;
  bodyRemaining = 0;
  padRemaining = 0;
  capture = null;
  pendingPath = null;
  ended = false;
  write(chunk) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let cursor = 0;
    while (cursor < data.length) {
      if (this.ended) {
        this.position += data.length - cursor;
        return;
      }
      const available = data.length - cursor;
      if (this.bodyRemaining > 0) {
        const take2 = Math.min(this.bodyRemaining, available);
        if (this.capture) this.capture.chunks.push(Buffer.from(data.subarray(cursor, cursor + take2)));
        this.bodyRemaining -= take2;
        cursor += take2;
        this.position += take2;
        if (this.bodyRemaining === 0) this.finishBody();
        continue;
      }
      if (this.padRemaining > 0) {
        const take2 = Math.min(this.padRemaining, available);
        this.padRemaining -= take2;
        cursor += take2;
        this.position += take2;
        continue;
      }
      const take = Math.min(BLOCK - this.headerFill, available);
      data.copy(this.header, this.headerFill, cursor, cursor + take);
      this.headerFill += take;
      cursor += take;
      this.position += take;
      if (this.headerFill === BLOCK) {
        this.headerFill = 0;
        this.readHeader();
      }
    }
  }
  /** 流结束时调用：内容没读完说明包被截断了。 */
  finish() {
    if (this.bodyRemaining > 0 || this.headerFill > 0) {
      throw new Error("\u8D44\u6E90\u5305\u4E0D\u5B8C\u6574\uFF1A\u6587\u4EF6\u5728\u4E2D\u9014\u88AB\u622A\u65AD");
    }
  }
  readHeader() {
    const header = this.header;
    if (isZeroBlock(header)) {
      this.ended = true;
      return;
    }
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const size = readSize(header, 124, 12);
    const type = readString(header, 156, 1) || "0";
    this.bodyRemaining = size;
    this.padRemaining = (BLOCK - size % BLOCK) % BLOCK;
    if (type === "L") {
      this.capture = { kind: "longName", entry: null, chunks: [] };
    } else if (type === "x") {
      this.capture = { kind: "pax", entry: null, chunks: [] };
    } else if (type === "g") {
      this.capture = null;
    } else {
      const entryPath = normalizePath(this.pendingPath ?? (prefix ? `${prefix}/${name}` : name));
      this.pendingPath = null;
      if (entryPath && type !== "5") {
        const entry = { path: entryPath, type, offset: this.position, size };
        this.entries.push(entry);
        this.capture = size > 0 && this.shouldInline(entryPath, size) ? { kind: "inline", entry, chunks: [] } : null;
        if (size === 0 && this.shouldInline(entryPath, 0)) entry.inline = new Uint8Array(0);
      } else {
        this.capture = null;
      }
    }
    if (this.bodyRemaining === 0) this.finishBody();
  }
  finishBody() {
    const capture = this.capture;
    this.capture = null;
    if (!capture) return;
    const bytes = Buffer.concat(capture.chunks);
    if (capture.kind === "inline" && capture.entry) {
      capture.entry.inline = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } else if (capture.kind === "longName") {
      this.pendingPath = bytes.toString("utf-8").replace(/\0+$/, "");
    } else if (capture.kind === "pax") {
      const found = paxPath(bytes.toString("utf-8"));
      if (found) this.pendingPath = found;
    }
  }
};
function paxPath(text) {
  let cursor = 0;
  while (cursor < text.length) {
    const space = text.indexOf(" ", cursor);
    if (space < 0) break;
    const length = Number.parseInt(text.slice(cursor, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, cursor + length).replace(/\n$/, "");
    const eq = record.indexOf("=");
    if (eq > 0 && record.slice(0, eq) === "path") return record.slice(eq + 1);
    cursor += length;
  }
  return null;
}
function isZeroBlock(block) {
  for (let i = 0; i < block.length; i += 1) if (block[i] !== 0) return false;
  return true;
}
function readString(block, offset, length) {
  let end = offset;
  const max = offset + length;
  while (end < max && block[end] !== 0) end += 1;
  return block.toString("utf-8", offset, end).trim();
}
function readSize(block, offset, length) {
  if ((block[offset] & 128) !== 0) {
    let value2 = 0;
    for (let i = offset + 1; i < offset + length; i += 1) value2 = value2 * 256 + block[i];
    return value2;
  }
  const raw = readString(block, offset, length);
  if (!raw) return 0;
  const value = Number.parseInt(raw, 8);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}
var PACKAGE_READ_LIMIT = 1536 * 1024 * 1024;
var INLINE_LIMIT = 4 * 1024 * 1024;
function unityPackageInline(entryPath, size) {
  if (size > INLINE_LIMIT) return false;
  const slash = entryPath.indexOf("/");
  if (slash < 0) return false;
  const leaf = entryPath.slice(slash + 1);
  return leaf === "pathname" || leaf === "asset.meta";
}
var PackageArchiveSessions = class {
  constructor(stagingDir) {
    this.stagingDir = stagingDir;
  }
  stagingDir;
  sessions = /* @__PURE__ */ new Map();
  /** 启动时清掉上次异常退出留下的临时文件。 */
  async purgeStale() {
    try {
      const names = await fsp.readdir(this.stagingDir);
      await Promise.all(names.map((name) => fsp.rm(path.join(this.stagingDir, name), { force: true }).catch(() => void 0)));
    } catch {
    }
  }
  async open(sessionId, packagePath, onProgress) {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(sessionId)) throw new Error("\u8D44\u6E90\u5305\u4F1A\u8BDD\u7F16\u53F7\u4E0D\u5408\u6CD5");
    if (!/\.unitypackage$/i.test(packagePath)) throw new Error("\u53EA\u652F\u6301 .unitypackage \u8D44\u6E90\u5305");
    await this.close(sessionId);
    const stat = await fsp.stat(packagePath);
    const gzip = await isGzip(packagePath);
    const abort = new AbortController();
    const session = {
      tarPath: packagePath,
      temporary: false,
      tarBytes: stat.size,
      handle: null,
      abort
    };
    this.sessions.set(sessionId, session);
    const indexer = new TarIndexer(unityPackageInline);
    let done = 0;
    let lastReport = 0;
    const report = (force = false) => {
      const now = Date.now();
      if (!force && now - lastReport < 150) return;
      lastReport = now;
      onProgress?.(done, stat.size);
    };
    try {
      const openSource = () => {
        const source = fs.createReadStream(packagePath, { highWaterMark: 1024 * 1024 });
        source.on("data", (chunk) => {
          done += chunk.length;
          report();
        });
        return source;
      };
      const tap = new Transform({
        transform(chunk, _encoding, callback) {
          try {
            indexer.write(chunk);
            callback(null, chunk);
          } catch (error) {
            callback(error);
          }
        }
      });
      if (gzip) {
        await fsp.mkdir(this.stagingDir, { recursive: true });
        await assertFreeSpace(this.stagingDir, stat.size);
        session.tarPath = path.join(this.stagingDir, `${sessionId}.tar`);
        session.temporary = true;
        const sink = fs.createWriteStream(session.tarPath, { highWaterMark: 1024 * 1024 });
        await pipeline(openSource(), zlib.createGunzip(), tap, sink, { signal: abort.signal });
      } else {
        const indexOnly = new Writable({
          write(chunk, _encoding, callback) {
            try {
              indexer.write(chunk);
              callback();
            } catch (error) {
              callback(error);
            }
          }
        });
        await pipeline(openSource(), indexOnly, { signal: abort.signal });
      }
      indexer.finish();
      session.tarBytes = indexer.position;
      session.handle = await fsp.open(session.tarPath, "r");
      report(true);
      return { sessionId, tarBytes: session.tarBytes, entries: indexer.entries };
    } catch (error) {
      await this.close(sessionId);
      if (session.temporary) await fsp.rm(session.tarPath, { force: true }).catch(() => void 0);
      const code = error.code;
      if (code === "ENOSPC") throw new Error("\u78C1\u76D8\u7A7A\u95F4\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u89E3\u538B\u8D44\u6E90\u5305");
      if (code === "ABORT_ERR") throw new Error("\u5DF2\u53D6\u6D88");
      if (code === "Z_DATA_ERROR" || code === "Z_BUF_ERROR") throw new Error("\u8D44\u6E90\u5305\u5DF2\u635F\u574F\uFF0C\u65E0\u6CD5\u89E3\u538B");
      throw error;
    }
  }
  async read(sessionId, offset, size) {
    const session = this.sessions.get(sessionId);
    if (!session?.handle) throw new Error("\u8D44\u6E90\u5305\u4F1A\u8BDD\u5DF2\u5173\u95ED");
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > session.tarBytes) {
      throw new Error("\u8D44\u6E90\u5305\u8BFB\u53D6\u8303\u56F4\u8D8A\u754C");
    }
    if (size > PACKAGE_READ_LIMIT) {
      throw new Error(`\u5355\u4E2A\u6587\u4EF6\u8D85\u8FC7 ${Math.round(PACKAGE_READ_LIMIT / 1024 / 1024)}MB\uFF0C\u65E0\u6CD5\u5BFC\u5165`);
    }
    const buffer = new ArrayBuffer(size);
    const view = new Uint8Array(buffer);
    let filled = 0;
    while (filled < size) {
      const { bytesRead } = await session.handle.read(view, filled, size - filled, offset + filled);
      if (bytesRead === 0) throw new Error("\u8D44\u6E90\u5305\u8BFB\u53D6\u5931\u8D25\uFF1A\u4E34\u65F6\u6587\u4EF6\u4E0D\u5B8C\u6574");
      filled += bytesRead;
    }
    return buffer;
  }
  async close(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.abort.abort();
    await session.handle?.close().catch(() => void 0);
    if (session.temporary) await fsp.rm(session.tarPath, { force: true }).catch(() => void 0);
  }
  /** 退出应用时同步清理，避免留下几个 GB 的临时文件。 */
  closeAllSync() {
    for (const session of this.sessions.values()) {
      session.abort.abort();
      if (session.temporary) {
        try {
          fs.rmSync(session.tarPath, { force: true });
        } catch {
        }
      }
    }
    this.sessions.clear();
  }
};
async function isGzip(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const magic = Buffer.alloc(2);
    const { bytesRead } = await handle.read(magic, 0, 2, 0);
    return bytesRead === 2 && magic[0] === 31 && magic[1] === 139;
  } finally {
    await handle.close();
  }
}
async function assertFreeSpace(dir, compressedBytes) {
  try {
    const info = await fsp.statfs(dir);
    const free = Number(info.bavail) * Number(info.bsize);
    const needed = compressedBytes * 1.5;
    if (free < needed) {
      throw Object.assign(new Error(`\u78C1\u76D8\u7A7A\u95F4\u4E0D\u8DB3\uFF1A\u89E3\u538B\u8D44\u6E90\u5305\u81F3\u5C11\u9700\u8981 ${formatGb(needed)}\uFF0C\u4E34\u65F6\u76EE\u5F55\u6240\u5728\u78C1\u76D8\u53EA\u5269 ${formatGb(free)}`), { code: "T3D_SPACE" });
    }
  } catch (error) {
    if (error.code === "T3D_SPACE") throw error;
  }
}
function formatGb(bytes) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

// src/editor/assets/package/packageAssetRoleGuess.ts
function applyPackageModelAssetRoleGuesses(entries) {
  const bodyCandidates = entries.filter((entry) => isModelLike(entry) && !clipSuffix(entry.fileName));
  return entries.map((entry) => {
    if (!isModelLike(entry)) return entry;
    const guess = guessRole(entry, bodyCandidates);
    return {
      ...entry,
      roleGuess: guess
    };
  });
}
function guessRole(entry, bodyCandidates) {
  const suffix = clipSuffix(entry.fileName);
  if (suffix) {
    const related = relatedBodiesForPrefix(suffix.body, bodyCandidates);
    return {
      role: "animationCarrier",
      confidence: "high",
      source: "filename",
      reasons: ["filename-at-clip"],
      clipNames: [suffix.clip],
      ...related.length ? { relatedBodyEntryIds: related.map((item) => item.id) } : {}
    };
  }
  if (entry.kind === "animation" || isAnimationFolder(entry.originalPath)) {
    const bodies = bodyCandidates.filter((item) => item.id !== entry.id && item.kind !== "animation");
    return {
      role: "animationCarrier",
      confidence: "medium",
      source: "filename",
      reasons: ["imported-clips"],
      clipNames: [clipNameFromFile(entry.fileName)],
      ...bodies.length ? { relatedBodyEntryIds: bodies.map((item) => item.id) } : {}
    };
  }
  const pathScore = bodyPathScore(entry.originalPath);
  if (pathScore > 0) {
    return {
      role: "modelBody",
      confidence: pathScore >= 2 ? "medium" : "low",
      source: "filename",
      reasons: ["model-like-path"]
    };
  }
  return {
    role: "ordinaryModel",
    confidence: "low",
    source: "filename",
    reasons: ["model-file"]
  };
}
function isModelLike(entry) {
  return entry.kind === "model" || entry.kind === "animation";
}
function clipSuffix(fileName) {
  const base = stripExtension(fileName);
  const at = base.lastIndexOf("@");
  if (at <= 0 || at >= base.length - 1) return null;
  const body = base.slice(0, at).trim();
  const clip = base.slice(at + 1).trim();
  return body && clip ? { body, clip } : null;
}
function relatedBodiesForPrefix(bodyPrefix, bodyCandidates) {
  const target = normalizeName(bodyPrefix);
  if (!target) return [];
  return bodyCandidates.filter((entry) => {
    const base = normalizeName(stripExtension(entry.fileName));
    return base === target || base.endsWith(target) || target.endsWith(base);
  });
}
function bodyPathScore(path3) {
  const normalized = path3.toLowerCase().replace(/\\/g, "/");
  let score = 0;
  if (/(^|\/)(models?|meshes?|characters?|fbx)(\/|$)/i.test(normalized)) score += 1;
  if (!/(^|\/)(animations?|anim|motions?)(\/|$)/i.test(normalized)) score += 1;
  return score;
}
function isAnimationFolder(path3) {
  return /(^|\/)(animations?|anims?|motions?)(\/|$)/i.test(path3.replace(/\\/g, "/"));
}
function clipNameFromFile(fileName) {
  return stripExtension(fileName).trim();
}
function stripExtension(fileName) {
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(0, index) : fileName;
}
function normalizeName(name) {
  return name.trim().toLowerCase().replace(/[\s._-]+/g, "");
}

// src/editor/assets/package/packageAssetScanner.ts
var EAGER_TEXT_LIMITS = {
  mat: 8 * 1024 * 1024,
  mtl: 8 * 1024 * 1024,
  prefab: 48 * 1024 * 1024,
  unity: 48 * 1024 * 1024
};
var MODEL_EXTENSIONS = /* @__PURE__ */ new Set(["fbx", "obj", "dae", "3ds", "stl", "glb", "gltf"]);
var TEXTURE_EXTENSIONS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "webp", "ktx2", "tga"]);
var HIDDEN_EXTENSIONS = /* @__PURE__ */ new Set([
  "prefab",
  "unity",
  "controller",
  "overridecontroller",
  "cs",
  "asmdef",
  "shader",
  "meta",
  "anim",
  "asset",
  "txt",
  "md",
  "json",
  "xml"
]);
async function scanPackageArchive(sources) {
  const records = await collectPackageArchiveRecords(sources);
  return buildScannerResult(records);
}
async function collectPackageArchiveRecords(entries) {
  const byRoot = /* @__PURE__ */ new Map();
  const directRecords = [];
  for (const entry of entries) {
    if (entry.type === "5") continue;
    const lazy = { size: entry.size, read: entry.read };
    const parts = entry.path.split("/").filter(Boolean);
    if (parts.length >= 2 && isPackageArchiveRecordLeaf(parts.slice(1).join("/"))) {
      const root = parts[0];
      const leaf = parts.slice(1).join("/");
      const record = byRoot.get(root) ?? { recordPath: root };
      byRoot.set(root, record);
      if (leaf === "asset") record.asset = lazy;
      else if (leaf === "asset.meta") record.meta = entry.inline ?? await entry.read();
      else if (leaf === "pathname") record.pathname = decodePackagePathname(entry.inline ?? await entry.read());
      else if (leaf === "preview.png") record.preview = lazy;
      continue;
    }
    const path3 = normalizePackagePath(entry.path);
    directRecords.push({
      recordPath: path3,
      pathname: path3,
      asset: lazy
    });
  }
  return [...byRoot.values(), ...directRecords];
}
async function readEagerText(asset, extension, path3, diagnostics) {
  const limit = EAGER_TEXT_LIMITS[extension];
  if (limit === void 0) return null;
  if (asset.size > limit) {
    diagnostics.push({
      code: "text-too-large",
      severity: "warning",
      message: `\u6587\u4EF6\u8FC7\u5927\uFF08${Math.round(asset.size / 1024 / 1024)}MB\uFF09\uFF0C\u626B\u63CF\u65F6\u8DF3\u8FC7\u4E86\u5176\u4E2D\u7684\u6750\u8D28\u7ED1\u5B9A\u4FE1\u606F\u3002`,
      path: path3
    });
    return null;
  }
  try {
    return await asset.read();
  } catch (error) {
    diagnostics.push({
      code: "text-read-failed",
      severity: "warning",
      message: error instanceof Error ? error.message : String(error),
      path: path3
    });
    return null;
  }
}
async function buildScannerResult(records) {
  const diagnostics = [];
  const entries = [];
  const materialBindingSources = [];
  const candidates = await collectAssetCandidates(records, diagnostics);
  let hidden = 0;
  let unsupported = 0;
  let missingPathname = 0;
  let missingAssetBytes = 0;
  for (const record of records) {
    if (!record.pathname) {
      missingPathname += 1;
      diagnostics.push({
        code: "missing-pathname",
        severity: "info",
        message: "Package record has no pathname and was hidden.",
        path: record.recordPath
      });
      continue;
    }
    if (!record.asset || record.asset.size === 0) {
      missingAssetBytes += 1;
      diagnostics.push({
        code: "missing-asset-bytes",
        severity: "info",
        message: "Package record has no extractable asset bytes and was hidden.",
        path: record.pathname
      });
      continue;
    }
    const originalPath = normalizePackagePath(record.pathname);
    const extension = extensionOf(originalPath);
    if (extension === "prefab" || extension === "unity") {
      const text = await readEagerText(record.asset, extension, originalPath, diagnostics);
      if (text) {
        materialBindingSources.push({
          originalPath,
          extension,
          packageRecordPath: record.recordPath,
          assetBytes: text,
          metaBytes: record.meta
        });
      }
    }
    const classified = classifyExtractableAsset(originalPath, extension);
    if (!classified) {
      if (HIDDEN_EXTENSIONS.has(extension)) hidden += 1;
      else unsupported += 1;
      continue;
    }
    entries.push({
      id: stableEntryId(record.recordPath, originalPath),
      kind: classified.kind,
      originalPath,
      fileName: fileNameOf(originalPath),
      extension,
      outputExtension: classified.outputExtension,
      conversionNote: classified.conversionNote,
      packageRecordPath: record.recordPath,
      sizeBytes: record.asset.size,
      ...classified.kind === "material" ? { assetBytes: await readEagerText(record.asset, extension, originalPath, diagnostics) ?? void 0 } : {},
      readAsset: record.asset.read,
      ...record.preview && record.preview.size > 0 ? { readPreview: record.preview.read } : {},
      metaBytes: record.meta,
      companionFiles: companionFilesForAsset(originalPath, extension, candidates),
      warnings: classified.warnings
    });
  }
  entries.sort((a, b) => a.originalPath.localeCompare(b.originalPath));
  const entriesWithRoles = applyPackageModelAssetRoleGuesses(entries);
  return {
    entries: entriesWithRoles,
    materialBindingSources,
    tree: buildTree(entriesWithRoles),
    diagnostics,
    stats: {
      packageRecords: records.length,
      extractable: entries.length,
      hidden,
      unsupported,
      missingPathname,
      missingAssetBytes
    }
  };
}
async function collectAssetCandidates(records, diagnostics) {
  const candidates = [];
  for (const record of records) {
    if (!record.pathname || !record.asset || record.asset.size === 0) continue;
    const originalPath = normalizePackagePath(record.pathname);
    const extension = extensionOf(originalPath);
    const eager = extension === "mtl" ? await readEagerText(record.asset, extension, originalPath, diagnostics) : null;
    candidates.push({
      originalPath,
      extension,
      asset: record.asset,
      ...eager ? { eager } : {}
    });
  }
  return candidates;
}
function companionFilesForAsset(originalPath, extension, candidates) {
  if (!MODEL_EXTENSIONS.has(extension)) return [];
  const companions = [];
  const dir = directoryOf(originalPath);
  const base = stripExtension2(fileNameOf(originalPath)).toLowerCase();
  const seen = /* @__PURE__ */ new Set();
  if (extension === "obj") {
    const mtlCandidates = [];
    for (const candidate of candidates) {
      if (candidate.originalPath === originalPath) continue;
      if (candidate.extension !== "mtl") continue;
      if (directoryOf(candidate.originalPath) !== dir) continue;
      if (stripExtension2(fileNameOf(candidate.originalPath)).toLowerCase() !== base) continue;
      companions.push(companionFile(candidate, "obj-mtl"));
      mtlCandidates.push(candidate);
      seen.add(candidate.originalPath);
    }
    for (const mtl of mtlCandidates) {
      if (!mtl.eager) continue;
      for (const texturePath of referencedTexturePathsFromMtl(mtl.eager)) {
        const matched = findCandidateByTextureReference(texturePath, directoryOf(mtl.originalPath), candidates);
        if (!matched || matched.originalPath === originalPath || seen.has(matched.originalPath)) continue;
        companions.push(companionFile(matched, "referenced-texture"));
        seen.add(matched.originalPath);
      }
    }
  }
  for (const candidate of candidates) {
    if (candidate.originalPath === originalPath || seen.has(candidate.originalPath)) continue;
    if (!TEXTURE_EXTENSIONS.has(candidate.extension)) continue;
    if (directoryOf(candidate.originalPath) !== dir) continue;
    companions.push(companionFile(candidate, "same-folder-texture"));
    seen.add(candidate.originalPath);
  }
  companions.sort((a, b) => {
    const ar = a.reason === "obj-mtl" ? 0 : 1;
    const br = b.reason === "obj-mtl" ? 0 : 1;
    return ar - br || a.originalPath.localeCompare(b.originalPath);
  });
  return companions;
}
function companionFile(candidate, reason) {
  return {
    originalPath: candidate.originalPath,
    fileName: fileNameOf(candidate.originalPath),
    extension: candidate.extension,
    sizeBytes: candidate.asset.size,
    read: candidate.asset.read,
    reason
  };
}
function referencedTexturePathsFromMtl(bytes) {
  const text = decodeText(bytes);
  const paths = [];
  const textureKeys = /* @__PURE__ */ new Set([
    "map_kd",
    "map_ka",
    "map_ks",
    "map_ke",
    "map_bump",
    "bump",
    "norm",
    "map_d",
    "map_opacity",
    "disp",
    "decal",
    "map_ns",
    "map_pr",
    "map_pm",
    "map_orm"
  ]);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(/\s+/);
    const key = rawKey?.toLowerCase();
    if (!key || !textureKeys.has(key) || rest.length === 0) continue;
    const path3 = lastTexturePathToken(rest);
    if (path3) paths.push(path3);
  }
  return paths;
}
function lastTexturePathToken(tokens) {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (!token || token.startsWith("-")) continue;
    const normalized = normalizePackagePath(token.replace(/^"|"$/g, ""));
    if (TEXTURE_EXTENSIONS.has(extensionOf(normalized))) return normalized;
  }
  return null;
}
function findCandidateByTextureReference(texturePath, baseDirectory, candidates) {
  const normalizedRef = normalizePackagePath(texturePath);
  const directPath = normalizePackagePath(baseDirectory ? `${baseDirectory}/${normalizedRef}` : normalizedRef);
  const direct = candidates.find((candidate) => candidate.originalPath === directPath && TEXTURE_EXTENSIONS.has(candidate.extension));
  if (direct) return direct;
  const refName = fileNameOf(normalizedRef).toLowerCase();
  const sameDir = candidates.find(
    (candidate) => directoryOf(candidate.originalPath) === baseDirectory && fileNameOf(candidate.originalPath).toLowerCase() === refName && TEXTURE_EXTENSIONS.has(candidate.extension)
  );
  if (sameDir) return sameDir;
  return candidates.find(
    (candidate) => fileNameOf(candidate.originalPath).toLowerCase() === refName && TEXTURE_EXTENSIONS.has(candidate.extension)
  ) ?? null;
}
function classifyExtractableAsset(originalPath, extension) {
  if (TEXTURE_EXTENSIONS.has(extension)) {
    if (extension === "tga") {
      return {
        kind: "texture",
        outputExtension: "png",
        conversionNote: "TGA -> PNG",
        warnings: []
      };
    }
    return { kind: "texture", outputExtension: extension, warnings: [] };
  }
  if (MODEL_EXTENSIONS.has(extension)) {
    const base = stripExtension2(fileNameOf(originalPath));
    if (extension === "fbx" && (hasAtClipName(base) || isAnimationFolder2(originalPath))) {
      return {
        kind: "animation",
        outputExtension: "clip",
        conversionNote: "FBX animation carrier",
        warnings: ["Animation clip usability depends on a compatible skeleton."]
      };
    }
    return {
      kind: "model",
      outputExtension: extension === "glb" || extension === "gltf" ? extension : "glb",
      conversionNote: extension === "glb" || extension === "gltf" ? void 0 : `${extension.toUpperCase()} -> GLB artifact`,
      warnings: []
    };
  }
  if (extension === "mat") {
    return {
      kind: "material",
      outputExtension: "gm3dmat",
      conversionNote: "Unity .mat -> \u6750\u8D28",
      warnings: []
    };
  }
  return null;
}
function buildTree(entries) {
  const root = { name: "", path: "", children: [], entries: [] };
  const directories = /* @__PURE__ */ new Map([["", root]]);
  for (const entry of entries) {
    const parts = entry.originalPath.split("/").filter(Boolean);
    const dirs = parts.slice(0, -1);
    let current = root;
    let currentPath = "";
    for (const dir of dirs) {
      currentPath = currentPath ? `${currentPath}/${dir}` : dir;
      let next = directories.get(currentPath);
      if (!next) {
        next = { name: dir, path: currentPath, children: [], entries: [] };
        directories.set(currentPath, next);
        current.children.push(next);
        current.children.sort((a, b) => a.name.localeCompare(b.name));
      }
      current = next;
    }
    current.entries.push(entry);
  }
  sortTree(root);
  return root;
}
function sortTree(node) {
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.entries.sort((a, b) => a.fileName.localeCompare(b.fileName));
  for (const child of node.children) sortTree(child);
}
function isPackageArchiveRecordLeaf(path3) {
  return path3 === "asset" || path3 === "asset.meta" || path3 === "pathname" || path3 === "preview.png";
}
function stableEntryId(recordPath, originalPath) {
  return `pkg_${hashString(`${recordPath}:${originalPath}`).toString(36)}`;
}
function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function decodeText(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}
function decodePackagePathname(bytes) {
  return decodeText(bytes).replace(/\0+$/g, "").replace(/\r?\n00$/g, "").trim().replace(/\\/g, "/");
}
function normalizePackagePath(path3) {
  return path3.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}
function extensionOf(path3) {
  const name = fileNameOf(path3);
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}
function fileNameOf(path3) {
  return normalizePackagePath(path3).split("/").filter(Boolean).pop() ?? path3;
}
function directoryOf(path3) {
  const normalized = normalizePackagePath(path3);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}
function stripExtension2(name) {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(0, index) : name;
}
function hasAtClipName(base) {
  const at = base.lastIndexOf("@");
  return at > 0 && at < base.length - 1;
}
function isAnimationFolder2(path3) {
  return /(^|\/)(animations?|anims?|motions?)(\/|$)/i.test(normalizePackagePath(path3));
}

// src/editor/assets/memoryBudget.ts
var MIN_DEGRADED_SIZE = 256;
function estimateRgbaBytes(width, height, mipmaps, bytesPerPixel = 4) {
  const base = Math.max(0, width) * Math.max(0, height) * bytesPerPixel;
  return mipmaps ? Math.round(base * 4 / 3) : base;
}
function chooseMipSkip(usedBytes, budgetBytes, levels) {
  if (budgetBytes <= 0 || levels.length <= 1) return 0;
  const ratio = usedBytes / budgetBytes;
  let skip = ratio >= 1.25 ? 2 : ratio >= 1 ? 1 : 0;
  skip = Math.min(skip, levels.length - 1);
  while (skip > 0) {
    const level = levels[skip];
    const usable = level.width % 4 === 0 && level.height % 4 === 0 && Math.max(level.width, level.height) >= MIN_DEGRADED_SIZE;
    if (usable) break;
    skip -= 1;
  }
  return skip;
}
function projectedBytesAfterRestore(usedBytes, degraded) {
  let total = usedBytes;
  for (const item of degraded) total += item.bytes * (4 ** item.skip - 1);
  return total;
}
function canRestoreDegraded(usedBytes, budgetBytes, degraded) {
  if (degraded.length === 0) return false;
  return projectedBytesAfterRestore(usedBytes, degraded) <= budgetBytes * 0.85;
}

// src/editor/assets/loadFailures.ts
var MAX_ATTEMPTS = 3;
var BASE_DELAY_MS = 2e3;
var reporter = null;
var gates = [];
function setLoadFailureReporter(next) {
  reporter = next;
}
function createLoadFailureGate(kind, now = () => Date.now()) {
  const records = /* @__PURE__ */ new Map();
  const gate = {
    shouldTry(assetId, hash) {
      const record = records.get(assetId);
      if (!record) return true;
      if (record.hash !== hash) {
        records.delete(assetId);
        return true;
      }
      if (record.count >= MAX_ATTEMPTS) return false;
      return now() >= record.retryAt;
    },
    fail(assetId, hash, name, error) {
      const previous = records.get(assetId);
      const count = previous && previous.hash === hash ? previous.count + 1 : 1;
      const message = error instanceof Error ? error.message : String(error);
      records.set(assetId, { hash, count, retryAt: now() + BASE_DELAY_MS * 4 ** (count - 1), message });
      if (count === MAX_ATTEMPTS) reporter?.({ assetId, kind, name, message });
    },
    clear(assetId) {
      records.delete(assetId);
    },
    failed() {
      const out = [];
      for (const [assetId, record] of records) {
        if (record.count >= MAX_ATTEMPTS) out.push({ assetId, message: record.message });
      }
      return out;
    }
  };
  gates.push(gate);
  return gate;
}

// src/runtime/engine/bc7.ts
import { CompressedTexture, NoColorSpace, RepeatWrapping, RGBA_BPTC_Format, SRGBColorSpace } from "three";
var BC7_MAGIC = 927154772;
function packBc7Artifact(width, _height, mips) {
  let payloadBytes = 0;
  for (const mip of mips) payloadBytes += 12 + mip.data.byteLength;
  const out = new Uint8Array(16 + payloadBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, BC7_MAGIC, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, width, true);
  view.setUint32(12, mips.length, true);
  let offset = 16;
  for (const mip of mips) {
    view.setUint32(offset, mip.width, true);
    view.setUint32(offset + 4, mip.height, true);
    view.setUint32(offset + 8, mip.data.byteLength, true);
    out.set(mip.data, offset + 12);
    offset += 12 + mip.data.byteLength;
  }
  return out.buffer;
}
function unpackBc7Artifact(buffer) {
  if (buffer.byteLength < 16) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== BC7_MAGIC || view.getUint32(4, true) !== 1) return null;
  const width = view.getUint32(8, true);
  const mipCount = view.getUint32(12, true);
  if (width <= 0 || mipCount <= 0 || mipCount > 16) return null;
  const mips = [];
  let offset = 16;
  for (let i = 0; i < mipCount; i += 1) {
    if (offset + 12 > buffer.byteLength) return null;
    const w = view.getUint32(offset, true);
    const h = view.getUint32(offset + 4, true);
    const byteLen = view.getUint32(offset + 8, true);
    offset += 12;
    if (offset + byteLen > buffer.byteLength) return null;
    mips.push({ width: w, height: h, data: new Uint8Array(buffer, offset, byteLen) });
    offset += byteLen;
  }
  if (mips.length === 0) return null;
  return { width, height: mips[0].height, mips };
}
function trimBc7ArtifactToMaxSize(buffer, maxSize) {
  if (maxSize <= 0) return buffer;
  const unpacked = unpackBc7Artifact(buffer);
  if (!unpacked) return null;
  let skip = 0;
  while (skip + 1 < unpacked.mips.length && Math.max(unpacked.mips[skip].width, unpacked.mips[skip].height) > maxSize && unpacked.mips[skip + 1].width >= 4 && unpacked.mips[skip + 1].height >= 4 && unpacked.mips[skip + 1].width % 4 === 0 && unpacked.mips[skip + 1].height % 4 === 0) {
    skip += 1;
  }
  if (skip === 0) return buffer;
  const rest = unpacked.mips.slice(skip);
  return packBc7Artifact(rest[0].width, rest[0].height, rest);
}

// tests/asset-import-memory.test.ts
function tarHeader(name, size, type = "0") {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf-8");
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write("        ", 148);
  header.write(type, 156);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return header;
}
function tarFile(name, content, type = "0") {
  const body = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const pad = (512 - body.length % 512) % 512;
  return Buffer.concat([tarHeader(name, body.length, type), body, Buffer.alloc(pad)]);
}
function buildTar(files) {
  return Buffer.concat([...files.map((file) => tarFile(file.name, file.content, file.type)), Buffer.alloc(1024)]);
}
function unityRecord(guid, pathname, asset, meta = `guid: ${guid}
`) {
  return [
    { name: `${guid}/asset`, content: asset },
    { name: `${guid}/asset.meta`, content: meta },
    { name: `${guid}/pathname`, content: pathname }
  ];
}
var fbxBytes = Buffer.alloc(3e3, 7);
var pngBytes = Buffer.alloc(1500, 9);
var matText = "%YAML 1.1\nMaterial:\n  m_Name: Stone\n";
var sampleTar = buildTar([
  ...unityRecord("aaaa0001", "Assets/Models/Rock.fbx", fbxBytes),
  ...unityRecord("aaaa0002", "Assets/Models/Rock_Albedo.png", pngBytes),
  ...unityRecord("aaaa0003", "Assets/Materials/Stone.mat", matText)
]);
test("tar \u7D22\u5F15\uFF1A\u4EFB\u610F\u5206\u5757\u5582\u5165\u90FD\u80FD\u5F97\u5230\u76F8\u540C\u7684\u504F\u79FB\u548C\u5927\u5C0F\uFF0C\u53EA\u628A\u5143\u6570\u636E\u8BFB\u8FDB\u5185\u5B58", () => {
  const inlineLeaf = (entryPath) => entryPath.endsWith("/pathname") || entryPath.endsWith("/asset.meta");
  for (const chunkSize of [1, 7, 511, 512, 513, 4096, sampleTar.length]) {
    const indexer = new TarIndexer(inlineLeaf);
    for (let offset = 0; offset < sampleTar.length; offset += chunkSize) {
      indexer.write(sampleTar.subarray(offset, offset + chunkSize));
    }
    indexer.finish();
    assert.equal(indexer.entries.length, 9, `\u5206\u5757 ${chunkSize}`);
    const asset = indexer.entries.find((entry) => entry.path === "aaaa0001/asset");
    assert.equal(asset.size, fbxBytes.length);
    assert.equal(asset.inline, void 0, "\u5927\u6587\u4EF6\u672C\u4F53\u4E0D\u5E94\u8BFB\u8FDB\u5185\u5B58");
    assert.deepEqual(sampleTar.subarray(asset.offset, asset.offset + asset.size), fbxBytes);
    const pathname = indexer.entries.find((entry) => entry.path === "aaaa0001/pathname");
    assert.equal(Buffer.from(pathname.inline).toString("utf-8"), "Assets/Models/Rock.fbx");
  }
});
test("tar \u7D22\u5F15\uFF1A\u652F\u6301 GNU \u957F\u6587\u4EF6\u540D\uFF0C\u622A\u65AD\u7684\u5305\u4F1A\u62A5\u9519", () => {
  const longName = `${"deep/".repeat(30)}file.bin`;
  const tar = buildTar([
    { name: "././@LongLink", content: `${longName}\0`, type: "L" },
    { name: "short", content: Buffer.alloc(10, 1) }
  ]);
  const indexer = new TarIndexer();
  indexer.write(tar);
  indexer.finish();
  assert.equal(indexer.entries.length, 1);
  assert.equal(indexer.entries[0].path, longName);
  const truncated = new TarIndexer();
  truncated.write(sampleTar.subarray(0, 700));
  assert.throws(() => truncated.finish(), /截断/);
});
test("\u8D44\u6E90\u5305\u4F1A\u8BDD\uFF1A\u6D41\u5F0F\u89E3\u538B\u5230\u4E34\u65F6\u6587\u4EF6\uFF0C\u6309\u504F\u79FB\u8BFB\u53D6\uFF0C\u5173\u95ED\u540E\u6E05\u7406", async () => {
  const dir = fs2.mkdtempSync(path2.join(os.tmpdir(), "t3d-pkg-test-"));
  const staging = path2.join(dir, "staging");
  const pkgPath = path2.join(dir, "sample.unitypackage");
  fs2.writeFileSync(pkgPath, zlib2.gzipSync(sampleTar));
  const sessions = new PackageArchiveSessions(staging);
  try {
    const progress = [];
    const opened = await sessions.open("session_one", pkgPath, (done) => progress.push(done));
    assert.equal(opened.tarBytes, sampleTar.length);
    assert.ok(progress.length > 0);
    assert.equal(fs2.readdirSync(staging).length, 1, "\u89E3\u538B\u51FA\u7684 tar \u5E94\u843D\u5728\u4E34\u65F6\u76EE\u5F55");
    const asset = opened.entries.find((entry) => entry.path === "aaaa0002/asset");
    const bytes = Buffer.from(await sessions.read("session_one", asset.offset, asset.size));
    assert.deepEqual(bytes, pngBytes);
    await assert.rejects(sessions.read("session_one", opened.tarBytes - 10, 100), /越界/);
    await sessions.close("session_one");
    assert.equal(fs2.readdirSync(staging).length, 0, "\u5173\u95ED\u4F1A\u8BDD\u540E\u4E34\u65F6\u6587\u4EF6\u5E94\u88AB\u5220\u9664");
    await assert.rejects(sessions.read("session_one", 0, 10), /已关闭/);
    await assert.rejects(sessions.open("session_two", path2.join(dir, "sample.zip")), /unitypackage/);
    const broken = path2.join(dir, "broken.unitypackage");
    fs2.writeFileSync(broken, zlib2.gzipSync(sampleTar).subarray(0, 60));
    await assert.rejects(sessions.open("session_three", broken));
    assert.equal(fs2.readdirSync(staging).length, 0, "\u6253\u5F00\u5931\u8D25\u4E5F\u4E0D\u5E94\u7559\u4E0B\u4E34\u65F6\u6587\u4EF6");
  } finally {
    sessions.closeAllSync();
    fs2.rmSync(dir, { recursive: true, force: true });
  }
});
test("\u626B\u63CF\u5668\uFF1A\u6A21\u578B\u548C\u8D34\u56FE\u672C\u4F53\u5728\u626B\u63CF\u9636\u6BB5\u4E00\u6B21\u90FD\u4E0D\u8BFB\uFF0C\u6750\u8D28\u6587\u672C\u63D0\u524D\u8BFB\u597D", async () => {
  const indexer = new TarIndexer((entryPath) => entryPath.endsWith("/pathname") || entryPath.endsWith("/asset.meta"));
  indexer.write(sampleTar);
  indexer.finish();
  const reads = [];
  const sources = indexer.entries.map((entry) => ({
    path: entry.path,
    type: entry.type,
    size: entry.size,
    inline: entry.inline,
    read: async () => {
      reads.push(entry.path);
      return new Uint8Array(sampleTar.subarray(entry.offset, entry.offset + entry.size));
    }
  }));
  const result = await scanPackageArchive(sources);
  assert.deepEqual(result.entries.map((entry) => entry.kind).sort(), ["material", "model", "texture"]);
  assert.deepEqual(reads, ["aaaa0003/asset"], "\u626B\u63CF\u9636\u6BB5\u53EA\u5E94\u8BFB\u6750\u8D28\u6587\u672C");
  const model = result.entries.find((entry) => entry.kind === "model");
  assert.equal(model.assetBytes, void 0);
  assert.equal(model.sizeBytes, fbxBytes.length);
  assert.equal(model.companionFiles.length, 1, "\u540C\u76EE\u5F55\u8D34\u56FE\u5E94\u767B\u8BB0\u4E3A\u4F34\u968F\u6587\u4EF6");
  assert.deepEqual(Buffer.from(await model.readAsset()), fbxBytes);
  assert.deepEqual(Buffer.from(await model.companionFiles[0].read()), pngBytes);
  const material = result.entries.find((entry) => entry.kind === "material");
  assert.equal(new TextDecoder().decode(material.assetBytes), matText);
});
test("\u663E\u5B58\u9884\u7B97\uFF1A\u8D85\u9884\u7B97\u624D\u964D\u7EA7\uFF0C\u964D\u7EA7\u540E\u7684\u57FA\u51C6\u7EA7\u5FC5\u987B\u662F 4 \u7684\u500D\u6570\u4E14\u4E0D\u5C0F\u4E8E 256", () => {
  const levels = [2048, 1024, 512, 256, 128].map((size) => ({ width: size, height: size }));
  const budget = 1e3;
  assert.equal(chooseMipSkip(500, budget, levels), 0);
  assert.equal(chooseMipSkip(999, budget, levels), 0);
  assert.equal(chooseMipSkip(1e3, budget, levels), 1);
  assert.equal(chooseMipSkip(1300, budget, levels), 2);
  assert.equal(chooseMipSkip(5e3, budget, levels.slice(2)), 1);
  assert.equal(chooseMipSkip(5e3, budget, levels.slice(3)), 0);
  assert.equal(chooseMipSkip(5e3, budget, [{ width: 1020, height: 1020 }, { width: 510, height: 510 }]), 0);
  assert.equal(estimateRgbaBytes(1024, 1024, false), 1024 * 1024 * 4);
  assert.equal(estimateRgbaBytes(1024, 1024, true), Math.round(1024 * 1024 * 4 * 4 / 3));
  assert.equal(canRestoreDegraded(400, 1e3, [{ bytes: 100, skip: 1 }]), true);
  assert.equal(canRestoreDegraded(700, 1e3, [{ bytes: 100, skip: 1 }]), false);
  assert.equal(canRestoreDegraded(100, 1e3, []), false);
});
test("\u52A0\u8F7D\u5931\u8D25\u95F8\u95E8\uFF1A\u9694\u4E00\u6BB5\u65F6\u95F4\u91CD\u8BD5\uFF0C\u8FDE\u7EED\u4E09\u6B21\u540E\u505C\u6B62\u5E76\u53EA\u4E0A\u62A5\u4E00\u6B21\uFF0C\u5185\u5BB9\u53D8\u4E86\u91CD\u65B0\u6765", () => {
  let now = 0;
  const reports = [];
  setLoadFailureReporter((info) => reports.push(`${info.kind}:${info.name}`));
  const gate = createLoadFailureGate("\u8D34\u56FE", () => now);
  assert.equal(gate.shouldTry("a", "h1"), true);
  gate.fail("a", "h1", "\u77F3\u5934", new Error("\u574F\u6587\u4EF6"));
  assert.equal(gate.shouldTry("a", "h1"), false, "\u521A\u5931\u8D25\u4E0D\u5E94\u7ACB\u523B\u91CD\u8BD5");
  now += 2e3;
  assert.equal(gate.shouldTry("a", "h1"), true);
  gate.fail("a", "h1", "\u77F3\u5934", new Error("\u574F\u6587\u4EF6"));
  now += 8e3;
  assert.equal(gate.shouldTry("a", "h1"), true);
  gate.fail("a", "h1", "\u77F3\u5934", new Error("\u574F\u6587\u4EF6"));
  now += 10 * 60 * 1e3;
  assert.equal(gate.shouldTry("a", "h1"), false, "\u4E09\u6B21\u540E\u4E0D\u518D\u81EA\u52A8\u91CD\u8BD5");
  assert.deepEqual(reports, ["\u8D34\u56FE:\u77F3\u5934"]);
  assert.deepEqual(gate.failed(), [{ assetId: "a", message: "\u574F\u6587\u4EF6" }]);
  assert.equal(gate.shouldTry("a", "h2"), true, "\u5185\u5BB9\u53D8\u4E86\u5E94\u91CD\u65B0\u5C1D\u8BD5");
  gate.fail("a", "h2", "\u77F3\u5934", new Error("\u574F\u6587\u4EF6"));
  gate.clear("a");
  assert.equal(gate.shouldTry("a", "h2"), true);
  setLoadFailureReporter(null);
});
test("BC7 \u6210\u54C1\u6253\u5305\u4E0E\u5BFC\u51FA\u5C3A\u5BF8\u88C1\u526A\uFF1A\u8D85\u4E0A\u9650\u65F6\u88C1\u6389\u6700\u9AD8\u7EA7\uFF0C\u4F46\u57FA\u51C6\u7EA7\u4FDD\u6301 4 \u7684\u500D\u6570", () => {
  const mips = [1024, 512, 256, 4, 2, 1].map((size) => ({
    width: size,
    height: size,
    data: new Uint8Array(Math.max(1, size / 4) * Math.max(1, size / 4) * 16)
  }));
  const packed = packBc7Artifact(1024, 1024, mips);
  const unpacked = unpackBc7Artifact(packed);
  assert.equal(unpacked.width, 1024);
  assert.equal(unpacked.mips.length, 6);
  const trimmed512 = unpackBc7Artifact(trimBc7ArtifactToMaxSize(packed, 512));
  assert.equal(trimmed512.width, 512);
  assert.equal(trimmed512.mips.length, 5);
  const trimmedTiny = unpackBc7Artifact(trimBc7ArtifactToMaxSize(packed, 1));
  assert.equal(trimmedTiny.width, 4);
  assert.equal(trimmedTiny.mips.length, 3);
});
