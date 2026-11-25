/**
 * AI 扩展层的统一数据结构：规则 / 技能 / 知识 / 需求文档与验收检查。
 * 设计说明见 docs/ai-extensibility-design.md。
 *
 * 技能与知识只是「可读、可改的参考文本与源码」，AI 读取后落成工程里的普通脚本，不是积木或拼装系统。
 */

export type KnowledgeSource = 'builtin' | 'user' | 'project'
export type KnowledgeKind = 'skill' | 'knowledge'

export interface KnowledgeFileRef {
  /** 相对技能目录的路径（内置技能为 `<scriptId>.ts`） */
  path: string
  /** 挂载对象说明 */
  attachTo?: string
  /** 内置技能直接携带源码；文件技能按需从磁盘读取 */
  source?: string
}

export interface KnowledgeEntry {
  id: string
  kind: KnowledgeKind
  source: KnowledgeSource
  name: string
  /** 英文界面用的名称；没有时回退 name */
  nameEn?: string
  /** 目录里的一行说明：要写清「什么时候该用」 */
  description: string
  /** 英文界面用的说明；没有时回退 description */
  descriptionEn?: string
  /** 正文 Markdown（不含头部） */
  body: string
  files: KnowledgeFileRef[]
  /** 主文件绝对路径（内置条目没有） */
  absPath?: string
  /** 技能目录绝对路径（附带文件的根目录） */
  dirPath?: string
  /** 可选的用户入口名称：出现在知识面板的「执行」按钮上 */
  command?: string
  /** 加载时发现的问题（缺少必填项、描述过长等），只提示不阻断 */
  issues: string[]
  /** 被本条目覆盖的低优先级来源 */
  overrides?: KnowledgeSource[]
}

export interface KnowledgeRuleDoc {
  source: 'user' | 'project'
  absPath: string
  text: string
  /** 原文字符数 */
  length: number
  truncated: boolean
}

/** requirements.md 里的一条可机检验收项（```t3d-check 代码块） */
export interface RequirementCheck {
  name: string
  /** 与 playtest__run_smoke 的 steps 同构，执行前不做深度校验 */
  steps: unknown[]
}

export interface RequirementsDoc {
  absPath: string
  text: string
  length: number
  truncated: boolean
  checks: RequirementCheck[]
  issues: string[]
}

export interface KnowledgeSnapshot {
  /** 合并覆盖后的有效条目（含内置） */
  entries: KnowledgeEntry[]
  /** 被更高优先级来源覆盖掉的条目 */
  shadowed: KnowledgeEntry[]
  rules: KnowledgeRuleDoc[]
  requirements: RequirementsDoc | null
  projectRoot: string | null
  userRoot: string | null
  scannedAt: number
}

/** 加载器只需要这三个文件系统能力，测试里用内存实现替换 */
export interface KnowledgeFs {
  list: (dirPath: string) => Promise<Array<{ name: string; kind: 'file' | 'directory' }>>
  readTextFile: (filePath: string) => Promise<string>
  exists: (filePath: string) => Promise<boolean>
}

export const KNOWLEDGE_LIMITS = {
  rulesChars: 4000,
  requirementsChars: 8000,
  designChars: 8000,
  descriptionChars: 120,
  catalogEntries: 60,
  checks: 8,
} as const
