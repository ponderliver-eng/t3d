import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown, ArrowDownToLine, ArrowUp, Axis3d, Bone, Box, Boxes, Camera, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Circle, ClipboardPaste, Component, Cone, Copy, CopyPlus, Cylinder, ExternalLink, Eye, EyeOff,
  Flashlight, Focus, Group, Lightbulb, Lock, MapPin, Package, PanelsTopLeft, Pencil, Pill, Plus, Search, Sparkles, Square, Sun, Sunrise, Trash2, Undo2, Ungroup, Unlink, Unlock, Upload, X,
} from 'lucide-react'
import { readClipDrag } from '../animation/playback'
import { assignClip, isNodeDrag, NODE_MIME } from '../assets/import'
import { assetDirectory, useAssetStore } from '../assets/library'
import { getModelTemplate, subscribeModels, type ModelTreeNode } from '../assets/models'
import { instanceDirty, isPrefabRoot } from '../assets/prefab'
import { useI18n, type MessageKey } from '../i18n'
import { TAG_FILTER_UNTAGGED, sortedTags } from '../project/taxonomy'
import { childrenOf, isLight, isMesh, LIGHT_KINDS, MESH_KINDS } from '../scene/kinds'
import { useEditorStore, primaryId, type DeviceKind } from '../scene/store'
import { isUnder } from '../scene/transform'
import type { NodeKind, SceneNode } from '../scene/types'
import { useInspectorMemory } from './inspectorMemory'
import './HierarchyPanel.css'

const ICONS: Record<NodeKind, typeof Box> = {
  empty: Axis3d,
  box: Box,
  sphere: Circle,
  plane: Square,
  cylinder: Cylinder,
  capsule: Pill,
  cone: Cone,
  model: Boxes,
  'directional-light': Sun,
  'point-light': Lightbulb,
  'spot-light': Flashlight,
  'hemisphere-light': Sunrise,
  camera: Camera,
  effect: Sparkles,
  screen: PanelsTopLeft,
}

const RENAME_DELAY_MS = 1000
type DropZone = 'before' | 'into' | 'after'

type TreeRow =
  | { kind: 'node'; node: SceneNode; depth: number }
  | { kind: 'sub'; node: SceneNode; item: ModelTreeNode; depth: number }

function hasMeshDescendant(item: ModelTreeNode): boolean {
  if (item.kind === 'mesh') return true
  return item.children.some(hasMeshDescendant)
}

function subAncestorHidden(hiddenParts: string[] | undefined, path: string): boolean {
  if (!hiddenParts?.length || !path.includes('/')) return false
  const set = new Set(hiddenParts)
  const parts = path.split('/')
  let prefix = ''
  for (let i = 0; i < parts.length - 1; i += 1) {
    prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]
    if (set.has(prefix)) return true
  }
  return false
}

function filterSubTree(nodes: ModelTreeNode[], query: string): ModelTreeNode[] {
  const out: ModelTreeNode[] = []
  for (const item of nodes) {
    const children = filterSubTree(item.children, query)
    const self = item.name.toLowerCase().includes(query) || item.path.toLowerCase().includes(query)
    if (self || children.length > 0) out.push({ ...item, children })
  }
  return out
}

