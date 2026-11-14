import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three'
import { EDITOR_HELPER_LAYER } from '../../editor/project/taxonomy'
import type { NavDebugMesh } from './world'

const material = new MeshBasicMaterial({
  color: 0x4fc3f7,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  side: DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
})

export function syncNavDebug(group: Group, geometry: NavDebugMesh | null, active: boolean) {
  group.visible = active && !!geometry
  if (!group.visible || !geometry) {
    clear(group)
    return
  }
  if (group.userData.version === geometry) return
  clear(group)
  const buffer = new BufferGeometry()
  buffer.setAttribute('position', new BufferAttribute(geometry.positions, 3))
  buffer.setIndex(new BufferAttribute(geometry.indices, 1))
  const mesh = new Mesh(buffer, material)
  mesh.raycast = () => undefined
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.layers.set(EDITOR_HELPER_LAYER)
  group.add(mesh)
  group.userData.version = geometry
}

function clear(group: Group) {
  for (const child of [...group.children]) {
    const mesh = child as Mesh
    mesh.geometry?.dispose()
    child.removeFromParent()
  }
  group.userData.version = null
}
