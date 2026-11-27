import { create } from 'zustand'
import { useCodeAssetStore, type CodeAssetKind } from '../../core/codeAssets/workspace'
import { useEditorStore } from '../scene/store'
import { ASSETS_ROOT, normalizeDir } from './folders'
import { useAssetStore } from './library'

export const PROJECT_ITEMS_MIME = 'application/x-t3d-project-items'

export type ProjectItemKey =
  | `dir:${string}`
  | `asset:${string}`
  | `code:script:${string}`
  | `code:shader:${string}`

export type ParsedProjectItemKey =
  | { type: 'dir'; path: string; key: ProjectItemKey }
  | { type: 'asset'; id: string; key: ProjectItemKey }
  | { type: 'code'; kind: CodeAssetKind; id: string; key: ProjectItemKey }

export function dirItemKey(path: string): ProjectItemKey {
  return `dir:${normalizeDir(path)}`
}

export function assetItemKey(id: string): ProjectItemKey {
  return `asset:${id}`
}

export function codeItemKey(kind: CodeAssetKind, id: string): ProjectItemKey {
  return `code:${kind}:${id}`
}

export function parseProjectItemKey(raw: string): ParsedProjectItemKey | null {
  if (raw.startsWith('dir:')) {
    const path = normalizeDir(raw.slice(4))
    return { type: 'dir', path, key: `dir:${path}` }
  }
  if (raw.startsWith('asset:')) {
    const id = raw.slice(6)
    if (!id) return null
    return { type: 'asset', id, key: `asset:${id}` }
  }
  if (raw.startsWith('code:script:')) {
    const id = raw.slice('code:script:'.length)
    if (!id) return null
    return { type: 'code', kind: 'script', id, key: `code:script:${id}` }
  }
  if (raw.startsWith('code:shader:')) {
    const id = raw.slice('code:shader:'.length)
    if (!id) return null
    return { type: 'code', kind: 'shader', id, key: `code:shader:${id}` }
  }
  return null
}

export interface ProjectClipboard {
  mode: 'copy' | 'cut'
  keys: ProjectItemKey[]
}

interface ProjectSelectionState {
  selectedKeys: ProjectItemKey[]
  anchorKey: ProjectItemKey | null
  clipboard: ProjectClipboard | null
  setSelectedKeys: (keys: ProjectItemKey[], anchor?: ProjectItemKey | null) => void
  clearSelection: () => void
  setClipboard: (clipboard: ProjectClipboard | null) => void
}

let internalSyncing = false

function sanitizeKeys(keys: readonly ProjectItemKey[]): ProjectItemKey[] {
  const out: ProjectItemKey[] = []
  const seen = new Set<ProjectItemKey>()
  for (const raw of keys) {
    const parsed = parseProjectItemKey(raw)
    if (!parsed) continue
    if (parsed.type === 'dir' && parsed.path === ASSETS_ROOT) continue
    if (seen.has(parsed.key)) continue
    seen.add(parsed.key)
    out.push(parsed.key)
  }
  return out
}