export default function HierarchyPanel() {
  const nodes = useEditorStore(state => state.nodes)
  const selection = useEditorStore(state => state.selection)
  const playing = useEditorStore(state => state.playState !== 'stopped')
  const subSelection = useInspectorMemory(state => state.subSelection)
  const { t } = useI18n()
  const [modelVersion, setModelVersion] = useState(0)
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState('all')
  const tags = useEditorStore(state => state.tags)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [subOpen, setSubOpen] = useState<Record<string, boolean>>({})
  const [drop, setDrop] = useState<{ id: string, zone: 'before' | 'into' | 'after' } | null>(null)
  const [boneDropKey, setBoneDropKey] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null } | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [savePrefab, setSavePrefab] = useState<{ id: string, name: string, dir?: string } | null>(null)
  const [unpackId, setUnpackId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const renameTimer = useRef<number | null>(null)
  const dragged = useRef(false)
  const dragChip = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef<string | null>(null)
  const dropLive = useRef<{ id: string, zone: DropZone } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const primary = primaryId({ selection })
  const pendingRenameId = useEditorStore(state => state.pendingRenameId)

  const q = query.trim().toLowerCase()
  useEffect(() => subscribeModels(() => setModelVersion(value => value + 1)), [])

  const modelTrees = useMemo(() => {
    void modelVersion
    const map = new Map<string, ModelTreeNode[]>()
    for (const node of Object.values(nodes)) {
      if (node.kind !== 'model' || !node.assetId) continue
      if (map.has(node.assetId)) continue
      const template = getModelTemplate(node.assetId)
      if (template?.tree.length) map.set(node.assetId, template.tree)
    }
    return map
  }, [nodes, modelVersion])

  const boneChildren = useMemo(() => {
    const map = new Map<string, SceneNode[]>()
    for (const node of Object.values(nodes)) {
      if (!node.parentId || !node.socketBone) continue
      const key = `${node.parentId}\n${node.socketBone}`
      const list = map.get(key) ?? []
      list.push(node)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh'))
    }
    return map
  }, [nodes])

  const matches = useMemo(() => {
    const cache = new Map<string, boolean>()
    const visit = (id: string): boolean => {
      const cached = cache.get(id)
      if (cached !== undefined) return cached
      const node = nodes[id]
      if (!node) return false
      const nameOk = !q || node.name.toLowerCase().includes(q)
      const tagged = Boolean(node.tagId) || (node.tagIds?.length ?? 0) > 0
      const tagOk = tagFilter === 'all'
        || (tagFilter === TAG_FILTER_UNTAGGED ? !tagged : node.tagId === tagFilter || node.tagIds?.includes(tagFilter))
      const subMatch = q && tagOk && node.kind === 'model' && node.assetId
        ? filterSubTree(modelTrees.get(node.assetId) ?? [], q).length > 0
        : false
      const self = (nameOk && tagOk) || subMatch
      const child = childrenOf(nodes, id).some(item => visit(item.id))
      const ok = self || child
      cache.set(id, ok)
      return ok
    }
    if (q || tagFilter !== 'all') Object.keys(nodes).forEach(visit)
    return cache
  }, [nodes, q, tagFilter, modelTrees])

  const visibleRows = useMemo(() => {
    const rows: TreeRow[] = []
    let searchSubExpanded = 0
    const walkNodeBranch = (node: SceneNode, depth: number) => {
      if ((q || tagFilter !== 'all') && !matches.get(node.id)) return
      rows.push({ kind: 'node', node, depth })
      const internal = node.kind === 'model' && node.assetId ? (modelTrees.get(node.assetId) ?? []) : []
      const isModelDefaultCollapsed = node.kind === 'model' && collapsed[node.id] === undefined
      const filteredSub = q && internal.length > 0 ? filterSubTree(internal, q) : []
      const openBySearch = (q && filteredSub.length > 0 && searchSubExpanded < 5)
      if (openBySearch) searchSubExpanded += 1
      const open = q || tagFilter !== 'all'
        ? (!isModelDefaultCollapsed || openBySearch || childrenOf(nodes, node.id).some(c => matches.get(c.id)))
        : (node.kind === 'model' ? collapsed[node.id] === false : !collapsed[node.id])
      if (!open) return
      if (internal.length > 0 && (q ? filteredSub.length > 0 && openBySearch : collapsed[node.id] === false)) {
        walkSub(node, q ? filteredSub : internal, depth + 1, Boolean(q && filteredSub.length > 0))
      }
      for (const child of childrenOf(nodes, node.id)) {
        if (internal.length > 0 && child.socketBone) continue
        walkNodeBranch(child, depth + 1)
      }
    }
    const walkSub = (owner: SceneNode, items: ModelTreeNode[], depth: number, forceOpen: boolean) => {
      for (const item of items) {
        rows.push({ kind: 'sub', node: owner, item, depth })
        const key = `${owner.id}:${item.path}`
        const attached = item.kind === 'bone' ? (boneChildren.get(`${owner.id}\n${item.path}`) ?? []) : []
        const hasSubKids = item.children.length > 0 || attached.length > 0
        if (hasSubKids && (forceOpen || subOpen[key] === true)) {
          if (item.children.length > 0) walkSub(owner, item.children, depth + 1, forceOpen)
          for (const child of attached) walkNodeBranch(child, depth + 1)
        }
      }
    }
    for (const root of childrenOf(nodes, null)) walkNodeBranch(root, 0)
    return rows
  }, [nodes, collapsed, subOpen, q, tagFilter, matches, modelTrees, boneChildren])

  useEffect(() => {
    if (!menu && !createOpen) return
    const close = (event: Event) => {
      const target = event.target as Node | null
      if (target && menuRef.current?.contains(target)) return
      setMenu(null)
      setCreateOpen(false)
    }
    const timer = window.setTimeout(() => window.addEventListener('pointerdown', close), 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', close)
    }
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
        const pNode = current[parent]
        if (pNode?.kind === 'model') {
          if (next[parent] !== false) {
            next[parent] = false
            changed = true
          }
        } else if (next[parent]) {
          delete next[parent]
          changed = true
        }
        parent = pNode?.parentId ?? null
      }
      return changed ? next : state
    })
    const targetNode = current[primary]
    if (targetNode?.parentId && targetNode.socketBone) {
      const parts = targetNode.socketBone.split('/')
      setSubOpen(prev => {
        const next = { ...prev }
        let changed = false
        let prefix = ''
        for (const part of parts) {
          prefix = prefix ? `${prefix}/${part}` : part
          const key = `${targetNode.parentId}:${prefix}`
          if (!next[key]) {
            next[key] = true
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
    const timer = window.setTimeout(() => {
      listRef.current?.querySelector(`[data-node-id="${primary}"]`)?.scrollIntoView({ block: 'nearest' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [primary])

  useEffect(() => {
    if (!subSelection) return
    setCollapsed(current => (current[subSelection.nodeId] === false ? current : { ...current, [subSelection.nodeId]: false }))
    const parts = subSelection.path.split('/')
    if (parts.length > 1) {
      setSubOpen(current => {
        const next = { ...current }
        let changed = false
        let prefix = ''
        for (let i = 0; i < parts.length - 1; i += 1) {
          prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]
          const key = `${subSelection.nodeId}:${prefix}`
          if (!next[key]) {
            next[key] = true
            changed = true
          }
        }
        return changed ? next : current
      })
    }
    const timer = window.setTimeout(() => {
      listRef.current
        ?.querySelector(`[data-sub-key="${CSS.escape(`${subSelection.nodeId}:${subSelection.path}`)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }, 20)
    return () => window.clearTimeout(timer)
  }, [subSelection])

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
    const ids = visibleRows.filter((row): row is Extract<TreeRow, { kind: 'node' }> => row.kind === 'node').map(row => row.node.id)
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
    const currentSub = useInspectorMemory.getState().subSelection
    if (currentSub && currentSub.nodeId === id) {
      clearRenameTimer()
      useInspectorMemory.getState().clearSubSelection()
      return
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

  const create = (kind: NodeKind, parentId: string | null = null) => {
    useEditorStore.getState().createNode(kind, parentId)
    setCreateOpen(false)
    setMenu(null)
  }

  const createDevice = (device: DeviceKind, parentId: string | null = null) => {
    useEditorStore.getState().createDevice(device, parentId)
    setCreateOpen(false)
    setMenu(null)
  }

  const startNodeDrag = (event: DragEvent, id: string) => {
    if (playing || (event.target as HTMLElement).closest('button, input')) {
      event.preventDefault()
      return
    }
    const node = nodes[id]
    if (!node) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData(NODE_MIME, id)
    event.dataTransfer.effectAllowed = 'copyMove'
    dragChip.current?.remove()
    const chip = document.createElement('div')
    chip.className = 'scene-drag-chip'
    chip.textContent = node.name
    document.body.appendChild(chip)
    event.dataTransfer.setDragImage(chip, 16, 16)
    dragChip.current = chip
    dragged.current = true
    draggingRef.current = id
    setDraggingId(id)
  }

  const finishNodeDrag = () => {
    dragChip.current?.remove()
    dragChip.current = null
    draggingRef.current = null
    dropLive.current = null
    setDraggingId(null)
    setDrop(null)
  }

  const hoverNode = (event: DragEvent, id: string) => {
    if (!isNodeDrag(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const sourceId = draggingRef.current
    if (!sourceId || id === sourceId || isUnder(nodes, id, sourceId)) {
      dropLive.current = null
      setDrop(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1)
    const zone: DropZone = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'into'
    dropLive.current = { id, zone }
    setDrop(dropLive.current)
  }

  const dropNode = (event: DragEvent, id: string) => {
    if (!isNodeDrag(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    const sourceId = event.dataTransfer.getData(NODE_MIME)
    const current = dropLive.current
    finishNodeDrag()
    if (!sourceId) return
    const zone = current?.id === id ? current.zone : 'into'
    const ids = dragIds(sourceId, useEditorStore.getState().selection)
    const target = useEditorStore.getState().nodes[id]
    if (!target || ids.includes(id) || isUnder(useEditorStore.getState().nodes, id, sourceId)) return
    if (zone === 'into') {
      useEditorStore.getState().placeNodes(ids, id, 'into')
      setCollapsed(state => {
        const next = { ...state }
        delete next[id]
        return next
      })
    } else {
      useEditorStore.getState().placeNodes(ids, target.parentId, zone, id)
    }
  }

  return (
    <div className="scene-panel" tabIndex={0} onKeyDown={onPanelKey} onContextMenu={event => event.preventDefault()}>
      <div className="scene-panel__bar">
        <div className="scene-panel__search">
          <Search size={12} />
          <input value={query} placeholder={t('hierarchy.search')} onChange={event => setQuery(event.target.value)} />
          {query && (
            <button type="button" onClick={() => setQuery('')} title={t('project.clear')}>
              <X size={12} />
            </button>
          )}
        </div>
        <select className="scene-panel__filter" value={tagFilter} onChange={event => setTagFilter(event.target.value)} title={t('tags.filter')}>
          <option value="all">{t('tags.filterAll')}</option>
          <option value={TAG_FILTER_UNTAGGED}>{t('tags.filterUntagged')}</option>
          {sortedTags(tags).map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
        <span className="scene-panel__count">{Object.keys(nodes).length}</span>
        <button type="button" className="scene-panel__icon" title={t('hierarchy.expand')} onClick={() => setCollapsed({})}>
          <ChevronsUpDown size={14} />
        </button>
        <button
          type="button"
          className="scene-panel__icon"
          title={t('hierarchy.collapse')}
          onClick={() => {
            const next: Record<string, boolean> = {}
            for (const node of Object.values(nodes)) {
              if (childrenOf(nodes, node.id).length > 0 || (node.kind === 'model' && node.assetId && modelTrees.has(node.assetId))) {
                next[node.id] = true
              }
            }
            setCollapsed(next)
            setSubOpen({})
          }}
        >
          <ChevronsDownUp size={14} />
        </button>
        <button
          type="button"
          className="scene-panel__icon"
          title={t('hierarchy.create')}
          disabled={playing}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => setCreateOpen(value => !value)}
        >
          <Plus size={14} />
        </button>
        {createOpen && (
          <div className="scene-panel__popover" onPointerDown={event => event.stopPropagation()}>
            <CreateList onCreate={create} onCreateDevice={createDevice} />
          </div>
        )}
      </div>
      <div
        className="scene-panel__list"
        ref={listRef}
        onContextMenu={event => {
          if ((event.target as HTMLElement).closest('.scene-item')) return
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY, id: null })
        }}
      >
        {visibleRows.length === 0 && <div className="scene-panel__empty">{t('hierarchy.empty')}</div>}
        {visibleRows.map(row => {
          if (row.kind === 'sub') {
            const { node, item, depth } = row
            const key = `${node.id}:${item.path}`
            const open = q ? true : subOpen[key] === true
            const subSelected = subSelection?.nodeId === node.id && subSelection.path === item.path
            const partVisible = !(node.hiddenParts ?? []).includes(item.path)
            const parentHidden = subAncestorHidden(node.hiddenParts, item.path)
            const canToggleVisibility = item.kind === 'mesh' || (item.kind === 'node' && hasMeshDescendant(item))
            const attached = item.kind === 'bone' ? (boneChildren.get(`${node.id}\n${item.path}`) ?? []) : []
            const hasSubKids = item.children.length > 0 || attached.length > 0
            const socketId = attached[0]?.id
            const canDropOnBone = item.kind === 'bone' && boneDropKey === key
            return (
              <div
                key={key}
                data-sub-key={key}
                className={[
                  'scene-item',
                  'scene-item--sub',
                  `scene-item--sub-${item.kind}`,
                  subSelected ? 'scene-item--selected scene-item--primary' : '',
                  !partVisible ? 'scene-item--hidden' : '',
                  parentHidden ? 'scene-item--ancestor-hidden' : '',
                  canDropOnBone ? 'scene-item--into' : '',
                ].filter(Boolean).join(' ')}
                style={{ paddingLeft: 6 + depth * 14 }}
                title={item.path}
                onClick={event => {
                  event.stopPropagation()
                  useInspectorMemory.getState().selectSubItem({
                    nodeId: node.id,
                    path: item.path,
                    name: item.name,
                    kind: item.kind,
                    slotIndices: item.slotIndices,
                  }, { flash: true })
                }}
                onDoubleClick={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  useInspectorMemory.getState().selectSubItem({
                    nodeId: node.id,
                    path: item.path,
                    name: item.name,
                    kind: item.kind,
                    slotIndices: item.slotIndices,
                  }, { flash: true })
                  useEditorStore.getState().requestFocus()
                }}
                onDragOver={event => {
                  if (item.kind !== 'bone' || !isNodeDrag(event.dataTransfer)) return
                  const sourceId = draggingRef.current
                  if (!sourceId || sourceId === node.id || isUnder(nodes, node.id, sourceId)) return
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = 'move'
                  if (boneDropKey !== key) setBoneDropKey(key)
                }}
                onDragLeave={() => {
                  if (boneDropKey === key) setBoneDropKey(null)
                }}
                onDrop={event => {
                  if (item.kind !== 'bone' || !isNodeDrag(event.dataTransfer)) return
                  const sourceId = event.dataTransfer.getData(NODE_MIME) || draggingRef.current
                  setBoneDropKey(null)
                  if (!sourceId || sourceId === node.id || isUnder(nodes, node.id, sourceId)) return
                  event.preventDefault()
                  event.stopPropagation()
                  useEditorStore.getState().attachToBone(sourceId, node.id, item.path)
                  setCollapsed(current => ({ ...current, [node.id]: false }))
                  setSubOpen(current => ({ ...current, [key]: true }))
                }}
              >
                <button
                  type="button"
                  className="scene-item__twist"
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation()
                    if (hasSubKids) setSubOpen(current => ({ ...current, [key]: !open }))
                  }}
                >
                  {hasSubKids ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
                </button>
                {item.kind === 'bone' ? (
                  <Bone size={13} color="#f2cf7f" />
                ) : item.kind === 'mesh' ? (
                  <Box size={13} color="#9fc5ff" />
                ) : (
                  <Box size={12} color="#8c8c8c" />
                )}
                <span className="scene-item__name">{item.name}</span>
                <span className="scene-item__actions scene-item__actions--sub">
                  {canToggleVisibility && (
                    <button
                      type="button"
                      className={partVisible ? '' : 'scene-item__off'}
                      title={partVisible ? t('hierarchy.hide') : t('hierarchy.show')}
                      onMouseDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation()
                        const store = useEditorStore.getState()
                        store.beginGesture(t('inspector.parts'))
                        const next = partVisible
                          ? [...(node.hiddenParts ?? []), item.path]
                          : (node.hiddenParts ?? []).filter(id => id !== item.path)
                        store.updateNode(node.id, { hiddenParts: next })
                        store.endGesture()
                      }}
                    >
                      {partVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  )}
                  {item.kind === 'bone' && (
                    <button
                      type="button"
                      disabled={playing}
                      className={socketId ? 'scene-item__socket-ready' : 'scene-item__socket-add'}
                      title={socketId ? t('inspector.socketReady') : t('inspector.extractSocket')}
                      onMouseDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation()
                        const store = useEditorStore.getState()
                        if (socketId) store.setSelection([socketId])
                        else store.extractSocket(node.id, item.path, item.name)
                      }}
                    >
                      {socketId ? <Check size={12} /> : <Plus size={12} />}
                    </button>
                  )}
                </span>
              </div>
            )
          }
          const { node, depth } = row
          const Icon = ICONS[node.kind]
          const hasInternal = node.kind === 'model' && Boolean(node.assetId && modelTrees.get(node.assetId)?.length)
          const hasChildren = childrenOf(nodes, node.id).length > 0 || hasInternal
          const isOpen = node.kind === 'model' ? (collapsed[node.id] === false || (Boolean(q) && hasInternal)) : !collapsed[node.id]
          const selected = selection.includes(node.id) && !(subSelection?.nodeId === node.id)
          return (
            <div
              key={node.id}
              className={[
                'scene-item',
                selected ? 'scene-item--selected' : '',
                primary === node.id ? 'scene-item--primary' : '',
                drop?.id === node.id ? `scene-item--${drop.zone}` : '',
                node.prefabAssetId || node.nestedPrefabId ? 'scene-item--prefab' : '',
                isPrefabRoot(node) ? 'scene-item--prefab-root' : '',
                node.visible ? '' : 'scene-item--hidden',
                ancestorHidden(nodes, node.id) ? 'scene-item--ancestor-hidden' : '',
                draggingId === node.id ? 'scene-item--dragging' : '',
              ].filter(Boolean).join(' ')}
              style={{ paddingLeft: 6 + depth * 14 }}
              data-node-id={node.id}
              title={t('hierarchy.hint')}
              draggable={!playing && renameId !== node.id}
              onDragStart={event => startNodeDrag(event, node.id)}
              onDragEnd={finishNodeDrag}
              onDragOver={event => {
                if (isNodeDrag(event.dataTransfer)) {
                  hoverNode(event, node.id)
                  return
                }
                const types = [...event.dataTransfer.types]
                if (!types.includes('application/x-t3d-asset') && !types.includes('application/x-t3d-clip')) return
                event.preventDefault()
                event.stopPropagation()
              }}
              onDrop={event => {
                if (isNodeDrag(event.dataTransfer)) {
                  dropNode(event, node.id)
                  return
                }
                const clipDrag = readClipDrag(event.dataTransfer.getData('application/x-t3d-clip'))
                if (clipDrag) {
                  if (node.kind !== 'model') return
                  event.preventDefault()
                  event.stopPropagation()
                  assignClip(node.id, clipDrag.assetId, clipDrag.clip)
                  return
                }
                const assetId = event.dataTransfer.getData('application/x-t3d-asset')
                const asset = useAssetStore.getState().assets[assetId]
                if (asset?.kind !== 'prefab') return
                event.preventDefault()
                event.stopPropagation()
                useEditorStore.getState().spawnPrefab(assetId, [0, 0, 0], node.id)
                setCollapsed(state => {
                  const next = { ...state }
                  delete next[node.id]
                  return next
                })
              }}
              onClick={event => selectRow(node.id, event)}
              onDoubleClick={event => focusRow(node.id, event)}
              onContextMenu={event => {
                event.preventDefault()
                event.stopPropagation()
                if (!selection.includes(node.id)) useEditorStore.getState().setSelection([node.id])
                setMenu({ x: event.clientX, y: event.clientY, id: node.id })
              }}
            >
              <button
                type="button"
                className="scene-item__twist"
                onMouseDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation()
                  if (!hasChildren) return
                  setCollapsed(state => {
                    if (node.kind === 'model') {
                      const nextOpen = state[node.id] !== false
                      return { ...state, [node.id]: nextOpen ? false : true }
                    }
                    return { ...state, [node.id]: !state[node.id] }
                  })
                }}
              >
                {hasChildren ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
              </button>
              <Icon size={13} color={node.socketBone ? '#f2cf7f' : iconColor(node.kind)} />
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
                    store.beginGesture(t('gesture.rename'))
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
                <>
                  <span className="scene-item__name" title={isPrefabRoot(node) && instanceDirty(nodes, node.id) ? t('prefab.dirty') : undefined}>
                    {node.name}
                    {(isPrefabRoot(node) ? instanceDirty(nodes, node.id) : !!node.prefabOverrides?.length) ? ' *' : ''}
                  </span>
                  {isPrefabRoot(node) && selected && (
                    <button
                      type="button"
                      className={`scene-item__prefab ${useAssetStore.getState().assets[node.prefabAssetId ?? ''] ? '' : 'is-missing'}`}
                      title={useAssetStore.getState().assets[node.prefabAssetId ?? ''] ? t('prefab.openHint') : t('prefab.missing')}
                      onMouseDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation()
                        const assetId = node.prefabAssetId
                        if (!assetId || !useAssetStore.getState().assets[assetId]) return
                        useEditorStore.getState().openPrefab(assetId)
                      }}
                    >
                      {useAssetStore.getState().assets[node.prefabAssetId ?? '']?.name ?? t('prefab.missing')}
                    </button>
                  )}
                </>
              )}
              <span className="scene-item__actions">
                <button
                  type="button"
                  className={node.visible ? '' : 'scene-item__off'}
                  title={node.visible ? t('hierarchy.hide') : t('hierarchy.show')}
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
                  title={node.locked ? t('hierarchy.locked') : t('hierarchy.lock')}
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
      {menu && createPortal(
        <div ref={menuRef} className="scene-panel__context" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
          <div className="scene-panel__submenu">
            <button type="button" disabled={playing}><span><Plus size={12} />{menu.id ? t('hierarchy.createChild') : t('hierarchy.create')}</span><ChevronRight size={12} /></button>
            {!playing && (
              <div className="scene-panel__submenu-pop">
                <CreateList onCreate={kind => create(kind, menu.id)} onCreateDevice={device => createDevice(device, menu.id)} />
              </div>
            )}
          </div>
          {menu.id && (
            <>
              <div className="scene-panel__sep" />
              <button type="button" disabled={playing || !canShift(nodes, menu.id, 'before')} onClick={() => { shiftNode(menu.id!, 'before'); setMenu(null) }}><ArrowUp size={12} />{t('hierarchy.moveUp')}</button>
              <button type="button" disabled={playing || !canShift(nodes, menu.id, 'after')} onClick={() => { shiftNode(menu.id!, 'after'); setMenu(null) }}><ArrowDown size={12} />{t('hierarchy.moveDown')}</button>
              <button
                type="button"
                disabled={playing || !nodes[menu.id]?.parentId}
                onClick={() => { useEditorStore.getState().reparent(menu.id!, null); setMenu(null) }}
              >
                <Ungroup size={12} />{t('hierarchy.unparent')}
              </button>
              <div className="scene-panel__sep" />
              <button type="button" onClick={() => { startRename(menu.id!); setMenu(null) }}><Pencil size={12} />{t('project.rename')}</button>
              <button type="button" onClick={() => { useEditorStore.getState().setSelection([menu.id!]); useEditorStore.getState().requestFocus(); setMenu(null) }}><Focus size={12} />{t('menu.focus')}</button>
              <div className="scene-panel__sep" />
              <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().duplicateSelection(); setMenu(null) }}><CopyPlus size={12} />{t('menu.duplicate')}</button>
              <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().copySelection(); setMenu(null) }}><Copy size={12} />{t('menu.copy')}</button>
              <button type="button" disabled={playing || !useEditorStore.getState().canPaste} onClick={() => { useEditorStore.getState().pasteClipboard(menu.id); setMenu(null) }}><ClipboardPaste size={12} />{t('hierarchy.pasteChild')}</button>
              <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().groupSelection(); setMenu(null) }}><Group size={12} />{t('menu.group')}</button>
              <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().snapSelectionToGround(); setMenu(null) }}><ArrowDownToLine size={12} />{t('menu.ground')}</button>
              <div className="scene-panel__sep" />
              {!isPrefabRoot(nodes[menu.id!]) && (
                <button type="button" disabled={playing} onClick={() => { setSavePrefab({ id: menu.id!, name: nodes[menu.id!]?.name ?? '' }); setMenu(null) }}><Package size={12} />{t('prefab.saveAs')}</button>
              )}
              {nodes[menu.id!]?.nestedPrefabId && (
                <button type="button" onClick={() => { useEditorStore.getState().openPrefab(nodes[menu.id!]?.nestedPrefabId ?? ''); setMenu(null) }}><ExternalLink size={12} />{t('prefab.edit')}</button>
              )}
              {isPrefabRoot(nodes[menu.id!]) && (
                <div className="scene-panel__submenu">
                  <button type="button"><span><Component size={12} />{t('prefab.instance')}</span><ChevronRight size={12} /></button>
                  <div className="scene-panel__submenu-pop">
                    <button type="button" onClick={() => { useEditorStore.getState().openPrefab(nodes[menu.id!]?.prefabAssetId ?? ''); setMenu(null) }}><ExternalLink size={12} />{t('prefab.edit')}</button>
                    <button type="button" onClick={() => { revealPrefab(nodes[menu.id!]?.prefabAssetId ?? ''); setMenu(null) }}><MapPin size={12} />{t('prefab.reveal')}</button>
                    <div className="scene-panel__sep" />
                    <button type="button" disabled={playing || !instanceDirty(nodes, menu.id!)} onClick={() => { useEditorStore.getState().applyPrefabInstance(menu.id!); setMenu(null) }}><Upload size={12} />{t('prefab.apply')}</button>
                    <button type="button" disabled={playing || !instanceDirty(nodes, menu.id!)} onClick={() => { useEditorStore.getState().revertPrefabInstance(menu.id!); setMenu(null) }}><Undo2 size={12} />{t('prefab.revert')}</button>
                    <div className="scene-panel__sep" />
                    <button type="button" disabled={playing} onClick={() => { setUnpackId(menu.id); setMenu(null) }}><Unlink size={12} />{t('prefab.unpack')}</button>
                  </div>
                </div>
              )}
              <div className="scene-panel__sep" />
              <button type="button" disabled={playing} onClick={() => { useEditorStore.getState().deleteSelection(); setMenu(null) }}><Trash2 size={12} />{t('menu.delete')}</button>
            </>
          )}
        </div>,
        document.body,
      )}
      {savePrefab && createPortal(
        <div className="prefab-dialog__backdrop" onMouseDown={() => setSavePrefab(null)}>
          <div className="prefab-dialog" role="dialog" onMouseDown={event => event.stopPropagation()}>
            <h2>{t('prefab.saveAs')}</h2>
            <p>{t('prefab.saveHint', { name: savePrefab.name })}</p>
            <input
              autoFocus
              value={savePrefab.name}
              onChange={event => setSavePrefab({ ...savePrefab, name: event.target.value })}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  useEditorStore.getState().createPrefabFromSelection(savePrefab.name, savePrefab.id, savePrefab.dir)
                  setSavePrefab(null)
                }
              }}
            />
            <div>
              <button type="button" onClick={() => setSavePrefab(null)}>{t('prefab.cancel')}</button>
              <button type="button" onClick={() => { useEditorStore.getState().createPrefabFromSelection(savePrefab.name, savePrefab.id, savePrefab.dir); setSavePrefab(null) }}>{t('prefab.confirm')}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {unpackId && createPortal(
        <div className="prefab-dialog__backdrop" onMouseDown={() => setUnpackId(null)}>
          <div className="prefab-dialog" role="dialog" onMouseDown={event => event.stopPropagation()}>
            <h2>{t('prefab.unpackTitle')}</h2>
            <p>{t('prefab.unpackMessage')}</p>
            <div>
              <button type="button" onClick={() => setUnpackId(null)}>{t('prefab.cancel')}</button>
              <button type="button" onClick={() => { useEditorStore.getState().unpackPrefabInstance(unpackId); setUnpackId(null) }}>{t('prefab.unpack')}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function revealPrefab(assetId: string) {
  if (!assetId) return
  const library = useAssetStore.getState()
  library.setBrowseDir(assetDirectory(assetId, library.assetDirs))
  useEditorStore.setState({ inspectedAssetId: assetId })
}

function dragIds(source: string, selection: string[]) {
  return selection.includes(source) ? selection : [source]
}

function canShift(nodes: Record<string, SceneNode>, id: string, zone: 'before' | 'after') {
  const node = nodes[id]
  if (!node) return false
  const siblings = childrenOf(nodes, node.parentId)
  const index = siblings.findIndex(item => item.id === id)
  return zone === 'before' ? index > 0 : index >= 0 && index < siblings.length - 1
}

function shiftNode(id: string, zone: 'before' | 'after') {
  const nodes = useEditorStore.getState().nodes
  const node = nodes[id]
  if (!node) return
  const siblings = childrenOf(nodes, node.parentId)
  const index = siblings.findIndex(item => item.id === id)
  const anchor = zone === 'before' ? siblings[index - 1] : siblings[index + 1]
  if (!anchor) return
  useEditorStore.getState().placeNodes([id], node.parentId, zone, anchor.id)
}

function CreateList({ onCreate, onCreateDevice }: { onCreate: (kind: NodeKind) => void, onCreateDevice: (device: DeviceKind) => void }) {
  const { t } = useI18n()
  const kindName = (kind: NodeKind) => t(`kind.${kind}` as MessageKey)
  return (
    <>
      <button type="button" onClick={() => onCreate('empty')}><Axis3d size={12} />{t('menu.empty')}</button>
      <div className="scene-panel__sep" />
      <div className="scene-panel__submenu">
        <button type="button"><span><Boxes size={12} />{t('menu.meshes')}</span><ChevronRight size={12} /></button>
        <div className="scene-panel__submenu-pop">
          {MESH_KINDS.map(kind => {
            const Icon = ICONS[kind]
            return <button key={kind} type="button" onClick={() => onCreate(kind)}><Icon size={12} />{kindName(kind)}</button>
          })}
        </div>
      </div>
      <div className="scene-panel__submenu">
        <button type="button"><span><Sun size={12} />{t('menu.lights')}</span><ChevronRight size={12} /></button>
        <div className="scene-panel__submenu-pop">
          {LIGHT_KINDS.map(kind => {
            const Icon = ICONS[kind]
            return <button key={kind} type="button" onClick={() => onCreate(kind)}><Icon size={12} />{kindName(kind)}</button>
          })}
        </div>
      </div>
      <div className="scene-panel__submenu">
        <button type="button"><span><Package size={12} />{t('menu.devices')}</span><ChevronRight size={12} /></button>
        <div className="scene-panel__submenu-pop">
          <button type="button" onClick={() => onCreateDevice('interact')}><Circle size={12} />{t('interact.title')}</button>
          <button type="button" onClick={() => onCreateDevice('trigger')}><Box size={12} />{t('trigger.title')}</button>
          <button type="button" onClick={() => onCreateDevice('mover')}><Boxes size={12} />{t('mover.title')}</button>
          <button type="button" onClick={() => onCreateDevice('checkpoint')}><MapPin size={12} />{t('checkpoint.title')}</button>
          <button type="button" onClick={() => onCreateDevice('score')}><Sparkles size={12} />{t('score.title')}</button>
        </div>
      </div>
      <div className="scene-panel__sep" />
      <button type="button" onClick={() => onCreate('camera')}><Camera size={12} />{t('menu.camera')}</button>
      <button type="button" onClick={() => onCreate('effect')}><Sparkles size={12} />{t('menu.effect')}</button>
      <button type="button" onClick={() => onCreate('screen')}><PanelsTopLeft size={12} />{t('menu.screen')}</button>
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
  if (kind === 'effect') return '#ffb25a'
  if (kind === 'screen') return '#4a9eff'
  return '#999999'
}
