import type { RecastBakeConfig } from './defaults'
import type { Vec3 } from '../../editor/scene/types'

export interface NavObstacleDesc {
  id: string
  position: Vec3
  radius: number
  height: number
}

export interface NavDebugMesh {
  positions: Float32Array
  indices: Uint32Array
}

export interface NavRecord {
  bytes: Uint8Array
  mode: 'solo' | 'tileCache'
}

/** 试玩和烘焙只依赖这个接口。Recast 留在实现文件里。 */
export interface NavigationWorld {
  bake(positions: Float32Array, indices: Uint32Array, config: RecastBakeConfig, signal: AbortSignal): Promise<void>
  restore(record: NavRecord): Promise<void>
  clear(): void
  obstacles(items: NavObstacleDesc[]): void
  findPath(start: Vec3, end: Vec3): Vec3[] | null
  debug(): NavDebugMesh | null
  exportRecord(): NavRecord | null
  dispose(): void
}