function sameKeys(a: readonly ProjectItemKey[], b: readonly ProjectItemKey[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export const useProjectSelectionStore = create<ProjectSelectionState>((set, get) => ({
  selectedKeys: [],
  anchorKey: null,
  clipboard: null,
  setSelectedKeys: (keys, anchor) => {
    const clean = sanitizeKeys(keys)
    const nextAnchor = anchor !== undefined ? anchor : (clean.at(-1) ?? null)
    const prev = get()
    if (sameKeys(prev.selectedKeys, clean) && prev.anchorKey === nextAnchor) {
      syncExternalStoresFromProjectSelection(clean)
      return
    }
    set({ selectedKeys: clean, anchorKey: nextAnchor })
    syncExternalStoresFromProjectSelection(clean)
  },
  clearSelection: () => {
    const prev = get()
    if (prev.selectedKeys.length === 0 && prev.anchorKey === null) return
    set({ selectedKeys: [], anchorKey: null })
    syncExternalStoresFromProjectSelection([])
  },
  setClipboard: clipboard => {
    if (!clipboard) {
      set({ clipboard: null })
      return
    }
    const clean = sanitizeKeys(clipboard.keys)
    set({ clipboard: clean.length > 0 ? { mode: clipboard.mode, keys: clean } : null })
  },
}))

function syncExternalStoresFromProjectSelection(keys: readonly ProjectItemKey[]) {
  internalSyncing = true
  try {
    if (keys.length === 1) {
      const single = parseProjectItemKey(keys[0]!)
      if (single?.type === 'asset') {
        useCodeAssetStore.getState().selectAsset(null)
        const editor = useEditorStore.getState()
        if (editor.inspectedAssetId !== single.id || editor.selection.length > 0) {
          useEditorStore.setState({ inspectedAssetId: single.id, selection: [] })
        }
        return
      }
      if (single?.type === 'code') {
        const editor = useEditorStore.getState()
        if (editor.inspectedAssetId !== null || editor.selection.length > 0) {
          useEditorStore.setState({ inspectedAssetId: null, selection: [] })
        }
        if (useCodeAssetStore.getState().selectedId !== single.id) {
          useCodeAssetStore.getState().selectAsset(single.id)
        }
        return
      }
    }
    // 0 项、目录项或多项选中：清空场景物体选中与单资产检查态
    useCodeAssetStore.getState().selectAsset(null)
    const editor = useEditorStore.getState()
    if (keys.length > 0) {
      if (editor.inspectedAssetId !== null || editor.selection.length > 0) {
        useEditorStore.setState({ inspectedAssetId: null, selection: [] })
      }
    } else if (editor.inspectedAssetId !== null) {
      useEditorStore.setState({ inspectedAssetId: null })
    }
  } finally {
    internalSyncing = false
  }
}

let syncBound = false

export function bindProjectSelectionSync(): void {
  if (syncBound) return
  syncBound = true

  useEditorStore.subscribe((state, prev) => {
    if (internalSyncing) return
    if (state.selection.length > 0 && useProjectSelectionStore.getState().selectedKeys.length > 0) {
      useProjectSelectionStore.setState({ selectedKeys: [], anchorKey: null })
      return
    }
    if (state.inspectedAssetId !== prev.inspectedAssetId && state.inspectedAssetId) {
      const target = assetItemKey(state.inspectedAssetId)
      const current = useProjectSelectionStore.getState().selectedKeys
      if (current.length !== 1 || current[0] !== target) {
        useProjectSelectionStore.setState({ selectedKeys: [target], anchorKey: target })
      }
    }
  })

  useCodeAssetStore.subscribe((state, prev) => {
    if (internalSyncing) return
    if (state.selectedId !== prev.selectedId && state.selectedId) {
      const record = state.assets[state.selectedId]
      if (!record) return
      const target = codeItemKey(record.kind, record.id)
      const current = useProjectSelectionStore.getState().selectedKeys
      if (current.length !== 1 || current[0] !== target) {
        useProjectSelectionStore.setState({ selectedKeys: [target], anchorKey: target })
      }
    }
  })

  // 当资产或目录从库里移除时，自动剔除失效的选中键
  useAssetStore.subscribe((state, prev) => {
    if (state.assets === prev.assets && state.folders === prev.folders && state.assetDirs === prev.assetDirs) return
    const sel = useProjectSelectionStore.getState()
    if (sel.selectedKeys.length === 0 && !sel.clipboard) return
    const validDirSet = new Set<string>(state.folders.map(normalizeDir))
    for (const dir of Object.values(state.assetDirs)) validDirSet.add(normalizeDir(dir))
    const isAlive = (key: ProjectItemKey): boolean => {
      const parsed = parseProjectItemKey(key)
      if (!parsed) return false
      if (parsed.type === 'asset') return Boolean(state.assets[parsed.id])
      if (parsed.type === 'code') return Boolean(useCodeAssetStore.getState().assets[parsed.id])
      for (const dir of validDirSet) {
        if (dir === parsed.path || dir.startsWith(`${parsed.path}/`)) return true
      }
      return false
    }
    const nextSelected = sel.selectedKeys.filter(isAlive)
    const nextClipKeys = sel.clipboard ? sel.clipboard.keys.filter(isAlive) : []
    const selChanged = !sameKeys(nextSelected, sel.selectedKeys)
    const clipChanged = Boolean(sel.clipboard) && !sameKeys(nextClipKeys, sel.clipboard!.keys)
    if (selChanged || clipChanged) {
      useProjectSelectionStore.setState({
        ...(selChanged ? { selectedKeys: nextSelected, anchorKey: nextSelected.includes(sel.anchorKey as ProjectItemKey) ? sel.anchorKey : (nextSelected.at(-1) ?? null) } : {}),
        ...(clipChanged ? { clipboard: nextClipKeys.length > 0 ? { mode: sel.clipboard!.mode, keys: nextClipKeys } : null } : {}),
      })
    }
  })
}

let activeDragKeys: ProjectItemKey[] = []

export function beginProjectDrag(keys: readonly ProjectItemKey[], event?: React.DragEvent): ProjectItemKey[] {
  const clean = sanitizeKeys(keys)
  activeDragKeys = clean
  if (event && clean.length > 0) {
    event.dataTransfer.setData(PROJECT_ITEMS_MIME, JSON.stringify(clean))
    if (clean.length > 1 && typeof document !== 'undefined') {
      const ghost = document.createElement('div')
      ghost.className = 'project-drag-ghost'
      ghost.textContent = `已选择 ${clean.length} 项`
      document.body.appendChild(ghost)
      event.dataTransfer.setDragImage(ghost, -8, 12)
      window.requestAnimationFrame(() => {
        ghost.remove()
      })
    }
  }
  const clear = () => {
    activeDragKeys = []
    window.removeEventListener('dragend', clear, true)
    window.removeEventListener('drop', clear, true)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('dragend', clear, true)
    window.addEventListener('drop', clear, true)
  }
  return clean
}

export function getActiveProjectDragKeys(): readonly ProjectItemKey[] {
  return activeDragKeys
}

export function readDraggedProjectKeys(dataTransfer: DataTransfer): ProjectItemKey[] {
  const raw = dataTransfer.getData(PROJECT_ITEMS_MIME)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return sanitizeKeys(parsed.filter((v): v is ProjectItemKey => typeof v === 'string'))
      }
    } catch {
      // ignore malformed payload
    }
  }
  if (activeDragKeys.length > 0) return [...activeDragKeys]
  return []
}

