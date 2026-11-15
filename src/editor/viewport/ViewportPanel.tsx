import { useEffect, useRef, useState } from 'react'
import { CLIP_MIME, readClipDrag } from '../animation/playback'
import { ASSET_MIME, assignClip, importFiles, placeAsset } from '../assets/import'
import { savePrefabFromSelection } from '../assets/import'
import { useI18n, type MessageKey } from '../i18n'
import { LIGHT_KINDS, MESH_KINDS } from '../scene/kinds'
import type { CameraView, NodeKind } from '../scene/types'
import { useAssetStore } from '../assets/library'
import { BarChart3, ChevronDown, Focus, Grid3x3, Maximize, Move3d, RotateCcw, Scaling, ArrowDownToLine } from 'lucide-react'
import { useEditorStore } from '../scene/store'
import { EditorViewport } from './EditorViewport'
import ViewCube from './ViewCube'
import { ViewportStatsDrawer } from './ViewportStatsDrawer'
import { PlayUiOverlay } from '../ui/PlayUiOverlay'
import './ViewportPanel.css'

const VIEWS: CameraView[] = ['persp', 'top', 'bottom', 'front', 'back', 'left', 'right']

export default function ViewportPanel() {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playState = useEditorStore(state => state.playState)
  const gizmoMode = useEditorStore(state => state.gizmoMode)
  const gizmoSpace = useEditorStore(state => state.gizmoSpace)
  const grid = useEditorStore(state => state.gridVisible)
  const helpers = useEditorStore(state => state.helpersVisible)
  const snap = useEditorStore(state => state.snap)
  const snapStep = useEditorStore(state => state.snapStep)
  const stats = useEditorStore(state => state.viewportStats)
  const view = useEditorStore(state => state.cameraView)
  const origin = useEditorStore(state => state.gizmoOrigin)
  const [menu, setMenu] = useState<'view' | 'gizmo' | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, id: string | null } | null>(null)
  const { t } = useI18n()
  const viewName = (id: CameraView) => t(`view.${id}` as MessageKey)

  const viewportRef = useRef<EditorViewport | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const viewport = new EditorViewport(canvas, stage)
    viewport.setContextHandler((x, y, id) => setContextMenu({ x, y, id }))
    viewportRef.current = viewport
    return () => {
      viewportRef.current = null
      viewport.dispose()
    }
  }, [])

  useEffect(() => {
    if (!menu && !contextMenu) return
    const close = () => {
      setMenu(null)
      setContextMenu(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu, contextMenu])

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
            className={`viewport-tool-btn viewport-tool-btn--text ${gizmoSpace === 'world' ? 'viewport-tool-btn--active' : ''}`}
            title={gizmoSpace === 'world' ? t('view.world') : t('view.local')}
            onClick={() => editor.setGizmoSpace(gizmoSpace === 'world' ? 'local' : 'world')}
          >
            {gizmoSpace === 'world' ? 'W' : 'L'}
          </button>
          <div className="viewport-tool-sep" />
          <div className="viewport-menu">
            <button type="button" className="viewport-tool-btn viewport-tool-btn--text" onPointerDown={event => event.stopPropagation()} onClick={() => setMenu(menu === 'view' ? null : 'view')}>
              {viewName(view)} <ChevronDown size={10} />
            </button>
            {menu === 'view' && (
              <div className="viewport-menu__pop" onPointerDown={event => event.stopPropagation()}>
                {VIEWS.map(item => (
                  <button key={item} type="button" className={view === item ? 'is-active' : ''} onClick={() => { editor.requestView(item); setMenu(null) }}>{viewName(item)}</button>
                ))}
                <button type="button" onClick={() => { editor.requestFocus(); setMenu(null) }}>{t('menu.focus')}</button>
                <button type="button" onClick={() => { editor.requestFocusAll(); setMenu(null) }}>{t('menu.focusAll')}</button>
              </div>
            )}
          </div>
          <div className="viewport-menu">
            <button type="button" className={`viewport-tool-btn ${grid || helpers ? 'viewport-tool-btn--active' : ''}`} title={t('view.helpers')} onPointerDown={event => event.stopPropagation()} onClick={() => setMenu(menu === 'gizmo' ? null : 'gizmo')}><Grid3x3 size={12} /></button>
            {menu === 'gizmo' && (
              <div className="viewport-menu__pop" onPointerDown={event => event.stopPropagation()}>
                <label><input type="checkbox" checked={grid} onChange={() => editor.toggleGrid()} /> {t('view.grid')}</label>
                <label><input type="checkbox" checked={helpers} onChange={() => editor.setHelpersVisible(!helpers)} /> {t('view.lights')}</label>
                <label><input type="checkbox" checked={origin === 'center'} onChange={() => editor.setGizmoOrigin(origin === 'center' ? 'pivot' : 'center')} /> {t('view.gizmoCenter')}</label>
                <label><input type="checkbox" checked={snap} onChange={() => editor.toggleSnap()} /> {t('view.snap')}</label>
                <label className="viewport-menu__step">
                  {t('view.step')}
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
            className={`viewport-tool-btn viewport-tool-btn--text ${origin === 'center' ? 'viewport-tool-btn--active' : ''}`}
            title={origin === 'center' ? t('tool.originCenter') : t('tool.originPivot')}
            onClick={() => editor.setGizmoOrigin(origin === 'pivot' ? 'center' : 'pivot')}
          >
            {origin === 'center' ? t('tool.center') : t('tool.pivot')}
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
      {contextMenu && (
        <ViewportContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          id={contextMenu.id}
          playing={playState !== 'stopped'}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

function ViewportContextMenu({
  x, y, id, playing, onClose,
}: {
  x: number
  y: number
  id: string | null
  playing: boolean
  onClose: () => void
}) {
  const canPaste = useEditorStore(state => state.canPaste)
  const { t } = useI18n()
  const kindName = (kind: NodeKind) => t(`kind.${kind}` as MessageKey)
  const parentId = useEditorStore(state => id ? state.nodes[id]?.parentId : null)
  const run = (action: () => void) => {
    action()
    onClose()
  }
  const create = (kind: NodeKind, parent: string | null) => {
    useEditorStore.getState().createNode(kind, parent)
  }
  return (
    <div className="viewport-context" style={{ left: x, top: y }} onPointerDown={event => event.stopPropagation()}>
      <div className="viewport-context__sub">
        <button type="button" disabled={playing}>{id ? t('view.createChild') : t('view.create')}</button>
        <div>
          <button type="button" disabled={playing} onClick={() => run(() => create('empty', id))}>{t('menu.empty')}</button>
          <div className="viewport-context__label">{t('menu.meshes')}</div>
          {MESH_KINDS.map(kind => <button key={kind} type="button" disabled={playing} onClick={() => run(() => create(kind, id))}>{kindName(kind)}</button>)}
          <div className="viewport-context__label">{t('menu.lights')}</div>
          {LIGHT_KINDS.map(kind => <button key={kind} type="button" disabled={playing} onClick={() => run(() => create(kind, id))}>{kindName(kind)}</button>)}
          <button type="button" disabled={playing} onClick={() => run(() => create('camera', id))}>{t('menu.camera')}</button>
          <button type="button" disabled={playing} onClick={() => run(() => create('effect', id))}>{t('menu.effect')}</button>
          <button type="button" disabled={playing} onClick={() => run(() => create('screen', id))}>{t('menu.screen')}</button>
        </div>
      </div>
      {id && <button type="button" onClick={() => run(() => useEditorStore.getState().requestRename(id))}>{t('project.rename')}</button>}
      {id && <button type="button" onClick={() => run(() => useEditorStore.getState().requestFocus())}>{t('menu.focus')}</button>}
      <button type="button" onClick={() => run(() => useEditorStore.getState().requestFocusAll())}>{t('menu.focusAll')}</button>
      <div className="viewport-context__sep" />
      <button type="button" disabled={playing || !id} onClick={() => run(() => useEditorStore.getState().duplicateSelection())}>{t('menu.duplicate')}</button>
      <button type="button" disabled={!id} onClick={() => run(() => useEditorStore.getState().copySelection())}>{t('menu.copy')}</button>
      <button type="button" disabled={playing || !canPaste} onClick={() => run(() => useEditorStore.getState().pasteClipboard(null))}>{t('view.paste')}</button>
      <button type="button" disabled={playing || !canPaste || !id} onClick={() => run(() => useEditorStore.getState().pasteClipboard(id))}>{t('hierarchy.pasteChild')}</button>
      <button type="button" disabled={playing} onClick={() => run(() => useEditorStore.getState().groupSelection())}>{t('menu.group')}</button>
      <button type="button" disabled={playing || !id} onClick={() => run(() => useEditorStore.getState().snapSelectionToGround())}>{t('menu.ground')}</button>
      <button type="button" disabled={playing || !id} onClick={() => run(() => savePrefabFromSelection())}>{t('inspector.savePrefab')}</button>
      <div className="viewport-context__sep" />
      <button type="button" disabled={playing || !parentId} onClick={() => run(() => { if (id) useEditorStore.getState().reparent(id, null) })}>{t('hierarchy.unparent')}</button>
      <button type="button" disabled={playing || !id} onClick={() => run(() => useEditorStore.getState().deleteSelection())}>{t('menu.delete')}</button>
    </div>
  )
}
