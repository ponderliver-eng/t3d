import { Color, DoubleSide, Object3D, Texture, Vector2, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  length,
  linearDepth,
  max,
  min,
  mix,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  reflector,
  screenUV,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportLinearDepth,
  viewportSharedTexture,
} from 'three/tsl'
import type { WaterSpec } from './defaults'
import { defaultWaterCausticsTexture, defaultWaterFoamTexture, defaultWaterNormalTexture } from './proceduralTextures'

export interface WaterMaterialOptions {
  /** 是否开启真实平面反射（关闭时不创建 reflector，真正省掉整趟离屏反射渲染）。 */
  planar: boolean
  /** 是否开启屏幕空间折射与水底采样。 */
  refraction: boolean
  /** 是否开启浅水焦散光斑。 */
  caustics: boolean
  /** 是否使用 4 层高细节法线（关闭时降为 2 层以节省纹理采样）。 */
  highDetail: boolean
  /** 顶点波浪位移的局部轴：自带旋转 -90° 的平面用 'z'，普通未旋转模型用 'y'。 */
  upAxis: 'y' | 'z'
  /** 是否有大浪（关闭时整段波谱、挤压值与浪峰泡沫都不进着色器）。 */
  waves: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TslNode = any

interface WaveDef {
  /** 波长 (m)。 */
  length: number
  /** 相对主风向的偏角 (度)。 */
  angle: number
  /** 占浪高的比例。 */
  weight: number
  /** 该波可占用的水平压缩份额（所有顶点波之和必须 < 1）。 */
  share: number
  phase: number
}

const GRAVITY = 9.81
/** 多道波很少同相叠加，整体补偿一点振幅，让「浪高」参数的观感与之前接近。 */
const AMP_GAIN = 1.25
const PINCH_GAIN = 2.2

/**
 * 位移顶点的长波。波长两两接近（41/33、22/17），靠自然拍频形成一组一组的涌浪，
 * 方向围绕主风向散开，越短的波散得越开，浪脊因此自然断成段。速度按深水色散 ω = √(g·k)。
 */
const VERTEX_WAVES: WaveDef[] = [
  { length: 41, angle: -8, weight: 0.26, share: 0.10, phase: 0.0 },
  { length: 33, angle: 7, weight: 0.22, share: 0.11, phase: 1.7 },
  { length: 22, angle: -19, weight: 0.17, share: 0.14, phase: 4.1 },
  { length: 17, angle: 16, weight: 0.14, share: 0.15, phase: 2.9 },
  { length: 11, angle: -31, weight: 0.12, share: 0.19, phase: 5.3 },
  { length: 7.5, angle: 27, weight: 0.09, share: 0.21, phase: 0.8 },
]

/** 只在片元里参与法线与泡沫的短波，填补顶点长波与法线贴图之间的尺度空档。 */
const DETAIL_WAVES: WaveDef[] = [
  { length: 4.9, angle: -44, weight: 0.055, share: 0, phase: 3.6 },
  { length: 3.3, angle: 39, weight: 0.038, share: 0, phase: 1.1 },
  { length: 2.2, angle: -58, weight: 0.026, share: 0, phase: 5.9 },
  { length: 1.5, angle: 12, weight: 0.018, share: 0, phase: 2.4 },
]

/** 泡沫拖尾回看：time 为回看秒数（再乘「泡沫拖尾」参数），keep 为那一刻泡沫剩余的比例。 */
const FOAM_TRAIL_TAPS = [
  { time: 0.45, keep: 0.85 },
  { time: 0.9, keep: 0.65 },
  { time: 1.4, keep: 0.45 },
  { time: 2.0, keep: 0.25 },
]

/** 参与生成浪峰泡沫的长波数量（取 VERTEX_WAVES 前几道，方向都在主风向 ±20° 内）。 */
const BREAKER_WAVE_COUNT = 4
/** 浪群移动速度 (m/s)，约为主要长波浪峰速度的一半。 */
const GROUP_SPEED = 3.4

const DEBUG_VIEW_INDEX: Record<WaterSpec['debugView'], number> = { off: 0, height: 1, squeeze: 2, foam: 3 }

export interface WaterMaterialHandle {
  variantKey: string
  material: MeshBasicNodeMaterial
  reflectionTarget: Object3D | null
  setSpec: (spec: WaterSpec, customNormal: Texture | null, customFoam: Texture | null) => void
  setTime: (time: number, waveTime: number) => void
  setInvScale: (worldScale: Vector3) => void
  setSun: (direction: Vector3, color: Color, intensity: number, skyHorizon?: Color, skyTop?: Color) => void
  dispose: () => void
}

export function waterVariantKey(opts: WaterMaterialOptions): string {
  return `${opts.planar ? 1 : 0}|${opts.refraction ? 1 : 0}|${opts.caustics ? 1 : 0}|${opts.highDetail ? 1 : 0}|${opts.upAxis}|${opts.waves ? 1 : 0}`
}

export function createWaterMaterial(options: WaterMaterialOptions): WaterMaterialHandle {
  const defaultNormal = defaultWaterNormalTexture()
  const defaultFoam = defaultWaterFoamTexture()
  const defaultCaustics = defaultWaterCausticsTexture()

  const uTime = uniform(0)
  const uWaveTime = uniform(0)
  const uInvScale = uniform(new Vector3(1, 1, 1))
  const uShallowColor = uniform(new Color('#14b8a6'))
  const uDeepColor = uniform(new Color('#063354'))
  const uFoamColor = uniform(new Color('#f8fafc'))
  const uSunColor = uniform(new Color('#fff7e0'))
  const uSkyTopColor = uniform(new Color('#7dd3fc'))
  const uSkyHorizonColor = uniform(new Color('#e0f2fe'))
  const uSunDir = uniform(new Vector3(0.45, 0.72, 0.52).normalize())

  const uDepthAbsorption = uniform(2.8)
  const uOpacity = uniform(0.25)
  const uNormalScale = uniform(0.38)
  const uWaveScale = uniform(0.24)
  const uFlowDir = uniform(new Vector2(0.85, 0.52))
  const uFlowSpeed = uniform(0.45)
  const uFresnelPower = uniform(5.0)
  const uReflectivity = uniform(0.92)
  const uSpecularStrength = uniform(2.2)
  const uSpecularSize = uniform(0.24)
  const uSssStrength = uniform(0.45)
  const uFoamWidth = uniform(0.28)
  const uFoamIntensity = uniform(0.9)
  const uCrestFoam = uniform(0.65)
  const uCrestFoamThreshold = uniform(0.42)
  const uShoreFoamOn = uniform(1)
  const uSoftEdge = uniform(0.08)
  const uCausticsStrength = uniform(0.7)
  const uCausticsScale = uniform(0.22)
  const uWaveHeight = uniform(0)
  const uWaveSteepness = uniform(0.65)
  const uFoamTrail = uniform(1)
  const uDebugView = uniform(0)

  const normalTexNode = texture(defaultNormal)
  const foamTexNode = texture(defaultFoam)
  const causticsTexNode = texture(defaultCaustics)

  // 视距抗锯齿衰减（远景逐步平滑高频碎波法线，消除低角度像素闪烁噪点）
  const worldToEye = cameraPosition.sub(positionWorld)
  const eyeDist = length(worldToEye)
  const viewVec = normalize(worldToEye)
  const highFreqFade = float(1.0).sub(smoothstep(float(18.0), float(110.0), eyeDist))

  // 1. 波谱：所有波的相位都基于「未位移」的静止世界坐标，顶点与片元严格一致
  const restVertexXZ = modelWorldMatrix.mul(vec4(positionGeometry, 1.0)).xz
  const surfXZ = varying(restVertexXZ)

  const rotatedDir = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    return vec2(uFlowDir.x.mul(c).sub(uFlowDir.y.mul(s)), uFlowDir.x.mul(s).add(uFlowDir.y.mul(c)))
  }

