import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CLIP_MIME, readClipDrag } from '../animation/playback'
import { ASSET_MIME, PROJECT_ITEMS_MIME, assignClip, importFiles, placeAsset } from '../assets/import'
import { parseProjectItemKey, readDraggedProjectKeys } from '../assets/projectSelection'
import { subscribeWarmProgress, warmProgress } from '../assets/project'
import { useI18n, type MessageKey } from '../i18n'
import type { CameraView } from '../scene/types'
import { useAssetStore } from '../assets/library'
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, Axis3d, BarChart3, Box, BoxSelect, ChevronDown, Crosshair, Focus, Globe, Grid3x3, Lightbulb, Magnet, Maximize, Monitor, Move3d, PenTool, Route, RotateCcw, Scaling, Scan, Send, Smartphone, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useAgentStore } from '../../ai/agentLoop'
import { injectVirtualInput } from '../../core/input/actionMap'
import { captureMainViewport, registerCompositeCapture } from '../../core/preview/offscreenPreview'
import { electronBridge } from '../project/electronBridge'
import { useEditorStore } from '../scene/store'
import { EditorViewport } from './EditorViewport'
import ViewCube from './ViewCube'
import { ViewportStatsDrawer } from './ViewportStatsDrawer'
import { PlayUiOverlay } from '../ui/PlayUiOverlay'
import './ViewportPanel.css'

const VIEW_ROWS: { id: CameraView, icon: typeof Box }[][] = [
  [{ id: 'persp', icon: Box }],
  [
    { id: 'top', icon: ArrowUp },
    { id: 'front', icon: Square },
    { id: 'right', icon: ArrowRight },
  ],
  [
    { id: 'bottom', icon: ArrowDown },
    { id: 'back', icon: Square },
    { id: 'left', icon: ArrowLeft },
  ],
]

