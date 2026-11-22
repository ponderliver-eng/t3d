import { Quaternion, Vector3 } from 'three'
import type { SceneNode } from '../../editor/scene/types'
import { registerRuntimeSystem, RUNTIME_STAGE, type SceneRuntimeHost } from '../../runtime/sceneRuntime'
import { getRuntimeWorld } from '../../runtime/world'
import type { CapabilityRuntimeModule } from '../registry'
import { normalizeProjectile, PROJECTILE_CAPABILITY_ID, type ProjectileMode } from './schema'

export interface ProjectileLaunchOptions {
  direction?: { x: number; y: number; z: number }
  targetId?: string | null
  ownerId?: string | null
  mode?: ProjectileMode
  speed?: number
  gravity?: number
  turnRate?: number
  maxLifetime?: number
  hitRadius?: number
  targetTag?: string
  damage?: number
  destroyOnHit?: boolean
  onHit?: (hitNodeId: string, pos: { x: number; y: number; z: number }) => void
}

interface ProjectileState {
  nodeId: string
  vx: number
  vy: number
  vz: number
  elapsed: number
  mode?: ProjectileMode
  speed?: number
  gravity?: number
  turnRate?: number
  maxLifetime?: number
  hitRadius?: number
  targetTag?: string
  damage?: number
  destroyOnHit?: boolean
  targetId?: string | null
  ownerId?: string | null
  onHit?: (hitNodeId: string, pos: { x: number; y: number; z: number }) => void
}

export interface ProjectileRuntimeHooks {
  onHit?: (event: {
    projectileId: string
    targetId: string
    ownerId?: string | null
    damage: number
    position: { x: number; y: number; z: number }
  }) => void
  onRecycle?: (nodeId: string, host: SceneRuntimeHost) => void
  isNodeInactive?: (nodeId: string, nodes: Record<string, SceneNode>) => boolean
}

const activeProjectiles = new Map<string, ProjectileState>()
let unregisterProjectile: (() => void) | null = null
let hooks: ProjectileRuntimeHooks = {}

const tmpDir = new Vector3()
const tmpQuat = new Quaternion()
const tmpForward = new Vector3(0, 0, 1)

export function bindProjectileRuntimeHooks(next: ProjectileRuntimeHooks) {
  hooks = next
}

function nodeHasTag(node: SceneNode, tag: string): boolean {
  if (!tag) return false
  if (node.tagId === tag || node.tagId?.startsWith(`${tag}.`)) return true
  if (Array.isArray(node.tagIds)) {
    return node.tagIds.some((t) => t === tag || t.startsWith(`${tag}.`))
  }
  return false
}

function readPos(host: SceneRuntimeHost, node: SceneNode): { x: number; y: number; z: number } {
  const obj = host.resolveObject(node.id)
  if (obj) return { x: obj.position.x, y: obj.position.y, z: obj.position.z }
  return { x: node.position[0], y: node.position[1], z: node.position[2] }
}

function writePos(host: SceneRuntimeHost, node: SceneNode, x: number, y: number, z: number) {
  const obj = host.resolveObject(node.id)
  if (obj) obj.position.set(x, y, z)
  node.position = [x, y, z]
}

function orientAlongVelocity(host: SceneRuntimeHost, node: SceneNode, vx: number, vy: number, vz: number) {
  const lenSq = vx * vx + vy * vy + vz * vz
  if (lenSq < 1e-6) return
  tmpDir.set(vx, vy, vz).normalize()
  tmpQuat.setFromUnitVectors(tmpForward, tmpDir)
  const obj = host.resolveObject(node.id)
  if (obj) {
    obj.quaternion.copy(tmpQuat)
    node.rotation = [
      (obj.rotation.x * 180) / Math.PI,
      (obj.rotation.y * 180) / Math.PI,
      (obj.rotation.z * 180) / Math.PI,
    ]
  }
}

function defaultDirectionForNode(node: SceneNode): { x: number; y: number; z: number } {
  const yaw = ((node.rotation?.[1] ?? 0) * Math.PI) / 180
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }
}

export function launchProjectile(nodeId: string, options?: ProjectileLaunchOptions) {
  const world = getRuntimeWorld()
  const node = world.getNodes()[nodeId]
  const rawSpec = node?.capabilities?.[PROJECTILE_CAPABILITY_ID]
  const spec = normalizeProjectile(rawSpec)
  const speed = Math.max(0.1, options?.speed ?? spec.speed)
  const dir = options?.direction ?? (node ? defaultDirectionForNode(node) : { x: 0, y: 0, z: 1 })
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1
  activeProjectiles.set(nodeId, {
    nodeId,
    vx: (dir.x / len) * speed,
    vy: (dir.y / len) * speed,
    vz: (dir.z / len) * speed,
    elapsed: 0,
    mode: options?.mode,
    speed: options?.speed,
    gravity: options?.gravity,
    turnRate: options?.turnRate,
    maxLifetime: options?.maxLifetime,
    hitRadius: options?.hitRadius,
    targetTag: options?.targetTag,
    damage: options?.damage,
    destroyOnHit: options?.destroyOnHit,
    targetId: options?.targetId,
    ownerId: options?.ownerId,
    onHit: options?.onHit,
  })
}

export function resetProjectileState(nodeId: string) {
  activeProjectiles.delete(nodeId)
}

