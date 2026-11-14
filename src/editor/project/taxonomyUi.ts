import { create } from 'zustand'

interface TaxonomyUiState {
  tagsOpen: boolean
  layersOpen: boolean
  openTags: () => void
  openLayers: () => void
  close: () => void
}

export const useTaxonomyUi = create<TaxonomyUiState>(set => ({
  tagsOpen: false,
  layersOpen: false,
  openTags: () => set({ tagsOpen: true, layersOpen: false }),
  openLayers: () => set({ layersOpen: true, tagsOpen: false }),
  close: () => set({ tagsOpen: false, layersOpen: false }),
}))
