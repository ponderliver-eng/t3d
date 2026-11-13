import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { SceneNode } from './types'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

export function localMatrix(node: SceneNode): Matrix4 {
  const matrix = new Matrix4()
  const quaternion = new Quaternion().setFromEuler(new Euler(
    node.rotation[0] * DEG,
    node.rotation[1] * DEG,
    node.rotation[2] * DEG,
    'XYZ',
  ))
  matrix.compose(
    new Vector3(node.position[0], node.position[1], node.position[2]),
    quaternion,
    new Vector3(node.scale[0], node.scale[1], node.scale[2]),
  )
  return matrix
}

export function worldMatrix(nodes: Record<string, SceneNode>, id: string): Matrix4 {
  const chain: SceneNode[] = []
  const seen = new Set<string>()
  let current: SceneNode | undefined = nodes[id]
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(current)
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  chain.reverse()
  const matrix = new Matrix4()
  for (const node of chain) matrix.multiply(localMatrix(node))
  return matrix
}

export function writeLocalMatrix(node: SceneNode, matrix: Matrix4) {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
  node.position = [position.x, position.y, position.z]
  node.rotation = [euler.x * RAD, euler.y * RAD, euler.z * RAD]
  node.scale = [scale.x, scale.y, scale.z]
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
