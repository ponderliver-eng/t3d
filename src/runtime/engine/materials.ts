import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  Color,
  CustomBlending,
  DoubleSide,
  FrontSide,
  IntType,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MultiplyBlending,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Skeleton,
  Vector2,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Side,
  type Texture,
} from 'three'
import type { ParticleMaterialDesc } from '../../capabilities/particles/runtime'
import { buildMaterialFromShader, coerceShaderUniformValue, type ShaderDefinition, type ShaderUniformEntry } from '../../core/codeAssets/shaderRuntime'
import type { AlphaMode, CullMode, ModelPartOverride, ParticleBlend, PbrSlot, SceneNode, SurfaceShader } from '../../editor/scene/types'

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

export interface MaterialEngineHost {
  getMaterialSlot: (assetId: string | null | undefined) => PbrSlot | null
  getTexture: (assetId: string | null | undefined, colorMap: boolean) => Texture | null
  getUnityMetallicRoughnessTexture: (assetId: string | null | undefined) => Texture | null
  getCustomShader: (shaderId: string) => { definition: ShaderDefinition; updatedAt: number } | null
  getAssetRevision?: () => number
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

export function packedMetallicRoughness(slot: Partial<PbrSlot>): string | null {
  if (slot.metallicRoughnessAssetId) return slot.metallicRoughnessAssetId
  const roughness = slot.roughnessAssetId ?? null
  const metalness = slot.metalnessAssetId ?? null
  if (roughness && metalness) return roughness === metalness ? roughness : metalness
  return metalness ?? roughness
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
    shaderParams: slot.shaderParams,
    normalScale: slot.normalScale ?? DEFAULTS.normalScale,
    alphaMode: slot.alphaMode ?? DEFAULTS.alphaMode,
    alphaCutoff: slot.alphaCutoff ?? DEFAULTS.alphaCutoff,
    cull: slot.cull ?? DEFAULTS.cull,
    depthWrite: slot.depthWrite ?? DEFAULTS.depthWrite,
    wireframe: slot.wireframe ?? DEFAULTS.wireframe,
    particleBlend: slot.particleBlend,
    clearcoatEnabled: slot.clearcoatEnabled ?? ((slot.clearcoat ?? 0) > 0 || Boolean(slot.clearcoatMapAssetId)),
    clearcoat: slot.clearcoat ?? 0,
    clearcoatRoughness: slot.clearcoatRoughness ?? 0,
    clearcoatMapAssetId: slot.clearcoatMapAssetId ?? null,
    clearcoatRoughnessMapAssetId: slot.clearcoatRoughnessMapAssetId ?? null,
    clearcoatNormalMapAssetId: slot.clearcoatNormalMapAssetId ?? null,
    transmissionEnabled: slot.transmissionEnabled ?? ((slot.transmission ?? 0) > 0),
    transmission: slot.transmission ?? 0,
    ior: slot.ior ?? 1.5,
    thickness: slot.thickness ?? 0,
    attenuationColor: slot.attenuationColor ?? '#ffffff',
    attenuationDistance: slot.attenuationDistance ?? 0,
    sheenEnabled: slot.sheenEnabled ?? ((slot.sheen ?? 0) > 0),
    sheen: slot.sheen ?? 0,
    sheenRoughness: slot.sheenRoughness ?? 1,
    sheenColor: slot.sheenColor ?? '#ffffff',
    iridescenceEnabled: slot.iridescenceEnabled ?? ((slot.iridescence ?? 0) > 0),
    iridescence: slot.iridescence ?? 0,
    iridescenceIOR: slot.iridescenceIOR ?? 1.3,
    iridescenceThickness: slot.iridescenceThickness ?? 400,
    specularEnabled: slot.specularEnabled ?? (
      (slot.specularIntensity !== undefined && slot.specularIntensity !== 1)
      || (slot.specularColor !== undefined && slot.specularColor.toLowerCase() !== '#ffffff')
    ),
    specularIntensity: slot.specularIntensity ?? 1,
    specularColor: slot.specularColor ?? '#ffffff',
  }
}

