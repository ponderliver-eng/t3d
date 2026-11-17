import { create } from 'zustand'

interface HubUi {
  open: boolean
  show: () => void
  close: () => void
}

export const useGameplayHub = create<HubUi>(set => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}))

export function openGameplayHub() {
  useGameplayHub.setState({ open: true })
}

export function closeGameplayHub() {
  useGameplayHub.setState({ open: false })
}