  // 与位置无关的每道波常量（方向、振幅、水平聚拢量），顶点/片元共用
  const vertexWaves = VERTEX_WAVES.map(def => {
    const k = (Math.PI * 2) / def.length
    const amp = uWaveHeight.mul(def.weight * AMP_GAIN)
    // 雅可比限幅：每道波的 k·Q 不超过自己的份额，份额总和 0.9 < 1，保证永不自交
    const pinch = min(amp.mul(PINCH_GAIN), float(def.share / k))
    return { def, k, omega: Math.sqrt(GRAVITY * k), dir: rotatedDir(def.angle), amp, pinch, foamWeight: pinch.mul(k) }
  })
  const detailWaves = (options.highDetail ? DETAIL_WAVES : DETAIL_WAVES.slice(0, 2)).map(def => {
    const k = (Math.PI * 2) / def.length
    const amp = uWaveHeight.mul(def.weight * AMP_GAIN)
    // 短波只在片元里算，远处按波长淡出防闪烁
    const fade = float(1.0).sub(smoothstep(float(def.length * 30), float(def.length * 110), eyeDist))
    return { def, k, omega: Math.sqrt(GRAVITY * k), dir: rotatedDir(def.angle), amp, fade, foamWeight: min(amp.mul(PINCH_GAIN * k), float(0.18)).mul(fade) }
  })

