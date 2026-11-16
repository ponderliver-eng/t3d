import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown, ArrowDownToLine, ArrowUp, Axis3d, Box, Boxes, Camera, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Circle, ClipboardPaste, Component, Cone, Copy, CopyPlus, Cylinder, ExternalLink, Eye, EyeOff,
  Flashlight, Focus, Group, Lightbulb, Lock, MapPin, Package, PanelsTopLeft, Pencil, Pill, Plus, Search, Sparkles, Square, Sun, Sunrise, Trash2, Undo2, Ungroup, Unlink, Unlock, Upload, X,
} from 'lucide-react'
import { readClipDrag } from '../animation/playback'
import { assignClip } from '../assets/import'
import { assetDirectory, useAssetStore } from '../assets/library'
import { instanceDirty, isPrefabRoot } from '../assets/prefab'
import { translate, useI18n, type MessageKey } from '../i18n'
import { TAG_FILTER_UNTAGGED, sortedTags } from '../project/taxonomy'
import { childrenOf, isLight, isMesh, LIGHT_KINDS, MESH_KINDS } from '../scene/kinds'
import { useEditorStore, primaryId, type DeviceKind } from '../scene/store'
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

export default function HierarchyPanel() {
  const nodes = useEditorStore(state => state.nodes)
  const selection = useEditorStore(state => state.selection)
  const playing = useEditorStore(state => state.playState !== 'stopped')
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState('all')
  const tags = useEditorStore(state => state.tags)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [drop, setDrop] = useState<{ id: string, zone: 'before' | 'into' | 'after' } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null } | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [savePrefab, setSavePrefab] = useState<{ id: string, name: string, dir?: string } | null>(null)
  const [unpackId, setUnpackId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const renameTimer = useRef<number | null>(null)
  const dragged = useRef(false)
  const pointerDrag = useRef<{ id: string, x: number, y: number, active: boolean } | null>(null)
  const dropLive = useRef<{ id: string, zone: DropZone } | null>(null)
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
      const nameOk = !q || node.name.toLowerCase().includes(q)
      const tagged = Boolean(node.tagId) || (node.tagIds?.length ?? 0) > 0
      const tagOk = tagFilter === 'all'
        || (tagFilter === TAG_FILTER_UNTAGGED ? !tagged : node.tagId === tagFilter || node.tagIds?.includes(tagFilter))
      const self = nameOk && tagOk
      const child = childrenOf(nodes, id).some(item => visit(item.id))
      const ok = self || child
      cache.set(id, ok)
      return ok
    }
    if (q || tagFilter !== 'all') Object.keys(nodes).forEach(visit)
    return cache
  }, [nodes, q, tagFilter])

  const visibleRows = useMemo(() => {
    const rows: { node: SceneNode; depth: number }[] = []
    const walk = (parentId: string | null, depth: number) => {
      for (const node of childrenOf(nodes, parentId)) {
        if ((q || tagFilter !== 'all') && !matches.get(node.id)) continue
        rows.push({ node, depth })
        const open = q || tagFilter !== 'all' ? true : !collapsed[node.id]
        if (open) walk(node.id, depth + 1)
      }
    }
    walk(null, 0)
    return rows
  }, [nodes, collapsed, q, tagFilter, matches])

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

  const beginRowDrag = (event: ReactPointerEvent, id: string) => {
    if (playing || event.button !== 0) return
    if ((event.target as HTMLElement).closest('button, input')) return
    pointerDrag.current = { id, x: event.clientX, y: event.clientY, active: false }
    const move = (pointer: globalThis.PointerEvent) => {
      const drag = pointerDrag.current
      if (!drag) return
      if (!drag.active) {
        const dx = pointer.clientX - drag.x
        const dy = pointer.clientY - drag.y
        if (dx * dx + dy * dy < 16) return
        drag.active = true
        dragged.current = true
      }
      document.querySelectorAll('.is-prefab-drop').forEach(element => element.classList.remove('is-prefab-drop'))
      const folder = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-asset-dir]')
      if (folder) {
        folder.classList.add('is-prefab-drop')
        dropLive.current = null
        setDrop(null)
        return
      }
      const row = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-node-id]')
      const targetId = row?.dataset.nodeId ?? null
      if (!targetId || targetId === drag.id || isUnder(useEditorStore.getState().nodes, targetId, drag.id)) {
        dropLive.current = null
        setDrop(null)
        return
      }
      const rect = row!.getBoundingClientRect()
      const ratio = (pointer.clientY - rect.top) / Math.max(rect.height, 1)
      const zone: DropZone = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'into'
      dropLive.current = { id: targetId, zone }
      setDrop(dropLive.current)
    }
    const up = (pointer: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const drag = pointerDrag.current
      pointerDrag.current = null
      const current = dropLive.current
      dropLive.current = null
      setDrop(null)
      document.querySelectorAll('.is-prefab-drop').forEach(element => element.classList.remove('is-prefab-drop'))
      const folder = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-asset-dir]')
      if (drag?.active && folder) {
        const node = useEditorStore.getState().nodes[drag.id]
        if (!node) return
        if (node.prefabInstanceId === node.id) {
          useEditorStore.getState().log('warn', translate('prefab.alreadyInstance'))
          return
        }
        setSavePrefab({ id: node.id, name: node.name, dir: folder.dataset.assetDir })
        return
      }
      if (!drag?.active) return
      const ids = dragIds(drag.id, useEditorStore.getState().selection)
      const target = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-node-id]')
      const targetId = target?.dataset.nodeId ?? current?.id ?? null
      if (!targetId) {
        useEditorStore.getState().placeNodes(ids, null, 'end')
        return
      }
      const zone = current?.id === targetId ? current.zone : 'into'
      const targetNode = useEditorStore.getState().nodes[targetId]
      if (!targetNode || ids.includes(targetId)) return
      if (zone === 'into') {
        useEditorStore.getState().placeNodes(ids, targetId, 'into')
        setCollapsed(state => {
          const next = { ...state }
          delete next[targetId]
          return next
        })
      } else {
        useEditorStore.getState().placeNodes(ids, targetNode.parentId, zone, targetId)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
                drop?.id === node.id ? `scene-item--${drop.zone}` : '',
                node.prefabAssetId || node.nestedPrefabId ? 'scene-item--prefab' : '',
                isPrefabRoot(node) ? 'scene-item--prefab-root' : '',
                node.visible ? '' : 'scene-item--hidden',
                ancestorHidden(nodes, node.id) ? 'scene-item--ancestor-hidden' : '',
              ].filter(Boolean).join(' ')}
              style={{ paddingLeft: 6 + depth * 14 }}
              data-node-id={node.id}
              title={t('hierarchy.hint')}
              onDragOver={event => {
                const types = [...event.dataTransfer.types]
                if (!types.includes('application/x-t3d-asset') && !types.includes('application/x-t3d-clip')) return
                event.preventDefault()
                event.stopPropagation()
              }}
              onDrop={event => {
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
              onPointerDown={event => beginRowDrag(event, node.id)}
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
