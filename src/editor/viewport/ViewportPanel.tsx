import { useEffect, useRef, useState } from 'react'
import { CLIP_MIME, readClipDrag } from '../animation/playback'
import { ASSET_MIME, assignClip, importFiles, placeAsset } from '../assets/import'
import { useI18n, type MessageKey } from '../i18n'
import type { CameraView } from '../scene/types'
import { useAssetStore } from '../assets/library'
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, Axis3d, BarChart3, Box, BoxSelect, ChevronDown, Crosshair, Focus, Globe, Grid3x3, Lightbulb, Magnet, Maximize, Move3d, Route, RotateCcw, Scaling, Scan, Square } from 'lucide-react'
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
  const origin = useEditorStore(state => state.gizmoOrigin)
  const [menu, setMenu] = useState<'view' | 'gizmo' | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const { t } = useI18n()
  const viewName = (id: CameraView) => t(`view.${id}` as MessageKey)

  const viewportRef = useRef<EditorViewport | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const viewport = new EditorViewport(canvas, stage)
    viewportRef.current = viewport
    return () => {
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
      <div
        className="viewport-stage"
        ref={stageRef}
        onDragOver={event => {
          const types = [...event.dataTransfer.types]
          if (types.includes(ASSET_MIME) || types.includes(CLIP_MIME) || types.includes('Files')) event.preventDefault()
        }}
        onDrop={event => {
          const clipDrag = readClipDrag(event.dataTransfer.getData(CLIP_MIME))
          const hit = viewportRef.current?.raycastDrop(event.clientX, event.clientY)
          if (clipDrag && hit?.nodeId) {
            event.preventDefault()
            assignClip(hit.nodeId, clipDrag.assetId, clipDrag.clip)
            return
          }
          const assetId = event.dataTransfer.getData(ASSET_MIME)
          const point = hit?.point ?? [0, 0, 0] as [number, number, number]
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
        <div className="viewport-stats">{t('view.stats', { objects: stats.objects, triangles: stats.triangles.toLocaleString() })}</div>
        {statsOpen && <ViewportStatsDrawer onClose={() => setStatsOpen(false)} />}
      </div>
      <ViewCube />
    </div>
  )
}
