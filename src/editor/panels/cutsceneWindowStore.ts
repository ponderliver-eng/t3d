import { create } from 'zustand'
import { CUTSCENE_CAPABILITY_ID, normalizeCutsceneDocument } from '../../capabilities/cutscene/schema'
import { selectTab } from '../layout/events'
import { useEditorStore } from '../scene/store'

interface CutsceneWindowState {
  floating: boolean
  x: number
  y: number
  width: number
  height: number
  setFloating: (floating: boolean) => void
  setBounds: (patch: Partial<{ x: number; y: number; width: number; height: number }>) => void
}

export const useCutsceneWindowStore = create<CutsceneWindowState>((set) => ({
  floating: false,
  x: 120,
  y: 120,
  width: 960,
  height: 360,
  setFloating: (floating) => set({ floating }),
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
  if (!useCutsceneWindowStore.getState().floating) {
    selectTab('tab-cutscene')
  }
}
