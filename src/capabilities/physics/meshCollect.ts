import { Matrix4, Mesh, Object3D, Vector3, type BufferAttribute } from 'three'

export interface MeshColliderData {
  key: string
  positions: Float32Array
  indices: Uint32Array
}

const point = new Vector3()
const inverse = new Matrix4()
const relative = new Matrix4()

export function meshColliderKey(root: Object3D): string {
  root.updateWorldMatrix(true, true)
  inverse.copy(root.matrixWorld).invert()
  const keys: string[] = []
  root.traverse(child => {
    const mesh = child as Mesh
    const attr = mesh.isMesh ? mesh.geometry?.getAttribute('position') : undefined
    if (!attr || attr.count < 3) return
    relative.copy(inverse).multiply(mesh.matrixWorld)
    keys.push(mesh.geometry.uuid, String(attr.count), matrixKey(relative))
  })
  return keys.join('|')
}

/** 把物体下面的网格收成刚体局部空间的顶点和索引。蒙皮用绑定姿势，不跟骨骼变形。 */
export function collectMeshCollider(root: Object3D): MeshColliderData | null {
  root.updateWorldMatrix(true, true)
  inverse.copy(root.matrixWorld).invert()
  const positions: number[] = []
  const indices: number[] = []
  const keys: string[] = []
  root.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const attr = mesh.geometry.getAttribute('position') as BufferAttribute | undefined
    if (!attr || attr.count < 3) return
    relative.copy(inverse).multiply(mesh.matrixWorld)
    const base = positions.length / 3
    keys.push(mesh.geometry.uuid, String(attr.count), matrixKey(relative))
    for (let i = 0; i < attr.count; i += 1) {
      point.fromBufferAttribute(attr, i).applyMatrix4(relative)
      positions.push(point.x, point.y, point.z)
    }
    const index = mesh.geometry.getIndex()
    if (index) {
      for (let i = 0; i < index.count; i += 1) indices.push(base + index.getX(i))
    } else {
      for (let i = 0; i < attr.count; i += 1) indices.push(base + i)
    }
  })
  if (positions.length < 9 || indices.length < 3) return null
  return {
    key: keys.join('|'),
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
  }
}

function matrixKey(matrix: Matrix4): string {
  return matrix.elements.map(value => value.toFixed(3)).join(',')
}
