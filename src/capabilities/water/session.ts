import {
  Color,
  DirectionalLight,
  Mesh,
  PlaneGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Scene,
} from 'three'
import { textureFor } from '../../editor/assets/textures'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode } from '../../editor/scene/types'
import { registerBeforeRenderHook, type ViewportRenderContext } from '../../editor/viewport/renderHooks'
import { capabilityEnabled, type CapabilityRuntimeModule } from '../registry'
import { WATER_CAPABILITY_ID, normalizeWater, type WaterQuality, type WaterSpec } from './defaults'
import { createWaterMaterial, waterVariantKey, type WaterMaterialHandle, type WaterMaterialOptions } from './waterMaterial'

interface BoundMesh {
  kind: 'owned' | 'hosted'
  mesh: Mesh
  parent?: Object3D
  originalMaterial?: Material | Material[]
  originalGeometry?: BufferGeometry
  isPlane?: boolean
  handle: WaterMaterialHandle
  waveTime: number
  specRef?: unknown
  normalId?: string | null
  foamId?: string | null
  normalTex?: ReturnType<typeof textureFor>
  foamTex?: ReturnType<typeof textureFor>
}

const boundMeshes = new Map<string, BoundMesh>()
const planeGeos: Record<'flat' | WaterQuality, PlaneGeometry | null> = { flat: null, fast: null, balanced: null, ultra: null }
const SEGMENTS: Record<'flat' | WaterQuality, number> = { flat: 1, fast: 32, balanced: 64, ultra: 96 }

let removeBeforeRender: (() => void) | null = null
let waterTime = 0

let cachedNodesRef: Record<string, SceneNode> | null = null
let cachedActiveIds: string[] = []
let cachedSunId: string | null = null
const cachedNodeObjects = new Map<string, Object3D>()
let cachedSceneRef: Scene | null = null
let cachedChildCount = -1

const tmpToCam = new Vector3()
const tmpWorldScale = new Vector3(1, 1, 1)
const tmpSunDir = new Vector3(0.45, 0.72, 0.52).normalize()
const tmpSunColor = new Color('#fff7e0')
const tmpSkyHorizon = new Color('#e0f2fe')
const tmpSkyTop = new Color('#7dd3fc')
const tmpBgColor = new Color('#141414')
const DAY_HORIZON = new Color('#e0f2fe')
const DAY_TOP = new Color('#7dd3fc')
const DUSK_HORIZON = new Color('#fed7aa')
const DUSK_TOP = new Color('#475569')
const NIGHT_HORIZON = new Color('#1e293b')
const NIGHT_TOP = new Color('#020617')

function getSharedPlaneGeometry(spec: WaterSpec): PlaneGeometry {
  // 无波浪时只需 2 个三角形（1x1），有波浪时按画质切换细分网格
  const tier: 'flat' | WaterQuality = spec.quality === 'fast' || spec.waveHeight <= 0.001 ? 'flat' : spec.quality
  if (!planeGeos[tier]) {
    const seg = SEGMENTS[tier]
    planeGeos[tier] = new PlaneGeometry(1, 1, seg, seg)
  }
  return planeGeos[tier]!
}

function refreshActiveNodes(nodes: Record<string, SceneNode>) {
  if (nodes === cachedNodesRef) return
  cachedNodesRef = nodes
  cachedActiveIds = []
  cachedSunId = null
  for (const node of Object.values(nodes)) {
    if (!cachedSunId && node.kind === 'directional-light' && node.visible) {
      cachedSunId = node.id
    }
    const raw = node.capabilities?.[WATER_CAPABILITY_ID]
    if (!raw || typeof raw !== 'object') continue
    if ((raw as { enabled?: boolean }).enabled !== true) continue
    if (node.kind !== 'empty' && node.kind !== 'plane' && node.kind !== 'model') continue
    cachedActiveIds.push(node.id)
  }
}

function resolveNodeObject(scene: Scene, id: string): Object3D | null {
  const hit = cachedNodeObjects.get(id)
  if (hit && hit.parent) return hit
  if (cachedSceneRef !== scene || scene.children.length !== cachedChildCount) {
    cachedSceneRef = scene
    cachedChildCount = scene.children.length
  }
  let found: Object3D | null = null
  scene.traverse(child => {
    if (child.userData?.t3dWaterMesh) return
    const nid = child.userData?.nodeId
    if (typeof nid === 'string' && !cachedNodeObjects.has(nid)) {
      cachedNodeObjects.set(nid, child)
    }
    if (!found && nid === id) found = child
  })
  return found
}

