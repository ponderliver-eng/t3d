import type { EditorView, Vec3 } from './types'

export interface GroundSnap {
  id: string
  position: Vec3
}

let snapper: ((ids: string[]) => GroundSnap[]) | null = null
let readViewport: (() => ViewportPose | null) | null = null
let placeViewport: ((position: Vec3, quaternion: [number, number, number, number]) => void) | null = null

export interface ViewportPose {
  position: Vec3
  quaternion: [number, number, number, number]
}

export function setGroundSnapper(next: ((ids: string[]) => GroundSnap[]) | null) {
  snapper = next
}

export function measureGroundSnap(ids: string[]): GroundSnap[] {
  return snapper?.(ids) ?? []
}

export function setViewportAlign(next: {
  read: () => ViewportPose | null
  place: (position: Vec3, quaternion: [number, number, number, number]) => void
} | null) {
  readViewport = next?.read ?? null
  placeViewport = next?.place ?? null
}

let readEditorView: (() => EditorView | null) | null = null
let applyEditorView: ((view: EditorView) => void) | null = null

export function setEditorViewBridge(next: {
  read: () => EditorView | null
  apply: (view: EditorView) => void
} | null) {
  readEditorView = next?.read ?? null
  applyEditorView = next?.apply ?? null
}

export function readEditorViewPose(): EditorView | null {
  return readEditorView?.() ?? null
}

export function applyEditorViewPose(view: EditorView) {
  applyEditorView?.(view)
}

export function readViewportPose(): ViewportPose | null {
  return readViewport?.() ?? null
}

export function placeViewportAt(position: Vec3, quaternion: [number, number, number, number]) {
  placeViewport?.(position, quaternion)
}
