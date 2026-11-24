if(typeof globalThis.localStorage==="undefined"){const m=new Map();globalThis.localStorage={get length(){return m.size},clear:()=>m.clear(),getItem:k=>m.get(k)??null,key:i=>[...m.keys()][i]??null,removeItem:k=>{m.delete(k)},setItem:(k,v)=>{m.set(k,String(v))}};}if(typeof globalThis.document==="undefined"){globalThis.document={documentElement:{style:{}}};}

// tests/ai-knowledge-loader.test.ts
import assert from "node:assert/strict";
import test from "node:test";

// src/ai/knowledge/frontmatter.ts
function unquote(raw) {
  const text = raw.trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if (first === '"' && last === '"' || first === "'" && last === "'") return text.slice(1, -1);
  }
  return text;
}
function splitKeyValue(line) {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim();
  if (!/^[A-Za-z_][\w-]*$/.test(key)) return null;
  return { key, value: unquote(line.slice(idx + 1)) };
}
function parseFrontmatter(markdown) {
  const text = markdown.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { values: {}, files: [], body: text, hasFrontmatter: false };
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) {
    return { values: {}, files: [], body: text, hasFrontmatter: false };
  }
  const values = {};
  const files = [];
  let listKey = null;
  let current = null;
  for (const rawLine of lines.slice(1, end)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indented = /^\s/.test(rawLine);
    const line = rawLine.trim();
    if (!indented && !line.startsWith("-")) {
      const kv = splitKeyValue(line);
      if (!kv) continue;
      current = null;
      if (kv.value === "") {
        listKey = kv.key;
      } else {
        listKey = null;
        values[kv.key] = kv.value;
      }
      continue;
    }
    if (listKey !== "files") continue;
    if (line.startsWith("-")) {
      const rest = line.slice(1).trim();
      const kv = splitKeyValue(rest);
      if (kv && (kv.key === "path" || kv.key === "attachTo")) {
        current = { path: "" };
        if (kv.key === "path") current.path = kv.value;
        else current.attachTo = kv.value;
      } else {
        current = { path: unquote(rest) };
      }
      files.push(current);
      continue;
    }
    if (current) {
      const kv = splitKeyValue(line);
      if (kv?.key === "path") current.path = kv.value;
      if (kv?.key === "attachTo") current.attachTo = kv.value;
    }
  }
  return {
    values,
    files: files.filter((file) => file.path),
    body: lines.slice(end + 1).join("\n").replace(/^\n+/, ""),
    hasFrontmatter: true
  };
}
function firstHeading(markdown) {
  const line = markdown.split(/\r?\n/).find((item) => /^#{1,6}\s+/.test(item));
  return line ? line.replace(/^#{1,6}\s+/, "").trim() : "";
}

// src/ai/knowledge/types.ts
var KNOWLEDGE_LIMITS = {
  rulesChars: 4e3,
  requirementsChars: 8e3,
  designChars: 8e3,
  descriptionChars: 120,
  catalogEntries: 60,
  checks: 8
};

// src/ai/knowledge/loader.ts
var ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
var SOURCE_RANK = { builtin: 0, user: 1, project: 2 };
function joinPath(root, relative) {
  const rel = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  const base = root.replace(/[\\/]+$/, "");
  return rel ? `${base}/${rel}` : base;
}
function isSafeRelativePath(relative) {
  const rel = relative.replace(/\\/g, "/").trim();
  if (!rel || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return false;
  return rel.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
function truncate(text, limit) {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}
\u2026\uFF08\u8D85\u51FA ${limit} \u5B57\u7B26\u4E0A\u9650\uFF0C\u540E\u7EED\u5185\u5BB9\u672A\u6CE8\u5165\uFF09`, truncated: true };
}
function describeIssues(entry, hadName, hadDescription) {
  if (!ID_PATTERN.test(entry.id)) entry.issues.push("ID \u53EA\u80FD\u4F7F\u7528\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u8FDE\u5B57\u7B26");
  if (!hadName) entry.issues.push("\u7F3A\u5C11 name");
  if (!hadDescription) entry.issues.push("\u7F3A\u5C11 description\uFF08AI \u53EA\u51ED\u8FD9\u4E00\u884C\u5224\u65AD\u662F\u5426\u8BFB\u53D6\uFF09");
  if (entry.description.length > KNOWLEDGE_LIMITS.descriptionChars) {
    entry.issues.push(`description \u8D85\u8FC7 ${KNOWLEDGE_LIMITS.descriptionChars} \u5B57\uFF0C\u76EE\u5F55\u4E2D\u5DF2\u622A\u65AD`);
  }
  for (const file of entry.files) {
    if (!isSafeRelativePath(file.path)) entry.issues.push(`\u9644\u5E26\u6587\u4EF6\u8DEF\u5F84\u4E0D\u5408\u6CD5\uFF1A${file.path}`);
  }
}
function parseSkillMarkdown(id, source, markdown, location = {}) {
  const fm = parseFrontmatter(markdown);
  const name = fm.values.name?.trim() ?? "";
  const description = fm.values.description?.trim() ?? "";
  const files = fm.files.map((file) => ({
    path: file.path.replace(/\\/g, "/"),
    ...file.attachTo ? { attachTo: file.attachTo } : {}
  }));
  const entry = {
    id,
    kind: "skill",
    source,
    name: name || firstHeading(fm.body) || id,
    description: description || firstHeading(fm.body) || name || id,
    body: fm.body,
    files,
    ...location,
    ...fm.values.command?.trim() ? { command: fm.values.command.trim() } : {},
    issues: []
  };
  describeIssues(entry, Boolean(name), Boolean(description));
  return entry;
}
function parseKnowledgeMarkdown(id, source, markdown, location = {}) {
  const fm = parseFrontmatter(markdown);
  const heading = firstHeading(fm.body);
  const name = fm.values.name?.trim() || heading || id;
  const description = fm.values.description?.trim() || heading || id;
  const entry = {
    id,
    kind: "knowledge",
    source,
    name,
    description,
    body: fm.body,
    files: [],
    ...location,
    issues: []
  };
  describeIssues(entry, true, Boolean(fm.values.description?.trim() || heading));
  return entry;
}
function parseRequirementChecks(markdown) {
  const checks = [];
  const issues = [];
  const pattern = /```t3d-check[^\n]*\n([\s\S]*?)```/g;
  let match;
  let index = 0;
  while ((match = pattern.exec(markdown)) !== null) {
    index += 1;
    try {
      const parsed = JSON.parse(match[1]);
      if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        issues.push(`\u7B2C ${index} \u4E2A\u9A8C\u6536\u5757\u7F3A\u5C11 steps \u6570\u7EC4`);
        continue;
      }
      checks.push({
        name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : `\u9A8C\u6536 ${index}`,
        steps: parsed.steps
      });
    } catch (error) {
      issues.push(`\u7B2C ${index} \u4E2A\u9A8C\u6536\u5757\u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (checks.length > KNOWLEDGE_LIMITS.checks) {
    issues.push(`\u9A8C\u6536\u5757\u8D85\u8FC7 ${KNOWLEDGE_LIMITS.checks} \u4E2A\uFF0C\u53EA\u6267\u884C\u524D ${KNOWLEDGE_LIMITS.checks} \u4E2A`);
  }
  return { checks: checks.slice(0, KNOWLEDGE_LIMITS.checks), issues };
}
async function scanSkills(fs, root, source) {
  const skillsDir = joinPath(root, "skills");
  const out = [];
  const dirs = (await fs.list(skillsDir)).filter((item) => item.kind === "directory");
  for (const dir of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const dirPath = joinPath(skillsDir, dir.name);
    const names = await fs.list(dirPath);
    const main = names.find((item) => item.kind === "file" && item.name.toLowerCase() === "skill.md");
    if (!main) continue;
    const absPath = joinPath(dirPath, main.name);
    try {
      const entry = parseSkillMarkdown(dir.name.toLowerCase(), source, await fs.readTextFile(absPath), { absPath, dirPath });
      const present = new Set(names.filter((item) => item.kind === "file").map((item) => item.name));
      for (const file of entry.files) {
        if (isSafeRelativePath(file.path) && !file.path.includes("/") && !present.has(file.path)) {
          entry.issues.push(`\u9644\u5E26\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${file.path}`);
        }
      }
      out.push(entry);
    } catch (error) {
      console.warn("[AI] \u8BFB\u53D6\u6280\u80FD\u5931\u8D25\uFF1A", absPath, error);
    }
  }
  return out;
}
async function scanKnowledge(fs, root, source) {
  const dir = joinPath(root, "knowledge");
  const out = [];
  const files = (await fs.list(dir)).filter((item) => item.kind === "file" && /\.md$/i.test(item.name));
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const absPath = joinPath(dir, file.name);
    try {
      const id = file.name.replace(/\.md$/i, "").toLowerCase();
      out.push(parseKnowledgeMarkdown(id, source, await fs.readTextFile(absPath), { absPath }));
    } catch (error) {
      console.warn("[AI] \u8BFB\u53D6\u77E5\u8BC6\u6587\u4EF6\u5931\u8D25\uFF1A", absPath, error);
    }
  }
  return out;
}
async function readRules(fs, root, source) {
  const absPath = joinPath(root, "rules.md");
  if (!await fs.exists(absPath)) return null;
  const raw = (await fs.readTextFile(absPath)).trim();
  if (!raw) return null;
  const cut = truncate(raw, KNOWLEDGE_LIMITS.rulesChars);
  return { source, absPath, text: cut.text, length: raw.length, truncated: cut.truncated };
}
async function readRequirements(fs, projectRoot) {
  const absPath = joinPath(projectRoot, "requirements.md");
  if (!await fs.exists(absPath)) return null;
  const raw = (await fs.readTextFile(absPath)).trim();
  if (!raw) return null;
  const cut = truncate(raw, KNOWLEDGE_LIMITS.requirementsChars);
  const { checks, issues } = parseRequirementChecks(raw);
  return { absPath, text: cut.text, length: raw.length, truncated: cut.truncated, checks, issues };
}
function mergeKnowledgeEntries(groups) {
  const winners = /* @__PURE__ */ new Map();
  const shadowed = [];
  for (const entry of groups.flat()) {
    const existing = winners.get(entry.id);
    if (!existing) {
      winners.set(entry.id, entry);
      continue;
    }
    const [win, lose] = SOURCE_RANK[entry.source] >= SOURCE_RANK[existing.source] ? [entry, existing] : [existing, entry];
    const overrides = Array.from(/* @__PURE__ */ new Set([...win.overrides ?? [], ...lose.overrides ?? [], lose.source]));
    winners.set(entry.id, { ...win, overrides });
    shadowed.push(lose);
  }
  return { entries: Array.from(winners.values()), shadowed };
}
async function loadKnowledgeSnapshot(options) {
  const { fs, builtin, projectRoot, userRoot } = options;
  const groups = [builtin];
  const rules = [];
  let requirements = null;
  const scanRoot = async (root, source) => {
    if (!fs) return;
    try {
      groups.push(await scanSkills(fs, root, source));
      groups.push(await scanKnowledge(fs, root, source));
      const rule = await readRules(fs, root, source);
      if (rule) rules.push(rule);
    } catch (error) {
      console.warn("[AI] \u626B\u63CF\u6269\u5C55\u76EE\u5F55\u5931\u8D25\uFF1A", root, error);
    }
  };
  if (userRoot) await scanRoot(userRoot, "user");
  if (projectRoot) {
    await scanRoot(joinPath(projectRoot, "ai"), "project");
    if (fs) {
      try {
        requirements = await readRequirements(fs, projectRoot);
      } catch (error) {
        console.warn("[AI] \u8BFB\u53D6 requirements.md \u5931\u8D25\uFF1A", error);
      }
    }
  }
  const { entries, shadowed } = mergeKnowledgeEntries(groups);
  rules.sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source]);
  return { entries, shadowed, rules, requirements, projectRoot, userRoot, scannedAt: Date.now() };
}
function findKnowledgeEntry(snapshot, rawId, disabledIds = /* @__PURE__ */ new Set()) {
  const key = rawId.trim().toLowerCase();
  if (!key) return null;
  const usable = snapshot.entries.filter((entry) => entry.source === "builtin" || !disabledIds.has(entry.id));
  return usable.find((entry) => entry.id === key) ?? // 兼容旧用法：用脚本 ID 查内置范例
  usable.find((entry) => entry.files.some((file) => file.path.replace(/\.ts$/i, "").toLowerCase() === key)) ?? null;
}
async function readKnowledgeFile(entry, relative, fs) {
  const rel = relative.replace(/\\/g, "/").trim();
  const embedded = entry.files.find((file) => file.path === rel && typeof file.source === "string");
  if (embedded?.source !== void 0) return { ok: true, source: embedded.source };
  if (!isSafeRelativePath(rel)) return { ok: false, message: `\u6587\u4EF6\u8DEF\u5F84\u4E0D\u5408\u6CD5\uFF1A${relative}` };
  if (!entry.dirPath || !fs) return { ok: false, message: `\u6761\u76EE "${entry.id}" \u6CA1\u6709\u9644\u5E26\u6587\u4EF6 ${relative}` };
  const absPath = joinPath(entry.dirPath, rel);
  if (!await fs.exists(absPath)) return { ok: false, message: `\u9644\u5E26\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${relative}` };
  return { ok: true, source: await fs.readTextFile(absPath) };
}
var SOURCE_LABEL = { builtin: "\u5185\u7F6E", user: "\u7528\u6237\u5168\u5C40", project: "\u5DE5\u7A0B" };
function listExtensionCatalog(snapshot, disabledIds = /* @__PURE__ */ new Set()) {
  return snapshot.entries.filter((entry) => entry.source !== "builtin" && !disabledIds.has(entry.id)).sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source] || a.id.localeCompare(b.id)).slice(0, KNOWLEDGE_LIMITS.catalogEntries);
}
function formatKnowledgeContext(snapshot, disabledIds = /* @__PURE__ */ new Set()) {
  const sections = [];
  const injection = { rules: [], requirements: false, checks: 0, skills: 0, knowledge: 0, truncated: [] };
  for (const rule of snapshot.rules) {
    const label = rule.source === "project" ? "\u5DE5\u7A0B\u89C4\u5219\uFF08ai/rules.md\uFF09" : "\u7528\u6237\u5168\u5C40\u89C4\u5219\uFF08rules.md\uFF09";
    sections.push(`${label}\uFF1A\u5FC5\u987B\u9075\u5B88\u3002
${rule.text}`);
    injection.rules.push(rule.source === "project" ? "\u5DE5\u7A0B\u89C4\u5219" : "\u7528\u6237\u5168\u5C40\u89C4\u5219");
    if (rule.truncated) injection.truncated.push(label);
  }
  if (snapshot.requirements) {
    const req = snapshot.requirements;
    sections.push(
      `\u9700\u6C42\u4E0E\u9A8C\u6536\uFF08requirements.md\uFF09\uFF1A\u505A\u4E2D\u5927\u578B\u4EFB\u52A1\u65F6\u4EE5\u5B83\u4E3A\u76EE\u6807\uFF0C\u6536\u5C3E\u65F6\u9010\u6761\u5BF9\u7167\u5E76\u5728\u603B\u7ED3\u91CC\u8BF4\u660E\u6BCF\u6761\u662F\u5426\u6EE1\u8DB3\u3002${req.checks.length > 0 ? `\u5176\u4E2D ${req.checks.length} \u6761 t3d-check \u9A8C\u6536\u5757\u4F1A\u5728\u4F60\u7ED3\u675F\u65F6\u7531\u7CFB\u7EDF\u81EA\u52A8\u6267\u884C\u3002` : ""}
${req.text}`
    );
    injection.requirements = true;
    injection.checks = req.checks.length;
    if (req.truncated) injection.truncated.push("requirements.md");
  }
  const catalog = listExtensionCatalog(snapshot, disabledIds);
  if (catalog.length > 0) {
    const lines = catalog.map((entry) => {
      const desc = entry.description.length > KNOWLEDGE_LIMITS.descriptionChars ? `${entry.description.slice(0, KNOWLEDGE_LIMITS.descriptionChars)}\u2026` : entry.description;
      const kind = entry.kind === "skill" ? "\u6280\u80FD" : "\u77E5\u8BC6";
      const override = entry.overrides?.includes("builtin") ? "\uFF0C\u5DF2\u8986\u76D6\u540C\u540D\u5185\u7F6E\u8303\u4F8B" : "";
      return `- ${entry.id}\uFF1A${desc}\uFF08${SOURCE_LABEL[entry.source]}${kind}${override}\uFF09`;
    });
    sections.push(
      `\u6269\u5C55\u6280\u80FD\u4E0E\u77E5\u8BC6\u76EE\u5F55\uFF08\u4E0E\u4EFB\u52A1\u76F8\u5173\u65F6\u5148\u7528 kb__read({ id }) \u8BFB\u53D6\u5168\u6587\u518D\u52A8\u624B\uFF1B\u9644\u5E26\u6E90\u7801\u7528 kb__read({ id, file }) \u8BFB\u53D6\uFF09\uFF1A
${lines.join("\n")}`
    );
    injection.skills = catalog.filter((entry) => entry.kind === "skill").length;
    injection.knowledge = catalog.filter((entry) => entry.kind === "knowledge").length;
  }
  return { text: sections.join("\n"), injection };
}

