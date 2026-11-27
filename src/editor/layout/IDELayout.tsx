import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Actions, DockLocation, Layout, Model, type BorderNode, type ITabSetRenderValues, type TabNode, type TabSetNode } from 'flexlayout-react'
import { Settings } from 'lucide-react'
import 'flexlayout-react/style/dark.css'
import ProjectPanel from '../panels/ProjectPanel'
import HierarchyPanel from '../panels/HierarchyPanel'
import InspectorPanel from '../panels/InspectorPanel'
import ViewportPanel from '../viewport/ViewportPanel'
import ConsolePanel from '../panels/ConsolePanel'
import CutscenePanel from '../panels/CutscenePanel'
import { CutsceneFloatingHost } from '../panels/CutsceneFloatingHost'
import { useCutsceneWindowStore } from '../panels/cutsceneWindowStore'
import HistoryPanel from '../panels/HistoryPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { assetDirectory, useAssetStore } from '../assets/library'
import { useEditorStore } from '../scene/store'
import { useI18n, type MessageKey } from '../i18n'
import { DEFAULT_LAYOUT, LAYOUT_KEY, PANEL, loadLayout, type PanelId } from './layoutConfig'
import { selectTab, T3D_DOCK_CUTSCENE, T3D_LAYOUT_RESET, T3D_SELECT_TAB, T3D_UNDOCK_CUTSCENE } from './events'
import './IDELayout.css'

const PANELS: Record<PanelId, () => ReactElement> = {
  [PANEL.PROJECT]: ProjectPanel,
  [PANEL.SCENE]: HierarchyPanel,
  [PANEL.VIEWPORT]: ViewportPanel,
  [PANEL.CONSOLE]: ConsolePanel,
  [PANEL.CUTSCENE]: () => <CutscenePanel />,
  [PANEL.INSPECTOR]: InspectorPanel,
  [PANEL.HISTORY]: HistoryPanel,
}

const TAB_NAME: Record<string, MessageKey> = {
  'tab-project': 'panel.project',
  'tab-viewport': 'panel.viewport',
  'tab-console': 'panel.console',
  'tab-cutscene': 'panel.cutscene',
  'tab-scene': 'panel.scene',
  'tab-inspector': 'panel.inspector',
  'tab-history': 'panel.history',
}

