import {
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
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
  positionLocal,
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
  type WeatherSettings,
} from './defaults'

// ── 运行时状态与统一 Uniform 节点 ─────────────────────────────────────────────

let mounted = false
let removeHook: (() => void) | null = null
let elapsedTime = 0
let lightningTimer = 0
let lightningFlash = 0

// 相机跟随的三层同心降水体积网格（近景高密层 + 中景主力层 + 远景氛围层）
const MAX_PRECIP_COUNT = 18000
let precipMesh: Mesh | null = null
let precipGeo: InstancedBufferGeometry | null = null
let precipMat: MeshBasicNodeMaterial | null = null
let precipScene: Scene | null = null

const tmpCamPos = new Vector3()
const tmpVec = new Vector3()
const tmpTarget = new Vector3()
const detectedSunDir = new Vector3(0.45, 0.72, 0.52).normalize()
const detectedSunColor = new Color('#fff7e8')

// 降水粒子专用 Uniform
const uPrecipTime = uniform(0)
const uPrecipCamPos = uniform(new Vector3())
const uPrecipCamRight = uniform(new Vector3(1, 0, 0))
const uPrecipCamUp = uniform(new Vector3(0, 1, 0))
const uPrecipBoxSize = uniform(28)
// 0 = rain, 1 = snow, 2 = sand
const uPrecipMode = uniform(0)
const uPrecipSpeed = uniform(1)
const uPrecipWindVec = uniform(new Vector2(2.5, 0.8))
const uPrecipColor = uniform(new Color('#dce9f7'))
const uPrecipOpacity = uniform(0.75)
const uPrecipSplash = uniform(1)
const uRainStreakLength = uniform(1.0)

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
  if (lightningFlash > 0.001) {
    lightningFlash = Math.max(0, lightningFlash - dt * 6.5)
  }
  lightningTimer -= dt * settings.lightningFrequency
  if (lightningTimer <= 0) {
    const r = Math.sin(elapsedTime * 97.13) * 0.5 + 0.5
    lightningTimer = 1.6 + r * 3.8
    lightningFlash = 0.85 + (Math.cos(elapsedTime * 53.7) * 0.5 + 0.5) * 0.35
  }
}

// ── 降水与沙尘暴粒子构建与更新（三层同心相机环绕体积 + 沙尘暴巨型翻滚尘团） ─────────

