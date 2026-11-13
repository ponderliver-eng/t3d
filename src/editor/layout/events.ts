export const T3D_LAYOUT_RESET = 't3d-layout-reset'
export const T3D_SELECT_TAB = 't3d-select-tab'

export function resetLayout() {
  window.dispatchEvent(new Event(T3D_LAYOUT_RESET))
}

export function selectTab(tabId: string) {
  window.dispatchEvent(new CustomEvent(T3D_SELECT_TAB, { detail: tabId }))
}