// src/ai/knowledge/recipes.ts
var THIRD_PERSON_CONTROLLER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u7B2C\u4E09\u4EBA\u79F0\u89D2\u8272\u63A7\u5236",
  description: "WASD \u76F8\u5BF9\u76F8\u673A\u79FB\u52A8\u3001\u7A7A\u683C\u8DF3\u8DC3\u3001Shift \u5954\u8DD1\uFF0C\u5E76\u6309\u901F\u5EA6\u5207\u6362\u5F85\u673A/\u884C\u8D70/\u5954\u8DD1\u52A8\u753B",
  params: {
    idleClip: { type: "ref", target: "clip", label: "\u5F85\u673A\u526A\u8F91", default: null },
    walkClip: { type: "ref", target: "clip", label: "\u884C\u8D70\u526A\u8F91", default: null },
    runClip: { type: "ref", target: "clip", label: "\u5954\u8DD1\u526A\u8F91", default: null },
    walkSpeed: { type: "number", label: "\u884C\u8D70\u901F\u5EA6", default: 3.2 },
    runSpeed: { type: "number", label: "\u5954\u8DD1\u901F\u5EA6", default: 6.5 },
    turnSpeed: { type: "number", label: "\u8F6C\u8EAB\u901F\u5EA6", default: 12 },
    jumpSpeed: { type: "number", label: "\u8DF3\u8DC3\u521D\u901F", default: 5.2 },
    gravity: { type: "number", label: "\u91CD\u529B\u52A0\u901F\u5EA6", default: 14 },
    groundY: { type: "number", label: "\u5730\u9762\u9AD8\u5EA6", default: 0 },
  },
  state: () => ({ velY: 0, grounded: true, clip: "" }),
  onStart(self) {
    self.addTag("player")
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    const pos = self.position

    // 1) \u8F93\u5165\uFF1AmoveDirection \u76F4\u63A5\u7ED9\u51FA\u300C\u76F8\u5BF9\u5F53\u524D\u76F8\u673A\u300D\u7684\u4E16\u754C\u6C34\u5E73\u65B9\u5411\uFF08W = \u753B\u9762\u8FDC\u5904\uFF09\uFF0C
    //    \u65B9\u4F4D\u89D2\u7531\u5F15\u64CE\u6309\u76F8\u673A\u89C6\u7EBF\u7B97\u597D\uFF0C\u4E0D\u8981\u81EA\u5DF1\u4ECE\u76F8\u673A\u65CB\u8F6C\u91CC\u63A8
    const dir = self.input.moveDirection("Move")
    let mx = dir.x
    let mz = dir.z
    const mLen = Math.hypot(mx, mz)
    const moving = mLen > 0.05
    const sprinting = moving && self.input.isPressed("Sprint")
    const speed = sprinting ? p.runSpeed : p.walkSpeed
    if (moving) {
      mx /= mLen
      mz /= mLen
    }

    // 3) \u8DF3\u8DC3\u4E0E\u91CD\u529B\uFF08\u624B\u52A8\u79EF\u5206\uFF0C\u4E0D\u4F9D\u8D56\u7269\u7406\u80FD\u529B\u5305\uFF09
    if (s.grounded && self.input.justPressed("Jump")) {
      s.velY = p.jumpSpeed
      s.grounded = false
    }
    s.velY -= p.gravity * dt
    let y = pos.y + s.velY * dt
    if (y <= p.groundY) {
      y = p.groundY
      s.velY = 0
      s.grounded = true
    }

    // 4) \u4F4D\u7F6E\u5FC5\u987B\u6574\u4F53\u8D4B\u503C
    self.position = {
      x: pos.x + (moving ? mx * speed * dt : 0),
      y,
      z: pos.z + (moving ? mz * speed * dt : 0),
    }

    // 5) \u5E73\u6ED1\u8F6C\u5411\u79FB\u52A8\u65B9\u5411\uFF08self.rotation \u4E3A\u5F27\u5EA6\uFF1Byaw=0 \u65F6\u671D +Z\uFF09
    if (moving) {
      const targetYaw = Math.atan2(mx, mz)
      const rot = self.rotation
      let diff = targetYaw - rot.y
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      const k = Math.min(1, p.turnSpeed * dt)
      self.rotation = { x: rot.x, y: rot.y + diff * k, z: rot.z }
    }

    // 6) \u53EA\u5728\u76EE\u6807\u526A\u8F91\u53D8\u5316\u65F6\u5207\u6362\u52A8\u753B\uFF0C\u907F\u514D\u6BCF\u5E27\u91CD\u64AD
    const next = moving ? (sprinting ? p.runClip || p.walkClip : p.walkClip) : p.idleClip
    if (next && next !== s.clip) {
      s.clip = next
      self.anim.playBody(next, { loop: true, fade: 0.15 })
    }
  },
})
`;
var FOLLOW_CAMERA = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u8DDF\u968F\u76F8\u673A",
  description: "\u5E73\u6ED1\u8DDF\u968F\u76EE\u6807\u5E76\u59CB\u7EC8\u770B\u5411\u5B83\uFF1B\u6309\u4F4F\u9F20\u6807\u53F3\u952E\u62D6\u52A8\u53EF\u73AF\u7ED5",
  params: {
    target: { type: "ref", target: "node", label: "\u8DDF\u968F\u76EE\u6807", default: null },
    distance: { type: "number", label: "\u6C34\u5E73\u8DDD\u79BB", default: 6 },
    height: { type: "number", label: "\u76F8\u673A\u9AD8\u5EA6", default: 3.2 },
    lookHeight: { type: "number", label: "\u6CE8\u89C6\u70B9\u9AD8\u5EA6", default: 1.2 },
    smooth: { type: "number", label: "\u8DDF\u968F\u5E73\u6ED1\u5EA6", default: 8 },
    orbitSpeed: { type: "number", label: "\u73AF\u7ED5\u7075\u654F\u5EA6", default: 0.005 },
  },
  state: () => ({ yaw: 0 }),
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (!p.target) return

    if (self.input.isMouseButtonPressed(2)) {
      s.yaw -= self.input.pointerDelta().x * p.orbitSpeed
    }

    const t = p.target.position
    // yaw=0 \u65F6\u76F8\u673A\u4F4D\u4E8E\u76EE\u6807\u7684 -Z \u4FA7\uFF0C\u770B\u5411 +Z\uFF08\u4E0E\u89D2\u8272\u9ED8\u8BA4\u671D\u5411\u4E00\u81F4\uFF09
    const want = {
      x: t.x - Math.sin(s.yaw) * p.distance,
      y: t.y + p.height,
      z: t.z - Math.cos(s.yaw) * p.distance,
    }
    const k = 1 - Math.exp(-p.smooth * dt)
    const cur = self.position
    self.position = {
      x: cur.x + (want.x - cur.x) * k,
      y: cur.y + (want.y - cur.y) * k,
      z: cur.z + (want.z - cur.z) * k,
    }
    self.lookAt({ x: t.x, y: t.y + p.lookHeight, z: t.z })
  },
})
`;
var WAVE_SPAWNER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u6CE2\u6B21\u5237\u602A",
  description: "\u6309\u6CE2\u6B21\u4ECE\u9690\u85CF\u6A21\u677F\u8282\u70B9\u6C60\u5316\u751F\u6210\u654C\u4EBA\uFF0C\u5E76\u628A\u5F53\u524D\u6CE2\u6B21\u5199\u5165\u754C\u9762\u53D8\u91CF",
  params: {
    template: { type: "ref", target: "node", label: "\u654C\u4EBA\u6A21\u677F\uFF08\u9690\u85CF\u8282\u70B9\uFF09", default: null },
    spawnRadius: { type: "number", label: "\u751F\u6210\u534A\u5F84", default: 12 },
    firstWaveCount: { type: "number", label: "\u9996\u6CE2\u6570\u91CF", default: 3 },
    countPerWave: { type: "number", label: "\u6BCF\u6CE2\u9012\u589E", default: 2 },
    spawnInterval: { type: "number", label: "\u5355\u53EA\u95F4\u9694(\u79D2)", default: 0.6 },
    waveGap: { type: "number", label: "\u6CE2\u6B21\u95F4\u9694(\u79D2)", default: 4 },
    maxAlive: { type: "number", label: "\u540C\u5C4F\u4E0A\u9650", default: 20 },
    waveVar: { type: "string", label: "\u6CE2\u6B21\u754C\u9762\u53D8\u91CF", default: "wave" },
  },
  state: () => ({ wave: 0, toSpawn: 0, spawnTimer: 0, gapTimer: 1 }),
  onStart(self) {
    if (self.params.template) self.pool.preload(self.params.template, 6)
    self.ui.setVar(self.params.waveVar, 0)
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (!p.template) return
    const alive = self.pool.stats(p.template).active

    // \u672C\u6CE2\u5DF2\u5237\u5B8C\u4E14\u573A\u4E0A\u6E05\u7A7A -> \u5012\u8BA1\u65F6\u8FDB\u5165\u4E0B\u4E00\u6CE2
    if (s.toSpawn <= 0) {
      if (alive > 0) return
      s.gapTimer -= dt
      if (s.gapTimer > 0) return
      s.wave += 1
      s.toSpawn = p.firstWaveCount + (s.wave - 1) * p.countPerWave
      s.spawnTimer = 0
      s.gapTimer = p.waveGap
      self.ui.setVar(p.waveVar, s.wave)
      self.broadcast("waveStarted", { wave: s.wave })
      return
    }

    s.spawnTimer -= dt
    if (s.spawnTimer > 0 || alive >= p.maxAlive) return
    s.spawnTimer = p.spawnInterval
    s.toSpawn -= 1

    const angle = Math.random() * Math.PI * 2
    const center = self.position
    self.pool.acquire(p.template, {
      position: {
        x: center.x + Math.cos(angle) * p.spawnRadius,
        y: center.y,
        z: center.z + Math.sin(angle) * p.spawnRadius,
      },
      payload: { wave: s.wave },
    })
  },
})
`;
var CHASE_ENEMY = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u8FFD\u51FB\u654C\u4EBA",
  description: "\u8FFD\u5411\u5E26\u6307\u5B9A\u6807\u7B7E\u7684\u76EE\u6807\uFF0C\u8D34\u8EAB\u540E\u6309\u95F4\u9694\u9020\u6210\u4F24\u5BB3\uFF1B\u6536\u5230 hit \u6D88\u606F\u6263\u8840\uFF0C\u6B7B\u4EA1\u540E\u56DE\u6C60",
  params: {
    targetTag: { type: "string", label: "\u76EE\u6807\u6807\u7B7E", default: "player" },
    speed: { type: "number", label: "\u79FB\u52A8\u901F\u5EA6", default: 2.4 },
    maxHp: { type: "number", label: "\u751F\u547D\u503C", default: 3 },
    damage: { type: "number", label: "\u653B\u51FB\u4F24\u5BB3", default: 10 },
    attackRange: { type: "number", label: "\u653B\u51FB\u8DDD\u79BB", default: 1.3 },
    attackInterval: { type: "number", label: "\u653B\u51FB\u95F4\u9694(\u79D2)", default: 0.8 },
    score: { type: "number", label: "\u51FB\u6740\u5F97\u5206", default: 10 },
  },
  state: () => ({ hp: 1, cooldown: 0, alive: false }),
  onStart(self) {
    // \u9690\u85CF\u7684\u6A21\u677F\u8282\u70B9\u81EA\u8EAB\u4E5F\u4F1A\u6267\u884C\u811A\u672C\uFF1A\u4E0D\u53EF\u89C1\u65F6\u4E0D\u8981\u6FC0\u6D3B\u3001\u66F4\u4E0D\u8981\u6253\u6807\u7B7E
    if (!self.visible) return
    self.state.hp = self.params.maxHp
    self.state.alive = true
    self.addTag("enemy")
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (!s.alive || !self.visible) return

    const target = self.findNodesByTag(p.targetTag)[0]
    if (!target || !target.visible) return

    s.cooldown -= dt
    const dist = self.distanceTo(target)
    if (dist > p.attackRange) {
      self.moveToward(target, p.speed * dt, { faceTarget: true, planeXZ: true })
      return
    }
    self.lookAt(target, { yOnly: true })
    if (s.cooldown <= 0) {
      s.cooldown = p.attackInterval
      target.sendMessage("damage", { amount: p.damage })
    }
  },
  onMessage(self, msg) {
    const s = self.state
    if (msg.name !== "hit" || !s.alive) return
    const payload = msg.payload
    const amount = payload && typeof payload === "object" && "damage" in payload ? Number(payload.damage) : 1
    s.hp -= amount
    self.tween.punchScale(0.25, 0.15)
    if (s.hp > 0) return
    s.alive = false
    self.broadcast("enemyKilled", { score: self.params.score })
    // \u6C60\u5316\u5BF9\u8C61\u8C03\u7528 destroy \u4F1A\u81EA\u52A8\u56DE\u6C60
    self.node.destroy()
  },
})
`;
var PLAYER_SHOOTER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u73A9\u5BB6\u5C04\u51FB",
  description: "\u6309\u4F4F\u653B\u51FB\u952E\u6CBF\u89D2\u8272\u671D\u5411\u8FDE\u7EED\u53D1\u5C04\u6C60\u5316\u5B50\u5F39",
  params: {
    bullet: { type: "ref", target: "node", label: "\u5B50\u5F39\u6A21\u677F\uFF08\u9690\u85CF\u8282\u70B9\uFF09", default: null },
    fireInterval: { type: "number", label: "\u5C04\u51FB\u95F4\u9694(\u79D2)", default: 0.18 },
    muzzleHeight: { type: "number", label: "\u67AA\u53E3\u9AD8\u5EA6", default: 1.1 },
    muzzleForward: { type: "number", label: "\u67AA\u53E3\u524D\u4F38", default: 0.7 },
  },
  state: () => ({ cooldown: 0 }),
  onStart(self) {
    if (self.params.bullet) self.pool.preload(self.params.bullet, 12)
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    s.cooldown -= dt
    if (!p.bullet || s.cooldown > 0) return
    if (!self.input.isPressed("Attack") && !self.input.isMouseButtonPressed(0)) return
    s.cooldown = p.fireInterval

    const pos = self.position
    const dir = self.forward
    self.pool.acquire(p.bullet, {
      position: {
        x: pos.x + dir.x * p.muzzleForward,
        y: pos.y + p.muzzleHeight,
        z: pos.z + dir.z * p.muzzleForward,
      },
      rotation: self.rotation,
      payload: { dir },
    })
  },
})
`;
var BULLET = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u5B50\u5F39",
  description: "\u6CBF\u53D1\u5C04\u65B9\u5411\u76F4\u7EBF\u98DE\u884C\uFF0C\u547D\u4E2D\u5E26\u76EE\u6807\u6807\u7B7E\u7684\u8282\u70B9\u540E\u53D1\u9001 hit \u6D88\u606F\u5E76\u56DE\u6C60",
  params: {
    speed: { type: "number", label: "\u98DE\u884C\u901F\u5EA6", default: 22 },
    life: { type: "number", label: "\u5B58\u6D3B\u65F6\u95F4(\u79D2)", default: 2 },
    damage: { type: "number", label: "\u4F24\u5BB3", default: 1 },
    hitRadius: { type: "number", label: "\u547D\u4E2D\u534A\u5F84", default: 0.7 },
    targetTag: { type: "string", label: "\u76EE\u6807\u6807\u7B7E", default: "enemy" },
  },
  state: () => ({ dx: 0, dz: 1, age: 0, live: false }),
  onSpawn(self, payload) {
    const s = self.state
    const dir = payload && typeof payload === "object" && "dir" in payload ? payload.dir : null
    const fallback = self.forward
    s.dx = dir && typeof dir === "object" && "x" in dir ? Number(dir.x) : fallback.x
    s.dz = dir && typeof dir === "object" && "z" in dir ? Number(dir.z) : fallback.z
    s.age = 0
    s.live = true
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    // \u6A21\u677F\u8282\u70B9\u672C\u8EAB\u4E0D\u53EF\u89C1\u4E14\u4ECE\u672A\u88AB onSpawn \u6FC0\u6D3B\uFF0C\u76F4\u63A5\u8DF3\u8FC7
    if (!s.live || !self.visible) return

    self.translate({ x: s.dx * p.speed * dt, y: 0, z: s.dz * p.speed * dt }, "world")
    s.age += dt

    const hit = self.findNodesInRadius(self.position, p.hitRadius, p.targetTag)[0]
    if (hit) {
      hit.sendMessage("hit", { damage: p.damage })
      s.live = false
      self.node.destroy()
      return
    }
    if (s.age >= p.life) {
      s.live = false
      self.node.destroy()
    }
  },
})
`;
var PLAYER_HEALTH = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u73A9\u5BB6\u751F\u547D",
  description: "\u63A5\u6536 damage \u6D88\u606F\u6263\u8840\u5E76\u540C\u6B65\u5230\u754C\u9762\u8FDB\u5EA6\u6761\uFF080~1\uFF09\uFF0C\u6B7B\u4EA1\u65F6\u5E7F\u64AD playerDied",
  params: {
    maxHp: { type: "number", label: "\u6700\u5927\u751F\u547D", default: 100 },
    hpVar: { type: "string", label: "\u751F\u547D\u754C\u9762\u53D8\u91CF(0~1)", default: "hp" },
    invincibleTime: { type: "number", label: "\u53D7\u51FB\u65E0\u654C(\u79D2)", default: 0.4 },
  },
  state: () => ({ hp: 100, invincible: 0, dead: false }),
  onStart(self) {
    self.addTag("player")
    self.state.hp = self.params.maxHp
    self.ui.setVar(self.params.hpVar, 1)
  },
  onUpdate(self, dt) {
    if (self.state.invincible > 0) self.state.invincible -= dt
  },
  onMessage(self, msg) {
    const p = self.params
    const s = self.state
    if (msg.name !== "damage" || s.dead || s.invincible > 0) return
    const payload = msg.payload
    const amount = payload && typeof payload === "object" && "amount" in payload ? Number(payload.amount) : 10
    s.hp = Math.max(0, s.hp - amount)
    s.invincible = p.invincibleTime
    // HUD \u6A21\u677F\u7684\u8FDB\u5EA6\u6761\u91CF\u7A0B\u662F 0~1
    self.ui.setVar(p.hpVar, s.hp / p.maxHp)
    self.tween.shakePosition(0.12, 0.2)
    if (s.hp > 0) return
    s.dead = true
    self.visible = false
    self.broadcast("playerDied")
  },
})
`;
var GAME_MANAGER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u5BF9\u5C40\u7BA1\u7406",
  description: "\u6C47\u603B\u5F97\u5206\u3001\u5904\u7406\u80DC\u8D1F\u5E76\u63A7\u5236\u7ED3\u7B97\u754C\u9762\u7684\u663E\u793A",
  params: {
    scoreVar: { type: "string", label: "\u5F97\u5206\u754C\u9762\u53D8\u91CF", default: "score" },
    targetScore: { type: "number", label: "\u80DC\u5229\u6240\u9700\u5F97\u5206(0=\u65E0\u4E0A\u9650)", default: 0 },
    resultScreen: { type: "string", label: "\u7ED3\u7B97\u754C\u9762\u5C4F\u5E55\u540D\u79F0", default: "\u7ED3\u7B97\u754C\u9762" },
    resultTitleVar: { type: "string", label: "\u7ED3\u7B97\u6807\u9898\u754C\u9762\u53D8\u91CF", default: "resultTitle" },
  },
  state: () => ({ score: 0, over: false }),
  onStart(self) {
    self.ui.setVar(self.params.scoreVar, 0)
    self.ui.hideScreen(self.params.resultScreen)
  },
  onMessage(self, msg) {
    const p = self.params
    const s = self.state
    if (s.over) return

    if (msg.name === "enemyKilled" || msg.name === "collected") {
      const payload = msg.payload
      const gain = payload && typeof payload === "object" && "score" in payload ? Number(payload.score) : 1
      s.score += gain
      self.ui.setVar(p.scoreVar, s.score)
      if (p.targetScore > 0 && s.score >= p.targetScore) {
        s.over = true
        self.ui.setVar(p.resultTitleVar, "\u80DC\u5229\uFF01")
        self.ui.showScreen(p.resultScreen)
        self.broadcast("gameOver", { win: true })
      }
      return
    }

    if (msg.name === "playerDied") {
      s.over = true
      self.ui.setVar(p.resultTitleVar, "\u5931\u8D25")
      self.ui.showScreen(p.resultScreen)
      self.broadcast("gameOver", { win: false })
    }
  },
})
`;
var COLLECTIBLE = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "\u53EF\u62FE\u53D6\u7269",
  description: "\u539F\u5730\u65CB\u8F6C\u6D6E\u52A8\uFF0C\u5E26\u6307\u5B9A\u6807\u7B7E\u7684\u8282\u70B9\u9760\u8FD1\u540E\u5E7F\u64AD collected \u5E76\u6D88\u5931",
  params: {
    pickerTag: { type: "string", label: "\u62FE\u53D6\u8005\u6807\u7B7E", default: "player" },
    radius: { type: "number", label: "\u62FE\u53D6\u534A\u5F84", default: 1.1 },
    score: { type: "number", label: "\u5F97\u5206", default: 1 },
    spinSpeed: { type: "number", label: "\u65CB\u8F6C\u901F\u5EA6(\u5F27\u5EA6/\u79D2)", default: 2.2 },
    bobHeight: { type: "number", label: "\u6D6E\u52A8\u5E45\u5EA6", default: 0.18 },
  },
  state: () => ({ baseY: 0, taken: false }),
  onStart(self) {
    self.state.baseY = self.position.y
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (s.taken) return

    self.rotateY(p.spinSpeed * dt)
    const pos = self.position
    self.position = { x: pos.x, y: s.baseY + Math.sin(self.elapsedTime * 3) * p.bobHeight, z: pos.z }

    const picker = self.findNodesInRadius(self.position, p.radius, p.pickerTag)[0]
    if (!picker) return
    s.taken = true
    self.broadcast("collected", { score: p.score })
    self.node.destroy()
  },
})
`;
var RECIPES = [
  {
    id: "third-person-controller",
    title: "\u7B2C\u4E09\u4EBA\u79F0\u89D2\u8272\u63A7\u5236\uFF08\u79FB\u52A8 / \u8DF3\u8DC3 / \u52A8\u753B\u5207\u6362\uFF09",
    summary: "WASD \u76F8\u5BF9\u76F8\u673A\u79FB\u52A8\u3001\u7A7A\u683C\u8DF3\u8DC3\u3001Shift \u5954\u8DD1\uFF0C\u6309\u72B6\u6001\u5207\u6362\u5F85\u673A/\u884C\u8D70/\u5954\u8DD1\u526A\u8F91",
    setup: [
      '\u89D2\u8272\u8282\u70B9\uFF1A\u5DF2\u6709\u8499\u76AE\u6A21\u578B\u5C31\u7528 kind:"model"\uFF1B\u6CA1\u6709\u6A21\u578B\u5C31\u7528 kind:"capsule"\uFF08\u6B64\u65F6\u4E09\u4E2A\u526A\u8F91\u53C2\u6570\u7559\u7A7A\u5373\u53EF\uFF09\u3002',
      "\u573A\u666F\u91CC\u8981\u6709\u4E00\u4E2A\u76F8\u673A\u8282\u70B9\uFF08\u5EFA\u8BAE\u540C\u65F6\u6302 follow-camera \u8303\u4F8B\uFF09\u3002",
      "script__create \u5199\u5165\u6E90\u7801\u540E\uFF0Cscript__attach \u5230\u89D2\u8272\uFF0Cparams \u4F20\u4E09\u4E2A\u526A\u8F91\u540D\uFF08\u6765\u81EA\u6A21\u578B\u6216\u52A8\u753B\u8D44\u4EA7\u7684 clips \u5217\u8868\uFF09\u3002\u79FB\u52A8\u65B9\u5411\u81EA\u52A8\u76F8\u5BF9\u5F53\u524D\u76F8\u673A\uFF0C\u4E0D\u9700\u8981\u4F20\u76F8\u673A\u3002",
      "\u5730\u9762\u4E0D\u5728 y=0 \u65F6\u628A groundY \u8BBE\u4E3A\u5730\u9762\u9AD8\u5EA6\u3002"
    ],
    files: [{ scriptId: "ThirdPersonController", attachTo: "\u73A9\u5BB6\u89D2\u8272\u8282\u70B9", source: THIRD_PERSON_CONTROLLER }],
    verify: 'playtest__run_smoke\uFF1A\u5148 input \u6CE8\u5165 {type:"axis",action:"Move",x:0,y:1}\uFF0Cstep 1 \u79D2\uFF0C\u518D assert nodeMoved\uFF08from \u4E3A\u89D2\u8272\u521D\u59CB\u4F4D\u7F6E\uFF0CminDistance 1\uFF09\u3002',
    pitfalls: [
      '\u526A\u8F91\u53C2\u6570\u5FC5\u987B\u662F ref(target:"clip")\uFF0C\u76F4\u63A5\u628A\u53C2\u6570\u503C\u4F20\u7ED9 self.anim.playBody\uFF0C\u5F15\u64CE\u4F1A\u81EA\u52A8\u5728\u6A21\u578B\u4E0E\u5916\u90E8\u52A8\u753B\u8D44\u4EA7\u91CC\u627E\u540C\u540D\u526A\u8F91\u3002',
      "\u4E0D\u8981\u6BCF\u5E27\u8C03\u7528 playBody\uFF0C\u53EA\u5728\u76EE\u6807\u526A\u8F91\u53D8\u5316\u65F6\u8C03\u7528\u3002",
      "\u76F8\u5BF9\u76F8\u673A\u7684\u79FB\u52A8\u4E00\u5F8B\u7528 self.input.moveDirection()\uFF1B\u4E0D\u8981\u8BFB\u76F8\u673A\u7684 rotation \u81EA\u5DF1\u7B97\u65B9\u4F4D\u89D2\uFF0C\u6B27\u62C9\u89D2\u5728\u76F8\u673A\u6709\u4FEF\u4EF0\u65F6\u4F1A\u7B97\u504F\u3002",
      "\u53EA\u9700\u8981\u6807\u51C6\u7684\u8D70/\u8DD1/\u8DF3\u52A0\u52A8\u753B\u5207\u6362\u65F6\uFF0C\u76F4\u63A5\u7528\u5185\u7F6E\u7EC4\u4EF6 character\uFF08gameplay__setCoreComponent\uFF09\u66F4\u7701\u4E8B\uFF1B\u9700\u8981\u81EA\u5B9A\u4E49\u79FB\u52A8\u624B\u611F\u624D\u7528\u8FD9\u4EFD\u811A\u672C\u3002"
    ]
  },
  {
    id: "follow-camera",
    title: "\u8DDF\u968F\u76F8\u673A\uFF08\u5E73\u6ED1\u8DDF\u968F + \u53F3\u952E\u73AF\u7ED5\uFF09",
    summary: "\u76F8\u673A\u5E73\u6ED1\u8DDF\u5728\u76EE\u6807\u8EAB\u540E\u5E76\u59CB\u7EC8\u6CE8\u89C6\u76EE\u6807",
    setup: [
      '\u521B\u5EFA kind:"camera" \u8282\u70B9\uFF0C\u521D\u59CB\u4F4D\u7F6E\u653E\u5728\u76EE\u6807\u540E\u4E0A\u65B9\u5373\u53EF\uFF08\u811A\u672C\u4F1A\u63A5\u7BA1\u4F4D\u7F6E\u4E0E\u671D\u5411\uFF09\u3002',
      "script__attach \u5230\u76F8\u673A\u8282\u70B9\uFF0Cparams.target \u4F20\u88AB\u8DDF\u968F\u7684\u8282\u70B9\u3002"
    ],
    files: [{ scriptId: "FollowCamera", attachTo: "\u76F8\u673A\u8282\u70B9", source: FOLLOW_CAMERA }],
    verify: "viewport__capture({ playSeconds: 0.8 })\uFF1A\u786E\u8BA4\u76EE\u6807\u4F4D\u4E8E\u753B\u9762\u4E2D\u4E0B\u90E8\u4E14\u6CA1\u6709\u88AB\u5730\u9762\u6216\u5899\u4F53\u906E\u6321\u3002",
    pitfalls: ["\u76F8\u673A\u671D\u5411\u4E00\u5F8B\u7528 self.lookAt\uFF0C\u4E0D\u8981\u624B\u7B97\u6B27\u62C9\u89D2\u3002"]
  },
  {
    id: "enemy-wave",
    title: "\u6CE2\u6B21\u5237\u602A + \u8FFD\u51FB\u654C\u4EBA\uFF08\u5BF9\u8C61\u6C60\uFF09",
    summary: "\u4ECE\u4E00\u4E2A\u9690\u85CF\u6A21\u677F\u8282\u70B9\u6C60\u5316\u751F\u6210\u654C\u4EBA\uFF0C\u654C\u4EBA\u8FFD\u51FB\u5E76\u653B\u51FB\u73A9\u5BB6\uFF0C\u53EF\u88AB hit \u6D88\u606F\u51FB\u6740",
    setup: [
      "\u654C\u4EBA\u6A21\u677F\uFF1A\u521B\u5EFA\u4E00\u4E2A\u654C\u4EBA\u8282\u70B9\uFF08\u6A21\u578B\u6216\u57FA\u7840\u51E0\u4F55\u4F53\uFF09\uFF0C\u6302 ChaseEnemy\uFF0C\u7136\u540E\u628A\u6A21\u677F\u7684 visible \u8BBE\u4E3A false \u5E76\u653E\u5728\u573A\u666F\u5916\u4FA7\u3002",
      '\u5237\u602A\u70B9\uFF1A\u521B\u5EFA kind:"empty" \u8282\u70B9\u653E\u5728\u6218\u573A\u4E2D\u5FC3\uFF0C\u6302 WaveSpawner\uFF0Cparams.template \u4F20\u654C\u4EBA\u6A21\u677F\u8282\u70B9\u3002',
      '\u73A9\u5BB6\u8282\u70B9\u9700\u8981\u5E26 "player" \u6807\u7B7E\uFF08third-person-controller \u4E0E health-score-hud \u8303\u4F8B\u90FD\u4F1A\u5728 onStart \u81EA\u52A8\u6253\uFF09\u3002'
    ],
    files: [
      { scriptId: "ChaseEnemy", attachTo: "\u654C\u4EBA\u6A21\u677F\u8282\u70B9\uFF08\u9690\u85CF\uFF09", source: CHASE_ENEMY },
      { scriptId: "WaveSpawner", attachTo: "\u6218\u573A\u4E2D\u5FC3\u7684\u7A7A\u8282\u70B9", source: WAVE_SPAWNER }
    ],
    verify: 'playtest__run_smoke\uFF1Astep 3 \u79D2\u540E assert uiVarEquals {name:"wave",value:1}\uFF0C\u5E76\u7528 nodeCountAtLeast \u65AD\u8A00\u8282\u70B9\u6570\u6BD4\u7F16\u8F91\u6001\u591A\uFF08\u5DF2\u751F\u6210\u654C\u4EBA\uFF09\u3002',
    pitfalls: [
      "\u9690\u85CF\u7684\u6A21\u677F\u8282\u70B9\u81EA\u8EAB\u4E5F\u4F1A\u6267\u884C\u811A\u672C\uFF0C\u6240\u4EE5\u811A\u672C\u91CC\u8981\u7528 if (!self.visible) return \u8DF3\u8FC7\uFF0C\u4E14\u53EA\u5728\u53EF\u89C1\u5B9E\u4F8B\u4E0A\u6253\u6807\u7B7E\u3002",
      "\u6C60\u5316\u5BF9\u8C61\u7528 self.node.destroy() \u5373\u53EF\u81EA\u52A8\u56DE\u6C60\uFF0C\u4E0D\u8981\u624B\u5EFA\u4E00\u5806\u8282\u70B9\u5145\u5F53\u5BF9\u8C61\u6C60\u3002"
    ]
  },
  {
    id: "shooting",
    title: "\u5C04\u51FB\uFF08\u73A9\u5BB6\u5F00\u706B + \u6C60\u5316\u5B50\u5F39\uFF09",
    summary: '\u6309\u4F4F\u653B\u51FB\u952E\u6CBF\u89D2\u8272\u671D\u5411\u53D1\u5C04\u5B50\u5F39\uFF0C\u5B50\u5F39\u547D\u4E2D\u5E26 "enemy" \u6807\u7B7E\u7684\u8282\u70B9\u540E\u53D1\u9001 hit \u6D88\u606F',
    setup: [
      "\u5B50\u5F39\u6A21\u677F\uFF1A\u521B\u5EFA\u4E00\u4E2A\u5C0F\u7403/\u5C0F\u80F6\u56CA\u8282\u70B9\uFF0C\u6302 Bullet\uFF0Cvisible \u8BBE\u4E3A false\u3002",
      "script__attach PlayerShooter \u5230\u73A9\u5BB6\u8282\u70B9\uFF0Cparams.bullet \u4F20\u5B50\u5F39\u6A21\u677F\u8282\u70B9\u3002",
      '\u88AB\u51FB\u4E2D\u7684\u5BF9\u8C61\u9700\u8981\u5E26 "enemy" \u6807\u7B7E\u5E76\u5728 onMessage \u91CC\u5904\u7406 "hit"\uFF08\u89C1 enemy-wave \u8303\u4F8B\u7684 ChaseEnemy\uFF09\u3002'
    ],
    files: [
      { scriptId: "Bullet", attachTo: "\u5B50\u5F39\u6A21\u677F\u8282\u70B9\uFF08\u9690\u85CF\uFF09", source: BULLET },
      { scriptId: "PlayerShooter", attachTo: "\u73A9\u5BB6\u8282\u70B9", source: PLAYER_SHOOTER }
    ],
    verify: 'playtest__run_smoke\uFF1Ainput \u6CE8\u5165 {type:"actionDown",action:"Attack"}\uFF0Cstep 0.5 \u79D2\uFF0C\u7528 nodeCountAtLeast \u65AD\u8A00\u8282\u70B9\u6570\u589E\u52A0\uFF08\u5DF2\u751F\u6210\u5B50\u5F39\uFF09\u3002'
  },
  {
    id: "health-score-hud",
    title: "\u751F\u547D\u503C + \u5F97\u5206 + HUD / \u7ED3\u7B97\u754C\u9762",
    summary: "\u73A9\u5BB6\u53D7\u51FB\u6263\u8840\u3001\u51FB\u6740\u4E0E\u62FE\u53D6\u52A0\u5206\uFF0C\u6570\u636E\u9A71\u52A8 HUD\uFF0C\u6B7B\u4EA1\u6216\u8FBE\u6807\u65F6\u5F39\u51FA\u7ED3\u7B97\u754C\u9762",
    setup: [
      'HUD\uFF1Aui__createFromTemplate({ template:"hud", varKey:"hp", scoreVarKey:"score" })\u3002',
      '\u7ED3\u7B97\uFF1Aui__createFromTemplate({ template:"result", name:"\u7ED3\u7B97\u754C\u9762", scoreVarKey:"score" })\uFF0C\u6807\u9898\u6587\u672C\u53EF\u7528 ui__patchNode \u7ED1\u5B9A\u5230\u53D8\u91CF resultTitle\u3002',
      "script__attach PlayerHealth \u5230\u73A9\u5BB6\u8282\u70B9\uFF1B\u521B\u5EFA\u4E00\u4E2A\u7A7A\u8282\u70B9 GameManager \u5E76\u6302 GameManager \u811A\u672C\uFF08resultScreen \u4F20\u7ED3\u7B97\u754C\u9762\u5C4F\u5E55\u8282\u70B9\u7684\u540D\u79F0\uFF09\u3002"
    ],
    files: [
      { scriptId: "PlayerHealth", attachTo: "\u73A9\u5BB6\u8282\u70B9", source: PLAYER_HEALTH },
      { scriptId: "GameManager", attachTo: "\u7A7A\u8282\u70B9 GameManager", source: GAME_MANAGER }
    ],
    verify: 'playtest__run_smoke\uFF1Astep 0.5 \u79D2\u540E assert uiVarEquals {name:"hp",value:1} \u4E0E {name:"score",value:0}\u3002',
    pitfalls: [
      "HUD \u6A21\u677F\u7684\u8FDB\u5EA6\u6761\u91CF\u7A0B\u662F 0~1\uFF0C\u5199\u5165\u754C\u9762\u53D8\u91CF\u65F6\u8981\u9664\u4EE5\u6700\u5927\u503C\u3002",
      "\u8DE8\u8282\u70B9\u901A\u4FE1\u7528 self.broadcast / node.sendMessage + onMessage\uFF0C\u4E0D\u8981\u4E92\u76F8\u76F4\u63A5\u6539\u5BF9\u65B9\u7684 state\u3002"
    ]
  },
  {
    id: "collectible",
    title: "\u53EF\u62FE\u53D6\u7269\uFF08\u91D1\u5E01 / \u9053\u5177\uFF09",
    summary: "\u65CB\u8F6C\u6D6E\u52A8\u7684\u62FE\u53D6\u7269\uFF0C\u73A9\u5BB6\u9760\u8FD1\u540E\u52A0\u5206\u5E76\u6D88\u5931",
    setup: [
      "\u521B\u5EFA\u62FE\u53D6\u7269\u8282\u70B9\uFF08\u7403\u4F53/\u5706\u67F1\u6216\u6A21\u578B\uFF09\uFF0C\u6302 Collectible\uFF1B\u9700\u8981\u591A\u4E2A\u65F6\u76F4\u63A5\u590D\u5236\u8282\u70B9\u6216\u505A\u6210\u9884\u5236\u4F53\u3002",
      "\u914D\u5408 health-score-hud \u8303\u4F8B\u7684 GameManager \u7EDF\u8BA1\u5F97\u5206\uFF08\u5B83\u4F1A\u5904\u7406 collected \u6D88\u606F\uFF09\u3002"
    ],
    files: [{ scriptId: "Collectible", attachTo: "\u62FE\u53D6\u7269\u8282\u70B9", source: COLLECTIBLE }],
    verify: "playtest__run_smoke\uFF1A\u628A\u73A9\u5BB6\u653E\u5728\u62FE\u53D6\u7269\u65C1\uFF0C\u6CE8\u5165\u671D\u5411\u62FE\u53D6\u7269\u7684 Move \u8F93\u5165\u5E76 step 1.5 \u79D2\uFF0Cassert nodeMissing\uFF08\u62FE\u53D6\u7269\u540D\u79F0\uFF09\u4E0E uiVarEquals score\u3002"
  }
];
function recipeToKnowledgeEntry(recipe) {
  const body = [
    "## \u642D\u5EFA\u6B65\u9AA4",
    ...recipe.setup.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## \u9A8C\u6536",
    recipe.verify,
    ...recipe.pitfalls && recipe.pitfalls.length > 0 ? ["", "## \u5E38\u89C1\u5751", ...recipe.pitfalls.map((item) => `- ${item}`)] : []
  ].join("\n");
  return {
    id: recipe.id,
    kind: "skill",
    source: "builtin",
    name: recipe.title,
    description: recipe.summary,
    body,
    files: recipe.files.map((file) => ({
      path: `${file.scriptId}.ts`,
      attachTo: file.attachTo,
      source: file.source
    })),
    issues: []
  };
}
function builtinKnowledgeEntries() {
  return RECIPES.map(recipeToKnowledgeEntry);
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
  name: "",
  epoch: 0
}));
var cacheIndex = emptyIndex();
var ioChain = Promise.resolve();
function emptyIndex() {
  return { schemaVersion: CACHE_INDEX_VERSION, generatedAt: Date.now(), artifacts: {} };
}

// src/core/project/designMemory.ts
var NOTES_HEADING = "## \u8865\u5145\u8BF4\u660E";
var NOTES_EMPTY = "\uFF08\u6682\u65E0\uFF09";
var UPDATED_LABEL = "\u66F4\u65B0\u65F6\u95F4";
var LINE_FIELDS = [
  { key: "genre", label: "\u7C7B\u578B" },
  { key: "perspective", label: "\u89C6\u89D2" },
  { key: "coreLoop", label: "\u6838\u5FC3\u5FAA\u73AF" },
  { key: "winLose", label: "\u80DC\u8D1F\u6761\u4EF6" },
  { key: "artStyle", label: "\u7F8E\u672F\u98CE\u683C" },
  { key: "colorPalette", label: "\u8272\u5F69\u677F" },
  { key: "controls", label: "\u64CD\u4F5C\u6620\u5C04" },
  { key: "namingRules", label: "\u547D\u540D\u7EA6\u5B9A" }
];
var memoryDesign = createDefaultDesignDoc();
var memoryMarkdown = formatDesignMarkdown(memoryDesign);
function createDefaultDesignDoc() {
  return {
    title: "\u672A\u547D\u540D\u6E38\u620F\u9879\u76EE",
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
function oneLine(value) {
  return value.replace(/\s*\r?\n\s*/g, " ").trim();
}
function fieldLine(label, value) {
  return `- **${label}**\uFF1A${oneLine(value) || "\u5F85\u5B9A"}`;
}
function fieldValue(doc, key) {
  return key === "colorPalette" ? doc.colorPalette.join(", ") : doc[key];
}
function formatDesignMarkdown(doc) {
  return [
    `# ${doc.title || "\u672A\u547D\u540D\u6E38\u620F\u9879\u76EE"}`,
    "",
    ...LINE_FIELDS.map((field) => fieldLine(field.label, fieldValue(doc, field.key))),
    `- **${UPDATED_LABEL}**\uFF1A${doc.updatedAt}`,
    "",
    NOTES_HEADING,
    doc.notes || NOTES_EMPTY,
    ""
  ].join("\n");
}
function findFieldLine(lines, label) {
  const marker = `- **${label}**\uFF1A`;
  return lines.findIndex((line) => line.startsWith(marker));
}
function notesRange(lines) {
  const start = lines.findIndex((line) => line.trim() === NOTES_HEADING);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}
