/**
 * 工程设计规范与全局记忆（design.md）：
 * 立项时由 AI 与人共同维护，后续所有生产轮次自动注入上下文，保证跨多轮对话后风格、机制与命名不跑偏。
 * 有目录工程时同步读写磁盘上的 `design.md`，草稿工程保留在内存与 localStorage。
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

const STORAGE_KEY = 't3d:design-doc-draft'

let memoryDesign: ProjectDesignDoc = createDefaultDesignDoc()

export function createDefaultDesignDoc(): ProjectDesignDoc {
  return {
    title: '未命名游戏工程',
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

export async function loadDesignDocFromProject(): Promise<ProjectDesignDoc> {
  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge) {
    const file = joinProjectPath(dir, 'design.md')
    if (await bridge.fs.exists(file)) {
      const md = await bridge.fs.readTextFile(file)
      memoryDesign = parseDesignMarkdown(md)
      return getDesignDoc()
    }
  } else if (typeof localStorage !== 'undefined') {
    const cached = localStorage.getItem(STORAGE_KEY)
    if (cached) {
      try {
        memoryDesign = { ...createDefaultDesignDoc(), ...(JSON.parse(cached) as Partial<ProjectDesignDoc>) }
      } catch {
        // 忽略损坏的草稿缓存
      }
    }
  }
  return getDesignDoc()
}

export async function updateDesignDoc(patch: Partial<ProjectDesignDoc>): Promise<ProjectDesignDoc> {
  memoryDesign = {
    ...memoryDesign,
    ...patch,
    colorPalette: patch.colorPalette ? [...patch.colorPalette] : [...memoryDesign.colorPalette],
    updatedAt: new Date().toISOString(),
  }
  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge) {
    await bridge.fs.writeTextFile(joinProjectPath(dir, 'design.md'), formatDesignMarkdown(memoryDesign))
  } else if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryDesign))
    } catch {
      // 忽略存储配额错误
    }
  }
  return getDesignDoc()
}

export function formatDesignMarkdown(doc: ProjectDesignDoc): string {
  return [
    `# ${doc.title || '未命名游戏工程'}`,
    '',
    `- **类型**：${doc.genre || '待定'}`,
    `- **视角**：${doc.perspective || '待定'}`,
    `- **核心循环**：${doc.coreLoop || '待定'}`,
    `- **胜负条件**：${doc.winLose || '待定'}`,
    `- **美术风格**：${doc.artStyle || '待定'}`,
    `- **色彩板**：${doc.colorPalette.length > 0 ? doc.colorPalette.join(', ') : '待定'}`,
    `- **操作映射**：${doc.controls || '待定'}`,
    `- **命名约定**：${doc.namingRules || '待定'}`,
    `- **更新时间**：${doc.updatedAt}`,
    '',
    '## 补充说明',
    doc.notes || '（暂无）',
    '',
  ].join('\n')
}

export function parseDesignMarkdown(md: string): ProjectDesignDoc {
  const doc = createDefaultDesignDoc()
  const lines = md.split(/\r?\n/)
  const heading = lines.find((l) => l.startsWith('# '))
  if (heading) doc.title = heading.slice(2).trim()

  const readField = (prefix: string): string | null => {
    const line = lines.find((l) => l.startsWith(`- **${prefix}**：`))
    if (!line) return null
    const val = line.slice(prefix.length + 6).trim()
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

  const notesIdx = lines.findIndex((l) => l.trim() === '## 补充说明')
  if (notesIdx >= 0) {
    const notesText = lines.slice(notesIdx + 1).join('\n').trim()
    doc.notes = notesText === '（暂无）' ? '' : notesText
  }
  return doc
}
