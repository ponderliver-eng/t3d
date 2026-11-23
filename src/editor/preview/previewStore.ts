import { create } from 'zustand'

export type PreviewKind = 'model' | 'texture' | 'material' | 'environment' | 'node-material' | 'animation' | 'audio' | 'document'

export interface PreviewWindow {
  id: string
  kind: PreviewKind
  assetId: string
  title: string
  x: number
  y: number
  z: number
}

interface PreviewState {
  windows: PreviewWindow[]
  nextZ: number
  openPreview: (kind: PreviewKind, assetId: string, title: string) => void
  closePreview: (id: string) => void
  bringToFront: (id: string) => void
  movePreview: (id: string, x: number, y: number) => void
}

export const usePreviewStore = create<PreviewState>(set => ({
  windows: [],
  nextZ: 30,
  openPreview: (kind, assetId, title) => set(state => {
    const id = `${kind}:${assetId}`
    const existing = state.windows.find(item => item.id === id)
    const z = state.nextZ + 1
    if (existing) {
      return {
        nextZ: z,
        windows: state.windows.map(item => item.id === id ? { ...item, title, z } : item),
      }
    }
    const offset = state.windows.length * 28
    return {
      nextZ: z,
      windows: [...state.windows, { id, kind, assetId, title, x: 180 + offset, y: 96 + offset, z }],
    }
  }),
  closePreview: id => set(state => ({ windows: state.windows.filter(item => item.id !== id) })),
  bringToFront: id => set(state => {
    const z = state.nextZ + 1
    return { nextZ: z, windows: state.windows.map(item => item.id === id ? { ...item, z } : item) }
  }),
  movePreview: (id, x, y) => set(state => ({
    windows: state.windows.map(item => item.id === id ? { ...item, x, y } : item),
  })),
}))

export function openAssetPreview(kind: PreviewKind, assetId: string, title: string) {
  usePreviewStore.getState().openPreview(kind, assetId, title)
}

export function popPreviewWindow(kind: PreviewKind, assetId: string) {
  const url = `${location.href.split('#')[0]}#preview/${kind}/${encodeURIComponent(assetId)}`
  window.open(url, `t3d-preview-${kind}-${assetId}`, 'popup=yes,width=1040,height=760')
}

export function readPreviewHash(): { kind: PreviewKind, assetId: string } | null {
  const match = location.hash.match(/^#preview\/(model|texture|material|environment|node-material|animation|audio|document)\/(.+)$/)
  if (!match) return null
  return { kind: match[1] as PreviewKind, assetId: decodeURIComponent(match[2]) }
}
