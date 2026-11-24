/**
 * 扩展层加载器：扫描「内置 / 用户全局 / 工程」三级来源，解析并合并覆盖。
 * 本文件不依赖 Electron 或编辑器状态，文件系统通过 KnowledgeFs 注入，便于测试。
 */

import { firstHeading, parseFrontmatter } from './frontmatter'
import {
  KNOWLEDGE_LIMITS,
  type KnowledgeEntry,
  type KnowledgeFileRef,
  type KnowledgeFs,
  type KnowledgeRuleDoc,
  type KnowledgeSnapshot,
  type KnowledgeSource,
  type RequirementCheck,
  type RequirementsDoc,
} from './types'

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const SOURCE_RANK: Record<KnowledgeSource, number> = { builtin: 0, user: 1, project: 2 }

export function joinPath(root: string, relative: string): string {
  const rel = relative.replace(/\\/g, '/').replace(/^\/+/, '')
  const base = root.replace(/[\\/]+$/, '')
  return rel ? `${base}/${rel}` : base
}

/** 附带文件路径必须是技能目录内的相对路径 */
export function isSafeRelativePath(relative: string): boolean {
  const rel = relative.replace(/\\/g, '/').trim()
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return false
  return rel.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  return { text: `${text.slice(0, limit)}\n…（超出 ${limit} 字符上限，后续内容未注入）`, truncated: true }
}

function describeIssues(entry: KnowledgeEntry, hadName: boolean, hadDescription: boolean): void {
  if (!ID_PATTERN.test(entry.id)) entry.issues.push('ID 只能使用小写字母、数字和连字符')
  if (!hadName) entry.issues.push('缺少 name')
  if (!hadDescription) entry.issues.push('缺少 description（AI 只凭这一行判断是否读取）')
  if (entry.description.length > KNOWLEDGE_LIMITS.descriptionChars) {
    entry.issues.push(`description 超过 ${KNOWLEDGE_LIMITS.descriptionChars} 字，目录中已截断`)
  }
  for (const file of entry.files) {
    if (!isSafeRelativePath(file.path)) entry.issues.push(`附带文件路径不合法：${file.path}`)
  }
}

export function parseSkillMarkdown(
  id: string,
  source: KnowledgeSource,
  markdown: string,
  location: { absPath?: string; dirPath?: string } = {},
): KnowledgeEntry {
  const fm = parseFrontmatter(markdown)
  const name = fm.values.name?.trim() ?? ''
  const description = fm.values.description?.trim() ?? ''
  const files: KnowledgeFileRef[] = fm.files.map((file) => ({
    path: file.path.replace(/\\/g, '/'),
    ...(file.attachTo ? { attachTo: file.attachTo } : {}),
  }))
  const entry: KnowledgeEntry = {
    id,
    kind: 'skill',
    source,
    name: name || firstHeading(fm.body) || id,
    description: description || firstHeading(fm.body) || name || id,
    body: fm.body,
    files,
    ...location,
    ...(fm.values.command?.trim() ? { command: fm.values.command.trim() } : {}),
    issues: [],
  }
  describeIssues(entry, Boolean(name), Boolean(description))
  return entry
}

export function parseKnowledgeMarkdown(
  id: string,
  source: KnowledgeSource,
  markdown: string,
  location: { absPath?: string } = {},
): KnowledgeEntry {
  const fm = parseFrontmatter(markdown)
  const heading = firstHeading(fm.body)
  const name = fm.values.name?.trim() || heading || id
  const description = fm.values.description?.trim() || heading || id
  const entry: KnowledgeEntry = {
    id,
    kind: 'knowledge',
    source,
    name,
    description,
    body: fm.body,
    files: [],
    ...location,
    issues: [],
  }
  // 知识文件不强制头部：有标题即可作为目录说明
  describeIssues(entry, true, Boolean(fm.values.description?.trim() || heading))
  return entry
}

