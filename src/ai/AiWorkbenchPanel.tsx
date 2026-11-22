import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Bot, Box, Camera, Check, Copy, Download, FileBox, FileCode2, Loader2, RotateCcw, Send, Settings, Sparkles, Square, Trash2, Upload, Wand2, X } from 'lucide-react'
import { createCheckpoint } from '../core/project/checkpoints'
import { useManagerModalStore } from '../core/project/ProjectManagerModal'
import { openCodeAssetModal } from '../core/codeAssets/CodeAssetModal'
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { captureMainViewport } from '../core/preview/offscreenPreview'
import { ASSET_MIME, NODE_MIME } from '../editor/assets/import'
import { CLIP_MIME } from '../editor/animation/playback'
import { useAssetStore } from '../editor/assets/library'
import { useEditorStore } from '../editor/scene/store'
import { useAgentStore, type AiRefItem } from './agentLoop'
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
  const pendingRefs = useAgentStore((s) => s.pendingRefs)
  const addPendingRef = useAgentStore((s) => s.addPendingRef)
  const removePendingRef = useAgentStore((s) => s.removePendingRef)
  const steerQueue = useAgentStore((s) => s.steerQueue)
  const taskPlan = useAgentStore((s) => s.taskPlan)
  const clearTaskPlan = useAgentStore((s) => s.clearTaskPlan)
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
  const assets = useAssetStore((s) => s.assets)

  const [input, setInput] = useState('')
  const [droppingToChat, setDroppingToChat] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [planExpanded, setPlanExpanded] = useState(false)
  const [editBaseUrl, setEditBaseUrl] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editApiKey, setEditApiKey] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
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

  const canSend = Boolean(input.trim() || pendingAttachmentImage)

  const handleCaptureViewport = () => {
    const dataUrl = captureMainViewport({ mimeType: 'image/jpeg', quality: 0.86 })
    if (!dataUrl) {
      useEditorStore.getState().notify('当前无法获取视口画面')
      return
    }
    setPendingAttachmentImage(dataUrl)
  }

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed && !pendingAttachmentImage) return
    if (status === 'idle') {
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
        ...Object.values(nodes).map(n => ({ refKind: 'node' as const, id: n.id, label: n.name, kind: '节点', subKind: n.kind })),
        ...Object.values(codeAssets).map(c => ({
          refKind: c.kind as 'script' | 'shader',
          id: c.id,
          label: c.name,
          kind: c.kind === 'shader' ? '着色器' : '脚本',
          subKind: c.kind,
        })),
        ...Object.values(assets).map(a => ({
          refKind: 'asset' as const,
          id: a.id,
          label: a.name,
          kind: a.kind,
          subKind: a.kind,
        })),
      ]
        .filter(item => !atQuery || item.label.toLowerCase().includes(atQuery))
        .slice(0, 8)
  const slashCommands = [
    { cmd: '/playtest', desc: '运行冒烟试玩与体检' },
    { cmd: '/diagnose', desc: '打开体检与性能预算看板' },
    { cmd: '/pack', desc: '打开能力包沉淀中心' },
    { cmd: '/checkpoint', desc: '立即保存里程碑快照' },
  ].filter(item => item.cmd.startsWith(input.toLowerCase()))

  const acceptsDrop = (e: DragEvent) => {
    const types = [...e.dataTransfer.types]
    return types.includes(ASSET_MIME) || types.includes(NODE_MIME) || types.includes(CLIP_MIME) || types.includes('Files')
  }

  const handleDropToChat = (e: DragEvent) => {
    dragDepthRef.current = 0
    setDroppingToChat(false)
    if (!acceptsDrop(e)) return
    e.preventDefault()

    const nodeId = e.dataTransfer.getData(NODE_MIME)
    if (nodeId) {
      const node = useEditorStore.getState().nodes[nodeId]
      if (node) {
        addPendingRef({ kind: 'node', id: node.id, label: node.name, subKind: node.kind })
      }
      return
    }

    const assetKey = e.dataTransfer.getData(ASSET_MIME)
    if (assetKey) {
      if (assetKey.startsWith('code:script:') || assetKey.startsWith('code:shader:')) {
        const [, kind, id] = assetKey.split(':')
        const rec = useCodeAssetStore.getState().assets[id]
        if (rec) {
          addPendingRef({
            kind: kind === 'shader' ? 'shader' : 'script',
            id: rec.id,
            label: rec.name,
            subKind: rec.relativePath,
          })
        }
        return
      }
      const asset = useAssetStore.getState().assets[assetKey]
      if (asset) {
        addPendingRef({ kind: 'asset', id: asset.id, label: asset.name, subKind: asset.kind })
      }
      return
    }

    const clipRaw = e.dataTransfer.getData(CLIP_MIME)
    if (clipRaw) {
      try {
        const parsed = JSON.parse(clipRaw) as { assetId?: string; clip?: string }
        if (parsed.assetId) {
          const asset = useAssetStore.getState().assets[parsed.assetId]
          if (asset) {
            addPendingRef({
              kind: 'asset',
              id: asset.id,
              label: parsed.clip ? `${asset.name}:${parsed.clip}` : asset.name,
              subKind: asset.kind,
            })
          }
        }
      } catch {
        // ignore invalid clip payload
      }
      return
    }

    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (file) {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') setPendingAttachmentImage(reader.result)
      }
      reader.readAsDataURL(file)
    }
  }

  const locateRef = (r: AiRefItem) => {
    if (r.kind === 'node') {
      if (useEditorStore.getState().nodes[r.id]) {
        useEditorStore.getState().setSelection([r.id])
        useEditorStore.getState().requestFocus()
      }
      return
    }
    if (r.kind === 'script' || r.kind === 'shader') {
      if (useCodeAssetStore.getState().assets[r.id]) {
        openCodeAssetModal(r.kind, r.id)
      }
      return
    }
    if (r.kind === 'asset' && useAssetStore.getState().assets[r.id]) {
      useEditorStore.getState().inspectAsset(r.id)
    }
  }

  return (
    <aside
      onDragEnter={(e) => {
        if (!acceptsDrop(e)) return
        e.preventDefault()
        dragDepthRef.current += 1
        setDroppingToChat(true)
      }}
      onDragOver={(e) => {
        if (!acceptsDrop(e)) return
        e.preventDefault()
        const allowed = e.dataTransfer.effectAllowed
        e.dataTransfer.dropEffect = allowed === 'move' ? 'move' : 'copy'
        if (!droppingToChat) setDroppingToChat(true)
      }}
      onDragLeave={(e) => {
        if (!acceptsDrop(e)) return
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDroppingToChat(false)
      }}
      onDrop={handleDropToChat}
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

      {/* 长任务计划进度条 */}
      {taskPlan.length > 0 && (() => {
        const doneCount = taskPlan.filter((t) => t.status === 'done').length
        const current = taskPlan.find((t) => t.status === 'in_progress') ?? taskPlan.find((t) => t.status === 'pending')
        return (
          <div
            style={{
              padding: '6px 10px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: '#16181d',
              fontSize: '11px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={() => setPlanExpanded((v) => !v)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'transparent',
                  border: 'none',
                  color: '#d4d4d8',
                  cursor: 'pointer',
                  padding: 0,
                  textAlign: 'left',
                  overflow: 'hidden',
                }}
              >
                <span style={{ color: doneCount === taskPlan.length ? '#4ade80' : '#60a5fa', fontWeight: 600, flexShrink: 0 }}>
                  任务 {doneCount}/{taskPlan.length}
                </span>
                <span style={{ color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {current ? `· ${current.title}` : '· 全部完成'}
                </span>
              </button>
              {status === 'idle' && (
                <button
                  type="button"
                  title="清除任务计划"
                  onClick={clearTaskPlan}
                  style={{ background: 'transparent', border: 'none', color: '#71717a', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
            {planExpanded && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {taskPlan.map((item) => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, color: item.status === 'done' ? '#86efac' : item.status === 'in_progress' ? '#93c5fd' : '#a1a1aa' }}>
                    <span style={{ width: 12, textAlign: 'center', flexShrink: 0 }}>
                      {item.status === 'done' ? '✓' : item.status === 'in_progress' ? '▶' : '○'}
                    </span>
                    <span style={{ textDecoration: item.status === 'done' ? 'line-through' : 'none', opacity: item.status === 'done' ? 0.75 : 1 }}>
                      {item.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

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
                  <button
                    key={`${r.kind}:${r.id}`}
                    type="button"
                    onClick={() => locateRef(r)}
                    title="点击定位或打开该对象"
                    style={{
                      ...refPillStyle,
                      ...refKindColors(r.kind),
                      cursor: 'pointer',
                      border: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <RefKindIcon kind={r.kind} />
                    <span>{r.kind === 'node' ? `@${r.label}` : `#${r.label}`}</span>
                  </button>
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
                  lineHeight: 1.5,
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  cursor: 'text',
                  wordBreak: 'break-word',
                }}
              >
                {turn.role === 'assistant' ? <AiMarkdown text={turn.text} /> : <span style={{ whiteSpace: 'pre-wrap' }}>{turn.text}</span>}
              </div>
            )}

            {isActiveTurn && streamingText && (
              <div
                style={{
                  lineHeight: 1.5,
                  color: '#d4d4d8',
                  opacity: 0.9,
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  cursor: 'text',
                  wordBreak: 'break-word',
                }}
              >
                <AiMarkdown text={streamingText} />
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

            {!isActiveTurn && (turn.stopReason === 'max-steps' || turn.stopReason === 'paused-with-plan') && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 5,
                  background: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  color: '#fcd34d',
                  fontSize: 11,
                }}
              >
                <span>
                  {turn.stopReason === 'max-steps'
                    ? '已达单轮 32 步上限，任务尚未全部完成'
                    : `仍有 ${turn.pendingTasksCount || '未完成'} 项计划步骤待继续`}
                </span>
                {idx === turns.length - 1 && status === 'idle' && (
                  <button
                    type="button"
                    onClick={() => void sendPrompt('请按当前任务计划继续推进剩余未完成的步骤，直到全部完成。')}
                    style={{
                      flexShrink: 0,
                      padding: '3px 9px',
                      borderRadius: 4,
                      border: 'none',
                      background: '#d97706',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    继续执行
                  </button>
                )}
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
        {droppingToChat && (
          <div
            style={{
              marginBottom: 6,
              padding: '6px 10px',
              borderRadius: 4,
              border: '1px dashed #60a5fa',
              background: 'rgba(59,130,246,0.14)',
              color: '#93c5fd',
              fontSize: '11px',
              textAlign: 'center',
            }}
          >
            松开即可将节点 / 脚本 / 着色器 / 资产附加到当前对话
          </div>
        )}
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
        {(pendingRefs.length > 0 || selectedNodes.length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
            {pendingRefs.map((r) => (
              <span
                key={`pending:${r.kind}:${r.id}`}
                style={{
                  ...refPillStyle,
                  ...refKindColors(r.kind),
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                title={r.subKind ? `${r.label} (${r.subKind})` : r.label}
              >
                <RefKindIcon kind={r.kind} />
                <span>{r.kind === 'node' ? `@${r.label}` : `#${r.label}`}</span>
                <button
                  type="button"
                  title="移除引用"
                  onClick={() => removePendingRef(r.kind, r.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: 0,
                    marginLeft: '1px',
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                    opacity: 0.75,
                  }}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {selectedNodes
              .filter((n) => !pendingRefs.some((r) => r.kind === 'node' && r.id === n.id))
              .slice(0, 4)
              .map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setInput((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}@${n.name} `)}
                  title="当前视口选中节点（点击插入名称）"
                  style={{ ...refPillStyle, cursor: 'pointer', border: 'none', opacity: 0.85 }}
                >
                  @{n.name}
                </button>
              ))}
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
                  key={`${item.refKind}:${item.id}`}
                  type="button"
                  style={popupItemStyle}
                  onClick={() => {
                    setInput(prev => prev.replace(/@[^\s@]*$/, `${item.refKind === 'node' ? '@' : '#'}${item.label} `))
                    addPendingRef({
                      kind: item.refKind,
                      id: item.id,
                      label: item.label,
                      subKind: item.subKind,
                    })
                  }}
                >
                  <span style={{ color: '#e4e4e7' }}>{item.refKind === 'node' ? '@' : '#'}{item.label}</span>
                  <span style={{ color: '#71717a', marginLeft: 'auto' }}>{item.kind}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
          <textarea
            rows={2}
            value={input}
            placeholder={
              status === 'idle'
                ? '输入需求，支持截图/Ctrl+V贴图/拖入资源，或 @ 引用（Enter 发送）'
                : 'AI 运行中，可直接输入纠偏/插话指令（Enter 发送，将在当前步骤后注入）'
            }
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
          <button
            type="button"
            onClick={handleCaptureViewport}
            title="截取当前 3D 视口给 AI 分析"
            style={{
              height: '34px',
              padding: '0 8px',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.14)',
              background: '#27272a',
              color: '#d4d4d8',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Camera size={13} />
          </button>
          {status === 'idle' ? (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              title="发送"
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '4px',
                border: 'none',
                background: canSend ? '#2563eb' : '#27272a',
                color: '#fff',
                cursor: canSend ? 'pointer' : 'default',
              }}
            >
              <Send size={13} />
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                title="运行中插话纠偏 (Steer)"
                style={{
                  height: '34px',
                  padding: '0 9px',
                  borderRadius: '4px',
                  border: 'none',
                  background: canSend ? '#d97706' : '#27272a',
                  color: '#fff',
                  cursor: canSend ? 'pointer' : 'default',
                }}
              >
                <Send size={13} />
              </button>
              <button
                type="button"
                onClick={() => void abort()}
                title="安全停止"
                style={{
                  height: '34px',
                  padding: '0 9px',
                  borderRadius: '4px',
                  border: '1px solid rgba(239,68,68,0.5)',
                  background: 'rgba(239,68,68,0.18)',
                  color: '#fca5a5',
                  cursor: 'pointer',
                }}
              >
                <Square size={12} />
              </button>
            </div>
          )}
          </div>
          {steerQueue.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 10, color: '#fbbf24' }}>
              已排队 {steerQueue.length} 条插话，将在当前步骤完成后注入 AI 上下文…
            </div>
          )}
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

function RefKindIcon({ kind }: { kind: AiRefItem['kind'] }) {
  if (kind === 'node') return <Box size={11} />
  if (kind === 'script') return <FileCode2 size={11} />
  if (kind === 'shader') return <Wand2 size={11} />
  return <FileBox size={11} />
}

function refKindColors(kind: AiRefItem['kind']): React.CSSProperties {
  if (kind === 'script') return { background: 'rgba(56,189,248,0.18)', color: '#7dd3fc' }
  if (kind === 'shader') return { background: 'rgba(192,132,252,0.18)', color: '#d8b4fe' }
  if (kind === 'asset') return { background: 'rgba(52,211,153,0.18)', color: '#6ee7b7' }
  return { background: 'rgba(59,130,246,0.2)', color: '#93c5fd' }
}

function AiMarkdown({ text }: { text: string }) {
  const segments = text.split(/(```[\s\S]*?```)/g)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {segments.map((seg, idx) => {
        if (!seg) return null
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3)
          const firstNl = inner.indexOf('\n')
          const lang = firstNl >= 0 ? inner.slice(0, firstNl).trim() : ''
          const code = (firstNl >= 0 ? inner.slice(firstNl + 1) : inner).replace(/\n$/, '')
          return <AiCodeBlock key={idx} lang={lang} code={code} />
        }
        return <AiMarkdownBlock key={idx} text={seg} />
      })}
    </div>
  )
}

function AiCodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div style={{ borderRadius: 5, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', background: '#0e0e11' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 8px', background: 'rgba(255,255,255,0.04)', fontSize: 10, color: '#a1a1aa' }}>
        <span>{lang || 'code'}</span>
        <button type="button" onClick={copy} style={{ background: 'transparent', border: 'none', color: copied ? '#4ade80' : '#a1a1aa', cursor: 'pointer', fontSize: 10, padding: 0 }}>
          {copied ? '已复制' : '复制代码'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: '6px 8px', overflowX: 'auto', fontSize: 11, lineHeight: 1.45, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', color: '#e4e4e7' }}>
        {code}
      </pre>
    </div>
  )
}

function AiMarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 4 }} />
        const hMatch = /^(#{1,3})\s+(.*)$/.exec(line)
        if (hMatch) {
          const level = hMatch[1].length
          return (
            <div key={i} style={{ fontWeight: 700, fontSize: level === 1 ? 13 : 12, color: '#f4f4f5', marginTop: 2 }}>
              {renderInlineMd(hMatch[2])}
            </div>
          )
        }
        const ulMatch = /^\s*[-*•]\s+(.*)$/.exec(line)
        if (ulMatch) {
          return (
            <div key={i} style={{ display: 'flex', gap: 6, paddingLeft: 4 }}>
              <span style={{ color: '#60a5fa', flexShrink: 0 }}>•</span>
              <span>{renderInlineMd(ulMatch[1])}</span>
            </div>
          )
        }
        const olMatch = /^\s*(\d+\.)\s+(.*)$/.exec(line)
        if (olMatch) {
          return (
            <div key={i} style={{ display: 'flex', gap: 6, paddingLeft: 4 }}>
              <span style={{ color: '#60a5fa', flexShrink: 0 }}>{olMatch[1]}</span>
              <span>{renderInlineMd(olMatch[2])}</span>
            </div>
          )
        }
        return <div key={i}>{renderInlineMd(line)}</div>
      })}
    </div>
  )
}

function renderInlineMd(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return tokens.map((tok, idx) => {
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length >= 2) {
      return (
        <code
          key={idx}
          style={{
            padding: '1px 4px',
            borderRadius: 3,
            background: 'rgba(255,255,255,0.09)',
            color: '#93c5fd',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: '0.92em',
          }}
        >
          {tok.slice(1, -1)}
        </code>
      )
    }
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length >= 4) {
      return <strong key={idx} style={{ color: '#fafafa', fontWeight: 600 }}>{tok.slice(2, -2)}</strong>
    }
    return <span key={idx}>{tok}</span>
  })
}
