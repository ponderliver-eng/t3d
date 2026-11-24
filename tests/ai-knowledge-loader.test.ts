import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFrontmatter } from '../src/ai/knowledge/frontmatter'
import {
  findKnowledgeEntry,
  formatKnowledgeContext,
  isSafeRelativePath,
  loadKnowledgeSnapshot,
  parseRequirementChecks,
  readKnowledgeFile,
} from '../src/ai/knowledge/loader'
import { builtinKnowledgeEntries, RECIPES } from '../src/ai/knowledge/recipes'
import { KNOWLEDGE_LIMITS, type KnowledgeFs } from '../src/ai/knowledge/types'
import {
  applyDesignPatchToMarkdown,
  createDefaultDesignDoc,
  formatDesignMarkdown,
  parseDesignMarkdown,
} from '../src/core/project/designMemory'

/** 内存文件系统：键为正斜杠绝对路径 */
function memoryFs(files: Record<string, string>): KnowledgeFs {
  const paths = Object.keys(files)
  return {
    list: async (dirPath) => {
      const prefix = `${dirPath.replace(/[\\/]+$/, '')}/`
      const seen = new Map<string, 'file' | 'directory'>()
      for (const path of paths) {
        if (!path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length)
        const slash = rest.indexOf('/')
        if (slash < 0) seen.set(rest, 'file')
        else seen.set(rest.slice(0, slash), 'directory')
      }
      return Array.from(seen.entries()).map(([name, kind]) => ({ name, kind }))
    },
    readTextFile: async (filePath) => {
      if (!(filePath in files)) throw new Error(`ENOENT ${filePath}`)
      return files[filePath]
    },
    exists: async (filePath) => filePath in files,
  }
}

const SKILL_MD = `---
name: 塔防波次
description: "做塔防类刷怪：路径、波次表、漏怪扣血"
command: 搭建塔防波次
files:
  - path: Wave.ts
    attachTo: 空节点 WaveManager
  - Tower.ts
---

## 搭建步骤
1. 建路径
`

test('头部解析：标量、引号与 files 列表', () => {
  const fm = parseFrontmatter(SKILL_MD)
  assert.equal(fm.hasFrontmatter, true)
  assert.equal(fm.values.name, '塔防波次')
  assert.equal(fm.values.description, '做塔防类刷怪：路径、波次表、漏怪扣血')
  assert.deepEqual(fm.files, [{ path: 'Wave.ts', attachTo: '空节点 WaveManager' }, { path: 'Tower.ts' }])
  assert.ok(fm.body.startsWith('## 搭建步骤'))

  const plain = parseFrontmatter('# 标题\n正文')
  assert.equal(plain.hasFrontmatter, false)
  assert.equal(plain.body, '# 标题\n正文')
})

test('路径安全：拒绝越出技能目录的路径', () => {
  assert.equal(isSafeRelativePath('Wave.ts'), true)
  assert.equal(isSafeRelativePath('sub/Wave.ts'), true)
  assert.equal(isSafeRelativePath('../secret.txt'), false)
  assert.equal(isSafeRelativePath('a/../../b'), false)
  assert.equal(isSafeRelativePath('/etc/passwd'), false)
  assert.equal(isSafeRelativePath('C:/Windows/x'), false)
  assert.equal(isSafeRelativePath(''), false)
})

