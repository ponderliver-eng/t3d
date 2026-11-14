import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { askNewScene, useEditorStore } from '../scene/store'
import { KIND_LABEL, LIGHT_KINDS, MESH_KINDS } from '../scene/kinds'
import { openImport } from '../assets/import'
import { saveProjectNow } from '../assets/project'
import { resetLayout } from './events'
import type { CameraView, NodeKind } from '../scene/types'
import './MenuBar.css'

export default function MenuBar() {
  const playing = useEditorStore(state => state.playState !== 'stopped')
  const grid = useEditorStore(state => state.gridVisible)
  const snap = useEditorStore(state => state.snap)
  const canUndo = useEditorStore(state => state.past.length > 0 || state.gesture !== null)
  const canRedo = useEditorStore(state => state.future.length > 0 && state.gesture === null)
  const hasSelection = useEditorStore(state => state.selection.length > 0)
  const canPaste = useEditorStore(state => state.canPaste)

  const create = (kind: NodeKind) => useEditorStore.getState().createNode(kind)
  const view = (next: CameraView) => useEditorStore.getState().requestView(next)

  return (
    <div className="menubar">
      <div className="menubar__logo">T3D</div>
      <div className="menubar__items">
        <Dropdown label="文件">
          <Item onClick={askNewScene}>新建场景<span className="menubar__hint">Ctrl+N</span></Item>
          <Item onClick={() => { void saveProjectNow().then(() => useEditorStore.getState().notify('已保存到本地缓存')) }}>保存<span className="menubar__hint">Ctrl+S</span></Item>
          <Item onClick={openImport}>导入资源</Item>
        </Dropdown>
        <Dropdown label="编辑">
          <Item disabled={playing || !canUndo} onClick={() => useEditorStore.getState().undo()}>撤销<span className="menubar__hint">Ctrl+Z</span></Item>
          <Item disabled={playing || !canRedo} onClick={() => useEditorStore.getState().redo()}>重做<span className="menubar__hint">Ctrl+Y</span></Item>
          <Sep />
          <Item disabled={playing || !hasSelection} onClick={() => useEditorStore.getState().duplicateSelection()}>就地复制<span className="menubar__hint">Ctrl+D</span></Item>
          <Item disabled={playing || !hasSelection} onClick={() => useEditorStore.getState().copySelection()}>拷贝<span className="menubar__hint">Ctrl+C</span></Item>
          <Item disabled={playing || !canPaste} onClick={() => useEditorStore.getState().pasteClipboard(null)}>粘贴<span className="menubar__hint">Ctrl+V</span></Item>
          <Item disabled={playing || !hasSelection} onClick={() => useEditorStore.getState().groupSelection()}>成组<span className="menubar__hint">Ctrl+G</span></Item>
          <Item disabled={playing || !hasSelection} onClick={() => useEditorStore.getState().snapSelectionToGround()}>贴地</Item>
          <Item disabled={playing || !hasSelection} onClick={() => useEditorStore.getState().deleteSelection()}>删除<span className="menubar__hint">Del</span></Item>
          <Item onClick={() => useEditorStore.getState().selectAll()}>全选<span className="menubar__hint">Ctrl+A</span></Item>
        </Dropdown>
        <Dropdown label="创建">
          <Item disabled={playing} onClick={() => create('empty')}>空物体</Item>
          <Submenu label="几何体">
            {MESH_KINDS.map(kind => (
              <Item key={kind} disabled={playing} onClick={() => create(kind)}>{KIND_LABEL[kind]}</Item>
            ))}
          </Submenu>
          <Submenu label="灯光">
            {LIGHT_KINDS.map(kind => (
              <Item key={kind} disabled={playing} onClick={() => create(kind)}>{KIND_LABEL[kind]}</Item>
            ))}
          </Submenu>
          <Item disabled={playing} onClick={() => create('camera')}>相机</Item>
        </Dropdown>
        <Dropdown label="视图">
          <Item disabled={!hasSelection} onClick={() => useEditorStore.getState().requestFocus()}>聚焦选中<span className="menubar__hint">F</span></Item>
          <Sep />
          <Item onClick={() => view('top')}>顶视图</Item>
          <Item onClick={() => view('front')}>前视图</Item>
          <Item onClick={() => view('right')}>侧视图</Item>
          <Item onClick={() => view('persp')}>透视</Item>
          <Item onClick={() => view('bottom')}>底视图</Item>
          <Item onClick={() => view('back')}>后视图</Item>
          <Item onClick={() => view('left')}>左视图</Item>
          <Item onClick={() => useEditorStore.getState().requestFocusAll()}>聚焦全部</Item>
          <Sep />
          <Item onClick={() => useEditorStore.getState().toggleGrid()}>{grid ? '✓ ' : ''}显示网格</Item>
          <Item onClick={() => useEditorStore.getState().toggleSnap()}>{snap ? '✓ ' : ''}网格吸附</Item>
          <Sep />
          <Item onClick={resetLayout}>重置布局</Item>
        </Dropdown>
      </div>
    </div>
  )
}

function Dropdown({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menubar__dropdown" ref={rootRef}>
      <button
        type="button"
        className={`menubar__item ${open ? 'menubar__item--open' : ''}`}
        onClick={() => setOpen(value => !value)}
      >
        {label}
      </button>
      {open && (
        <div className="menubar__menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}

function Item({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="menubar__menu-item"
      disabled={disabled}
      onClick={event => {
        event.stopPropagation()
        if (disabled) return
        onClick?.()
        event.currentTarget.closest('.menubar__menu')?.dispatchEvent(new Event('click', { bubbles: true }))
      }}
    >
      {children}
    </button>
  )
}

function Submenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="menubar__menu-item menubar__menu-item--sub" onClick={event => event.stopPropagation()}>
      {label}
      <ChevronRight size={12} className="menubar__arrow" />
      <div className="menubar__submenu">{children}</div>
    </div>
  )
}

function Sep() {
  return <div className="menubar__sep" />
}