  let displacedLocal: TslNode = positionLocal
  let waveSlope: TslNode = vec2(0.0, 0.0)
  let macroSlope: TslNode = vec2(0.0, 0.0)
  let waveCompress: TslNode = float(0.0)
  let waveNorm: TslNode = float(0.0)
  let squeezeNow: TslNode = float(0.0)
  let crestField: TslNode = float(0.0)
  let crestActive: TslNode = float(0.0)

  if (options.waves) {
    // 顶点阶段：长波位移（高度 + Gerstner 水平聚拢）
    let vHeight: TslNode = float(0.0)
    let vHoriz: TslNode = vec2(0.0, 0.0)
    for (const wave of vertexWaves) {
      const theta = dot(restVertexXZ, wave.dir).mul(wave.k).add(wave.def.phase).sub(uWaveTime.mul(wave.omega))
      vHeight = vHeight.add(sin(theta).mul(wave.amp))
      vHoriz = vHoriz.add(wave.dir.mul(cos(theta).mul(wave.pinch).mul(uWaveSteepness)))
    }
    // 用节点世界缩放的倒数把世界米数转回局部坐标，确保任意 scale 下都不撕裂
    displacedLocal = options.upAxis === 'z'
      ? vec3(
        positionLocal.x.add(vHoriz.x.mul(uInvScale.x)),
        positionLocal.y.sub(vHoriz.y.mul(uInvScale.z)),
        positionLocal.z.add(vHeight.mul(uInvScale.y)),
      )
      : vec3(
        positionLocal.x.add(vHoriz.x.mul(uInvScale.x)),
        positionLocal.y.add(vHeight.mul(uInvScale.y)),
        positionLocal.z.add(vHoriz.y.mul(uInvScale.z)),
      )

    // 片元阶段：逐像素解析法线（长波 + 只参与着色的短波）
    const vertexBase = vertexWaves.map(wave => dot(surfXZ, wave.dir).mul(wave.k).add(wave.def.phase))
    const detailBase = detailWaves.map(wave => dot(surfXZ, wave.dir).mul(wave.k).add(wave.def.phase))
    let vertexFoamWeight: TslNode = float(0.0)
    vertexWaves.forEach((wave, i) => {
      const theta = vertexBase[i].sub(uWaveTime.mul(wave.omega))
      const s = sin(theta)
      const slope = wave.dir.mul(cos(theta).mul(wave.amp).mul(wave.k))
      macroSlope = macroSlope.add(slope)
      waveCompress = waveCompress.add(s.mul(wave.pinch).mul(wave.k).mul(uWaveSteepness))
      waveNorm = waveNorm.add(s.mul(wave.def.weight))
      vertexFoamWeight = vertexFoamWeight.add(wave.foamWeight)
    })
    waveSlope = macroSlope
    detailWaves.forEach((wave, i) => {
      const theta = detailBase[i].sub(uWaveTime.mul(wave.omega))
      waveSlope = waveSlope.add(wave.dir.mul(cos(theta).mul(wave.amp).mul(wave.k).mul(wave.fade)))
    })
    // 破碎浪场：只取方向接近主风向的几道长波（短波、斜向波会把泡沫打散成碎点）。
    // 方向相近的长波叠加出的峰是「沿浪脊拉得很长」的带状区域，泡沫才会聚成一长条。
    // lookBack > 0 时回看过去某一刻同一块水面，用来生成浪峰走过后留在身后的拖尾。
    const breakerWeightSum = vertexWaves.slice(0, BREAKER_WAVE_COUNT).reduce((sum, wave) => sum + wave.def.weight, 0)
    const squeezeAt = (lookBack: number): TslNode => {
      const time = lookBack > 0 ? uWaveTime.sub(uFoamTrail.mul(lookBack)) : uWaveTime
      let acc: TslNode = float(0.0)
      vertexWaves.slice(0, BREAKER_WAVE_COUNT).forEach((wave, i) => {
        acc = acc.add(sin(vertexBase[i].sub(time.mul(wave.omega))).mul(wave.def.weight / breakerWeightSum))
      })
      return acc
    }

    // 破碎包络：两层十几米尺度的噪波朝不同方向漂移，叠出「此起彼伏」的破碎区。
    // 它不是乘在泡沫上，而是直接加到浪峰值里再过阈值：同一道浪脊只有一段段会破碎，
    // 每段持续几秒后随包络移走而消散，边缘也跟着噪波变得不规则。
    const flowOrthoDir = vec2(uFlowDir.y.negate(), uFlowDir.x)
    const envA = foamTexNode.sample(surfXZ.mul(0.011).sub(uFlowDir.mul(uWaveTime.mul(0.021)))).g
    const envB = foamTexNode.sample(surfXZ.mul(0.017).add(flowOrthoDir.mul(uWaveTime.mul(0.027))).add(uFlowDir.mul(uWaveTime.mul(0.012)))).g
    const edgeNoise = envA.mul(0.55).add(envB.mul(0.45)).sub(0.5).mul(0.8)

    // 浪群包络：一块块「浪正在涨起来」的区域，以群速度（约为浪峰速度的一半）顺风移动。
    // 浪峰比浪群快，所以每道浪峰追上一个浪群时涨起并起沫，穿过去之后回落、泡沫随拖尾慢慢散掉，
    // 而不是一条白线跟着浪峰走到头。
    const alongWind = dot(surfXZ, uFlowDir)
    const acrossWind = dot(surfXZ, flowOrthoDir)
    const groupAt = (lookBack: number): TslNode => {
      const time = lookBack > 0 ? uWaveTime.sub(uFoamTrail.mul(lookBack)) : uWaveTime
      const u = alongWind.sub(time.mul(GROUP_SPEED))
      const e1 = sin(u.mul(0.224).add(sin(acrossWind.mul(0.114)).mul(1.7)))
      // 横向（沿浪脊方向）尺度约为顺风方向的 3 倍：破碎段是沿浪脊拉开的长条，而不是圆团
      const e2 = sin(acrossWind.mul(0.07).add(sin(u.mul(0.09)).mul(1.1)).add(time.mul(0.15)))
      return e1.mul(e2).mul(0.5).sub(0.2)
    }

    squeezeNow = squeezeAt(0).add(groupAt(0)).add(edgeNoise)
    // 过渡区间拉宽到 0.6：遮罩从边缘到核心是一段很长的缓坡，而不是窄窄一圈
    const crestStart = mix(float(0.0), float(0.6), clamp(uCrestFoamThreshold, float(0.0), float(1.0)))
    const crestEnd = crestStart.add(0.6)
    crestField = smoothstep(crestStart, crestEnd, squeezeNow)
    const taps = options.highDetail ? FOAM_TRAIL_TAPS : FOAM_TRAIL_TAPS.slice(0, 3)
    taps.forEach((tap, i) => {
      const past = squeezeAt(tap.time).add(groupAt(tap.time)).add(edgeNoise)
      const aged = smoothstep(crestStart.sub(0.03 * (i + 1)), crestEnd, past).mul(tap.keep)
      crestField = max(crestField, aged)
    })
    // 浪太平缓时不产生白沫（平静湖面不该有浪花）
    crestActive = smoothstep(float(0.03), float(0.2), vertexFoamWeight)
  }