export function normalizeMaterialKey(raw: string): string {
  return raw
    .split(':')
    .pop()!
    .trim()
    .toLowerCase()
    .replace(/\.(?:mat|t3dmat|gm3dmat)$/i, '')
    .replace(/\.\d+$/g, '')
    .replace(/^(?:m|mat|mtl)[_-]+/i, '')
    .replace(/(?:[_-\s]+(?:material|mat|mtl|instance))+$/i, '')
    .replace(/[\s._-]+/g, '')
}

export function resolveModelSlotWithHost(slot: PbrSlot, host: MaterialEngineHost): SurfaceSlot {
  const linked = host.getMaterialSlot(slot.materialAssetId)
  if (linked) {
    const surface = normalizeSlot({ ...linked, materialAssetId: null })
    const mapAssetId = surface.mapAssetId ?? slot.mapAssetId ?? null
    const normalAssetId = surface.normalAssetId ?? slot.normalAssetId ?? null
    const metallicRoughnessAssetId = surface.metallicRoughnessAssetId ?? packedMetallicRoughness(slot) ?? null
    const emissiveAssetId = surface.emissiveAssetId ?? slot.emissiveAssetId ?? null
    const aoAssetId = surface.aoAssetId ?? slot.aoAssetId ?? null
    const hasMap = Boolean(mapAssetId || normalAssetId || metallicRoughnessAssetId)
    return {
      ...surface,
      name: slot.name,
      color: hasMap && surface.color === '#000000' ? '#ffffff' : surface.color,
      mapAssetId,
      normalAssetId,
      metallicRoughnessAssetId,
      emissiveAssetId,
      aoAssetId,
    }
  }
  const surface = normalizeSlot(slot)
  const hasMap = Boolean(surface.mapAssetId || surface.normalAssetId || surface.metallicRoughnessAssetId)
  if (hasMap && surface.color === '#000000') {
    return { ...surface, color: '#ffffff' }
  }
  return surface
}

export function slotFromNodeWithHost(node: SceneNode, host: MaterialEngineHost): SurfaceSlot {
  const linked = host.getMaterialSlot(node.materialAssetId)
  if (linked) return { ...normalizeSlot({ ...linked, materialAssetId: null }), name: node.name }
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
    shaderParams: (node.capabilities?.__materialShaderParams as Record<string, unknown> | undefined) ?? undefined,
    particleBlend: node.particleBlend,
    normalScale: node.normalScale,
    alphaMode: node.alphaMode,
    alphaCutoff: node.alphaCutoff,
    cull: node.cull,
    depthWrite: node.depthWrite,
    wireframe: node.wireframe,
  })
}

