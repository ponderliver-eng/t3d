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
  past: UiDocument[]
  future: UiDocument[]
  overrides: Record<string, unknown>
  open: (assetId: string) => void
  close: () => void
  select: (id: string) => void
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
  past: [],
  future: [],
  overrides: {},
  open: assetId => {
    const document = readDocument(assetId)
    set({
      assetId,
      selectedId: document?.root.id ?? 'root',
      past: [],
      future: [],
      overrides: {},
    })
  },
  close: () => set({ assetId: null, past: [], future: [], overrides: {} }),
  select: id => set({ selectedId: id }),
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
    set({ selectedId: node.id })
  },
  removeSelected: () => {
    const assetId = get().assetId
    const document = assetId ? readDocument(assetId) : null
    const selectedId = get().selectedId
    if (!document || selectedId === document.root.id) return
    const parent = parentOf(document.root, selectedId)
    get().commit({ ...document, root: removeUiNode(document.root, selectedId) })
    set({ selectedId: parent?.id ?? document.root.id })
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