  // 2. 多向流动法线（highDetail 时 4 层精细叠加，轻量模式下 2 层省采样）
  const baseUv = surfXZ.mul(uWaveScale)
  const flow = uFlowDir.mul(uTime.mul(uFlowSpeed.mul(0.05)))
  const flowOrtho = vec2(uFlowDir.y.negate(), uFlowDir.x).mul(uTime.mul(uFlowSpeed.mul(0.038)))

  const n1 = normalTexNode.sample(baseUv.mul(0.37).add(flow.mul(0.7))).xyz.mul(2.0).sub(1.0)
  const n2 = normalTexNode.sample(baseUv.mul(0.91).sub(flowOrtho.mul(0.9))).xyz.mul(2.0).sub(1.0)
  let nAvg = n1.mul(0.54).add(n2.mul(0.46).mul(float(0.35).add(highFreqFade.mul(0.65))))
  let nCrisp = n2.mul(float(0.3).add(highFreqFade.mul(0.7)))
  if (options.highDetail) {
    const n3 = normalTexNode.sample(baseUv.mul(2.13).add(flow.mul(1.3).add(flowOrtho.mul(0.4)))).xyz.mul(2.0).sub(1.0)
    const n4 = normalTexNode.sample(baseUv.mul(4.71).sub(flow.mul(0.8).sub(flowOrtho.mul(1.2)))).xyz.mul(2.0).sub(1.0)
    const detail = n3.mul(0.24).add(n4.mul(0.16)).mul(highFreqFade)
    nAvg = n1.mul(0.32).add(n2.mul(0.28)).add(detail)
    nCrisp = n2.mul(0.25).add(n3.mul(0.4).add(n4.mul(0.35)).mul(highFreqFade))
  }

