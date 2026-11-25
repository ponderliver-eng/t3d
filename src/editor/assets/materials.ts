import type { Material, Mesh, Object3D } from 'three'
import { registerShaderTextureResolver } from '../../core/codeAssets/shaderRuntime'
import { useCodeAssetStore } from '../../core/codeAssets/workspace'
import type { ParticleMaterialDesc } from '../../capabilities/particles/runtime'
import {
  applyModelMaterialsWithHost,
  applyNodeMaterialWithHost,
  applySlotWithHost,
  normalizeSlot,
  particleDescForWithHost,
  resolveModelSlotWithHost,
  slotFromNodeWithHost,
  type MaterialEngineHost,
  type SurfaceSlot,
} from '../../runtime/engine/materials'
import type { ModelPartOverride, PbrSlot, SceneNode } from '../scene/types'
import { useAssetStore } from './library'
import { textureFor, unityMetallicRoughnessTextureFor } from './textures'

export { normalizeSlot, type SurfaceSlot }

registerShaderTextureResolver((assetId) => textureFor(assetId, false))

export const editorMaterialHost: MaterialEngineHost = {
  getMaterialSlot: (id) => {
    if (!id) return null
    const asset = useAssetStore.getState().assets[id]
    if (!asset || asset.kind !== 'material') return null
    return asset.slot
  },
  getTexture: (assetId, colorMap) => (assetId ? textureFor(assetId, colorMap) : null),
  getUnityMetallicRoughnessTexture: (assetId) => (assetId ? unityMetallicRoughnessTextureFor(assetId) : null),
  getCustomShader: (shaderId) => {
    const rec = useCodeAssetStore.getState().assets[shaderId]
    if (rec?.kind === 'shader' && rec.compiledShader?.definition) {
      return { definition: rec.compiledShader.definition, updatedAt: rec.updatedAt }
    }
    return null
  },
  getAssetRevision: () => useAssetStore.getState().revision,
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
  return slotFromNodeWithHost(node, editorMaterialHost)
}

export function resolveModelSlot(slot: PbrSlot): SurfaceSlot {
  return resolveModelSlotWithHost(slot, editorMaterialHost)
}

export function applySlot(material: Material, slot: PbrSlot): Material {
  return applySlotWithHost(material, slot, editorMaterialHost)
}

export function applyNodeMaterial(root: Mesh, node: SceneNode): Material {
  return applyNodeMaterialWithHost(root, node, editorMaterialHost)
}

export function applyModelMaterials(root: Object3D, slots: PbrSlot[], partOverrides?: Record<string, ModelPartOverride>) {
  applyModelMaterialsWithHost(root, slots, editorMaterialHost, partOverrides)
}

/** 视口双击拾取：子网格的 materialIndex 对应导入时记下的材质槽。 */
export function slotIndexOnMesh(object: Object3D, materialIndex: number): number | null {
  const stamped = object.userData.t3dSlotIndices
  if (!Array.isArray(stamped)) return null
  const value = stamped[materialIndex] ?? (stamped.length === 1 ? stamped[0] : undefined)
  return typeof value === 'number' && value >= 0 ? value : null
}

export function particleDescFor(materialAssetId: string | null): ParticleMaterialDesc | 'incompatible' | null {
  return particleDescForWithHost(materialAssetId, editorMaterialHost)
}
