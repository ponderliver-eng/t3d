import { useEffect } from 'react'
import MenuBar from './editor/layout/MenuBar'
import Toolbar from './editor/layout/Toolbar'
import IDELayout from './editor/layout/IDELayout'
import StatusBar from './editor/layout/StatusBar'
import { askNewScene, useEditorStore } from './editor/scene/store'
import { bindProjectAutosave, saveProjectNow } from './editor/assets/project'
import { PreviewHost } from './editor/preview/PreviewHost'
import { isViewportNavigating } from './editor/viewport/cameraControls'
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
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const store = useEditorStore.getState()
      const ctrl = event.ctrlKey || event.metaKey
      if (ctrl && event.code === 'KeyN') {
        event.preventDefault()
        askNewScene()
        return
      }
      if (ctrl && event.code === 'KeyS') {
        event.preventDefault()
        void saveProjectNow().then(() => store.notify('已保存到本地缓存'))
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
        if (event.shiftKey) store.stop()
        else if (store.playState === 'playing') store.pause()
        else store.play()
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

  return (
    <div className="app">
      <MenuBar />
      <Toolbar />
      <div className="app__workspace">
        <IDELayout />
      </div>
      <StatusBar />
      <PreviewHost />
    </div>
  )
}