  // Gerstner 解析法线：浪峰处竖直分量被压缩（1 - Σk·Q·sin），浪脊自然变尖、浪谷变平
  const crestPinchY = max(float(1.0).sub(waveCompress), float(0.15))
  const surfaceNormal = normalize(vec3(
    nAvg.x.mul(uNormalScale).sub(waveSlope.x.mul(1.2)),
    crestPinchY,
    nAvg.y.mul(uNormalScale).sub(waveSlope.y.mul(1.2)),
  ))
  const waveMacroNormal = normalize(vec3(
    macroSlope.x.negate().mul(1.6),
    crestPinchY,
    macroSlope.y.negate().mul(1.6),
  ))
  const crispNormal = normalize(vec3(
    nCrisp.x.mul(uNormalScale).mul(1.45).sub(waveSlope.x.mul(1.2)),
    crestPinchY,
    nCrisp.y.mul(uNormalScale).mul(1.45).sub(waveSlope.y.mul(1.2)),
  ))

  // 3. 视线与 Schlick 菲涅尔
  const nDotV = max(dot(surfaceNormal, viewVec), float(0.001))
  const rf0 = float(0.025)
  const fresnel = clamp(
    pow(float(1.0).sub(nDotV), uFresnelPower).mul(float(1.0).sub(rf0)).add(rf0).mul(uReflectivity),
    float(0.0),
    float(1.0),
  )

  // 4. 反射：仅当 planar === true 时创建 reflector(bounces: false)；否则使用太阳仰角 + 背景色天空渐变
  const distortion = surfaceNormal.xz.mul(float(0.008).add(float(0.18).div(max(eyeDist, float(1.0))))).mul(uNormalScale)
  const reflDir = normalize(reflect(viewVec.negate(), surfaceNormal))
  const skyGrad = smoothstep(float(0.0), float(0.5), max(reflDir.y, float(0.0)))
  const fallbackReflection = mix(uSkyHorizonColor, uSkyTopColor, skyGrad)

  let reflectionTarget: Object3D | null = null
  let mirrorReflector: ReturnType<typeof reflector> | null = null
  let reflectionColor = fallbackReflection
  if (options.planar) {
    mirrorReflector = reflector({ resolutionScale: 0.5, bounces: false })
    if (mirrorReflector.uvNode) {
      mirrorReflector.uvNode = clamp(mirrorReflector.uvNode.add(distortion) as never, vec2(0.002, 0.002), vec2(0.998, 0.998))
    }
    reflectionTarget = mirrorReflector.target
    reflectionColor = mirrorReflector.rgb
  }