function firstMeshOf(root: Object3D): Mesh | null {
  let found: Mesh | null = null
  root.traverse(child => {
    if (found) return
    if (child.userData?.t3dWaterMesh) return
    const mesh = child as Mesh
    if (mesh.isMesh) found = mesh
  })
  return found
}

function releaseBound(id: string) {
  const entry = boundMeshes.get(id)
  if (!entry) return
  entry.handle.reflectionTarget?.removeFromParent()
  if (entry.kind === 'owned') {
    entry.mesh.removeFromParent()
  } else {
    if (entry.originalMaterial) entry.mesh.material = entry.originalMaterial
    if (entry.originalGeometry) entry.mesh.geometry = entry.originalGeometry
  }
  entry.handle.dispose()
  boundMeshes.delete(id)
}

function updateSunAndSky(scene: Scene, backgroundHex: string): number {
  let intensity = 1.0
  const sunGroup = cachedSunId ? resolveNodeObject(scene, cachedSunId) : null
  let dirLight: DirectionalLight | null = null
  if (sunGroup) {
    sunGroup.traverse(child => {
      if (!dirLight && (child as DirectionalLight).isDirectionalLight) dirLight = child as DirectionalLight
    })
  }
  if (dirLight) {
    const light = dirLight as DirectionalLight
    light.getWorldPosition(tmpSunDir)
    light.target.getWorldPosition(tmpToCam)
    tmpSunDir.sub(tmpToCam).normalize()
    if (tmpSunDir.lengthSq() < 1e-4) tmpSunDir.set(0.45, 0.72, 0.52).normalize()
    tmpSunColor.copy(light.color)
    intensity = light.intensity
  } else {
    tmpSunDir.set(0.45, 0.72, 0.52).normalize()
    tmpSunColor.set('#fff7e0')
  }

  // 根据方向光仰角 + 场景背景色自适应兜底天空反射，确保黄昏/夜景或无平面反射时色调一致
  const elev = tmpSunDir.y
  if (elev <= 0.02) {
    tmpSkyHorizon.copy(NIGHT_HORIZON)
    tmpSkyTop.copy(NIGHT_TOP)
  } else if (elev < 0.28) {
    const t = Math.min(1, Math.max(0, (elev - 0.02) / 0.26))
    tmpSkyHorizon.copy(DUSK_HORIZON).lerp(DAY_HORIZON, t)
    tmpSkyTop.copy(DUSK_TOP).lerp(DAY_TOP, t)
  } else {
    tmpSkyHorizon.copy(DAY_HORIZON)
    tmpSkyTop.copy(DAY_TOP)
  }
  if (scene.background instanceof Color) {
    tmpSkyHorizon.lerp(scene.background, 0.35)
    tmpSkyTop.lerp(scene.background, 0.25)
  } else {
    tmpBgColor.set(backgroundHex || '#141414')
    if (tmpBgColor.r + tmpBgColor.g + tmpBgColor.b > 0.25) {
      tmpSkyHorizon.lerp(tmpBgColor, 0.25)
    }
  }
  return intensity
}

function optionsFor(spec: WaterSpec, upAxis: 'y' | 'z'): WaterMaterialOptions {
  return {
    planar: spec.quality !== 'fast' && spec.planarReflection && spec.reflectionScale > 0,
    refraction: spec.refraction,
    caustics: spec.refraction && spec.caustics,
    highDetail: spec.quality !== 'fast',
    upAxis,
  }
}

