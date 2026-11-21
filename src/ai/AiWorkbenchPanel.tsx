import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Copy, Download, Loader2, RotateCcw, Send, Settings, Sparkles, Square, Trash2, Upload, X } from 'lucide-react'
import { createCheckpoint } from '../core/project/checkpoints'
import { useManagerModalStore } from '../core/project/ProjectManagerModal'
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { useEditorStore } from '../editor/scene/store'
import { useAgentStore } from './agentLoop'
import { parseImportedAiHistory, serializeAiHistoryForExport } from './historyStorage'

export default function AiWorkbenchPanel() {
  const panelOpen = useAgentStore((s) => s.panelOpen)
  const setPanelOpen = useAgentStore((s) => s.setPanelOpen)
  const status = useAgentStore((s) => s.status)
  const phaseText = useAgentStore((s) => s.phaseText)
  const startedAt = useAgentStore((s) => s.startedAt)
  const turns = useAgentStore((s) => s.turns)
  const pendingAttachmentImage = useAgentStore((s) => s.pendingAttachmentImage)
  const setPendingAttachmentImage = useAgentStore((s) => s.setPendingAttachmentImage)
  const streamingText = useAgentStore((s) => s.streamingText)
  const providers = useAgentStore((s) => s.providers)
  const activeProviderId = useAgentStore((s) => s.activeProviderId)
  const pendingConfirm = useAgentStore((s) => s.pendingConfirm)
  const refreshProviders = useAgentStore((s) => s.refreshProviders)
  const saveProvider = useAgentStore((s) => s.saveProvider)
  const setActiveProvider = useAgentStore((s) => s.setActiveProvider)
  const sendPrompt = useAgentStore((s) => s.sendPrompt)
  const abort = useAgentStore((s) => s.abort)
  const rollbackTurn = useAgentStore((s) => s.rollbackTurn)
  const clearTurns = useAgentStore((s) => s.clearTurns)
  const importTurns = useAgentStore((s) => s.importTurns)

  const selection = useEditorStore((s) => s.selection)
  const nodes = useEditorStore((s) => s.nodes)
  const codeAssets = useCodeAssetStore((s) => s.assets)

  const [input, setInput] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editBaseUrl, setEditBaseUrl] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editApiKey, setEditApiKey] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null)

  const copyTurnText = async (turnId: string, content: string) => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = content
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopiedTurnId(turnId)
    window.setTimeout(() => {
      setCopiedTurnId((cur) => (cur === turnId ? null : cur))
    }, 1500)
  }

  useEffect(() => {
    if (status === 'idle' || !startedAt) {
      setElapsedMs(0)
      return
    }
    setElapsedMs(Date.now() - startedAt)
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, 200)
    return () => window.clearInterval(timer)
  }, [status, startedAt])

  const handleExportHistory = () => {
    if (turns.length === 0) {
      useEditorStore.getState().notify('当前没有可导出的对话记录')
      return
    }
    const content = serializeAiHistoryForExport(turns)
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `t3d-ai-history-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    useEditorStore.getState().notify(`已导出 ${turns.length} 条对话记录`)
  }

  useEffect(() => {
    if (panelOpen) {
      void refreshProviders()
    }
  }, [panelOpen, refreshProviders])

  useEffect(() => {
    const active = providers.find((p) => p.id === activeProviderId)
    if (active) {
      setEditBaseUrl(active.baseUrl)
      setEditModel(active.model)
      setEditApiKey('')
    }
  }, [providers, activeProviderId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [turns, streamingText])

  if (!panelOpen) return null

  const activeProvider = providers.find((p) => p.id === activeProviderId)
  const selectedNodes = selection.map((id) => nodes[id]).filter(Boolean)

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || status !== 'idle') return
    if (trimmed === '/diagnose') {
      setInput('')
      useManagerModalStore.getState().openModal('diagnose')
      return
    }
    if (trimmed === '/pack') {
      setInput('')
      useManagerModalStore.getState().openModal('packs')
      return
    }
    if (trimmed === '/checkpoint') {
      setInput('')
      void createCheckpoint(`手动快照 ${new Date().toLocaleTimeString()}`, true).then(() => {
        useEditorStore.getState().notify('已创建里程碑快照')
      })
      return
    }
    if (trimmed === '/playtest') {
      setInput('')
      void sendPrompt('请启动试玩探针跑一次冒烟测试（playtest__run_smoke）并做工程体检（query__project_diagnose），汇报结果。')
      return
    }
    setInput('')
    void sendPrompt(trimmed)
  }

  const atMatch = input.match(/@([^\s@]*)$/)
  const atQuery = atMatch ? atMatch[1].toLowerCase() : null
  const slashMenu = input.startsWith('/') && !input.includes(' ')
  const mentionCandidates = atQuery === null
    ? []
    : [
        ...Object.values(nodes).map(n => ({ id: n.id, label: n.name, kind: '节点' })),
        ...Object.values(codeAssets).map(c => ({ id: c.id, label: c.name, kind: c.kind === 'shader' ? '着色器' : '脚本' })),
      ]
        .filter(item => !atQuery || item.label.toLowerCase().includes(atQuery))
        .slice(0, 6)
  const slashCommands = [
    { cmd: '/playtest', desc: '运行冒烟试玩与体检' },
    { cmd: '/diagnose', desc: '打开体检与性能预算看板' },
    { cmd: '/pack', desc: '打开能力包沉淀中心' },
    { cmd: '/checkpoint', desc: '立即保存里程碑快照' },
  ].filter(item => item.cmd.startsWith(input.toLowerCase()))

  return (
    <aside
      style={{
        width: '360px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#18181b',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        color: '#e4e4e7',
        fontSize: '12px',
        zIndex: 20,
      }}
    >
      <style>{'@keyframes t3d-ai-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
      {/* 头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: '#1f1f23',
        }}
      >
        <Sparkles size={14} color="#60a5fa" />
        <span style={{ fontWeight: 600, fontSize: '12px' }}>AI 指挥台</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '11px',
            color: activeProvider?.hasApiKey ? '#a1a1aa' : '#f59e0b',
            maxWidth: '140px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={activeProvider ? `${activeProvider.label} (${activeProvider.model})` : '未配置'}
        >
          {activeProvider ? (activeProvider.hasApiKey ? activeProvider.model : '未设密钥') : '桌面端可用'}
        </span>
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.currentTarget.value = ''
            if (!file) return
            try {
              const imported = parseImportedAiHistory(await file.text())
              importTurns(imported, 'merge')
              useEditorStore.getState().notify(`已导入合并 ${imported.length} 条对话记录`)
            } catch (err) {
              useEditorStore.getState().notify(`导入失败：${err instanceof Error ? err.message : String(err)}`)
            }
          }}
        />
        <button
          type="button"
          title="导入 / 迁移对话记录 (.json)"
          onClick={() => importInputRef.current?.click()}
          disabled={status !== 'idle'}
          style={iconBtnStyle}
        >
          <Upload size={13} />
        </button>
        <button
          type="button"
          title="导出对话记录 (.json)"
          onClick={handleExportHistory}
          disabled={turns.length === 0}
          style={iconBtnStyle}
        >
          <Download size={13} />
        </button>
        <button
          type="button"
          title="模型与 API 设置"
          onClick={() => setSettingsOpen((v) => !v)}
          style={iconBtnStyle}
        >
          <Settings size={13} />
        </button>
        <button
          type="button"
          title="清空对话"
          onClick={clearTurns}
          disabled={status !== 'idle'}
          style={iconBtnStyle}
        >
          <Trash2 size={13} />
        </button>
        <button
          type="button"
          title="收起 AI 指挥台"
          onClick={() => setPanelOpen(false)}
          style={iconBtnStyle}
        >
          <X size={13} />
        </button>
      </div>

      {/* 模型设置抽屉 */}
      {settingsOpen && (
        <div
          style={{
            padding: '10px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: '#141417',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ fontWeight: 600, color: '#d4d4d8', marginBottom: '2px' }}>模型 API 设置（密钥仅存主进程）</div>
          <select
            value={activeProviderId}
            onChange={(e) => void setActiveProvider(e.target.value)}
            style={fieldInputStyle}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} {p.hasApiKey ? '✓' : '(未设密钥)'}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Base URL"
            value={editBaseUrl}
            onChange={(e) => setEditBaseUrl(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="text"
            placeholder="模型名称（如 deepseek-chat / gpt-4o）"
            value={editModel}
            onChange={(e) => setEditModel(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="password"
            placeholder={activeProvider?.hasApiKey ? '已保存密钥（留空表示不修改）' : '输入 API Key'}
            value={editApiKey}
            onChange={(e) => setEditApiKey(e.target.value)}
            style={fieldInputStyle}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            <button type="button" onClick={() => setSettingsOpen(false)} style={smallBtnStyle}>关闭</button>
            <button
              type="button"
              onClick={() => {
                void saveProvider({
                  id: activeProviderId,
                  baseUrl: editBaseUrl,
                  model: editModel,
                  ...(editApiKey.trim() ? { apiKey: editApiKey.trim() } : {}),
                  setActive: true,
                }).then(() => setSettingsOpen(false))
              }}
              style={{ ...smallBtnStyle, background: '#2563eb', color: '#fff', borderColor: '#2563eb' }}
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* 对话与结构化执行流 */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {turns.length === 0 && (
          <div style={{ color: '#71717a', lineHeight: 1.6, padding: '12px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#a1a1aa', marginBottom: '6px' }}>
              <Bot size={14} />
              <span>AI 已就绪，可直接下达创作指令</span>
            </div>
            <div>示例：「新建一个平台跳跃关卡，带地面、主角出生点、几个台阶、一盏方向光和相机，最后做一次体检。」</div>
          </div>
        )}

        {turns.map((turn, idx) => {
          const isActiveTurn = status !== 'idle' && idx === turns.length - 1 && turn.role === 'assistant'
          return (
          <div
            key={turn.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '8px 10px',
              borderRadius: '6px',
              background: turn.role === 'user' ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
              border: turn.role === 'user'
                ? '1px solid rgba(59,130,246,0.28)'
                : isActiveTurn
                  ? '1px solid rgba(96,165,250,0.4)'
                  : '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {isActiveTurn && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  background: 'rgba(59,130,246,0.14)',
                  color: '#93c5fd',
                  fontSize: '11px',
                }}
              >
                <Loader2 size={12} style={{ animation: 't3d-ai-spin 1s linear infinite', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {phaseText || '正在处理中…'}
                </span>
                <span style={{ marginLeft: 'auto', color: '#a1a1aa', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {(elapsedMs / 1000).toFixed(1)}s
                </span>
              </div>
            )}

            {turn.refs && turn.refs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {turn.refs.map((r) => (
                  <span key={r.id} style={refPillStyle}>@{r.label}</span>
                ))}
              </div>
            )}

            {turn.imageDataUrl && (
              <img
                src={turn.imageDataUrl}
                alt="视口批注截图"
                style={{ width: '100%', maxHeight: 150, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)' }}
              />
            )}

            {turn.text && (
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5,
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  cursor: 'text',
                  wordBreak: 'break-word',
                }}
              >
                {turn.text}
              </div>
            )}

            {isActiveTurn && streamingText && (
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5,
                  color: '#d4d4d8',
                  opacity: 0.9,
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  cursor: 'text',
                  wordBreak: 'break-word',
                }}
              >
                {streamingText}
              </div>
            )}

            {turn.actions && turn.actions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {turn.actions.map((act) => (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => {
                      if (act.targetNodeId && useEditorStore.getState().nodes[act.targetNodeId]) {
                        useEditorStore.getState().setSelection([act.targetNodeId])
                        useEditorStore.getState().requestFocus()
                      }
                    }}
                    title={act.targetNodeId ? '点击在视口中聚焦该节点' : act.toolName}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      textAlign: 'left',
                      padding: '4px 7px',
                      borderRadius: '4px',
                      border: act.pending
                        ? '1px solid rgba(96,165,250,0.35)'
                        : '1px solid rgba(255,255,255,0.08)',
                      background: act.pending ? 'rgba(59,130,246,0.1)' : 'rgba(0,0,0,0.25)',
                      color: act.pending ? '#93c5fd' : act.ok ? '#d4d4d8' : '#fca5a5',
                      fontSize: '11px',
                      cursor: act.targetNodeId ? 'pointer' : 'default',
                    }}
                  >
                    {act.pending ? (
                      <Loader2 size={11} style={{ animation: 't3d-ai-spin 1s linear infinite', flexShrink: 0 }} />
                    ) : (
                      <span style={{ color: act.ok ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                        {act.ok ? '✓' : '✕'}
                      </span>
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {act.label}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {turn.error && (
              <div
                style={{
                  color: '#fca5a5',
                  fontSize: '11px',
                  lineHeight: 1.4,
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  cursor: 'text',
                  wordBreak: 'break-word',
                }}
              >
                {turn.error}
              </div>
            )}

            {!isActiveTurn && (turn.text || turn.error || (turn.role === 'assistant' && (turn.usage?.model || turn.checkpointId))) && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginTop: '2px',
                  paddingTop: '4px',
                  borderTop: '1px solid rgba(255,255,255,0.05)',
                  fontSize: '11px',
                  color: '#71717a',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {turn.role === 'assistant' && turn.usage?.model
                    ? `${turn.usage.model} · ${(turn.usage.inputTokens ?? 0) + (turn.usage.outputTokens ?? 0)} tok`
                    : ''}
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  {(turn.text || turn.error) && (
                    <button
                      type="button"
                      title="复制文本"
                      onClick={() => void copyTurnText(turn.id, turn.text || turn.error || '')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        background: 'transparent',
                        border: 'none',
                        color: copiedTurnId === turn.id ? '#4ade80' : '#a1a1aa',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: 0,
                      }}
                    >
                      {copiedTurnId === turn.id ? <Check size={11} /> : <Copy size={11} />}
                      <span>{copiedTurnId === turn.id ? '已复制' : '复制'}</span>
                    </button>
                  )}
                  {turn.role === 'assistant' && turn.checkpointId && status === 'idle' && (
                    <button
                      type="button"
                      onClick={() => rollbackTurn(turn.checkpointId!)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        background: 'transparent',
                        border: 'none',
                        color: '#93c5fd',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: 0,
                      }}
                    >
                      <RotateCcw size={11} />
                      <span>回退本轮</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          )
        })}
      </div>

      {/* 高风险确认栏 */}
      {pendingConfirm && (
        <div
          style={{
            margin: '0 10px 8px',
            padding: '8px 10px',
            borderRadius: '6px',
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ fontWeight: 600, color: '#fcd34d' }}>{pendingConfirm.label}</div>
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => pendingConfirm.resolve(false)} style={smallBtnStyle}>
              拒绝
            </button>
            <button
              type="button"
              onClick={() => pendingConfirm.resolve(true)}
              style={{ ...smallBtnStyle, background: '#d97706', color: '#fff', borderColor: '#d97706' }}
            >
              <Check size={11} /> 允许执行
            </button>
          </div>
        </div>
      )}

      {/* 底部输入区 */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#1f1f23' }}>
        {pendingAttachmentImage && (
          <div style={{ position: 'relative', marginBottom: 6, borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(248,113,113,0.4)' }}>
            <img src={pendingAttachmentImage} alt="待发送视口批注" style={{ width: '100%', maxHeight: 96, objectFit: 'cover', display: 'block' }} />
            <button
              type="button"
              onClick={() => setPendingAttachmentImage(null)}
              title="移除批注截图"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 20,
                height: 20,
                borderRadius: 999,
                border: 'none',
                background: 'rgba(0,0,0,0.72)',
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <X size={12} />
            </button>
          </div>
        )}
        {selectedNodes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
            {selectedNodes.slice(0, 4).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setInput((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}@${n.name} `)}
                title="点击插入引用到输入框"
                style={{ ...refPillStyle, cursor: 'pointer', border: 'none' }}
              >
                @{n.name}
              </button>
            ))}
            {selectedNodes.length > 4 && (
              <span style={refPillStyle}>+{selectedNodes.length - 4}</span>
            )}
          </div>
        )}
        <div style={{ position: 'relative' }}>
          {slashMenu && slashCommands.length > 0 && (
            <div style={popupMenuStyle}>
              {slashCommands.map(item => (
                <button
                  key={item.cmd}
                  type="button"
                  style={popupItemStyle}
                  onClick={() => {
                    setInput(item.cmd)
                    setTimeout(() => handleSend(), 0)
                  }}
                >
                  <strong style={{ color: '#93c5fd' }}>{item.cmd}</strong>
                  <span style={{ color: '#a1a1aa' }}>{item.desc}</span>
                </button>
              ))}
            </div>
          )}
          {!slashMenu && mentionCandidates.length > 0 && (
            <div style={popupMenuStyle}>
              {mentionCandidates.map(item => (
                <button
                  key={`${item.kind}:${item.id}`}
                  type="button"
                  style={popupItemStyle}
                  onClick={() => {
                    setInput(prev => prev.replace(/@[^\s@]*$/, `@${item.label} `))
                  }}
                >
                  <span style={{ color: '#e4e4e7' }}>@{item.label}</span>
                  <span style={{ color: '#71717a', marginLeft: 'auto' }}>{item.kind}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
          <textarea
            rows={2}
            value={input}
            placeholder="输入需求，@ 引用节点/脚本，/ 触发快捷指令（Enter 发送）"
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const items = e.clipboardData?.items
              if (!items) return
              for (const item of items) {
                if (item.type.startsWith('image/')) {
                  const file = item.getAsFile()
                  if (!file) continue
                  const reader = new FileReader()
                  reader.onload = () => {
                    if (typeof reader.result === 'string') {
                      setPendingAttachmentImage(reader.result)
                    }
                  }
                  reader.readAsDataURL(file)
                  break
                }
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            style={{
              flex: 1,
              resize: 'none',
              padding: '6px 8px',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.14)',
              background: '#111113',
              color: '#f4f4f5',
              fontSize: '12px',
              lineHeight: 1.4,
            }}
          />
          {status === 'idle' ? (
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              title="发送"
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '4px',
                border: 'none',
                background: input.trim() ? '#2563eb' : '#27272a',
                color: '#fff',
                cursor: input.trim() ? 'pointer' : 'default',
              }}
            >
              <Send size={13} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void abort()}
              title="安全停止"
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '4px',
                border: '1px solid rgba(239,68,68,0.5)',
                background: 'rgba(239,68,68,0.18)',
                color: '#fca5a5',
                cursor: 'pointer',
              }}
            >
              <Square size={12} />
            </button>
          )}
          </div>
        </div>
      </div>
    </aside>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#a1a1aa',
  cursor: 'pointer',
  padding: '4px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const fieldInputStyle: React.CSSProperties = {
  width: '100%',
  height: '26px',
  padding: '0 8px',
  borderRadius: '4px',
  border: '1px solid rgba(255,255,255,0.14)',
  background: '#1c1c21',
  color: '#f4f4f5',
  fontSize: '12px',
  boxSizing: 'border-box',
}

const smallBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 10px',
  borderRadius: '4px',
  border: '1px solid rgba(255,255,255,0.14)',
  background: '#27272a',
  color: '#e4e4e7',
  fontSize: '11px',
  cursor: 'pointer',
}

const refPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 6px',
  borderRadius: '999px',
  background: 'rgba(59,130,246,0.2)',
  border: '1px solid rgba(59,130,246,0.38)',
  color: '#93c5fd',
  fontSize: '11px',
}

const popupMenuStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  right: 0,
  marginBottom: 6,
  padding: 4,
  borderRadius: 6,
  background: '#181a20',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 10px 28px rgba(0,0,0,0.55)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  zIndex: 20,
}

const popupItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 8px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  fontSize: 11,
  cursor: 'pointer',
  textAlign: 'left',
}
