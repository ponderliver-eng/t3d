import {
  AdditiveBlending,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Scene,
  Vector2,
  Vector3,
  type Camera,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  attribute,
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
  modelWorldMatrix,
  normalGeometry,
  normalize,
  positionGeometry,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  renderGroup,
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

// 空中雨丝真屏幕空间折射专用离屏场景与网格（共享 precipGeo，在天空云与雾之后合成折射）
let rainScene: Scene | null = null
let rainMesh: Mesh | null = null
let rainRefractMat: MeshBasicNodeMaterial | null = null
let rainMaskBaseNode: unknown = null
const uRainCamProjInv = uniform(new Matrix4())

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
const uRainStreakLength = uniform(1.0)
const uRainStreakIntensity = uniform(1.2)
const uSnowParticleSize = uniform(1.0)
const uSnowSway = uniform(1.0)

// 物体表面雨滴 MRT 通道专用 Uniform（在 scenePass 顶点/片元阶段基于模型静止姿态 Rest Pose 计算，彻底根除角色走动与动画时的水滴滑动！）
// 必须放进 renderGroup 共享 UBO：three 对没有动画的静态网格（Box 等）每帧只刷新共享分组，
// 默认的 objectGroup uniform 不会重新上传，时间就停在第一帧——只有蒙皮角色会流淌。
const uObjDripTime = uniform(0).setGroup(renderGroup)
const uObjDripSpeed = uniform(1.0).setGroup(renderGroup)
const uObjDripDensity = uniform(0.55).setGroup(renderGroup)
const uObjDripScale = uniform(1.0).setGroup(renderGroup)
const uObjDripActive = uniform(0).setGroup(renderGroup)

// 模块热重载版本号（确保修改着色器后 HMR 立即触发后期管线重新编译）
const WEATHER_SHADER_REVISION = 9

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
  uObjDripTime.value = elapsedTime
  uObjDripSpeed.value = settings.rainDripsSpeed
  uObjDripDensity.value = settings.rainDripsDensity
  uObjDripScale.value = settings.rainDripsScale
  uObjDripActive.value = settings.enabled && settings.wetnessEnabled && settings.rainDripsEnabled ? 1 : 0
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
    // 编码层级：0~48% 为近景高密层 (tier 0)，48%~88% 为中景主力层 (tier 1)，88%~100% 为远景层 (tier 2)
    const u = Math.random()
    const tier = u < 0.48 ? 0.0 : u < 0.88 ? 1.0 : 2.0
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
  const snowSwayAmp = float(0.75).mul(clamp(uSnowSway, 0.0, 3.0))
  const turbAmp = select(isSnow, snowSwayAmp, select(isSandBillow, float(1.6), select(isSand, float(0.45), float(0.03))))
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

  const centerWorld = vec3(wrappedX, wrappedY, wrappedZ)

  // 粒子尺寸：
  // - 雨滴：细长雨丝，长度受 uRainStreakLength 直接控制
  // - 雪花：饱满柔和雪片
  // - 沙尘暴巨型尘团（isSandBillow）：3.2m ~ 7.6m 翻滚大沙暴团！
  // - 沙尘暴疾风沙粒：横向飞沙簇
  const tierWidthScale = select(tierId.lessThan(float(0.5)), float(0.88), select(tierId.lessThan(float(1.5)), float(1.18), float(1.55)))
  const tierLenScale = select(tierId.lessThan(float(0.5)), float(0.82), select(tierId.lessThan(float(1.5)), float(1.08), float(1.38)))

  const rainW = tierWidthScale.mul(float(0.014).add(aMotion.w.mul(0.010)))
  const rainH = tierLenScale
    .mul(float(0.75).add(aMotion.w.mul(0.55)))
    .mul(float(0.65).add(uPrecipSpeed.mul(0.35)))
    .mul(clamp(uRainStreakLength, 0.05, 1.0))

  const snowW = tierWidthScale
    .mul(float(0.055).add(aMotion.w.mul(0.065)))
    .mul(clamp(uSnowParticleSize, 0.05, 2.0))
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

  const isCameraBillboard = isSnow.or(isSand)
  const activeOffset = select(isCameraBillboard, cameraBillboardOffset, rainStreakOffset)
  precipMat.positionNode = centerWorld.add(activeOffset)

  // 片元形态：
  // 1. 雪花：柔和立体晶核
  // 2. 雨丝：透明柱状水滴透镜（内部通透半透明 + 偏轴高光脊线 + 底部水滴球头聚光焦点，告别死白粉笔线）
  // 3. 沙尘暴巨型尘团与飞沙团：采样无缝湍流云纹理 + 翻滚软边气团（全向正对镜头）
  const pUv = uv().sub(0.5).mul(2.0)
  const radial = length(pUv)
  const snowCore = exp(radial.mul(radial).mul(-3.2)).mul(smoothstep(float(1.0), float(0.15), radial))

  // 透明折射水滴雨丝光学形态：
  // 真实下落雨滴主体为极低不透明度的半透明冷灰蓝水痕，仅底部水珠圆头带微弱折射聚光点，彻底告别空中死白长线
  const rainWidthEnv = smoothstep(float(1.0), float(0.12), abs(pUv.x))
  const rainTailFade = smoothstep(float(1.0), float(-0.62), pUv.y).mul(smoothstep(float(-1.0), float(-0.78), pUv.y))
  // 右侧与外缘深色折射水棱边
  const rainDarkRefractEdge = smoothstep(float(0.42), float(0.0), abs(pUv.x.sub(0.26))).mul(0.55)
  // 仅在雨滴最底端（pUv.y ≈ -0.62）保留圆润水珠头聚光点，不再画贯通全身的高光白线
  const rainDropHead = smoothstep(float(0.36), float(0.0), length(vec2(pUv.x.mul(1.6), pUv.y.add(0.62))))
  const rainStrength = clamp(uRainStreakIntensity, 0.2, 3.0)
  const rainProfileAlpha = float(0.18)
    .add(rainDarkRefractEdge.mul(0.32))
    .add(rainDropHead.mul(0.68))
  const rainGlassBody = clamp(rainWidthEnv.mul(rainTailFade).mul(rainProfileAlpha).mul(0.62).mul(rainStrength), 0.0, 0.92)

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
    select(isSandBillow, sandBillowAlpha, select(isSand, sandGrainAlpha, rainGlassBody)),
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

  // 沙尘暴尘团内部自带顶部受光与底部浓暗立体感；
  // 雨滴主体为幽暗半透明水影色，仅底部泪滴头带折射微光（彻底告别纯白长线！）
  const billowShade = mix(float(0.76), float(1.16), clamp(pUv.y.mul(0.5).add(0.5).add(dustNoise.sub(0.5).mul(0.35)), 0.0, 1.0))
  const precipRgb = vec3(uPrecipColor.r, uPrecipColor.g, uPrecipColor.b)
  const rainBodyMix = clamp(float(0.35).add(rainStrength.sub(1.0).mul(0.26)), 0.22, 0.85)
  const rainWaterBodyCol = mix(vec3(0.22, 0.29, 0.38), precipRgb, rainBodyMix)
  const rainRefractColor = mix(rainWaterBodyCol, precipRgb.mul(float(1.05).add(rainStrength.mul(0.12))), clamp(rainDropHead.mul(0.88), 0.0, 1.0))

  precipMat.colorNode = select(
    isSandBillow,
    precipRgb.mul(billowShade),
    select(isSnow.or(isSand), precipRgb, rainRefractColor),
  )
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

  // ── 同步创建空中雨丝真屏幕空间折射网格（共享 precipGeo，挂到独立 rainScene） ──
  rainRefractMat = new MeshBasicNodeMaterial()
  rainRefractMat.transparent = true
  rainRefractMat.blending = AdditiveBlending
  rainRefractMat.depthWrite = false
  rainRefractMat.depthTest = false
  rainRefractMat.side = DoubleSide
  const rainWorldPos = centerWorld.add(rainStreakOffset)
  rainRefractMat.positionNode = rainWorldPos

  // 使用正负分离编码 + AdditiveBlending：空白处清屏黑色 (0,0,0) 对应 R-G=0、遮罩=0，彻底杜绝清屏 Alpha=1 导致的全屏扭曲！
  const cylGradX = pUv.x.negate().mul(rainWidthEnv)
  const posGradX = max(cylGradX, float(0.0))
  const negGradX = max(cylGradX.negate(), float(0.0))
  rainMaskBaseNode = rainWidthEnv
    .mul(rainTailFade)
    .mul(float(0.35).add(rainDropHead.mul(0.65)))
    .mul(edgeFade)
    .mul(nearFade)
    .mul(uPrecipOpacity)
  rainRefractMat.colorNode = vec3(
    posGradX,
    negGradX,
    rainDropHead.mul(0.85),
  )
  rainRefractMat.opacityNode = rainMaskBaseNode as never

  if (!rainScene) rainScene = new Scene()
  rainMesh = new Mesh(precipGeo, rainRefractMat)
  rainMesh.name = '__WeatherRainRefract__'
  rainMesh.frustumCulled = false
  rainMesh.castShadow = false
  rainMesh.receiveShadow = false
  rainMesh.visible = false
  rainMesh.layers.disableAll()
  for (let bit = 0; bit < EDITOR_HELPER_LAYER; bit += 1) rainMesh.layers.enable(bit)
  rainScene.add(rainMesh)
}

