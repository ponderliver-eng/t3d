import { useEffect } from 'react'
import MenuBar from './editor/layout/MenuBar'
import Toolbar from './editor/layout/Toolbar'
import IDELayout from './editor/layout/IDELayout'
import StatusBar from './editor/layout/StatusBar'
import { askNewScene, useEditorStore } from './editor/scene/store'
import { useAssetStore } from './editor/assets/library'
import { bindProjectAutosave, notifyProjectSaved, openDirectoryProject, saveProjectNow } from './editor/assets/project'
import { translate } from './editor/i18n'
import SettingsDialog from './editor/prefs/SettingsDialog'
import ProjectSettingsDialog from './editor/project/ProjectSettingsDialog'
import TaxonomyDialogs from './editor/project/TaxonomyDialogs'
import GameplayHubDialog from './editor/project/GameplayHubDialog'
import LibraryDialog from './editor/library/LibraryDialog'
import { usePrefsStore } from './editor/prefs/store'
import { PreviewHost } from './editor/preview/PreviewHost'
import { UiEditor } from './editor/ui/UiEditor'
import { isUiEditorOpen, redoActive, undoActive, useUiEditor } from './editor/ui/session'
import { isViewportNavigating } from './editor/viewport/cameraControls'
import AiWorkbenchPanel from './ai/AiWorkbenchPanel'
import './App.css'

export default function App() {
  useEffect(() => {
    bindProjectAutosave()
  }, [])

  useEffect(() => {
    const blockContext = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea')) return
      event.preventDefault()
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      const store = useEditorStore.getState()
      const ctrl = event.ctrlKey || event.metaKey
      if (store.playState !== 'stopped') {
        if (ctrl && event.code === 'KeyP') {
          event.preventDefault()
          if (event.shiftKey) store.stop()
          else if (store.playState === 'playing') store.pause()
          else store.play()
        } else if (!ctrl && !event.altKey && !event.metaKey) {
          event.preventDefault()
        }
        return
      }
      if (ctrl && event.code === 'KeyN') {
        event.preventDefault()
        askNewScene()
        return
      }
      if (ctrl && event.code === 'Comma') {
        event.preventDefault()
        usePrefsStore.getState().openSettings()
        return
      }
      if (ctrl && event.code === 'KeyO') {
        event.preventDefault()
        if (store.playState === 'stopped') void openDirectoryProject()
        return
      }
      if (ctrl && event.code === 'KeyS') {
        event.preventDefault()
        void saveProjectNow().then(() => notifyProjectSaved()).catch(error => {
          store.log('error', translate('log.projectFailed', { message: error instanceof Error ? error.message : String(error) }))
        })
        return
      }
      if (isUiEditorOpen()) {
        if (ctrl && event.code === 'KeyZ' && !event.shiftKey) {
          event.preventDefault()
          undoActive()
          return
        }
        if (ctrl && (event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey))) {
          event.preventDefault()
          redoActive()
          return
        }
        if (event.code === 'Escape') {
          event.preventDefault()
          useUiEditor.getState().close()
        }
        if (event.code === 'Delete' || event.code === 'Backspace') {
          event.preventDefault()
          useUiEditor.getState().removeSelected()
        }
        return
      }
      if (ctrl && event.code === 'KeyZ' && !event.shiftKey) {
        event.preventDefault()
        store.undo()
        return
      }
      if (ctrl && (event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey))) {
        event.preventDefault()
        store.redo()
        return
      }
      if (ctrl && event.code === 'KeyD') {
        event.preventDefault()
        store.duplicateSelection()
        return
      }
      if (ctrl && event.code === 'KeyC') {
        event.preventDefault()
        store.copySelection()
        return
      }
      if (ctrl && event.code === 'KeyV') {
        event.preventDefault()
        store.pasteClipboard(null)
        return
      }
      if (ctrl && event.code === 'KeyG') {
        event.preventDefault()
        store.groupSelection()
        return
      }
      if (ctrl && event.code === 'KeyA') {
        event.preventDefault()
        store.selectAll()
        return
      }
      if (ctrl && event.code === 'KeyP') {
        event.preventDefault()
        store.play()
        return
      }
      if (event.code === 'Delete') {
        event.preventDefault()
        store.deleteSelection()
        return
      }
      if (event.code === 'Escape') {
        store.setSelection([])
        return
      }
      if (event.code === 'KeyF' && event.shiftKey && !event.altKey && !event.metaKey && !isViewportNavigating() && store.playState === 'stopped') {
        event.preventDefault()
        if (event.ctrlKey) store.alignCameraToView()
        else store.alignViewToCamera()
        return
      }
      if (ctrl || event.altKey || event.metaKey || event.shiftKey) return
      if (isViewportNavigating()) return
      if (event.code === 'KeyW') store.setGizmoMode('translate')
      if (event.code === 'KeyE') store.setGizmoMode('rotate')
      if (event.code === 'KeyR') store.setGizmoMode('scale')
      if (event.code === 'KeyF') store.requestFocus()
    }
    window.addEventListener('contextmenu', blockContext)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('contextmenu', blockContext)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const prefabSession = useEditorStore(state => state.prefabSession)
  const prefabName = useAssetStore(state => prefabSession ? state.assets[prefabSession.assetId]?.name : '')
  return (
    <div className="app">
      <MenuBar />
      <Toolbar />
      {prefabSession && (
        <div className="prefab-bar">
          <span>{translate('prefab.editing', { name: prefabName || '' })}</span>
          <span>
            <button type="button" onClick={() => useEditorStore.getState().closePrefab(false)}>{translate('prefab.discard')}</button>
            <button type="button" onClick={() => useEditorStore.getState().closePrefab(true)}>{translate('prefab.saveBack')}</button>
          </span>
        </div>
      )}
      <div className="app__workspace">
        <IDELayout />
        <AiWorkbenchPanel />
        <UiEditor />
      </div>
      <StatusBar />
      <PreviewHost />
      <SettingsDialog />
      <ProjectSettingsDialog />
      <TaxonomyDialogs />
      <GameplayHubDialog />
      <LibraryDialog />
    </div>
  )
}

