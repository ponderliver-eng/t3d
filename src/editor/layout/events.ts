export const T3D_LAYOUT_RESET = 't3d-layout-reset'
export const T3D_SELECT_TAB = 't3d-select-tab'
export const T3D_DOCK_CUTSCENE = 't3d-dock-cutscene'
export const T3D_UNDOCK_CUTSCENE = 't3d-undock-cutscene'

export function resetLayout() {
  window.dispatchEvent(new Event(T3D_LAYOUT_RESET))
}

export function selectTab(tabId: string) {
  window.dispatchEvent(new CustomEvent(T3D_SELECT_TAB, { detail: tabId }))
}

export function dockCutsceneTab() {
  window.dispatchEvent(new Event(T3D_DOCK_CUTSCENE))
}

export function undockCutsceneTab() {
  window.dispatchEvent(new Event(T3D_UNDOCK_CUTSCENE))
}
