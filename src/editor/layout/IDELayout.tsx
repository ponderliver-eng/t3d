import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Actions, Layout, Model, type TabNode } from 'flexlayout-react'
import 'flexlayout-react/style/dark.css'
import ProjectPanel from '../panels/ProjectPanel'
import HierarchyPanel from '../panels/HierarchyPanel'
import InspectorPanel from '../panels/InspectorPanel'
import ViewportPanel from '../viewport/ViewportPanel'
import ConsolePanel from '../panels/ConsolePanel'
import HistoryPanel from '../panels/HistoryPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { useEditorStore } from '../scene/store'
import { DEFAULT_LAYOUT, LAYOUT_KEY, PANEL, loadLayout, type PanelId } from './layoutConfig'
import { T3D_LAYOUT_RESET, T3D_SELECT_TAB } from './events'
import './IDELayout.css'

const PANELS: Record<PanelId, () => ReactElement> = {
  [PANEL.PROJECT]: ProjectPanel,
  [PANEL.SCENE]: HierarchyPanel,
  [PANEL.VIEWPORT]: ViewportPanel,
  [PANEL.CONSOLE]: ConsolePanel,
  [PANEL.INSPECTOR]: InspectorPanel,
  [PANEL.HISTORY]: HistoryPanel,
}

export default function IDELayout() {
  const [model, setModel] = useState(() => Model.fromJson(loadLayout()))
  const modelRef = useRef(model)
  modelRef.current = model

  useEffect(() => {
    const onReset = () => {
      localStorage.removeItem(LAYOUT_KEY)
      const fresh = Model.fromJson(DEFAULT_LAYOUT)
      setModel(fresh)
      modelRef.current = fresh
    }
    const onSelect = (event: Event) => {
      const tabId = (event as CustomEvent<string>).detail
      try {
        modelRef.current.doAction(Actions.selectTab(tabId))
      } catch (error) {
        console.warn('[layout] selectTab failed', tabId, error)
      }
    }
    window.addEventListener(T3D_LAYOUT_RESET, onReset)
    window.addEventListener(T3D_SELECT_TAB, onSelect)
    return () => {
      window.removeEventListener(T3D_LAYOUT_RESET, onReset)
      window.removeEventListener(T3D_SELECT_TAB, onSelect)
    }
  }, [])

  const onModelChange = useCallback((updated: Model, action: { type: string; data?: { tabNode?: string } }) => {
    if (action.type === Actions.SELECT_TAB) {
      const tabId = action.data?.tabNode
      if (tabId === 'tab-history') useEditorStore.getState().setSidePanel('history')
      else if (tabId === 'tab-inspector') useEditorStore.getState().setSidePanel('inspector')
    }
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(updated.toJson()))
  }, [])

  const factory = useCallback((node: TabNode) => {
    const component = node.getComponent() as PanelId | undefined
    const Panel = component ? PANELS[component] : undefined
    if (!Panel) return <div className="ide-panel-unknown">未知面板</div>
    return (
      <ErrorBoundary name={node.getName()}>
        <Panel />
      </ErrorBoundary>
    )
  }, [])

  return (
    <div className="ide-layout">
      <Layout model={model} factory={factory} onModelChange={onModelChange} />
    </div>
  )
}
