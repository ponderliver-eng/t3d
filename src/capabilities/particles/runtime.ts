import type { Object3D, Side, Texture } from 'three'
import type { ParticleBlend } from '../../editor/scene/types'

/** 特效资源里的模拟。system 是单个粒子系统；loader 是 Quarks 的对象 JSON。 */
export interface StoredSimulation {
  format: 'system' | 'loader'
  body: unknown
}

export interface ParticleMaterialDesc {
  color: string
  opacity: number
  map: Texture | null
  blend: ParticleBlend
  depthWrite: boolean
  depthTest: boolean
  side: Side
}

export interface ParticleInstanceDesc {
  id: string
  parent: Object3D
  simulation: StoredSimulation
  /** 空着表示用模拟自带的材质（loader）或默认叠加。 */
  material: ParticleMaterialDesc | null
  playing: boolean
  visible: boolean
}

/** 视口只依赖这个接口。three.quarks 留在 quarksRuntime.ts。 */
export interface ParticleRuntime {
  sync(instances: ParticleInstanceDesc[]): void
  update(dt: number): void
  dispose(): void
  issue(id: string): string | null
}
