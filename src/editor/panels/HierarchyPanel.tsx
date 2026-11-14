import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  Axis3d, Box, Boxes, Camera, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Circle, Cylinder, Eye, EyeOff,
  Flashlight, Lightbulb, Lock, Pill, Plus, Search, Square, Sun, Sunrise, Unlock, X,
} from 'lucide-react'
import { savePrefabFromSelection } from '../assets/import'
import { childrenOf, isLight, isMesh, KIND_LABEL, LIGHT_KINDS, MESH_KINDS } from '../scene/kinds'
import { useEditorStore, primaryId } from '../scene/store'
import { isUnder } from '../scene/transform'
import type { NodeKind, SceneNode } from '../scene/types'
import './HierarchyPanel.css'

const ICONS: Record<NodeKind, typeof Box> = {
  empty: Axis3d,
  box: Box,
  sphere: Circle,
  plane: Square,
  cylinder: Cylinder,
  capsule: Pill,
  model: Boxes,
  'directional-light': Sun,
  'point-light': Lightbulb,
  'spot-light': Flashlight,
  'hemisphere-light': Sunrise,
  camera: Camera,
}

let dragId: string | null = null
const RENAME_DELAY_MS = 1000

export default function HierarchyPanel() {
  const nodes = useEditorStore(state => state.nodes)
  const selection = useEditorStore(state => state.selection)
  const playing = useEditorStore(state => state.playState !== 'stopped')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dropId, setDropId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const renameTimer = useRef<number | null>(null)
  const dragged = useRef(false)
  const primary = primaryId({ selection })
  const pendingRenameId = useEditorStore(state => state.pendingRenameId)

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    const cache = new Map<string, boolean>()
    const visit = (id: string): boolean => {
      const cached = cache.get(id)
      if (cached !== undefined) return cached
      const node = nodes[id]
      if (!node) return false
      const self = node.name.toLowerCase().includes(q)
      const child = childrenOf(nodes, id).some(item => visit(item.id))
      const ok = self || child
      cache.set(id, ok)
      return ok
    }
    if (q) Object.keys(nodes).forEach(visit)
    return cache
  }, [nodes, q])

  const visibleRows = useMemo(() => {
    const rows: { node: SceneNode; depth: number }[] = []
    const walk = (parentId: string | null, depth: number) => {
      for (const node of childrenOf(nodes, parentId)) {
        if (q && !matches.get(node.id)) continue
        rows.push({ node, depth })
        const open = q ? true : !collapsed[node.id]
        if (open) walk(node.id, depth + 1)
      }
    }
    walk(null, 0)
    return rows
  }, [nodes, collapsed, q, matches])

  useEffect(() => {
    if (!menu && !createOpen) return
    const close = () => {
      setMenu(null)
      setCreateOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu, createOpen])

  useEffect(() => () => {
    if (renameTimer.current != null) window.clearTimeout(renameTimer.current)
  }, [])

  useEffect(() => {
    if (!primary) return
    const current = useEditorStore.getState().nodes
    setCollapsed(state => {
      const next = { ...state }
      let parent = current[primary]?.parentId ?? null
      let changed = false
      while (parent) {
        if (next[parent]) {
          delete next[parent]
          changed = true
        }
        parent = current[parent]?.parentId ?? null
      }
      return changed ? next : state
    })
    const timer = window.setTimeout(() => {
      listRef.current?.querySelector(`[data-node-id="${primary}"]`)?.scrollIntoView({ block: 'nearest' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [primary])

  useEffect(() => {
    if (!pendingRenameId) return
    startRename(pendingRenameId)
    useEditorStore.setState({ pendingRenameId: null })
  }, [pendingRenameId])

  const clearRenameTimer = () => {
    if (renameTimer.current != null) {
      window.clearTimeout(renameTimer.current)
      renameTimer.current = null
    }
  }

  const startRename = (id: string) => {
    clearRenameTimer()
    if (!useEditorStore.getState().nodes[id]) return
    setRenameId(id)
  }

  const selectRow = (id: string, event: MouseEvent) => {
    if (event.button !== 0) return
    if (dragged.current) {
      dragged.current = false
      return
    }
    const store = useEditorStore.getState()
    const ids = visibleRows.map(row => row.node.id)
    if (event.ctrlKey || event.metaKey) {
      clearRenameTimer()
      const next = selection.includes(id) ? selection.filter(item => item !== id) : [...selection, id]
      store.setSelection(next)
      return
    }
    if (event.shiftKey && primary) {
      clearRenameTimer()
      const start = ids.indexOf(primary)
      const end = ids.indexOf(id)
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start]
        const range = ids.slice(from, to + 1).filter(item => item !== id)
        store.setSelection([...range, id])
        return
      }
    }
    const sole = selection.length === 1 && selection[0] === id && renameId !== id
    if (sole) {
      clearRenameTimer()
      renameTimer.current = window.setTimeout(() => {
        renameTimer.current = null
        const now = useEditorStore.getState()
        if (now.selection.length === 1 && now.selection[0] === id) setRenameId(id)
      }, RENAME_DELAY_MS)
      return
    }
    clearRenameTimer()
    store.setSelection([id])
  }

  const focusRow = (id: string, event: MouseEvent) => {
    event.preventDefault()
    clearRenameTimer()
    if (event.ctrlKey || event.metaKey || event.shiftKey) return
    const store = useEditorStore.getState()
    store.setSelection([id])
    store.requestFocus()
  }

  const onPanelKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
    if (event.key !== 'F2') return
    event.preventDefault()
    const id = primaryId(useEditorStore.getState())
    if (id) startRename(id)
  }

  const create = (kind: NodeKind) => {
    useEditorStore.getState().createNode(kind)
    setCreateOpen(false)
  }

  return (
    <div className="scene-panel" tabIndex={0} onKeyDown={onPanelKey} onContextMenu={event => event.preventDefault()}>
      <div className="scene-panel__bar">
        <div className="scene-panel__search">
          <Search size={12} />
          <input value={query} placeholder="搜索物体" onChange={event => setQuery(event.target.value)} />
          {query && (
            <button type="button" onClick={() => setQuery('')} title="清除">
              <X size={12} />
            </button>
          )}
        </div>
        <span className="scene-panel__count">{Object.keys(nodes).length}</span>
        <button type="button" className="scene-panel__icon" title="全部展开" onClick={() => setCollapsed({})}>
          <ChevronsUpDown size={14} />
        </button>
        <button
          type="button"
          className="scene-panel__icon"
          title="全部折叠"
          onClick={() => {
            const next: Record<string, boolean> = {}
            for (const node of Object.values(nodes)) {
              if (childrenOf(nodes, node.id).length > 0) next[node.id] = true
            }
            setCollapsed(next)
          }}
        >
          <ChevronsDownUp size={14} />
        </button>
        <button
          type="button"
          className="scene-panel__icon"
          title="创建"
          disabled={playing}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => setCreateOpen(value => !value)}
        >
          <Plus size={14} />
        </button>
        {createOpen && (
          <div className="scene-panel__popover" onPointerDown={event => event.stopPropagation()}>
            <CreateList onCreate={create} />
          </div>
        )}
      </div>
      <div
        className="scene-panel__list"
        ref={listRef}
        onDragOver={event => {
          if (playing || !dragId) return
          event.preventDefault()
          setDropId(null)
        }}
        onDrop={event => {
          event.preventDefault()
          const source = dragId
          dragId = null
          setDropId(null)
          if (source && !playing) useEditorStore.getState().reparent(source, null)
        }}
      >
        {visibleRows.length === 0 && <div className="scene-panel__empty">场景是空的。用加号或「创建」菜单添加物体。</div>}
        {visibleRows.map(({ node, depth }) => {
          const Icon = ICONS[node.kind]
          const hasChildren = childrenOf(nodes, node.id).length > 0
          const selected = selection.includes(node.id)
          return (
            <div
              key={node.id}
              className={[
                'scene-item',
                selected ? 'scene-item--selected' : '',
                primary === node.id ? 'scene-item--primary' : '',
                dropId === node.id ? 'scene-item--drop' : '',
                node.visible ? '' : 'scene-item--hidden',
                ancestorHidden(nodes, node.id) ? 'scene-item--ancestor-hidden' : '',
              ].filter(Boolean).join(' ')}
              style={{ paddingLeft: 6 + depth * 14 }}
              data-node-id={node.id}
              title="单击选择，再单击改名，双击聚焦"
              onClick={event => selectRow(node.id, event)}
              onDoubleClick={event => focusRow(node.id, event)}
              onContextMenu={event => {
                event.preventDefault()
                event.stopPropagation()
                if (!selection.includes(node.id)) useEditorStore.getState().setSelection([node.id])
                setMenu({ x: event.clientX, y: event.clientY, id: node.id })
              }}
              draggable={!playing && renameId !== node.id}
              onDragStart={event => {
                dragId = node.id
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', node.id)
              }}
              onDragEnd={() => {
                dragged.current = true
                dragId = null
                setDropId(null)
              }}
              onDragOver={event => {
                if (playing || !dragId || dragId === node.id || isUnder(nodes, node.id, dragId)) return
                event.preventDefault()
                event.stopPropagation()
                setDropId(node.id)
              }}
              onDrop={event => {
                event.preventDefault()
                event.stopPropagation()
                const source = dragId
                dragId = null
                setDropId(null)
                if (source) useEditorStore.getState().reparent(source, node.id)
              }}
            >
              <button
                type="button"
                className="scene-item__twist"
                onMouseDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation()
                  if (hasChildren) setCollapsed(state => ({ ...state, [node.id]: !state[node.id] }))
                }}
              >
                {hasChildren ? (collapsed[node.id] && !q ? <ChevronRight size={12} /> : <ChevronDown size={12} />) : null}
              </button>
              <Icon size={13} color={iconColor(node.kind)} />
              {renameId === node.id ? (
                <input
                  className="scene-item__rename"
                  autoFocus
                  defaultValue={node.name}
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => event.stopPropagation()}
                  onDoubleClick={event => event.stopPropagation()}
                  onFocus={event => event.currentTarget.select()}
                  onBlur={event => {
                    const cancel = event.currentTarget.dataset.cancel === '1'
                    const name = event.currentTarget.value.trim()
                    setRenameId(null)
                    if (cancel || !name || name === node.name) return
                    const store = useEditorStore.getState()
                    store.beginGesture('重命名')
                    store.updateNode(node.id, { name })
                    store.endGesture()
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      event.currentTarget.dataset.cancel = '1'
                      event.currentTarget.blur()
                    }
                  }}
                />
              ) : (
                <span className="scene-item__name">{node.name}</span>
              )}
              <span className="scene-item__actions">
                <button
                  type="button"
                  className={node.visible ? '' : 'scene-item__off'}
                  title={node.visible ? '隐藏' : '显示'}
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation()
                    useEditorStore.getState().toggleVisible(node.id)
                  }}
                >
                  {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button
                  type="button"
                  className={node.locked ? 'scene-item__locked' : ''}
                  title={node.locked ? '已锁定：视口点选会穿透，手柄也不作用' : '锁定后视口点选穿透，手柄不作用'}
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation()
                    useEditorStore.getState().toggleLocked(node.id)
                  }}
                >
                  {node.locked ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
              </span>
            </div>
          )
        })}
      </div>
      {menu && (
        <div className="scene-panel__context" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
          <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().createNode('empty', menu.id); setMenu(null) }}>创建子物体</button>
          <button type="button" onClick={() => { startRename(menu.id); setMenu(null) }}>重命名</button>
          <button type="button" onClick={() => { useEditorStore.getState().requestFocus(); setMenu(null) }}>聚焦</button>
          <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().duplicateSelection(); setMenu(null) }}>就地复制</button>
          <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().copySelection(); setMenu(null) }}>拷贝</button>
          <button type="button" disabled={playing || !useEditorStore.getState().canPaste} onClick={() => { useEditorStore.getState().pasteClipboard(menu.id); setMenu(null) }}>粘贴为子级</button>
          <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().groupSelection(); setMenu(null) }}>成组</button>
          <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().snapSelectionToGround(); setMenu(null) }}>贴地</button>
          <button type="button" disabled={playing} onClick={() => { savePrefabFromSelection(); setMenu(null) }}>存为预制体</button>
          <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().deleteSelection(); setMenu(null) }}>删除</button>
          <button
            type="button"
            disabled={playing || !nodes[menu.id]?.parentId}
            onClick={() => { useEditorStore.getState().reparent(menu.id, null); setMenu(null) }}
          >
            解除父子
          </button>
        </div>
      )}
    </div>
  )
}

function CreateList({ onCreate }: { onCreate: (kind: NodeKind) => void }) {
  return (
    <>
      <button type="button" onClick={() => onCreate('empty')}>空物体</button>
      <div className="scene-panel__popover-label">几何体</div>
      {MESH_KINDS.map(kind => <button key={kind} type="button" onClick={() => onCreate(kind)}>{KIND_LABEL[kind]}</button>)}
      <div className="scene-panel__popover-label">灯光</div>
      {LIGHT_KINDS.map(kind => <button key={kind} type="button" onClick={() => onCreate(kind)}>{KIND_LABEL[kind]}</button>)}
      <button type="button" onClick={() => onCreate('camera')}>相机</button>
    </>
  )
}

function ancestorHidden(nodes: Record<string, SceneNode>, id: string): boolean {
  let current = nodes[id]?.parentId ?? null
  while (current) {
    const parent = nodes[current]
    if (!parent) return false
    if (!parent.visible) return true
    current = parent.parentId
  }
  return false
}

function iconColor(kind: NodeKind): string {
  if (isLight(kind)) return '#ffd36b'
  if (kind === 'camera') return '#4a9eff'
  if (isMesh(kind)) return '#f5a623'
  return '#999999'
}
