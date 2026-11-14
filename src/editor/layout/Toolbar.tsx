import { ArrowDownToLine, FilePlus, Grid3x3, History, Magnet, Move3d, Pause, Play, Redo2, RotateCcw, Save, Scaling, Square, Undo2 } from 'lucide-react'
import { saveProjectNow } from '../assets/project'
import { askNewScene, useEditorStore } from '../scene/store'
import { selectTab } from './events'
import './Toolbar.css'

export default function Toolbar() {
  const gizmoMode = useEditorStore(state => state.gizmoMode)
  const gizmoSpace = useEditorStore(state => state.gizmoSpace)
  const snap = useEditorStore(state => state.snap)
  const origin = useEditorStore(state => state.gizmoOrigin)
  const grid = useEditorStore(state => state.gridVisible)
  const playState = useEditorStore(state => state.playState)
  const sidePanel = useEditorStore(state => state.sidePanel)
  const canUndo = useEditorStore(state => (state.past.length > 0 || state.gesture !== null) && state.playState === 'stopped')
  const canRedo = useEditorStore(state => state.future.length > 0 && state.gesture === null && state.playState === 'stopped')
  const undoLabel = useEditorStore(state => state.past[state.past.length - 1]?.label)
  const redoLabel = useEditorStore(state => state.future[state.future.length - 1]?.label)
  const setGizmoMode = useEditorStore(state => state.setGizmoMode)
  const setGizmoSpace = useEditorStore(state => state.setGizmoSpace)

  const showHistory = () => {
    const next = sidePanel === 'history' ? 'inspector' : 'history'
    useEditorStore.getState().setSidePanel(next)
    selectTab(next === 'history' ? 'tab-history' : 'tab-inspector')
  }

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <button type="button" className="toolbar__btn" title="新建场景" onClick={askNewScene}>
          <FilePlus size={14} />
        </button>
        <button
          type="button"
          className="toolbar__btn"
          title="保存到本地缓存"
          onClick={() => { void saveProjectNow().then(() => useEditorStore.getState().notify('已保存到本地缓存')) }}
        >
          <Save size={14} />
        </button>
      </div>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <button type="button" className="toolbar__btn" title={undoLabel ? `撤销 ${undoLabel}` : '撤销'} disabled={!canUndo} onClick={() => useEditorStore.getState().undo()}>
          <Undo2 size={14} />
        </button>
        <button type="button" className="toolbar__btn" title={redoLabel ? `重做 ${redoLabel}` : '重做'} disabled={!canRedo} onClick={() => useEditorStore.getState().redo()}>
          <Redo2 size={14} />
        </button>
      </div>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <button type="button" className={`toolbar__btn ${gizmoMode === 'translate' ? 'toolbar__btn--active' : ''}`} title="移动 (W)" onClick={() => setGizmoMode('translate')}>
          <Move3d size={14} />
        </button>
        <button type="button" className={`toolbar__btn ${gizmoMode === 'rotate' ? 'toolbar__btn--active' : ''}`} title="旋转 (E)" onClick={() => setGizmoMode('rotate')}>
          <RotateCcw size={14} />
        </button>
        <button type="button" className={`toolbar__btn ${gizmoMode === 'scale' ? 'toolbar__btn--active' : ''}`} title="缩放 (R)" onClick={() => setGizmoMode('scale')}>
          <Scaling size={14} />
        </button>
      </div>
      <div className="toolbar__divider" />
      <div className="toolbar__group toolbar__group--segmented">
        <button type="button" className={`toolbar__btn toolbar__btn--segment ${gizmoSpace === 'world' ? 'toolbar__btn--active' : ''}`} onClick={() => setGizmoSpace('world')}>世界</button>
        <button type="button" className={`toolbar__btn toolbar__btn--segment ${gizmoSpace === 'local' ? 'toolbar__btn--active' : ''}`} onClick={() => setGizmoSpace('local')}>局部</button>
      </div>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <button type="button" className={`toolbar__btn ${snap ? 'toolbar__btn--active' : ''}`} title="网格吸附" onClick={() => useEditorStore.getState().toggleSnap()}>
          <Magnet size={14} />
        </button>
        <button type="button" className={`toolbar__btn ${grid ? 'toolbar__btn--active' : ''}`} title="显示网格" onClick={() => useEditorStore.getState().toggleGrid()}>
          <Grid3x3 size={14} />
        </button>
        <button type="button" className="toolbar__btn" title="贴地" disabled={playState !== 'stopped'} onClick={() => useEditorStore.getState().snapSelectionToGround()}>
          <ArrowDownToLine size={14} />
        </button>
        <button
          type="button"
          className={`toolbar__btn ${origin === 'center' ? 'toolbar__btn--active' : ''}`}
          title={origin === 'center' ? '手柄在包围盒中心' : '手柄在轴心'}
          onClick={() => useEditorStore.getState().setGizmoOrigin(origin === 'pivot' ? 'center' : 'pivot')}
        >
          {origin === 'center' ? '中心' : '轴心'}
        </button>
      </div>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <button
          type="button"
          className={`toolbar__btn toolbar__btn--play ${playState === 'playing' ? 'toolbar__btn--playing' : ''}`}
          title={playState === 'playing' ? '暂停 (Ctrl+P)' : '试玩 (Ctrl+P)'}
          onClick={() => {
            const state = useEditorStore.getState()
            if (state.playState === 'playing') state.pause()
            else state.play()
          }}
        >
          {playState === 'playing' ? <Pause size={14} /> : <Play size={14} />}
          <span>{playState === 'playing' ? '暂停' : '试玩'}</span>
        </button>
        <button
          type="button"
          className="toolbar__btn toolbar__btn--stop"
          title="停止 (Ctrl+Shift+P)"
          disabled={playState === 'stopped'}
          onClick={() => useEditorStore.getState().stop()}
        >
          <Square size={12} />
        </button>
      </div>
      <div className="toolbar__spacer" />
      <button
        type="button"
        className={`toolbar__btn ${sidePanel === 'history' ? 'toolbar__btn--active' : ''}`}
        title="历史"
        onClick={showHistory}
      >
        <History size={14} />
      </button>
    </div>
  )
}
