/**
 * Markdown 头部（frontmatter）解析：只支持本扩展层用到的 YAML 子集，不引入 YAML 依赖。
 *
 * 支持：
 *   key: value            标量（可带单/双引号）
 *   files:                对象列表
 *     - path: A.ts
 *       attachTo: 说明
 *     - B.ts              也可以直接写字符串
 */

export interface FrontmatterFile {
  path: string
  attachTo?: string
}

export interface ParsedFrontmatter {
  /** 标量键值 */
  values: Record<string, string>
  files: FrontmatterFile[]
  body: string
  hasFrontmatter: boolean
}

function unquote(raw: string): string {
  const text = raw.trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return text.slice(1, -1)
  }
  return text
}

function splitKeyValue(line: string): { key: string; value: string } | null {
  const idx = line.indexOf(':')
  if (idx <= 0) return null
  const key = line.slice(0, idx).trim()
  if (!/^[A-Za-z_][\w-]*$/.test(key)) return null
  return { key, value: unquote(line.slice(idx + 1)) }
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const text = markdown.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return { values: {}, files: [], body: text, hasFrontmatter: false }
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) {
    return { values: {}, files: [], body: text, hasFrontmatter: false }
  }

  const values: Record<string, string> = {}
  const files: FrontmatterFile[] = []
  let listKey: string | null = null
  let current: FrontmatterFile | null = null

  for (const rawLine of lines.slice(1, end)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue
    const indented = /^\s/.test(rawLine)
    const line = rawLine.trim()

    if (!indented && !line.startsWith('-')) {
      const kv = splitKeyValue(line)
      if (!kv) continue
      current = null
      if (kv.value === '') {
        listKey = kv.key
      } else {
        listKey = null
        values[kv.key] = kv.value
      }
      continue
    }

    if (listKey !== 'files') continue
    if (line.startsWith('-')) {
      const rest = line.slice(1).trim()
      const kv = splitKeyValue(rest)
      if (kv && (kv.key === 'path' || kv.key === 'attachTo')) {
        current = { path: '' }
        if (kv.key === 'path') current.path = kv.value
        else current.attachTo = kv.value
      } else {
        current = { path: unquote(rest) }
      }
      files.push(current)
      continue
    }
    if (current) {
      const kv = splitKeyValue(line)
      if (kv?.key === 'path') current.path = kv.value
      if (kv?.key === 'attachTo') current.attachTo = kv.value
    }
  }

  return {
    values,
    files: files.filter((file) => file.path),
    body: lines.slice(end + 1).join('\n').replace(/^\n+/, ''),
    hasFrontmatter: true,
  }
}

/** 取正文第一个标题文本（没有头部描述时的回退） */
export function firstHeading(markdown: string): string {
  const line = markdown.split(/\r?\n/).find((item) => /^#{1,6}\s+/.test(item))
  return line ? line.replace(/^#{1,6}\s+/, '').trim() : ''
}
