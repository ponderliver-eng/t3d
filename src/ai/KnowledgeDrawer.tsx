import { useEffect, useState } from 'react'
import { AlertTriangle, BookOpen, Copy, FileText, FolderOpen, Play, Plus, RefreshCw, X } from 'lucide-react'
import { electronBridge } from '../editor/project/electronBridge'
import { resolveLanguage, usePrefsStore } from '../editor/prefs/store'
import { useEditorStore } from '../editor/scene/store'
import { joinPath, knowledgeSourceLabel, type KnowledgeInjection } from './knowledge/loader'
import { useKnowledgeStore } from './knowledge/store'
import { KNOWLEDGE_LIMITS, type KnowledgeEntry, type KnowledgeSource } from './knowledge/types'

/**
 * 知识面板：把「AI 能用到的规则、技能、知识、需求文档」全部摆出来，可打开、可新建、可停用。
 * 所有内容都是工程目录或用户目录下的普通 Markdown 文件，这里只做入口与状态展示。
 */

const RULES_TEMPLATE = `# 工程规则

这里的内容每一轮都会完整发给 AI，请保持简短（上限 ${KNOWLEDGE_LIMITS.rulesChars} 字符）。
较长的资料请放到 ai/knowledge/ 下，AI 会按需读取。

- （示例）所有敌人节点必须带 "enemy" 标签
- （示例）脚本统一放在 Assets/Scripts/<模块>/ 下
`

const REQUIREMENTS_TEMPLATE = `# 需求与验收

AI 做中大型任务时以本文件为目标，收尾时逐条对照。

## 玩法需求

- （示例）玩家用 WASD 移动，碰到金币得 1 分

## 验收标准

- （示例）开局 HUD 显示得分 0

## 自动验收（可选）

把下面代码块的语言标记从 json 改成 t3d-check 后，AI 每次改完工程都会由系统自动执行它，
不通过会要求 AI 返修。steps 的写法与 AI 工具 playtest__run_smoke 相同。

\`\`\`json
{
  "name": "开局得分为 0",
  "steps": [
    { "action": "step", "seconds": 0.5 },
    { "action": "assert", "condition": { "kind": "uiVarEquals", "name": "score", "value": 0 } }
  ]
}
\`\`\`
`

function skillTemplate(name: string): string {
  return `---
name: ${name}
description: 一句话说明什么时候该用这个技能（AI 只凭这一行决定是否读取）
---

## 搭建步骤

1. 

## 验收

用 playtest__run_smoke 怎么确认做对了。

## 常见坑

- 
`
}

function knowledgeTemplate(name: string): string {
  return `---
description: 一句话说明这份资料讲什么
---

# ${name}

`
}

function entryToSkillMarkdown(entry: KnowledgeEntry): string {
  const files = entry.files.length > 0
    ? ['files:', ...entry.files.flatMap((file) => [`  - path: ${file.path}`, ...(file.attachTo ? [`    attachTo: ${file.attachTo}`] : [])])]
    : []
  return ['---', `name: ${entry.name}`, `description: ${entry.description}`, ...files, '---', '', entry.body, ''].join('\n')
}

const SOURCE_ORDER: KnowledgeSource[] = ['project', 'user', 'builtin']