export function sideFor(cull: CullMode): Side {
  if (cull === 'front') return BackSide
  if (cull === 'off') return DoubleSide
  return FrontSide
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

function applyParticleBlend(material: Material, blend: ParticleBlend) {
  material.premultipliedAlpha = blend === 'premultiply'
  material.blendSrc = OneFactor
  material.blendDst = OneMinusSrcAlphaFactor
  if (blend === 'alpha') material.blending = NormalBlending
  else if (blend === 'multiply') material.blending = MultiplyBlending
  else if (blend === 'premultiply') material.blending = CustomBlending
  else material.blending = AdditiveBlending
}

export function materialSlotToken(material: Material | null | undefined): number | null {
  const value = material?.userData?.t3dSlot
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

function ensureClass(material: Material, slot: SurfaceSlot): Material {
  const basic = slot.shader !== 'lit' && slot.shader !== 'physical' && slot.shader !== 'unity-standard' && !slot.shader.startsWith('custom:')
  const physical = slot.shader === 'physical'
  const wasCustom = Boolean(material.userData?.t3dCustomShaderKey)
  if (!wasCustom && basic && (material as MeshBasicMaterial).isMeshBasicMaterial) return material
  if (!wasCustom && physical && (material as MeshPhysicalMaterial).isMeshPhysicalMaterial) return material
  if (!wasCustom && !basic && !physical && (material as MeshStandardMaterial).isMeshStandardMaterial && !(material as MeshPhysicalMaterial).isMeshPhysicalMaterial) return material
  const next = basic ? new MeshBasicMaterial() : physical ? new MeshPhysicalMaterial() : new MeshStandardMaterial()
  next.name = material.name
  const token = materialSlotToken(material)
  if (token != null) next.userData.t3dSlot = token
  return next
}

function assignMapWithHost(
  material: MeshStandardMaterial | MeshBasicMaterial,
  key:
    | 'map'
    | 'normalMap'
    | 'roughnessMap'
    | 'metalnessMap'
    | 'emissiveMap'
    | 'aoMap'
    | 'clearcoatMap'
    | 'clearcoatRoughnessMap'
    | 'clearcoatNormalMap',
  assetId: string | null,
  colorMap: boolean,
  host: MaterialEngineHost,
  unityMetallicGloss = false,
) {
  if (!('map' in material) && key !== 'map') return
  const target = material as MeshPhysicalMaterial
  const embedded = (material.userData as Record<string, unknown>)[`embedded_${key}`]
  if (embedded === undefined) {
    ;(material.userData as Record<string, unknown>)[`embedded_${key}`] = target[key] ?? null
  }
  if (!assetId) {
    const fallback = ((material.userData as Record<string, unknown>)[`embedded_${key}`] ?? null) as MeshPhysicalMaterial[typeof key]
    if (target[key] !== fallback) {
      target[key] = fallback
      material.needsUpdate = true
    }
    return
  }
  const texture = unityMetallicGloss ? host.getUnityMetallicRoughnessTexture(assetId) : host.getTexture(assetId, colorMap)
  if (target[key] !== texture) {
    target[key] = texture
    material.needsUpdate = true
  }
}

function paintWithHost(material: Material, slot: SurfaceSlot, host: MaterialEngineHost) {
  const basic = material as MeshBasicMaterial
  const standard = material as MeshStandardMaterial
  const transparency = transparencyOf(slot)
  const nextSide = sideFor(slot.cull)
  let structuralChange =
    material.side !== nextSide ||
    material.transparent !== transparency.transparent ||
    (material.alphaTest > 0) !== (transparency.alphaTest > 0)
  material.side = nextSide
  ;(material as MeshBasicMaterial).wireframe = slot.wireframe
  material.depthWrite = transparency.depthWrite
  material.transparent = transparency.transparent
  material.opacity = transparency.opacity
  material.alphaTest = transparency.alphaTest
  basic.color?.set(slot.color)
  if (slot.shader === 'particle-unlit') {
    if (!material.transparent) structuralChange = true
    material.transparent = true
    material.depthWrite = slot.depthWrite
    material.opacity = slot.opacity
    const prevBlend = material.blending
    const prevPremult = material.premultipliedAlpha
    applyParticleBlend(material, slot.particleBlend ?? 'additive')
    if (material.blending !== prevBlend || material.premultipliedAlpha !== prevPremult) structuralChange = true
    assignMapWithHost(basic, 'map', slot.mapAssetId, true, host)
    if (structuralChange) material.needsUpdate = true
    return
  }
  if (slot.shader === 'unlit-color') {
    if (basic.map !== null) {
      basic.map = null
      structuralChange = true
    }
    if (structuralChange) material.needsUpdate = true
    return
  }
  if (slot.shader === 'lit' || slot.shader === 'physical' || slot.shader === 'unity-standard') {
    const isUnity = slot.shader === 'unity-standard'
    const hasMrMap = Boolean(slot.metallicRoughnessAssetId)
    standard.metalness = isUnity && hasMrMap ? 1 : slot.metalness
    standard.roughness = slot.roughness
    standard.emissive?.set(slot.emissive)
    standard.emissiveIntensity = slot.emissiveIntensity
    standard.aoMapIntensity = slot.ao
    if (standard.normalScale) standard.normalScale.set(slot.normalScale, slot.normalScale)
    else standard.normalScale = new Vector2(slot.normalScale, slot.normalScale)
    assignMapWithHost(standard, 'map', slot.mapAssetId, true, host)
    assignMapWithHost(standard, 'normalMap', slot.normalAssetId, false, host)
    assignMapWithHost(standard, 'roughnessMap', slot.metallicRoughnessAssetId, false, host, isUnity)
    assignMapWithHost(standard, 'metalnessMap', slot.metallicRoughnessAssetId, false, host, isUnity)
    assignMapWithHost(standard, 'emissiveMap', slot.emissiveAssetId, true, host)
    assignMapWithHost(standard, 'aoMap', slot.aoAssetId ?? slot.metallicRoughnessAssetId, false, host, isUnity && !slot.aoAssetId)
    if (slot.shader === 'physical' && (standard as MeshPhysicalMaterial).isMeshPhysicalMaterial) {
      const phys = standard as MeshPhysicalMaterial
      const nextClearcoat = slot.clearcoatEnabled ? (slot.clearcoat ?? 0) : 0
      const nextTransmission = slot.transmissionEnabled ? (slot.transmission ?? 0) : 0
      const nextSheen = slot.sheenEnabled ? (slot.sheen ?? 0) : 0
      const nextIridescence = slot.iridescenceEnabled ? (slot.iridescence ?? 0) : 0
      if (
        (phys.clearcoat > 0) !== (nextClearcoat > 0)
        || (phys.transmission > 0) !== (nextTransmission > 0)
        || (phys.sheen > 0) !== (nextSheen > 0)
        || (phys.iridescence > 0) !== (nextIridescence > 0)
      ) {
        structuralChange = true
      }

      phys.clearcoat = nextClearcoat
      phys.clearcoatRoughness = slot.clearcoatEnabled ? (slot.clearcoatRoughness ?? 0) : 0
      assignMapWithHost(phys, 'clearcoatMap', slot.clearcoatEnabled ? (slot.clearcoatMapAssetId ?? null) : null, false, host)
      assignMapWithHost(phys, 'clearcoatRoughnessMap', slot.clearcoatEnabled ? (slot.clearcoatRoughnessMapAssetId ?? null) : null, false, host)
      assignMapWithHost(phys, 'clearcoatNormalMap', slot.clearcoatEnabled ? (slot.clearcoatNormalMapAssetId ?? null) : null, false, host)

      phys.transmission = nextTransmission
      phys.ior = slot.transmissionEnabled ? (slot.ior ?? 1.5) : 1.5
      phys.thickness = slot.transmissionEnabled ? (slot.thickness ?? 0) : 0
      phys.attenuationColor.set(slot.transmissionEnabled ? (slot.attenuationColor ?? '#ffffff') : '#ffffff')
      phys.attenuationDistance = slot.transmissionEnabled && (slot.attenuationDistance ?? 0) > 0 ? slot.attenuationDistance! : Infinity

      phys.sheen = nextSheen
      phys.sheenRoughness = slot.sheenEnabled ? (slot.sheenRoughness ?? 1) : 1
      phys.sheenColor.set(slot.sheenEnabled ? (slot.sheenColor ?? '#ffffff') : '#ffffff')

      phys.iridescence = nextIridescence
      phys.iridescenceIOR = slot.iridescenceEnabled ? (slot.iridescenceIOR ?? 1.3) : 1.3
      const iriThick = slot.iridescenceThickness ?? 400
      phys.iridescenceThicknessRange = [100, Math.max(100, iriThick)]

      phys.specularIntensity = slot.specularEnabled ? (slot.specularIntensity ?? 1) : 1
      phys.specularColor.set(slot.specularEnabled ? (slot.specularColor ?? '#ffffff') : '#ffffff')
    }
  } else {
    assignMapWithHost(basic, 'map', slot.mapAssetId, true, host)
  }
  if (structuralChange) material.needsUpdate = true
}

export function applySlotWithHost(material: Material, slot: PbrSlot, host: MaterialEngineHost): Material {
  const surface = normalizeSlot(slot)
  if (surface.shader.startsWith('custom:')) {
    const shaderId = surface.shader.slice('custom:'.length)
    const record = host.getCustomShader(shaderId)
    if (record?.definition) {
      const assetRev = host.getAssetRevision?.() ?? 0
      const key = `${shaderId}:${record.updatedAt}:${assetRev}`
      let next = material
      if (material.userData?.t3dCustomShaderKey !== key) {
        const built = buildMaterialFromShader(record.definition, surface.shaderParams)
        next = built.material
        next.name = material.name
        const token = materialSlotToken(material)
        if (token != null) next.userData.t3dSlot = token
        next.userData.t3dCustomShaderKey = key
        next.userData.t3dCustomShaderUniforms = built.uniforms
        next.userData.t3dCustomShaderParamsSig = surface.shaderParams ? JSON.stringify(surface.shaderParams) : ''
      } else {
        const paramsSig = surface.shaderParams ? JSON.stringify(surface.shaderParams) : ''
        if (next.userData.t3dCustomShaderParamsSig !== paramsSig) {
          next.userData.t3dCustomShaderParamsSig = paramsSig
          const uniforms = next.userData.t3dCustomShaderUniforms as Record<string, ShaderUniformEntry> | undefined
          if (uniforms && surface.shaderParams) {
            for (const [paramKey, entry] of Object.entries(uniforms)) {
              if (paramKey in surface.shaderParams) {
                entry.node.value = coerceShaderUniformValue(entry.schema, surface.shaderParams[paramKey])
              }
            }
          }
        }
      }
      if (!record.definition.doubleSided) {
        next.side = sideFor(surface.cull)
      }
      ;(next as MeshBasicMaterial).wireframe = surface.wireframe
      return next
    }
  }
  const next = ensureClass(material, surface)
  paintWithHost(next, surface, host)
  return next
}

export function applyNodeMaterialWithHost(root: Mesh, node: SceneNode, host: MaterialEngineHost): Material {
  const geometry = root.geometry as BufferGeometry | undefined
  if (geometry?.attributes.uv && !geometry.attributes.uv2) geometry.setAttribute('uv2', geometry.attributes.uv)
  const current = Array.isArray(root.material) ? root.material[0] : root.material
  const next = applySlotWithHost(current, slotFromNodeWithHost(node, host), host)
  if (next !== current) root.material = next
  return next
}

export function slotIndexForMaterial(
  material: Material | null | undefined,
  slots: PbrSlot[],
  indexByName: Map<string, number>,
  indexByNormName?: Map<string, number>,
): number {
  const token = materialSlotToken(material)
  if (token != null && token < slots.length) return token
  if (material?.name) {
    const exact = indexByName.get(material.name)
    if (exact != null) return exact
    const norm = indexByNormName?.get(normalizeMaterialKey(material.name))
    if (norm != null) return norm
  }
  return slots.length === 1 ? 0 : -1
}

export function applyModelMaterialsWithHost(
  root: Object3D,
  slots: PbrSlot[],
  host: MaterialEngineHost,
  partOverrides?: Record<string, ModelPartOverride>,
) {
  const indexByName = new Map(slots.map((slot, index) => [slot.name, index]))
  const indexByNormName = new Map(slots.map((slot, index) => [normalizeMaterialKey(slot.name), index]))
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
      const overrideRaw = host.getMaterialSlot(partOverrides?.[path]?.materialAssetId)
      const overrideSlot = overrideRaw ? normalizeSlot({ ...overrideRaw, materialAssetId: null }) : null
      const existingIndices = Array.isArray(mesh.userData.t3dSlotIndices) ? (mesh.userData.t3dSlotIndices as number[]) : null
      const slotIndices: number[] = []
      const next = materials.map((material, index) => {
        const slotIndex = existingIndices?.[index] ?? slotIndexForMaterial(material, slots, indexByName, indexByNormName)
        slotIndices.push(slotIndex)
        if (!material) return material
        if (overrideSlot) {
          const painted = applySlotWithHost(material, overrideSlot, host)
          painted.name = material.name
          painted.userData.t3dSlot = slotIndex
          return painted
        }
        const matchedSlot = (slotIndex >= 0 ? slots[slotIndex] : undefined)
          ?? (material.name ? slots[indexByName.get(material.name) ?? indexByNormName.get(normalizeMaterialKey(material.name)) ?? -1] : undefined)
          ?? (slots.length === 1 ? slots[0] : undefined)
        if (!matchedSlot) return material
        const painted = applySlotWithHost(material, resolveModelSlotWithHost(matchedSlot, host), host)
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

export function particleDescForWithHost(
  materialAssetId: string | null,
  host: MaterialEngineHost,
): ParticleMaterialDesc | 'incompatible' | null {
  if (!materialAssetId) return null
  const raw = host.getMaterialSlot(materialAssetId)
  if (!raw) return null
  const slot = normalizeSlot(raw)
  if (slot.shader !== 'particle-unlit') return 'incompatible'
  return {
    color: slot.color,
    opacity: slot.opacity,
    map: host.getTexture(slot.mapAssetId, true),
    blend: slot.particleBlend ?? 'additive',
    depthWrite: slot.depthWrite,
    depthTest: true,
    side: sideFor(slot.cull),
  }
}

/**
 * 统一的模型原始槽位扫描与标记：
 * 在模型首次加载时建立 `material.userData.t3dSlot` 与 `mesh.userData.t3dSlotIndices`，
 * 确保编辑器与独立运行时拥有 100% 相同的槽位顺序和索引。
 */
export function readModelSlots(root: Object3D): PbrSlot[] {
  const slots: PbrSlot[] = []
  const seen = new Set<string>()
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const indices: number[] = []
    for (const material of materials) {
      if (!material) {
        indices.push(-1)
        continue
      }
      const added = slotFromMaterial(material, seen, slots.length)
      if (added.length > 0) {
        const index = slots.length
        slots.push(...added)
        material.userData.t3dSlot = index
        indices.push(index)
      } else {
        const index = slots.findIndex((slot) => slot.name === material.name)
        material.userData.t3dSlot = index
        indices.push(index)
      }
    }
    mesh.userData.t3dSlotIndices = indices
  })
  return slots
}

function slotFromMaterial(material: Material, seen: Set<string>, index: number): PbrSlot[] {
  const name = material.name || `材质 ${index + 1}`
  if (seen.has(name)) return []
  seen.add(name)
  const standard = material as MeshStandardMaterial
  const emissiveHex = standard.emissive ? `#${standard.emissive.getHexString()}` : '#000000'
  const hasEmissive = Boolean(standard.emissiveMap) || emissiveHex !== '#000000'
  return [
    {
      name,
      color: standard.color ? `#${standard.color.getHexString()}` : '#ffffff',
      metalness: standard.metalness ?? 0,
      roughness: standard.roughness ?? 0.5,
      emissive: emissiveHex,
      emissiveIntensity: hasEmissive ? (standard.emissiveIntensity ?? 1) : 0,
      opacity: standard.opacity ?? 1,
      ao: standard.aoMapIntensity ?? 1,
      mapAssetId: null,
      normalAssetId: null,
      metallicRoughnessAssetId: null,
      emissiveAssetId: null,
      aoAssetId: null,
    },
  ]
}

export function cloneMaterialWithSlotToken(material: Material): Material {
  const next = material.clone()
  if (material.userData?.t3dSlot !== undefined) {
    next.userData = { ...next.userData, t3dSlot: material.userData.t3dSlot }
  }
  return next
}

export function normalizeSkinIndex(root: Object3D) {
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const geometry = mesh.geometry as BufferGeometry | undefined
    const skinIndex = geometry?.attributes.skinIndex as (BufferAttribute & { gpuType?: number; isInterleavedBufferAttribute?: boolean }) | undefined
    if (
      geometry &&
      skinIndex &&
      (skinIndex.array instanceof Uint32Array ||
        skinIndex.array instanceof Int32Array ||
        skinIndex.gpuType === IntType ||
        skinIndex.isInterleavedBufferAttribute)
    ) {
      const next = new Uint16Array(skinIndex.count * 4)
      for (let i = 0; i < skinIndex.count; i += 1) {
        next[i * 4] = skinIndex.getX(i)
        next[i * 4 + 1] = skinIndex.getY(i)
        next[i * 4 + 2] = skinIndex.getZ(i)
        next[i * 4 + 3] = skinIndex.getW(i)
      }
      geometry.setAttribute('skinIndex', new BufferAttribute(next, 4))
    }
  })
}

export function shareSkeletons(root: Object3D) {
  const bySignature = new Map<string, Skeleton>()
  root.traverse((child) => {
    const mesh = child as Mesh & { isSkinnedMesh?: boolean; skeleton?: Skeleton }
    const skeleton = mesh.skeleton
    if (!mesh.isSkinnedMesh || !skeleton) return
    const signature = skeleton.bones.map((bone) => bone.uuid).join(':')
    const shared = bySignature.get(signature)
    if (shared && shared.boneInverses.length === skeleton.boneInverses.length) {
      mesh.skeleton = shared
    } else if (!shared) {
      bySignature.set(signature, skeleton)
    }
  })
}

const BONE_BUCKETS = [16, 32, 64, 128, 256, 512, 1024]

/**
 * 统一的模型模板克隆与实例化：
 * 负责 `normalizeSkinIndex`、`cloneSkinned`、`shareSkeletons`、`padSkeletons`、
 * 材质槽标记克隆以及初始材质应用，供编辑器与独立 Player 100% 共用。
 */
export function instantiateModelScene(
  templateScene: Object3D,
  templateSlots: PbrSlot[],
  host: MaterialEngineHost,
  cloneFn: (source: Object3D) => Object3D,
): Object3D {
  normalizeSkinIndex(templateScene)
  const object = cloneFn(templateScene)
  shareSkeletons(object)
  padSkeletons(object)
  object.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    if ((mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh) mesh.frustumCulled = false
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((material) => cloneMaterialWithSlotToken(material))
    else mesh.material = cloneMaterialWithSlotToken(mesh.material)
  })
  applyModelMaterialsWithHost(object, templateSlots, host)
  return object
}

