import { createContext, createElement, useContext, useLayoutEffect, useRef, type ReactNode, type UIEvent } from 'react'
import { create } from 'zustand'

const STORAGE_KEY = 't3d-inspector-memory'

interface InspectorEntry {
  scroll: number
  open: Record<string, boolean>
  slot: number | null
}

interface InspectorMemoryState {
  entries: Record<string, InspectorEntry>
  setOpen: (subject: string, card: string, open: boolean) => void
  setScroll: (subject: string, scroll: number) => void
  setSlot: (subject: string, slot: number | null) => void
}

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
}))

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
