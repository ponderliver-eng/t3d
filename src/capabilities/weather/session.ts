import {
  Color,
  DirectionalLight,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  Vector2,
  Vector3,
  type Camera,
  type Scene,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  getScreenPosition,
  getViewPosition,
  isBackgroundDepth,
  length,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  pow,
  reflect,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { EDITOR_HELPER_LAYER } from '../../core/layers'
import type { ScenePicture } from '../../editor/scene/types'
import { getRuntimeWorld } from '../../runtime/world'
import { capabilityEnabled } from '../registry'
import { defaultCloudNoiseTexture } from './cloudTextures'
import {
  WEATHER_CAPABILITY_ID,
  defaultWeatherSettings,
  normalizeWeatherSettings,
  type PrecipitationType,
  type WeatherSettings,
} from './defaults'

/**
 * 18,000 个真随机 3D 粒子，分为近/中/远三层同心环绕盒：
 * 近景核心层（38% 粒子集中在相机周围 0.30×box 范围内）保证雨雪扑面而来的高密度；
 * 中景层（38% 粒子在 0.62×box）与远景层（24% 粒子在 1.15×box）铺满视野。
 */
const MAX_PRECIPITATION_PARTICLES = 18000

let mounted = false
let removeHook: (() => void) | null = null
let elapsedTime = 0

// 闪电状态
let lightningTimer = 2.5
let lightningFlash = 0
let lightningSeed = 1.37

// 太阳方向缓存
const detectedSunDir = new Vector3(0.45, 0.72, 0.52).normalize()
const detectedSunColor = new Color('#fff7e8')
const tmpVec = new Vector3()
const tmpTarget = new Vector3()

// 降水粒子宿主（使用 InstancedBufferGeometry + Mesh，避免 InstancedMesh 矩阵覆盖与线性同余共面伪影）
let precipScene: Scene | null = null
let precipMesh: Mesh | null = null
let precipMat: MeshBasicNodeMaterial | null = null
let precipGeo: InstancedBufferGeometry | null = null

const uPrecipTime = uniform(0)
const uPrecipCamPos = uniform(new Vector3())
const uPrecipBoxSize = uniform(28)
const uPrecipSpeed = uniform(16)
const uPrecipWind = uniform(new Vector3(2.5, 0, 0.8))
const uPrecipMode = uniform(0) // 0=rain, 1=snow, 2=sand
const uPrecipColor = uniform(new Color('#dce9f7'))
const uPrecipOpacity = uniform(0.75)
const uPrecipSplash = uniform(1)

function currentSettings(pictureOverride?: ScenePicture): WeatherSettings {
  try {
    const world = getRuntimeWorld()
    if (!capabilityEnabled(world.getCapabilities(), WEATHER_CAPABILITY_ID)) {
      return { ...defaultWeatherSettings(), enabled: false }
    }
    const picture = pictureOverride ?? world.getPicture()
    return normalizeWeatherSettings(picture.capabilities?.[WEATHER_CAPABILITY_ID])
  } catch {
    if (!pictureOverride) return { ...defaultWeatherSettings(), enabled: false }
    return normalizeWeatherSettings(pictureOverride.capabilities?.[WEATHER_CAPABILITY_ID])
  }
}

export function mount() {
  if (mounted) return () => shutdown()
  mounted = true
  elapsedTime = 0
  lightningTimer = 2.0
  lightningFlash = 0
  removeHook =
    getRuntimeWorld().registerBeforeRenderHook?.(WEATHER_CAPABILITY_ID, 24, (ctx) => {
      onBeforeRender(ctx.scene, ctx.camera, ctx.dt)
    }) ?? null
  return () => shutdown()
}

export function dispose() {
  shutdown()
}

function shutdown() {
  mounted = false
  removeHook?.()
  removeHook = null
  disposePrecipitationMesh()
}

function onBeforeRender(scene: Scene, camera: Camera, dt: number) {
  elapsedTime += dt
  const settings = currentSettings()
  detectMainSun(scene)
  stepLightning(settings, dt)
  syncPrecipitation(scene, camera, settings)
}

function detectMainSun(scene: Scene) {
  let found: DirectionalLight | null = null
  for (const child of scene.children) {
    if ((child as DirectionalLight).isDirectionalLight) {
      const light = child as DirectionalLight
      if (!found || light.intensity > found.intensity) found = light
    }
  }
  if (!found) {
    detectedSunDir.set(0.45, 0.72, 0.52).normalize()
    detectedSunColor.set('#fff7e8')
    return
  }
  found.getWorldPosition(tmpVec)
  found.target?.getWorldPosition(tmpTarget)
  if (!found.target) tmpTarget.set(0, 0, 0)
  tmpVec.sub(tmpTarget)
  if (tmpVec.lengthSq() > 1e-6) {
    detectedSunDir.copy(tmpVec).normalize()
  }
  detectedSunColor.copy(found.color)
}

function stepLightning(settings: WeatherSettings, dt: number) {
  if (!settings.enabled || !settings.lightningEnabled) {
    lightningFlash = 0
    return
  }
  lightningTimer -= dt * settings.lightningFrequency
  if (lightningTimer <= 0) {
    lightningSeed = (lightningSeed * 16807) % 2147483647
    const r = (lightningSeed % 1000) / 1000
    lightningTimer = 2.2 + r * 5.5
    lightningFlash = 1.0
  } else {
    lightningFlash = Math.max(0, lightningFlash - dt * 5.5)
  }
}

function modeIndex(type: PrecipitationType): number {
  if (type === 'snow') return 1
  if (type === 'sand') return 2
  return 0
}

/**
 * 构建真 3D 独立随机分布的降水粒子网格：
 * 在 CPU 端用独立随机数填充 `aSeed` (rx, ry, rz, rSize) 与 `aMotion` (rSpeed, rPhaseX, rPhaseZ, rTier)，
 * 彻底消除 `instanceIndex` 线性同余导致的「旋转镜头出现一排密集直线/平面」伪影，
 * 并通过近/中/远三层同心体积将近景雨雪密度提升 6~8 倍。
 */
function ensurePrecipitationMesh(scene: Scene) {
  if (precipMesh && precipScene === scene) return
  disposePrecipitationMesh()

  const baseQuad = new PlaneGeometry(1, 1, 1, 1)
  precipGeo = new InstancedBufferGeometry()
  precipGeo.index = baseQuad.index
  for (const [name, attr] of Object.entries(baseQuad.attributes)) {
    precipGeo.setAttribute(name, attr)
  }
  baseQuad.dispose()

  const seeds = new Float32Array(MAX_PRECIPITATION_PARTICLES * 4)
  const motions = new Float32Array(MAX_PRECIPITATION_PARTICLES * 4)
  for (let i = 0; i < MAX_PRECIPITATION_PARTICLES; i += 1) {
    const idx = i * 4
    // 3D 空间完全独立均匀随机坐标 [0, 1) + 尺寸随机因子
    seeds[idx + 0] = Math.random()
    seeds[idx + 1] = Math.random()
    seeds[idx + 2] = Math.random()
    seeds[idx + 3] = Math.random()
    // 速度随机、X/Z 摇摆相位随机、分层随机
    motions[idx + 0] = Math.random()
    motions[idx + 1] = Math.random() * Math.PI * 2
    motions[idx + 2] = Math.random() * Math.PI * 2
    motions[idx + 3] = Math.random()
  }

  precipGeo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4))
  precipGeo.setAttribute('aMotion', new InstancedBufferAttribute(motions, 4))
  precipGeo.instanceCount = MAX_PRECIPITATION_PARTICLES

  precipMat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
  })

  const aSeed = attribute('aSeed', 'vec4')
  const aMotion = attribute('aMotion', 'vec4')

  const rx = aSeed.x
  const ry = aSeed.y
  const rz = aSeed.z
  const rSize = aSeed.w

  const rSpeed = aMotion.x
  const rPhaseX = aMotion.y
  const rPhaseZ = aMotion.z
  const rTier = aMotion.w

  const isSnow = uPrecipMode.equal(1)
  const isSand = uPrecipMode.equal(2)

  // 三层同心相机环绕盒：
  // 38% 粒子在 0.32×box（近景高密核心），38% 在 0.64×box（中景），24% 在 1.12×box（远景）
  const tierScale = select(
    rTier.lessThan(0.38),
    float(0.32),
    select(rTier.lessThan(0.76), float(0.64), float(1.12)),
  )
  const boxXZ = uPrecipBoxSize.mul(tierScale)
  const boxY = uPrecipBoxSize.mul(select(rTier.lessThan(0.38), float(0.45), float(0.78)))
  const halfXZ = boxXZ.mul(0.5)
  const halfY = boxY.mul(0.5)

  // 下落速度（每个粒子拥有完全独立的下落速度与初始高度，绝不共面）
  const fallBase = select(isSnow, uPrecipSpeed.mul(0.14), select(isSand, uPrecipSpeed.mul(0.18), uPrecipSpeed))
  const particleSpeed = fallBase.mul(float(0.68).add(rSpeed.mul(0.64)))

  const t = uPrecipTime
  const windOffset = uPrecipWind.mul(t).mul(float(0.8).add(rSpeed.mul(0.4)))

  // 世界空间无限循环取模：先加世界偏移再 mod，相机旋转/移动时粒子锚定在世界空间，绝不随镜头打转
  const worldAnchorX = rx.mul(boxXZ).add(windOffset.x)
  const worldAnchorY = ry.mul(boxY).sub(particleSpeed.mul(t))
  const worldAnchorZ = rz.mul(boxXZ).add(windOffset.z)

  const wrappedX = fract(worldAnchorX.sub(uPrecipCamPos.x).div(boxXZ).add(0.5)).mul(boxXZ).sub(halfXZ).add(uPrecipCamPos.x)
  const wrappedY = fract(worldAnchorY.sub(uPrecipCamPos.y).div(boxY).add(0.5)).mul(boxY).sub(halfY).add(uPrecipCamPos.y)
  const wrappedZ = fract(worldAnchorZ.sub(uPrecipCamPos.z).div(boxXZ).add(0.5)).mul(boxXZ).sub(halfXZ).add(uPrecipCamPos.z)

  // 三维湍流摇摆（雪花大幅度飘忽打旋，沙尘高频抖动，雨丝微幅阵风）
  const swayAmp = select(isSnow, float(0.55).add(rSize.mul(0.45)), select(isSand, float(0.35), float(0.03)))
  const swayFreq = select(isSnow, float(1.4).add(rSpeed.mul(1.2)), float(2.8))
  const swayX = sin(t.mul(swayFreq).add(rPhaseX)).mul(swayAmp)
  const swayY = cos(t.mul(swayFreq.mul(0.8)).add(rPhaseX.add(rPhaseZ))).mul(swayAmp.mul(0.35))
  const swayZ = cos(t.mul(swayFreq.mul(0.9)).add(rPhaseZ)).mul(swayAmp)

  // 是否为地面溅射水花环粒子（雨天且开启 splash 时，抽取 8% 粒子贴在地面 y=0 附近绽放水花环）
  const isSplash = uPrecipMode.equal(0).and(uPrecipSplash.greaterThan(0.5)).and(rTier.greaterThan(0.92))
  const splashLife = fract(t.mul(float(2.2).add(rSpeed.mul(1.5))).add(ry.mul(13.7)))
  const splashRadius = splashLife.mul(float(0.12).add(rSize.mul(0.14)))

  const centerWorld = select(
    isSplash,
    vec3(wrappedX, float(0.03), wrappedZ),
    vec3(wrappedX.add(swayX), wrappedY.add(swayY), wrappedZ.add(swayZ)),
  )

  const quadPos = positionGeometry
  const toCam = normalize(uPrecipCamPos.sub(centerWorld).add(vec3(0, 0.0001, 0)))
  const velDir = normalize(vec3(uPrecipWind.x, particleSpeed.negate(), uPrecipWind.z))

  // 雨/沙尘沿三维速度方向拉伸；雪花使用相机视图平面正交基展开（低头/抬头 90° 也绝不畸变）
  const viewCenter = cameraViewMatrix.mul(vec4(centerWorld, 1.0))

  // 雪花尺寸（近处大雪花 + 远处细雪）
  const snowRadius = float(0.038).add(pow(rSize, float(1.6)).mul(0.085))
  const snowClip = cameraProjectionMatrix.mul(
    vec4(
      viewCenter.x.add(quadPos.x.mul(snowRadius)),
      viewCenter.y.add(quadPos.y.mul(snowRadius)),
      viewCenter.z,
      viewCenter.w,
    ),
  )

  // 雨丝与沙尘尺寸
  const streakWidth = select(isSand, float(0.045).add(rSize.mul(0.04)), float(0.012).add(rSize.mul(0.01)))
  const streakLength = select(isSand, float(0.28).add(rSize.mul(0.25)), float(0.55).add(rSize.mul(0.55)))
  const rightAxis = normalize(cross(velDir, toCam).add(vec3(0.0001, 0, 0)))
  const streakWorld = centerWorld
    .add(rightAxis.mul(quadPos.x.mul(streakWidth)))
    .add(velDir.negate().mul(quadPos.y.mul(streakLength)))

  // 水花环水平贴地展开
  const splashWorld = centerWorld.add(vec3(quadPos.x.mul(splashRadius), float(0.0), quadPos.y.mul(splashRadius)))

  const finalWorld = select(isSplash, splashWorld, streakWorld)
  const worldClip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(finalWorld, 1.0)))

  precipMat.vertexNode = select(isSnow, snowClip, worldClip)

  // 粒子片元形状：
  // 1. 雪花：柔和晶核 + 外围绒毛光晕
  // 2. 雨丝：中心亮芯 + 首尾渐隐运动模糊细丝
  // 3. 水花：扩散渐隐圆环
  const pUv = uv().sub(0.5).mul(2.0)
  const radial = length(pUv)
  const snowCore = exp(radial.mul(radial).mul(-3.2)).mul(smoothstep(float(1.0), float(0.15), radial))
  const streakShape = smoothstep(float(1.0), float(0.0), abs(pUv.x))
    .mul(smoothstep(float(1.0), float(0.0), abs(pUv.y)))
    .mul(float(0.65).add(smoothstep(float(0.35), float(0.0), abs(pUv.x)).mul(0.5)))
  const splashRing = smoothstep(float(0.28), float(0.0), abs(radial.sub(0.72))).mul(float(1.0).sub(splashLife))

  const shapeAlpha = select(isSnow, snowCore, select(isSplash, splashRing, streakShape))

  // 当前层级包围盒边缘平滑淡出 + 近镜头防贴脸淡出
  const relX = abs(centerWorld.x.sub(uPrecipCamPos.x)).div(halfXZ)
  const relY = abs(centerWorld.y.sub(uPrecipCamPos.y)).div(halfY)
  const relZ = abs(centerWorld.z.sub(uPrecipCamPos.z)).div(halfXZ)
  const edgeDist = max(max(relX, relY), relZ)
  const edgeFade = smoothstep(float(1.0), float(0.62), edgeDist)
  const camDist = length(uPrecipCamPos.sub(centerWorld))
  const nearFade = smoothstep(float(0.35), float(1.35), camDist)

  precipMat.colorNode = uPrecipColor
  precipMat.opacityNode = shapeAlpha.mul(edgeFade).mul(nearFade).mul(uPrecipOpacity)

  precipMesh = new Mesh(precipGeo, precipMat)
  precipMesh.name = '__WeatherPrecipitation__'
  precipMesh.frustumCulled = false
  precipMesh.castShadow = false
  precipMesh.receiveShadow = false
  precipMesh.renderOrder = 20
  precipMesh.layers.disableAll()
  for (let bit = 0; bit < EDITOR_HELPER_LAYER; bit += 1) precipMesh.layers.enable(bit)
  scene.add(precipMesh)
  precipScene = scene
}

