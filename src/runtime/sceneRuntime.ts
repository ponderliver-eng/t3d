import type { Group } from 'three'
import { tickPhysics } from '../capabilities/physics/session'
import { tickNavigation } from '../capabilities/navigation/session'
import { tickParticles } from '../capabilities/particles/session'
import type { SceneNode, Vec3 } from '../editor/scene/types'

/**
 * 核心玩法包（Core Pack）与领域包（Domain Packs）在节点上的统一挂载契约。
 * 保持与编辑器 UI 解耦，试玩（Play）和未来独立导出（Player）共用同一份规格与步进顺序。
 */
export interface CharacterSpec {
  enabled: boolean
  moveSpeed: number
  sprintSpeed: number
  jumpHeight: number
  gravity: number
  radius: number
  height: number
  idleClip?: string
  walkClip?: string
  runClip?: string
  jumpClip?: string
}

export interface CameraFollowSpec {
  enabled: boolean
  targetNodeId: string | null
  distance: number
  height: number
  fov: number
  lookDamping: number
}

export interface TriggerZoneSpec {
  enabled: boolean
  shape: 'box' | 'sphere'
  size: Vec3
  once: boolean
  filterTagId?: string | null
}

export interface RuleEntry {
  id: string
  when: string
  params?: Record<string, unknown>
  actions: Array<{
    do: string
    targetNodeId?: string | null
    params?: Record<string, unknown>
  }>
}

export interface NodeGameplay {
  character?: CharacterSpec | null
  cameraFollow?: CameraFollowSpec | null
  trigger?: TriggerZoneSpec | null
  rules?: RuleEntry[]
  /** 领域包（属性、战斗、感知、背包、对话）按包 id 挂载的数据槽，关闭领域包时不清除数据。 */
  packs?: Record<string, unknown>
}

export interface SceneRuntimeHost {
  readonly ready: boolean
  resolveObject: (id: string) => Group | null
  updateAnimations: (dt: number) => void
}

export type RuntimeSystemStep = (dt: number, host: SceneRuntimeHost) => void

const systems: Array<{ id: string, order: number, step: RuntimeSystemStep }> = []

export function registerRuntimeSystem(id: string, order: number, step: RuntimeSystemStep): () => void {
  const index = systems.findIndex(item => item.id === id)
  if (index >= 0) systems.splice(index, 1)
  systems.push({ id, order, step })
  systems.sort((a, b) => a.order - b.order)
  return () => {
    const idx = systems.findIndex(item => item.id === id)
    if (idx >= 0) systems.splice(idx, 1)
  }
}

/**
 * 统一场景运行时步进：
 * 1. 已注册的核心包/领域包系统（输入、角色控制器、跟随相机、触发器与律令）
 * 2. 物理世界步进（Rapier）
 * 3. 导航网格与动态障碍同步（Recast）
 * 4. 粒子系统模拟（Quarks）
 * 5. 骨骼动画混合器推进（AnimationMixer）
 */
export function stepSceneRuntime(dt: number, host: SceneRuntimeHost) {
  for (const system of systems) {
    system.step(dt, host)
  }
  tickPhysics(dt, host.resolveObject)
  tickNavigation()
  if (host.ready) {
    tickParticles(dt, host.resolveObject)
    host.updateAnimations(dt)
  }
}

export function hasGameplayComponent(node: SceneNode, key: keyof NodeGameplay): boolean {
  return Boolean(node.gameplay?.[key])
}