/** 解析 requirements.md 里的 ```t3d-check 代码块 */
export function parseRequirementChecks(markdown: string): { checks: RequirementCheck[]; issues: string[] } {
  const checks: RequirementCheck[] = []
  const issues: string[] = []
  const pattern = /```t3d-check[^\n]*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  let index = 0
  while ((match = pattern.exec(markdown)) !== null) {
    index += 1
    try {
      const parsed = JSON.parse(match[1]) as { name?: unknown; steps?: unknown }
      if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        issues.push(`第 ${index} 个验收块缺少 steps 数组`)
        continue
      }
      checks.push({
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : `验收 ${index}`,
        steps: parsed.steps,
      })
    } catch (error) {
      issues.push(`第 ${index} 个验收块不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (checks.length > KNOWLEDGE_LIMITS.checks) {
    issues.push(`验收块超过 ${KNOWLEDGE_LIMITS.checks} 个，只执行前 ${KNOWLEDGE_LIMITS.checks} 个`)
  }
  return { checks: checks.slice(0, KNOWLEDGE_LIMITS.checks), issues }
}

async function scanSkills(fs: KnowledgeFs, root: string, source: KnowledgeSource): Promise<KnowledgeEntry[]> {
  const skillsDir = joinPath(root, 'skills')
  const out: KnowledgeEntry[] = []
  const dirs = (await fs.list(skillsDir)).filter((item) => item.kind === 'directory')
  for (const dir of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const dirPath = joinPath(skillsDir, dir.name)
    const names = await fs.list(dirPath)
    const main = names.find((item) => item.kind === 'file' && item.name.toLowerCase() === 'skill.md')
    if (!main) continue
    const absPath = joinPath(dirPath, main.name)
    try {
      const entry = parseSkillMarkdown(dir.name.toLowerCase(), source, await fs.readTextFile(absPath), { absPath, dirPath })
      const present = new Set(names.filter((item) => item.kind === 'file').map((item) => item.name))
      for (const file of entry.files) {
        if (isSafeRelativePath(file.path) && !file.path.includes('/') && !present.has(file.path)) {
          entry.issues.push(`附带文件不存在：${file.path}`)
        }
      }
      out.push(entry)
    } catch (error) {
      console.warn('[AI] 读取技能失败：', absPath, error)
    }
  }
  return out
}

async function scanKnowledge(fs: KnowledgeFs, root: string, source: KnowledgeSource): Promise<KnowledgeEntry[]> {
  const dir = joinPath(root, 'knowledge')
  const out: KnowledgeEntry[] = []
  const files = (await fs.list(dir)).filter((item) => item.kind === 'file' && /\.md$/i.test(item.name))
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const absPath = joinPath(dir, file.name)
    try {
      const id = file.name.replace(/\.md$/i, '').toLowerCase()
      out.push(parseKnowledgeMarkdown(id, source, await fs.readTextFile(absPath), { absPath }))
    } catch (error) {
      console.warn('[AI] 读取知识文件失败：', absPath, error)
    }
  }
  return out
}

async function readRules(fs: KnowledgeFs, root: string, source: 'user' | 'project'): Promise<KnowledgeRuleDoc | null> {
  const absPath = joinPath(root, 'rules.md')
  if (!(await fs.exists(absPath))) return null
  const raw = (await fs.readTextFile(absPath)).trim()
  if (!raw) return null
  const cut = truncate(raw, KNOWLEDGE_LIMITS.rulesChars)
  return { source, absPath, text: cut.text, length: raw.length, truncated: cut.truncated }
}

async function readRequirements(fs: KnowledgeFs, projectRoot: string): Promise<RequirementsDoc | null> {
  const absPath = joinPath(projectRoot, 'requirements.md')
  if (!(await fs.exists(absPath))) return null
  const raw = (await fs.readTextFile(absPath)).trim()
  if (!raw) return null
  const cut = truncate(raw, KNOWLEDGE_LIMITS.requirementsChars)
  const { checks, issues } = parseRequirementChecks(raw)
  return { absPath, text: cut.text, length: raw.length, truncated: cut.truncated, checks, issues }
}