function stepProjectileRuntime(dt: number, host: SceneRuntimeHost) {
  const world = getRuntimeWorld()
  const nodes = world.getNodes()
  const safeDt = Math.min(0.05, Math.max(0.0001, dt))

  // 为所有挂载了 projectile 组件且激活的节点初始化弹道状态
  for (const node of Object.values(nodes)) {
    const raw = node.capabilities?.[PROJECTILE_CAPABILITY_ID]
    if (!raw) continue
    if (!node.visible || hooks.isNodeInactive?.(node.id, nodes)) {
      activeProjectiles.delete(node.id)
      continue
    }
    const spec = normalizeProjectile(raw)
    if (!spec.enabled) continue
    if (!activeProjectiles.has(node.id)) {
      const dir = defaultDirectionForNode(node)
      activeProjectiles.set(node.id, {
        nodeId: node.id,
        vx: dir.x * spec.speed,
        vy: dir.y * spec.speed,
        vz: dir.z * spec.speed,
        elapsed: 0,
      })
    }
  }

  for (const [id, state] of [...activeProjectiles.entries()]) {
    const node = nodes[id]
    if (!node || !node.visible || hooks.isNodeInactive?.(id, nodes)) {
      activeProjectiles.delete(id)
      continue
    }
    const spec = normalizeProjectile(node.capabilities?.[PROJECTILE_CAPABILITY_ID])
    const mode = state.mode ?? spec.mode
    const speed = Math.max(0.1, state.speed ?? spec.speed)
    const gravity = state.gravity ?? spec.gravity
    const turnRate = state.turnRate ?? spec.turnRate
    const maxLifetime = Math.max(0.05, state.maxLifetime ?? spec.maxLifetime)
    const hitRadius = Math.max(0.02, state.hitRadius ?? spec.hitRadius)
    const targetTag = (state.targetTag ?? spec.targetTag).trim()
    const damage = state.damage ?? spec.damage
    const destroyOnHit = state.destroyOnHit ?? spec.destroyOnHit

    state.elapsed += safeDt
    if (state.elapsed >= maxLifetime) {
      activeProjectiles.delete(id)
      hooks.onRecycle?.(id, host)
      continue
    }

    const pos = readPos(host, node)

    if (mode === 'homing' && state.targetId) {
      const targetNode = nodes[state.targetId]
      if (targetNode && targetNode.visible && !hooks.isNodeInactive?.(targetNode.id, nodes)) {
        const tp = readPos(host, targetNode)
        const dx = tp.x - pos.x
        const dy = tp.y - pos.y
        const dz = tp.z - pos.z
        const dist = Math.hypot(dx, dy, dz)
        if (dist > 1e-4) {
          const desiredVx = (dx / dist) * speed
          const desiredVy = (dy / dist) * speed
          const desiredVz = (dz / dist) * speed
          const blend = Math.min(1, turnRate * safeDt)
          state.vx += (desiredVx - state.vx) * blend
          state.vy += (desiredVy - state.vy) * blend
          state.vz += (desiredVz - state.vz) * blend
          const curSpd = Math.hypot(state.vx, state.vy, state.vz) || 1
          state.vx = (state.vx / curSpd) * speed
          state.vy = (state.vy / curSpd) * speed
          state.vz = (state.vz / curSpd) * speed
        }
      }
    } else if (mode === 'ballistic') {
      state.vy -= gravity * safeDt
    }

    const nx = pos.x + state.vx * safeDt
    const ny = pos.y + state.vy * safeDt
    const nz = pos.z + state.vz * safeDt
    writePos(host, node, nx, ny, nz)
    orientAlongVelocity(host, node, state.vx, state.vy, state.vz)

    // 命中检测：优先精确检测 targetId，否则扫描带 targetTag 的激活节点
    let hitNode: SceneNode | null = null
    if (state.targetId) {
      const t = nodes[state.targetId]
      if (t && t.visible && !hooks.isNodeInactive?.(t.id, nodes)) {
        const tp = readPos(host, t)
        const d = Math.hypot(tp.x - nx, tp.y - ny, tp.z - nz)
        if (d <= hitRadius) hitNode = t
      }
    }
    if (!hitNode && targetTag) {
      const r2 = hitRadius * hitRadius
      for (const candidate of Object.values(nodes)) {
        if (candidate.id === id || candidate.id === state.ownerId) continue
        if (!candidate.visible || hooks.isNodeInactive?.(candidate.id, nodes)) continue
        if (!nodeHasTag(candidate, targetTag)) continue
        const cp = readPos(host, candidate)
        const dx = cp.x - nx
        const dy = cp.y - ny
        const dz = cp.z - nz
        if (dx * dx + dy * dy + dz * dz <= r2) {
          hitNode = candidate
          break
        }
      }
    }

    if (hitNode) {
      const hitPos = { x: nx, y: ny, z: nz }
      try {
        state.onHit?.(hitNode.id, hitPos)
      } catch (err) {
        console.warn('[Projectile] onHit 回调异常:', err)
      }
      try {
        hooks.onHit?.({
          projectileId: id,
          targetId: hitNode.id,
          ownerId: state.ownerId,
          damage,
          position: hitPos,
        })
      } catch (err) {
        console.warn('[Projectile] hooks.onHit 异常:', err)
      }
      if (destroyOnHit) {
        activeProjectiles.delete(id)
        hooks.onRecycle?.(id, host)
      }
    }
  }
}

export function ensureProjectileRuntime() {
  if (unregisterProjectile) return
  unregisterProjectile = registerRuntimeSystem(
    'capability.projectile',
    RUNTIME_STAGE.PRE_PHYSICS + 5,
    stepProjectileRuntime,
  )
}

export function mount() {
  ensureProjectileRuntime()
  return dispose
}

export function dispose() {
  unregisterProjectile?.()
  unregisterProjectile = null
  activeProjectiles.clear()
}

export const projectileRuntimeModule: CapabilityRuntimeModule = {
  mount,
  dispose,
}
