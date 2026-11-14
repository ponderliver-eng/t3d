import type { Vec3 } from './types'

export interface GroundSnap {
  id: string
  position: Vec3
}

let snapper: ((ids: string[]) => GroundSnap[]) | null = null

export function setGroundSnapper(next: ((ids: string[]) => GroundSnap[]) | null) {
  snapper = next
}

export function measureGroundSnap(ids: string[]): GroundSnap[] {
  return snapper?.(ids) ?? []
}