export default function KnowledgeDrawer({ onClose, onUse }: { onClose: () => void; onUse: (prompt: string) => void }) {
  const zh = resolveLanguage(usePrefsStore((s) => s.language)) !== 'en'
  const L = (cn: string, en: string) => (zh ? cn : en)
  const snapshot = useKnowledgeStore((s) => s.snapshot)
  const disabledIds = useKnowledgeStore((s) => s.disabledIds)
  const lastInjection = useKnowledgeStore((s) => s.lastInjection)
  const loading = useKnowledgeStore((s) => s.loading)
  const refresh = useKnowledgeStore((s) => s.refresh)
  const setEnabled = useKnowledgeStore((s) => s.setEnabled)
  const [newId, setNewId] = useState('')
  const [creating, setCreating] = useState<null | 'skill' | 'knowledge'>(null)
  const [designExists, setDesignExists] = useState(false)

  const bridge = electronBridge()
  const projectRoot = snapshot.projectRoot
  const notify = (message: string) => useEditorStore.getState().notify(message)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!projectRoot || !bridge) {
      setDesignExists(false)
      return
    }
    void bridge.fs.exists(joinPath(projectRoot, 'design.md')).then(setDesignExists).catch(() => setDesignExists(false))
  }, [projectRoot, bridge, snapshot.scannedAt])

  const openPath = async (absPath: string) => {
    try {
      await bridge?.shell.openPath(absPath)
    } catch (error) {
      notify(L('打开失败：', 'Open failed: ') + (error instanceof Error ? error.message : String(error)))
    }
  }

  const ensureAndOpen = async (absPath: string, template: string) => {
    if (!bridge) return
    try {
      if (!(await bridge.fs.exists(absPath))) await bridge.fs.writeTextFile(absPath, template)
      await refresh()
      await openPath(absPath)
    } catch (error) {
      notify(L('创建失败：', 'Create failed: ') + (error instanceof Error ? error.message : String(error)))
    }
  }

  const createEntry = async () => {
    if (!bridge || !projectRoot || !creating) return
    const id = newId.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      notify(L('ID 只能使用小写字母、数字和连字符', 'ID may only contain lowercase letters, digits and hyphens'))
      return
    }
    const absPath = creating === 'skill'
      ? joinPath(projectRoot, `ai/skills/${id}/SKILL.md`)
      : joinPath(projectRoot, `ai/knowledge/${id}.md`)
    if (await bridge.fs.exists(absPath)) {
      notify(L('同名条目已存在', 'An entry with this ID already exists'))
      return
    }
    await ensureAndOpen(absPath, creating === 'skill' ? skillTemplate(id) : knowledgeTemplate(id))
    setCreating(null)
    setNewId('')
  }

  const copyToProject = async (entry: KnowledgeEntry) => {
    if (!bridge || !projectRoot) return
    try {
      if (entry.kind === 'knowledge') {
        const target = joinPath(projectRoot, `ai/knowledge/${entry.id}.md`)
        if (await bridge.fs.exists(target)) {
          notify(L('工程里已有同名条目', 'The project already has this entry'))
          return
        }
        const raw = entry.absPath ? await bridge.fs.readTextFile(entry.absPath) : entry.body
        await bridge.fs.writeTextFile(target, raw)
        await refresh()
        await openPath(target)
        return
      }
      const dir = joinPath(projectRoot, `ai/skills/${entry.id}`)
      const main = joinPath(dir, 'SKILL.md')
      if (await bridge.fs.exists(main)) {
        notify(L('工程里已有同名技能', 'The project already has this skill'))
        return
      }
      const mainText = entry.absPath ? await bridge.fs.readTextFile(entry.absPath) : entryToSkillMarkdown(entry)
      await bridge.fs.writeTextFile(main, mainText)
      for (const file of entry.files) {
        const source = file.source ?? (entry.dirPath ? await bridge.fs.readTextFile(joinPath(entry.dirPath, file.path)).catch(() => null) : null)
        if (typeof source === 'string') await bridge.fs.writeTextFile(joinPath(dir, file.path), source)
      }
      await refresh()
      notify(L(`已复制到工程 ai/skills/${entry.id}，之后以工程版本为准`, `Copied to ai/skills/${entry.id}; the project copy now takes precedence`))
      await openPath(main)
    } catch (error) {
      notify(L('复制失败：', 'Copy failed: ') + (error instanceof Error ? error.message : String(error)))
    }
  }

  const docs: Array<{ key: string; label: string; hint: string; absPath: string | null; exists: boolean; template: string | null; status: string; warn?: boolean }> = []
  const projectRule = snapshot.rules.find((rule) => rule.source === 'project')
  const userRule = snapshot.rules.find((rule) => rule.source === 'user')
  const req = snapshot.requirements
  docs.push({
    key: 'design',
    label: 'design.md',
    hint: L('设计概要，每轮全文注入', 'Design brief, injected every turn'),
    absPath: projectRoot ? joinPath(projectRoot, 'design.md') : null,
    exists: designExists,
    template: null,
    status: designExists ? L('已启用', 'Active') : L('未创建（在工程管理的设计页保存后生成）', 'Not created (save in Project Manager → Design)'),
  })
  docs.push({
    key: 'requirements',
    label: 'requirements.md',
    hint: L('需求与验收标准', 'Requirements & acceptance'),
    absPath: projectRoot ? joinPath(projectRoot, 'requirements.md') : null,
    exists: Boolean(req),
    template: REQUIREMENTS_TEMPLATE,
    status: req
      ? `${req.length} ${L('字符', 'chars')}${req.truncated ? L('（已截断）', ' (truncated)') : ''} · ${req.checks.length} ${L('条自动验收', 'auto checks')}`
      : L('未创建', 'Not created'),
    warn: Boolean(req && (req.truncated || req.issues.length > 0)),
  })
  docs.push({
    key: 'rules',
    label: 'ai/rules.md',
    hint: L('工程规则，每轮全文注入', 'Project rules, injected every turn'),
    absPath: projectRoot ? joinPath(projectRoot, 'ai/rules.md') : null,
    exists: Boolean(projectRule),
    template: RULES_TEMPLATE,
    status: projectRule
      ? `${projectRule.length} ${L('字符', 'chars')}${projectRule.truncated ? L('（超出上限已截断）', ' (truncated)') : ''}`
      : L('未创建', 'Not created'),
    warn: Boolean(projectRule?.truncated),
  })
  docs.push({
    key: 'user-rules',
    label: L('用户全局 rules.md', 'User rules.md'),
    hint: L('跨工程生效的个人规则', 'Personal rules across projects'),
    absPath: snapshot.userRoot ? joinPath(snapshot.userRoot, 'rules.md') : null,
    exists: Boolean(userRule),
    template: RULES_TEMPLATE.replace('# 工程规则', '# 用户全局规则'),
    status: userRule
      ? `${userRule.length} ${L('字符', 'chars')}${userRule.truncated ? L('（超出上限已截断）', ' (truncated)') : ''}`
      : L('未创建', 'Not created'),
    warn: Boolean(userRule?.truncated),
  })

  const groups = SOURCE_ORDER.map((source) => ({
    source,
    entries: snapshot.entries.filter((entry) => entry.source === source).sort((a, b) => a.id.localeCompare(b.id)),
  }))

  const injectionText = lastInjection
    ? [
        ...lastInjection.rules,
        lastInjection.requirements ? `requirements.md${lastInjection.checks > 0 ? `（${lastInjection.checks} ${L('条自动验收', 'checks')}）` : ''}` : '',
        lastInjection.skills + lastInjection.knowledge > 0
          ? L(`目录 ${lastInjection.skills} 技能 / ${lastInjection.knowledge} 知识`, `catalog ${lastInjection.skills} skills / ${lastInjection.knowledge} docs`)
          : '',
      ]
        .filter(Boolean)
        .join(' · ') || L('只有 design.md 与内置范例', 'design.md and built-in recipes only')
    : L('本次启动后还没有对话', 'No turns yet in this session')

  return (
    <div style={drawerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <BookOpen size={13} color="#60a5fa" />
        <span style={{ fontWeight: 600, color: '#d4d4d8' }}>{L('AI 知识与规则', 'AI Knowledge & Rules')}</span>
        <button type="button" style={{ ...miniBtn, marginLeft: 'auto' }} title={L('重新扫描', 'Rescan')} onClick={() => void refresh()}>
          <RefreshCw size={12} style={{ opacity: loading ? 0.4 : 1 }} />
        </button>
        <button type="button" style={miniBtn} title={L('关闭', 'Close')} onClick={onClose}>
          <X size={12} />
        </button>
      </div>

      <div style={hintStyle}>
        {L(
          '这里列出 AI 能用到的全部规则、技能与知识。它们都是普通 Markdown 文件，改完保存后下一轮对话立即生效。',
          'Everything the AI can draw on. These are plain Markdown files; edits take effect on the next turn.',
        )}
      </div>
      <div style={{ ...hintStyle, color: '#93c5fd' }}>
        {L('上一轮注入：', 'Last turn injected: ')}
        {injectionText}
      </div>

      {!bridge && <div style={warnStyle}>{L('浏览器模式下只有内置范例可用', 'Only built-in recipes are available in browser mode')}</div>}
      {bridge && !projectRoot && (
        <div style={warnStyle}>{L('当前是未保存到文件夹的草稿工程：工程级规则与技能需要先另存为目录工程', 'Draft project: save it to a folder to use project rules and skills')}</div>
      )}

      {/* 文档 */}
      <div style={sectionTitle}>{L('始终生效的文档', 'Always-on documents')}</div>
      {docs.map((doc) => (
        <div key={doc.key} style={rowStyle}>
          <FileText size={12} color={doc.exists ? '#86efac' : '#71717a'} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#e4e4e7' }}>
              {doc.label} <span style={{ color: '#71717a' }}>· {doc.hint}</span>
            </div>
            <div style={{ color: doc.warn ? '#fbbf24' : '#a1a1aa' }}>{doc.status}</div>
            {doc.key === 'requirements' && req?.issues.map((issue) => (
              <div key={issue} style={{ color: '#fbbf24' }}>⚠ {issue}</div>
            ))}
          </div>
          {doc.absPath && bridge && (doc.exists || doc.template) && (
            <button
              type="button"
              style={textBtn}
              onClick={() => void (doc.exists || !doc.template ? openPath(doc.absPath as string) : ensureAndOpen(doc.absPath as string, doc.template))}
            >
              {doc.exists ? L('打开', 'Open') : L('创建', 'Create')}
            </button>
          )}
        </div>
      ))}

      {/* 技能与知识 */}
      <div style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{L('按需读取的技能与知识', 'On-demand skills & knowledge')}</span>
        {bridge && projectRoot && (
          <>
            <button type="button" style={{ ...textBtn, marginLeft: 'auto' }} onClick={() => setCreating(creating === 'skill' ? null : 'skill')}>
              <Plus size={11} /> {L('技能', 'Skill')}
            </button>
            <button type="button" style={textBtn} onClick={() => setCreating(creating === 'knowledge' ? null : 'knowledge')}>
              <Plus size={11} /> {L('知识', 'Doc')}
            </button>
            <button type="button" style={textBtn} title={L('打开工程 ai 目录', 'Open project ai folder')} onClick={() => void bridge.fs.mkdir(joinPath(projectRoot, 'ai')).then(() => openPath(joinPath(projectRoot, 'ai')))}>
              <FolderOpen size={11} />
            </button>
          </>
        )}
      </div>
      {creating && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            autoFocus
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createEntry()
              if (e.key === 'Escape') setCreating(null)
            }}
            placeholder={creating === 'skill' ? L('技能 ID，如 tower-defense-wave', 'Skill ID, e.g. tower-defense-wave') : L('知识 ID，如 naming-rules', 'Doc ID, e.g. naming-rules')}
            style={inputStyle}
          />
          <button type="button" style={textBtn} onClick={() => void createEntry()}>
            {L('创建', 'Create')}
          </button>
        </div>
      )}

      {groups.map((group) =>
        group.entries.length === 0 ? null : (
          <div key={group.source} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ color: '#71717a', fontSize: 10, marginTop: 2 }}>
              {group.source === 'project' ? L('工程', 'Project') : group.source === 'user' ? L('用户全局', 'User') : L('内置（只读）', 'Built-in (read-only)')}
              {' · '}
              {group.entries.length}
            </div>
            {group.entries.map((entry) => {
              const enabled = entry.source === 'builtin' || !disabledIds.includes(entry.id)
              return (
                <div key={`${entry.source}:${entry.id}`} style={{ ...rowStyle, opacity: enabled ? 1 : 0.5 }}>
                  {entry.source !== 'builtin' ? (
                    <input
                      type="checkbox"
                      checked={enabled}
                      title={L('启用 / 停用', 'Enable / disable')}
                      onChange={(e) => setEnabled(entry.id, e.target.checked)}
                      style={{ marginTop: 2, flexShrink: 0 }}
                    />
                  ) : (
                    <BookOpen size={12} color="#71717a" style={{ flexShrink: 0, marginTop: 2 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e4e4e7' }}>
                      {entry.name}{' '}
                      <span style={{ color: '#71717a' }}>
                        {entry.id} · {entry.kind === 'skill' ? L('技能', 'skill') : L('知识', 'doc')}
                        {entry.files.length > 0 ? ` · ${entry.files.length} ${L('个文件', 'files')}` : ''}
                      </span>
                    </div>
                    <div style={{ color: '#a1a1aa' }}>{entry.description}</div>
                    {entry.overrides && entry.overrides.length > 0 && (
                      <div style={{ color: '#93c5fd' }}>
                        {L('已覆盖：', 'Overrides: ')}
                        {entry.overrides.map((source) => knowledgeSourceLabel(source)).join('、')}
                      </div>
                    )}
                    {entry.issues.map((issue) => (
                      <div key={issue} style={{ color: '#fbbf24', display: 'flex', gap: 4, alignItems: 'center' }}>
                        <AlertTriangle size={10} /> {issue}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {enabled && entry.kind === 'skill' && (
                      <button
                        type="button"
                        style={miniBtn}
                        title={L('填入对话框：让 AI 按这个技能做', 'Prefill a prompt that uses this skill')}
                        onClick={() =>
                          onUse(
                            L(
                              `请按技能「${entry.command || entry.name}」（kb__read id: ${entry.id}）完成：`,
                              `Use the skill "${entry.command || entry.name}" (kb__read id: ${entry.id}) to: `,
                            ),
                          )
                        }
                      >
                        <Play size={11} />
                      </button>
                    )}
                    {entry.absPath && bridge && (
                      <button type="button" style={miniBtn} title={L('打开文件', 'Open file')} onClick={() => void openPath(entry.absPath as string)}>
                        <FileText size={11} />
                      </button>
                    )}
                    {entry.source !== 'project' && bridge && projectRoot && (
                      <button
                        type="button"
                        style={miniBtn}
                        title={L('复制到工程后修改（工程版本会覆盖它）', 'Copy into the project to customize (project copy wins)')}
                        onClick={() => void copyToProject(entry)}
                      >
                        <Copy size={11} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ),
      )}

      {snapshot.userRoot && bridge && (
        <button type="button" style={{ ...textBtn, alignSelf: 'flex-start' }} onClick={() => void bridge.fs.mkdir(snapshot.userRoot as string).then(() => openPath(snapshot.userRoot as string))}>
          <FolderOpen size={11} /> {L('打开用户全局目录', 'Open user folder')}
        </button>
      )}
    </div>
  )
}

/** 对话里每轮助手回复上方的一行：这轮 AI 带了哪些扩展内容、需求验收是否通过 */
export function TurnContextLine({
  context,
  checks,
  onOpen,
}: {
  context?: KnowledgeInjection
  checks?: Array<{ name: string; passed: boolean }>
  onOpen: () => void
}) {
  const zh = resolveLanguage(usePrefsStore((s) => s.language)) !== 'en'
  const parts: string[] = []
  if (context) {
    parts.push(...context.rules)
    if (context.requirements) parts.push('requirements.md')
    if (context.skills > 0) parts.push(zh ? `${context.skills} 个技能` : `${context.skills} skills`)
    if (context.knowledge > 0) parts.push(zh ? `${context.knowledge} 份知识` : `${context.knowledge} docs`)
  }
  const failed = checks?.filter((item) => !item.passed) ?? []
  if (parts.length === 0 && (!checks || checks.length === 0)) return null
  return (
    <button
      type="button"
      onClick={onOpen}
      title={[
        zh ? '本轮注入的扩展内容（点击查看知识面板）' : 'Extension content injected this turn (click to open)',
        ...(context?.truncated.length ? [`${zh ? '已截断：' : 'Truncated: '}${context.truncated.join(', ')}`] : []),
        ...(checks ?? []).map((item) => `${item.passed ? '✓' : '✗'} ${item.name}`),
      ].join('\n')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 6px',
        borderRadius: 4,
        border: '1px solid rgba(96,165,250,0.2)',
        background: 'rgba(96,165,250,0.06)',
        color: '#93c5fd',
        fontSize: 10,
        cursor: 'pointer',
        textAlign: 'left',
        alignSelf: 'flex-start',
        maxWidth: '100%',
      }}
    >
      <BookOpen size={10} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {parts.length > 0 ? parts.join(' · ') : zh ? '需求验收' : 'Checks'}
      </span>
      {checks && checks.length > 0 && (
        <span style={{ color: failed.length > 0 ? '#fca5a5' : '#86efac', flexShrink: 0 }}>
          {zh ? '验收' : 'checks'} {checks.length - failed.length}/{checks.length}
        </span>
      )}
    </button>
  )
}

const drawerStyle: React.CSSProperties = {
  margin: '8px',
  padding: '10px',
  border: '1px solid rgba(96, 165, 250, 0.45)',
  borderRadius: '8px',
  background: '#111520',
  boxShadow: '0 4px 18px rgba(0, 0, 0, 0.4)',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  maxHeight: '62vh',
  overflowY: 'auto',
  flexShrink: 0,
  fontSize: '11px',
}

const hintStyle: React.CSSProperties = { color: '#a1a1aa', lineHeight: 1.5 }

const warnStyle: React.CSSProperties = {
  color: '#fbbf24',
  background: 'rgba(245,158,11,0.1)',
  border: '1px solid rgba(245,158,11,0.3)',
  borderRadius: 4,
  padding: '4px 6px',
}

const sectionTitle: React.CSSProperties = { color: '#d4d4d8', fontWeight: 600, marginTop: 4 }

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'flex-start',
  padding: '5px 6px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.06)',
  background: 'rgba(255,255,255,0.03)',
  lineHeight: 1.45,
  wordBreak: 'break-word',
}

const miniBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.05)',
  color: '#d4d4d8',
  cursor: 'pointer',
  padding: 0,
}

const textBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  height: 20,
  padding: '0 6px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.05)',
  color: '#d4d4d8',
  cursor: 'pointer',
  fontSize: 11,
  flexShrink: 0,
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 22,
  padding: '0 6px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#0f0f12',
  color: '#e4e4e7',
  fontSize: 11,
  outline: 'none',
}
