import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import {
  Axis3d, Box, Boxes, Camera, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Circle, Cylinder, Eye, EyeOff,
  Flashlight, Lightbulb, Lock, Pill, Plus, Search, Square, Sun, Sunrise, Unlock, X,
} from 'lucide-react'
import { savePrefabFromSelection } from '../assets/import'
import { childrenOf, isLight, isMesh, KIND_LABEL, LIGHT_KINDS, MESH_KINDS } from '../scene/kinds'
import { useEditorStore } from '../scene/store'
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

export default function HierarchyPanel() {
  const nodes = useEditorStore(state => state.nodes)
  const selection = useEditorStore(state => state.selection)
  const playing = useEditorStore(state => state.playState !== 'stopped')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [anchor, setAnchor] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

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

  const selectRow = (id: string, event: MouseEvent) => {
    const ids = visibleRows.map(row => row.node.id)
    if (event.shiftKey && anchor) {
      const start = ids.indexOf(anchor)
      const end = ids.indexOf(id)
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start]
        const range = ids.slice(from, to + 1).filter(item => item !== id)
        useEditorStore.getState().setSelection([...range, id])
        return
      }
    }
    if (event.ctrlKey || event.metaKey) {
      const next = selection.includes(id) ? selection.filter(item => item !== id) : [...selection, id]
      useEditorStore.getState().setSelection(next)
      return
    }
    useEditorStore.getState().setSelection([id])
    setAnchor(id)
  }

  const create = (kind: NodeKind) => {
    useEditorStore.getState().createNode(kind)
    setCreateOpen(false)
  }

  return (
    <div className="scene-panel" onContextMenu={event => event.preventDefault()}>
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
                dropId === node.id ? 'scene-item--drop' : '',
                node.visible ? '' : 'scene-item--hidden',
                ancestorHidden(nodes, node.id) ? 'scene-item--ancestor-hidden' : '',
              ].filter(Boolean).join(' ')}
              style={{ paddingLeft: 6 + depth * 14 }}
              onMouseDown={event => {
                if (event.button === 0) selectRow(node.id, event)
              }}
              onDoubleClick={() => setRenameId(node.id)}
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
                onClick={() => hasChildren && setCollapsed(state => ({ ...state, [node.id]: !state[node.id] }))}
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
                  onFocus={() => useEditorStore.getState().beginGesture('重命名')}
                  onBlur={event => {
                    const cancel = event.currentTarget.dataset.cancel === '1'
                    const name = event.currentTarget.value.trim()
                    if (!cancel && name) useEditorStore.getState().updateNode(node.id, { name })
                    useEditorStore.getState().endGesture()
                    setRenameId(null)
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
                  onClick={() => useEditorStore.getState().toggleVisible(node.id)}
                >
                  {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button
                  type="button"
                  className={node.locked ? 'scene-item__locked' : ''}
                  title={node.locked ? '解锁' : '锁定'}
                  onMouseDown={event => event.stopPropagation()}
                  onClick={() => useEditorStore.getState().toggleLocked(node.id)}
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
          <button type="button" onClick={() => { useEditorStore.getState().requestFocus(); setMenu(null) }}>聚焦</button>
          <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().duplicateSelection(); setMenu(null) }}>复制</button>
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
