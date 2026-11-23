import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, Bot, Box, Camera, Check, ChevronDown, ChevronRight, Copy, Download, FileBox, FileCode2, Folder, Loader2, Plus, RotateCcw, Send, Settings, ShieldCheck, Sparkles, Square, Trash2, Upload, Wand2, X } from 'lucide-react'
import { createCheckpoint } from '../core/project/checkpoints'
import { useManagerModalStore } from '../core/project/ProjectManagerModal'
import { openCodeAssetModal } from '../core/codeAssets/CodeAssetModal'
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { captureMainViewport } from '../core/preview/offscreenPreview'
import { ASSET_MIME, FOLDER_MIME, NODE_MIME } from '../editor/assets/import'
import { CLIP_MIME } from '../editor/animation/playback'
import { useAssetStore } from '../editor/assets/library'
import { translate, useI18n } from '../editor/i18n'
import { useEditorStore } from '../editor/scene/store'
import { useAgentStore, type AiActionPill, type AiRefItem } from './agentLoop'
import { parseImportedAiHistory, serializeAiHistoryForExport } from './historyStorage'
// 副作用导入：在 window 上注册开发用评测入口 __t3dAiEval
import './evals/runner'

const AI_PANEL_WIDTH_KEY = 't3d.ai.panelWidth'
const AI_PANEL_MIN_WIDTH = 280
const AI_PANEL_DEFAULT_WIDTH = 360

function getAiPanelMaxWidth(): number {
  if (typeof window === 'undefined') return 720
  return Math.min(820, Math.max(420, Math.floor(window.innerWidth * 0.55)))
}

function clampAiPanelWidth(w: number): number {
  return Math.max(AI_PANEL_MIN_WIDTH, Math.min(getAiPanelMaxWidth(), Math.round(w)))
}

function readAiPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(AI_PANEL_WIDTH_KEY))
    if (Number.isFinite(raw) && raw > 0) return clampAiPanelWidth(raw)
  } catch { /* ignore */ }
  return AI_PANEL_DEFAULT_WIDTH
}