  // 5. 垂直水深修正：仅在开启 refraction（具备屏幕深度采样）时读取 viewportLinearDepth，关闭折射时彻底解耦深度拷贝
  const depthScale = cameraFar.sub(cameraNear)
  let waterDepth = max(uDepthAbsorption, float(2.0))
  if (options.refraction) {
    const bgLinear = viewportLinearDepth
    const hasBed = bgLinear.lessThan(float(0.999))
    const rawRayDepth = max(bgLinear.sub(linearDepth()).mul(depthScale), float(0.0))
    const rayWaterDepth = select(hasBed, rawRayDepth, float(20.0))
    const verticalFactor = clamp(abs(viewVec.y).mul(1.15).add(0.22), float(0.22), float(1.0))
    waterDepth = rayWaterDepth.mul(verticalFactor)
  }
  const absorb = float(1.0).sub(exp(waterDepth.negate().div(max(uDepthAbsorption, float(0.1)))))
  const waterTint = mix(uShallowColor, uDeepColor, clamp(absorb, float(0.0), float(1.0)))

  let refractedBody = waterTint
  if (options.refraction) {
    // 浅岸处平滑收小折射偏移，防止贴岸边缘产生水底畸变撕裂
    const depthRefractFade = clamp(waterDepth.mul(1.6), float(0.0), float(1.0))
    const refractUv = clamp(screenUV.add(distortion.mul(0.6).mul(depthRefractFade)), vec2(0.002, 0.002), vec2(0.998, 0.998))
    const refractDepth = linearDepth(viewportDepthTexture(refractUv)).sub(linearDepth()).mul(depthScale)
    const safeRefractUv = select(refractDepth.greaterThan(float(0.0)), refractUv, screenUV)
    let underWaterColor = viewportSharedTexture(safeRefractUv).rgb

    if (options.caustics) {
      const causticsCoord = positionWorld.xz.add(surfaceNormal.xz.mul(clamp(waterDepth.mul(0.22), float(0.0), float(0.8))))
      const cUv1 = causticsCoord.mul(uCausticsScale).add(flow.mul(0.85))
      const cUv2 = causticsCoord.mul(uCausticsScale.mul(1.37)).sub(flowOrtho.mul(1.15))
      const c1 = causticsTexNode.sample(cUv1).r
      const c2 = causticsTexNode.sample(cUv2).r
      const causticMask = min(c1, c2).mul(1.6).add(c1.mul(c2)).mul(0.55)
      const shallowFade = exp(waterDepth.negate().mul(0.45)).mul(smoothstep(float(0.0), float(0.18), waterDepth))
      underWaterColor = underWaterColor.add(uSunColor.mul(causticMask).mul(shallowFade).mul(uCausticsStrength))
    }

    const transmit = clamp(float(1.0).sub(absorb).mul(float(1.0).sub(uOpacity.mul(0.55))), float(0.0), float(1.0))
    refractedBody = mix(waterTint, underWaterColor.mul(mix(vec3(1.0), uShallowColor, float(0.42))), transmit)
  }

  // 6. 岸边软过渡（仅在开启折射/深度采样时羽化）+ 周期性拍岸浪花
  const edgeOpacity = options.refraction
    ? select(
      uSoftEdge.greaterThan(float(0.002)),
      smoothstep(float(0.0), max(uSoftEdge, float(0.005)), waterDepth),
      float(1.0),
    )
    : float(1.0)
  const finalAlpha = options.refraction ? edgeOpacity : clamp(uOpacity.add(0.25), float(0.35), float(1.0))

  // 双层海沫：R 通道是 512px 絮状多尺度气泡网丝，G 通道是门控噪波
  const foamSampleA = foamTexNode.sample(baseUv.mul(1.85).add(flow.mul(1.25)))
  const foamSampleB = foamTexNode.sample(baseUv.mul(4.1).sub(flowOrtho.mul(1.45)))
  const foamWeb = foamSampleA.r.mul(0.62).add(foamSampleB.r.mul(0.38))
  const foamErode = foamSampleA.g.mul(0.55).add(foamSampleB.g.mul(0.45))

