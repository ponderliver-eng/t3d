/**
 * 工程设计规范与全局记忆（design.md）：
 * 立项时由 AI 与人共同维护，后续所有生产轮次自动注入上下文，保证跨多轮对话后风格、机制与命名不跑偏。
 * 有目录工程时同步读写磁盘上的 `design.md`，草稿工程保留在内存与 localStorage。
 *
 * design.md 是自由格式的 Markdown：下面这些结构化字段只是其中约定的几行，
 * 更新字段时只替换对应的行，用户手写的其它章节逐字保留。
 */

import { electronBridge, joinProjectPath } from '../../editor/project/electronBridge'
import { projectDirectoryPath } from '../../editor/project/disk'

export interface ProjectDesignDoc {
  title: string
  genre: string
  perspective: string
  coreLoop: string
  winLose: string
  artStyle: string
  colorPalette: string[]
  controls: string
  namingRules: string
  notes: string
  updatedAt: string
}

/** 更新补丁：除结构化字段外，可用 appendNotes 向「补充说明」追加内容而不覆盖已有文字 */
export type ProjectDesignPatch = Partial<ProjectDesignDoc> & { appendNotes?: string }

const STORAGE_KEY = 't3d:design-doc-draft'
const NOTES_HEADING = '## 补充说明'
const NOTES_EMPTY = '（暂无）'
const UPDATED_LABEL = '更新时间'

type LineFieldKey = 'genre' | 'perspective' | 'coreLoop' | 'winLose' | 'artStyle' | 'colorPalette' | 'controls' | 'namingRules'

const LINE_FIELDS: Array<{ key: LineFieldKey; label: string }> = [
  { key: 'genre', label: '类型' },
  { key: 'perspective', label: '视角' },
  { key: 'coreLoop', label: '核心循环' },
  { key: 'winLose', label: '胜负条件' },
  { key: 'artStyle', label: '美术风格' },
  { key: 'colorPalette', label: '色彩板' },
  { key: 'controls', label: '操作映射' },
  { key: 'namingRules', label: '命名约定' },
]

let memoryDesign: ProjectDesignDoc = createDefaultDesignDoc()
/** design.md 原文；始终与 memoryDesign 的结构化字段保持一致 */
let memoryMarkdown: string = formatDesignMarkdown(memoryDesign)

export function createDefaultDesignDoc(): ProjectDesignDoc {
  return {
    title: '未命名游戏项目',
    genre: '',
    perspective: '',
    coreLoop: '',
    winLose: '',
    artStyle: '',
    colorPalette: [],
    controls: 'WASD 移动，空格跳跃，鼠标左键交互/攻击',
    namingRules: '场景节点使用中文语义命名（如 主角、巡逻兵_01、地面），脚本与着色器使用英文驼峰命名',
    notes: '',
    updatedAt: new Date().toISOString(),
  }
}

export function getDesignDoc(): ProjectDesignDoc {
  return structuredClone(memoryDesign)
}

/** design.md 全文（含用户手写的自由章节），注入 AI 上下文时用它而不是结构化字段 */
export function getDesignMarkdown(): string {
  return memoryMarkdown
}

function setFromMarkdown(md: string): void {
  memoryMarkdown = md
  memoryDesign = parseDesignMarkdown(md)
}

function resetToDefault(): void {
  memoryDesign = createDefaultDesignDoc()
  memoryMarkdown = formatDesignMarkdown(memoryDesign)
}

/** 从磁盘（或草稿缓存）重新读取。打开工程、每轮 AI 对话开始前调用，手工改动的 design.md 才能生效 */
export async function loadDesignDocFromProject(): Promise<ProjectDesignDoc> {
  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge) {
    const file = joinProjectPath(dir, 'design.md')
    try {
      if (await bridge.fs.exists(file)) {
        setFromMarkdown(await bridge.fs.readTextFile(file))
      } else {
        // 该工程还没有 design.md：不能沿用上一个工程留在内存里的内容
        resetToDefault()
      }
    } catch (error) {
      console.warn('[design] 读取 design.md 失败：', error)
    }
  } else if (typeof localStorage !== 'undefined') {
    const cached = localStorage.getItem(STORAGE_KEY)
    if (cached) {
      try {
        memoryDesign = { ...createDefaultDesignDoc(), ...(JSON.parse(cached) as Partial<ProjectDesignDoc>) }
        memoryMarkdown = formatDesignMarkdown(memoryDesign)
      } catch {
        // 忽略损坏的草稿缓存
      }
    }
  }
  return getDesignDoc()
}

export async function updateDesignDoc(patch: ProjectDesignPatch): Promise<ProjectDesignDoc> {
  const { appendNotes, ...fields } = patch
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<ProjectDesignDoc>
  if (typeof appendNotes === 'string' && appendNotes.trim()) {
    const base = (cleaned.notes ?? memoryDesign.notes).trim()
    cleaned.notes = base ? `${base}\n\n${appendNotes.trim()}` : appendNotes.trim()
  }
  const next: ProjectDesignDoc = {
    ...memoryDesign,
    ...cleaned,
    colorPalette: cleaned.colorPalette ? [...cleaned.colorPalette] : [...memoryDesign.colorPalette],
    updatedAt: new Date().toISOString(),
  }
  memoryMarkdown = applyDesignPatchToMarkdown(memoryMarkdown, next, Object.keys(cleaned) as Array<keyof ProjectDesignDoc>)
  memoryDesign = next

  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge) {
    await bridge.fs.writeTextFile(joinProjectPath(dir, 'design.md'), memoryMarkdown)
  } else if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryDesign))
    } catch {
      // 忽略存储配额错误
    }
  }
  return getDesignDoc()
}