function disposePrecipitationMesh() {
  if (precipMesh && precipScene) {
    precipScene.remove(precipMesh)
  }
  precipGeo?.dispose()
  precipMat?.dispose()
  precipMesh = null
  precipGeo = null
  precipMat = null
  precipScene = null
}

function syncPrecipitation(scene: Scene, camera: Camera, settings: WeatherSettings) {
  const active = mounted && settings.enabled && settings.precipitationType !== 'none' && settings.precipitationIntensity > 0.01
  if (!active) {
    if (precipMesh) precipMesh.visible = false
    return
  }
  ensurePrecipitationMesh(scene)
  if (!precipMesh || !precipGeo) return

  precipMesh.visible = true
  // 按密度平方根曲线提升中低档粒子数量，保证降雪/降雨饱满密集
  const ratio = Math.pow(settings.precipitationIntensity, 0.75)
  precipGeo.instanceCount = Math.max(
    400,
    Math.min(MAX_PRECIPITATION_PARTICLES, Math.round(MAX_PRECIPITATION_PARTICLES * ratio)),
  )

  camera.getWorldPosition(tmpVec)
  uPrecipCamPos.value.copy(tmpVec)
  uPrecipTime.value = elapsedTime
  uPrecipBoxSize.value = settings.precipitationBoxSize
  uPrecipSpeed.value = 20 * settings.precipitationSpeed
  const rad = (settings.cloudWindAngle * Math.PI) / 180
  uPrecipWind.value.set(Math.cos(rad) * settings.precipitationWind, 0, Math.sin(rad) * settings.precipitationWind)
  uPrecipMode.value = modeIndex(settings.precipitationType)
  uPrecipColor.value.set(settings.precipitationColor)
  const baseOp = settings.precipitationType === 'snow' ? 0.92 : settings.precipitationType === 'sand' ? 0.6 : 0.58
  uPrecipOpacity.value = baseOp * Math.min(1, 0.45 + settings.precipitationIntensity * 0.55)
  uPrecipSplash.value = settings.splashEnabled ? 1 : 0
}