  const shoreRatio = clamp(waterDepth.div(max(uFoamWidth, float(0.01))), float(0.0), float(1.0))
  const shoreBase = float(1.0).sub(smoothstep(float(0.0), max(uFoamWidth, float(0.01)), waterDepth))
  const lapRipple = sin(shoreRatio.mul(12.0).sub(uTime.mul(2.2))).mul(0.5).add(0.5)
  const shoreBand = shoreBase.mul(float(0.62).add(lapRipple.mul(0.38))).mul(uShoreFoamOn)

  // 浪峰泡沫：由「挤压值 + 拖尾」得到的遮罩，再用大尺度错速噪波打断成一段一段
  let crestBand: TslNode = float(0.0)
  if (options.waves) {
    crestBand = crestField.mul(crestActive).mul(uCrestFoam)
  }

  const foamMask = clamp(max(shoreBand, crestBand), float(0.0), float(1.0))
  // 米级的大尺度絮状层：让泡沫先有「一团团云絮」的结构，细丝只是叠在上面的细节，避免满屏等大的颗粒点
  const foamCloud = foamTexNode.sample(surfXZ.mul(0.07).add(flow.mul(0.4))).r
  const detail = foamCloud.mul(0.4).add(foamWeb.mul(0.45)).add(foamErode.mul(0.15))
  // 线性叠加而不是阈值切割：遮罩 = 1 时整片发白（浪脊核心），0.5 时原样露出柔和的絮状纹理，
  // 0.3 以下只剩最亮的几缕并且是半透明的，全程没有硬边
  const foamBody = clamp(detail.mul(1.1).add(foamMask.mul(1.9)).sub(1.0), float(0.0), float(1.0))
  const foamAlpha = clamp(
    foamBody.mul(smoothstep(float(0.0), float(0.2), foamMask)).mul(uFoamIntensity).mul(1.2),
    float(0.0),
    float(1.0),
  )

  // 7. 太阳碎金高光（高光也吃远景防闪烁淡出）+ 大浪坡面体积明暗 + 三段式翡翠透光 SSS
  const sunDir = normalize(uSunDir)
  const sunSlope = max(dot(waveMacroNormal, sunDir), float(0.0))
  const waveShade = mix(float(0.68), float(1.18), sunSlope)
  const sunRefl = normalize(reflect(sunDir.negate(), crispNormal))
  const specDot = max(dot(viewVec, sunRefl), float(0.0))
  const specPower = mix(float(2200.0), float(120.0), clamp(uSpecularSize, float(0.0), float(1.0)))
  const specGain = mix(float(3.2), float(1.1), clamp(uSpecularSize, float(0.0), float(1.0)))
  const sunSparkle = pow(specDot, specPower).mul(uSpecularStrength).mul(specGain).mul(float(0.35).add(highFreqFade.mul(0.65)))
  // 波腰到波顶（浪体较薄区）叠加透光翡翠青，波谷保持深蓝，形成“深蓝 -> 翡翠青 -> 白沫”三段立体层次
  const waveUpperMask = smoothstep(float(0.05), float(0.72), waveNorm).mul(smoothstep(float(0.01), float(0.08), uWaveHeight))
  const viewSss = pow(max(dot(viewVec, sunDir.negate()), float(0.0)), float(4.0)).mul(0.65).add(0.35)
  const sssFactor = waveUpperMask.mul(viewSss).mul(max(float(1.0).sub(nDotV.mul(0.65)), float(0.25))).mul(uSssStrength)
  const sssColor = mix(uShallowColor, vec3(0.22, 0.92, 0.86), float(0.35)).mul(sssFactor).mul(0.68)

  // 8. 最终合成（波浪迎光亮背光暗 + 泡沫底部微暗边增加漂浮厚度感）
  const litBody = refractedBody.mul(waveShade).add(sssColor)
  const waterSurface = mix(litBody, reflectionColor, fresnel).add(uSunColor.mul(sunSparkle))
  const foamShadow = smoothstep(float(0.05), float(0.35), foamAlpha).mul(float(1.0).sub(foamAlpha))
  const shadedWater = waterSurface.mul(float(1.0).sub(foamShadow.mul(0.18)))
  const finalColor = mix(shadedWater, uFoamColor, foamAlpha)

