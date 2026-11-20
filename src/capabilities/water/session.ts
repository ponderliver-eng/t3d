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
import { evaluateWaterWave } from './waves'

export interface WaterSurfaceSample {
  height: number
  normal: [number, number, number]
  waterNodeId: string
}

interface BoundMesh {
  kind: 'owned' | 'hosted'
  mesh: Mesh
  parent?: Object3D
  originalMaterial?: Material | Material[]
  originalGeometry?: BufferGeometry
  isPlane?: boolean
  handle: WaterMaterialHandle
  waveTime: number
  swellTime?: number
  specRef?: unknown
  spec?: WaterSpec
  worldPos?: Vector3
  worldScale?: Vector3
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
const tmpSamplePoint = new Vector3()
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
 * 跟随相机的近密远疏网格：xy 是相对网格中心的米数，z 存该顶点处的格子大小（着色器用它判断哪些浪采样不足）。
 * 形状见 FOLLOW_GRID 的说明：中心 ±7m 内 0.25m 一格，往外每段间距翻倍，最后用一圈极远的顶点铺到水面边界。
 * 每条轴 197 个坐标，共约 3.9 万顶点。
 */
function getFollowGeometry(): BufferGeometry {
  if (followGeo) return followGeo
  // 半条轴上的坐标与「到达这个坐标的那一格」的间距
  const half: Array<{ at: number, step: number }> = []
  let at = 0
  let lastStep = 0
  for (const [step, count] of FOLLOW_GRID.bands) {
    for (let i = 0; i < count; i += 1) {
      at += step
      half.push({ at, step })
    }
    lastStep = step
  }
  for (let i = 0; i < FOLLOW_GRID.doublingSteps; i += 1) {
    lastStep *= 2
    at += lastStep
    half.push({ at, step: lastStep })
  }
  half.push({ at: FOLLOW_GRID.farRadius, step: FOLLOW_GRID.farRadius })

  // 整条轴：负半轴 + 0 + 正半轴。每个坐标处的格子大小取它两侧间距里较大的那个
  const axis: number[] = [...half.map(entry => -entry.at).reverse(), 0, ...half.map(entry => entry.at)]
  const halfCell = half.map((entry, i) => Math.max(entry.step, half[i + 1]?.step ?? entry.step))
  const axisCell: number[] = [...[...halfCell].reverse(), FOLLOW_GRID.bands[0][0], ...halfCell]

  const count = axis.length
  const positions = new Float32Array(count * count * 3)
  for (let j = 0; j < count; j += 1) {
    for (let i = 0; i < count; i += 1) {
      const slot = (j * count + i) * 3
      positions[slot] = axis[i]
      positions[slot + 1] = axis[j]
      positions[slot + 2] = Math.max(axisCell[i], axisCell[j])
    }
  }
  const indices: number[] = []
  for (let j = 0; j < count - 1; j += 1) {
    for (let i = 0; i < count - 1; i += 1) {
      const a = j * count + i
      const b = a + 1
      const c = a + count
      const d = c + 1
      indices.push(a, b, d, a, d, c)
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(positions.length).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(count * count * 2), 2))
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

/** 规范化后的参数按原始数据的引用缓存：数据没改时每帧不再重新校验、分配一份新对象。 */
const specCache = new WeakMap<object, WaterSpec>()
function specOf(raw: unknown): WaterSpec {
  if (!raw || typeof raw !== 'object') return normalizeWater(raw)
  let spec = specCache.get(raw)
  if (!spec) {
    spec = normalizeWater(raw)
    specCache.set(raw, spec)
  }
  return spec
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
    const spec = specOf(raw)
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
        // 网格中心 = 相机在水面局部坐标系里的落点，按固定步长（米）对齐：
        // 相机在一个步长内移动或旋转时网格完全不动，跨过步长时整体挪一步，顶点落回原有的格点上
        entry.mesh.updateWorldMatrix(true, false)
        ctx.camera.getWorldPosition(tmpToCam)
        entry.mesh.worldToLocal(tmpToCam)
        const sizeX = Math.max(0.001, Math.abs(tmpWorldScale.x))
        const sizeY = Math.max(0.001, Math.abs(tmpWorldScale.z))
        const snap = FOLLOW_GRID.snap
        entry.handle.setGridCenter(
          (Math.round((tmpToCam.x * sizeX) / snap) * snap) / sizeX,
          (Math.round((tmpToCam.y * sizeY) / snap) * snap) / sizeY,
        )
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
    // 起落节奏单独累计时间：拖动「起落频率」时只改变之后的快慢，不会让相位突跳
    entry.swellTime = (entry.swellTime ?? entry.waveTime) + dt * spec.waveSpeed * spec.swellRate
    root.getWorldScale(tmpWorldScale)
    entry.spec = spec
    if (!entry.worldPos) entry.worldPos = new Vector3()
    if (!entry.worldScale) entry.worldScale = new Vector3(1, 1, 1)
    root.getWorldPosition(entry.worldPos)
    entry.worldScale.copy(tmpWorldScale)
    entry.handle.setInvScale(tmpWorldScale)
    // 自带的细分平面知道一格有多大；模型网格的密度未知，传 0 表示不做淡出
    const usesSharedPlane = entry.kind === 'owned' || entry.isPlane === true
    entry.handle.setCellSize(usesSharedPlane
      ? Math.max(Math.abs(tmpWorldScale.x), Math.abs(tmpWorldScale.z)) / SEGMENTS[spec.quality]
      : 0)
    entry.handle.setTime(waterTime, entry.waveTime, entry.swellTime)
    entry.handle.setSun(tmpSunDir, tmpSunColor, sunIntensity, tmpSkyHorizon, tmpSkyTop)
  }
}

/**
 * 在世界坐标 (worldX, worldZ) 处查询当前激活水体的波面高度与法线。
 * 若该位置不在任何水体水平覆盖范围内，返回 null。
 */
export function sampleWaterSurface(worldX: number, worldZ: number): WaterSurfaceSample | null {
  if (boundMeshes.size === 0) return null
  let best: WaterSurfaceSample | null = null
  for (const [id, entry] of boundMeshes) {
    const spec = entry.spec
    const worldPos = entry.worldPos
    const worldScale = entry.worldScale
    if (!spec || !spec.enabled || !worldPos || !worldScale) continue
    if (entry.kind === 'owned') {
      const parent = entry.parent
      if (parent) {
        tmpSamplePoint.set(worldX, worldPos.y, worldZ)
        parent.worldToLocal(tmpSamplePoint)
        if (Math.abs(tmpSamplePoint.x) > 0.5 || Math.abs(tmpSamplePoint.z) > 0.5) continue
      } else {
        if (
          Math.abs(worldX - worldPos.x) > Math.abs(worldScale.x) * 0.5
          || Math.abs(worldZ - worldPos.z) > Math.abs(worldScale.z) * 0.5
        ) continue
      }
    }
    const wave = evaluateWaterWave(worldX, worldZ, spec, entry.waveTime, entry.swellTime ?? entry.waveTime)
    const height = worldPos.y + wave.dy
    if (!best || height > best.height) {
      best = { height, normal: wave.normal, waterNodeId: id }
    }
  }
  return best
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