function ensurePrecipitationMesh(scene: Scene) {
  if (precipMesh && precipScene === scene) return
  disposePrecipitationMesh()

  const basePlane = new PlaneGeometry(1, 1)
  precipGeo = new InstancedBufferGeometry()
  precipGeo.index = basePlane.index
  for (const [name, attr] of Object.entries(basePlane.attributes)) {
    precipGeo.setAttribute(name, attr.clone())
  }
  basePlane.dispose()

  // 使用 CPU 预生成的真正独立均匀随机数属性（彻底杜绝线性同余导致的排成一条线伪影）
  // aSeed: x, y, z 为 [0,1) 独立随机三维基准坐标；w 为角色比例与层级编码
  // aMotion: x=下落速度微差, y=摇摆频率, z=初始相位, w=尺寸微差
  const seedArray = new Float32Array(MAX_PRECIP_COUNT * 4)
  const motionArray = new Float32Array(MAX_PRECIP_COUNT * 4)
  for (let i = 0; i < MAX_PRECIP_COUNT; i += 1) {
    const i4 = i * 4
    seedArray[i4 + 0] = Math.random()
    seedArray[i4 + 1] = Math.random()
    seedArray[i4 + 2] = Math.random()
    // 编码层级：0~45% 为近景高密层 (tier 0)，45%~85% 为中景主力层 (tier 1)，85%~94% 为远景层 (tier 2)，94%~100% 为地面水花 (tier 3)
    const u = Math.random()
    const tier = u < 0.45 ? 0.0 : u < 0.85 ? 1.0 : u < 0.94 ? 2.0 : 3.0
    seedArray[i4 + 3] = tier + Math.random() * 0.98

    motionArray[i4 + 0] = 0.78 + Math.random() * 0.48
    motionArray[i4 + 1] = 0.65 + Math.random() * 0.7
    motionArray[i4 + 2] = Math.random() * Math.PI * 2
    motionArray[i4 + 3] = Math.random()
  }

  precipGeo.setAttribute('aSeed', new InstancedBufferAttribute(seedArray, 4))
  precipGeo.setAttribute('aMotion', new InstancedBufferAttribute(motionArray, 4))
  precipGeo.instanceCount = MAX_PRECIP_COUNT

  precipMat = new MeshBasicNodeMaterial()
  precipMat.transparent = true
  precipMat.depthWrite = false
  precipMat.side = DoubleSide

  const aSeed = attribute('aSeed', 'vec4')
  const aMotion = attribute('aMotion', 'vec4')

  const isSnow = uPrecipMode.equal(float(1))
  const isSand = uPrecipMode.equal(float(2))

  const tierId = floor(aSeed.w)
  const roleFrac = fract(aSeed.w)
  const isSplash = tierId.greaterThan(float(2.5)).and(uPrecipSplash.greaterThan(float(0.5))).and(isSnow.not()).and(isSand.not())
  // 沙尘暴模式下：72% 粒子为数米级巨型翻滚沙尘云团（Dust Billow），28% 为疾风飞沙
  const isSandBillow = isSand.and(roleFrac.lessThan(float(0.72)))

  // 三层同心体积边长：近景 7.5m，中景 18m，远景 36m；沙尘暴模式下盒体扩大以容纳巨型沙暴团
  const baseBox = max(uPrecipBoxSize, float(16.0))
  const tierBoxXZ = select(
    tierId.lessThan(float(0.5)),
    select(isSandBillow, baseBox.mul(0.65), baseBox.mul(0.27)),
    select(tierId.lessThan(float(1.5)), select(isSandBillow, baseBox.mul(1.25), baseBox.mul(0.65)), baseBox.mul(1.4)),
  )
  const tierBoxY = select(
    tierId.lessThan(float(0.5)),
    baseBox.mul(0.42),
    select(tierId.lessThan(float(1.5)), baseBox.mul(0.72), baseBox.mul(1.1)),
  )
  const halfXZ = tierBoxXZ.mul(0.5)
  const halfY = tierBoxY.mul(0.5)

  // 下落与风移周期坐标（沙尘暴尘团主要沿风向水平席卷翻滚，不下坠成雨线）
  const baseSpeed = select(
    isSnow,
    float(2.2),
    select(isSandBillow, float(0.45), select(isSand, float(1.8), float(16.5))),
  )
    .mul(uPrecipSpeed)
    .mul(aMotion.x)
  const t = uPrecipTime

  // 三维错频混沌湍流摆动
  const turbPhaseX = t.mul(aMotion.y.mul(1.7)).add(aMotion.z)
  const turbPhaseZ = t.mul(aMotion.y.mul(1.3)).add(aSeed.y.mul(6.283))
  const turbAmp = select(isSnow, float(0.75), select(isSandBillow, float(1.6), select(isSand, float(0.45), float(0.03))))
  const turbX = sin(turbPhaseX).add(cos(turbPhaseZ.mul(0.7)).mul(0.5)).mul(turbAmp)
  const turbZ = cos(turbPhaseZ).add(sin(turbPhaseX.mul(0.8)).mul(0.5)).mul(turbAmp)

  const windMul = select(isSandBillow, float(1.35), select(isSand, float(2.1), float(1.0)))
  const rawX = aSeed.x.mul(tierBoxXZ).add(uPrecipWindVec.x.mul(windMul).mul(t)).add(turbX)
  const rawY = aSeed.y.mul(tierBoxY).sub(baseSpeed.mul(t))
  const rawZ = aSeed.z.mul(tierBoxXZ).add(uPrecipWindVec.y.mul(windMul).mul(t)).add(turbZ)

  // 以相机为中心做无缝 3D 环绕包裹
  const wrappedX = fract(rawX.sub(uPrecipCamPos.x).div(tierBoxXZ).add(0.5)).sub(0.5).mul(tierBoxXZ).add(uPrecipCamPos.x)
  const wrappedY = fract(rawY.sub(uPrecipCamPos.y).div(tierBoxY).add(0.5)).sub(0.5).mul(tierBoxY).add(uPrecipCamPos.y)
  const wrappedZ = fract(rawZ.sub(uPrecipCamPos.z).div(tierBoxXZ).add(0.5)).sub(0.5).mul(tierBoxXZ).add(uPrecipCamPos.z)

  const splashLife = fract(t.mul(3.0).add(roleFrac.mul(7.13)))
  const splashY = uPrecipCamPos.y.sub(float(1.6))

  const centerWorld = vec3(
     wrappedX,
    select(isSplash, splashY, wrappedY),
    wrappedZ,
  )

  // 粒子尺寸：
  // - 雨滴：细长雨丝，长度受 uRainStreakLength 直接控制
  // - 雪花：饱满柔和雪片
  // - 沙尘暴巨型尘团（isSandBillow）：3.2m ~ 7.6m 翻滚大沙暴团！
  // - 沙尘暴疾风沙粒：横向飞沙簇
  const tierWidthScale = select(tierId.lessThan(float(0.5)), float(0.88), select(tierId.lessThan(float(1.5)), float(1.18), float(1.55)))
  const tierLenScale = select(tierId.lessThan(float(0.5)), float(0.82), select(tierId.lessThan(float(1.5)), float(1.08), float(1.38)))

  const rainW = tierWidthScale.mul(float(0.015).add(aMotion.w.mul(0.012)))
  const rainH = tierLenScale
    .mul(float(0.65).add(aMotion.w.mul(0.55)))
    .mul(float(0.55).add(uPrecipSpeed.mul(0.45)))
    .mul(uRainStreakLength)

  const snowW = tierWidthScale.mul(float(0.055).add(aMotion.w.mul(0.065)))
  const sandBillowW = tierWidthScale.mul(float(3.4).add(aMotion.w.mul(4.2)))
  const sandGrainW = tierWidthScale.mul(float(0.42).add(aMotion.w.mul(0.48)))

  const quadW = select(
    isSnow,
    snowW,
    select(isSandBillow, sandBillowW, select(isSand, sandGrainW, rainW)),
  )
  const quadH = select(
    isSnow,
    snowW,
    select(isSandBillow, sandBillowW.mul(0.86), select(isSand, sandGrainW.mul(0.88), rainH)),
  )

  // 1. 雪花与沙尘暴粒子：严格使用相机屏幕平面正交基 (uPrecipCamRight, uPrecipCamUp) 构建全向 Billboard！
  //    无论镜头如何水平旋转、仰视天空或俯视地面，粒子面片法线 100% 永远正对镜头，绝不会出现扁平纸片侧面。
  const spinSpeed = select(isSnow, float(0.85), float(0.24))
  const billboardAngle = t.mul(spinSpeed.mul(aMotion.y.sub(0.3))).add(aMotion.z)
  const cosB = cos(billboardAngle)
  const sinB = sin(billboardAngle)
  const rotCamRight = uPrecipCamRight.mul(cosB).add(uPrecipCamUp.mul(sinB))
  const rotCamUp = uPrecipCamUp.mul(cosB).sub(uPrecipCamRight.mul(sinB))
  const cameraBillboardOffset = rotCamRight.mul(positionLocal.x.mul(quadW)).add(rotCamUp.mul(positionLocal.y.mul(quadH)))

  // 2. 雨滴粒子：沿下落与风偏速度方向拉伸的轴向 Billboard（正对真实相机位置 uPrecipCamPos）
  const swayX = cos(turbPhaseX).mul(turbAmp)
  const swayZ = sin(turbPhaseZ).mul(turbAmp)
  const velWorld = vec3(
    uPrecipWindVec.x.mul(windMul).add(swayX),
    float(-16.0).mul(uPrecipSpeed),
    uPrecipWindVec.y.mul(windMul).add(swayZ),
  )
  const velUpDir = normalize(velWorld.negate())
  const toCam = normalize(uPrecipCamPos.sub(centerWorld))
  const streakRight = normalize(cross(velUpDir, toCam).add(uPrecipCamRight.mul(0.001)))
  const rainStreakOffset = streakRight
    .mul(positionLocal.x.mul(quadW))
    .add(velUpDir.mul(positionLocal.y.mul(quadH)))

  // 3. 地面水花涟漪：水平贴地圆环
  const splashRadius = float(0.14).add(splashLife.mul(0.34))
  const splashOffset = vec3(positionLocal.x.mul(splashRadius), float(0.02), positionLocal.y.mul(splashRadius))

  const isCameraBillboard = isSnow.or(isSand)
  const activeOffset = select(isSplash, splashOffset, select(isCameraBillboard, cameraBillboardOffset, rainStreakOffset))
  precipMat.positionNode = centerWorld.add(activeOffset)

  // 片元形态：
  // 1. 雪花：柔和立体晶核
  // 2. 雨丝：高亮流线核心
  // 3. 水花：扩散同心涟漪圈
  // 4. 沙尘暴巨型尘团与飞沙团：采样无缝湍流云纹理 + 翻滚软边气团（全向正对镜头）
  const pUv = uv().sub(0.5).mul(2.0)
  const radial = length(pUv)
  const snowCore = exp(radial.mul(radial).mul(-3.2)).mul(smoothstep(float(1.0), float(0.15), radial))
  const streakShape = smoothstep(float(1.0), float(0.0), abs(pUv.x))
    .mul(smoothstep(float(1.0), float(0.0), abs(pUv.y)))
    .mul(float(0.65).add(smoothstep(float(0.35), float(0.0), abs(pUv.x)).mul(0.5)))
  const splashRing = smoothstep(float(0.28), float(0.0), abs(radial.sub(0.72))).mul(float(1.0).sub(splashLife))

  // 沙尘暴尘团片元噪声采样
  const cloudTex = defaultCloudNoiseTexture()
  const dustUv1 = uv().mul(0.48).add(vec2(aSeed.x, aSeed.y)).add(vec2(t.mul(0.045), t.mul(-0.028)))
  const dustUv2 = uv().mul(0.95).add(vec2(aSeed.z, aMotion.w)).sub(vec2(t.mul(0.07), t.mul(0.035)))
  const dustSample1 = texture(cloudTex, dustUv1)
  const dustSample2 = texture(cloudTex, dustUv2)
  const dustNoise = dustSample1.b.mul(0.62).add(dustSample2.g.mul(0.38))
  const dustEnvelope = exp(radial.mul(radial).mul(-2.35)).mul(smoothstep(float(1.0), float(0.08), radial))
  const sandBillowAlpha = clamp(dustNoise.mul(1.35).sub(0.18), 0.0, 1.0).mul(dustEnvelope).mul(0.34)
  const sandGrainAlpha = clamp(dustNoise.mul(1.25).sub(0.10), 0.0, 1.0).mul(snowCore).mul(0.48)

  const shapeAlpha = select(
    isSnow,
    snowCore,
    select(isSplash, splashRing, select(isSandBillow, sandBillowAlpha, select(isSand, sandGrainAlpha, streakShape))),
  )

  // 当前层级包围盒边缘平滑淡出 + 近镜头防贴脸淡出
  const relX = abs(centerWorld.x.sub(uPrecipCamPos.x)).div(halfXZ)
  const relY = abs(centerWorld.y.sub(uPrecipCamPos.y)).div(halfY)
  const relZ = abs(centerWorld.z.sub(uPrecipCamPos.z)).div(halfXZ)
  const edgeDist = max(max(relX, relY), relZ)
  const edgeFade = smoothstep(float(1.0), float(0.58), edgeDist)
  const camDist = length(uPrecipCamPos.sub(centerWorld))
  const nearMin = select(isSandBillow, float(1.8), float(0.35))
  const nearMax = select(isSandBillow, float(5.2), float(1.35))
  const nearFade = smoothstep(nearMin, nearMax, camDist)

  // 沙尘暴尘团内部自带顶部受光与底部浓暗立体感
  const billowShade = mix(float(0.76), float(1.16), clamp(pUv.y.mul(0.5).add(0.5).add(dustNoise.sub(0.5).mul(0.35)), 0.0, 1.0))
  const precipRgb = vec3(uPrecipColor.r, uPrecipColor.g, uPrecipColor.b)
  precipMat.colorNode = select(isSandBillow, precipRgb.mul(billowShade), precipRgb)
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
  const ratio = Math.pow(settings.precipitationIntensity, 0.75)
  // 沙尘暴由于单个粒子是 3~7 米大团块，无需 18000 个满画即可铺满全屏，控制实例数兼顾极佳帧率
  const maxForType = settings.precipitationType === 'sand' ? 4200 : MAX_PRECIP_COUNT
  precipGeo.instanceCount = Math.max(
    400,
    Math.min(maxForType, Math.round(maxForType * ratio)),
  )

  camera.updateMatrixWorld()
  camera.getWorldPosition(tmpCamPos)
  uPrecipCamPos.value.copy(tmpCamPos)
  uPrecipCamRight.value.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
  uPrecipCamUp.value.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
  uPrecipTime.value = elapsedTime
  uPrecipBoxSize.value = settings.precipitationBoxSize
  uPrecipMode.value = settings.precipitationType === 'snow' ? 1 : settings.precipitationType === 'sand' ? 2 : 0
  uPrecipSpeed.value = settings.precipitationSpeed
  uRainStreakLength.value = settings.rainStreakLength
  const rad = (settings.cloudWindAngle * Math.PI) / 180
  uPrecipWindVec.value.set(Math.cos(rad) * settings.precipitationWind, Math.sin(rad) * settings.precipitationWind)
  uPrecipColor.value.set(settings.precipitationColor)
  uPrecipOpacity.value = Math.min(1, 0.42 + settings.precipitationIntensity * 0.58)
  uPrecipSplash.value = settings.splashEnabled ? 1 : 0
}