test('加载：三级来源合并，工程覆盖用户全局与内置', async () => {
  const builtinId = RECIPES[0].id
  const fs = memoryFs({
    '/user/ai/skills/tower-wave/SKILL.md': SKILL_MD.replace('塔防波次', '用户版塔防'),
    '/user/ai/rules.md': '- 用户规则',
    '/proj/ai/skills/tower-wave/SKILL.md': SKILL_MD,
    '/proj/ai/skills/tower-wave/Wave.ts': 'export const wave = 1',
    '/proj/ai/skills/tower-wave/Tower.ts': 'export const tower = 1',
    [`/proj/ai/skills/${builtinId}/SKILL.md`]: '---\nname: 工程版控制器\ndescription: 覆盖内置\n---\n正文',
    '/proj/ai/skills/no-main/readme.md': '没有 SKILL.md 的目录应被忽略',
    '/proj/ai/knowledge/naming.md': '# 命名约定\n- 节点用中文',
    '/proj/ai/rules.md': '- 工程规则',
    '/proj/requirements.md': '# 需求\n- 能移动',
  })
  const snapshot = await loadKnowledgeSnapshot({ fs, builtin: builtinKnowledgeEntries(), projectRoot: '/proj', userRoot: '/user/ai' })

  const tower = findKnowledgeEntry(snapshot, 'tower-wave')
  assert.equal(tower?.source, 'project')
  assert.equal(tower?.name, '塔防波次')
  assert.equal(tower?.command, '搭建塔防波次')
  assert.deepEqual(tower?.overrides, ['user'])
  assert.deepEqual(tower?.issues, [])

  const overridden = findKnowledgeEntry(snapshot, builtinId)
  assert.equal(overridden?.source, 'project')
  assert.deepEqual(overridden?.overrides, ['builtin'])

  assert.equal(findKnowledgeEntry(snapshot, 'no-main'), null)
  assert.equal(findKnowledgeEntry(snapshot, 'naming')?.kind, 'knowledge')
  assert.equal(findKnowledgeEntry(snapshot, 'naming')?.description, '命名约定')
  assert.equal(snapshot.entries.filter((entry) => entry.source === 'builtin').length, RECIPES.length - 1)
  assert.equal(snapshot.shadowed.length, 2)

  assert.deepEqual(snapshot.rules.map((rule) => rule.source), ['project', 'user'])
  assert.equal(snapshot.requirements?.checks.length, 0)

  const file = await readKnowledgeFile(tower!, 'Wave.ts', fs)
  assert.deepEqual(file, { ok: true, source: 'export const wave = 1' })
  const escape = await readKnowledgeFile(tower!, '../../rules.md', fs)
  assert.equal(escape.ok, false)

  // 停用后查不到，目录里也不出现
  assert.equal(findKnowledgeEntry(snapshot, 'tower-wave', new Set(['tower-wave'])), null)
  const ctx = formatKnowledgeContext(snapshot, new Set(['tower-wave']))
  assert.ok(!ctx.text.includes('tower-wave'))
  assert.ok(ctx.text.includes('- 工程规则'))
  assert.ok(ctx.text.includes('naming：命名约定'))
  assert.equal(ctx.injection.requirements, true)
  assert.deepEqual(ctx.injection.rules, ['工程规则', '用户全局规则'])
})

test('加载：没有文件系统或工程目录时只有内置条目', async () => {
  const snapshot = await loadKnowledgeSnapshot({ fs: null, builtin: builtinKnowledgeEntries(), projectRoot: null, userRoot: null })
  assert.equal(snapshot.entries.length, RECIPES.length)
  assert.equal(formatKnowledgeContext(snapshot).text, '')
  // 兼容旧用法：按脚本 ID 查内置范例
  const scriptId = RECIPES[0].files[0].scriptId
  assert.equal(findKnowledgeEntry(snapshot, scriptId)?.id, RECIPES[0].id)
  const file = await readKnowledgeFile(findKnowledgeEntry(snapshot, RECIPES[0].id)!, `${scriptId}.ts`, null)
  assert.equal(file.ok && file.source, RECIPES[0].files[0].source)
})

test('加载：规则超出上限时截断并标记', async () => {
  const fs = memoryFs({ '/proj/ai/rules.md': 'x'.repeat(KNOWLEDGE_LIMITS.rulesChars + 500) })
  const snapshot = await loadKnowledgeSnapshot({ fs, builtin: [], projectRoot: '/proj', userRoot: null })
  assert.equal(snapshot.rules[0].truncated, true)
  assert.equal(snapshot.rules[0].length, KNOWLEDGE_LIMITS.rulesChars + 500)
  assert.deepEqual(formatKnowledgeContext(snapshot).injection.truncated, ['工程规则（ai/rules.md）'])
})

