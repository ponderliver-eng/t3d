import { Euler, Quaternion, Vector3 } from 'three'
import type { SceneNode, Vec3 } from '../editor/scene/types'

const DEG = Math.PI / 180

export interface RuntimePose {
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}

function eulerQuaternion(rotation: Vec3): Quaternion {
  return new Quaternion().setFromEuler(new Euler(rotation[0] * DEG, rotation[1] * DEG, rotation[2] * DEG, 'XYZ'))
}

export function worldPose(nodes: Record<string, SceneNode>, id: string): RuntimePose {
  const chain: SceneNode[] = []
  const seen = new Set<string>()
  let current: SceneNode | undefined = nodes[id]
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(current)
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  chain.reverse()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3(1, 1, 1)
  const localPosition = new Vector3()
  const localScale = new Vector3()
  for (const node of chain) {
    localPosition.set(node.position[0], node.position[1], node.position[2]).multiply(scale).applyQuaternion(quaternion)
    position.add(localPosition)
    quaternion.multiply(eulerQuaternion(node.rotation))
    localScale.set(node.scale[0], node.scale[1], node.scale[2])
    scale.multiply(localScale)
  }
  return { position, quaternion, scale }
}
