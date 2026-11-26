import { create } from 'zustand'
import { useAssetStore } from '../assets/library'
import { translate } from '../i18n'
import { useEditorStore } from '../scene/store'
import type { UiDocument, UiNode, UiNodeType } from '../../runtime/ui/spec'
import { createUiNode, normalizeUiDocument } from '../../runtime/ui/spec'
import { containerIdFor, insertUiChild, parentOf, removeUiNode, shiftUiNode, mapUiNode } from '../../runtime/ui/tree'

interface UiEditorSession {
  assetId: string | null
  selectedId: string
  selectedIds: string[]
  past: UiDocument[]
  future: UiDocument[]
  overrides: Record<string, unknown>
  open: (assetId: string) => void
  close: () => void
  select: (id: string, mode?: 'replace' | 'toggle' | 'add' | 'keep') => void
  selectRange: (anchorId: string, targetId: string, orderedIds: string[]) => void
  selectIds: (ids: string[]) => void
  commit: (next: UiDocument) => void
  undo: () => boolean
  redo: () => boolean
  addNode: (type: UiNodeType) => void
  removeSelected: () => void
  shiftSelected: (delta: -1 | 1) => void
  setOverride: (bindingId: string, value: string) => void
}

export const useUiEditor = create<UiEditorSession>((set, get) => ({
  assetId: null,
  selectedId: 'root',
  selectedIds: ['root'],
  past: [],
  future: [],
  overrides: {},
  open: assetId => {
    const document = readDocument(assetId)
    const selectedId = document?.root.id ?? 'root'
    set({
      assetId,
      selectedId,
      selectedIds: [selectedId],
      past: [],
      future: [],
      overrides: {},
    })
  },
  close: () => set({ assetId: null, selectedIds: ['root'], past: [], future: [], overrides: {} }),
  select: (id, mode = 'replace') => set(state => {
    if (mode === 'toggle') {
      const has = state.selectedIds.includes(id)
      const next = has ? state.selectedIds.filter(item => item !== id) : [...state.selectedIds, id]
      const selectedIds = next.length > 0 ? next : [id]
      return { selectedIds, selectedId: selectedIds.includes(state.selectedId) ? state.selectedId : selectedIds[selectedIds.length - 1] }
    }
    if (mode === 'add') {
      const selectedIds = state.selectedIds.includes(id) ? state.selectedIds : [...state.selectedIds, id]
      return { selectedIds, selectedId: id }
    }
    if (mode === 'keep') return { selectedId: id }
    return { selectedId: id, selectedIds: [id] }
  }),
  selectRange: (anchorId, targetId, orderedIds) => {
    const start = orderedIds.indexOf(anchorId)
    const end = orderedIds.indexOf(targetId)
    if (start < 0 || end < 0) {
      set({ selectedId: targetId, selectedIds: [targetId] })
      return
    }
    const [from, to] = start < end ? [start, end] : [end, start]
    const selectedIds = orderedIds.slice(from, to + 1)
    set({ selectedId: targetId, selectedIds: selectedIds.length > 0 ? selectedIds : [targetId] })
  },
  selectIds: ids => set(() => {
    const selectedIds = [...new Set(ids.filter(Boolean))]
    if (selectedIds.length === 0) return {}
    return { selectedIds, selectedId: selectedIds[selectedIds.length - 1] }
  }),
  commit: next => {
    const assetId = get().assetId
    const current = assetId ? readDocument(assetId) : null
    if (!assetId || !current) return
    if (JSON.stringify(current) === JSON.stringify(next)) return
    useAssetStore.getState().updateUi(assetId, next)
    set(state => ({ past: [...state.past, current].slice(-80), future: [] }))
  },
  undo: () => {
    const assetId = get().assetId
    const previous = get().past.at(-1)
    const current = assetId ? readDocument(assetId) : null
    if (!assetId || !previous || !current) return false
    useAssetStore.getState().updateUi(assetId, previous)
    set(state => ({ past: state.past.slice(0, -1), future: [...state.future, current] }))
    return true
  },
  redo: () => {
    const assetId = get().assetId
    const next = get().future.at(-1)
    const current = assetId ? readDocument(assetId) : null
    if (!assetId || !next || !current) return false
    useAssetStore.getState().updateUi(assetId, next)
    set(state => ({ future: state.future.slice(0, -1), past: [...state.past, current] }))
    return true
  },
  addNode: type => {
    const assetId = get().assetId
    const document = assetId ? readDocument(assetId) : null
    if (!document) return
    const parentId = containerIdFor(document.root, get().selectedId)
    const node = createUiNode(type)
    node.name = nodeTypeName(type)
    get().commit({ ...document, root: insertUiChild(document.root, parentId, node) })
    set({ selectedId: node.id, selectedIds: [node.id] })
  },
  removeSelected: () => {
    const assetId = get().assetId
    const document = assetId ? readDocument(assetId) : null
    if (!document) return
    const ids = get().selectedIds.filter(id => id !== document.root.id)
    if (ids.length === 0) return
    const parent = parentOf(document.root, get().selectedId) ?? parentOf(document.root, ids[0])
    let root = document.root
    for (const id of ids) root = removeUiNode(root, id)
    get().commit({ ...document, root })
    const selectedId = parent?.id ?? document.root.id
    set({ selectedId, selectedIds: [selectedId] })
  },
  shiftSelected: delta => {
    const assetId = get().assetId
    const document = assetId ? readDocument(assetId) : null
    if (!document) return
    get().commit({ ...document, root: shiftUiNode(document.root, get().selectedId, delta) })
  },
  setOverride: (bindingId, value) => set(state => {
    const overrides = { ...state.overrides }
    if (value.trim() === '') delete overrides[bindingId]
    else overrides[bindingId] = value
    return { overrides }
  }),
}))

function nodeTypeName(type: UiNodeType): string {
  switch (type) {
    case 'panel': return translate('ui.type.panel')
    case 'stack': return translate('ui.type.stack')
    case 'text': return translate('ui.type.text')
    case 'fps': return translate('ui.type.fps')
    case 'image': return translate('ui.type.image')
    case 'button': return translate('ui.type.button')
    case 'progress': return translate('ui.type.progress')
  }
}

export function readDocument(assetId: string): UiDocument | null {
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset || asset.kind !== 'ui') return null
  return normalizeUiDocument(asset.document)
}

export function isUiEditorOpen(): boolean {
  return useUiEditor.getState().assetId !== null
}

export function openUiEditor(assetId: string): void {
  useUiEditor.getState().open(assetId)
}

export function patchSelected(patch: Partial<UiNode>): void {
  const session = useUiEditor.getState()
  const document = session.assetId ? readDocument(session.assetId) : null
  if (!document) return
  session.commit({
    ...document,
    root: mapUiNode(document.root, session.selectedId, node => ({ ...node, ...patch })),
  })
}

export function undoUiDocument(): boolean {
  if (!isUiEditorOpen()) return false
  return useUiEditor.getState().undo()
}

export function redoUiDocument(): boolean {
  if (!isUiEditorOpen()) return false
  return useUiEditor.getState().redo()
}

export function undoActive(): void {
  if (isUiEditorOpen()) {
    useUiEditor.getState().undo()
    return
  }
  useEditorStore.getState().undo()
}

export function redoActive(): void {
  if (isUiEditorOpen()) {
    useUiEditor.getState().redo()
    return
  }
  useEditorStore.getState().redo()
}