// ── Pipeline 状态查询与 Key ──────────────────────────────────────────────────

export function weatherActive(picture?: ScenePicture): boolean {
  if (!mounted) return false
  const s = currentSettings(picture)
  if (!s.enabled) return false
  return s.cloudsEnabled || s.wetnessEnabled || s.snowCoverEnabled || s.lightningEnabled
}

export function weatherNeedsNormals(picture?: ScenePicture): boolean {
  if (!mounted) return false
  const s = currentSettings(picture)
  return s.enabled && (s.wetnessEnabled || s.snowCoverEnabled)
}

export function weatherPipelineKey(picture?: ScenePicture): string {
  if (!weatherActive(picture)) return 'off'
  const s = currentSettings(picture)
  return [
    'on',
    s.cloudsEnabled ? 1 : 0,
    s.wetnessEnabled ? (s.ripplesEnabled ? 2 : 1) : 0,
    s.snowCoverEnabled ? 1 : 0,
  ].join(':')
}

// ── TSL 高质量旋转多级噪声与云层体积密度工具（无 sin） ────────────────────────

function fastHash12(p: unknown) {
  const pv = vec2(p as never)
  const p3 = fract(vec3(pv.x, pv.y, pv.x).mul(vec3(0.1031, 0.1030, 0.0973)))
  const r = p3.add(dot(p3, p3.yzx.add(33.33)))
  return fract(r.x.add(r.y).mul(r.z))
}

