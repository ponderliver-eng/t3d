import { capabilityEnabled } from '../registry'
import { worldPose } from '../../runtime/transform'
import { getRuntimeWorld } from '../../runtime/world'
import type { Object3D } from 'three'
import { collectMeshCollider, meshColliderKey, type MeshColliderData } from './meshCollect'
import type { CharacterMove, CharacterMoveResult, PhysicsWorld } from './world'

let world: PhysicsWorld | null = null
let booting = false
let lastInspectorSync = 0
const meshCache = new Map<string, MeshColliderData>()

export interface PhysicsExtensionContext {
  readonly dt: number
  readonly world: PhysicsWorld
  resolveObject?: (id: string) => { position: { set: (x: number, y: number, z: number) => void }, quaternion: { set: (x: number, y: number, z: number, w: number) => void } } | null
}

export type PhysicsExtensionStep = (ctx: PhysicsExtensionContext) => void

const extensions: Array<{ id: string, order: number, step: PhysicsExtensionStep }> = []

/**
 * 注册依赖物理世界的能力包扩展（如车辆 Raycast Vehicle、浮力、绳索关节等），
 * 在保持仅 rapierWorld.ts 直接 import Rapier 的前提下复用同一物理步进。
 */
export function registerPhysicsExtension(id: string, order: number, step: PhysicsExtensionStep): () => void {
  const index = extensions.findIndex(item => item.id === id)
  if (index >= 0) extensions.splice(index, 1)
  extensions.push({ id, order, step })
  extensions.sort((a, b) => a.order - b.order)
  return () => {
    const idx = extensions.findIndex(item => item.id === id)
    if (idx >= 0) extensions.splice(idx, 1)
  }
}

/** 物理世界还没起来时返回 null，角色改走射线。 */
export function moveCharacters(moves: CharacterMove[]): CharacterMoveResult[] | null {
  if (!world || moves.length === 0) return null
  return world.moveCharacters(moves)
}

export function tickPhysics(dt: number, resolveObject?: (id: string) => Object3D | null) {
  const runtime = getRuntimeWorld()
  const enabled = capabilityEnabled(runtime.getCapabilities(), 'physics')
  const playState = runtime.getPlayState()
  if (!enabled || playState === 'stopped') {
    disposePhysics()
    return
  }
  if (playState !== 'playing') return
  if (!world) {
    boot()
    return
  }
  const currentWorld = world
  currentWorld.setGravity(runtime.getPicture().gravity ?? [0, -9.81, 0])
  currentWorld.sync(collectBodies(resolveObject))
  currentWorld.step(dt, subDt => {
    for (const ext of extensions) {
      ext.step({ dt: subDt, world: currentWorld, resolveObject })
    }
  })
  const poses = world.dynamicPoses()
  if (resolveObject) {
    for (const pose of poses) {
      const obj = resolveObject(pose.id)
      if (!obj) continue
      obj.position.set(pose.position[0], pose.position[1], pose.position[2])
      obj.quaternion.set(pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3])
    }
    const now = performance.now()
    if (now - lastInspectorSync >= 120) {
      lastInspectorSync = now
      const selected = new Set(runtime.getSelection?.() ?? [])
      const selectedPoses = poses.filter(pose => selected.has(pose.id))
      if (selectedPoses.length > 0) runtime.applySimulation?.(selectedPoses)
    }
    return
  }
  runtime.applySimulation?.(poses)
}

function boot() {
  if (booting) return
  booting = true
  void import('./rapierWorld').then(async module => {
    if (world) return
    world = await module.createRapierWorld()
  }).catch(error => {
    console.warn('[physics] Rapier 初始化失败', error)
  }).finally(() => {
    booting = false
  })
}

function disposePhysics() {
  world?.dispose()
  world = null
  meshCache.clear()
}

function collectBodies(resolveObject?: (id: string) => Object3D | null) {
    const runtime = getRuntimeWorld()
    const nodes = runtime.getNodes()
  const bodies = []
  for (const node of Object.values(nodes)) {
    if (!node.physics || !node.visible) continue
    const pose = worldPose(nodes, node.id)
    bodies.push({
      id: node.id,
      body: node.physics.body,
      shape: node.physics.shape,
      size: node.physics.size,
      position: [pose.position.x, pose.position.y, pose.position.z] as [number, number, number],
      rotation: [pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w] as [number, number, number, number],
      scale: [Math.abs(pose.scale.x), Math.abs(pose.scale.y), Math.abs(pose.scale.z)] as [number, number, number],
      trigger: node.physics.trigger,
      mass: node.physics.mass,
      friction: node.physics.friction,
      restitution: node.physics.restitution,
      linearDamping: node.physics.linearDamping,
      angularDamping: node.physics.angularDamping,
      gravityScale: node.physics.gravityScale,
      collisionGroups: runtime.collisionGroupsForLayer?.(node.renderLayerId) ?? 0xffffffff,
      mesh: node.physics.shape === 'convex' || node.physics.shape === 'trimesh'
        ? meshFor(node.id, resolveObject?.(node.id) ?? null)
        : undefined,
    })
  }
  return bodies
}

function meshFor(id: string, object: Object3D | null): MeshColliderData | undefined {
  if (!object) {
    meshCache.delete(id)
    return undefined
  }
  const key = meshColliderKey(object)
  const cached = meshCache.get(id)
  if (cached && cached.key === key) return cached
  const built = collectMeshCollider(object)
  if (!built) {
    meshCache.delete(id)
    return undefined
  }
  meshCache.set(id, built)
  return built
}
