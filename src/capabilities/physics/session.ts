import { capabilityEnabled } from '../registry'
import { worldPose } from '../../editor/scene/transform'
import { rapierCollisionGroups } from '../../editor/project/taxonomy'
import { useEditorStore } from '../../editor/scene/store'
import type { PhysicsWorld } from './world'

let world: PhysicsWorld | null = null
let booting = false

export function tickPhysics(dt: number) {
  const state = useEditorStore.getState()
  const enabled = capabilityEnabled(state.capabilities, 'physics')
  if (!enabled || state.playState === 'stopped') {
    disposePhysics()
    return
  }
  if (state.playState !== 'playing') return
  if (!world) {
    boot()
    return
  }
  world.setGravity(state.picture.gravity ?? [0, -9.81, 0])
  world.sync(collectBodies())
  world.step(dt)
  state.applySimulation(world.dynamicPoses())
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
}

function collectBodies() {
    const state = useEditorStore.getState()
    const nodes = state.nodes
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
      collisionGroups: rapierCollisionGroups(
        node.renderLayerId,
        state.layers,
        state.physicsCollisionMatrixEnabled,
        state.physicsCollisionRowMasks,
      ),
    })
  }
  return bodies
}