  // 调试视图：1 = 波高（灰度），2 = 挤压值（红 = 被压缩的浪峰，蓝 = 被拉伸的浪谷），3 = 泡沫遮罩（未叠贴图）
  const debugHeight = vec3(clamp(waveNorm.mul(0.5).add(0.5), float(0.0), float(1.0)))
  const debugSqueeze = vec3(
    clamp(squeezeNow, float(0.0), float(1.0)),
    float(0.0),
    clamp(squeezeNow.negate(), float(0.0), float(1.0)),
  )
  const debugFoam = vec3(foamMask)
  const debugColor = select(
    uDebugView.lessThan(float(1.5)),
    debugHeight,
    select(uDebugView.lessThan(float(2.5)), debugSqueeze, debugFoam),
  )
  const debugOn = uDebugView.greaterThan(float(0.5))

  const material = new MeshBasicNodeMaterial()
  if (options.waves) material.positionNode = displacedLocal
  material.colorNode = select(debugOn, debugColor, finalColor)
  material.opacityNode = select(debugOn, float(1.0), max(finalAlpha, foamAlpha))
  material.transparent = true
  material.depthWrite = false
  material.side = DoubleSide

  return {
    variantKey: waterVariantKey(options),
    material,
    reflectionTarget,
    setSpec(spec, customNormal, customFoam) {
      uShallowColor.value.set(spec.shallowColor)
      uDeepColor.value.set(spec.deepColor)
      uFoamColor.value.set(spec.foamColor)
      uSunColor.value.set(spec.sunColor)
      uDepthAbsorption.value = spec.depthAbsorption
      uOpacity.value = spec.opacity
      uNormalScale.value = spec.normalScale
      uWaveScale.value = spec.waveScale
      uFlowSpeed.value = spec.flowSpeed
      const rad = (spec.flowDirection * Math.PI) / 180
      uFlowDir.value.set(Math.cos(rad), Math.sin(rad))
      uFresnelPower.value = spec.fresnelPower
      uReflectivity.value = spec.reflectivity
      uSpecularStrength.value = spec.specularStrength
      uSpecularSize.value = spec.specularSize
      uSssStrength.value = spec.sssStrength
      uFoamWidth.value = spec.foamWidth
      uFoamIntensity.value = spec.foamIntensity
      uCrestFoam.value = spec.crestFoam
      uCrestFoamThreshold.value = spec.crestFoamThreshold
      uShoreFoamOn.value = spec.shoreFoam ? 1 : 0
      uSoftEdge.value = spec.softEdge
      uCausticsStrength.value = spec.causticsStrength
      uCausticsScale.value = spec.causticsScale
      uWaveHeight.value = spec.quality === 'fast' ? 0 : spec.waveHeight
      uWaveSteepness.value = spec.quality === 'fast' ? 0 : spec.waveSteepness
      uFoamTrail.value = spec.foamTrail
      uDebugView.value = DEBUG_VIEW_INDEX[spec.debugView]
      if (mirrorReflector) {
        mirrorReflector.reflector.resolutionScale = Math.max(0.25, spec.reflectionScale)
      }
      normalTexNode.value = customNormal ?? defaultNormal
      foamTexNode.value = customFoam ?? defaultFoam
    },
    setTime(time, waveTime) {
      uTime.value = time
      uWaveTime.value = waveTime
    },
    setInvScale(worldScale) {
      uInvScale.value.set(
        1 / Math.max(0.001, Math.abs(worldScale.x)),
        1 / Math.max(0.001, Math.abs(worldScale.y)),
        1 / Math.max(0.001, Math.abs(worldScale.z)),
      )
    },
    setSun(direction, color, intensity, skyHorizon, skyTop) {
      uSunDir.value.copy(direction).normalize()
      const boost = Math.min(2.0, Math.max(0.2, intensity))
      uSunColor.value.copy(color).multiplyScalar(boost)
      if (skyHorizon) uSkyHorizonColor.value.copy(skyHorizon)
      if (skyTop) uSkyTopColor.value.copy(skyTop)
    },
    dispose() {
      material.dispose()
    },
  }
}
