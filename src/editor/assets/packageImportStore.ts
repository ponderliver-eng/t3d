import { create } from 'zustand'

interface PackageImportState {
  file: File | null
  open: (file: File) => void
  close: () => void
}

let pickPackage: (() => void) | null = null

export function bindPackagePicker(pick: (() => void) | null) {
  pickPackage = pick
}

export function openPackagePicker() {
  pickPackage?.()
}

export const usePackageImportStore = create<PackageImportState>(set => ({
  file: null,
  open: file => set({ file }),
  close: () => set({ file: null }),
}))
