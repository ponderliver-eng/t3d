import { create } from 'zustand'
import { CUTSCENE_CAPABILITY_ID, normalizeCutsceneDocument } from '../../capabilities/cutscene/schema'
import { dockCutsceneTab, selectTab, undockCutsceneTab } from '../layout/events'
import { useEditorStore } from '../scene/store'

export type CutsceneWindowMode = 'closed' | 'floating' | 'docked'

interface CutsceneWindowState {
  mode: CutsceneWindowMode
  x: number
  y: number
  width: number
  height: number
  setMode: (mode: CutsceneWindowMode) => void
  openFloating: () => void
  dockToBottom: () => void
  close: () => void
  toggle: () => void
  setBounds: (patch: Partial<{ x: number; y: number; width: number; height: number }>) => void
}

export const useCutsceneWindowStore = create<CutsceneWindowState>((set, get) => ({
  mode: 'closed',
  x: 140,
  y: 120,
  width: 980,
  height: 380,
  setMode: (mode) => set({ mode }),
  openFloating: () => {
    set({ mode: 'floating' })
    undockCutsceneTab()
  },
  dockToBottom: () => {
    set({ mode: 'docked' })
    dockCutsceneTab()
  },
  close: () => {
    set({ mode: 'closed' })
    undockCutsceneTab()
  },
  toggle: () => {
    const cur = get().mode
    if (cur === 'closed') get().openFloating()
    else get().close()
  },
  setBounds: (patch) => set((state) => ({ ...state, ...patch })),
}))

export function openCutsceneAsset(assetId: string): void {
  const editor = useEditorStore.getState()
  const doc = normalizeCutsceneDocument(editor.picture.capabilities?.[CUTSCENE_CAPABILITY_ID])
  editor.setPicture({
    capabilities: {
      ...(editor.picture.capabilities ?? {}),
      [CUTSCENE_CAPABILITY_ID]: { ...doc, activeAssetId: assetId },
    },
  })
  const store = useCutsceneWindowStore.getState()
  if (store.mode === 'docked') {
    selectTab('tab-cutscene')
  } else {
    store.openFloating()
  }
}