/** 同 ID 时 工程 > 用户全局 > 内置 */
export function mergeKnowledgeEntries(groups: KnowledgeEntry[][]): { entries: KnowledgeEntry[]; shadowed: KnowledgeEntry[] } {
  const winners = new Map<string, KnowledgeEntry>()
  const shadowed: KnowledgeEntry[] = []
  for (const entry of groups.flat()) {
    const existing = winners.get(entry.id)
    if (!existing) {
      winners.set(entry.id, entry)
      continue
    }
    const [win, lose] = SOURCE_RANK[entry.source] >= SOURCE_RANK[existing.source] ? [entry, existing] : [existing, entry]
    const overrides = Array.from(new Set([...(win.overrides ?? []), ...(lose.overrides ?? []), lose.source]))
    winners.set(entry.id, { ...win, overrides })
    shadowed.push(lose)
  }
  return { entries: Array.from(winners.values()), shadowed }
}

export interface LoadKnowledgeOptions {
  fs: KnowledgeFs | null
  builtin: KnowledgeEntry[]
  /** 工程目录（草稿工程为 null） */
  projectRoot: string | null
  /** 用户全局扩展目录（`<userData>/T3D/ai`） */
  userRoot: string | null
}

export async function loadKnowledgeSnapshot(options: LoadKnowledgeOptions): Promise<KnowledgeSnapshot> {
  const { fs, builtin, projectRoot, userRoot } = options
  const groups: KnowledgeEntry[][] = [builtin]
  const rules: KnowledgeRuleDoc[] = []
  let requirements: RequirementsDoc | null = null

  const scanRoot = async (root: string, source: 'user' | 'project') => {
    if (!fs) return
    try {
      groups.push(await scanSkills(fs, root, source))
      groups.push(await scanKnowledge(fs, root, source))
      const rule = await readRules(fs, root, source)
      if (rule) rules.push(rule)
    } catch (error) {
      console.warn('[AI] 扫描扩展目录失败：', root, error)
    }
  }

  if (userRoot) await scanRoot(userRoot, 'user')
  if (projectRoot) {
    await scanRoot(joinPath(projectRoot, 'ai'), 'project')
    if (fs) {
      try {
        requirements = await readRequirements(fs, projectRoot)
      } catch (error) {
        console.warn('[AI] 读取 requirements.md 失败：', error)
      }
    }
  }

  const { entries, shadowed } = mergeKnowledgeEntries(groups)
  // 工程规则排在前面：优先级高的先出现
  rules.sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source])
  return { entries, shadowed, rules, requirements, projectRoot, userRoot, scannedAt: Date.now() }
}

export function findKnowledgeEntry(
  snapshot: KnowledgeSnapshot,
  rawId: string,
  disabledIds: ReadonlySet<string> = new Set(),
): KnowledgeEntry | null {
  const key = rawId.trim().toLowerCase()
  if (!key) return null
  const usable = snapshot.entries.filter((entry) => entry.source === 'builtin' || !disabledIds.has(entry.id))
  return (
    usable.find((entry) => entry.id === key) ??
    // 兼容旧用法：用脚本 ID 查内置范例
    usable.find((entry) => entry.files.some((file) => file.path.replace(/\.ts$/i, '').toLowerCase() === key)) ??
    null
  )
}

export async function readKnowledgeFile(
  entry: KnowledgeEntry,
  relative: string,
  fs: KnowledgeFs | null,
): Promise<{ ok: true; source: string } | { ok: false; message: string }> {
  const rel = relative.replace(/\\/g, '/').trim()
  const embedded = entry.files.find((file) => file.path === rel && typeof file.source === 'string')
  if (embedded?.source !== undefined) return { ok: true, source: embedded.source }
  if (!isSafeRelativePath(rel)) return { ok: false, message: `文件路径不合法：${relative}` }
  if (!entry.dirPath || !fs) return { ok: false, message: `条目 "${entry.id}" 没有附带文件 ${relative}` }
  const absPath = joinPath(entry.dirPath, rel)
  if (!(await fs.exists(absPath))) return { ok: false, message: `附带文件不存在：${relative}` }
  return { ok: true, source: await fs.readTextFile(absPath) }
}

