import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { SceneNode, Vec3 } from './types'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

export interface Pose {
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}

// 父子变换按位移、旋转、缩放分开合成：位移先乘父级缩放再旋转，旋转用四元数相乘，缩放按轴相乘。
// 不用矩阵连乘。父级非均匀缩放时，子级一旋转，连乘出来的世界矩阵会带剪切，网格就被拉斜。
export function eulerQuaternion(rotation: Vec3): Quaternion {
  return new Quaternion().setFromEuler(new Euler(rotation[0] * DEG, rotation[1] * DEG, rotation[2] * DEG, 'XYZ'))
}

export function quaternionEuler(quaternion: Quaternion): Vec3 {
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
  return [euler.x * RAD, euler.y * RAD, euler.z * RAD]
}

export function localMatrix(node: SceneNode): Matrix4 {
  return new Matrix4().compose(
    new Vector3(node.position[0], node.position[1], node.position[2]),
    eulerQuaternion(node.rotation),
    new Vector3(node.scale[0], node.scale[1], node.scale[2]),
  )
}

export function worldPose(nodes: Record<string, SceneNode>, id: string): Pose {
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

/** 把文档里的局部变换贴到父级当前的世界位姿上。试玩中父级已经被物理改过，不能再从文档重算整条链。 */
export function appendLocalPose(parent: Pose, node: Pick<SceneNode, 'position' | 'rotation' | 'scale'>): Pose {
  const position = new Vector3(node.position[0], node.position[1], node.position[2])
    .multiply(parent.scale)
    .applyQuaternion(parent.quaternion)
    .add(parent.position)
  return {
    position,
    quaternion: parent.quaternion.clone().multiply(eulerQuaternion(node.rotation)),
    scale: parent.scale.clone().multiply(new Vector3(node.scale[0], node.scale[1], node.scale[2])),
  }
}

export function worldMatrix(nodes: Record<string, SceneNode>, id: string): Matrix4 {
  const pose = worldPose(nodes, id)
  return new Matrix4().compose(pose.position, pose.quaternion, pose.scale)
}

function safeDiv(value: number, scale: number): number {
  return Math.abs(scale) > 1e-8 ? value / scale : value
}

export function worldPointToLocal(parent: Pose, point: Vector3): Vector3 {
  const delta = point.clone().sub(parent.position).applyQuaternion(parent.quaternion.clone().invert())
  return new Vector3(
    safeDiv(delta.x, parent.scale.x),
    safeDiv(delta.y, parent.scale.y),
    safeDiv(delta.z, parent.scale.z),
  )
}

export function localPoseFromWorld(parent: Pose | null, world: Pose): Pose {
  if (!parent) {
    return {
      position: world.position.clone(),
      quaternion: world.quaternion.clone(),
      scale: world.scale.clone(),
    }
  }
  return {
    position: worldPointToLocal(parent, world.position),
    quaternion: parent.quaternion.clone().invert().multiply(world.quaternion),
    scale: new Vector3(
      safeDiv(world.scale.x, parent.scale.x),
      safeDiv(world.scale.y, parent.scale.y),
      safeDiv(world.scale.z, parent.scale.z),
    ),
  }
}

export function poseComponents(pose: Pose): { position: Vec3, rotation: Vec3, scale: Vec3 } {
  return {
    position: [pose.position.x, pose.position.y, pose.position.z],
    rotation: quaternionEuler(pose.quaternion),
    scale: [pose.scale.x, pose.scale.y, pose.scale.z],
  }
}

export function writePose(node: SceneNode, pose: Pose) {
  const parts = poseComponents(pose)
  node.position = parts.position
  node.rotation = parts.rotation
  node.scale = parts.scale
}

export function isUnder(nodes: Record<string, SceneNode>, nodeId: string, ancestorId: string): boolean {
  const seen = new Set<string>()
  let current = nodes[nodeId]?.parentId
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = nodes[current]?.parentId ?? null
  }
  return false
}