export default function AiWorkbenchPanel() {
  const { t } = useI18n()
  const panelOpen = useAgentStore((s) => s.panelOpen)
  const [panelWidth, setPanelWidth] = useState<number>(readAiPanelWidth)
  const [resizingPanel, setResizingPanel] = useState(false)
  const [resizeHover, setResizeHover] = useState(false)
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
  const alwaysAllowedTools = useAgentStore((s) => s.alwaysAllowedTools)
  const alwaysAllowAllHighRisk = useAgentStore((s) => s.alwaysAllowAllHighRisk)
  const resetAutoAllowRules = useAgentStore((s) => s.resetAutoAllowRules)
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
  const [confirmMenuOpen, setConfirmMenuOpen] = useState(false)
  const confirmMenuRef = useRef<HTMLDivElement | null>(null)
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
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const stickToBottomRef = useRef(true)
  const scrollSaveTimerRef = useRef<number>(0)
  const [visibleCount, setVisibleCount] = useState(18)
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
    setConfirmMenuOpen(false)
  }, [pendingConfirm])

  useEffect(() => {
    if (!confirmMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (confirmMenuRef.current && !confirmMenuRef.current.contains(e.target as Node)) {
        setConfirmMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [confirmMenuOpen])

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
      useEditorStore.getState().notify(t('ai.noExport'))
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
    useEditorStore.getState().notify(t('ai.exported', { count: turns.length }))
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
    prependAnchorRef.current = null
    setVisibleCount(18)
  }, [panelScrollEpoch])

  useEffect(() => {
    if (turns.length === 0) {
      setVisibleCount(18)
      prependAnchorRef.current = null
    }
  }, [turns.length])

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current
    const el = scrollRef.current
    if (!anchor || !el) return
    prependAnchorRef.current = null
    const delta = el.scrollHeight - anchor.scrollHeight
    if (delta > 0) {
      el.scrollTop = anchor.scrollTop + delta
    }
  }, [visibleCount])

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
    { type: 'openai-compatible', label: t('ai.provider.compat'), defaultUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
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
      useEditorStore.getState().notify(t('ai.noViewport'))
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
        void createCheckpoint(t('ai.manualSnapshot', { time: new Date().toLocaleTimeString() }), true).then(() => {
          useEditorStore.getState().notify(t('ai.snapshot'))
        })
        return
      }
      if (trimmed === '/playtest') {
        setInput('')
        void sendPrompt(t('ai.playtestPrompt'))
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
        ...Object.values(nodes).map(n => ({ refKind: 'node' as const, id: n.id, label: n.name, kind: t('ai.kind.node'), subKind: n.kind })),
        ...Object.values(codeAssets).map(c => ({
          refKind: c.kind as 'script' | 'shader',
          id: c.id,
          label: c.name,
          kind: c.kind === 'shader' ? t('ai.kind.shader') : t('ai.kind.script'),
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
    { cmd: '/playtest', desc: t('ai.cmd.playtest') },
    { cmd: '/diagnose', desc: t('ai.cmd.diagnose') },
    { cmd: '/pack', desc: t('ai.cmd.pack') },
    { cmd: '/checkpoint', desc: t('ai.cmd.checkpoint') },
  ].filter(item => item.cmd.startsWith(input.toLowerCase()))

  const acceptsDrop = (e: DragEvent) => {
    const types = [...e.dataTransfer.types]
    return types.includes(ASSET_MIME) || types.includes(FOLDER_MIME) || types.includes(NODE_MIME) || types.includes(CLIP_MIME) || types.includes('Files')
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

    const folderPath = e.dataTransfer.getData(FOLDER_MIME)
    if (folderPath) {
      const segs = folderPath.split('/').filter(Boolean)
      const label = segs[segs.length - 1] || folderPath
      addPendingRef({ kind: 'folder', id: folderPath, label, subKind: folderPath })
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

  const hiddenCount = Math.max(0, turns.length - visibleCount)
  const visibleTurns = hiddenCount > 0 ? turns.slice(hiddenCount) : turns

  const loadOlderTurns = (step = 16) => {
    if (hiddenCount <= 0) return
    const el = scrollRef.current
    if (el) {
      prependAnchorRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop }
    }
    setVisibleCount((c) => Math.min(turns.length, c + step))
  }

  useEffect(() => {
    const onWinResize = () => setPanelWidth((w) => clampAiPanelWidth(w))
    window.addEventListener('resize', onWinResize)
    return () => window.removeEventListener('resize', onWinResize)
  }, [])

  const startPanelResize = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth
    setResizingPanel(true)
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    let latestW = startW
    const onMove = (ev: MouseEvent) => {
      latestW = clampAiPanelWidth(startW + (startX - ev.clientX))
      setPanelWidth(latestW)
    }
    const onUp = () => {
      setResizingPanel(false)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      try { localStorage.setItem(AI_PANEL_WIDTH_KEY, String(latestW)) } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
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
        position: 'relative',
        width: `${panelWidth}px`,
        minWidth: `${AI_PANEL_MIN_WIDTH}px`,
        maxWidth: '55vw',
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
      {/* 左侧拖拽调宽热区 */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={startPanelResize}
        onMouseEnter={() => setResizeHover(true)}
        onMouseLeave={() => setResizeHover(false)}
        onDoubleClick={() => {
          setPanelWidth(AI_PANEL_DEFAULT_WIDTH)
          try { localStorage.setItem(AI_PANEL_WIDTH_KEY, String(AI_PANEL_DEFAULT_WIDTH)) } catch { /* ignore */ }
        }}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: -3,
          width: 6,
          cursor: 'col-resize',
          zIndex: 40,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 2,
            height: '100%',
            background: resizingPanel || resizeHover ? '#3b82f6' : 'transparent',
            transition: 'background 0.12s ease',
          }}
        />
      </div>
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
        <span style={{ fontWeight: 600, fontSize: '12px' }}>{t('ai.title')}</span>
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
          title={activeProvider ? `${activeProvider.label} (${activeProvider.model})` : t('ai.unconfigured')}
        >
          {activeProvider ? (activeProvider.hasApiKey ? activeProvider.model : t('ai.noKey')) : t('ai.desktop')}
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
              useEditorStore.getState().notify(t('ai.imported', { count: imported.length }))
            } catch (err) {
              useEditorStore.getState().notify(t('ai.importFailed', { message: err instanceof Error ? err.message : String(err) }))
            }
          }}
        />
        <button
          type="button"
          title={t('ai.importTip')}
          onClick={() => importInputRef.current?.click()}
          disabled={status !== 'idle'}
          style={iconBtnStyle}
        >
          <Upload size={13} />
        </button>
        <button
          type="button"
          title={t('ai.exportTip')}
          onClick={handleExportHistory}
          disabled={turns.length === 0}
          style={iconBtnStyle}
        >
          <Download size={13} />
        </button>
        {(alwaysAllowAllHighRisk || alwaysAllowedTools.length > 0) && (
          <button
            type="button"
            title={
              alwaysAllowAllHighRisk
                ? t('ai.autoAllowAllActive')
                : t('ai.autoAllowActive', { count: alwaysAllowedTools.length })
            }
            onClick={() => {
              resetAutoAllowRules()
              useEditorStore.getState().notify(t('ai.autoAllowReset'))
            }}
            style={{
              ...iconBtnStyle,
              color: '#fbbf24',
              borderColor: 'rgba(245,158,11,0.4)',
              background: 'rgba(245,158,11,0.12)',
            }}
          >
            <ShieldCheck size={13} />
          </button>
        )}
        <button
          type="button"
          title={t('ai.settingsTip')}
          onClick={() => setSettingsOpen((v) => !v)}
          style={iconBtnStyle}
        >
          <Settings size={13} />
        </button>
        <button
          type="button"
          title={t('ai.clearTip')}
          onClick={clearTurns}
          disabled={status !== 'idle'}
          style={iconBtnStyle}
        >
          <Trash2 size={13} />
        </button>
        <button
          type="button"
          title={t('ai.collapse')}
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
            <span style={{ fontWeight: 600, color: '#d4d4d8' }}>{t('ai.settings')}</span>
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
              <span>{t('ai.addProvider')}</span>
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
                    {isActive && <span style={{ fontSize: 9, color: '#60a5fa' }}>{t('ai.current')}</span>}
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
                {t('ai.newConfig')}
              </span>
            )}
          </div>

          <input
            type="text"
            placeholder={t('ai.namePh')}
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="text"
            placeholder={t('ai.urlPh')}
            value={editBaseUrl}
            onChange={(e) => setEditBaseUrl(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="text"
            placeholder={t('ai.modelPh')}
            value={editModel}
            onChange={(e) => setEditModel(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="text"
            placeholder={t('ai.modelsPh')}
            value={editModelsText}
            onChange={(e) => setEditModelsText(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="password"
            placeholder={
              editingProviderId !== '__new__' && providers.find((p) => p.id === editingProviderId)?.hasApiKey
                ? t('ai.keySaved')
                : t('ai.keyPh')
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
                  {t('ai.deleteItem')}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button type="button" onClick={() => setSettingsOpen(false)} style={smallBtnStyle}>{t('ai.close')}</button>
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
                    label: editLabel.trim() || (isNew ? t('ai.customApi') : id),
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
                {t('ai.saveEnable')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 运行中置顶状态条（不随消息滚动） */}
      {status !== 'idle' && (
        <div
          style={{
            flexShrink: 0,
            margin: '8px 10px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            borderRadius: '6px',
            background: status === 'awaiting-confirm' ? 'rgba(245,158,11,0.14)' : 'rgba(59,130,246,0.16)',
            border: status === 'awaiting-confirm' ? '1px solid rgba(245,158,11,0.35)' : '1px solid rgba(59,130,246,0.32)',
            color: status === 'awaiting-confirm' ? '#fcd34d' : '#93c5fd',
            fontSize: '11px',
            fontWeight: 500,
          }}
        >
          <Loader2 size={12} style={{ animation: 't3d-ai-spin 1s linear infinite', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {phaseText || t('ai.working')}
          </span>
          <span style={{ marginLeft: 'auto', color: '#a1a1aa', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        </div>
      )}

      {/* 对话与结构化执行流 */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          if (pendingRestoreScrollRef.current !== null || prependAnchorRef.current !== null) return
          const el = e.currentTarget
          const top = Math.max(0, Math.round(el.scrollTop))
          const distToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          stickToBottomRef.current = distToBottom <= 36
          if (hiddenCount > 0 && top <= 48) {
            loadOlderTurns(16)
          }
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
              <span>{t('ai.ready')}</span>
            </div>
            <div>{t('ai.example')}</div>
          </div>
        )}

        {hiddenCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 0' }}>
            <button
              type="button"
              onClick={() => loadOlderTurns(24)}
              style={{
                padding: '4px 12px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.04)',
                color: '#a1a1aa',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {t('ai.older', { count: hiddenCount })}
            </button>
          </div>
        )}

        {visibleTurns.map((turn, sliceIdx) => {
          const idx = hiddenCount + sliceIdx
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
                title={t('ai.deleteTurn')}
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

            {turn.refs && turn.refs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {turn.refs.map((r) => (
                  <button
                    key={`${r.kind}:${r.id}`}
                    type="button"
                    onClick={() => locateRef(r)}
                    title={t('ai.locate')}
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
                alt={t('ai.annotationAlt')}
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
                    <span style={{ fontWeight: 700, color: '#fca5a5' }}>{t('ai.interrupted')}</span>
                    <span style={{ color: '#fca5a5', opacity: 0.85, fontSize: 10.5 }}>
                      {t('ai.interruptedHint')}
                    </span>
                  </div>
                </div>
                {idx === turns.length - 1 && status === 'idle' && (
                  <button
                    type="button"
                    onClick={() => {
                      const prevUser = [...turns.slice(0, idx)].reverse().find((t) => t.role === 'user')
                      const hint = prevUser?.text
                        ? t('ai.resumeInterruptedWithPrev', { text: prevUser.text.slice(0, 120) })
                        : t('ai.resumeInterrupted')
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
                    {t('ai.continue')}
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
                    ? t('ai.stepLimit')
                    : t('ai.pending', { count: turn.pendingTasksCount || t('ai.working') })}
                </span>
                {idx === turns.length - 1 && status === 'idle' && (
                  <button
                    type="button"
                    onClick={() => void sendPrompt(t('ai.resumePlanPrompt'))}
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
                    {t('ai.resume')}
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
                    ? [
                        turn.usage.model,
                        `${(turn.usage.inputTokens ?? 0) + (turn.usage.outputTokens ?? 0)} tok`,
                        turn.usage.cachedTokens && turn.usage.inputTokens
                          ? t('ai.cache', { percent: Math.round((turn.usage.cachedTokens / turn.usage.inputTokens) * 100) })
                          : '',
                        turn.usage.steps ? t('ai.steps', { count: turn.usage.steps }) : '',
                        turn.usage.durationMs ? `${(turn.usage.durationMs / 1000).toFixed(0)}s` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : ''}
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  {(turn.text || turn.error) && (
                    <button
                      type="button"
                      title={t('ai.copyTip')}
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
                      <span>{copiedTurnId === turn.id ? t('ai.copied') : t('ai.copy')}</span>
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
                      <span>{t('ai.rollback')}</span>
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
      {pendingConfirm && (() => {
        const dotToolName = pendingConfirm.toolName.replace(/__/g, '.')
        const argsPreview = (() => {
          try {
            const raw = JSON.stringify(pendingConfirm.args)
            if (!raw || raw === '{}') return ''
            return raw.length > 110 ? `${raw.slice(0, 110)}…` : raw
          } catch {
            return ''
          }
        })()
        return (
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
            {argsPreview && (
              <div
                style={{
                  fontSize: '11px',
                  color: '#d4d4d8',
                  fontFamily: 'monospace',
                  background: 'rgba(0,0,0,0.28)',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  wordBreak: 'break-all',
                }}
              >
                {argsPreview}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  setConfirmMenuOpen(false)
                  pendingConfirm.resolve('reject')
                }}
                style={smallBtnStyle}
              >
                {t('ai.reject')}
              </button>
              <div ref={confirmMenuRef} style={{ position: 'relative', display: 'inline-flex' }}>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmMenuOpen(false)
                    pendingConfirm.resolve('once')
                  }}
                  style={{
                    ...smallBtnStyle,
                    background: '#d97706',
                    color: '#fff',
                    borderColor: '#d97706',
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                  }}
                >
                  <Check size={11} /> {t('ai.allow')}
                </button>
                <button
                  type="button"
                  title={t('ai.allowMoreTip')}
                  aria-haspopup="menu"
                  aria-expanded={confirmMenuOpen}
                  onClick={() => setConfirmMenuOpen((v) => !v)}
                  style={{
                    ...smallBtnStyle,
                    background: '#b45309',
                    color: '#fff',
                    borderColor: '#d97706',
                    borderLeft: '1px solid rgba(255,255,255,0.22)',
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    padding: '4px 6px',
                  }}
                >
                  <ChevronDown size={11} />
                </button>
                {confirmMenuOpen && (
                  <div
                    role="menu"
                    style={{
                      position: 'absolute',
                      right: 0,
                      bottom: '100%',
                      marginBottom: '4px',
                      minWidth: '210px',
                      background: '#1e1f24',
                      border: '1px solid rgba(255,255,255,0.14)',
                      borderRadius: '6px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                      padding: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      zIndex: 30,
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setConfirmMenuOpen(false)
                        pendingConfirm.resolve('always-tool')
                      }}
                      style={confirmMenuItemStyle}
                    >
                      {t('ai.allowAlwaysTool', { tool: dotToolName })}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setConfirmMenuOpen(false)
                        pendingConfirm.resolve('always-all')
                      }}
                      style={{ ...confirmMenuItemStyle, color: '#fcd34d' }}
                    >
                      {t('ai.allowAlwaysAll')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

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
                  {t('ai.taskProgress', { done: doneCount, total: taskPlan.length })}
                </span>
                <span style={{ color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {current ? t('ai.taskCurrent', { title: current.title }) : t('ai.taskDone')}
                </span>
              </button>
              {status === 'idle' && (
                <button
                  type="button"
                  title={t('ai.clearPlan')}
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
            {t('ai.dropHint')}
          </div>
        )}
        {pendingAttachmentImage && (
          <div style={{ position: 'relative', marginBottom: 6, borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(248,113,113,0.4)' }}>
            <img src={pendingAttachmentImage} alt={t('ai.pendingShot')} style={{ width: '100%', maxHeight: 96, objectFit: 'cover', display: 'block' }} />
            <button
              type="button"
              onClick={() => setPendingAttachmentImage(null)}
              title={t('ai.removeShot')}
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
                  title={t('ai.removeRef')}
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
                  title={t('ai.insertName')}
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
                ? t('ai.inputPh')
                : t('ai.inputBusyPh')
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
            title={t('ai.capture')}
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
              title={t('ai.send')}
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
                title={t('ai.steer')}
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
                title={t('ai.stop')}
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
              {t('ai.queued', { count: steerQueue.length })}
            </div>
          )}

          {/* 对话框底部模型快速切换栏（主流 Agent 风格） */}
          <div style={{ position: 'relative', marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setModelMenuOpen((v) => !v)}
              title={t('ai.switchModel')}
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
                {activeProvider?.model || t('ai.noModel')}
              </span>
              <ChevronDown size={11} style={{ flexShrink: 0, color: '#a1a1aa' }} />
            </button>
            <span style={{ fontSize: 10, color: '#52525b' }}>{t('ai.enterSend')}</span>

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
                {status !== 'idle' && (
                  <div style={{ fontSize: 10.5, color: '#93c5fd', padding: '3px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.12)' }}>
                    {t('ai.modelLater')}
                  </div>
                )}
                {providers.flatMap((p) => {
                  const modelList = Array.from(
                    new Set([
                      ...(p.models ?? []),
                      ...(p.model ? [p.model] : []),
                    ].filter(Boolean)),
                  )
                  return modelList.map((m) => {
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
                          gap: 8,
                          width: '100%',
                          padding: '5px 8px',
                          borderRadius: 5,
                          border: 'none',
                          background: isSelected ? 'rgba(59,130,246,0.22)' : 'transparent',
                          color: isSelected ? '#93c5fd' : p.hasApiKey ? '#e4e4e7' : '#a1a1aa',
                          fontSize: 11.5,
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                        {!p.hasApiKey ? (
                          <span style={{ fontSize: 10, color: '#fbbf24', flexShrink: 0 }}>{t('ai.noKey')}</span>
                        ) : (
                          isSelected && <Check size={12} style={{ flexShrink: 0, color: '#60a5fa' }} />
                        )}
                      </button>
                    )
                  })
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
                    <span>{t('ai.manage')}</span>
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
            <span>{t('ai.copySelection')}</span>
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
            <span>{t('ai.copyMessage')}</span>
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
              <span>{t('ai.selectAll')}</span>
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

const confirmMenuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 8px',
  borderRadius: '4px',
  border: 'none',
  background: 'transparent',
  color: '#e4e4e7',
  fontSize: '11px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
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
        lines.push(`• ${translate('ai.assertFailed', { message: typeof msg === 'string' && msg ? msg : translate('ai.unknownAssert') })}`)
      }
    }
  }
  if (obj.metrics && typeof obj.metrics === 'object') {
    const m = obj.metrics as { budgetPassed?: unknown; budgetNotes?: unknown }
    if (m.budgetPassed === false && Array.isArray(m.budgetNotes)) {
      for (const note of m.budgetNotes) {
        if (typeof note === 'string' && note.trim()) lines.push(`• ${translate('ai.perfBudget', { note: note.trim() })}`)
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
      if (typeof w === 'string' && w.trim()) lines.push(`• ${translate('ai.warnLine', { msg: w.trim() })}`)
    }
  }

  const hint = typeof obj.hint === 'string' ? obj.hint.trim() : ''
  return { lines, hint }
}

const ACTION_LINK_STYLE = {
  color: '#60a5fa',
  textDecoration: 'underline',
  textUnderlineOffset: '2px',
} as const

function renderActionLabel(label: string, isLink: boolean) {
  if (!isLink) return label
  const pathMatch = label.match(/^(.*?\s+)((?:Assets|scripts|shaders)\/\S+)(.*)$/i)
  if (pathMatch) {
    return (
      <>
        <span>{pathMatch[1]}</span>
        <span style={ACTION_LINK_STYLE}>{pathMatch[2]}</span>
        {pathMatch[3] && <span>{pathMatch[3]}</span>}
      </>
    )
  }
  const spaceIdx = label.indexOf(' ')
  if (spaceIdx > 0 && spaceIdx < label.length - 1) {
    return (
      <>
        <span>{label.slice(0, spaceIdx + 1)}</span>
        <span style={ACTION_LINK_STYLE}>{label.slice(spaceIdx + 1)}</span>
      </>
    )
  }
  return <span style={ACTION_LINK_STYLE}>{label}</span>
}

function TurnActionsList({ actions, isActiveTurn }: { actions: AiActionPill[]; isActiveTurn: boolean }) {
  const { t } = useI18n()
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
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
              ? t('ai.stepsFailed', { count: actions.length, failed: failCount })
              : t('ai.stepsDone', { count: actions.length })}
          </span>
        </button>
      )}

      {expanded && actions.map((act) => {
        const isError = !act.pending && !act.ok
        const canLocateAsset = Boolean(act.targetAssetId)
        const canFocusNode = Boolean(act.targetNodeId && useEditorStore.getState().nodes[act.targetNodeId])
        const canClick = isError || canLocateAsset || canFocusNode
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
                if (act.targetAssetId) {
                  useEditorStore.getState().pingAsset(act.targetAssetId)
                  if (!act.targetAssetId.startsWith('code:')) {
                    useEditorStore.getState().inspectAsset(act.targetAssetId)
                  }
                  return
                }
                if (act.targetNodeId && useEditorStore.getState().nodes[act.targetNodeId]) {
                  useEditorStore.getState().setSelection([act.targetNodeId])
                  useEditorStore.getState().requestFocus()
                }
              }}
              title={
                isError
                  ? t('ai.expandError')
                  : canLocateAsset
                    ? t('ai.locateAsset')
                    : canFocusNode
                      ? t('ai.focusNode')
                      : act.toolName
              }
              style={{
                display: 'flex',
                alignItems: isError && errorOpen ? 'flex-start' : 'center',
                gap: '6px',
                textAlign: 'left',
                padding: isError ? '3px 6px' : '1px 2px',
                lineHeight: 1.4,
                borderRadius: isError ? '4px' : 0,
                border: isError ? '1px solid rgba(248,113,113,0.35)' : 'none',
                background: isError ? 'rgba(239,68,68,0.08)' : 'transparent',
                color: act.pending ? '#93c5fd' : act.ok ? '#d4d4d8' : '#fca5a5',
                fontSize: '11px',
                cursor: canClick ? 'pointer' : 'default',
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
                {renderActionLabel(act.label, !act.pending && !isError && (canLocateAsset || canFocusNode))}
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
                {detailHint && <div style={{ color: '#fca5a5', opacity: 0.85, marginTop: 3 }}>{t('ai.hintPrefix', { hint: detailHint })}</div>}
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
  if (kind === 'folder') return <Folder size={11} />
  return <FileBox size={11} />
}

function refKindColors(kind: AiRefItem['kind']): React.CSSProperties {
  if (kind === 'script') return { background: 'rgba(56,189,248,0.18)', color: '#7dd3fc' }
  if (kind === 'shader') return { background: 'rgba(192,132,252,0.18)', color: '#d8b4fe' }
  if (kind === 'asset') return { background: 'rgba(52,211,153,0.18)', color: '#6ee7b7' }
  if (kind === 'folder') return { background: 'rgba(245,158,11,0.18)', color: '#fcd34d' }
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
  const { t } = useI18n()
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
          {copied ? t('ai.copied') : t('ai.copyCode')}
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
