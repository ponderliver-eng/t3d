import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, Bot, Box, Camera, Check, ChevronDown, ChevronRight, Copy, Download, FileBox, FileCode2, Loader2, Plus, RotateCcw, Send, Settings, Sparkles, Square, Trash2, Upload, Wand2, X } from 'lucide-react'
import { createCheckpoint } from '../core/project/checkpoints'
import { useManagerModalStore } from '../core/project/ProjectManagerModal'
import { openCodeAssetModal } from '../core/codeAssets/CodeAssetModal'
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { captureMainViewport } from '../core/preview/offscreenPreview'
import { ASSET_MIME, NODE_MIME } from '../editor/assets/import'
import { CLIP_MIME } from '../editor/animation/playback'
import { useAssetStore } from '../editor/assets/library'
import { useEditorStore } from '../editor/scene/store'
import { useAgentStore, type AiActionPill, type AiRefItem } from './agentLoop'
import { parseImportedAiHistory, serializeAiHistoryForExport } from './historyStorage'

export default function AiWorkbenchPanel() {
  const panelOpen = useAgentStore((s) => s.panelOpen)
  const setPanelOpen = useAgentStore((s) => s.setPanelOpen)
  const panelScrollTop = useAgentStore((s) => s.panelScrollTop)
  const panelScrollEpoch = useAgentStore((s) => s.panelScrollEpoch)
  const setPanelScrollTop = useAgentStore((s) => s.setPanelScrollTop)
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
  const deleteProvider = useAgentStore((s) => s.deleteProvider)
  const setActiveProvider = useAgentStore((s) => s.setActiveProvider)
  const sendPrompt = useAgentStore((s) => s.sendPrompt)
  const abort = useAgentStore((s) => s.abort)
  const rollbackTurn = useAgentStore((s) => s.rollbackTurn)
  const clearTurns = useAgentStore((s) => s.clearTurns)
  const deleteTurn = useAgentStore((s) => s.deleteTurn)
  const importTurns = useAgentStore((s) => s.importTurns)

  const selection = useEditorStore((s) => s.selection)
  const nodes = useEditorStore((s) => s.nodes)
  const codeAssets = useCodeAssetStore((s) => s.assets)
  const assets = useAssetStore((s) => s.assets)

  const [input, setInput] = useState('')
  const [droppingToChat, setDroppingToChat] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [planExpanded, setPlanExpanded] = useState(false)
  const [settingsProviderType, setSettingsProviderType] = useState<'openai-compatible' | 'openai' | 'anthropic' | 'gemini'>('openai-compatible')
  const [editingProviderId, setEditingProviderId] = useState<string>('openai-compatible')
  const [editLabel, setEditLabel] = useState('')
  const [editBaseUrl, setEditBaseUrl] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editModelsText, setEditModelsText] = useState('')
  const [editApiKey, setEditApiKey] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pendingRestoreScrollRef = useRef<number | null>(panelScrollTop > 0 ? panelScrollTop : null)
  const stickToBottomRef = useRef(true)
  const scrollSaveTimerRef = useRef<number>(0)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    selectedText: string
    fullText: string
    turnId: string
    bodyEl: HTMLElement | null
  } | null>(null)

  const writeClipboardText = async (content: string) => {
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
  }

  const copyTurnText = async (turnId: string, content: string) => {
    if (!content) return
    await writeClipboardText(content)
    setCopiedTurnId(turnId)
    window.setTimeout(() => {
      setCopiedTurnId((cur) => (cur === turnId ? null : cur))
    }, 1500)
  }

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

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
    if (!modelMenuOpen) return
    const close = () => setModelMenuOpen(false)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [modelMenuOpen])

  useEffect(() => {
    const active = providers.find((p) => p.id === activeProviderId)
    if (active && editingProviderId !== '__new__') {
      const target = providers.find((p) => p.id === editingProviderId) ?? active
      setEditingProviderId(target.id)
      setSettingsProviderType(target.providerType)
      setEditLabel(target.label)
      setEditBaseUrl(target.baseUrl)
      setEditModel(target.model)
      setEditModelsText((target.models ?? []).join(', '))
      setEditApiKey('')
    }
  }, [providers, activeProviderId, editingProviderId])

  useEffect(() => {
    pendingRestoreScrollRef.current = useAgentStore.getState().panelScrollTop
  }, [panelScrollEpoch])

  useEffect(() => {
    if (!panelOpen) return
    if (pendingRestoreScrollRef.current === null) {
      pendingRestoreScrollRef.current = useAgentStore.getState().panelScrollTop
    }
  }, [panelOpen])

  useEffect(() => {
    if (!panelOpen || pendingRestoreScrollRef.current === null) return
    const target = pendingRestoreScrollRef.current
    if (turns.length === 0 && target > 0) return
    const el = scrollRef.current
    if (!el) return
    const apply = () => {
      if (!scrollRef.current) return
      scrollRef.current.scrollTop = target
      const distToBottom = scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight
      stickToBottomRef.current = distToBottom <= 36
      pendingRestoreScrollRef.current = null
    }
    apply()
    const raf = requestAnimationFrame(apply)
    return () => cancelAnimationFrame(raf)
  }, [panelOpen, panelScrollEpoch, turns.length])

  useEffect(() => {
    if (!panelOpen || pendingRestoreScrollRef.current !== null) return
    if (!scrollRef.current) return
    if (status !== 'idle' || stickToBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [turns, streamingText, panelOpen, status])

  if (!panelOpen) return null

  const activeProvider = providers.find((p) => p.id === activeProviderId)
  const selectedNodes = selection.map((id) => nodes[id]).filter(Boolean)

  const PROVIDER_TABS: Array<{
    type: 'openai-compatible' | 'openai' | 'anthropic' | 'gemini'
    label: string
    defaultUrl: string
    defaultModel: string
  }> = [
    { type: 'openai-compatible', label: '兼容接口', defaultUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
    { type: 'openai', label: 'OpenAI', defaultUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
    { type: 'anthropic', label: 'Anthropic', defaultUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-7-sonnet-latest' },
    { type: 'gemini', label: 'Gemini', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-pro' },
  ]

  const selectProviderForEdit = (id: string) => {
    const found = providers.find((p) => p.id === id)
    if (!found) return
    setEditingProviderId(found.id)
    setSettingsProviderType(found.providerType)
    setEditLabel(found.label)
    setEditBaseUrl(found.baseUrl)
    setEditModel(found.model)
    setEditModelsText((found.models ?? []).join(', '))
    setEditApiKey('')
  }

  const startNewProvider = (type: 'openai-compatible' | 'openai' | 'anthropic' | 'gemini') => {
    const meta = PROVIDER_TABS.find((t) => t.type === type) ?? PROVIDER_TABS[0]
    setSettingsProviderType(type)
    setEditingProviderId('__new__')
    setEditLabel('')
    setEditBaseUrl(type === 'openai-compatible' ? '' : meta.defaultUrl)
    setEditModel(type === 'openai-compatible' ? '' : meta.defaultModel)
    setEditModelsText('')
    setEditApiKey('')
  }

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
      <style>{`
        @keyframes t3d-ai-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .t3d-ai-turn .t3d-ai-turn-delete {
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.14s ease, color 0.14s ease, background 0.14s ease;
        }
        .t3d-ai-turn:hover .t3d-ai-turn-delete,
        .t3d-ai-turn .t3d-ai-turn-delete:focus-visible {
          opacity: 1;
          pointer-events: auto;
        }
        .t3d-ai-turn .t3d-ai-turn-delete:hover {
          color: #fca5a5 !important;
          background: rgba(239, 68, 68, 0.22) !important;
        }
      `}</style>
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
            gap: '8px',
            maxHeight: '62vh',
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, color: '#d4d4d8' }}>模型 API 设置（密钥仅存主进程）</span>
            <button
              type="button"
              onClick={() => startNewProvider(settingsProviderType)}
              style={{
                ...smallBtnStyle,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: '#93c5fd',
                borderColor: 'rgba(96,165,250,0.35)',
              }}
            >
              <Plus size={11} />
              <span>新增一条</span>
            </button>
          </div>

          {/* 4 类协议切换标签 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4 }}>
            {PROVIDER_TABS.map((tab) => {
              const count = providers.filter((p) => p.providerType === tab.type).length
              const isTabActive = settingsProviderType === tab.type
              return (
                <button
                  key={tab.type}
                  type="button"
                  onClick={() => {
                    setSettingsProviderType(tab.type)
                    const list = providers.filter((p) => p.providerType === tab.type)
                    if (list.length > 0) {
                      const preferred = list.find((p) => p.id === activeProviderId) ?? list[0]
                      selectProviderForEdit(preferred.id)
                    } else {
                      startNewProvider(tab.type)
                    }
                  }}
                  style={{
                    padding: '4px 6px',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                    border: isTabActive ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                    background: isTabActive ? 'rgba(59,130,246,0.18)' : '#1d1d22',
                    color: isTabActive ? '#93c5fd' : '#a1a1aa',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                  }}
                >
                  <span>{tab.label}</span>
                  {count > 0 && (
                    <span style={{ fontSize: 10, opacity: 0.75 }}>({count})</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* 当前协议下的已配置列表 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {providers
              .filter((p) => p.providerType === settingsProviderType)
              .map((p) => {
                const isEditing = editingProviderId === p.id
                const isActive = activeProviderId === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProviderForEdit(p.id)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      cursor: 'pointer',
                      border: isEditing
                        ? '1px solid #60a5fa'
                        : '1px solid rgba(255,255,255,0.12)',
                      background: isEditing ? 'rgba(59,130,246,0.2)' : '#1e1e24',
                      color: isEditing ? '#e4e4e7' : '#a1a1aa',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: p.hasApiKey ? '#4ade80' : '#f59e0b',
                      }}
                    />
                    <span>{p.label}</span>
                    {isActive && <span style={{ fontSize: 9, color: '#60a5fa' }}>当前</span>}
                  </button>
                )
              })}
            {editingProviderId === '__new__' && (
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  border: '1px dashed #60a5fa',
                  background: 'rgba(59,130,246,0.12)',
                  color: '#93c5fd',
                }}
              >
                + 新建配置中…
              </span>
            )}
          </div>

          <input
            type="text"
            placeholder="名称（如：DeepSeek 官方 / 硅基流动 / 本地 Ollama）"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="text"
            placeholder="Base URL（如 https://api.deepseek.com/v1）"
            value={editBaseUrl}
            onChange={(e) => setEditBaseUrl(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="text"
            placeholder="默认模型名称（如 deepseek-chat / gpt-4o）"
            value={editModel}
            onChange={(e) => setEditModel(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="text"
            placeholder="备选模型列表（可选，逗号分隔，如 deepseek-chat, deepseek-reasoner）"
            value={editModelsText}
            onChange={(e) => setEditModelsText(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="password"
            placeholder={
              editingProviderId !== '__new__' && providers.find((p) => p.id === editingProviderId)?.hasApiKey
                ? '已保存密钥（留空表示不修改）'
                : '输入 API Key'
            }
            value={editApiKey}
            onChange={(e) => setEditApiKey(e.target.value)}
            style={fieldInputStyle}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
            <div>
              {editingProviderId !== '__new__' && providers.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const targetId = editingProviderId
                    void deleteProvider(targetId).then(() => {
                      const nextList = useAgentStore.getState().providers
                      const fallback = nextList[0]
                      if (fallback) selectProviderForEdit(fallback.id)
                    })
                  }}
                  style={{ ...smallBtnStyle, color: '#fca5a5', borderColor: 'rgba(239,68,68,0.35)' }}
                >
                  删除此项
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button type="button" onClick={() => setSettingsOpen(false)} style={smallBtnStyle}>关闭</button>
              <button
                type="button"
                onClick={() => {
                  const isNew = editingProviderId === '__new__'
                  const id = isNew ? `${settingsProviderType}_${Date.now().toString(36)}` : editingProviderId
                  const parsedModels = editModelsText
                    .split(/[,，\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                  void saveProvider({
                    id,
                    providerType: settingsProviderType,
                    label: editLabel.trim() || (isNew ? '自定义接口' : id),
                    baseUrl: editBaseUrl,
                    model: editModel,
                    models: parsedModels,
                    ...(editApiKey.trim() ? { apiKey: editApiKey.trim() } : {}),
                    setActive: true,
                  }).then(() => {
                    setEditingProviderId(id)
                    setEditApiKey('')
                    setSettingsOpen(false)
                  })
                }}
                style={{ ...smallBtnStyle, background: '#2563eb', color: '#fff', borderColor: '#2563eb' }}
              >
                保存并启用
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 对话与结构化执行流 */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          if (pendingRestoreScrollRef.current !== null) return
          const el = e.currentTarget
          const top = Math.max(0, Math.round(el.scrollTop))
          const distToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          stickToBottomRef.current = distToBottom <= 36
          window.clearTimeout(scrollSaveTimerRef.current)
          scrollSaveTimerRef.current = window.setTimeout(() => {
            setPanelScrollTop(top)
          }, 150)
        }}
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
          const copyableFullText = [
            turn.text || (isActiveTurn ? streamingText : ''),
            turn.error,
          ]
            .filter(Boolean)
            .join('\n')
          return (
          <div
            key={turn.id}
            className="t3d-ai-turn"
            onContextMenu={(e) => {
              const selText = window.getSelection()?.toString() ?? ''
              if (!selText && !copyableFullText) return
              e.preventDefault()
              e.stopPropagation()
              const bodyEl = e.currentTarget.querySelector<HTMLElement>('[data-ai-message-body="1"]')
              const menuW = 168
              const menuH = 112
              setContextMenu({
                x: Math.min(e.clientX, Math.max(8, window.innerWidth - menuW - 8)),
                y: Math.min(e.clientY, Math.max(8, window.innerHeight - menuH - 8)),
                selectedText: selText,
                fullText: copyableFullText,
                turnId: turn.id,
                bodyEl,
              })
            }}
            style={{
              position: 'relative',
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
            {!isActiveTurn && (
              <button
                type="button"
                className="t3d-ai-turn-delete"
                title="删除此条对话"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteTurn(turn.id)
                }}
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 22,
                  height: 22,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(24,24,27,0.82)',
                  color: '#a1a1aa',
                  cursor: 'pointer',
                  padding: 0,
                  zIndex: 2,
                }}
              >
                <Trash2 size={12} />
              </button>
            )}
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
                data-ai-message-body="1"
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
                data-ai-message-body="1"
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
              <TurnActionsList actions={turn.actions} isActiveTurn={isActiveTurn} />
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

            {!isActiveTurn && turn.stopReason === 'interrupted' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(248, 113, 113, 0.45)',
                  color: '#fecaca',
                  fontSize: 11,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, minWidth: 0 }}>
                  <AlertTriangle size={14} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 700, color: '#fca5a5' }}>执行异常中断（页面刷新或连接断开）</span>
                    <span style={{ color: '#fca5a5', opacity: 0.85, fontSize: 10.5 }}>
                      已保留您的提问与当前已完成的进度，可点击继续处理。
                    </span>
                  </div>
                </div>
                {idx === turns.length - 1 && status === 'idle' && (
                  <button
                    type="button"
                    onClick={() => {
                      const prevUser = [...turns.slice(0, idx)].reverse().find((t) => t.role === 'user')
                      const hint = prevUser?.text
                        ? `上一轮执行因页面刷新/异常中断，请结合我的上一条请求（“${prevUser.text.slice(0, 120)}”）以及已执行的步骤，继续完成剩余工作。`
                        : '上一轮执行因页面刷新/异常中断，请结合上下文与已执行的步骤，继续完成剩余工作。'
                      void sendPrompt(hint)
                    }}
                    style={{
                      flexShrink: 0,
                      padding: '4px 10px',
                      borderRadius: 4,
                      border: 'none',
                      background: '#dc2626',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    点击继续
                  </button>
                )}
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

      {/* 长任务计划进度条（置于输入框上方） */}
      {taskPlan.length > 0 && (() => {
        const doneCount = taskPlan.filter((t) => t.status === 'done').length
        const current = taskPlan.find((t) => t.status === 'in_progress') ?? taskPlan.find((t) => t.status === 'pending')
        return (
          <div
            style={{
              padding: '6px 10px',
              borderTop: '1px solid rgba(255,255,255,0.08)',
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6, paddingTop: 6, maxHeight: 160, overflowY: 'auto', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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

          {/* 对话框底部模型快速切换栏（主流 Agent 风格） */}
          <div style={{ position: 'relative', marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setModelMenuOpen((v) => !v)}
              title="快速切换对话模型"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                maxWidth: '78%',
                padding: '2px 8px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.1)',
                background: modelMenuOpen ? 'rgba(59,130,246,0.16)' : 'rgba(255,255,255,0.04)',
                color: '#d4d4d8',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: activeProvider?.hasApiKey ? '#4ade80' : '#f59e0b',
                }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                {activeProvider?.model || '未选择模型'}
              </span>
              {activeProvider?.label && (
                <span style={{ color: '#71717a', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  · {activeProvider.label}
                </span>
              )}
              <ChevronDown size={11} style={{ flexShrink: 0, color: '#a1a1aa' }} />
            </button>
            <span style={{ fontSize: 10, color: '#52525b' }}>Enter 发送</span>

            {modelMenuOpen && (
              <div
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  left: 0,
                  bottom: 'calc(100% + 6px)',
                  width: '100%',
                  maxHeight: 280,
                  overflowY: 'auto',
                  zIndex: 40,
                  borderRadius: 8,
                  background: '#1c1c22',
                  border: '1px solid rgba(255,255,255,0.14)',
                  boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
                  padding: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {providers.map((p) => {
                  const modelList = Array.from(
                    new Set([
                      ...(p.models ?? []),
                      ...(p.model ? [p.model] : []),
                    ].filter(Boolean)),
                  )
                  return (
                    <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '2px 6px',
                          fontSize: 10,
                          color: '#a1a1aa',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: '#d4d4d8' }}>{p.label}</span>
                        {!p.hasApiKey ? (
                          <button
                            type="button"
                            onClick={() => {
                              setModelMenuOpen(false)
                              selectProviderForEdit(p.id)
                              setSettingsOpen(true)
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#fbbf24',
                              fontSize: 10,
                              cursor: 'pointer',
                              padding: 0,
                            }}
                          >
                            未设密钥 · 去配置
                          </button>
                        ) : (
                          <span style={{ color: '#4ade80' }}>已就绪</span>
                        )}
                      </div>
                      {modelList.map((m) => {
                        const isSelected = p.id === activeProviderId && p.model === m
                        return (
                          <button
                            key={`${p.id}:${m}`}
                            type="button"
                            onClick={() => {
                              setModelMenuOpen(false)
                              if (!p.hasApiKey) {
                                selectProviderForEdit(p.id)
                                setSettingsOpen(true)
                                return
                              }
                              void setActiveProvider(p.id, m)
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '5px 8px',
                              borderRadius: 5,
                              border: 'none',
                              background: isSelected ? 'rgba(59,130,246,0.22)' : 'transparent',
                              color: isSelected ? '#93c5fd' : '#e4e4e7',
                              fontSize: 11.5,
                              textAlign: 'left',
                              cursor: 'pointer',
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                            {isSelected && <Check size={12} style={{ flexShrink: 0, color: '#60a5fa' }} />}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setModelMenuOpen(false)
                      if (activeProvider) selectProviderForEdit(activeProvider.id)
                      setSettingsOpen(true)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                      padding: '5px 8px',
                      borderRadius: 5,
                      border: 'none',
                      background: 'transparent',
                      color: '#93c5fd',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    <Settings size={12} />
                    <span>管理模型与 API 设置…</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {contextMenu && (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 9999,
            minWidth: 158,
            padding: '4px',
            borderRadius: 6,
            background: '#222228',
            border: '1px solid rgba(255,255,255,0.14)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.48)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <button
            type="button"
            disabled={!contextMenu.selectedText}
            onClick={() => {
              const txt = contextMenu.selectedText
              setContextMenu(null)
              if (txt) void writeClipboardText(txt)
            }}
            style={{
              ...ctxMenuItemStyle,
              opacity: contextMenu.selectedText ? 1 : 0.4,
              cursor: contextMenu.selectedText ? 'pointer' : 'default',
            }}
          >
            <Copy size={12} />
            <span>复制选中文字</span>
          </button>
          <button
            type="button"
            disabled={!contextMenu.fullText}
            onClick={() => {
              const { turnId, fullText } = contextMenu
              setContextMenu(null)
              if (fullText) void copyTurnText(turnId, fullText)
            }}
            style={{
              ...ctxMenuItemStyle,
              opacity: contextMenu.fullText ? 1 : 0.4,
              cursor: contextMenu.fullText ? 'pointer' : 'default',
            }}
          >
            <Copy size={12} />
            <span>复制整条消息</span>
          </button>
          {contextMenu.bodyEl && (
            <button
              type="button"
              onClick={() => {
                const el = contextMenu.bodyEl
                setContextMenu(null)
                if (!el) return
                const sel = window.getSelection()
                if (!sel) return
                const range = document.createRange()
                range.selectNodeContents(el)
                sel.removeAllRanges()
                sel.addRange(range)
              }}
              style={ctxMenuItemStyle}
            >
              <Check size={12} />
              <span>全选本条正文</span>
            </button>
          )}
        </div>
      )}
    </aside>
  )
}

const ctxMenuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 8px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: '#e4e4e7',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
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

function extractActionErrorDetails(detail: unknown): { lines: string[]; hint: string } {
  if (!detail || typeof detail !== 'object') return { lines: [], hint: '' }
  const obj = detail as Record<string, unknown>
  const lines: string[] = []

  if (typeof obj.message === 'string' && obj.message.trim()) {
    lines.push(obj.message.trim())
  }
  if (typeof obj.error === 'string' && obj.error.trim() && obj.error.trim() !== obj.message) {
    lines.push(obj.error.trim())
  }
  if (Array.isArray(obj.errors)) {
    for (const item of obj.errors) {
      if (typeof item === 'string' && item.trim()) lines.push(`• ${item.trim()}`)
    }
  }
  if (Array.isArray(obj.assertions)) {
    for (const a of obj.assertions) {
      if (a && typeof a === 'object' && (a as { passed?: unknown }).passed === false) {
        const msg = (a as { message?: unknown }).message
        lines.push(`• 断言未通过：${typeof msg === 'string' && msg ? msg : '未知断言'}`)
      }
    }
  }
  if (obj.metrics && typeof obj.metrics === 'object') {
    const m = obj.metrics as { budgetPassed?: unknown; budgetNotes?: unknown }
    if (m.budgetPassed === false && Array.isArray(m.budgetNotes)) {
      for (const note of m.budgetNotes) {
        if (typeof note === 'string' && note.trim()) lines.push(`• 性能预算：${note.trim()}`)
      }
    }
  }
  if (Array.isArray(obj.issues)) {
    for (const issue of obj.issues.slice(0, 10)) {
      if (issue && typeof issue === 'object') {
        const it = issue as { path?: unknown; message?: unknown }
        const p = typeof it.path === 'string' && it.path ? `[${it.path}] ` : ''
        const m = typeof it.message === 'string' ? it.message : ''
        if (m) lines.push(`• ${p}${m}`)
      }
    }
  }
  if (Array.isArray(obj.warnings) && obj.warnings.length > 0 && lines.length === 0) {
    for (const w of obj.warnings.slice(0, 6)) {
      if (typeof w === 'string' && w.trim()) lines.push(`• 警告：${w.trim()}`)
    }
  }

  const hint = typeof obj.hint === 'string' ? obj.hint.trim() : ''
  return { lines, hint }
}

function TurnActionsList({ actions, isActiveTurn }: { actions: AiActionPill[]; isActiveTurn: boolean }) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
  const [openErrorIds, setOpenErrorIds] = useState<Record<string, boolean>>({})
  const prevActiveRef = useRef(isActiveTurn)

  useEffect(() => {
    if (prevActiveRef.current && !isActiveTurn) {
      setManualExpanded(null)
    }
    prevActiveRef.current = isActiveTurn
  }, [isActiveTurn])

  const expanded = isActiveTurn ? true : (manualExpanded ?? false)
  const failCount = actions.filter((a) => !a.pending && !a.ok).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {!isActiveTurn && (
        <button
          type="button"
          onClick={() => setManualExpanded((prev) => !(prev ?? false))}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.04)',
            color: failCount > 0 ? '#fca5a5' : '#a1a1aa',
            fontSize: '11px',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>
            {failCount > 0
              ? `已执行 ${actions.length} 步操作（${failCount} 项失败）`
              : `已执行 ${actions.length} 步操作`}
          </span>
        </button>
      )}

      {expanded && actions.map((act) => {
        const isError = !act.pending && !act.ok
        const { lines: detailLines, hint: detailHint } = extractActionErrorDetails(act.detail)
        const hasDetail = isError && (detailLines.length > 0 || Boolean(detailHint) || act.label.length > 36)
        const errorOpen = Boolean(openErrorIds[act.id])

        return (
          <div key={act.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button
              type="button"
              onClick={() => {
                if (isError) {
                  setOpenErrorIds((prev) => ({ ...prev, [act.id]: !prev[act.id] }))
                  return
                }
                if (act.targetNodeId && useEditorStore.getState().nodes[act.targetNodeId]) {
                  useEditorStore.getState().setSelection([act.targetNodeId])
                  useEditorStore.getState().requestFocus()
                }
              }}
              title={isError ? '点击展开/收起完整报错信息' : act.targetNodeId ? '点击在视口中聚焦该节点' : act.toolName}
              style={{
                display: 'flex',
                alignItems: isError && errorOpen ? 'flex-start' : 'center',
                gap: '6px',
                textAlign: 'left',
                padding: '4px 7px',
                borderRadius: '4px',
                border: act.pending
                  ? '1px solid rgba(96,165,250,0.35)'
                  : isError
                    ? '1px solid rgba(248,113,113,0.35)'
                    : '1px solid rgba(255,255,255,0.08)',
                background: act.pending ? 'rgba(59,130,246,0.1)' : isError ? 'rgba(239,68,68,0.08)' : 'rgba(0,0,0,0.25)',
                color: act.pending ? '#93c5fd' : act.ok ? '#d4d4d8' : '#fca5a5',
                fontSize: '11px',
                cursor: isError || act.targetNodeId ? 'pointer' : 'default',
              }}
            >
              {act.pending ? (
                <Loader2 size={11} style={{ animation: 't3d-ai-spin 1s linear infinite', flexShrink: 0, marginTop: isError && errorOpen ? 2 : 0 }} />
              ) : (
                <span style={{ color: act.ok ? '#4ade80' : '#f87171', fontWeight: 700, flexShrink: 0 }}>
                  {act.ok ? '✓' : '✕'}
                </span>
              )}
              <span
                style={
                  isError && errorOpen
                    ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45, flex: 1 }
                    : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }
                }
              >
                {act.label}
              </span>
              {hasDetail && (
                <span style={{ flexShrink: 0, color: '#f87171', opacity: 0.85, display: 'inline-flex', alignItems: 'center' }}>
                  {errorOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </span>
              )}
            </button>
            {isError && errorOpen && (detailLines.length > 0 || detailHint) && (
              <div
                style={{
                  marginLeft: 10,
                  padding: '6px 8px',
                  borderRadius: 4,
                  borderLeft: '2px solid #f87171',
                  background: 'rgba(127, 29, 29, 0.25)',
                  color: '#fecaca',
                  fontSize: 11,
                  lineHeight: 1.45,
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  cursor: 'text',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {detailLines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                {detailHint && <div style={{ color: '#fca5a5', opacity: 0.85, marginTop: 3 }}>提示：{detailHint}</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
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
      <pre style={{ margin: 0, padding: '6px 8px', overflowX: 'auto', fontSize: 11, lineHeight: 1.45, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', color: '#e4e4e7', userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text' }}>
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
