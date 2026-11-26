import { ArrowDownToLine, Axis3d, BookOpen, BoxSelect, Check, Crosshair, FileDown, FilePlus, Film, GitBranch, Globe, Grid3x3, History, Library, Magnet, Move3d, Package, Pause, Play, Redo2, RotateCcw, Save, Scaling, Activity, Sparkles, Square, Undo2 } from 'lucide-react'
import { useAgentStore } from '../../ai/agentLoop'
import { useManagerModalStore } from '../../core/project/ProjectManagerModal'
import { saveProjectNow } from '../assets/project'
import { translate, useI18n } from '../i18n'
import { useCutsceneWindowStore } from '../panels/cutsceneWindowStore'
import { askNewScene, useEditorStore } from '../scene/store'
import { redoActive, undoActive, useUiEditor } from '../ui/session'
import { selectTab } from './events'
import './Toolbar.css'

export default function Toolbar() {
  const gizmoMode = useEditorStore(state => state.gizmoMode)
  const gizmoSpace = useEditorStore(state => state.gizmoSpace)
  const snap = useEditorStore(state => state.snap)
  const origin = useEditorStore(state => state.gizmoOrigin)
  const grid = useEditorStore(state => state.gridVisible)
  const playState = useEditorStore(state => state.playState)
  const playDirty = useEditorStore(state => state.playDirty)
  const sidePanel = useEditorStore(state => state.sidePanel)
  const aiPanelOpen = useAgentStore(state => state.panelOpen)
  const cutsceneMode = useCutsceneWindowStore(state => state.mode)
  const toggleAiPanel = () => useAgentStore.getState().setPanelOpen(!aiPanelOpen)
  const sceneUndo = useEditorStore(state => (state.past.length > 0 || state.gesture !== null) && state.playState === 'stopped')
  const sceneRedo = useEditorStore(state => state.future.length > 0 && state.gesture === null && state.playState === 'stopped')
  const uiUndo = useUiEditor(state => state.assetId !== null && state.past.length > 0)
  const uiRedo = useUiEditor(state => state.assetId !== null && state.future.length > 0)
  const uiOpen = useUiEditor(state => state.assetId !== null)
  const canUndo = uiOpen ? uiUndo : sceneUndo
  const canRedo = uiOpen ? uiRedo : sceneRedo
  const undoLabel = useEditorStore(state => state.past[state.past.length - 1]?.label)
  const redoLabel = useEditorStore(state => state.future[state.future.length - 1]?.label)
  const setGizmoMode = useEditorStore(state => state.setGizmoMode)
  const setGizmoSpace = useEditorStore(state => state.setGizmoSpace)
  const { t } = useI18n()

  const showHistory = () => {
    const next = sidePanel === 'history' ? 'inspector' : 'history'
    useEditorStore.getState().setSidePanel(next)
    selectTab(next === 'history' ? 'tab-history' : 'tab-inspector')
  }

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <button type="button" className="toolbar__btn" title={t('tool.newScene')} onClick={askNewScene}>
          <FilePlus size={14} />
        </button>
        <button
          type="button"
          className="toolbar__btn"
          title={t('tool.save')}
          onClick={() => { void saveProjectNow().then(() => useEditorStore.getState().notify(translate('menu.saved'))) }}
        >
          <Save size={14} />
        </button>
      </div>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <button type="button" className="toolbar__btn" title={undoLabel ? `${t('tool.undo')} ${undoLabel}` : t('tool.undo')} disabled={!canUndo} onClick={undoActive}>
          <Undo2 size={14} />
        </button>
        <button type="button" className="toolbar__btn" title={redoLabel ? `${t('tool.redo')} ${redoLabel}` : t('tool.redo')} disabled={!canRedo} onClick={redoActive}>
          <Redo2 size={14} />
        </button>
      </div>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <button type="button" className={`toolbar__btn ${gizmoMode === 'translate' ? 'toolbar__btn--active' : ''}`} title={t('tool.move')} onClick={() => setGizmoMode('translate')}>
          <Move3d size={14} />
        </button>
        <button type="button" className={`toolbar__btn ${gizmoMode === 'rotate' ? 'toolbar__btn--active' : ''}`} title={t('tool.rotate')} onClick={() => setGizmoMode('rotate')}>
          <RotateCcw size={14} />
        </button>
        <button type="button" className={`toolbar__btn ${gizmoMode === 'scale' ? 'toolbar__btn--active' : ''}`} title={t('tool.scale')} onClick={() => setGizmoMode('scale')}>
          <Scaling size={14} />
        </button>
      </div>
      <div className="toolbar__divider" />
      <div className="toolbar__group toolbar__group--segmented">
        <button type="button" className={`toolbar__btn toolbar__btn--segment ${gizmoSpace === 'world' ? 'toolbar__btn--active' : ''}`} title={t('tool.world')} aria-label={t('tool.world')} onClick={() => setGizmoSpace('world')}><Globe size={14} /></button>
        <button type="button" className={`toolbar__btn toolbar__btn--segment ${gizmoSpace === 'local' ? 'toolbar__btn--active' : ''}`} title={t('tool.local')} aria-label={t('tool.local')} onClick={() => setGizmoSpace('local')}><Axis3d size={14} /></button>
      </div>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <button type="button" className={`toolbar__btn ${snap ? 'toolbar__btn--active' : ''}`} title={t('tool.snap')} onClick={() => useEditorStore.getState().toggleSnap()}>
          <Magnet size={14} />
        </button>
        <button type="button" className={`toolbar__btn ${grid ? 'toolbar__btn--active' : ''}`} title={t('tool.grid')} onClick={() => useEditorStore.getState().toggleGrid()}>
          <Grid3x3 size={14} />
        </button>
        <button type="button" className="toolbar__btn" title={t('tool.ground')} disabled={playState !== 'stopped'} onClick={() => useEditorStore.getState().snapSelectionToGround()}>
          <ArrowDownToLine size={14} />
        </button>
        <button
          type="button"
          className={`toolbar__btn ${origin === 'center' ? 'toolbar__btn--active' : ''}`}
          title={origin === 'center' ? t('tool.originCenter') : t('tool.originPivot')}
          aria-label={origin === 'center' ? t('tool.center') : t('tool.pivot')}
          onClick={() => useEditorStore.getState().setGizmoOrigin(origin === 'pivot' ? 'center' : 'pivot')}
        >
          {origin === 'center' ? <BoxSelect size={14} /> : <Crosshair size={14} />}
        </button>
      </div>
      <div className="toolbar__divider" />
      <div className="toolbar__group">
        <button
          type="button"
          className={`toolbar__btn toolbar__btn--play ${playState === 'playing' ? 'toolbar__btn--playing' : ''}`}
          title={playState === 'playing' ? t('tool.pause') : t('tool.play')}
          onClick={event => {
            event.currentTarget.blur()
            const state = useEditorStore.getState()
            if (state.playState === 'playing') state.pause()
            else state.play()
          }}
        >
          {playState === 'playing' ? <Pause size={14} /> : <Play size={14} />}
          <span>{playState === 'playing' ? t('tool.pauseLabel') : t('tool.playLabel')}</span>
        </button>
        <button
          type="button"
          className="toolbar__btn toolbar__btn--stop"
          title={t('tool.stop')}
          disabled={playState === 'stopped'}
          onClick={event => {
            event.currentTarget.blur()
            useEditorStore.getState().stop()
          }}
        >
          <Square size={12} />
        </button>
        {playState !== 'stopped' && (
          <button
            type="button"
            className={`toolbar__btn toolbar__btn--keep ${playDirty ? 'toolbar__btn--keep-dirty' : ''}`}
            title={t('tool.keepPlayChanges')}
            disabled={!playDirty}
            onClick={() => useEditorStore.getState().keepPlayChanges()}
          >
            <Check size={13} />
            <span>{t('inspector.keepPlayChanges')}</span>
          </button>
        )}
      </div>
      <div className="toolbar__spacer" />
      <button
        type="button"
        className="toolbar__btn"
        title={t('tool.designTip')}
        onClick={() => useManagerModalStore.getState().openModal('design')}
      >
        <BookOpen size={14} />
        <span>{t('tool.design')}</span>
      </button>
      <button
        type="button"
        className="toolbar__btn"
        title={t('tool.packsTip')}
        onClick={() => useManagerModalStore.getState().openModal('packs')}
      >
        <Package size={14} />
        <span>{t('tool.packs')}</span>
      </button>
      <button
        type="button"
        className="toolbar__btn"
        title={t('tool.branchesTip')}
        onClick={() => useManagerModalStore.getState().openModal('branches')}
      >
        <GitBranch size={14} />
        <span>{t('tool.branches')}</span>
      </button>
      <button
        type="button"
        className="toolbar__btn"
        title={t('tool.diagnoseTip')}
        onClick={() => useManagerModalStore.getState().openModal('diagnose')}
      >
        <Activity size={14} />
        <span>{t('tool.diagnose')}</span>
      </button>
      <button
        type="button"
        className="toolbar__btn"
        title={t('tool.publishTip')}
        onClick={() => useManagerModalStore.getState().openModal('publish')}
      >
        <FileDown size={14} />
        <span>{t('tool.publish')}</span>
      </button>
      <button
        type="button"
        className={`toolbar__btn ${cutsceneMode !== 'closed' ? 'toolbar__btn--active' : ''}`}
        title="过场时间轴编辑器（独立窗口 / 底部停靠）"
        onClick={() => useCutsceneWindowStore.getState().toggle()}
      >
        <Film size={14} />
        <span>过场</span>
      </button>
      <button
        type="button"
        className={`toolbar__btn ${aiPanelOpen ? 'toolbar__btn--active' : ''}`}
        title={t('tool.aiTip')}
        onClick={toggleAiPanel}
      >
        <Sparkles size={14} />
        <span>{t('tool.ai')}</span>
      </button>
      <button
        type="button"
        className="toolbar__btn toolbar__btn--library"
        title={t('library.title')}
        onClick={() => useEditorStore.getState().setLibraryOpen(true)}
      >
        <Library size={14} />
        <span>{t('library.title')}</span>
      </button>
      <button
        type="button"
        className={`toolbar__btn ${sidePanel === 'history' ? 'toolbar__btn--active' : ''}`}
        title={t('tool.history')}
        onClick={showHistory}
      >
        <History size={14} />
      </button>
    </div>
  )
}