function oneLine(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, ' ').trim()
}

function fieldLine(label: string, value: string): string {
  return `- **${label}**：${oneLine(value) || '待定'}`
}

function fieldValue(doc: ProjectDesignDoc, key: LineFieldKey): string {
  return key === 'colorPalette' ? doc.colorPalette.join(', ') : doc[key]
}

export function formatDesignMarkdown(doc: ProjectDesignDoc): string {
  return [
    `# ${doc.title || '未命名游戏项目'}`,
    '',
    ...LINE_FIELDS.map((field) => fieldLine(field.label, fieldValue(doc, field.key))),
    `- **${UPDATED_LABEL}**：${doc.updatedAt}`,
    '',
    NOTES_HEADING,
    doc.notes || NOTES_EMPTY,
    '',
  ].join('\n')
}

function findFieldLine(lines: string[], label: string): number {
  const marker = `- **${label}**：`
  return lines.findIndex((line) => line.startsWith(marker))
}

/** 「补充说明」小节的范围：[标题行, 下一个一二级标题或文末) */
function notesRange(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.trim() === NOTES_HEADING)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return { start, end }
}

/**
 * 把结构化字段的改动写回 Markdown 原文：只动被修改字段对应的行与「更新时间」，其余内容逐字保留。
 */
export function applyDesignPatchToMarkdown(
  markdown: string,
  doc: ProjectDesignDoc,
  changedKeys: ReadonlyArray<keyof ProjectDesignDoc>,
): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r?\n/)
  const changed = new Set<string>(changedKeys)

  if (changed.has('title')) {
    const idx = lines.findIndex((line) => line.startsWith('# '))
    const heading = `# ${doc.title || '未命名游戏项目'}`
    if (idx >= 0) lines[idx] = heading
    else lines.unshift(heading, '')
  }

  /** 新字段行的插入位置：已有字段行的最后一行之后；一行都没有时放在标题之后 */
  const insertionIndex = (): number => {
    let last = -1
    for (const label of [...LINE_FIELDS.map((field) => field.label), UPDATED_LABEL]) {
      last = Math.max(last, findFieldLine(lines, label))
    }
    if (last >= 0) return last + 1
    const heading = lines.findIndex((line) => line.startsWith('# '))
    if (heading < 0) return 0
    lines.splice(heading + 1, 0, '')
    return heading + 2
  }

  for (const field of LINE_FIELDS) {
    if (!changed.has(field.key)) continue
    const line = fieldLine(field.label, fieldValue(doc, field.key))
    const idx = findFieldLine(lines, field.label)
    if (idx >= 0) lines[idx] = line
    else lines.splice(insertionIndex(), 0, line)
  }

  const updatedLine = `- **${UPDATED_LABEL}**：${doc.updatedAt}`
  const updatedIdx = findFieldLine(lines, UPDATED_LABEL)
  if (updatedIdx >= 0) lines[updatedIdx] = updatedLine
  else lines.splice(insertionIndex(), 0, updatedLine)

  if (changed.has('notes')) {
    const notesLines = (doc.notes || NOTES_EMPTY).split(/\r?\n/)
    const range = notesRange(lines)
    if (range) {
      const tail = range.end < lines.length ? [''] : []
      lines.splice(range.start + 1, range.end - range.start - 1, ...notesLines, ...tail)
    } else {
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
      lines.push('', NOTES_HEADING, ...notesLines)
    }
  }

  let out = lines.join(eol)
  if (!out.endsWith(eol)) out += eol
  return out
}

export function parseDesignMarkdown(md: string): ProjectDesignDoc {
  const doc = createDefaultDesignDoc()
  const lines = md.split(/\r?\n/)
  const heading = lines.find((l) => l.startsWith('# '))
  if (heading) doc.title = heading.slice(2).trim()

  const readField = (prefix: string): string | null => {
    const idx = findFieldLine(lines, prefix)
    if (idx < 0) return null
    const val = lines[idx].slice(`- **${prefix}**：`.length).trim()
    return val === '待定' ? '' : val
  }

  doc.genre = readField('类型') ?? doc.genre
  doc.perspective = readField('视角') ?? doc.perspective
  doc.coreLoop = readField('核心循环') ?? doc.coreLoop
  doc.winLose = readField('胜负条件') ?? doc.winLose
  doc.artStyle = readField('美术风格') ?? doc.artStyle
  const palette = readField('色彩板')
  if (palette) {
    doc.colorPalette = palette.split(',').map((s) => s.trim()).filter(Boolean)
  }
  doc.controls = readField('操作映射') ?? doc.controls
  doc.namingRules = readField('命名约定') ?? doc.namingRules
  doc.updatedAt = readField(UPDATED_LABEL) || doc.updatedAt

  const range = notesRange(lines)
  if (range) {
    const notesText = lines.slice(range.start + 1, range.end).join('\n').trim()
    doc.notes = notesText === NOTES_EMPTY ? '' : notesText
  }
  return doc
}