function disposePrecipitationMesh() {
  if (precipMesh && precipScene) {
    precipScene.remove(precipMesh)
  }
  if (rainMesh && rainScene) {
    rainScene.remove(rainMesh)
  }
  precipGeo?.dispose()
  precipMat?.dispose()
  rainRefractMat?.dispose()
  precipMesh = null
  rainMesh = null
  precipGeo = null
  precipMat = null
  rainRefractMat = null
  rainMaskBaseNode = null
  precipScene = null
}

function syncPrecipitation(scene: Scene, camera: Camera, settings: WeatherSettings) {
  const active = mounted && settings.enabled && settings.precipitationType !== 'none' && settings.precipitationIntensity > 0.01
  if (!active) {
    if (precipMesh) precipMesh.visible = false
    if (rainMesh) rainMesh.visible = false
    return
  }
  ensurePrecipitationMesh(scene)
  if (!precipMesh || !precipGeo) return

  const isRainRefractMode = settings.precipitationType === 'rain' && settings.rainRefractionEnabled
  precipMesh.visible = !isRainRefractMode
  if (rainMesh) rainMesh.visible = isRainRefractMode
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
  uRainStreakIntensity.value = settings.rainStreakIntensity
  uSnowParticleSize.value = settings.snowParticleSize
  uSnowSway.value = settings.snowSway
  const rad = (settings.cloudWindAngle * Math.PI) / 180
  uPrecipWindVec.value.set(Math.cos(rad) * settings.precipitationWind, Math.sin(rad) * settings.precipitationWind)
  uPrecipColor.value.set(settings.precipitationColor)
  uPrecipOpacity.value = Math.min(1, 0.42 + settings.precipitationIntensity * 0.58)
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

function rainRefractBit(s: WeatherSettings): number {
  if (!s.enabled || s.precipitationType !== 'rain' || s.precipitationIntensity <= 0.01 || !s.rainRefractionEnabled) return 0
  return 1
}

export function getWeatherRainScene(): Scene {
  if (!rainScene) rainScene = new Scene()
  return rainScene
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
    rainRefractBit(s) > 0 ||
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
    `on${WEATHER_SHADER_REVISION}`,
    cloudLayerBits(s),
    surfaceWetBits(s),
    s.snowCoverEnabled ? 1 : 0,
    sandHazeBit(s),
    rainRefractBit(s),
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

/**
 * 双层重叠雨滴同心圆水波纹：
 * 1) 涟漪尺寸恒定（绝不缩放 Tile 大小），通过 uRippleDensity (0.05~1) 控制每个网格周期的雨滴落点出现概率（真正控制涟漪数量！）
 * 2) 内置解析式 Mipmap 距离与掠射角抗锯齿滤波（pixelFootprint），彻底消除中远景水坑的高频噪点闪烁
 * 3) 支持 uRippleIntensity (0~2) 独立控制水波纹法线与波峰高光显示强度
 */
function rainRippleOffset(
  worldXZ: unknown,
  timeNode: unknown,
  densityNode: unknown,
  intensityNode: unknown,
  pixelFootprintNode: unknown,
) {
  const spawnRatio = clamp(float(densityNode as never), 0.02, 1.0)
  const strength = max(float(intensityNode as never), float(0.0))
  const footprint = max(float(pixelFootprintNode as never), float(0.5))
  const xz = vec2(worldXZ as never)
  const t = float(timeNode as never)

  // 解析式 Mipmap 滤波：随距离与掠射角自动降低波纹空间频率并平滑衰减亚像素高频波，彻底根除远处水坑噪点
  const mipAtten = smoothstep(float(22.0), float(3.2), footprint)
  const ringFreq = mix(float(16.0), float(32.0), smoothstep(float(14.0), float(2.0), footprint))

  // 第一层固定物理尺度涟漪网格（单格约 45cm，涟漪直径恒定，由 activeA 控制出现数量）
  const pA = xz.mul(2.2)
  const cellA = floor(pA)
  const localA = fract(pA).sub(0.5)
  const seedA = fastHash12(cellA)
  const cycleTimeA = t.mul(1.10).add(seedA.mul(7.13))
  const cycleIdA = floor(cycleTimeA)
  const phaseA = fract(cycleTimeA)
  const spawnHashA = fastHash12(cellA.add(vec2(cycleIdA.mul(1.37), cycleIdA.mul(3.11))))
  const activeA = smoothstep(spawnRatio, max(spawnRatio.sub(0.06), float(0.0)), spawnHashA)
  // 格内随机微偏心，避免死板网格排列
  const centerJitterA = vec2(seedA.sub(0.5), fract(seedA.mul(7.3)).sub(0.5)).mul(0.28)
  const deltaA = localA.sub(centerJitterA)
  const distA = length(deltaA)
  const waveDeltaA = distA.sub(phaseA.mul(0.38))
  const ringA = sin(waveDeltaA.mul(ringFreq))
    .mul(smoothstep(float(0.40), float(0.02), distA))
    .mul(smoothstep(float(0.11), float(0.0), abs(waveDeltaA)))
    .mul(float(1.0).sub(phaseA))
    .mul(activeA)

  // 第二层交错固定尺度涟漪网格
  const pB = rotOctave(xz, 2.55, 5.37, 8.91)
  const cellB = floor(pB)
  const localB = fract(pB).sub(0.5)
  const seedB = fastHash12(cellB)
  const cycleTimeB = t.mul(1.28).add(seedB.mul(11.3))
  const cycleIdB = floor(cycleTimeB)
  const phaseB = fract(cycleTimeB)
  const spawnHashB = fastHash12(cellB.add(vec2(cycleIdB.mul(2.19), cycleIdB.mul(1.73))))
  const activeB = smoothstep(spawnRatio, max(spawnRatio.sub(0.06), float(0.0)), spawnHashB)
  const centerJitterB = vec2(seedB.sub(0.5), fract(seedB.mul(5.9)).sub(0.5)).mul(0.26)
  const deltaB = localB.sub(centerJitterB)
  const distB = length(deltaB)
  const waveDeltaB = distB.sub(phaseB.mul(0.36))
  const ringB = sin(waveDeltaB.mul(ringFreq.mul(1.06)))
    .mul(smoothstep(float(0.38), float(0.02), distB))
    .mul(smoothstep(float(0.11), float(0.0), abs(waveDeltaB)))
    .mul(float(1.0).sub(phaseB))
    .mul(activeB)

  const dirA = deltaA.div(max(distA, float(0.001)))
  const dirB = deltaB.div(max(distB, float(0.001)))
  const offset2D = dirA.mul(ringA).add(dirB.mul(ringB)).mul(0.22).mul(strength).mul(mipAtten)
  const crestGlow = max(ringA, float(0.0)).add(max(ringB, float(0.0))).mul(strength).mul(mipAtten)
  return { offset2D, crestGlow }
}

/**
 * 单层水流轨迹凸透镜高度场（返回 [0, 1] 抛物面凸起水珠厚度 hDrop）：
 * - 形态为「饱满向下滑动的圆润水珠头 + 后方 3 颗受表面张力断裂分离的跟随小水珠（颗与颗之间完全归零断开）」
 * - 彻底告别静止竖直长条水轨：即使在完全无纹理的纯白 Box 侧面上，每颗水珠的上下弯月面法线 (gradY) 与左右水棱 (gradX) 也会清晰地逐帧向下滑动！
 */
function evalSingleRivuletLayer(
  hcNode: unknown,
  vcNode: unknown,
  laneScale: number,
  scrollScale: number,
  planeSeed: number,
  timeNode: unknown,
  spawnRatioNode: unknown,
  widthScaleNode: unknown,
) {
  const hc = float(hcNode as never)
  const vc = float(vcNode as never)
  const timeVal = float(timeNode as never)
  const spawnRatio = float(spawnRatioNode as never)
  const widthScale = clamp(float(widthScaleNode as never), 0.3, 2.5)
  const wiggle = fastValueNoise2D(vec2(hc.mul(laneScale * 0.45).add(planeSeed), vc.mul(scrollScale * 1.4))).sub(0.5).mul(0.24)
  const u = hc.mul(laneScale).add(wiggle)
  const laneId = floor(u)
  const localX = fract(u).sub(0.5)
  const laneHash = fastHash12(vec2(laneId, float(planeSeed)))

  const scroll = vc.mul(scrollScale).add(timeVal.mul(float(0.68).add(laneHash.mul(0.58)))).add(laneHash.mul(17.3))
  const cellIdY = floor(scroll)
  const phaseY = fract(scroll)

  // 出现概率：hash 低于 spawnRatio 的格子才有水滴。edge0 < edge1 严格递增，
  // spawnRatio 为 0 时整层关闭（旧写法 edge0 == edge1 会除零，使加密层恒亮、数量滑杆失效）
  const dropSpawnHash = fastHash12(vec2(laneId.add(float(planeSeed)), cellIdY.mul(0.25)))
  const culled = smoothstep(max(spawnRatio.sub(0.08), float(0.0)), max(spawnRatio, float(0.001)), dropSpawnHash)
  const activeDrop = float(1.0).sub(culled).mul(smoothstep(float(0.0), float(0.04), spawnRatio))

  // 宽度从底部水珠头 (0.24) 向上方流淌长尾 (0.10) 平滑收窄；widthScale 只做横向缩放，不改变形状
  const halfWidth = clamp(float(0.24).sub(phaseY.mul(0.14)).mul(widthScale), 0.03, 0.48)
  const normX = localX.div(halfWidth)
  // 头部（最下方）半圆收口：把水珠头半宽按流道/滚动比例换算成纵向相位半径，
  // 在最底部这段相位内按圆方程收窄，轮廓是半圆而不是被格子边界切平的方头
  const headRadiusPhase = clamp(float(0.24).mul(widthScale), 0.03, 0.48).mul(scrollScale / laneScale)
  const capT = clamp(headRadiusPhase.sub(phaseY).div(headRadiusPhase), 0.0, 1.0)
  // 真实水条截面抛物面凸起厚度：中心为 1.0，两侧边缘陡峭降至 0.0（斜率 dH/dx = -2*normX）
  const domeCrossSection = clamp(float(1.0).sub(normX.mul(normX)).sub(capT.mul(capT)), 0.0, 1.0)

  // 底部圆润水滴头 + 带有表面张力波节的修长流淌水迹线（波节产生纵向透镜屈光度变化）
  const dropHead = smoothstep(float(0.18), float(0.0), phaseY)
  const beadRipples = float(0.72).add(sin(phaseY.mul(28.0).add(laneHash.mul(6.28))).mul(0.28))
  const dropTrail = smoothstep(float(0.82), float(0.0), phaseY).mul(0.76).mul(beadRipples)

  return domeCrossSection.mul(max(dropHead, dropTrail)).mul(activeDrop)
}

/**
 * 单平面多级水滴流淌高度场：
 * - 支持 densityNode 在 0.05 ~ 3.0 范围大跨度加密：既提升 4 层错位流道激活率，又同步加密水平流道与纵向水珠频率
 * - 支持 scaleNode 在 0.3 ~ 2.5 范围无级调节流淌水滴粗细
 */
function evalPlanarWaterDropHeight(
  horizCoord: unknown,
  vertCoord: unknown,
  planeSeed: number,
  t: unknown,
  densityNode: unknown,
  scaleNode: unknown,
) {
  const hc = float(horizCoord as never)
  const vc = float(vertCoord as never)
  const timeVal = float(t as never)
  const dens = clamp(float(densityNode as never), 0.05, 3.0)

  // 流道尺寸与形状固定不变，数量只靠「出现概率 + 逐层开启」调节：
  // 0.05~1 提升 A/B 两层的出现概率，1~3 依次开启 C/D/E/F 四层错位流道
  const spawnAB = clamp(dens, 0.05, 1.0)
  const spawnC = clamp(dens.sub(1.0).mul(2.0), 0.0, 1.0)
  const spawnD = clamp(dens.sub(1.5).mul(2.0), 0.0, 1.0)
  const spawnE = clamp(dens.sub(2.0).mul(2.0), 0.0, 1.0)
  const spawnF = clamp(dens.sub(2.5).mul(2.0), 0.0, 1.0)

  const hA = evalSingleRivuletLayer(hc, vc, 7.2, 1.85, planeSeed + 1.0, timeVal, spawnAB, scaleNode)
  const hB = evalSingleRivuletLayer(hc, vc, 14.8, 2.95, planeSeed + 43.0, timeVal, spawnAB, scaleNode).mul(0.88)
  const hC = evalSingleRivuletLayer(hc, vc, 10.8, 2.35, planeSeed + 89.0, timeVal, spawnC, scaleNode).mul(0.92)
  const hD = evalSingleRivuletLayer(hc, vc, 21.2, 3.65, planeSeed + 137.0, timeVal, spawnD, scaleNode).mul(0.85)
  const hE = evalSingleRivuletLayer(hc, vc, 8.9, 2.1, planeSeed + 181.0, timeVal, spawnE, scaleNode).mul(0.9)
  const hF = evalSingleRivuletLayer(hc, vc, 17.6, 3.25, planeSeed + 229.0, timeVal, spawnF, scaleNode).mul(0.86)

  return clamp(max(max(max(hA, hB), max(hC, hD)), max(hE, hF)), 0.0, 1.0)
}

/**
 * 在 scenePass 的 MRT (metalrough.b) 阶段直接基于模型静止姿态（Rest Pose: positionGeometry / normalGeometry）计算水滴高度场！
 * - 100% 锁定在角色皮肤/盔甲与物体自身的静止网格上：角色走动、跑步、转身、呼吸摆臂时绝不平移、绝不交叉滑动！
 */
export function buildWeatherObjectDripNode() {
  const t = uObjDripTime.mul(max(uObjDripSpeed, float(0.2)))

  // 1) 使用骨骼蒙皮前与世界平移前的静止姿态顶点 positionGeometry（w=0 自动忽略角色世界位移！）
  const geomWorldVec = modelWorldMatrix.mul(vec4(positionGeometry, 0.0)).xyz
  const modelWorldOrigin = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz
  const skinnedRelVec = positionWorld.sub(modelWorldOrigin)
  // 自动兼容 FBX 厘米级顶点（若骨骼内含 0.01 缩放，自动归一到真实米制尺度）
  const isCmScale = length(geomWorldVec).greaterThan(length(skinnedRelVec).mul(12.0))
  const metricRestVec = geomWorldVec.mul(select(isCmScale, float(0.01), float(1.0)))

  // 2) 消除角色/物体绕世界 Y 轴的旋转角（yaw），使局部坐标永远固定在模型自身方向
  const col0 = modelWorldMatrix.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz
  const rightXZ = normalize(vec2(col0.x, col0.z).add(vec2(0.00001, 0.0)))
  const fwdXZ = vec2(rightXZ.y.negate(), rightXZ.x)

  const localPos = vec3(
    dot(metricRestVec.xz, rightXZ),
    metricRestVec.y,
    dot(metricRestVec.xz, fwdXZ),
  )

  const rawRestNorm = normalize(modelWorldMatrix.mul(vec4(normalGeometry, 0.0)).xyz)
  const localNorm = normalize(vec3(
    dot(rawRestNorm.xz, rightXZ),
    rawRestNorm.y,
    dot(rawRestNorm.xz, fwdXZ),
  ))

  const hPlaneX = evalPlanarWaterDropHeight(localPos.z, localPos.y, 0.0, t, uObjDripDensity, uObjDripScale)
  const hPlaneZ = evalPlanarWaterDropHeight(localPos.x, localPos.y, 53.0, t, uObjDripDensity, uObjDripScale)

  const absNx = abs(localNorm.x)
  const absNz = abs(localNorm.z)
  const blendZ = smoothstep(float(0.42), float(0.58), absNz.div(max(absNx.add(absNz), float(0.001))))
  const sideMask = smoothstep(float(0.88), float(0.42), abs(localNorm.y)).mul(smoothstep(float(-0.45), float(0.15), localNorm.y))

  return mix(hPlaneX, hPlaneZ, blendZ).mul(sideMask).mul(uObjDripActive)
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
  const uRippleDensity = uniform(0.65)
  const uRippleIntensity = uniform(1.0)
  const uDripsDensity = uniform(0.55)
  const uDripsIntensity = uniform(1.0)
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
  const metalRoughTex = scenePass.getTextureNode('metalrough') as {
    sample: (uv: unknown) => { b: unknown }
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

    // 角色身体、盔甲与物体侧面真实透明折射雨滴流淌轨迹（基于 MRT 静止姿态水膜高度场 hDrop 求导折射，100% 锁定模型表面 + 真透镜扭曲 + 纯色 Box 表面立体移动水珠！）
    if (options.drips) {
      const dripStrength = clamp(uDripsIntensity, 0.0, 2.0).mul(clamp(uWetness.mul(1.25), 0.25, 1.0))

      // 从 MRT metalrough.b 读取当前像素及四邻域的模型锁定水膜高度 hDrop ∈ [0, 1]
      const epsX = vec2(0.0022, 0.0)
      const epsY = vec2(0.0, 0.0032)
      const hC = float(metalRoughTex.sample(screenUV).b as never)
      const hR = float(metalRoughTex.sample(clamp(screenUV.add(epsX), 0.001, 0.999)).b as never)
      const hL = float(metalRoughTex.sample(clamp(screenUV.sub(epsX), 0.001, 0.999)).b as never)
      const hU = float(metalRoughTex.sample(clamp(screenUV.add(epsY), 0.001, 0.999)).b as never)
      const hD = float(metalRoughTex.sample(clamp(screenUV.sub(epsY), 0.001, 0.999)).b as never)

      // 屏幕空间 2D 凸透镜梯度（每颗滑落水珠与尾珠具备独立闭合的左右 gradX 与上下弯月面 gradY）
      const gradX = hR.sub(hL)
      const gradY = hU.sub(hD)
      const waterMask = smoothstep(float(0.015), float(0.14), hC)

      // 1) 强凸透镜放大扭曲采样（光线向水膜中心折射弯曲 + 水体厚度波动偏移）
      const lensShift = vec2(
        gradX.mul(-0.048).add(sin(hC.mul(9.42)).mul(0.015)),
        gradY.mul(-0.048).sub(hC.mul(0.014)),
      ).mul(dripStrength).mul(waterMask)

      const refractUV = clamp(screenUV.add(lensShift), 0.002, 0.998)
      const refractedDepth = depthTex.sample(refractUV).r
      const validRefract = select(isBackgroundDepth(refractedDepth as never), float(0.0), float(1.0))
      const refractedRgb = vec3(beautyTex.sample(refractUV).rgb as never).mul(
        mix(float(1.0), float(0.64), wetSurface),
      )

      // 水体内部 100% 采用折射后的基底纹理颜色（绝不混入灰白底色！）
      const clearWaterBase = mix(
        vec3(surfaceRgb as never),
        refractedRgb,
        waterMask.mul(validRefract),
      )

      // 2) 立体水珠明暗聚焦（即使在纯白无纹理的 Box 侧面上，每颗滑落水珠也有清晰的深色全反射水棱圈 + 底部弯月面透射聚光焦散弧，逐帧清晰向下滚动！）
      const slopeMag = length(vec2(gradX, gradY))
      const rimDarken = clamp(slopeMag.mul(0.68).mul(dripStrength), 0.0, 0.54).mul(waterMask)
      const bellyCaustic = clamp(gradY.mul(0.58).mul(dripStrength), 0.0, 0.38).mul(waterMask)
      const liquidContrast = float(1.0).sub(rimDarken).add(bellyCaustic)

      // 3) 仅在水珠圆头的纵向弯曲顶点 (|gradY| > 0.14) 允许针尖高光点，竖直水迹线上 gradY≈0 故不会产生竖白线
      const beadCapOnly = smoothstep(float(0.14), float(0.36), abs(gradY)).mul(waterMask)
      const waterNormalWorld = normalize(worldNormal.add(vec3(gradX.mul(-2.4), gradY.mul(-2.4), gradX.mul(-2.4))))
      const halfVec = normalize(uSunDir.add(viewDir))
      const tipSpec = pow(max(dot(waterNormalWorld, halfVec), float(0.0)), float(140.0))
        .mul(beadCapOnly)
        .mul(dripStrength)
        .mul(1.1)

      surfaceRgb = clearWaterBase.mul(liquidContrast).add(vec3(uSunColor as never).mul(tipSpec))
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

    // 水面涟漪法线（支持 uRippleDensity 控制数量、uRippleIntensity 控制强度、解析式 Mipmap 消除远处噪点）
    let puddleNormal: unknown = vec3(0, 1, 0)
    let ripple2D: unknown = vec2(0, 0)
    let rippleCrest: unknown = float(0.0)
    if (options.ripples) {
      const viewDistForMip = length(viewPos)
      const pixelFootprint = viewDistForMip.div(max(abs(viewDir.y), float(0.14)))
      const rippleRes = rainRippleOffset(worldPos.xz, uTime, uRippleDensity, uRippleIntensity, pixelFootprint)
      ripple2D = rippleRes.offset2D
      rippleCrest = rippleRes.crestGlow
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
    const rippleCrestRing = vec3(0.84, 0.92, 1.0).mul(float(rippleCrest as never).mul(0.04))
    const puddleFinal = mix(submergedGround, totalReflection, reflStrength).add(sunSpec).add(rippleCrestRing)

    surfaceRgb = mix(surfaceRgb as never, puddleFinal, puddleMask)
  }

  // 2. 表面积雪覆盖（纯粹不透明厚雪层 + 仅积于朝上表面保护角色细节 + 干净冷蓝雪影不透地砖网格）
  if (options.snow) {
    const sCoord = worldPos.xz.mul(0.28).add(vec2(worldPos.y.mul(0.18), worldPos.y.mul(-0.15)))
    const n1 = fastValueNoise2D(sCoord)
    const n2 = fastValueNoise2D(rotOctave(sCoord, 2.35, 11.4, 27.8))
    const n3 = fastValueNoise2D(rotOctave(sCoord, 5.4, 31.2, 9.7))
    const snowNoise = n1.mul(0.52).add(n2.mul(0.31)).add(n3.mul(0.17))

    // 1) 只覆盖朝上表面（地面、Box 顶面、头盔顶、肩甲顶部），严禁把角色竖直胸甲/面罩涂成白石膏像！
    const startUp = float(0.92).sub(uSnow.mul(0.50))
    const slopeSnow = smoothstep(startUp, startUp.add(0.16), worldNormal.y.add(snowNoise.sub(0.5).mul(0.16)))
    // uSnow 从 0 -> 0.45 控制地面从融雪斑块到完整铺满，>= 0.45 后水平地面 100% 铺实不再透出网格线
    const groundPatch = smoothstep(
      clamp(float(0.45).sub(uSnow), 0.0, 0.44),
      clamp(float(0.65).sub(uSnow), 0.05, 0.65),
      snowNoise,
    )
    const isFlatGround = smoothstep(float(0.88), float(0.97), worldNormal.y)
    const coverageMask = mix(slopeSnow, max(slopeSnow.mul(groundPatch), smoothstep(float(0.35), float(0.65), uSnow)), isFlatGround)
    const snowStrength = smoothstep(float(0.0), float(0.12), uSnow)
    const snowMask = clamp(coverageMask.mul(snowStrength), 0.0, 1.0)

    // 2) 柔和自然的雪面微起伏法线（避免低太阳下产生高对比波浪斑块）
    const epsSnow = 0.16
    const hSnowR = fastValueNoise2D(sCoord.mul(2.4).add(vec2(epsSnow, 0.0)))
    const hSnowL = fastValueNoise2D(sCoord.mul(2.4).sub(vec2(epsSnow, 0.0)))
    const hSnowF = fastValueNoise2D(sCoord.mul(2.4).add(vec2(0.0, epsSnow)))
    const hSnowB = fastValueNoise2D(sCoord.mul(2.4).sub(vec2(0.0, epsSnow)))
    const dSnowX = hSnowR.sub(hSnowL)
    const dSnowZ = hSnowF.sub(hSnowB)
    const snowBumpNormal = normalize(
      worldNormal.add(vec3(dSnowX.mul(0.18), float(0.0), dSnowZ.mul(0.18))),
    )

    // 3) 独立洁白雪面光照：绝不把地面网格线/深色材质纹路乘回雪面上！
    const origRgb = vec3(surfaceRgb as never)
    const origLum = dot(origRgb, vec3(0.299, 0.587, 0.114))
    // 水平地面仅在真正被物体投射阴影的暗区 (origLum < 0.20) 切换为平滑冷蓝雪影；受光区保持纯粹均匀洁白积雪
    const shadowFactor = smoothstep(float(0.04), float(0.20), origLum)
    const nDotSun = max(dot(snowBumpNormal, uSunDir), float(0.0))
    const sunDayMod = float(0.84).add(clamp(nDotSun, 0.0, 1.0).mul(0.20)).add(snowNoise.sub(0.5).mul(0.05))
    const groundShadowSnow = vec3(0.38, 0.48, 0.66)
    const groundLitSnow = vec3(0.96, 0.97, 0.99).mul(sunDayMod)
    const groundSnow = mix(groundShadowSnow, groundLitSnow, shadowFactor)

    // 物体顶面（头盔、肩甲、Box 顶）：按自身朝向与太阳方向自然受光，保持立体冷暖明暗
    const objSunMix = clamp(dot(snowBumpNormal, uSunDir).mul(0.45).add(0.55), 0.0, 1.0)
    const objSnow = mix(vec3(0.56, 0.68, 0.86), vec3(1.0, 1.0, 0.99), objSunMix)
    const baseSnowShade = mix(objSnow, groundSnow, isFlatGround)

    // 4) 细腻雪面微晶冰粒闪烁
    const sparkleCell = floor(worldPos.xz.mul(28.0).add(vec2(worldPos.y.mul(19.0), 0.0)))
    const sparkleHash = fastHash12(sparkleCell)
    const halfVecSnow = normalize(uSunDir.add(viewDir))
    const specSnow = pow(max(dot(snowBumpNormal, halfVecSnow), float(0.0)), float(48.0))
    const snowSparkle = smoothstep(float(0.92), float(0.99), sparkleHash)
      .mul(specSnow)
      .mul(0.55)
      .mul(mix(float(1.0), shadowFactor, isFlatGround))

    const shadedSnow = vec3(uSnowColor as never).mul(baseSnowShade).add(vec3(0.92, 0.96, 1.0).mul(snowSparkle))
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
      uRippleIntensity.value = s.rippleIntensity
      uDripsDensity.value = s.rainDripsDensity
      uDripsIntensity.value = s.rainDripsIntensity
      uDripsSpeed.value = s.rainDripsSpeed
      uObjDripTime.value = elapsedTime
      uObjDripSpeed.value = s.rainDripsSpeed
      uObjDripDensity.value = s.rainDripsDensity
      uObjDripScale.value = s.rainDripsScale
      uObjDripActive.value = s.enabled && s.wetnessEnabled && s.rainDripsEnabled ? 1 : 0
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

  // ── 层级 1：低空 3D 体积积云层（16 步高预算步进 + 3D 太阳方向体积照明 + 乌云黑核与高亮银边轮廓） ──
  if (options.lowClouds) {
    const covThreshold = float(0.74).sub(uCoverage.mul(0.52))
    const stepCount = 16
    const invSteps = 1.0 / stepCount

    // 乌云深层暗核底色（随 uShadow 与云体浓度加深为厚重深灰黑乌云核，同时保留边缘高光）
    const stormCoreColor = mix(
      vec3(0.03, 0.04, 0.07),
      vec3(0.14, 0.17, 0.23).mul(vec3(uCloudTint as never)),
      dayFactor,
    )

    for (let i = 0; i < stepCount; i += 1) {
      const h = (i + 0.5) * invSteps
      // 低空积云层位于 H = [1.0, 1.52] 水平大气板内
      const shellH = 1.0 + h * 0.52
      const rayDist = horizontalAtmosphereDist(effectiveRayY, shellH)
      const sampleUV = rayDir.xz.mul(rayDist).mul(altScale).add(uWindOffset)

      const rawD = sampleUdsCumulusDensity(cloudTex, sampleUV, float(h), covThreshold)
      const d = rawD.mul(uDensity).mul(horizonMask)

      // 1) 真实 3D 太阳方向跨尺度光线步进（0 额外采样开销，拉开步幅直接捕获云朵向阳面、背阳面与立体法线梯度！）
      const s1 = sampleUdsCumulusDensity(cloudTex, sampleUV.add(sunDirXZ.mul(0.032)), float(min(1.0, h + 0.14)), covThreshold)
      const s2 = sampleUdsCumulusDensity(cloudTex, sampleUV.add(sunDirXZ.mul(0.088)), float(min(1.0, h + 0.34)), covThreshold)
      const s3 = sampleUdsCumulusDensity(cloudTex, sampleUV.add(sunDirXZ.mul(0.195)), float(min(1.0, h + 0.62)), covThreshold)

      // 向阳表面方向梯度（当向太阳方向一步 s1 < 当前密度 rawD 时，说明处于朝向太阳的受光球面上，强烈提亮！）
      const sunFacingSlope = clamp(rawD.sub(s1).mul(2.8).add(0.42), 0.0, 1.45)

      // 太阳方向光学深度（背阳侧与云团深处累积浓重自阴影）
      const shadowOpticalDepth = s1.mul(0.32).add(s2.mul(0.38)).add(s3.mul(0.30)).mul(uShadow).mul(uDensity).mul(4.8)
      const primaryTrans = exp(shadowOpticalDepth.negate())
      const multiScatterTrans = exp(shadowOpticalDepth.mul(-0.34)).mul(0.28)
      const sunTrans = clamp(primaryTrans.mul(0.82).add(multiScatterTrans), 0.0, 1.25).mul(sunFacingSlope)

      // 2) 强烈边缘轮廓光（Edge Rim / Silver Lining）：云朵外圈薄边缘 (rawD 0.02~0.38) 强透光，勾勒鲜明立体银边！
      const thinEdgeMask = smoothstep(float(0.01), float(0.11), rawD).mul(smoothstep(float(0.54), float(0.14), rawD))
      const powder = float(1.0).sub(exp(d.mul(-4.5)).mul(0.62))
      const edgeRimGlow = thinEdgeMask.mul(float(0.55).add(phaseHG.mul(0.85))).mul(uSilver).mul(
        exp(s1.mul(uShadow).mul(-1.6)),
      )

      // 3) 乌云体感（中间厚重灰黑，边缘亮轮廓）：云团核心厚度越大、uShadow 越高，内部环境光被强烈吸收压暗
      const coreThickness = smoothstep(float(0.16), float(0.68), rawD.mul(clamp(uDensity, 0.5, 2.0)))
      const coreDarkWeight = clamp(
        coreThickness.mul(uShadow).mul(float(0.65).add(clamp(shadowOpticalDepth.mul(0.25), 0.0, 0.65))),
        0.0,
        0.94,
      )

      const baseAmbient = mix(bottomAmbientColor, topSkyAmbientColor, smoothstep(float(0.08), float(0.90), float(h)))
      const sculptedAmbient = mix(baseAmbient, stormCoreColor, coreDarkWeight)

      const directSun = litTopColor.mul(
        sunTrans.mul(powder).mul(float(1.0).sub(coreDarkWeight.mul(0.55))).add(edgeRimGlow.mul(0.92)),
      )
      const lightningGlow = vec3(0.68, 0.80, 1.0).mul(uLightning.mul(0.48))

      // 地平线远距大气透视融合（远端云团自然融入地平线散射天光）
      const aerialBlend = clamp(float(1.0).sub(exp(max(rayDist.sub(1.4), float(0.0)).mul(-0.24))), 0.0, 0.82)
      const localCloudCol = mix(sculptedAmbient.add(directSun).add(lightningGlow), skyBgRgb, aerialBlend)

      const stepExtinction = d.mul(0.38)
      const stepTrans = exp(stepExtinction.negate())
      const stepAlpha = float(1.0).sub(stepTrans)

      scatteredLight = vec3(scatteredLight as never).add(localCloudCol.mul(stepAlpha).mul(transmittance as never))
      transmittance = float(transmittance as never).mul(stepTrans)
    }
  }

  // ── 层级 2：中空高积云/层云层（6 步体积步进，1.85 倍海拔 + 异向风切变视差 + 太阳方向明暗） ──
  if (options.midClouds) {
    const midCovThresh = float(0.78).sub(uCoverage.mul(0.48))
    const midHeights = [0.12, 0.28, 0.45, 0.62, 0.78, 0.92]
    const midStormCore = mix(vec3(0.04, 0.05, 0.08), vec3(0.18, 0.21, 0.28).mul(vec3(uCloudTint as never)), dayFactor)
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
      const rawMidD = clamp(
        midField.mul(midProfile.mul(0.3).add(0.7)).sub(midCovThresh).div(max(float(1.0).sub(midCovThresh), float(0.18))),
        0.0,
        1.0,
      )
      const midDensity = rawMidD.mul(uDensity).mul(0.65).mul(horizonMask)

      const sMidSun = texture(cloudTex, midUV.add(sunDirXZ.mul(0.055))).r
      const midSunDepth = max(sMidSun.sub(midCovThresh), float(0.0)).mul(uShadow).mul(3.6)
      const midSunTrans = exp(midSunDepth.negate())
      const midEdgeRim = smoothstep(float(0.02), float(0.15), rawMidD).mul(smoothstep(float(0.55), float(0.18), rawMidD)).mul(uSilver)
      const midCoreDark = smoothstep(float(0.20), float(0.75), rawMidD.mul(uDensity)).mul(uShadow).mul(0.82)
      const midAmbient = mix(
        mix(bottomAmbientColor, topSkyAmbientColor, float(0.45 + h * 0.45)),
        midStormCore,
        midCoreDark,
      )
      const midDirect = litTopColor.mul(midSunTrans.mul(0.82).add(midEdgeRim.mul(float(0.45).add(phaseHG.mul(0.55)))))
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

// ── 通道 C：空中雨丝真屏幕空间折射合成（基于半分辨率 rainPass，在天空云与高度雾之后叠加） ─

export interface WeatherRainPassHandle {
  node: unknown
  sync: (picture: ScenePicture, camera: Camera) => void
}

export function buildWeatherRainPass(
  colorNode: unknown,
  scenePass: { getTextureNode: (name: string) => unknown },
  rainPass: { getTextureNode: (name: string) => unknown },
): WeatherRainPassHandle {
  const depthTex = scenePass.getTextureNode('depth') as {
    sample: (uv: unknown) => { r: unknown }
  }
  const beautyTex = scenePass.getTextureNode('output') as {
    sample: (uv: unknown) => { rgb: unknown }
  }
  const rainTex = rainPass.getTextureNode('output') as {
    sample: (uv: unknown) => { r: unknown; g: unknown; b: unknown; a: unknown }
  }

  // 在 rainRefractMat 的片元阶段注入当帧精确场景深度遮挡，被角色/墙体遮挡的雨丝直接归零
  if (rainRefractMat && rainMaskBaseNode) {
    const rainViewPos = cameraViewMatrix.mul(vec4(positionWorld, 1.0))
    const rainDist = rainViewPos.z.negate()
    const sceneD = depthTex.sample(screenUV).r
    const sceneViewPos = getViewPosition(screenUV, sceneD as never, uRainCamProjInv)
    const sceneDist = sceneViewPos.z.negate()
    const notBlocked = select(
      isBackgroundDepth(sceneD as never),
      float(1.0),
      smoothstep(float(-0.12), float(0.14), sceneDist.sub(rainDist)),
    )
    rainRefractMat.opacityNode = float(rainMaskBaseNode as never).mul(notBlocked) as never
    rainRefractMat.needsUpdate = true
  }

  const uRainVis = uniform(1.2)
  const uRainCol = uniform(new Color('#dce9f7'))

  const rainSample = rainTex.sample(screenUV)
  const posX = float(rainSample.r as never)
  const negX = float(rainSample.g as never)
  const headSpec = float(rainSample.b as never)
  const gradX = clamp(posX.sub(negX), -1.0, 1.0)
  const rainMask = clamp(posX.add(negX).mul(1.6).add(headSpec), 0.0, 1.0)

  const strength = clamp(uRainVis, 0.2, 3.0)
  // 真实屏幕空间凸透镜折射：仅在 rainMask > 0 的雨丝像素上沿圆柱横向斜率偏移采样背景，空白处 100% 零偏移
  const refractUV = clamp(
    screenUV.add(vec2(gradX.mul(0.024), headSpec.mul(-0.011)).mul(strength)),
    0.002,
    0.998,
  )
  const refractedDepth = depthTex.sample(refractUV).r
  const validRefract = select(isBackgroundDepth(refractedDepth as never), float(0.65), float(1.0))
  const deltaRefract = vec3(beautyTex.sample(refractUV).rgb as never).sub(
    vec3(beautyTex.sample(screenUV).rgb as never),
  )

  const base = colorNode as { rgb: unknown; a: unknown }
  const refractedRgb = vec3(base.rgb as never).add(
    deltaRefract.mul(rainMask).mul(validRefract).mul(clamp(strength, 0.5, 1.8)),
  )

  // 圆柱水丝全内反射边缘对比 + 底部水珠折射微光（绝非死白线）
  const rimDarken = clamp(abs(gradX).mul(0.28).mul(strength), 0.0, 0.36).mul(rainMask)
  const headGlint = vec3(uRainCol as never).mul(headSpec.mul(0.28).mul(strength).mul(rainMask))

  const finalRgb = refractedRgb.mul(float(1.0).sub(rimDarken)).add(headGlint)
  return {
    node: vec4(finalRgb, base.a as never),
    sync: (picture: ScenePicture, camera: Camera) => {
      const s = currentSettings(picture)
      uRainCamProjInv.value.copy(camera.projectionMatrixInverse)
      uRainVis.value = s.rainStreakIntensity
      uRainCol.value.set(s.precipitationColor)
    },
  }
}