const SOURCE_LABEL: Record<KnowledgeSource, string> = { builtin: '内置', user: '用户全局', project: '工程' }

export function knowledgeSourceLabel(source: KnowledgeSource): string {
  return SOURCE_LABEL[source]
}

/** 用户与工程条目的目录行（内置目录在系统提示里，不重复） */
export function listExtensionCatalog(
  snapshot: KnowledgeSnapshot,
  disabledIds: ReadonlySet<string> = new Set(),
): KnowledgeEntry[] {
  return snapshot.entries
    .filter((entry) => entry.source !== 'builtin' && !disabledIds.has(entry.id))
    .sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source] || a.id.localeCompare(b.id))
    .slice(0, KNOWLEDGE_LIMITS.catalogEntries)
}

export interface KnowledgeInjection {
  /** 已注入的规则文件（来源标签） */
  rules: string[]
  requirements: boolean
  checks: number
  skills: number
  knowledge: number
  /** 被截断的文档 */
  truncated: string[]
}

/** 生成追加到本轮工程上下文里的扩展层文本，并返回「注入了什么」供界面与轨迹展示 */
export function formatKnowledgeContext(
  snapshot: KnowledgeSnapshot,
  disabledIds: ReadonlySet<string> = new Set(),
): { text: string; injection: KnowledgeInjection } {
  const sections: string[] = []
  const injection: KnowledgeInjection = { rules: [], requirements: false, checks: 0, skills: 0, knowledge: 0, truncated: [] }

  for (const rule of snapshot.rules) {
    const label = rule.source === 'project' ? '工程规则（ai/rules.md）' : '用户全局规则（rules.md）'
    sections.push(`${label}：必须遵守。\n${rule.text}`)
    injection.rules.push(rule.source === 'project' ? '工程规则' : '用户全局规则')
    if (rule.truncated) injection.truncated.push(label)
  }

  if (snapshot.requirements) {
    const req = snapshot.requirements
    sections.push(
      `需求与验收（requirements.md）：做中大型任务时以它为目标，收尾时逐条对照并在总结里说明每条是否满足。${
        req.checks.length > 0 ? `其中 ${req.checks.length} 条 t3d-check 验收块会在你结束时由系统自动执行。` : ''
      }\n${req.text}`,
    )
    injection.requirements = true
    injection.checks = req.checks.length
    if (req.truncated) injection.truncated.push('requirements.md')
  }

  const catalog = listExtensionCatalog(snapshot, disabledIds)
  if (catalog.length > 0) {
    const lines = catalog.map((entry) => {
      const desc = entry.description.length > KNOWLEDGE_LIMITS.descriptionChars
        ? `${entry.description.slice(0, KNOWLEDGE_LIMITS.descriptionChars)}…`
        : entry.description
      const kind = entry.kind === 'skill' ? '技能' : '知识'
      const override = entry.overrides?.includes('builtin') ? '，已覆盖同名内置范例' : ''
      return `- ${entry.id}：${desc}（${SOURCE_LABEL[entry.source]}${kind}${override}）`
    })
    sections.push(
      `扩展技能与知识目录（与任务相关时先用 kb__read({ id }) 读取全文再动手；附带源码用 kb__read({ id, file }) 读取）：\n${lines.join('\n')}`,
    )
    injection.skills = catalog.filter((entry) => entry.kind === 'skill').length
    injection.knowledge = catalog.filter((entry) => entry.kind === 'knowledge').length
  }

  return { text: sections.join('\n'), injection }
}