// ── 后期管线判定与 Key ────────────────────────────────────────────────────────

function cloudLayerBits(s: WeatherSettings): number {
  if (!s.enabled || !s.cloudsEnabled) return 0
  return (s.lowCloudsEnabled ? 1 : 0) | (s.midCloudsEnabled ? 2 : 0) | (s.highCloudsEnabled ? 4 : 0)
}

function surfaceWetBits(s: WeatherSettings): number {
  if (!s.enabled || !s.wetnessEnabled) return 0
  return 1 | (s.ripplesEnabled ? 2 : 0) | (s.rainDripsEnabled ? 4 : 0)
}

function sandHazeBit(s: WeatherSettings): number {
  if (!s.enabled || s.precipitationType !== 'sand' || s.sandstormHaze <= 0.01) return 0
  return 1
}

export function weatherActive(picture?: ScenePicture): boolean {
  if (!mounted) return false
  const s = currentSettings(picture)
  if (!s.enabled) return false
  return (
    cloudLayerBits(s) > 0 ||
    surfaceWetBits(s) > 0 ||
    s.snowCoverEnabled ||
    sandHazeBit(s) > 0 ||
    s.lightningEnabled
  )
}

export function weatherNeedsNormals(picture?: ScenePicture): boolean {
  if (!mounted) return false
  const s = currentSettings(picture)
  return s.enabled && (s.wetnessEnabled || s.snowCoverEnabled || sandHazeBit(s) > 0)
}

export function weatherPipelineKey(picture?: ScenePicture): string {
  if (!weatherActive(picture)) return 'off'
  const s = currentSettings(picture)
  return [
    'on',
    cloudLayerBits(s),
    surfaceWetBits(s),
    s.snowCoverEnabled ? 1 : 0,
    sandHazeBit(s),
  ].join(':')
}

// ── TSL 噪声、涟漪、表面雨滴流淌与 UDS 体积云密度采样工具 ────────────────────

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
 * UDS 风格两级体积积云密度采样：
 * - 第一级：低频连续大陆底图（R 通道）+ 积云平底圆顶垂直高度剖面，保证云体中心 75% 厚实连绵无碎点；
 * - 第二级：仅在云团最外缘 25% 区域（pow(1 - baseCloud, 1.75)）用中频圆润云包（G/B 通道）做花椰菜翻滚侵蚀。
 */
