import { useEffect, useRef, useState } from 'react'
import { ASSET_MIME, importFiles, placeAsset } from '../assets/import'
import { useAssetStore } from '../assets/library'
import { ChevronDown, Focus, Grid3x3, Move3d, RotateCcw, Scaling } from 'lucide-react'
import { useEditorStore } from '../scene/store'
import type { CameraView } from '../scene/types'
import { EditorViewport } from './EditorViewport'
import ViewCube from './ViewCube'
import './ViewportPanel.css'

const VIEWS: { id: CameraView; label: string }[] = [
  { id: 'persp', label: '透视' },
  { id: 'top', label: '顶' },
  { id: 'bottom', label: '底' },
  { id: 'front', label: '前' },
  { id: 'back', label: '后' },
  { id: 'left', label: '左' },
  { id: 'right', label: '右' },
]

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
  const [menu, setMenu] = useState<'view' | 'gizmo' | null>(null)

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
        <div className="viewport-tab viewport-tab--active">3D 视口</div>
        <div className="viewport-tabs__spacer" />
        <div className="viewport-tabs__tools">
          <button type="button" className={`viewport-tool-btn ${gizmoMode === 'translate' ? 'viewport-tool-btn--active' : ''}`} title="移动 (W)" onClick={() => editor.setGizmoMode('translate')}><Move3d size={12} /></button>
          <button type="button" className={`viewport-tool-btn ${gizmoMode === 'rotate' ? 'viewport-tool-btn--active' : ''}`} title="旋转 (E)" onClick={() => editor.setGizmoMode('rotate')}><RotateCcw size={12} /></button>
          <button type="button" className={`viewport-tool-btn ${gizmoMode === 'scale' ? 'viewport-tool-btn--active' : ''}`} title="缩放 (R)" onClick={() => editor.setGizmoMode('scale')}><Scaling size={12} /></button>
          <div className="viewport-tool-sep" />
          <button
            type="button"
            className={`viewport-tool-btn viewport-tool-btn--text ${gizmoSpace === 'world' ? 'viewport-tool-btn--active' : ''}`}
            title={gizmoSpace === 'world' ? '世界坐标' : '局部坐标'}
            onClick={() => editor.setGizmoSpace(gizmoSpace === 'world' ? 'local' : 'world')}
          >
            {gizmoSpace === 'world' ? 'W' : 'L'}
          </button>
          <div className="viewport-tool-sep" />
          <div className="viewport-menu">
            <button type="button" className="viewport-tool-btn viewport-tool-btn--text" onPointerDown={event => event.stopPropagation()} onClick={() => setMenu(menu === 'view' ? null : 'view')}>
              {VIEWS.find(item => item.id === view)?.label ?? '透视'} <ChevronDown size={10} />
            </button>
            {menu === 'view' && (
              <div className="viewport-menu__pop" onPointerDown={event => event.stopPropagation()}>
                {VIEWS.map(item => (
                  <button key={item.id} type="button" className={view === item.id ? 'is-active' : ''} onClick={() => { editor.requestView(item.id); setMenu(null) }}>{item.label}</button>
                ))}
                <button type="button" onClick={() => { editor.requestFocus(); setMenu(null) }}>聚焦选中</button>
                <button type="button" onClick={() => { editor.requestFocusAll(); setMenu(null) }}>聚焦全部</button>
              </div>
            )}
          </div>
          <div className="viewport-menu">
            <button type="button" className={`viewport-tool-btn ${grid || helpers ? 'viewport-tool-btn--active' : ''}`} title="辅助显示" onPointerDown={event => event.stopPropagation()} onClick={() => setMenu(menu === 'gizmo' ? null : 'gizmo')}><Grid3x3 size={12} /></button>
            {menu === 'gizmo' && (
              <div className="viewport-menu__pop" onPointerDown={event => event.stopPropagation()}>
                <label><input type="checkbox" checked={grid} onChange={() => editor.toggleGrid()} /> 网格</label>
                <label><input type="checkbox" checked={helpers} onChange={() => editor.setHelpersVisible(!helpers)} /> 灯光和相机</label>
                <label><input type="checkbox" checked={snap} onChange={() => editor.toggleSnap()} /> 吸附</label>
                <label className="viewport-menu__step">
                  步长
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
          <button type="button" className="viewport-tool-btn" title="聚焦选中 (F)" onClick={() => editor.requestFocus()}><Focus size={12} /></button>
        </div>
      </div>
      <div
        className="viewport-stage"
        ref={stageRef}
        onDragOver={event => {
          const types = [...event.dataTransfer.types]
          if (types.includes(ASSET_MIME) || types.includes('Files')) event.preventDefault()
        }}
        onDrop={event => {
          const assetId = event.dataTransfer.getData(ASSET_MIME)
          const hit = viewportRef.current?.raycastDrop(event.clientX, event.clientY)
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
              if (asset?.kind === 'model' || asset?.kind === 'environment') placeAsset(id, point, hit?.nodeId ?? null)
            }
          })
        }}
      >
        <canvas ref={canvasRef} />
        <div className="viewport-stats">{stats.objects} 物体 · {stats.triangles.toLocaleString()} 三角</div>
      </div>
      <ViewCube />
    </div>
  )
}
