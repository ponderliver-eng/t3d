import {
  AdditiveBlending,
  BackSide,
  CustomBlending,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MultiplyBlending,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Vector2,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Side,
} from 'three'
import { useAssetStore } from './library'
import { textureFor, unityMetallicRoughnessTextureFor } from './textures'
import type { ParticleMaterialDesc } from '../../capabilities/particles/runtime'
import type { AlphaMode, CullMode, ModelPartOverride, ParticleBlend, PbrSlot, SceneNode, SurfaceShader } from '../scene/types'

export interface SurfaceSlot extends PbrSlot {
  materialAssetId: string | null
  shader: SurfaceShader
  normalScale: number
  alphaMode: AlphaMode
  alphaCutoff: number
  cull: CullMode
  depthWrite: boolean
  wireframe: boolean
}

const DEFAULTS = {
  materialAssetId: null,
  shader: 'lit' as const,
  normalScale: 1,
  alphaMode: 'opaque' as const,
  alphaCutoff: 0.5,
  cull: 'back' as const,
  depthWrite: true,
  wireframe: false,
}

export function normalizeSlot(slot: Partial<PbrSlot> & Pick<PbrSlot, 'name' | 'color'>): SurfaceSlot {
  return {
    name: slot.name,
    color: slot.color,
    metalness: slot.metalness ?? 0,
    roughness: slot.roughness ?? 1,
    emissive: slot.emissive ?? '#000000',
    emissiveIntensity: slot.emissiveIntensity ?? 0,
    opacity: slot.opacity ?? 1,
    ao: slot.ao ?? 1,
    mapAssetId: slot.mapAssetId ?? null,
    normalAssetId: slot.normalAssetId ?? null,
    metallicRoughnessAssetId: packedMetallicRoughness(slot),
    emissiveAssetId: slot.emissiveAssetId ?? null,
    aoAssetId: slot.aoAssetId ?? null,
    materialAssetId: slot.materialAssetId ?? DEFAULTS.materialAssetId,
    shader: slot.shader ?? DEFAULTS.shader,
    normalScale: slot.normalScale ?? DEFAULTS.normalScale,
    alphaMode: slot.alphaMode ?? DEFAULTS.alphaMode,
    alphaCutoff: slot.alphaCutoff ?? DEFAULTS.alphaCutoff,
    cull: slot.cull ?? DEFAULTS.cull,
    depthWrite: slot.depthWrite ?? DEFAULTS.depthWrite,
    wireframe: slot.wireframe ?? DEFAULTS.wireframe,
    particleBlend: slot.particleBlend,
  }
}

export function nodePatchFromSlot(slot: SurfaceSlot): Partial<SceneNode> {
  return {
    materialAssetId: null,
    color: slot.color,
    metalness: slot.metalness,
    roughness: slot.roughness,
    emissive: slot.emissive,
    emissiveIntensity: slot.emissiveIntensity,
    opacity: slot.opacity,
    ao: slot.ao,
    mapAssetId: slot.mapAssetId,
    normalAssetId: slot.normalAssetId,
    metallicRoughnessAssetId: slot.metallicRoughnessAssetId,
    roughnessAssetId: slot.metallicRoughnessAssetId,
    metalnessAssetId: slot.metallicRoughnessAssetId,
    emissiveAssetId: slot.emissiveAssetId,
    aoAssetId: slot.aoAssetId,
    shader: slot.shader,
    particleBlend: slot.particleBlend,
    normalScale: slot.normalScale,
    alphaMode: slot.alphaMode,
    alphaCutoff: slot.alphaCutoff,
    cull: slot.cull,
    depthWrite: slot.depthWrite,
    wireframe: slot.wireframe,
  }
}

export function slotFromNode(node: SceneNode): SurfaceSlot {
  const linked = materialSlot(node.materialAssetId)
  if (linked) return { ...linked, name: node.name }
  return normalizeSlot({
    name: node.name,
    color: node.color,
    metalness: node.metalness,
    roughness: node.roughness,
    emissive: node.emissive,
    emissiveIntensity: node.emissiveIntensity,
    opacity: node.opacity,
    ao: node.ao,
    mapAssetId: node.mapAssetId,
    normalAssetId: node.normalAssetId,
    metallicRoughnessAssetId: node.metallicRoughnessAssetId,
    roughnessAssetId: node.roughnessAssetId,
    metalnessAssetId: node.metalnessAssetId,
    emissiveAssetId: node.emissiveAssetId,
    aoAssetId: node.aoAssetId,
    shader: node.shader,
    particleBlend: node.particleBlend,
    normalScale: node.normalScale,
    alphaMode: node.alphaMode,
    alphaCutoff: node.alphaCutoff,
    cull: node.cull,
    depthWrite: node.depthWrite,
    wireframe: node.wireframe,
  })
}

export function resolveModelSlot(slot: PbrSlot): SurfaceSlot {
  const linked = materialSlot(slot.materialAssetId)
  if (linked) return { ...linked, name: slot.name }
  return normalizeSlot(slot)
}