function sampleUdsCumulusDensity(cloudTex: DataTexture, uvNode: unknown, heightFrac: unknown, covThreshold: unknown) {
  const uvM = vec2(uvNode as never)
  const h = float(heightFrac as never)
  const covMin = float(covThreshold as never)

  // 1. 采样大尺度连续云团底图（随高度轻微错位形成立体倾斜云塔）
  const sMacro = texture(cloudTex, uvM.add(vec2(h.mul(0.035), h.mul(-0.025))))
  const sMacroUpper = texture(cloudTex, rotOctave(uvM, 1.35, 0.27, 0.41).add(vec2(h.mul(-0.04), h.mul(0.03))))
  const macroContinent = mix(sMacro.r, sMacroUpper.r.mul(0.55).add(sMacro.g.mul(0.45)), smoothstep(float(0.25), float(0.88), h))

  // 2. 积云垂直高度剖面（底部 0~0.14 平切凝结面，中部饱满，顶部 0.45~1.0 圆润收拢）
  const bottomFlat = smoothstep(float(0.0), float(0.14), h)
  const topRound = smoothstep(float(1.0), float(0.42), h)
  const heightProfile = bottomFlat.mul(topRound)

  // 3. 基础连续云核重映射
  const shapedBase = macroContinent.mul(heightProfile.mul(0.34).add(0.66))
  const baseCloud = clamp(shapedBase.sub(covMin).div(max(float(1.0).sub(covMin), float(0.16))), 0.0, 1.0)

  // 4. 仅在云团外缘 25% 边界做花椰菜云包侵蚀（绝不打穿云核内部！）
  const sLobe = texture(cloudTex, rotOctave(uvM, 2.05, 0.17, 0.31).add(vec2(h.mul(0.08), h.mul(-0.06))))
  const sFluff = texture(cloudTex, rotOctave(uvM, 3.8, 0.43, 0.79).sub(vec2(h.mul(0.11), h.mul(0.09))))
  const billowDetail = sLobe.g.mul(0.68).add(sFluff.b.mul(0.32))

  const outerEdgeMask = pow(float(1.0).sub(baseCloud), float(1.75))
  const erodeWeight = float(1.0).sub(billowDetail).mul(outerEdgeMask).mul(0.34)
  return clamp(baseCloud.sub(erodeWeight).div(max(float(1.0).sub(erodeWeight), float(0.25))), 0.0, 1.0)
}