export function computeNextSelectionOnClick(
  clickedKey: ProjectItemKey,
  visibleKeys: readonly ProjectItemKey[],
  currentKeys: readonly ProjectItemKey[],
  anchorKey: ProjectItemKey | null,
  modifiers: { ctrlOrMeta: boolean; shift: boolean },
): { keys: ProjectItemKey[]; anchor: ProjectItemKey | null } {
  if (modifiers.shift) {
    const startKey = anchorKey && visibleKeys.includes(anchorKey) ? anchorKey : (currentKeys.at(-1) ?? clickedKey)
    const a = visibleKeys.indexOf(startKey)
    const b = visibleKeys.indexOf(clickedKey)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      const range = visibleKeys.slice(lo, hi + 1)
      const next = modifiers.ctrlOrMeta
        ? sanitizeKeys([...currentKeys, ...range])
        : sanitizeKeys(range)
      return { keys: next, anchor: startKey }
    }
  }
  if (modifiers.ctrlOrMeta) {
    const exists = currentKeys.includes(clickedKey)
    const next = exists
      ? currentKeys.filter(k => k !== clickedKey)
      : [...currentKeys, clickedKey]
    return { keys: sanitizeKeys(next), anchor: clickedKey }
  }
  return { keys: sanitizeKeys([clickedKey]), anchor: clickedKey }
}