function applyDesignPatchToMarkdown(markdown, doc, changedKeys) {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const changed = new Set(changedKeys);
  if (changed.has("title")) {
    const idx = lines.findIndex((line) => line.startsWith("# "));
    const heading = `# ${doc.title || "\u672A\u547D\u540D\u6E38\u620F\u9879\u76EE"}`;
    if (idx >= 0) lines[idx] = heading;
    else lines.unshift(heading, "");
  }
  const insertionIndex = () => {
    let last = -1;
    for (const label of [...LINE_FIELDS.map((field) => field.label), UPDATED_LABEL]) {
      last = Math.max(last, findFieldLine(lines, label));
    }
    if (last >= 0) return last + 1;
    const heading = lines.findIndex((line) => line.startsWith("# "));
    if (heading < 0) return 0;
    lines.splice(heading + 1, 0, "");
    return heading + 2;
  };
  for (const field of LINE_FIELDS) {
    if (!changed.has(field.key)) continue;
    const line = fieldLine(field.label, fieldValue(doc, field.key));
    const idx = findFieldLine(lines, field.label);
    if (idx >= 0) lines[idx] = line;
    else lines.splice(insertionIndex(), 0, line);
  }
  const updatedLine = `- **${UPDATED_LABEL}**\uFF1A${doc.updatedAt}`;
  const updatedIdx = findFieldLine(lines, UPDATED_LABEL);
  if (updatedIdx >= 0) lines[updatedIdx] = updatedLine;
  else lines.splice(insertionIndex(), 0, updatedLine);
  if (changed.has("notes")) {
    const notesLines = (doc.notes || NOTES_EMPTY).split(/\r?\n/);
    const range = notesRange(lines);
    if (range) {
      const tail = range.end < lines.length ? [""] : [];
      lines.splice(range.start + 1, range.end - range.start - 1, ...notesLines, ...tail);
    } else {
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push("", NOTES_HEADING, ...notesLines);
    }
  }
  let out = lines.join(eol);
  if (!out.endsWith(eol)) out += eol;
  return out;
}
function parseDesignMarkdown(md) {
  const doc = createDefaultDesignDoc();
  const lines = md.split(/\r?\n/);
  const heading = lines.find((l) => l.startsWith("# "));
  if (heading) doc.title = heading.slice(2).trim();
  const readField = (prefix) => {
    const idx = findFieldLine(lines, prefix);
    if (idx < 0) return null;
    const val = lines[idx].slice(`- **${prefix}**\uFF1A`.length).trim();
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
  doc.updatedAt = readField(UPDATED_LABEL) || doc.updatedAt;
  const range = notesRange(lines);
  if (range) {
    const notesText = lines.slice(range.start + 1, range.end).join("\n").trim();
    doc.notes = notesText === NOTES_EMPTY ? "" : notesText;
  }
  return doc;
}

// tests/ai-knowledge-loader.test.ts
function memoryFs(files) {
  const paths = Object.keys(files);
  return {
    list: async (dirPath) => {
      const prefix = `${dirPath.replace(/[\\/]+$/, "")}/`;
      const seen = /* @__PURE__ */ new Map();
      for (const path of paths) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) seen.set(rest, "file");
        else seen.set(rest.slice(0, slash), "directory");
      }
      return Array.from(seen.entries()).map(([name, kind]) => ({ name, kind }));
    },
    readTextFile: async (filePath) => {
      if (!(filePath in files)) throw new Error(`ENOENT ${filePath}`);
      return files[filePath];
    },
    exists: async (filePath) => filePath in files
  };
}
var SKILL_MD = `---
name: \u5854\u9632\u6CE2\u6B21
description: "\u505A\u5854\u9632\u7C7B\u5237\u602A\uFF1A\u8DEF\u5F84\u3001\u6CE2\u6B21\u8868\u3001\u6F0F\u602A\u6263\u8840"
command: \u642D\u5EFA\u5854\u9632\u6CE2\u6B21
files:
  - path: Wave.ts
    attachTo: \u7A7A\u8282\u70B9 WaveManager
  - Tower.ts
---

## \u642D\u5EFA\u6B65\u9AA4
1. \u5EFA\u8DEF\u5F84
`;
test("\u5934\u90E8\u89E3\u6790\uFF1A\u6807\u91CF\u3001\u5F15\u53F7\u4E0E files \u5217\u8868", () => {
  const fm = parseFrontmatter(SKILL_MD);
  assert.equal(fm.hasFrontmatter, true);
  assert.equal(fm.values.name, "\u5854\u9632\u6CE2\u6B21");
  assert.equal(fm.values.description, "\u505A\u5854\u9632\u7C7B\u5237\u602A\uFF1A\u8DEF\u5F84\u3001\u6CE2\u6B21\u8868\u3001\u6F0F\u602A\u6263\u8840");
  assert.deepEqual(fm.files, [{ path: "Wave.ts", attachTo: "\u7A7A\u8282\u70B9 WaveManager" }, { path: "Tower.ts" }]);
  assert.ok(fm.body.startsWith("## \u642D\u5EFA\u6B65\u9AA4"));
  const plain = parseFrontmatter("# \u6807\u9898\n\u6B63\u6587");
  assert.equal(plain.hasFrontmatter, false);
  assert.equal(plain.body, "# \u6807\u9898\n\u6B63\u6587");
});
test("\u8DEF\u5F84\u5B89\u5168\uFF1A\u62D2\u7EDD\u8D8A\u51FA\u6280\u80FD\u76EE\u5F55\u7684\u8DEF\u5F84", () => {
  assert.equal(isSafeRelativePath("Wave.ts"), true);
  assert.equal(isSafeRelativePath("sub/Wave.ts"), true);
  assert.equal(isSafeRelativePath("../secret.txt"), false);
  assert.equal(isSafeRelativePath("a/../../b"), false);
  assert.equal(isSafeRelativePath("/etc/passwd"), false);
  assert.equal(isSafeRelativePath("C:/Windows/x"), false);
  assert.equal(isSafeRelativePath(""), false);
});
test("\u52A0\u8F7D\uFF1A\u4E09\u7EA7\u6765\u6E90\u5408\u5E76\uFF0C\u5DE5\u7A0B\u8986\u76D6\u7528\u6237\u5168\u5C40\u4E0E\u5185\u7F6E", async () => {
  const builtinId = RECIPES[0].id;
  const fs = memoryFs({
    "/user/ai/skills/tower-wave/SKILL.md": SKILL_MD.replace("\u5854\u9632\u6CE2\u6B21", "\u7528\u6237\u7248\u5854\u9632"),
    "/user/ai/rules.md": "- \u7528\u6237\u89C4\u5219",
    "/proj/ai/skills/tower-wave/SKILL.md": SKILL_MD,
    "/proj/ai/skills/tower-wave/Wave.ts": "export const wave = 1",
    "/proj/ai/skills/tower-wave/Tower.ts": "export const tower = 1",
    [`/proj/ai/skills/${builtinId}/SKILL.md`]: "---\nname: \u5DE5\u7A0B\u7248\u63A7\u5236\u5668\ndescription: \u8986\u76D6\u5185\u7F6E\n---\n\u6B63\u6587",
    "/proj/ai/skills/no-main/readme.md": "\u6CA1\u6709 SKILL.md \u7684\u76EE\u5F55\u5E94\u88AB\u5FFD\u7565",
    "/proj/ai/knowledge/naming.md": "# \u547D\u540D\u7EA6\u5B9A\n- \u8282\u70B9\u7528\u4E2D\u6587",
    "/proj/ai/rules.md": "- \u5DE5\u7A0B\u89C4\u5219",
    "/proj/requirements.md": "# \u9700\u6C42\n- \u80FD\u79FB\u52A8"
  });
  const snapshot = await loadKnowledgeSnapshot({ fs, builtin: builtinKnowledgeEntries(), projectRoot: "/proj", userRoot: "/user/ai" });
  const tower = findKnowledgeEntry(snapshot, "tower-wave");
  assert.equal(tower?.source, "project");
  assert.equal(tower?.name, "\u5854\u9632\u6CE2\u6B21");
  assert.equal(tower?.command, "\u642D\u5EFA\u5854\u9632\u6CE2\u6B21");
  assert.deepEqual(tower?.overrides, ["user"]);
  assert.deepEqual(tower?.issues, []);
  const overridden = findKnowledgeEntry(snapshot, builtinId);
  assert.equal(overridden?.source, "project");
  assert.deepEqual(overridden?.overrides, ["builtin"]);
  assert.equal(findKnowledgeEntry(snapshot, "no-main"), null);
  assert.equal(findKnowledgeEntry(snapshot, "naming")?.kind, "knowledge");
  assert.equal(findKnowledgeEntry(snapshot, "naming")?.description, "\u547D\u540D\u7EA6\u5B9A");
  assert.equal(snapshot.entries.filter((entry) => entry.source === "builtin").length, RECIPES.length - 1);
  assert.equal(snapshot.shadowed.length, 2);
  assert.deepEqual(snapshot.rules.map((rule) => rule.source), ["project", "user"]);
  assert.equal(snapshot.requirements?.checks.length, 0);
  const file = await readKnowledgeFile(tower, "Wave.ts", fs);
  assert.deepEqual(file, { ok: true, source: "export const wave = 1" });
  const escape = await readKnowledgeFile(tower, "../../rules.md", fs);
  assert.equal(escape.ok, false);
  assert.equal(findKnowledgeEntry(snapshot, "tower-wave", /* @__PURE__ */ new Set(["tower-wave"])), null);
  const ctx = formatKnowledgeContext(snapshot, /* @__PURE__ */ new Set(["tower-wave"]));
  assert.ok(!ctx.text.includes("tower-wave"));
  assert.ok(ctx.text.includes("- \u5DE5\u7A0B\u89C4\u5219"));
  assert.ok(ctx.text.includes("naming\uFF1A\u547D\u540D\u7EA6\u5B9A"));
  assert.equal(ctx.injection.requirements, true);
  assert.deepEqual(ctx.injection.rules, ["\u5DE5\u7A0B\u89C4\u5219", "\u7528\u6237\u5168\u5C40\u89C4\u5219"]);
});
test("\u52A0\u8F7D\uFF1A\u6CA1\u6709\u6587\u4EF6\u7CFB\u7EDF\u6216\u5DE5\u7A0B\u76EE\u5F55\u65F6\u53EA\u6709\u5185\u7F6E\u6761\u76EE", async () => {
  const snapshot = await loadKnowledgeSnapshot({ fs: null, builtin: builtinKnowledgeEntries(), projectRoot: null, userRoot: null });
  assert.equal(snapshot.entries.length, RECIPES.length);
  assert.equal(formatKnowledgeContext(snapshot).text, "");
  const scriptId = RECIPES[0].files[0].scriptId;
  assert.equal(findKnowledgeEntry(snapshot, scriptId)?.id, RECIPES[0].id);
  const file = await readKnowledgeFile(findKnowledgeEntry(snapshot, RECIPES[0].id), `${scriptId}.ts`, null);
  assert.equal(file.ok && file.source, RECIPES[0].files[0].source);
});
test("\u52A0\u8F7D\uFF1A\u89C4\u5219\u8D85\u51FA\u4E0A\u9650\u65F6\u622A\u65AD\u5E76\u6807\u8BB0", async () => {
  const fs = memoryFs({ "/proj/ai/rules.md": "x".repeat(KNOWLEDGE_LIMITS.rulesChars + 500) });
  const snapshot = await loadKnowledgeSnapshot({ fs, builtin: [], projectRoot: "/proj", userRoot: null });
  assert.equal(snapshot.rules[0].truncated, true);
  assert.equal(snapshot.rules[0].length, KNOWLEDGE_LIMITS.rulesChars + 500);
  assert.deepEqual(formatKnowledgeContext(snapshot).injection.truncated, ["\u5DE5\u7A0B\u89C4\u5219\uFF08ai/rules.md\uFF09"]);
});
test("\u9700\u6C42\u6587\u6863\uFF1A\u89E3\u6790 t3d-check \u9A8C\u6536\u5757\u5E76\u62A5\u544A\u5199\u9519\u7684\u5757", () => {
  const md = [
    "# \u9700\u6C42",
    "```t3d-check",
    '{ "name": "\u80FD\u524D\u8FDB", "steps": [{ "action": "step", "seconds": 1 }] }',
    "```",
    "```t3d-check",
    "{ \u4E0D\u662F json }",
    "```",
    "```t3d-check",
    '{ "name": "\u7F3A\u6B65\u9AA4" }',
    "```",
    "```json",
    '{ "name": "\u666E\u901A\u4EE3\u7801\u5757\u4E0D\u7B97", "steps": [1] }',
    "```"
  ].join("\n");
  const { checks, issues } = parseRequirementChecks(md);
  assert.deepEqual(checks, [{ name: "\u80FD\u524D\u8FDB", steps: [{ action: "step", seconds: 1 }] }]);
  assert.equal(issues.length, 2);
});
test("design.md\uFF1A\u66F4\u65B0\u5B57\u6BB5\u53EA\u66FF\u6362\u5BF9\u5E94\u884C\uFF0C\u624B\u5199\u7AE0\u8282\u9010\u5B57\u4FDD\u7559", () => {
  const original = [
    "# \u661F\u9645\u5FEB\u9012",
    "",
    "\u8FD9\u662F\u4E00\u6BB5\u6211\u624B\u5199\u7684\u5F00\u573A\u767D\uFF0C\u4E0D\u5C5E\u4E8E\u4EFB\u4F55\u5B57\u6BB5\u3002",
    "",
    "- **\u7C7B\u578B**\uFF1A\u4FEF\u89C6\u89D2\u5C04\u51FB",
    "- **\u89C6\u89D2**\uFF1A\u5F85\u5B9A",
    "- **\u66F4\u65B0\u65F6\u95F4**\uFF1A2026-01-01T00:00:00.000Z",
    "",
    "## \u5173\u5361\u5217\u8868",
    "1. \u592A\u7A7A\u6E2F",
    "2. \u5C0F\u884C\u661F\u5E26",
    "",
    "## \u8865\u5145\u8BF4\u660E",
    "\u65E7\u8BF4\u660E",
    "",
    "## \u7F8E\u672F\u53C2\u8003",
    "- \u4F4E\u591A\u8FB9\u5F62",
    ""
  ].join("\n");
  const doc = parseDesignMarkdown(original);
  assert.equal(doc.title, "\u661F\u9645\u5FEB\u9012");
  assert.equal(doc.genre, "\u4FEF\u89C6\u89D2\u5C04\u51FB");
  assert.equal(doc.perspective, "");
  assert.equal(doc.notes, "\u65E7\u8BF4\u660E");
  const next = { ...doc, perspective: "\u4FEF\u89C6 45\xB0", artStyle: "\u4F4E\u591A\u8FB9\u5F62", notes: "\u65E7\u8BF4\u660E\n\n\u65B0\u589E\u4E00\u6761", updatedAt: "2026-02-02T00:00:00.000Z" };
  const out = applyDesignPatchToMarkdown(original, next, ["perspective", "artStyle", "notes"]);
  assert.ok(out.includes("\u8FD9\u662F\u4E00\u6BB5\u6211\u624B\u5199\u7684\u5F00\u573A\u767D\uFF0C\u4E0D\u5C5E\u4E8E\u4EFB\u4F55\u5B57\u6BB5\u3002"));
  assert.ok(out.includes("## \u5173\u5361\u5217\u8868\n1. \u592A\u7A7A\u6E2F\n2. \u5C0F\u884C\u661F\u5E26"));
  assert.ok(out.includes("## \u7F8E\u672F\u53C2\u8003\n- \u4F4E\u591A\u8FB9\u5F62"));
  assert.ok(out.includes("- **\u7C7B\u578B**\uFF1A\u4FEF\u89C6\u89D2\u5C04\u51FB"));
  assert.ok(out.includes("- **\u89C6\u89D2**\uFF1A\u4FEF\u89C6 45\xB0"));
  assert.ok(out.includes("- **\u7F8E\u672F\u98CE\u683C**\uFF1A\u4F4E\u591A\u8FB9\u5F62"));
  assert.ok(out.includes("- **\u66F4\u65B0\u65F6\u95F4**\uFF1A2026-02-02T00:00:00.000Z"));
  assert.ok(out.includes("## \u8865\u5145\u8BF4\u660E\n\u65E7\u8BF4\u660E\n\n\u65B0\u589E\u4E00\u6761\n\n## \u7F8E\u672F\u53C2\u8003"));
  const reparsed = parseDesignMarkdown(out);
  assert.equal(reparsed.perspective, "\u4FEF\u89C6 45\xB0");
  assert.equal(reparsed.artStyle, "\u4F4E\u591A\u8FB9\u5F62");
  assert.equal(reparsed.notes, "\u65E7\u8BF4\u660E\n\n\u65B0\u589E\u4E00\u6761");
});
test("design.md\uFF1A\u9ED8\u8BA4\u683C\u5F0F\u53EF\u5F80\u8FD4\uFF0C\u7EAF\u81EA\u7531\u683C\u5F0F\u4E5F\u80FD\u8865\u4E0A\u5B57\u6BB5", () => {
  const base = createDefaultDesignDoc();
  const md = formatDesignMarkdown({ ...base, genre: "\u5E73\u53F0\u8DF3\u8DC3", colorPalette: ["#fff", "#000"] });
  const parsed = parseDesignMarkdown(md);
  assert.equal(parsed.genre, "\u5E73\u53F0\u8DF3\u8DC3");
  assert.deepEqual(parsed.colorPalette, ["#fff", "#000"]);
  const free = "# \u6211\u7684\u6E38\u620F\n\n\u968F\u4FBF\u5199\u7684\u8BBE\u8BA1\u60F3\u6CD5\u3002\n";
  const doc = { ...parseDesignMarkdown(free), genre: "\u89E3\u8C1C", updatedAt: "2026-03-03T00:00:00.000Z" };
  const out = applyDesignPatchToMarkdown(free, doc, ["genre"]);
  assert.ok(out.includes("\u968F\u4FBF\u5199\u7684\u8BBE\u8BA1\u60F3\u6CD5\u3002"));
  assert.equal(parseDesignMarkdown(out).genre, "\u89E3\u8C1C");
  assert.equal(parseDesignMarkdown(out).title, "\u6211\u7684\u6E38\u620F");
});