function fastValueNoise2D(p: unknown) {
  const pv = vec2(p as never)
  const i = floor(pv)
  const f = fract(pv)
  // 五次平滑插值曲线（Quintic Hermite），消除传统三次插值在多级叠加时的网格折痕
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0))
  const a = fastHash12(i)
  const b = fastHash12(i.add(vec2(1, 0)))
  const c = fastHash12(i.add(vec2(0, 1)))
  const d = fastHash12(i.add(vec2(1, 1)))
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y)
}

/** 2D 黄金角近似旋转（cos≈0.8, sin≈0.6），打散每一层 Octave 的网格轴向 */
function rotOctave(p: unknown, scale: number, shiftX: number, shiftY: number) {
  const pv = vec2(p as never)
  const rx = pv.x.mul(0.8).sub(pv.y.mul(0.6))
  const ry = pv.x.mul(0.6).add(pv.y.mul(0.8))
  return vec2(rx, ry).mul(scale).add(vec2(shiftX, shiftY))
}

/**
 * 基于 Horizon Zero Dawn / Nubis 预烘焙 4 通道无缝 Perlin-Worley 贴图的体积云密度采样：
 * - R/A 通道：底层与顶层 Perlin-Worley 积云团簇体（随垂直高度 h 插值演变）
 * - G 通道：中频 3 级 Worley 胞状云朵隆起（Cauliflower Lobes）
 * - B 通道：高频 Worley 絮状边缘侵蚀细节（Fine Wispy Erosion）
 */
function samplePerlinWorleyCloud(
  cloudTex: ReturnType<typeof defaultCloudNoiseTexture>,
  uvMacro: unknown,
  hNode: unknown,
  covThreshold: unknown,
) {
  const uvM = vec2(uvMacro as never)
  const h = float(hNode as never)

  // 1. 采样大尺度 Perlin-Worley 主体并按高度插值 R(底层) -> A(顶层)
  const sMacro = texture(cloudTex, uvM)
  const macroBase = mix(sMacro.r, sMacro.a, smoothstep(float(0.15), float(0.85), h))

  // 2. 采样中频胞状团簇与高频边缘碎云（不同旋转与频率，彻底消除重复感与条带感）
  const uvMed = rotOctave(uvM, 3.1, 0.17, 0.31).add(vec2(h.mul(0.13), h.mul(-0.09)))
  const uvFine = rotOctave(uvM, 8.7, 0.43, 0.79).sub(vec2(h.mul(0.21), h.mul(0.17)))
  const sMed = texture(cloudTex, uvMed)
  const sFine = texture(cloudTex, uvFine)
  const detailWorley = sMed.g.mul(0.62).add(sFine.b.mul(0.38))

  // 3. 积云垂直高度剖面（底部略平、中部饱满、顶部圆润收拢成云塔）
  const heightProfile = smoothstep(float(0.0), float(0.18), h).mul(smoothstep(float(1.0), float(0.42), h))
  const shapedMacro = macroBase.mul(heightProfile.mul(0.38).add(0.62))

  // 4. Guerrilla Games remap 侵蚀：云核饱满厚实，外缘被多层 Worley 胞状噪声雕刻出蓬松棉絮与碎云丝
  const covMin = float(covThreshold as never)
  const macroCloud = clamp(shapedMacro.sub(covMin).div(max(float(1.0).sub(covMin), float(0.12))), 0.0, 1.0)
  const erodeWeight = float(1.0).sub(detailWorley).mul(mix(float(0.54), float(0.16), macroCloud))
  return clamp(macroCloud.sub(erodeWeight).div(max(float(1.0).sub(erodeWeight), float(0.2))), 0.0, 1.0)
}

/** 双层重叠雨滴同心圆水波纹（返回法线 X/Z 扰动分量） */
function rainRippleOffset(worldXZ: unknown, timeNode: unknown) {
  const xz = vec2(worldXZ as never)
  const t = float(timeNode as never)

  // 第一层涟漪网格
  const pA = xz.mul(2.1)
  const cellA = floor(pA)
  const localA = fract(pA).sub(0.5)
  const seedA = fastHash12(cellA)
  const phaseA = fract(t.mul(1.15).add(seedA.mul(7.13)))
  const distA = length(localA)
  const ringA = sin(distA.sub(phaseA.mul(0.45)).mul(42.0))
    .mul(smoothstep(float(0.45), float(0.0), distA))
    .mul(smoothstep(float(0.0), float(0.08), distA.sub(phaseA.mul(0.45)).add(0.08)))
    .mul(float(1.0).sub(phaseA))

  // 第二层交错涟漪网格
  const pB = rotOctave(xz, 2.65, 5.37, 8.91)
  const cellB = floor(pB)
  const localB = fract(pB).sub(0.5)
  const seedB = fastHash12(cellB)
  const phaseB = fract(t.mul(1.35).add(seedB.mul(11.3)))
  const distB = length(localB)
  const ringB = sin(distB.sub(phaseB.mul(0.42)).mul(46.0))
    .mul(smoothstep(float(0.42), float(0.0), distB))
    .mul(smoothstep(float(0.0), float(0.08), distB.sub(phaseB.mul(0.42)).add(0.08)))
    .mul(float(1.0).sub(phaseB))

  const dirA = localA.div(max(distA, float(0.001)))
  const dirB = localB.div(max(distB, float(0.001)))
  return dirA.mul(ringA).add(dirB.mul(ringB)).mul(0.18)
}

