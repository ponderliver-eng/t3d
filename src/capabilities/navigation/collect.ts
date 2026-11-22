import { Vector3, type Mesh, type Object3D } from 'three'
import { EDITOR_HELPER_LAYER } from '../../core/layers'

const HELPER_BIT = 1 << EDITOR_HELPER_LAYER

export function collectNavSurfaces(roots: Iterable<Object3D>): { positions: Float32Array, indices: Uint32Array } {
  const positions: number[] = []
  const indices: number[] = []
  const vertex = new Vector3()
  for (const root of roots) {
    if (!root) continue
    root.updateWorldMatrix(true, true)
    root.traverse(child => {
      const mesh = child as Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      if ((mesh.layers.mask & HELPER_BIT) !== 0) return
      const attribute = mesh.geometry.getAttribute('position')
      if (!attribute) return
      const base = positions.length / 3
      for (let index = 0; index < attribute.count; index += 1) {
        vertex.fromBufferAttribute(attribute, index).applyMatrix4(mesh.matrixWorld)
        positions.push(vertex.x, vertex.y, vertex.z)
      }
      const indexed = mesh.geometry.getIndex()
      if (indexed) {
        for (let index = 0; index < indexed.count; index += 1) indices.push(base + indexed.getX(index))
      } else {
        for (let index = 0; index < attribute.count; index += 1) indices.push(base + index)
      }
    })
  }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
  }
}
