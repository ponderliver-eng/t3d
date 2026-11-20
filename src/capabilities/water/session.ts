import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Mesh,
  PlaneGeometry,
  Sphere,
  Vector3,
  type Intersection,
  type Material,
  type Raycaster,
  type Object3D,
  type Scene,
} from 'three'
import { textureFor } from '../../editor/assets/textures'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode } from '../../editor/scene/types'
import { registerBeforeRenderHook, type ViewportRenderContext } from '../../editor/viewport/renderHooks'
import { capabilityEnabled, type CapabilityRuntimeModule } from '../registry'
import { WATER_CAPABILITY_ID, normalizeWater, type WaterQuality, type WaterSpec } from './defaults'
import { FOLLOW_GRID, createWaterMaterial, waterVariantKey, type WaterMaterialHandle, type WaterMaterialOptions } from './waterMaterial'

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
const SEGMENTS: Record<'flat' | WaterQuality, number> = { flat: 1, fast: 32, balanced: 128, ultra: 160 }

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

/** 水面边长超过这个值 (m) 时，固定细分的平面一格会大于半米，改用跟随相机的环形网格。 */
const FOLLOW_GRID_MIN_SIZE = 64
let followGeo: BufferGeometry | null = null

/**
 * 跟随相机的环形网格：xy 是相对相机落点的米数。中心一个小圆盘等间距分圈，往外每圈半径等比放大，
 * 所以格子大小与距离成正比（近处十几厘米，百米外三四米），屏幕上的密度大致恒定。
 * 最外面再加一圈极远的顶点，着色器把它收到水面边界上，保证水面铺满。约 3.9 万顶点。
 */
function getFollowGeometry(): BufferGeometry {
  if (followGeo) return followGeo
  const { angular, innerRadius, innerRings, outerRadius, farRadius } = FOLLOW_GRID
  const radii: number[] = []
  for (let i = 1; i <= innerRings; i += 1) radii.push((innerRadius * i) / innerRings)
  const ratio = 1 + (Math.PI * 2) / angular
  for (let r = innerRadius * ratio; r < outerRadius; r *= ratio) radii.push(r)
  radii.push(farRadius)

  const positions = new Float32Array((1 + radii.length * angular) * 3)
  radii.forEach((radius, ring) => {
    // 相邻两圈错开半格，三角形更接近等边
    const twist = ring % 2 === 0 ? 0 : Math.PI / angular
    for (let a = 0; a < angular; a += 1) {
      const angle = (a / angular) * Math.PI * 2 + twist
      const at = (1 + ring * angular + a) * 3
      positions[at] = Math.cos(angle) * radius
      positions[at + 1] = Math.sin(angle) * radius
    }
  })

  const indices: number[] = []
  for (let a = 0; a < angular; a += 1) indices.push(0, 1 + a, 1 + ((a + 1) % angular))
  for (let ring = 0; ring < radii.length - 1; ring += 1) {
    const inner = 1 + ring * angular
    const outer = inner + angular
    for (let a = 0; a < angular; a += 1) {
      const next = (a + 1) % angular
      indices.push(inner + a, outer + a, outer + next, inner + a, outer + next, inner + next)
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(positions.length).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2))
  geo.setIndex(indices)
  // 顶点的真实位置由着色器决定（收在单位平面内），包围体按单位平面给，避免编辑器按米数算出巨大的包围盒
  geo.boundingBox = new Box3(new Vector3(-0.5, -0.5, 0), new Vector3(0.5, 0.5, 0))
  geo.boundingSphere = new Sphere(new Vector3(0, 0, 0), Math.SQRT1_2)
  followGeo = geo
  return geo
}

/** 跟随网格的顶点不在真实位置上，点选时按一块完整的单位平面来求交。 */
function raycastAsUnitPlane(this: Mesh, raycaster: Raycaster, intersects: Intersection[]) {
  const geometry = this.geometry
  if (!planeGeos.flat) planeGeos.flat = new PlaneGeometry(1, 1, 1, 1)
  this.geometry = planeGeos.flat
  Mesh.prototype.raycast.call(this, raycaster, intersects)
  this.geometry = geometry
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

function optionsFor(spec: WaterSpec, upAxis: 'y' | 'z', followGrid: boolean): WaterMaterialOptions {
  return {
    followGrid,
    planar: spec.quality !== 'fast' && spec.planarReflection && spec.reflectionScale > 0,
    refraction: spec.refraction,
    caustics: spec.refraction && spec.caustics,
    highDetail: spec.quality !== 'fast',
    upAxis,
    waves: spec.quality !== 'fast' && spec.waveHeight > 0.001,
    richWaves: spec.quality === 'ultra',
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
    root.getWorldScale(tmpWorldScale)
    const hasWaves = spec.quality !== 'fast' && spec.waveHeight > 0.001
    // 只有自带网格的水体物体、有大浪、且水面足够大时才用跟随相机的网格；小水面固定细分已经够密
    const followGrid = node.kind === 'empty' && hasWaves
      && Math.max(Math.abs(tmpWorldScale.x), Math.abs(tmpWorldScale.z)) > FOLLOW_GRID_MIN_SIZE
    const opts = optionsFor(spec, upAxis, followGrid)
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
        const mesh = new Mesh(followGrid ? getFollowGeometry() : getSharedPlaneGeometry(spec), handle.material)
        if (followGrid) mesh.raycast = raycastAsUnitPlane
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
      const targetGeo = followGrid ? getFollowGeometry() : getSharedPlaneGeometry(spec)
      if (entry.mesh.geometry !== targetGeo) entry.mesh.geometry = targetGeo
      if (followGrid) {
        // 网格中心 = 相机在水面局部坐标系里的落点
        entry.mesh.updateWorldMatrix(true, false)
        ctx.camera.getWorldPosition(tmpToCam)
        entry.mesh.worldToLocal(tmpToCam)
        entry.handle.setGridCenter(tmpToCam.x, tmpToCam.y)
      }
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
    // 自带的细分平面知道一格有多大；模型网格的密度未知，传 0 表示不做淡出
    const usesSharedPlane = entry.kind === 'owned' || entry.isPlane === true
    entry.handle.setCellSize(usesSharedPlane
      ? Math.max(Math.abs(tmpWorldScale.x), Math.abs(tmpWorldScale.z)) / SEGMENTS[spec.quality]
      : 0)
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
  followGeo?.dispose()
  followGeo = null
  cachedNodeObjects.clear()
  cachedNodesRef = null
  cachedActiveIds = []
  cachedSunId = null
}

const waterRuntimeModule: CapabilityRuntimeModule = { mount, dispose }
export default waterRuntimeModule