export function padSkeletons(root: Object3D) {
  const done = new Set<Skeleton>()
  root.traverse((child) => {
    const mesh = child as Mesh & { isSkinnedMesh?: boolean; skeleton?: Skeleton }
    const skeleton = mesh.skeleton
    if (!mesh.isSkinnedMesh || !skeleton || done.has(skeleton)) return
    done.add(skeleton)
    const count = skeleton.bones.length
    if (count === 0 || skeleton.boneInverses.length !== count) return
    const target = BONE_BUCKETS.find((size) => size >= count)
    if (!target || target === count) return
    const bone = skeleton.bones[0]
    const inverse = skeleton.boneInverses[0]
    // Skeleton.clone() 与模板共用同一个 boneInverses 数组：必须先拷贝再补齐，
    // 否则模板的数组被撑长，下一次克隆时长度对不上，three 会把逆绑定矩阵全部重置为单位矩阵（角色炸开）
    skeleton.bones = skeleton.bones.slice()
    skeleton.boneInverses = skeleton.boneInverses.slice()
    for (let i = count; i < target; i += 1) {
      skeleton.bones.push(bone)
      skeleton.boneInverses.push(inverse.clone())
    }
    skeleton.boneMatrices = new Float32Array(target * 16)
    skeleton.update()
  })
}

