import { createContext, createElement, useContext, useLayoutEffect, useRef, type ReactNode, type UIEvent } from 'react'
import { create } from 'zustand'
import { selectTab } from '../layout/events'
import { useEditorStore } from '../scene/store'

const STORAGE_KEY = 't3d-inspector-memory'

interface InspectorEntry {
  scroll: number
  open: Record<string, boolean>
  slot: number | null
}

export interface MaterialSlotFocus {
  nodeId: string
  slot: number
  nonce: number
}

export interface SubSelection {
  nodeId: string
  path: string
  name: string
  kind: 'mesh' | 'bone' | 'node'
  slotIndices: number[]
}

export interface PartFlashRequest {
  nodeId: string
  path: string
  nonce: number
}

interface InspectorMemoryState {
  entries: Record<string, InspectorEntry>
  materialFocus: MaterialSlotFocus | null
  subSelection: SubSelection | null
  partFlashRequest: PartFlashRequest | null
  setOpen: (subject: string, card: string, open: boolean) => void
  setScroll: (subject: string, scroll: number) => void
  setSlot: (subject: string, slot: number | null) => void
  focusMaterialSlot: (nodeId: string, slot: number) => void
  selectSubItem: (item: SubSelection, options?: { openInspector?: boolean; flash?: boolean }) => void
  clearSubSelection: () => void
}

let materialFocusNonce = 0
let partFlashNonce = 0

function load(): Record<string, InspectorEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, InspectorEntry>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

let persistTimer = 0
let latest: Record<string, InspectorEntry> | null = null

function schedulePersist(entries: Record<string, InspectorEntry>) {
  latest = entries
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  }, 200)
}

window.addEventListener('pagehide', () => {
  if (!latest) return
  window.clearTimeout(persistTimer)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(latest))
})

export const useInspectorMemory = create<InspectorMemoryState>(set => ({
  entries: load(),
  materialFocus: null,
  subSelection: null,
  partFlashRequest: null,
  setOpen: (subject, card, open) => set(state => {
    const prev = state.entries[subject] ?? { scroll: 0, open: {}, slot: null }
    const prevOpen = prev.open ?? {}
    if (prevOpen[card] === open) return state
    const entries = { ...state.entries, [subject]: { ...prev, open: { ...prevOpen, [card]: open } } }
    schedulePersist(entries)
    return { entries }
  }),
  setScroll: (subject, scroll) => set(state => {
    const prev = state.entries[subject] ?? { scroll: 0, open: {}, slot: null }
    if (prev.scroll === scroll) return state
    const entries = { ...state.entries, [subject]: { ...prev, scroll } }
    schedulePersist(entries)
    return { entries }
  }),
  setSlot: (subject, slot) => set(state => {
    const prev = state.entries[subject] ?? { scroll: 0, open: {}, slot: null }
    if (prev.slot === slot && state.entries[subject]) return state
    const entries = { ...state.entries, [subject]: { ...prev, slot } }
    schedulePersist(entries)
    return { entries }
  }),
  focusMaterialSlot: (nodeId, slot) => {
    useEditorStore.getState().setSelection([nodeId])
    useEditorStore.getState().setSidePanel('inspector')
    selectTab('tab-inspector')
    materialFocusNonce += 1
    const nonce = materialFocusNonce
    set(state => {
      const subject = `node:${nodeId}`
      const prev = state.entries[subject] ?? { scroll: 0, open: {}, slot: null }
      const entries = {
        ...state.entries,
        [subject]: {
          ...prev,
          open: { ...prev.open, 'model-renderer': true, 'material-slots': true },
          slot,
        },
      }
      schedulePersist(entries)
      return { entries, materialFocus: { nodeId, slot, nonce } }
    })
  },
  selectSubItem: (item, options) => {
    const store = useEditorStore.getState()
    if (store.selection.length !== 1 || store.selection[0] !== item.nodeId) {
      store.setSelection([item.nodeId])
    }
    if (options?.openInspector) {
      store.setSidePanel('inspector')
      selectTab('tab-inspector')
    }
    const firstSlot = item.kind === 'mesh' ? item.slotIndices[0] : undefined
    let materialFocus: MaterialSlotFocus | null | undefined
    if (typeof firstSlot === 'number') {
      materialFocusNonce += 1
      materialFocus = { nodeId: item.nodeId, slot: firstSlot, nonce: materialFocusNonce }
    }
    let partFlashRequest: PartFlashRequest | undefined
    if (options?.flash && item.kind === 'mesh') {
      partFlashNonce += 1
      partFlashRequest = { nodeId: item.nodeId, path: item.path, nonce: partFlashNonce }
    }
    set(state => {
      if (typeof firstSlot !== 'number') {
        return {
          subSelection: item,
          ...(partFlashRequest ? { partFlashRequest } : {}),
        }
      }
      const subject = `node:${item.nodeId}`
      const prev = state.entries[subject] ?? { scroll: 0, open: {}, slot: null }
      const entries = {
        ...state.entries,
        [subject]: {
          ...prev,
          open: { ...prev.open, 'model-renderer': true, 'material-slots': true },
          slot: firstSlot,
        },
      }
      schedulePersist(entries)
      return {
        entries,
        subSelection: item,
        materialFocus: materialFocus ?? state.materialFocus,
        ...(partFlashRequest ? { partFlashRequest } : {}),
      }
    })
  },
  clearSubSelection: () => set(state => (state.subSelection ? { subSelection: null } : state)),
}))

useEditorStore.subscribe(state => {
  const sub = useInspectorMemory.getState().subSelection
  if (!sub) return
  if (state.selection.length !== 1 || state.selection[0] !== sub.nodeId) {
    useInspectorMemory.getState().clearSubSelection()
  }
})

export const InspectorSubject = createContext('inspector')

export function InspectorFrame({ subject, children }: { subject: string, children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = useInspectorMemory.getState().entries[subject]?.scroll ?? 0
  }, [subject])
  return createElement(
    InspectorSubject.Provider,
    { value: subject },
    createElement(
      'div',
      {
        className: 'inspector',
        ref,
        onScroll: (event: UIEvent<HTMLDivElement>) => {
          useInspectorMemory.getState().setScroll(subject, event.currentTarget.scrollTop)
        },
      },
      children,
    ),
  )
}

export function useInspectorSlot(): [number | null | undefined, (slot: number | null) => void] {
  const subject = useContext(InspectorSubject)
  const slot = useInspectorMemory(state => state.entries[subject]?.slot)
  const setSlot = (next: number | null) => useInspectorMemory.getState().setSlot(subject, next)
  return [slot, setSlot]
}

export function useInspectorCardOpen(card: string): [boolean, (open: boolean) => void] {
  const subject = useContext(InspectorSubject)
  const open = useInspectorMemory(state => state.entries[subject]?.open?.[card] ?? true)
  const setOpen = (next: boolean) => useInspectorMemory.getState().setOpen(subject, card, next)
  return [open, setOpen]
}
