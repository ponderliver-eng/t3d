import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  type Scene,
} from 'three'
import { capabilityEnabled } from '../../capabilities/registry'
import { worldPose } from '../scene/transform'
import type { SceneNode } from '../scene/types'

const solid = new MeshBasicMaterial({ color: 0x8bc34a, wireframe: true, depthTest: false, transparent: true, opacity: 0.9 })
const sensor = new MeshBasicMaterial({ color: 0xffb454, wireframe: true, depthTest: false, transparent: true, opacity: 0.9 })

export function syncPhysicsDebug(scene: Scene, group: Group, nodes: Record<string, SceneNode>, active: boolean) {
  if (!scene.children.includes(group)) scene.add(group)
  group.visible = active
  if (!active) {
    clear(group)
    return
  }
  const live = new Set<string>()
  for (const node of Object.values(nodes)) {
    if (!node.physics || !node.visible) continue
    live.add(node.id)
    let holder = group.getObjectByName(node.id) as Group | undefined
    const signature = `${node.physics.shape}:${node.physics.size.join(',')}:${node.physics.trigger ? 1 : 0}`
    if (!holder || holder.userData.signature !== signature) {
      if (holder) drop(holder)
      holder = new Group()
      holder.name = node.id
      holder.userData.signature = signature
      const mesh = new Mesh(geometryFor(node), node.physics.trigger ? sensor : solid)
      mesh.raycast = () => undefined
      holder.add(mesh)
      group.add(holder)
    }
    const pose = worldPose(nodes, node.id)
    holder.position.copy(pose.position)
    holder.quaternion.copy(pose.quaternion)
    holder.scale.set(Math.abs(pose.scale.x), Math.abs(pose.scale.y), Math.abs(pose.scale.z))
  }
  for (const child of [...group.children]) {
    if (!live.has(child.name)) drop(child as Group)
  }
}

export function physicsDebugActive(capabilities: Record<string, boolean> | undefined, playing: boolean): boolean {
  return playing && capabilityEnabled(capabilities, 'physics')
}

function geometryFor(node: SceneNode) {
  const physics = node.physics!
  if (physics.shape === 'sphere') return new SphereGeometry(Math.max(0.001, physics.size[0]), 16, 12)
  if (physics.shape === 'capsule') {
    const radius = Math.max(0.001, physics.size[0])
    const length = Math.max(0.02, physics.size[1] - radius * 2)
    return new CapsuleGeometry(radius, length, 4, 12)
  }
  return new BoxGeometry(
    Math.max(0.001, physics.size[0]),
    Math.max(0.001, physics.size[1]),
    Math.max(0.001, physics.size[2]),
  )
}

function clear(group: Group) {
  for (const child of [...group.children]) drop(child as Group)
}

function drop(group: Group) {
  group.traverse(object => {
    const mesh = object as Mesh
    mesh.geometry?.dispose()
  })
  group.removeFromParent()
}