function applyPropertyToSingleMaterial(mat: Material, prop: string, value: unknown) {
  if (prop.startsWith('shaderParams.')) {
    const paramKey = prop.slice('shaderParams.'.length)
    const uniforms = mat.userData?.t3dCustomShaderUniforms as Record<string, ShaderUniformEntry> | undefined
    const entry = uniforms?.[paramKey]
    if (entry) {
      entry.node.value = coerceShaderUniformValue(entry.schema, value)
    }
    return
  }
  const std = mat as MeshStandardMaterial & MeshBasicMaterial & MeshPhysicalMaterial
  switch (prop) {
    case 'color':
      if (std.color && typeof value === 'string') std.color.set(value)
      break
    case 'emissive':
      if (std.emissive && typeof value === 'string') std.emissive.set(value)
      break
    case 'emissiveIntensity':
      if (typeof value === 'number') std.emissiveIntensity = value
      break
    case 'metalness':
      if (typeof value === 'number') std.metalness = value
      break
    case 'roughness':
      if (typeof value === 'number') std.roughness = value
      break
    case 'opacity':
      if (typeof value === 'number') {
        const nextTransparent = value < 0.999
        if (mat.transparent !== nextTransparent) {
          mat.transparent = nextTransparent
          mat.needsUpdate = true
        }
        mat.opacity = value
      }
      break
    case 'ao':
      if (typeof value === 'number' && 'aoMapIntensity' in std) std.aoMapIntensity = value
      break
    case 'normalScale':
      if (typeof value === 'number' && std.normalScale) std.normalScale.set(value, value)
      break
    case 'clearcoat':
      if (typeof value === 'number' && 'clearcoat' in std) std.clearcoat = value
      break
    case 'clearcoatRoughness':
      if (typeof value === 'number' && 'clearcoatRoughness' in std) std.clearcoatRoughness = value
      break
    case 'transmission':
      if (typeof value === 'number' && 'transmission' in std) std.transmission = value
      break
    case 'ior':
      if (typeof value === 'number' && 'ior' in std) std.ior = value
      break
    case 'sheen':
      if (typeof value === 'number' && 'sheen' in std) std.sheen = value
      break
    case 'iridescence':
      if (typeof value === 'number' && 'iridescence' in std) std.iridescence = value
      break
  }
}