/** 双层重叠雨滴同心圆水波纹（支持 uRippleDensity 动态控制涟漪密集度） */
function rainRippleOffset(worldXZ: unknown, timeNode: unknown, densityNode: unknown) {
  const dens = max(float(densityNode as never), float(0.2))
  const xz = vec2(worldXZ as never).mul(dens)
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

/**
 * 角色与物体侧面/斜面雨滴流淌水痕（Screen-Space Triplanar Rain Rivulets）：
 * 零模型 UV 依赖，利用世界坐标与法线在角色盔甲、身体、建筑侧面生成蜿蜒滑落的水珠与湿水痕。
 */
function computeSurfaceRainDrips(worldPos: unknown, worldNormal: unknown, timeNode: unknown, speedNode: unknown) {
  const wp = vec3(worldPos as never)
  const wn = vec3(worldNormal as never)
  const t = float(timeNode as never).mul(max(float(speedNode as never), float(0.2)))

  // 无接缝侧向水平坐标（根据 X/Z 法线分量自动混合）
  const absNx = abs(wn.x)
  const absNz = abs(wn.z)
  const horizWeight = absNx.div(max(absNx.add(absNz), float(0.001)))
  const sideCoord = mix(wp.x, wp.z, horizWeight)

  // 第一层主水珠流道（间距约 14cm）
  const laneScaleA = float(7.2)
  const wiggleA = fastValueNoise2D(vec2(sideCoord.mul(3.5), wp.y.mul(2.8))).sub(0.5).mul(0.28)
  const uA = sideCoord.mul(laneScaleA).add(wiggleA)
  const laneIdA = floor(uA)
  const laneLocalX_A = fract(uA).sub(0.5)
  const seedA = fastHash12(vec2(laneIdA, floor(wp.x.add(wp.z))))
  // 向上滚动相位 = 向下流淌（wp.y 减小方向）
  const dropPhaseA = fract(wp.y.mul(1.85).add(t.mul(float(0.65).add(seedA.mul(0.55)))).add(seedA.mul(13.7)))
  const headWidthA = float(0.22).sub(dropPhaseA.mul(0.12))
  const acrossMaskA = smoothstep(headWidthA, float(0.02), abs(laneLocalX_A))
  // 水珠亮头（dropPhaseA 接近 0 处）+ 水痕渐变拖尾
  const dropHeadA = smoothstep(float(0.14), float(0.0), dropPhaseA)
  const dropTrailA = smoothstep(float(0.78), float(0.0), dropPhaseA).mul(0.52)
  const rivuletA = acrossMaskA.mul(max(dropHeadA, dropTrailA))

  // 第二层细密水珠流道（间距约 6.5cm，交错补充细节）
  const laneScaleB = float(15.5)
  const wiggleB = fastValueNoise2D(vec2(sideCoord.mul(7.5).add(19.3), wp.y.mul(5.2))).sub(0.5).mul(0.24)
  const uB = sideCoord.mul(laneScaleB).add(wiggleB)
  const laneIdB = floor(uB)
  const laneLocalX_B = fract(uB).sub(0.5)
  const seedB = fastHash12(vec2(laneIdB.add(47.0), floor(wp.y)))
  const dropPhaseB = fract(wp.y.mul(3.1).add(t.mul(float(0.85).add(seedB.mul(0.65)))).add(seedB.mul(29.1)))
  const acrossMaskB = smoothstep(float(0.20), float(0.02), abs(laneLocalX_B))
  const dropHeadB = smoothstep(float(0.12), float(0.0), dropPhaseB)
  const dropTrailB = smoothstep(float(0.65), float(0.0), dropPhaseB).mul(0.42)
  const rivuletB = acrossMaskB.mul(max(dropHeadB, dropTrailB)).mul(0.75)

  // 仅在侧面与斜面生效（朝天水平面 |ny| > 0.86 由水坑接管，朝下底面 ny < -0.35 减弱）
  const sideMask = smoothstep(float(0.88), float(0.42), abs(wn.y)).mul(smoothstep(float(-0.45), float(0.15), wn.y))
  const dripIntensity = clamp(rivuletA.add(rivuletB), 0.0, 1.0).mul(sideMask)
  const normalPerturbX = laneLocalX_A.mul(rivuletA).add(laneLocalX_B.mul(rivuletB)).mul(sideMask)
  const normalPerturbY = dropHeadA.add(dropHeadB).mul(0.35).mul(sideMask)

  return {
    dripMask: dripIntensity,
    perturbedNormal: normalize(wn.add(vec3(normalPerturbX.mul(0.45), normalPerturbY, normalPerturbX.mul(0.45)))),
    sideMask,
  }
}

// ── 通道 A：表面湿润 / 水坑涟漪 / 角色雨滴流淌 / 保留阴影积雪 / 沙尘暴景深雾 ──

export interface WeatherSurfacePassHandle {
  node: unknown
  sync: (picture: ScenePicture, camera: Camera) => void
}

export function buildWeatherSurfacePass(
  colorNode: unknown,
  scenePass: { getTextureNode: (name: string) => unknown },
  normalNode: unknown,
  options: { wetness: boolean; ripples: boolean; drips: boolean; snow: boolean; sandHaze: boolean },
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
  const uRippleDensity = uniform(1.0)
  const uDripsSpeed = uniform(1.0)
  const uSnow = uniform(0)
  const uSnowColor = uniform(new Color('#eef5ff'))
  const uSandHaze = uniform(0)
  const uSandColor = uniform(new Color('#d8ab74'))
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

  // 1. 雨天表面湿润 + 角色/物体表面雨滴流淌 + 真实屏幕空间反射（SSR）+ 动态云层倒影积水坑
  if (options.wetness) {
    // 淋雨表面孔隙吸水变暗（绝不变白）
    const wetSurface = uWetness.mul(smoothstep(float(-0.15), float(0.65), worldNormal.y).mul(0.55).add(0.45))
    surfaceRgb = vec3(surfaceRgb as never).mul(mix(float(1.0), float(0.64), wetSurface))

    // 角色身体、盔甲与物体侧面雨滴流淌水痕（Screen-Space Triplanar Rain Rivulets）
    if (options.drips) {
      const drips = computeSurfaceRainDrips(worldPos, worldNormal, uTime, uDripsSpeed)
      const halfVec = normalize(uSunDir.add(viewDir))
      const dripSpec = pow(max(dot(drips.perturbedNormal, halfVec), float(0.0)), float(42.0))
        .mul(drips.dripMask)
        .mul(uWetness)
        .mul(0.85)
      const sideFresnel = pow(float(1.0).sub(clamp(dot(drips.perturbedNormal, viewDir), 0.0, 1.0)), float(3.2))
        .mul(drips.sideMask)
        .mul(uWetness)
      const wetFilmSheen = vec3(0.72, 0.80, 0.92).mul(
        drips.dripMask.mul(0.28).add(sideFresnel.mul(0.18)),
      )
      // 水道滑过处轻微加深基底并叠加晶莹流动高光与水膜反光
      surfaceRgb = vec3(surfaceRgb as never)
        .mul(mix(float(1.0), float(0.84), drips.dripMask.mul(uWetness)))
        .add(vec3(uSunColor as never).mul(dripSpec).add(wetFilmSheen))
    }

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
    const wetRimMask = smoothstep(puddleThresh.sub(0.09), puddleThresh.add(0.02), puddleField).mul(puddleActive)
    const puddleMask = smoothstep(puddleThresh, puddleThresh.add(0.06), puddleField).mul(puddleActive)

    surfaceRgb = vec3(surfaceRgb as never).mul(mix(float(1.0), float(0.68), wetRimMask))

    // 水面涟漪法线（支持 uRippleDensity 调节涟漪密集度）
    let puddleNormal: unknown = vec3(0, 1, 0)
    let ripple2D: unknown = vec2(0, 0)
    if (options.ripples) {
      ripple2D = rainRippleOffset(worldPos.xz, uTime, uRippleDensity)
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
      const depthDiff = sceneVP.z.sub(marchViewPos.z)
      const thickness = uSsrThickness.mul(16.0).add(dist.mul(0.22))
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

    const ssrScaledColor = vec3(ssrColor as never).mul(uSsrIntensity)
    const effectiveSsrWeight = clamp(
      float(ssrHitWeight as never).mul(uSsrEnabled).mul(clamp(uSsrIntensity, 0.0, 1.5)),
      0.0,
      1.0,
    )

    // 潮湿非积水地面也带有轻微光泽 SSR 倒影
    const wetGroundGloss = wetSurface.mul(upFlat).mul(float(1.0).sub(puddleMask)).mul(0.22)
    surfaceRgb = vec3(surfaceRgb as never).add(ssrScaledColor.mul(effectiveSsrWeight).mul(wetGroundGloss))

    // ── 水坑倒映的天空与动态云朵（与头顶大曲率水平大气云层同源） ──
    const cloudTex = defaultCloudNoiseTexture()
    const reflY = max(reflWorldDir.y, float(0.02))
    const reflPlaneDist = sqrt(float(2304.0).mul(reflY).mul(reflY).add(97.0)).sub(float(48.0).mul(reflY))
    const reflCloudUV = reflWorldDir.xz.mul(reflPlaneDist).mul(0.085).div(max(uCloudScale, float(0.15))).add(uCloudWindOffset)
    const reflCovThresh = float(0.76).sub(uCloudCov.mul(0.52))
    const reflCloudMask = sampleUdsCumulusDensity(cloudTex, reflCloudUV, float(0.38), reflCovThresh)
      .mul(smoothstep(float(0.02), float(0.18), reflWorldDir.y))

    const sunElev = clamp(uSunDir.y, -0.2, 1.0)
    const dayFac = smoothstep(float(-0.08), float(0.28), sunElev)
    const skyZenith = mix(vec3(0.03, 0.05, 0.09), vec3(0.18, 0.30, 0.48), dayFac)
    const skyHorizon = mix(vec3(0.06, 0.08, 0.13), vec3(0.42, 0.52, 0.64), dayFac)
    const baseSkyRefl = mix(skyHorizon, skyZenith, clamp(reflWorldDir.y, 0.0, 1.0))
    const cloudReflCol = vec3(uCloudTint as never).mul(mix(vec3(0.12, 0.15, 0.22), vec3(0.78, 0.82, 0.88), dayFac))
    const envSkyRefl = mix(baseSkyRefl, cloudReflCol, reflCloudMask.mul(0.85))

    const totalReflection = mix(envSkyRefl, ssrScaledColor, effectiveSsrWeight)

    const nDotV = clamp(dot(puddleNormal as never, viewDir), 0.0, 1.0)
    const waterFresnel = clamp(float(0.14).add(float(0.82).mul(pow(float(1.0).sub(nDotV), float(2.8)))), 0.0, 0.96)
    const reflStrength = max(waterFresnel, effectiveSsrWeight.mul(0.82))

    const submergedGround = vec3(surfaceRgb as never).mul(0.32)
    const sunSpec = pow(max(dot(reflWorldDir, uSunDir), float(0.0)), float(96.0)).mul(vec3(uSunColor as never)).mul(0.9)
    const puddleFinal = mix(submergedGround, totalReflection, reflStrength).add(sunSpec)

    surfaceRgb = mix(surfaceRgb as never, puddleFinal, puddleMask)
  }

  // 2. 表面积雪覆盖（完整保留原场景实时地面阴影 + 真实冷蓝灰雪影 + 角色靴面防死白）
  if (options.snow) {
    const sCoord = worldPos.xz.mul(0.24)
    const snowNoise = fastValueNoise2D(sCoord).mul(0.55)
      .add(fastValueNoise2D(rotOctave(sCoord, 2.3, 11.4, 27.8)).mul(0.3))
      .add(fastValueNoise2D(rotOctave(sCoord, 5.1, 31.2, 9.7)).mul(0.15))
    const startUp = float(0.84).sub(uSnow.mul(0.58))
    const slopeSnow = smoothstep(startUp, startUp.add(0.18), worldNormal.y.add(snowNoise.sub(0.5).mul(0.24)))

    // 从原场景渲染结果提取实时受光与阴影比例（ShadowMap 阴影区 origLum 显著低于受光区）
    const origRgb = vec3(surfaceRgb as never)
    const origLum = dot(origRgb, vec3(0.299, 0.587, 0.114))
    // 水平地面全覆盖，非水平深色物体表面（如角色深色金属靴面）按原明度柔和过渡薄霜，防止涂成一块死白
    const isFlatGround = smoothstep(float(0.88), float(0.97), worldNormal.y)
    const objectFrostProtect = mix(smoothstep(float(0.04), float(0.26), origLum).mul(0.65).add(0.35), float(1.0), isFlatGround)
    const snowMask = slopeSnow.mul(smoothstep(float(0.0), float(0.2), uSnow)).mul(objectFrostProtect)

    // 区分阳光直射雪面与实时阴影区雪面：阴影区呈现冷蓝灰雪影（Alpine Blue Shadow），100% 保留阴影轮廓！
    const shadowFactor = smoothstep(float(0.06), float(0.48), origLum)
    const shadowSnowLight = vec3(0.36, 0.44, 0.58).mul(clamp(origLum.mul(2.1).add(0.22), 0.30, 0.76))
    const litSnowLight = vec3(1.02, 1.01, 0.99).mul(clamp(origLum.mul(0.48).add(0.62), 0.78, 1.10))
    const snowLighting = mix(shadowSnowLight, litSnowLight, shadowFactor)

    // 表面微晶颗粒法线明暗与太阳方向漫反射微调
    const grainBump = snowNoise.sub(0.5).mul(0.14)
    const nDotL = max(dot(worldNormal, uSunDir), float(0.0)).add(grainBump)
    const directMod = mix(float(0.88), float(0.82).add(clamp(nDotL, 0.0, 1.0).mul(0.24)), shadowFactor)

    const shadedSnow = vec3(uSnowColor as never).mul(snowLighting).mul(directMod)
    surfaceRgb = mix(surfaceRgb as never, shadedSnow, snowMask)
  }

  // 3. 沙尘暴景深大气黄沙雾化（随距离与高度动态翻滚的黄沙雾墙）
  if (options.sandHaze) {
    const viewDist = length(viewPos)
    const heightAtten = exp(max(worldPos.y.add(2.0), float(0.0)).mul(-0.042))
    const sandWind = vec2(uTime.mul(1.8), uTime.mul(0.9))
    const dustWave = fastValueNoise2D(worldPos.xz.mul(0.035).add(sandWind)).mul(0.35).add(0.75)
    const density = uSandHaze.mul(0.048).mul(heightAtten).mul(dustWave)
    const fogFactor = clamp(float(1.0).sub(exp(max(viewDist.sub(1.8), float(0.0)).negate().mul(density))), 0.0, 0.94)
    const sunElev = clamp(uSunDir.y, -0.1, 1.0)
    const dayScale = smoothstep(float(-0.1), float(0.25), sunElev).mul(0.65).add(0.35)
    const litSandFog = vec3(uSandColor as never).mul(dayScale)
    surfaceRgb = mix(surfaceRgb as never, litSandFog, fogFactor)
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
      uRippleDensity.value = s.rippleDensity
      uDripsSpeed.value = s.rainDripsSpeed
      uSnow.value = s.enabled && s.snowCoverEnabled ? s.snowCover : 0
      uSnowColor.value.set(s.snowColor)
      uSandHaze.value = s.enabled && s.precipitationType === 'sand' ? s.sandstormHaze : 0
      uSandColor.value.set(s.precipitationColor)
      uLightning.value = s.enabled && s.lightningEnabled ? lightningFlash * s.lightningIntensity * 0.4 : 0
      uCloudCov.value = s.cloudsEnabled ? s.cloudCoverage : 0
      uCloudScale.value = s.cloudScale
      const rad = (s.cloudWindAngle * Math.PI) / 180
      const spd = s.cloudWindSpeed * 0.0018 * elapsedTime
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

// ── 通道 B：UDS 风格三层天空体积云系统（16 步低空积云 + 6 步中空层积云 + 高空流线卷云） ─

export interface WeatherSkyPassHandle {
  node: unknown
  sync: (picture: ScenePicture, camera: Camera) => void
}

/**
 * 地球级大曲率水平大气层距离计算（R_planet / H = 48:1）：
 * 在头顶与中高仰角区域完全等价于水平大气平板（彻底消除小半径鱼眼球的旋转运动感），
 * 同时在地平线极低仰角处自然平稳收拢。
 */
function horizontalAtmosphereDist(ryNode: unknown, heightRatio: unknown) {
  const ry = max(float(ryNode as never), float(0.012))
  const H = float(heightRatio as never)
  // R = 48.0: dist = sqrt(R² * ry² + 2*R*H + H²) - R * ry
  return sqrt(float(2304.0).mul(ry).mul(ry).add(float(96.0).mul(H)).add(H.mul(H))).sub(float(48.0).mul(ry))
}

export function buildWeatherSkyPass(
  colorNode: unknown,
  scenePass: { getTextureNode: (name: string) => unknown },
  options: { lowClouds: boolean; midClouds: boolean; highClouds: boolean; sandHaze: boolean },
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
  const uMidWindOffset = uniform(new Vector2(0, 0))
  const uHighWindOffset = uniform(new Vector2(0, 0))
  const uSilver = uniform(0.95)
  const uShadow = uniform(0.6)
  const uCloudTint = uniform(new Color('#ffffff'))
  const uCirrusCov = uniform(0.4)
  const uSandHaze = uniform(0)
  const uSandColor = uniform(new Color('#d8ab74'))
  const uLightning = uniform(0)

  const depthNode = scenePass.getTextureNode('depth') as never
  const isBg = isBackgroundDepth(depthNode)
  const base = colorNode as { rgb: unknown; a: unknown }

  if (!options.lowClouds && !options.midClouds && !options.highClouds && !options.sandHaze) {
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

  // 云层高度正比控制：
  // 1) 抬升云底仰角（cloudAltitude 越大，云层在天空中位置越高，不再压低在角色头顶/低空地平线）
  // 2) 修正透视高度比例（之前写成了 600 / uAltitude 导致数值反了：越大越近越低；现改为 uAltitude / 600 正比提升高度与远度）
  const altLift = clamp(uAltitude.sub(200.0).div(2800.0), 0.0, 1.0).mul(0.34)
  const horizonMask = smoothstep(altLift.sub(0.015), altLift.add(0.18), rayDir.y)
  const effectiveRayY = max(rayDir.y.sub(altLift.mul(0.55)), float(0.014))

  // 昼夜与夕阳大气配色
  const sunElev = clamp(uSunDir.y, -0.2, 1.0)
  const dayFactor = smoothstep(float(-0.08), float(0.26), sunElev)
  const sunsetFactor = smoothstep(float(0.34), float(0.02), abs(sunElev.sub(0.05))).mul(smoothstep(float(-0.12), float(0.04), sunElev))

  const skyBgRgb = vec3(base.rgb as never)
  const dayTopColor = vec3(uCloudTint as never).mul(mix(vec3(1.04, 1.02, 0.99), vec3(uSunColor as never), float(0.26)))
  const sunsetTopColor = vec3(1.06, 0.60, 0.34)
  const nightTopColor = vec3(0.11, 0.15, 0.23)
  const litTopColor = mix(mix(nightTopColor, dayTopColor, dayFactor), sunsetTopColor, sunsetFactor.mul(0.75))

  // UDS 垂直环境光梯度：云底受地面与低空蓝灰散射，云顶受天顶漫射光
  const bottomAmbientColor = mix(
    vec3(0.04, 0.06, 0.11),
    mix(skyBgRgb.mul(0.76), vec3(0.52, 0.60, 0.72).mul(vec3(uCloudTint as never)), float(0.56)),
    dayFactor,
  )
  const topSkyAmbientColor = mix(
    vec3(0.08, 0.11, 0.18),
    mix(skyBgRgb.mul(0.96), vec3(0.84, 0.90, 0.98).mul(vec3(uCloudTint as never)), float(0.55)),
    dayFactor,
  )

  // 双瓣 Henyey-Greenstein 前向散射银边相位函数
  const cosTheta = max(dot(rayDir, uSunDir), float(0.0))
  const phaseForward = pow(cosTheta, float(8.0)).mul(1.45)
  const phaseBack = float(0.24).add(pow(max(dot(rayDir, uSunDir.negate()), float(0.0)), float(2.0)).mul(0.15))
  const phaseHG = phaseBack.add(phaseForward).mul(uSilver)

  // 水平尺度因子：随 uAltitude 正向增加（海拔越高云层越远越高，不再反向放大压低）
  const altRatio = clamp(uAltitude.div(600.0), 0.30, 4.5)
  const altScale = altRatio.mul(0.075).div(max(uScale, float(0.15)))
  const sunDirXZ = normalize(vec2(uSunDir.x, uSunDir.z).add(vec2(0.0001, 0.0001)))

  let transmittance: unknown = float(1.0)
  let scatteredLight: unknown = vec3(0, 0, 0)

  // ── 层级 1：低空 3D 体积积云层（16 步高预算步进 + 3 步向阳阴影锥 + 双阶多重散射） ──
  if (options.lowClouds) {
    const covThreshold = float(0.74).sub(uCoverage.mul(0.52))
    const stepCount = 16
    const invSteps = 1.0 / stepCount

    for (let i = 0; i < stepCount; i += 1) {
      const h = (i + 0.5) * invSteps
      // 低空积云层位于 H = [1.0, 1.52] 水平大气板内
      const shellH = 1.0 + h * 0.52
      const rayDist = horizontalAtmosphereDist(effectiveRayY, shellH)
      const sampleUV = rayDir.xz.mul(rayDist).mul(altScale).add(uWindOffset)

      const rawD = sampleUdsCumulusDensity(cloudTex, sampleUV, float(h), covThreshold)
      const d = rawD.mul(uDensity).mul(horizonMask)

      // 3 步向阳锥形阴影采样（近、中、远三级光深累积）
      const s1 = sampleUdsCumulusDensity(cloudTex, sampleUV.add(sunDirXZ.mul(0.016)), float(min(1.0, h + 0.12)), covThreshold)
      const s2 = sampleUdsCumulusDensity(cloudTex, sampleUV.add(sunDirXZ.mul(0.042)), float(min(1.0, h + 0.28)), covThreshold)
      const s3 = sampleUdsCumulusDensity(cloudTex, sampleUV.add(sunDirXZ.mul(0.088)), float(min(1.0, h + 0.52)), covThreshold)
      const shadowOpticalDepth = s1.mul(0.35).add(s2.mul(0.38)).add(s3.mul(0.27)).mul(uShadow).mul(uDensity).mul(3.4)

      // UDS 双阶多重散射（Primary Beer + Secondary Multi-Scatter Octave）：厚云内部柔和通透不死黑
      const primaryTrans = exp(shadowOpticalDepth.negate())
      const multiScatterTrans = exp(shadowOpticalDepth.mul(-0.28)).mul(0.45)
      const sunTrans = clamp(primaryTrans.mul(0.72).add(multiScatterTrans), 0.0, 1.15)

      // Beer-Powder 糖霜边缘体积感：迎光花椰菜云包立体饱满
      const powder = float(1.0).sub(exp(d.mul(-3.8)).mul(0.48))

      // 垂直高度环境光插值 + 闪电内部透光
      const verticalAmbient = mix(bottomAmbientColor, topSkyAmbientColor, smoothstep(float(0.05), float(0.88), float(h)))
      const directSun = litTopColor.mul(sunTrans.mul(powder).add(phaseHG.mul(sunTrans).mul(0.62)))
      const lightningGlow = vec3(0.68, 0.80, 1.0).mul(uLightning.mul(0.42))

      // 地平线远距大气透视融合（远端云团自然融入地平线散射天光）
      const aerialBlend = clamp(float(1.0).sub(exp(max(rayDist.sub(1.4), float(0.0)).mul(-0.24))), 0.0, 0.82)
      const localCloudCol = mix(verticalAmbient.add(directSun).add(lightningGlow), skyBgRgb, aerialBlend)

      const stepExtinction = d.mul(0.36)
      const stepTrans = exp(stepExtinction.negate())
      const stepAlpha = float(1.0).sub(stepTrans)

      scatteredLight = vec3(scatteredLight as never).add(localCloudCol.mul(stepAlpha).mul(transmittance as never))
      transmittance = float(transmittance as never).mul(stepTrans)
    }
  }

  // ── 层级 2：中空高积云/层云层（6 步体积步进，1.85 倍海拔 + 异向风切变视差） ──
  if (options.midClouds) {
    const midCovThresh = float(0.78).sub(uCoverage.mul(0.48))
    const midHeights = [0.12, 0.28, 0.45, 0.62, 0.78, 0.92]
    for (let i = 0; i < midHeights.length; i += 1) {
      const h = midHeights[i]!
      const shellH = 1.85 + h * 0.28
      const rayDist = horizontalAtmosphereDist(effectiveRayY, shellH)
      const midUV = rayDir.xz.mul(rayDist).mul(altScale.mul(0.72)).add(uMidWindOffset)

      // 中空层积云采用更平展成片的采样
      const sMid1 = texture(cloudTex, midUV)
      const sMid2 = texture(cloudTex, rotOctave(midUV, 2.2, 0.33, 0.61))
      const midField = sMid1.r.mul(0.58).add(sMid2.g.mul(0.42))
      const midProfile = smoothstep(float(0.0), float(0.22), float(h)).mul(smoothstep(float(1.0), float(0.35), float(h)))
      const midDensity = clamp(
        midField.mul(midProfile.mul(0.3).add(0.7)).sub(midCovThresh).div(max(float(1.0).sub(midCovThresh), float(0.18))),
        0.0,
        1.0,
      )
        .mul(uDensity)
        .mul(0.65)
        .mul(horizonMask)

      const sMidSun = texture(cloudTex, midUV.add(sunDirXZ.mul(0.025))).r
      const midSunTrans = exp(max(sMidSun.sub(midCovThresh), float(0.0)).mul(uShadow).mul(-2.4))
      const midAmbient = mix(bottomAmbientColor, topSkyAmbientColor, float(0.45 + h * 0.45))
      const midDirect = litTopColor.mul(midSunTrans.mul(0.75).add(phaseHG.mul(midSunTrans).mul(0.45)))
      const aerialBlend = clamp(float(1.0).sub(exp(max(rayDist.sub(2.0), float(0.0)).mul(-0.18))), 0.0, 0.85)
      const midCol = mix(midAmbient.add(midDirect), skyBgRgb, aerialBlend)

      const stepTrans = exp(midDensity.mul(-0.28))
      const stepAlpha = float(1.0).sub(stepTrans)
      scatteredLight = vec3(scatteredLight as never).add(midCol.mul(stepAlpha).mul(transmittance as never))
      transmittance = float(transmittance as never).mul(stepTrans)
    }
  }

  // ── 层级 3：万米高空流线冰晶卷云层（各向异性旋流 A 通道 + 太阳冰晶前向散射） ──
  if (options.highClouds) {
    const highDist = horizontalAtmosphereDist(effectiveRayY, 3.1)
    const highUV = rayDir.xz.mul(highDist).mul(altScale.mul(0.42)).add(uHighWindOffset)
    const warpSample = texture(cloudTex, highUV.mul(0.35))
    const warpedHighUV = highUV.add(vec2(warpSample.r.sub(0.5), warpSample.b.sub(0.5)).mul(0.18))
    const cSample1 = texture(cloudTex, warpedHighUV)
    const cSample2 = texture(cloudTex, rotOctave(warpedHighUV, 1.85, 0.51, 0.19).sub(uHighWindOffset.mul(0.35)))
    const cirrusFlow = cSample1.a.mul(0.62).add(cSample2.a.mul(0.38))

    const cirrusThresh = float(0.72).sub(uCirrusCov.mul(0.48))
    const cirrusMask = smoothstep(cirrusThresh, float(0.96), cirrusFlow)
      .mul(uCirrusCov)
      .mul(horizonMask)
      .mul(exp(max(highDist.sub(2.5), float(0.0)).mul(-0.14)))

    const cirrusAlpha = clamp(cirrusMask.mul(0.62), 0.0, 0.78)
    const cirrusColor = mix(topSkyAmbientColor, litTopColor, float(0.72)).add(
      vec3(uSunColor as never).mul(phaseHG.mul(0.55)),
    )

    scatteredLight = vec3(scatteredLight as never).add(cirrusColor.mul(cirrusAlpha).mul(transmittance as never))
    transmittance = float(transmittance as never).mul(float(1.0).sub(cirrusAlpha))
  }

  let skyResult: unknown = skyBgRgb.mul(transmittance as never).add(scatteredLight as never)

  // 沙尘暴模式下：天空地平线与中低空同步被浓厚黄沙大气笼罩
  if (options.sandHaze) {
    const horizonSandMask = smoothstep(float(0.68), float(-0.05), rayDir.y).mul(clamp(uSandHaze.mul(1.15), 0.0, 0.96))
    const dayScale = dayFactor.mul(0.65).add(0.35)
    const sandSkyCol = vec3(uSandColor as never).mul(dayScale)
    skyResult = mix(skyResult as never, sandSkyCol, horizonSandMask)
  }

  const finalRgb = select(isBg, skyResult as never, base.rgb as never)
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
      uCoverage.value = s.cloudsEnabled ? s.cloudCoverage : 0
      uDensity.value = s.cloudDensity
      uAltitude.value = s.cloudAltitude
      uScale.value = s.cloudScale
      const rad = (s.cloudWindAngle * Math.PI) / 180
      const spd = s.cloudWindSpeed * 0.0018 * elapsedTime
      uWindOffset.value.set(Math.cos(rad) * spd, Math.sin(rad) * spd)
      // 中空云层带有 +22° 风向切变与 0.72 倍风速差，产生真实高低空视差
      const midRad = rad + (22 * Math.PI) / 180
      const midSpd = spd * 0.72
      uMidWindOffset.value.set(Math.cos(midRad) * midSpd, Math.sin(midRad) * midSpd)
      // 高空卷云带有 -15° 风向切变与 0.45 倍风速
      const highRad = rad - (15 * Math.PI) / 180
      const highSpd = spd * 0.45
      uHighWindOffset.value.set(Math.cos(highRad) * highSpd, Math.sin(highRad) * highSpd)
      uSilver.value = s.cloudSilverLining
      uShadow.value = s.cloudShadowStrength
      uCloudTint.value.set(s.cloudTint)
      uCirrusCov.value = s.highCloudsEnabled ? s.cirrusCoverage : 0
      uSandHaze.value = s.enabled && s.precipitationType === 'sand' ? s.sandstormHaze : 0
      uSandColor.value.set(s.precipitationColor)
      uLightning.value = s.enabled && s.lightningEnabled ? lightningFlash * s.lightningIntensity * 0.5 : 0
    },
  }
}