test('需求文档：解析 t3d-check 验收块并报告写错的块', () => {
  const md = [
    '# 需求',
    '```t3d-check',
    '{ "name": "能前进", "steps": [{ "action": "step", "seconds": 1 }] }',
    '```',
    '```t3d-check',
    '{ 不是 json }',
    '```',
    '```t3d-check',
    '{ "name": "缺步骤" }',
    '```',
    '```json',
    '{ "name": "普通代码块不算", "steps": [1] }',
    '```',
  ].join('\n')
  const { checks, issues } = parseRequirementChecks(md)
  assert.deepEqual(checks, [{ name: '能前进', steps: [{ action: 'step', seconds: 1 }] }])
  assert.equal(issues.length, 2)
})

test('design.md：更新字段只替换对应行，手写章节逐字保留', () => {
  const original = [
    '# 星际快递',
    '',
    '这是一段我手写的开场白，不属于任何字段。',
    '',
    '- **类型**：俯视角射击',
    '- **视角**：待定',
    '- **更新时间**：2026-01-01T00:00:00.000Z',
    '',
    '## 关卡列表',
    '1. 太空港',
    '2. 小行星带',
    '',
    '## 补充说明',
    '旧说明',
    '',
    '## 美术参考',
    '- 低多边形',
    '',
  ].join('\n')

  const doc = parseDesignMarkdown(original)
  assert.equal(doc.title, '星际快递')
  assert.equal(doc.genre, '俯视角射击')
  assert.equal(doc.perspective, '')
  assert.equal(doc.notes, '旧说明')

  const next = { ...doc, perspective: '俯视 45°', artStyle: '低多边形', notes: '旧说明\n\n新增一条', updatedAt: '2026-02-02T00:00:00.000Z' }
  const out = applyDesignPatchToMarkdown(original, next, ['perspective', 'artStyle', 'notes'])

  assert.ok(out.includes('这是一段我手写的开场白，不属于任何字段。'))
  assert.ok(out.includes('## 关卡列表\n1. 太空港\n2. 小行星带'))
  assert.ok(out.includes('## 美术参考\n- 低多边形'))
  assert.ok(out.includes('- **类型**：俯视角射击'))
  assert.ok(out.includes('- **视角**：俯视 45°'))
  assert.ok(out.includes('- **美术风格**：低多边形'))
  assert.ok(out.includes('- **更新时间**：2026-02-02T00:00:00.000Z'))
  assert.ok(out.includes('## 补充说明\n旧说明\n\n新增一条\n\n## 美术参考'))

  const reparsed = parseDesignMarkdown(out)
  assert.equal(reparsed.perspective, '俯视 45°')
  assert.equal(reparsed.artStyle, '低多边形')
  assert.equal(reparsed.notes, '旧说明\n\n新增一条')
})

test('design.md：默认格式可往返，纯自由格式也能补上字段', () => {
  const base = createDefaultDesignDoc()
  const md = formatDesignMarkdown({ ...base, genre: '平台跳跃', colorPalette: ['#fff', '#000'] })
  const parsed = parseDesignMarkdown(md)
  assert.equal(parsed.genre, '平台跳跃')
  assert.deepEqual(parsed.colorPalette, ['#fff', '#000'])

  const free = '# 我的游戏\n\n随便写的设计想法。\n'
  const doc = { ...parseDesignMarkdown(free), genre: '解谜', updatedAt: '2026-03-03T00:00:00.000Z' }
  const out = applyDesignPatchToMarkdown(free, doc, ['genre'])
  assert.ok(out.includes('随便写的设计想法。'))
  assert.equal(parseDesignMarkdown(out).genre, '解谜')
  assert.equal(parseDesignMarkdown(out).title, '我的游戏')
})