export default function ViewportPanel() {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playState = useEditorStore(state => state.playState)
  const gizmoMode = useEditorStore(state => state.gizmoMode)
  const gizmoSpace = useEditorStore(state => state.gizmoSpace)
  const grid = useEditorStore(state => state.gridVisible)
  const helpers = useEditorStore(state => state.helpersVisible)
  const navMesh = useEditorStore(state => state.navMeshVisible)
  const snap = useEditorStore(state => state.snap)
  const snapStep = useEditorStore(state => state.snapStep)
  const stats = useEditorStore(state => state.viewportStats)
  const view = useEditorStore(state => state.cameraView)
  const warming = useSyncExternalStore(subscribeWarmProgress, warmProgress)
  const origin = useEditorStore(state => state.gizmoOrigin)
  const [menu, setMenu] = useState<'view' | 'gizmo' | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const [devicePreset, setDevicePreset] = useState<'full' | 'desktop' | 'mobile-portrait' | 'mobile-landscape'>('full')
  const [annotateMode, setAnnotateMode] = useState(false)
  const annotateCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const quickPromptOpen = useAgentStore(state => state.quickPromptOpen)
  const setQuickPromptOpen = useAgentStore(state => state.setQuickPromptOpen)
  const [quickInput, setQuickInput] = useState('')
  const selection = useEditorStore(state => state.selection)
  const nodes = useEditorStore(state => state.nodes)
  const { t } = useI18n()
  const viewName = (id: CameraView) => t(`view.${id}` as MessageKey)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setQuickPromptOpen(!useAgentStore.getState().quickPromptOpen)
      } else if (event.key === 'Escape') {
        if (useAgentStore.getState().quickPromptOpen) setQuickPromptOpen(false)
        if (annotateMode) setAnnotateMode(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [annotateMode, setQuickPromptOpen])

  useEffect(() => {
    if (!annotateMode) return
    const overlay = annotateCanvasRef.current
    const stage = stageRef.current
    if (!overlay || !stage) return
    const rect = stage.getBoundingClientRect()
    overlay.width = Math.max(1, Math.floor(rect.width))
    overlay.height = Math.max(1, Math.floor(rect.height))
  }, [annotateMode])

  const clearAnnotation = () => {
    const overlay = annotateCanvasRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    ctx?.clearRect(0, 0, overlay.width, overlay.height)
  }

  const sendAnnotationToAi = () => {
    const baseDataUrl = captureMainViewport()
    const overlay = annotateCanvasRef.current
    if (!baseDataUrl || !overlay) {
      useAgentStore.getState().setPanelOpen(true)
      setAnnotateMode(false)
      return
    }
    const img = new Image()
    img.onload = () => {
      const merged = document.createElement('canvas')
      merged.width = img.width
      merged.height = img.height
      const ctx = merged.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0)
        ctx.drawImage(overlay, 0, 0, img.width, img.height)
        useAgentStore.getState().setPendingAttachmentImage(merged.toDataURL('image/png'))
        useAgentStore.getState().setPanelOpen(true)
      }
      setAnnotateMode(false)
    }
    img.src = baseDataUrl
  }

  const viewportRef = useRef<EditorViewport | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const viewport = new EditorViewport(canvas, stage)
    viewportRef.current = viewport
    const unregisterComposite = registerCompositeCapture(async (options) => {
      const cap = electronBridge()?.viewport?.capturePage
      if (!cap) return null
      const rect = stage.getBoundingClientRect()
      if (rect.width <= 8 || rect.height <= 8) return null
      return cap(
        { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        options?.width ?? 960,
      )
    })
    return () => {
      unregisterComposite()
      viewportRef.current = null
      viewport.dispose()
    }
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  const modeClass = playState === 'playing' ? 'viewport-panel--playing' : playState === 'paused' ? 'viewport-panel--paused' : ''
  const editor = useEditorStore.getState()

  return (
    <div className={`viewport-panel ${modeClass}`}>
      <div className="viewport-tabs">
        <div className="viewport-tab viewport-tab--active">{t('panel.viewport')}</div>
        <div className="viewport-tabs__spacer" />
        <div className="viewport-tabs__tools">
          <button type="button" className={`viewport-tool-btn ${gizmoMode === 'translate' ? 'viewport-tool-btn--active' : ''}`} title={t('tool.move')} onClick={() => editor.setGizmoMode('translate')}><Move3d size={12} /></button>
          <button type="button" className={`viewport-tool-btn ${gizmoMode === 'rotate' ? 'viewport-tool-btn--active' : ''}`} title={t('tool.rotate')} onClick={() => editor.setGizmoMode('rotate')}><RotateCcw size={12} /></button>
          <button type="button" className={`viewport-tool-btn ${gizmoMode === 'scale' ? 'viewport-tool-btn--active' : ''}`} title={t('tool.scale')} onClick={() => editor.setGizmoMode('scale')}><Scaling size={12} /></button>
          <div className="viewport-tool-sep" />
          <button
            type="button"
            className={`viewport-tool-btn ${gizmoSpace === 'world' ? 'viewport-tool-btn--active' : ''}`}
            title={gizmoSpace === 'world' ? t('view.world') : t('view.local')}
            aria-label={gizmoSpace === 'world' ? t('view.world') : t('view.local')}
            onClick={() => editor.setGizmoSpace(gizmoSpace === 'world' ? 'local' : 'world')}
          >
            {gizmoSpace === 'world' ? <Globe size={12} /> : <Axis3d size={12} />}
          </button>
          <div className="viewport-tool-sep" />
          <div className="viewport-menu">
            <button type="button" className="viewport-tool-btn viewport-tool-btn--text" onPointerDown={event => event.stopPropagation()} onClick={() => setMenu(menu === 'view' ? null : 'view')}>
              {viewName(view)} <ChevronDown size={10} />
            </button>
            {menu === 'view' && (
              <div className="viewport-menu__pop" onPointerDown={event => event.stopPropagation()}>
                {VIEW_ROWS.map((group, index) => (
                  <div key={group[0].id}>
                    {index > 0 && <div className="viewport-menu__sep" />}
                    {group.map(item => {
                      const Icon = item.icon
                      return (
                        <button key={item.id} type="button" className={view === item.id ? 'is-active' : ''} onClick={() => { editor.requestView(item.id); setMenu(null) }}>
                          <Icon size={13} />
                          <span>{viewName(item.id)}</span>
                        </button>
                      )
                    })}
                  </div>
                ))}
                <div className="viewport-menu__sep" />
                <button type="button" onClick={() => { editor.requestFocus(); setMenu(null) }}><Focus size={13} /><span>{t('menu.focus')}</span></button>
                <button type="button" onClick={() => { editor.requestFocusAll(); setMenu(null) }}><Scan size={13} /><span>{t('menu.focusAll')}</span></button>
              </div>
            )}
          </div>
          <div className="viewport-menu">
            <button type="button" className={`viewport-tool-btn ${grid || helpers ? 'viewport-tool-btn--active' : ''}`} title={t('view.helpers')} onPointerDown={event => event.stopPropagation()} onClick={() => setMenu(menu === 'gizmo' ? null : 'gizmo')}><Grid3x3 size={12} /></button>
            {menu === 'gizmo' && (
              <div className="viewport-menu__pop" onPointerDown={event => event.stopPropagation()}>
                <label><Grid3x3 size={13} /><span>{t('view.grid')}</span><input type="checkbox" checked={grid} onChange={() => editor.toggleGrid()} /></label>
                <label><Lightbulb size={13} /><span>{t('view.lights')}</span><input type="checkbox" checked={helpers} onChange={() => editor.setHelpersVisible(!helpers)} /></label>
                <label><Route size={13} /><span>{t('navigation.show')}</span><input type="checkbox" checked={navMesh} onChange={() => editor.setNavMeshVisible(!navMesh)} /></label>
                <div className="viewport-menu__sep" />
                <label><Crosshair size={13} /><span>{t('view.gizmoCenter')}</span><input type="checkbox" checked={origin === 'center'} onChange={() => editor.setGizmoOrigin(origin === 'center' ? 'pivot' : 'center')} /></label>
                <div className="viewport-menu__sep" />
                <label><Magnet size={13} /><span>{t('view.snap')}</span><input type="checkbox" checked={snap} onChange={() => editor.toggleSnap()} /></label>
                <label className="viewport-menu__step">
                  <span className="viewport-menu__pad" />
                  <span>{t('view.step')}</span>
                  <input
                    type="number"
                    min={0.01}
                    step={0.1}
                    value={snapStep}
                    onChange={event => editor.setSnapStep(Number(event.target.value) || 0.01)}
                  />
                </label>
              </div>
            )}
          </div>
          <button
            type="button"
            className={`viewport-tool-btn ${statsOpen ? 'viewport-tool-btn--active' : ''}`}
            title={t('view.statsOpen')}
            aria-pressed={statsOpen}
            onClick={() => setStatsOpen(open => !open)}
          >
            <BarChart3 size={12} />
          </button>
          <button type="button" className="viewport-tool-btn" title={t('view.focus')} onClick={() => editor.requestFocus()}><Focus size={12} /></button>
          <button type="button" className="viewport-tool-btn" title={t('tool.ground')} onClick={() => editor.snapSelectionToGround()}><ArrowDownToLine size={12} /></button>
          <button
            type="button"
            className={`viewport-tool-btn ${origin === 'center' ? 'viewport-tool-btn--active' : ''}`}
            title={origin === 'center' ? t('tool.originCenter') : t('tool.originPivot')}
            aria-label={origin === 'center' ? t('tool.center') : t('tool.pivot')}
            onClick={() => editor.setGizmoOrigin(origin === 'pivot' ? 'center' : 'pivot')}
          >
            {origin === 'center' ? <BoxSelect size={12} /> : <Crosshair size={12} />}
          </button>
          <button
            type="button"
            className={`viewport-tool-btn ${devicePreset !== 'full' ? 'viewport-tool-btn--active' : ''}`}
            title={
              devicePreset === 'full'
                ? t('view.device.full')
                : devicePreset === 'desktop'
                  ? t('view.device.desktop')
                  : devicePreset === 'mobile-portrait'
                    ? t('view.device.portrait')
                    : t('view.device.landscape')
            }
            onClick={() => {
              const order: Array<'full' | 'desktop' | 'mobile-portrait' | 'mobile-landscape'> = [
                'full',
                'desktop',
                'mobile-portrait',
                'mobile-landscape',
              ]
              setDevicePreset(order[(order.indexOf(devicePreset) + 1) % order.length])
            }}
          >
            {devicePreset === 'mobile-portrait' || devicePreset === 'mobile-landscape' ? (
              <Smartphone size={12} />
            ) : (
              <Monitor size={12} />
            )}
          </button>
          <button
            type="button"
            className={`viewport-tool-btn ${annotateMode ? 'viewport-tool-btn--active' : ''}`}
            title={t('view.annotate')}
            onClick={() => setAnnotateMode(v => !v)}
          >
            <PenTool size={12} />
          </button>
          <button
            type="button"
            className={`viewport-tool-btn ${quickPromptOpen ? 'viewport-tool-btn--active' : ''}`}
            title={t('view.aiPrompt')}
            onClick={() => setQuickPromptOpen(!quickPromptOpen)}
          >
            <Sparkles size={12} />
          </button>
          <button
            type="button"
            className="viewport-tool-btn"
            title={t('view.fullscreen')}
            onClick={() => {
              const stage = stageRef.current
              if (!stage) return
              if (document.fullscreenElement) void document.exitFullscreen()
              else void stage.requestFullscreen()
            }}
          >
            <Maximize size={12} />
          </button>
        </div>
      </div>
      <div className={`viewport-stage-wrap viewport-stage-wrap--${devicePreset}`}>
        <div
          className="viewport-stage"
          data-device={devicePreset}
          ref={stageRef}
        onDragOver={event => {
          const types = [...event.dataTransfer.types]
          if (types.includes(PROJECT_ITEMS_MIME) || types.includes(ASSET_MIME) || types.includes(CLIP_MIME) || types.includes('Files')) event.preventDefault()
        }}
        onDrop={event => {
          const clipDrag = readClipDrag(event.dataTransfer.getData(CLIP_MIME))
          const hit = viewportRef.current?.raycastDrop(event.clientX, event.clientY)
          if (clipDrag && hit?.nodeId) {
            event.preventDefault()
            assignClip(hit.nodeId, clipDrag.assetId, clipDrag.clip)
            return
          }
          const point = hit?.point ?? [0, 0, 0] as [number, number, number]
          const batchKeys = readDraggedProjectKeys(event.dataTransfer)
          if (batchKeys.length > 1) {
            const placeableIds: string[] = []
            const assetsMap = useAssetStore.getState().assets
            for (const k of batchKeys) {
              const parsed = parseProjectItemKey(k)
              if (parsed?.type !== 'asset') continue
              const a = assetsMap[parsed.id]
              if (a && (a.kind === 'model' || a.kind === 'prefab' || a.kind === 'effect')) {
                placeableIds.push(a.id)
              }
            }
            if (placeableIds.length > 0) {
              event.preventDefault()
              const cols = Math.ceil(Math.sqrt(placeableIds.length))
              const step = 1.6
              placeableIds.forEach((id, idx) => {
                const col = idx % cols
                const row = Math.floor(idx / cols)
                const offsetX = (col - (cols - 1) / 2) * step
                const offsetZ = row * step
                placeAsset(id, [point[0] + offsetX, point[1], point[2] + offsetZ], null)
              })
              return
            }
          }
          const assetId = event.dataTransfer.getData(ASSET_MIME)
          if (assetId) {
            event.preventDefault()
            placeAsset(assetId, point, hit?.nodeId ?? null)
            return
          }
          const files = [...event.dataTransfer.files]
          if (!files.length) return
          event.preventDefault()
          void importFiles(files).then(ids => {
            for (const id of ids) {
              const asset = useAssetStore.getState().assets[id]
              if (asset?.kind === 'model' || asset?.kind === 'environment' || asset?.kind === 'effect') placeAsset(id, point, hit?.nodeId ?? null)
            }
          })
        }}
      >
        <canvas ref={canvasRef} />
        {playState !== 'stopped' && <PlayUiOverlay />}
        {playState !== 'stopped' && (devicePreset === 'mobile-portrait' || devicePreset === 'mobile-landscape') && (
          <div className="viewport-touch-pad" onPointerDown={e => e.stopPropagation()}>
            <div className="viewport-touch-pad__dpad">
              <button
                type="button"
                className="viewport-touch-btn"
                onPointerDown={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 1 })}
                onPointerUp={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 0 })}
                onPointerLeave={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 0 })}
              >▲</button>
              <div className="viewport-touch-pad__mid">
                <button
                  type="button"
                  className="viewport-touch-btn"
                  onPointerDown={() => injectVirtualInput({ type: 'axis', action: 'Move', x: -1, y: 0 })}
                  onPointerUp={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 0 })}
                  onPointerLeave={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 0 })}
                >◀</button>
                <button
                  type="button"
                  className="viewport-touch-btn"
                  onPointerDown={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 1, y: 0 })}
                  onPointerUp={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 0 })}
                  onPointerLeave={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 0 })}
                >▶</button>
              </div>
              <button
                type="button"
                className="viewport-touch-btn"
                onPointerDown={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: -1 })}
                onPointerUp={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 0 })}
                onPointerLeave={() => injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 0 })}
              >▼</button>
            </div>
            <div className="viewport-touch-pad__actions">
              <button
                type="button"
                className="viewport-touch-btn viewport-touch-btn--round"
                onPointerDown={() => injectVirtualInput({ type: 'actionDown', action: 'Interact' })}
                onPointerUp={() => injectVirtualInput({ type: 'actionUp', action: 'Interact' })}
              >{t('view.interact')}</button>
              <button
                type="button"
                className="viewport-touch-btn viewport-touch-btn--round"
                onPointerDown={() => injectVirtualInput({ type: 'actionDown', action: 'Jump' })}
                onPointerUp={() => injectVirtualInput({ type: 'actionUp', action: 'Jump' })}
              >{t('view.jump')}</button>
            </div>
          </div>
        )}
        {annotateMode && (
          <>
            <canvas
              ref={annotateCanvasRef}
              className="viewport-annotate-canvas"
              onPointerDown={e => {
                const canvas = annotateCanvasRef.current
                if (!canvas) return
                const rect = canvas.getBoundingClientRect()
                const ctx = canvas.getContext('2d')
                if (!ctx) return
                drawingRef.current = true
                ctx.strokeStyle = '#ef4444'
                ctx.lineWidth = 3
                ctx.lineCap = 'round'
                ctx.lineJoin = 'round'
                ctx.beginPath()
                ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
              }}
              onPointerMove={e => {
                if (!drawingRef.current) return
                const canvas = annotateCanvasRef.current
                if (!canvas) return
                const rect = canvas.getBoundingClientRect()
                const ctx = canvas.getContext('2d')
                if (!ctx) return
                ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
                ctx.stroke()
              }}
              onPointerUp={() => { drawingRef.current = false }}
              onPointerLeave={() => { drawingRef.current = false }}
            />
            <div className="viewport-annotate-bar" onPointerDown={e => e.stopPropagation()}>
              <span>{t('view.annotateHint')}</span>
              <button type="button" onClick={clearAnnotation}><Trash2 size={12} />{t('view.annotateClear')}</button>
              <button type="button" className="is-primary" onClick={sendAnnotationToAi}><Send size={12} />{t('view.annotateSend')}</button>
              <button type="button" onClick={() => setAnnotateMode(false)}><X size={12} /></button>
            </div>
          </>
        )}
        {quickPromptOpen && (
          <div className="viewport-quick-prompt" onPointerDown={e => e.stopPropagation()}>
            <div className="viewport-quick-prompt__head">
              <Sparkles size={13} style={{ color: '#c084fc' }} />
              <span>{t('view.aiInline')}</span>
              {selection.slice(0, 3).map(id => nodes[id]).filter(Boolean).map(n => (
                <span key={n.id} className="viewport-quick-prompt__pill">@{n.name}</span>
              ))}
              <button type="button" onClick={() => setQuickPromptOpen(false)}><X size={12} /></button>
            </div>
            <div className="viewport-quick-prompt__row">
              <input
                autoFocus
                value={quickInput}
                placeholder={t('view.aiPlaceholder')}
                onChange={e => setQuickInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && quickInput.trim()) {
                    const text = quickInput.trim()
                    setQuickInput('')
                    setQuickPromptOpen(false)
                    useAgentStore.getState().setPanelOpen(true)
                    void useAgentStore.getState().sendPrompt(text)
                  }
                }}
              />
              <button
                type="button"
                disabled={!quickInput.trim()}
                onClick={() => {
                  const text = quickInput.trim()
                  if (!text) return
                  setQuickInput('')
                  setQuickPromptOpen(false)
                  useAgentStore.getState().setPanelOpen(true)
                  void useAgentStore.getState().sendPrompt(text)
                }}
              >
                <Send size={12} />
              </button>
            </div>
          </div>
        )}
        {warming && warming.total > 0 && (
          <div className="viewport-warm">
            <span>{t('status.warming', { completed: warming.completed, total: warming.total })}</span>
            <div className="viewport-warm__bar"><i style={{ width: `${Math.min(100, (warming.completed / warming.total) * 100)}%` }} /></div>
          </div>
        )}
        <div className="viewport-stats">{t('view.stats', { objects: stats.objects, triangles: stats.triangles.toLocaleString() })}</div>
        {statsOpen && <ViewportStatsDrawer onClose={() => setStatsOpen(false)} />}
        </div>
      </div>
      <ViewCube />
    </div>
  )
}
