import { useAssetStore } from '../assets/library'
import { primaryId, useEditorStore } from '../scene/store'
import './StatusBar.css'

const GIZMO_LABEL = { translate: '移动', rotate: '旋转', scale: '缩放' } as const

export default function StatusBar() {
  const count = useEditorStore(state => Object.keys(state.nodes).length)
  const selection = useEditorStore(state => state.selection)
  const nodes = useEditorStore(state => state.nodes)
  const playState = useEditorStore(state => state.playState)
  const projection = useEditorStore(state => state.projectionLabel)
  const gizmoMode = useEditorStore(state => state.gizmoMode)
  const gizmoSpace = useEditorStore(state => state.gizmoSpace)
  const snap = useEditorStore(state => state.snap)
  const snapStep = useEditorStore(state => state.snapStep)
  const origin = useEditorStore(state => state.gizmoOrigin)
  const notice = useEditorStore(state => state.notice)
  const activeSceneId = useEditorStore(state => state.activeSceneId)
  const sceneName = useAssetStore(state => {
    const asset = state.assets[activeSceneId]
    return asset?.kind === 'scene' ? asset.name : '未命名场景'
  })
  const primary = primaryId({ selection })
  const selectedName = primary ? nodes[primary]?.name : null

  return (
    <div className="statusbar">
      <span className="statusbar__item">T3D</span>
      <span className="statusbar__sep" />
      <span className="statusbar__item statusbar__item--project">{sceneName}</span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">{useEditorStore(state => state.renderBackend)}</span>
      <span className="statusbar__sep" />
      {playState === 'playing' && <span className="statusbar__item statusbar__item--play">● 试玩中</span>}
      {playState === 'paused' && <span className="statusbar__item statusbar__item--pause">● 已暂停</span>}
      {playState === 'stopped' && <span className="statusbar__item statusbar__item--ready">● 就绪</span>}
      {notice && (
        <>
          <span className="statusbar__sep" />
          <span className="statusbar__item statusbar__item--notice">{notice}</span>
        </>
      )}
      <span className="statusbar__spacer" />
      <span className="statusbar__item">物体 {count}</span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">
        {selection.length === 0 ? '未选择' : selection.length === 1 ? selectedName : `已选 ${selection.length} 个`}
      </span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">{projection}</span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">{GIZMO_LABEL[gizmoMode]} · {gizmoSpace === 'world' ? '世界' : '局部'} · {origin === 'center' ? '中心' : '轴心'}</span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">{snap ? `吸附 ${snapStep}` : '吸附关'}</span>
    </div>
  )
}