/**
 * 运行时零重建直接修改 Object3D 材质属性或 TSL 自定义着色器 Uniform。
 * 支持路径：
 * - `color` / `metalness` / `roughness` / `emissive` / `emissiveIntensity` / `opacity` / `shaderParams.<k>`
 * - `slots.<idx>.<prop>`（针对多材质模型指定槽位）
 */
export function applyRuntimeMaterialProperty(root: Object3D, path: string, value: unknown): void {
  let slotFilter = -1
  let prop = path
  if (path.startsWith('slots.')) {
    const rest = path.slice('slots.'.length)
    const dot = rest.indexOf('.')
    if (dot > 0) {
      const idx = Number(rest.slice(0, dot))
      if (Number.isInteger(idx) && idx >= 0) {
        slotFilter = idx
        prop = rest.slice(dot + 1)
      }
    }
  }
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.material) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of list) {
      if (!mat) continue
      if (slotFilter >= 0) {
        const token = materialSlotToken(mat)
        if (token !== null && token !== slotFilter) continue
      }
      applyPropertyToSingleMaterial(mat, prop, value)
    }
  })
}

export function readRuntimeMaterialProperty(root: Object3D, path: string): unknown {
  let slotFilter = -1
  let prop = path
  if (path.startsWith('slots.')) {
    const rest = path.slice('slots.'.length)
    const dot = rest.indexOf('.')
    if (dot > 0) {
      const idx = Number(rest.slice(0, dot))
      if (Number.isInteger(idx) && idx >= 0) {
        slotFilter = idx
        prop = rest.slice(dot + 1)
      }
    }
  }
  let found: unknown = undefined
  root.traverse((child) => {
    if (found !== undefined) return
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.material) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of list) {
      if (!mat) continue
      if (slotFilter >= 0) {
        const token = materialSlotToken(mat)
        if (token !== null && token !== slotFilter) continue
      }
      if (prop.startsWith('shaderParams.')) {
        const paramKey = prop.slice('shaderParams.'.length)
        const uniforms = mat.userData?.t3dCustomShaderUniforms as Record<string, ShaderUniformEntry> | undefined
        const entry = uniforms?.[paramKey]
        if (entry) {
          const val = entry.node.value
          if (val && typeof val === 'object' && 'isColor' in val) found = `#${(val as Color).getHexString()}`
          else if (val && typeof val === 'object' && 'x' in val && 'y' in val) {
            const v = val as { x: number; y: number; z?: number; w?: number }
            found = v.w !== undefined ? [v.x, v.y, v.z ?? 0, v.w] : v.z !== undefined ? [v.x, v.y, v.z] : [v.x, v.y]
          } else {
            found = val
          }
          return
        }
      }
      const std = mat as MeshStandardMaterial & MeshBasicMaterial & MeshPhysicalMaterial
      if (prop === 'color' && std.color) { found = `#${std.color.getHexString()}`; return }
      if (prop === 'emissive' && std.emissive) { found = `#${std.emissive.getHexString()}`; return }
      if (prop === 'emissiveIntensity' && typeof std.emissiveIntensity === 'number') { found = std.emissiveIntensity; return }
      if (prop === 'metalness' && typeof std.metalness === 'number') { found = std.metalness; return }
      if (prop === 'roughness' && typeof std.roughness === 'number') { found = std.roughness; return }
      if (prop === 'opacity') { found = mat.opacity; return }
      if (prop === 'ao' && 'aoMapIntensity' in std) { found = std.aoMapIntensity; return }
      if (prop === 'normalScale' && std.normalScale) { found = std.normalScale.x; return }
    }
  })
  return found
}