function onBeforeRender(ctx: ViewportRenderContext) {
  const editor = useEditorStore.getState()
  if (!capabilityEnabled(editor.capabilities, WATER_CAPABILITY_ID)) {
    for (const id of [...boundMeshes.keys()]) releaseBound(id)
    cachedNodesRef = null
    cachedActiveIds = []
    return
  }

  refreshActiveNodes(editor.nodes)
  const activeSet = new Set(cachedActiveIds)
  for (const id of [...boundMeshes.keys()]) {
    if (!activeSet.has(id)) releaseBound(id)
  }
  if (cachedActiveIds.length === 0) return

  waterTime += Math.min(0.05, Math.max(0, ctx.dt))
  const dt = Math.min(0.05, Math.max(0, ctx.dt))
  const sunIntensity = updateSunAndSky(ctx.scene, editor.picture.background)

  for (const id of cachedActiveIds) {
    const node = editor.nodes[id]
    if (!node) continue
    const raw = node.capabilities?.[WATER_CAPABILITY_ID]
    const spec = normalizeWater(raw)
    if (!spec.enabled) continue

    const root = resolveNodeObject(ctx.scene, id)
    if (!root) continue

    const upAxis: 'y' | 'z' = node.kind === 'model' ? 'y' : 'z'
    const opts = optionsFor(spec, upAxis)
    const nextVariant = waterVariantKey(opts)

    let entry = boundMeshes.get(id)
    if (entry && entry.handle.variantKey !== nextVariant) {
      releaseBound(id)
      entry = undefined
    }

    if (node.kind === 'empty') {
      if (entry && (entry.kind !== 'owned' || entry.parent !== root)) {
        releaseBound(id)
        entry = undefined
      }
      if (!entry) {
        const handle = createWaterMaterial(opts)
        const mesh = new Mesh(getSharedPlaneGeometry(spec), handle.material)
        mesh.name = 'water-surface'
        mesh.rotation.x = -Math.PI / 2
        mesh.frustumCulled = false
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.userData.nodeId = id
        mesh.userData.t3dWaterMesh = true
        if (handle.reflectionTarget) mesh.add(handle.reflectionTarget)
        root.add(mesh)
        entry = { kind: 'owned', mesh, parent: root, handle, waveTime: waterTime }
        boundMeshes.set(id, entry)
      }
      const targetGeo = getSharedPlaneGeometry(spec)
      if (entry.mesh.geometry !== targetGeo) entry.mesh.geometry = targetGeo
    } else {
      const hostMesh = firstMeshOf(root)
      if (!hostMesh) continue
      if (entry && (entry.kind !== 'hosted' || entry.mesh !== hostMesh)) {
        releaseBound(id)
        entry = undefined
      }
      if (!entry) {
        const isPlane = node.kind === 'plane'
        const handle = createWaterMaterial(opts)
        if (handle.reflectionTarget) hostMesh.add(handle.reflectionTarget)
        entry = {
          kind: 'hosted',
          mesh: hostMesh,
          originalMaterial: hostMesh.material,
          originalGeometry: hostMesh.geometry,
          isPlane,
          handle,
          waveTime: waterTime,
        }
        boundMeshes.set(id, entry)
      }
      if (entry.isPlane) {
        const targetGeo = getSharedPlaneGeometry(spec)
        if (hostMesh.geometry !== targetGeo) hostMesh.geometry = targetGeo
      }
      if (hostMesh.material !== entry.handle.material) {
        hostMesh.material = entry.handle.material
      }
      hostMesh.castShadow = false
      hostMesh.receiveShadow = false
    }

    const customNormal = spec.normalMapAssetId ? textureFor(spec.normalMapAssetId, false) : null
    const customFoam = spec.foamMapAssetId ? textureFor(spec.foamMapAssetId, false) : null
    if (
      entry.specRef !== raw
      || entry.normalId !== spec.normalMapAssetId
      || entry.foamId !== spec.foamMapAssetId
      || entry.normalTex !== customNormal
      || entry.foamTex !== customFoam
    ) {
      entry.handle.setSpec(spec, customNormal, customFoam)
      entry.specRef = raw
      entry.normalId = spec.normalMapAssetId
      entry.foamId = spec.foamMapAssetId
      entry.normalTex = customNormal
      entry.foamTex = customFoam
    }
    entry.waveTime += dt * spec.waveSpeed
    root.getWorldScale(tmpWorldScale)
    entry.handle.setInvScale(tmpWorldScale)
    entry.handle.setTime(waterTime, entry.waveTime)
    entry.handle.setSun(tmpSunDir, tmpSunColor, sunIntensity, tmpSkyHorizon, tmpSkyTop)
  }
}

export function mount(): () => void {
  if (!removeBeforeRender) {
    removeBeforeRender = registerBeforeRenderHook('water', 30, onBeforeRender)
  }
  return dispose
}

export function dispose() {
  if (removeBeforeRender) {
    removeBeforeRender()
    removeBeforeRender = null
  }
  for (const id of [...boundMeshes.keys()]) releaseBound(id)
  for (const key of ['flat', 'fast', 'balanced', 'ultra'] as const) {
    planeGeos[key]?.dispose()
    planeGeos[key] = null
  }
  cachedNodeObjects.clear()
  cachedNodesRef = null
  cachedActiveIds = []
  cachedSunId = null
}

const waterRuntimeModule: CapabilityRuntimeModule = { mount, dispose }
export default waterRuntimeModule
