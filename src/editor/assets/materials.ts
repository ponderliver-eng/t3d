import { Mesh, MeshStandardMaterial, type BufferGeometry, type Material, type Object3D } from 'three'
import { textureFor } from './textures'
import type { PbrSlot, SceneNode } from '../scene/types'

export function slotFromNode(node: SceneNode): PbrSlot {
  return {
    name: '默认',
    color: node.color,
    metalness: node.metalness,
    roughness: node.roughness,
    emissive: node.emissive,
    emissiveIntensity: node.emissiveIntensity,
    opacity: node.opacity,
    ao: node.ao,
    mapAssetId: node.mapAssetId,
    normalAssetId: node.normalAssetId,
    roughnessAssetId: node.roughnessAssetId,
    metalnessAssetId: node.metalnessAssetId,
    emissiveAssetId: node.emissiveAssetId,
    aoAssetId: node.aoAssetId,
  }
}

export function applySlot(material: Material, slot: PbrSlot) {
  const standard = material as MeshStandardMaterial
  if (!standard.color || standard.metalness === undefined) return
  standard.color.set(slot.color)
  standard.metalness = slot.metalness
  standard.roughness = slot.roughness
  standard.emissive?.set(slot.emissive)
  standard.emissiveIntensity = slot.emissiveIntensity
  standard.opacity = slot.opacity
  standard.transparent = slot.opacity < 0.999
  standard.aoMapIntensity = slot.ao
  assignMap(standard, 'map', slot.mapAssetId, true)
  assignMap(standard, 'normalMap', slot.normalAssetId, false)
  assignMap(standard, 'roughnessMap', slot.roughnessAssetId, false)
  assignMap(standard, 'metalnessMap', slot.metalnessAssetId, false)
  assignMap(standard, 'emissiveMap', slot.emissiveAssetId, true)
  assignMap(standard, 'aoMap', slot.aoAssetId, false)
  const meshMaterial = material as Material & { needsUpdate?: boolean }
  meshMaterial.needsUpdate = true
}

function assignMap(material: MeshStandardMaterial, key: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'emissiveMap' | 'aoMap', assetId: string | null, colorMap: boolean) {
  if (!assetId) return
  const texture = textureFor(assetId, colorMap)
  if (texture && material[key] !== texture) material[key] = texture
}

export function applyNodeMaterial(root: Mesh, node: SceneNode) {
  const geometry = root.geometry as BufferGeometry | undefined
  if (geometry?.attributes.uv && !geometry.attributes.uv2) geometry.setAttribute('uv2', geometry.attributes.uv)
  const slot = slotFromNode(node)
  const materials = Array.isArray(root.material) ? root.material : [root.material]
  for (const material of materials) applySlot(material, slot)
}

export function applyModelMaterials(root: Object3D, slots: PbrSlot[]) {
  const byName = new Map(slots.map(slot => [slot.name, slot]))
  root.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const geometry = mesh.geometry as BufferGeometry
    if (geometry?.attributes.uv && !geometry.attributes.uv2) geometry.setAttribute('uv2', geometry.attributes.uv)
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const slot = byName.get(material.name) ?? (slots.length === 1 ? slots[0] : undefined)
      if (slot) applySlot(material, slot)
    }
  })
}