function materialSlot(id: string | null | undefined): SurfaceSlot | null {
  if (!id) return null
  const asset = useAssetStore.getState().assets[id]
  if (!asset || asset.kind !== 'material') return null
  return normalizeSlot({ ...asset.slot, materialAssetId: null })
}

export function applySlot(material: Material, slot: PbrSlot): Material {
  const surface = normalizeSlot(slot)
  const next = ensureClass(material, surface)
  paint(next, surface)
  return next
}

export function applyNodeMaterial(root: Mesh, node: SceneNode): Material {
  const geometry = root.geometry as BufferGeometry | undefined
  if (geometry?.attributes.uv && !geometry.attributes.uv2) geometry.setAttribute('uv2', geometry.attributes.uv)
  const current = Array.isArray(root.material) ? root.material[0] : root.material
  const next = applySlot(current, slotFromNode(node))
  if (next !== current) root.material = next
  return next
}

export function applyModelMaterials(root: Object3D, slots: PbrSlot[], partOverrides?: Record<string, ModelPartOverride>) {
  const indexByName = new Map(slots.map((slot, index) => [slot.name, index]))
  const walk = (object: Object3D, parentPath: string) => {
    const label = object.name || object.type
    const path = parentPath ? `${parentPath}/${label}` : label
    const mesh = object as Mesh
    if (mesh.isMesh) {
      const geometry = mesh.geometry as BufferGeometry
      if (geometry?.attributes.uv && !geometry.attributes.uv2) geometry.setAttribute('uv2', geometry.attributes.uv)
      if (geometry?.index && geometry.attributes.position && geometry.attributes.normal && geometry.attributes.uv && !geometry.attributes.tangent) {
        try {
          geometry.computeTangents()
        } catch {
          // ignore non-indexed or degenerate uv meshes
        }
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const overrideSlot = materialSlot(partOverrides?.[path]?.materialAssetId)
      const existingIndices = Array.isArray(mesh.userData.t3dSlotIndices) ? mesh.userData.t3dSlotIndices as number[] : null
      const slotIndices: number[] = []
      const next = materials.map((material, index) => {
        const slotIndex = existingIndices?.[index] ?? slotIndexForMaterial(material, slots, indexByName)
        slotIndices.push(slotIndex)
        if (!material) return material
        if (overrideSlot) {
          const painted = applySlot(material, overrideSlot)
          painted.name = material.name
          painted.userData.t3dSlot = slotIndex
          return painted
        }
        if (slotIndex < 0) return material
        const painted = applySlot(material, resolveModelSlot(slots[slotIndex]))
        painted.name = material.name
        painted.userData.t3dSlot = slotIndex
        return painted
      })
      mesh.userData.t3dSlotIndices = slotIndices
      mesh.material = Array.isArray(mesh.material) ? next : next[0]
    }
    for (const child of object.children) walk(child, path)
  }
  for (const child of root.children) walk(child, '')
}

/** 视口双击拾取：子网格的 materialIndex 对应导入时记下的材质槽。 */
export function slotIndexOnMesh(object: Object3D, materialIndex: number): number | null {
  const stamped = object.userData.t3dSlotIndices
  if (!Array.isArray(stamped)) return null
  const value = stamped[materialIndex] ?? (stamped.length === 1 ? stamped[0] : undefined)
  return typeof value === 'number' && value >= 0 ? value : null
}

function slotIndexForMaterial(material: Material | null | undefined, slots: PbrSlot[], indexByName: Map<string, number>): number {
  const token = materialSlotToken(material)
  if (token != null && token < slots.length) return token
  const named = material?.name ? indexByName.get(material.name) : undefined
  if (named != null) return named
  return slots.length === 1 ? 0 : -1
}

function materialSlotToken(material: Material | null | undefined): number | null {
  const value = material?.userData?.t3dSlot
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

function ensureClass(material: Material, slot: SurfaceSlot): Material {
  const basic = slot.shader !== 'lit' && slot.shader !== 'unity-standard'
  if (basic && (material as MeshBasicMaterial).isMeshBasicMaterial) return material
  if (!basic && (material as MeshStandardMaterial).isMeshStandardMaterial) return material
  const next = basic ? new MeshBasicMaterial() : new MeshStandardMaterial()
  next.name = material.name
  const token = materialSlotToken(material)
  if (token != null) next.userData.t3dSlot = token
  return next
}

function paint(material: Material, slot: SurfaceSlot) {
  const basic = material as MeshBasicMaterial
  const standard = material as MeshStandardMaterial
  const transparency = transparencyOf(slot)
  material.side = sideFor(slot.cull)
  ;(material as MeshBasicMaterial).wireframe = slot.wireframe
  material.depthWrite = transparency.depthWrite
  material.transparent = transparency.transparent
  material.opacity = transparency.opacity
  material.alphaTest = transparency.alphaTest
  basic.color?.set(slot.color)
  if (slot.shader === 'particle-unlit') {
    material.transparent = true
    material.depthWrite = slot.depthWrite
    material.opacity = slot.opacity
    applyParticleBlend(material, slot.particleBlend ?? 'additive')
    assignMap(basic, 'map', slot.mapAssetId, true)
    material.needsUpdate = true
    return
  }
  if (slot.shader === 'unlit-color') {
    basic.map = null
    material.needsUpdate = true
    return
  }
  if (slot.shader === 'lit' || slot.shader === 'unity-standard') {
    const isUnity = slot.shader === 'unity-standard'
    const hasMrMap = Boolean(slot.metallicRoughnessAssetId)
    // Unity Standard 绑定了 _MetallicGlossMap 时，金属度完全由贴图 R 通道决定（标量系数为 1）
    standard.metalness = isUnity && hasMrMap ? 1 : slot.metalness
    standard.roughness = slot.roughness
    standard.emissive?.set(slot.emissive)
    standard.emissiveIntensity = slot.emissiveIntensity
    standard.aoMapIntensity = slot.ao
    standard.normalScale = new Vector2(slot.normalScale, slot.normalScale)
    assignMap(standard, 'map', slot.mapAssetId, true)
    assignMap(standard, 'normalMap', slot.normalAssetId, false)
    assignMap(standard, 'roughnessMap', slot.metallicRoughnessAssetId, false, isUnity)
    assignMap(standard, 'metalnessMap', slot.metallicRoughnessAssetId, false, isUnity)
    assignMap(standard, 'emissiveMap', slot.emissiveAssetId, true)
    assignMap(standard, 'aoMap', slot.aoAssetId ?? slot.metallicRoughnessAssetId, false, isUnity && !slot.aoAssetId)
  } else {
    assignMap(basic, 'map', slot.mapAssetId, true)
  }
  material.needsUpdate = true
}

function transparencyOf(slot: SurfaceSlot) {
  if (slot.alphaMode === 'blend') {
    return { transparent: slot.opacity < 0.999, opacity: slot.opacity, alphaTest: 0, depthWrite: slot.depthWrite }
  }
  if (slot.alphaMode === 'clip') {
    return { transparent: false, opacity: 1, alphaTest: slot.alphaCutoff, depthWrite: slot.depthWrite }
  }
  return { transparent: false, opacity: 1, alphaTest: 0, depthWrite: slot.depthWrite }
}

export function particleDescFor(materialAssetId: string | null): ParticleMaterialDesc | 'incompatible' | null {
  if (!materialAssetId) return null
  const asset = useAssetStore.getState().assets[materialAssetId]
  if (!asset || asset.kind !== 'material') return null
  const slot = normalizeSlot(asset.slot)
  if (slot.shader !== 'particle-unlit') return 'incompatible'
  return {
    color: slot.color,
    opacity: slot.opacity,
    map: textureFor(slot.mapAssetId, true),
    blend: slot.particleBlend ?? 'additive',
    depthWrite: slot.depthWrite,
    depthTest: true,
    side: sideFor(slot.cull),
  }
}

function applyParticleBlend(material: Material, blend: ParticleBlend) {
  material.premultipliedAlpha = blend === 'premultiply'
  material.blendSrc = OneFactor
  material.blendDst = OneMinusSrcAlphaFactor
  if (blend === 'alpha') material.blending = NormalBlending
  else if (blend === 'multiply') material.blending = MultiplyBlending
  else if (blend === 'premultiply') material.blending = CustomBlending
  else material.blending = AdditiveBlending
}

function sideFor(cull: CullMode): Side {
  if (cull === 'front') return BackSide
  if (cull === 'off') return DoubleSide
  return FrontSide
}

function packedMetallicRoughness(slot: Partial<PbrSlot>): string | null {
  if (slot.metallicRoughnessAssetId) return slot.metallicRoughnessAssetId
  const roughness = slot.roughnessAssetId ?? null
  const metalness = slot.metalnessAssetId ?? null
  if (roughness && metalness) return roughness === metalness ? roughness : metalness
  return metalness ?? roughness
}

function assignMap(
  material: MeshStandardMaterial | MeshBasicMaterial,
  key: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'emissiveMap' | 'aoMap',
  assetId: string | null,
  colorMap: boolean,
  unityMetallicGloss = false,
) {
  if (!('map' in material) && key !== 'map') return
  const target = material as MeshStandardMaterial
  const embedded = (material.userData as Record<string, unknown>)[`embedded_${key}`]
  if (embedded === undefined) {
    ;(material.userData as Record<string, unknown>)[`embedded_${key}`] = target[key] ?? null
  }
  if (!assetId) {
    const fallback = ((material.userData as Record<string, unknown>)[`embedded_${key}`] ?? null) as MeshStandardMaterial[typeof key]
    if (target[key] !== fallback) target[key] = fallback
    return
  }
  const texture = unityMetallicGloss ? unityMetallicRoughnessTextureFor(assetId) : textureFor(assetId, colorMap)
  if (texture && target[key] !== texture) target[key] = texture
}