export default function IDELayout() {
  const { t, lang } = useI18n()
  const activeSceneId = useEditorStore(state => state.activeSceneId)
  const prefabAssetId = useEditorStore(state => state.prefabSession?.assetId ?? '')
  const targetAssetId = prefabAssetId || activeSceneId
  const activeSceneName = useAssetStore(state => (targetAssetId ? state.assets[targetAssetId]?.name ?? '' : ''))
  const [model, setModel] = useState(() => Model.fromJson(loadLayout()))
  const modelRef = useRef(model)
  modelRef.current = model

  useEffect(() => {
    for (const [id, key] of Object.entries(TAB_NAME)) {
      try { modelRef.current.doAction(Actions.renameTab(id, t(key))) } catch { /* 旧布局里可能没有这个页签 */ }
    }
  }, [lang, t])

  useEffect(() => {
    if (modelRef.current.getNodeById('tab-cutscene')) {
      useCutsceneWindowStore.getState().setMode('docked')
    }
  }, [])

  useEffect(() => {
    const onReset = () => {
      localStorage.removeItem(LAYOUT_KEY)
      const fresh = Model.fromJson(DEFAULT_LAYOUT)
      setModel(fresh)
      modelRef.current = fresh
      useCutsceneWindowStore.getState().setMode('closed')
      for (const [id, key] of Object.entries(TAB_NAME)) {
        try { fresh.doAction(Actions.renameTab(id, t(key))) } catch { /* 旧布局里可能没有这个页签 */ }
      }
    }
    const onSelect = (event: Event) => {
      const tabId = (event as CustomEvent<string>).detail
      try {
        modelRef.current.doAction(Actions.selectTab(tabId))
      } catch (error) {
        console.warn('[layout] selectTab failed', tabId, error)
      }
    }
    const onDockCutscene = () => {
      const m = modelRef.current
      const existing = m.getNodeById('tab-cutscene')
      if (existing) {
        try { m.doAction(Actions.selectTab('tab-cutscene')) } catch { /* ignore */ }
        return
      }
      const consoleNode = m.getNodeById('tab-console')
      const targetTabsetId = consoleNode?.getParent()?.getId()
      if (!targetTabsetId) return
      try {
        m.doAction(
          Actions.addNode(
            {
              type: 'tab',
              id: 'tab-cutscene',
              name: t('panel.cutscene'),
              component: PANEL.CUTSCENE,
              enableClose: true,
            },
            targetTabsetId,
            DockLocation.CENTER,
            -1,
            true,
          ),
        )
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(m.toJson()))
      } catch (error) {
        console.warn('[layout] dockCutscene failed', error)
      }
    }
    const onUndockCutscene = () => {
      const m = modelRef.current
      if (!m.getNodeById('tab-cutscene')) return
      try {
        m.doAction(Actions.deleteTab('tab-cutscene'))
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(m.toJson()))
      } catch (error) {
        console.warn('[layout] undockCutscene failed', error)
      }
    }
    window.addEventListener(T3D_LAYOUT_RESET, onReset)
    window.addEventListener(T3D_SELECT_TAB, onSelect)
    window.addEventListener(T3D_DOCK_CUTSCENE, onDockCutscene)
    window.addEventListener(T3D_UNDOCK_CUTSCENE, onUndockCutscene)
    return () => {
      window.removeEventListener(T3D_LAYOUT_RESET, onReset)
      window.removeEventListener(T3D_SELECT_TAB, onSelect)
      window.removeEventListener(T3D_DOCK_CUTSCENE, onDockCutscene)
      window.removeEventListener(T3D_UNDOCK_CUTSCENE, onUndockCutscene)
    }
  }, [t])

  const onModelChange = useCallback((updated: Model, action: { type: string; data?: { tabNode?: string; node?: string } }) => {
    if (action.type === Actions.SELECT_TAB) {
      const tabId = action.data?.tabNode
      if (tabId === 'tab-history') useEditorStore.getState().setSidePanel('history')
      else if (tabId === 'tab-inspector') useEditorStore.getState().setSidePanel('inspector')
    } else if (action.type === Actions.DELETE_TAB) {
      if (action.data?.node === 'tab-cutscene' && useCutsceneWindowStore.getState().mode === 'docked') {
        useCutsceneWindowStore.getState().setMode('closed')
      }
    }
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(updated.toJson()))
  }, [])

  const onRenderTabSet = useCallback((node: TabSetNode | BorderNode, renderValues: ITabSetRenderValues) => {
    const hasSceneTab = node.getChildren().some(child => child.getId() === 'tab-scene')
    if (!hasSceneTab) return
    if (activeSceneName && targetAssetId) {
      renderValues.buttons.push(
        <button
          key="scene-name"
          type="button"
          className="scene-tab__name"
          title={`${activeSceneName}（点击在资源面板定位）`}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation()
            const library = useAssetStore.getState()
            library.setBrowseDir(assetDirectory(targetAssetId, library.assetDirs))
            useEditorStore.setState({ inspectedAssetId: targetAssetId })
            selectTab('tab-project')
          }}
        >
          {activeSceneName}
        </button>,
      )
    }
    renderValues.buttons.push(
      <button
        key="scene-settings"
        type="button"
        className="scene-tab__settings"
        title={t('inspector.sceneSettings')}
        aria-label={t('inspector.sceneSettings')}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation()
          const store = useEditorStore.getState()
          store.setSelection([])
          store.inspectAsset(null)
          selectTab('tab-inspector')
        }}
      >
        <Settings size={13} strokeWidth={2} />
      </button>,
    )
  }, [activeSceneName, t, targetAssetId])

  const factory = useCallback((node: TabNode) => {
    const component = node.getComponent() as PanelId | undefined
    const Panel = component ? PANELS[component] : undefined
    if (!Panel) return <div className="ide-panel-unknown">{t('panel.unknown')}</div>
    return (
      <ErrorBoundary name={node.getName()}>
        <Panel />
      </ErrorBoundary>
    )
  }, [])

  return (
    <div className="ide-layout">
      <Layout model={model} factory={factory} onModelChange={onModelChange} onRenderTabSet={onRenderTabSet} />
      <CutsceneFloatingHost />
    </div>
  )
}