// ── 通道 A：表面湿润 / 真实反射积水坑 & 表面积雪（全标准材质默认支持） ────────

export interface WeatherSurfacePassHandle {
  node: unknown
  sync: (picture: ScenePicture, camera: Camera) => void
}

export function buildWeatherSurfacePass(
  colorNode: unknown,
  scenePass: { getTextureNode: (name: string) => unknown },
  normalNode: unknown,
  options: { wetness: boolean; ripples: boolean; snow: boolean },
): WeatherSurfacePassHandle {
  const uCamPos = uniform(new Vector3())
  const uCamProj = uniform(new Matrix4())
  const uCamProjInv = uniform(new Matrix4())
  const uCamWorld = uniform(new Matrix4())
  const uCamView = uniform(new Matrix4())
  const uSunDir = uniform(new Vector3(0.45, 0.72, 0.52))
  const uSunColor = uniform(new Color('#fff7e8'))
  const uTime = uniform(0)
  const uWetness = uniform(0)
  const uPuddle = uniform(0)
  const uSnow = uniform(0)
  const uSnowColor = uniform(new Color('#eef5ff'))
  const uLightning = uniform(0)
  // 水坑反射天空云层同步参数
  const uCloudCov = uniform(0.45)
  const uCloudScale = uniform(1.0)
  const uCloudWindOffset = uniform(new Vector2(0, 0))
  const uCloudTint = uniform(new Color('#ffffff'))
  // 与场景「屏幕空间反射 (SSR)」组件完全联动并受其 4 项参数实时控制
  const uSsrEnabled = uniform(1)
  const uSsrQuality = uniform(0.5)
  const uSsrDistance = uniform(8.0)
  const uSsrThickness = uniform(0.03)
  const uSsrIntensity = uniform(1.0)

  const depthTex = scenePass.getTextureNode('depth') as {
    sample: (uv: unknown) => { r: unknown }
  }
  const beautyTex = scenePass.getTextureNode('output') as {
    sample: (uv: unknown) => { rgb: unknown }
  }

  const depthNode = depthTex as never
  const isBg = isBackgroundDepth(depthNode)

  const viewPos = getViewPosition(screenUV, depthNode, uCamProjInv)
  const worldPos = uCamWorld.mul(vec4(viewPos, 1.0)).xyz
  // 必须使用显式 uCamPos（不能用内置 cameraPosition，后期全屏 Pass 中内置相机在原点）
  const viewDir = normalize(uCamPos.sub(worldPos))
  const rawViewNormal = (normalNode as { sample: (uv: unknown) => { rgb: unknown } }).sample(screenUV).rgb
  const worldNormal = normalize(uCamWorld.mul(vec4(rawViewNormal as never, 0.0)).xyz)

  const base = colorNode as { rgb: unknown; a: unknown }
  let surfaceRgb: unknown = base.rgb

  // 1. 雨天表面湿润 + 浸水暗边 + 真实屏幕空间反射（SSR）+ 动态云层倒影积水坑
  if (options.wetness) {
    // 淋雨表面孔隙吸水变暗（绝不变白）
    const wetSurface = uWetness.mul(smoothstep(float(-0.15), float(0.65), worldNormal.y).mul(0.55).add(0.45))
    surfaceRgb = vec3(surfaceRgb as never).mul(mix(float(1.0), float(0.62), wetSurface))

    // 水平地面低洼积水坑分布（域扭曲多级噪声，边缘自然不规则）
    const upFlat = smoothstep(float(0.86), float(0.96), worldNormal.y)
    const pCoord = worldPos.xz.mul(0.11)
    const pWarp = vec2(
      fastValueNoise2D(pCoord.mul(0.7).add(vec2(4.1, 8.3))).sub(0.5),
      fastValueNoise2D(pCoord.mul(0.7).add(vec2(15.2, 1.9))).sub(0.5),
    ).mul(0.6)
    const puddleField = fastValueNoise2D(pCoord.add(pWarp)).mul(0.55)
      .add(fastValueNoise2D(rotOctave(pCoord.add(pWarp), 2.15, 7.3, 19.1)).mul(0.3))
      .add(fastValueNoise2D(rotOctave(pCoord, 4.3, 23.4, 5.7)).mul(0.15))

    const puddleThresh = float(0.92).sub(uPuddle.mul(0.72))
    const puddleActive = clamp(uPuddle.mul(4.0), 0.0, 1.0).mul(upFlat)
    // 水坑外围一圈吸水深色湿边
    const wetRimMask = smoothstep(puddleThresh.sub(0.09), puddleThresh.add(0.02), puddleField).mul(puddleActive)
    // 水坑镜面本体
    const puddleMask = smoothstep(puddleThresh, puddleThresh.add(0.06), puddleField).mul(puddleActive)

    surfaceRgb = vec3(surfaceRgb as never).mul(mix(float(1.0), float(0.68), wetRimMask))

    // 水面涟漪法线
    let puddleNormal: unknown = vec3(0, 1, 0)
    let ripple2D: unknown = vec2(0, 0)
    if (options.ripples) {
      ripple2D = rainRippleOffset(worldPos.xz, uTime)
      const rp = ripple2D as { x: unknown; y: unknown }
      puddleNormal = normalize(vec3(rp.x as never, float(1.0), rp.y as never))
    }

    const reflWorldDir = reflect(viewDir.negate(), puddleNormal as never)
    const reflViewDir = normalize(uCamView.mul(vec4(reflWorldDir, 0.0)).xyz)

    // ── 水坑真实屏幕空间反射（受场景 SSR 组件开关及 ssrQuality / ssrDistance / ssrThickness / ssrIntensity 控制） ──
    const stepFracs = [0.04, 0.09, 0.16, 0.25, 0.37, 0.52, 0.73, 1.0]
    let ssrColor: unknown = vec3(0, 0, 0)
    let ssrHitWeight: unknown = float(0.0)

    for (let i = 0; i < stepFracs.length; i += 1) {
      const frac = stepFracs[i]!
      const dist = max(uSsrDistance, float(0.2)).mul(frac)
      const marchViewPos = viewPos.add(reflViewDir.mul(dist))
      const rawUV = getScreenPosition(marchViewPos, uCamProj)
      const hitUV = clamp(rawUV.add(vec2(ripple2D as never).mul(0.035)), 0.005, 0.995)

      const inBounds = smoothstep(float(0.0), float(0.06), rawUV.x)
        .mul(smoothstep(float(1.0), float(0.94), rawUV.x))
        .mul(smoothstep(float(0.0), float(0.06), rawUV.y))
        .mul(smoothstep(float(1.0), float(0.94), rawUV.y))

      const sampleD = depthTex.sample(hitUV).r
      const notSky = select(isBackgroundDepth(sampleD as never), float(0.0), float(1.0))
      const sceneVP = getViewPosition(hitUV, sampleD as never, uCamProjInv)
      // 视图空间中相机朝向 -Z，sceneVP.z > marchViewPos.z 代表步进点穿过了前景物体表面
      const depthDiff = sceneVP.z.sub(marchViewPos.z)
      // 厚度容差受 ssrThickness 直接驱动
      const thickness = uSsrThickness.mul(16.0).add(dist.mul(0.22))
      // 步进采样质量权重受 ssrQuality 驱动，距离衰减受 ssrDistance 驱动
      const qualityWeight = clamp(uSsrQuality.mul(2.0).add(float(1.0 - i / stepFracs.length)), 0.15, 1.0)
      const distAtten = float(1.0 - frac * 0.45)
      const hitValid = smoothstep(float(-0.08), float(0.04), depthDiff)
        .mul(smoothstep(thickness, thickness.mul(0.22), depthDiff))
        .mul(notSky)
        .mul(inBounds)
        .mul(qualityWeight)
        .mul(distAtten)

      const newHit = hitValid.mul(float(1.0).sub(ssrHitWeight as never))
      const sampledCol = beautyTex.sample(hitUV).rgb
      ssrColor = vec3(ssrColor as never).add(vec3(sampledCol as never).mul(newHit))
      ssrHitWeight = clamp(float(ssrHitWeight as never).add(newHit), 0.0, 1.0)
    }

    // 应用场景 SSR 组件开关与反射强度参数
    const ssrScaledColor = vec3(ssrColor as never).mul(uSsrIntensity)
    const effectiveSsrWeight = clamp(
      float(ssrHitWeight as never).mul(uSsrEnabled).mul(clamp(uSsrIntensity, 0.0, 1.5)),
      0.0,
      1.0,
    )

    // 潮湿非积水地面也带有轻微光泽 SSR 倒影（受 SSR 开关与强度控制）
    const wetGroundGloss = wetSurface.mul(upFlat).mul(float(1.0).sub(puddleMask)).mul(0.22)
    surfaceRgb = vec3(surfaceRgb as never).add(ssrScaledColor.mul(effectiveSsrWeight).mul(wetGroundGloss))

    // ── 水坑倒映的天空与动态云朵（与头顶 Perlin-Worley 体积云同源） ──
    const cloudTex = defaultCloudNoiseTexture()
    const reflY = max(reflWorldDir.y, float(0.02))
    const reflShellDist = sqrt(float(4.0).mul(reflY).mul(reflY).add(4.8)).sub(float(2.0).mul(reflY))
    const reflCloudUV = reflWorldDir.xz.mul(reflShellDist).mul(0.26).div(max(uCloudScale, float(0.15))).add(uCloudWindOffset)
    const reflCovThresh = float(0.76).sub(uCloudCov.mul(0.52))
    const reflCloudMask = samplePerlinWorleyCloud(cloudTex, reflCloudUV, float(0.4), reflCovThresh)
      .mul(smoothstep(float(0.02), float(0.18), reflWorldDir.y))

    const sunElev = clamp(uSunDir.y, -0.2, 1.0)
    const dayFac = smoothstep(float(-0.08), float(0.28), sunElev)
    const skyZenith = mix(vec3(0.03, 0.05, 0.09), vec3(0.18, 0.30, 0.48), dayFac)
    const skyHorizon = mix(vec3(0.06, 0.08, 0.13), vec3(0.42, 0.52, 0.64), dayFac)
    const baseSkyRefl = mix(skyHorizon, skyZenith, clamp(reflWorldDir.y, 0.0, 1.0))
    const cloudReflCol = vec3(uCloudTint as never).mul(mix(vec3(0.12, 0.15, 0.22), vec3(0.78, 0.82, 0.88), dayFac))
    const envSkyRefl = mix(baseSkyRefl, cloudReflCol, reflCloudMask.mul(0.85))

    // 合成最终倒影（开启 SSR 且命中场景物体时显示物体倒影，关闭 SSR 或未命中处显示天空与流动云倒影）
    const totalReflection = mix(envSkyRefl, ssrScaledColor, effectiveSsrWeight)

    // 真实水体菲涅尔 + 水下深色基底（俯视时看清深色湿地面与物体倒影，平视时呈镜面反射）
    const nDotV = clamp(dot(puddleNormal as never, viewDir), 0.0, 1.0)
    const waterFresnel = clamp(float(0.14).add(float(0.82).mul(pow(float(1.0).sub(nDotV), float(2.8)))), 0.0, 0.96)
    const reflStrength = max(waterFresnel, effectiveSsrWeight.mul(0.82))

    const submergedGround = vec3(surfaceRgb as never).mul(0.32)
    const sunSpec = pow(max(dot(reflWorldDir, uSunDir), float(0.0)), float(96.0)).mul(vec3(uSunColor as never)).mul(0.9)
    const puddleFinal = mix(submergedGround, totalReflection, reflStrength).add(sunSpec)

    surfaceRgb = mix(surfaceRgb as never, puddleFinal, puddleMask)
  }

  // 2. 表面积雪覆盖（利用法线贴图朝上度 + 多级旋转噪点）
  if (options.snow) {
    const sCoord = worldPos.xz.mul(0.24)
    const snowNoise = fastValueNoise2D(sCoord).mul(0.55)
      .add(fastValueNoise2D(rotOctave(sCoord, 2.3, 11.4, 27.8)).mul(0.3))
      .add(fastValueNoise2D(rotOctave(sCoord, 5.1, 31.2, 9.7)).mul(0.15))
    const startUp = float(0.84).sub(uSnow.mul(0.58))
    const slopeSnow = smoothstep(startUp, startUp.add(0.18), worldNormal.y.add(snowNoise.sub(0.5).mul(0.24)))
    const snowMask = slopeSnow.mul(smoothstep(float(0.0), float(0.2), uSnow))

    const snowLit = float(0.65).add(max(dot(worldNormal, uSunDir), float(0.0)).mul(0.42))
    const shadedSnow = vec3(uSnowColor as never).mul(snowLit)
    surfaceRgb = mix(surfaceRgb as never, shadedSnow, snowMask)
  }

  // 闪电瞬间环境补光
  surfaceRgb = vec3(surfaceRgb as never).add(vec3(0.55, 0.68, 0.95).mul(uLightning.mul(0.18)))

  const finalRgb = select(isBg, base.rgb as never, surfaceRgb as never)
  return {
    node: vec4(finalRgb as never, base.a as never),
    sync: (picture: ScenePicture, camera: Camera) => {
      const s = currentSettings(picture)
      camera.updateMatrixWorld()
      camera.getWorldPosition(uCamPos.value)
      uCamProj.value.copy(camera.projectionMatrix)
      uCamProjInv.value.copy(camera.projectionMatrixInverse)
      uCamWorld.value.copy(camera.matrixWorld)
      uCamView.value.copy(camera.matrixWorldInverse)
      uSunDir.value.copy(detectedSunDir)
      uSunColor.value.copy(detectedSunColor)
      uTime.value = elapsedTime
      uWetness.value = s.enabled && s.wetnessEnabled ? s.wetness : 0
      uPuddle.value = s.enabled && s.wetnessEnabled ? s.puddleAmount : 0
      uSnow.value = s.enabled && s.snowCoverEnabled ? s.snowCover : 0
      uSnowColor.value.set(s.snowColor)
      uLightning.value = s.enabled && s.lightningEnabled ? lightningFlash * s.lightningIntensity * 0.4 : 0
      uCloudCov.value = s.cloudsEnabled ? s.cloudCoverage : 0
      uCloudScale.value = s.cloudScale
      const rad = (s.cloudWindAngle * Math.PI) / 180
      const spd = s.cloudWindSpeed * 0.0022 * elapsedTime
      uCloudWindOffset.value.set(Math.cos(rad) * spd, Math.sin(rad) * spd)
      uCloudTint.value.set(s.cloudTint)
      uSsrEnabled.value = picture.ssr ? 1 : 0
      uSsrQuality.value = picture.ssrQuality ?? 0.5
      uSsrDistance.value = Math.max(0.2, picture.ssrDistance ?? 8)
      uSsrThickness.value = Math.max(0.001, picture.ssrThickness ?? 0.03)
      uSsrIntensity.value = Math.max(0, picture.ssrIntensity ?? 1)
    },
  }
}

