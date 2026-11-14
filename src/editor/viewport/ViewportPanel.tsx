import { useEffect, useRef, useState } from 'react'
import { ASSET_MIME, importFiles, placeAsset } from '../assets/import'
import { savePrefabFromSelection } from '../assets/import'
import { KIND_LABEL, LIGHT_KINDS, MESH_KINDS } from '../scene/kinds'
import type { CameraView, NodeKind } from '../scene/types'
import { useAssetStore } from '../assets/library'
import { ChevronDown, Focus, Grid3x3, Maximize, Move3d, RotateCcw, Scaling, ArrowDownToLine } from 'lucide-react'
import { useEditorStore } from '../scene/store'
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
  const origin = useEditorStore(state => state.gizmoOrigin)
  const [menu, setMenu] = useState<'view' | 'gizmo' | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, id: string | null } | null>(null)

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
                <label><input type="checkbox" checked={origin === 'center'} onChange={() => editor.setGizmoOrigin(origin === 'center' ? 'pivot' : 'center')} /> 手柄在中心</label>
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
          <button type="button" className="viewport-tool-btn" title="贴地" onClick={() => editor.snapSelectionToGround()}><ArrowDownToLine size={12} /></button>
          <button
            type="button"
            className={`viewport-tool-btn viewport-tool-btn--text ${origin === 'center' ? 'viewport-tool-btn--active' : ''}`}
            title={origin === 'center' ? '手柄在包围盒中心' : '手柄在轴心'}
            onClick={() => editor.setGizmoOrigin(origin === 'pivot' ? 'center' : 'pivot')}
          >
            {origin === 'center' ? '中心' : '轴心'}
          </button>
          <button
            type="button"
            className="viewport-tool-btn"
            title="视口全屏"
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
        <button type="button" disabled={playing}>{id ? '创建子物体' : '创建'}</button>
        <div>
          <button type="button" disabled={playing} onClick={() => run(() => create('empty', id))}>空物体</button>
          {MESH_KINDS.map(kind => <button key={kind} type="button" disabled={playing} onClick={() => run(() => create(kind, id))}>{KIND_LABEL[kind]}</button>)}
          {LIGHT_KINDS.map(kind => <button key={kind} type="button" disabled={playing} onClick={() => run(() => create(kind, id))}>{KIND_LABEL[kind]}</button>)}
          <button type="button" disabled={playing} onClick={() => run(() => create('camera', id))}>相机</button>
        </div>
      </div>
      {id && <button type="button" onClick={() => run(() => useEditorStore.getState().requestRename(id))}>重命名</button>}
      {id && <button type="button" onClick={() => run(() => useEditorStore.getState().requestFocus())}>聚焦</button>}
      <button type="button" onClick={() => run(() => useEditorStore.getState().requestFocusAll())}>聚焦全部</button>
      <div className="viewport-context__sep" />
      <button type="button" disabled={playing || !id} onClick={() => run(() => useEditorStore.getState().duplicateSelection())}>就地复制</button>
      <button type="button" disabled={!id} onClick={() => run(() => useEditorStore.getState().copySelection())}>拷贝</button>
      <button type="button" disabled={playing || !canPaste} onClick={() => run(() => useEditorStore.getState().pasteClipboard(null))}>粘贴</button>
      <button type="button" disabled={playing || !canPaste || !id} onClick={() => run(() => useEditorStore.getState().pasteClipboard(id))}>粘贴为子级</button>
      <button type="button" disabled={playing} onClick={() => run(() => useEditorStore.getState().groupSelection())}>成组</button>
      <button type="button" disabled={playing || !id} onClick={() => run(() => useEditorStore.getState().snapSelectionToGround())}>贴地</button>
      <button type="button" disabled={playing || !id} onClick={() => run(() => savePrefabFromSelection())}>存为预制体</button>
      <div className="viewport-context__sep" />
      <button type="button" disabled={playing || !parentId} onClick={() => run(() => { if (id) useEditorStore.getState().reparent(id, null) })}>解除父子</button>
      <button type="button" disabled={playing || !id} onClick={() => run(() => useEditorStore.getState().deleteSelection())}>删除</button>
    </div>
  )
}