// ── 通道 B：天空真 3D 球壳体积云（8步立体 Raymarching + Perlin-Worley 胞状侵蚀） ─

export interface WeatherSkyPassHandle {
  node: unknown
  sync: (picture: ScenePicture, camera: Camera) => void
}

export function buildWeatherSkyPass(
  colorNode: unknown,
  scenePass: { getTextureNode: (name: string) => unknown },
  options: { clouds: boolean; cirrus?: boolean },
): WeatherSkyPassHandle {
  const uCamPos = uniform(new Vector3())
  const uCamProjInv = uniform(new Matrix4())
  const uCamWorld = uniform(new Matrix4())
  const uSunDir = uniform(new Vector3(0.45, 0.72, 0.52))
  const uSunColor = uniform(new Color('#fff7e8'))
  const uCoverage = uniform(0.45)
  const uDensity = uniform(1.0)
  const uAltitude = uniform(600)
  const uScale = uniform(1.0)
  const uWindOffset = uniform(new Vector2(0, 0))
  const uSilver = uniform(0.9)
  const uShadow = uniform(0.6)
  const uCloudTint = uniform(new Color('#ffffff'))
  const uLightning = uniform(0)

  const depthNode = scenePass.getTextureNode('depth') as never
  const isBg = isBackgroundDepth(depthNode)
  const base = colorNode as { rgb: unknown; a: unknown }

  if (!options.clouds) {
    return {
      node: colorNode,
      sync: () => {},
    }
  }

  const cloudTex = defaultCloudNoiseTexture()

  // 重建真实 3D 视线方向（使用显式 uCamPos 与 uCamWorld，绝不依赖后期全屏相机）
  const viewFar = getViewPosition(screenUV, float(1.0), uCamProjInv)
  const worldFar = uCamWorld.mul(vec4(viewFar, 1.0)).xyz
  const rayDir = normalize(worldFar.sub(uCamPos))

  // 地平线柔和遮罩
  const horizonMask = smoothstep(float(0.005), float(0.09), rayDir.y)
  const ry = max(rayDir.y, float(0.015))

  // 昼夜与夕阳大气配色
  const sunElev = clamp(uSunDir.y, -0.2, 1.0)
  const dayFactor = smoothstep(float(-0.08), float(0.26), sunElev)
  const sunsetFactor = smoothstep(float(0.34), float(0.02), abs(sunElev.sub(0.05))).mul(smoothstep(float(-0.12), float(0.04), sunElev))

  // 云顶受光色与云底大气环境散射色
  const skyBgRgb = vec3(base.rgb as never)
  const dayTopColor = vec3(uCloudTint as never).mul(mix(vec3(1.03, 1.01, 0.98), vec3(uSunColor as never), float(0.28)))
  const sunsetTopColor = vec3(1.05, 0.62, 0.36)
  const nightTopColor = vec3(0.12, 0.16, 0.24)
  const litTopColor = mix(mix(nightTopColor, dayTopColor, dayFactor), sunsetTopColor, sunsetFactor.mul(0.72))

  // 云底阴影融合当前天空背景色与柔和大气蓝灰
  const ambientBaseColor = mix(
    vec3(0.05, 0.07, 0.12),
    mix(skyBgRgb.mul(0.80), vec3(0.56, 0.63, 0.73).mul(vec3(uCloudTint as never)), float(0.52)),
    dayFactor,
  )

  // 前向散射银边相位函数（Henyey-Greenstein 双瓣近似）
  const cosTheta = max(dot(rayDir, uSunDir), float(0.0))
  const phaseHG = float(0.22).add(pow(cosTheta, float(7.0)).mul(1.4)).mul(uSilver)

  // ── 7步球面大气壳 3D 体积步进（消除平面 1/y 导致的水平拉丝条带畸变） ──
  // 球壳曲率半径 R = 2.0，云底高度 H0 = 1.0，云层立体厚度 dH = 0.46
  // dist(h) = sqrt(R² * ry² + 2*R*H(h) + H(h)²) - R * ry
  const covThreshold = float(0.76).sub(uCoverage.mul(0.52))
  const altScale = float(600.0).div(max(uAltitude, float(150.0))).mul(0.26).div(max(uScale, float(0.15)))
  const sunDirXZ = normalize(vec2(uSunDir.x, uSunDir.z).add(vec2(0.0001, 0.0001))).mul(0.032)

  let transmittance: unknown = float(1.0)
  let scatteredLight: unknown = vec3(0, 0, 0)

  const heights = [0.08, 0.21, 0.34, 0.48, 0.62, 0.76, 0.90]
  for (let i = 0; i < heights.length; i += 1) {
    const h = heights[i]!
    const hNode = float(h)
    const shellH = 1.0 + h * 0.46
    const twoRH = 4.0 * shellH + shellH * shellH
    const shellDist = sqrt(float(4.0).mul(ry).mul(ry).add(twoRH)).sub(float(2.0).mul(ry))

    const layerUV = rayDir.xz.mul(shellDist).mul(altScale).add(uWindOffset)
    const rawDensity = samplePerlinWorleyCloud(cloudTex, layerUV, hNode, covThreshold)
    const localDensity = rawDensity.mul(uDensity).mul(0.42)

    // 朝向太阳方向采样上层密度计算真实体积自阴影
    const sunUV = layerUV.add(sunDirXZ.mul(1.15 - h * 0.5))
    const sunOcc = samplePerlinWorleyCloud(cloudTex, sunUV, min(float(0.95), hNode.add(0.22)), covThreshold)

    // 光照由「垂直高度 h（云顶亮、云底柔暗）」与「太阳方向 Beer-Lambert 透射率」共同决定
    const sunTrans = exp(sunOcc.mul(uShadow).mul(-2.1))
    const directLight = clamp(
      mix(float(0.26 + h * 0.48), float(0.68 + h * 0.32), sunTrans),
      0.0,
      1.0,
    )
    // Beer-Powder 边缘透光效应：云朵蓬松薄边缘透射阳光产生金银亮边
    const powder = float(1.0).sub(exp(localDensity.mul(-3.6))).mul(float(1.0).sub(localDensity.mul(0.4)))
    const silverTerm = vec3(uSunColor as never).mul(phaseHG).mul(powder).mul( sunTrans.mul(0.75).add(0.25) )

    const stepColor = mix(ambientBaseColor, litTopColor, directLight).add(silverTerm)
    const stepAlpha = clamp(localDensity, 0.0, 0.85)

    scatteredLight = vec3(scatteredLight as never).add(
      stepColor.mul(stepAlpha).mul(transmittance as never),
    )
    transmittance = float(transmittance as never).mul(float(1.0).sub(stepAlpha))
  }

  const rawCloudOpacity = float(1.0).sub(transmittance as never)
  const cloudOpacity = rawCloudOpacity.mul(horizonMask)
  const normCloudColor = vec3(scatteredLight as never).div(max(rawCloudOpacity, float(0.001)))

  // 雷暴云层内部闪电透光
  const lightningGlow = vec3(0.75, 0.86, 1.0).mul(uLightning).mul(float(0.35).add(rawCloudOpacity.mul(0.75)))

  // 远景地平线大气透视融合（远处云朵自动融入地平线天空色）
  const horizonAtmos = exp(max(rayDir.y, float(0.0)).mul(-10.5))
  const finalCloudColor = mix(normCloudColor.add(lightningGlow), skyBgRgb, horizonAtmos.mul(0.72))

  let skyRgb: unknown = mix(skyBgRgb, finalCloudColor, cloudOpacity)

  // 闪电全天穹环境亮光
  skyRgb = vec3(skyRgb as never).add(vec3(0.45, 0.55, 0.78).mul(uLightning.mul(0.15)))

  const finalRgb = select(isBg, skyRgb as never, base.rgb as never)
  return {
    node: vec4(finalRgb as never, base.a as never),
    sync: (picture: ScenePicture, camera: Camera) => {
      const s = currentSettings(picture)
      camera.updateMatrixWorld()
      camera.getWorldPosition(uCamPos.value)
      uCamProjInv.value.copy(camera.projectionMatrixInverse)
      uCamWorld.value.copy(camera.matrixWorld)
      uSunDir.value.copy(detectedSunDir)
      uSunColor.value.copy(detectedSunColor)
      uCoverage.value = s.cloudCoverage
      uDensity.value = s.cloudDensity
      uAltitude.value = s.cloudAltitude
      uScale.value = s.cloudScale
      const rad = (s.cloudWindAngle * Math.PI) / 180
      const spd = s.cloudWindSpeed * 0.0012 * elapsedTime
      uWindOffset.value.set(Math.cos(rad) * spd, Math.sin(rad) * spd)
      uSilver.value = s.cloudSilverLining
      uShadow.value = s.cloudShadowStrength
      uCloudTint.value.set(s.cloudTint)
      uLightning.value = s.enabled && s.lightningEnabled ? lightningFlash * s.lightningIntensity : 0
    },
  }
}
