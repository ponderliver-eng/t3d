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
  frontFacing,
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
import {
  AMP_GAIN,
  BEND_PRIMARY,
  BEND_SECONDARY,
  CREST_ROUND,
  CURL_GAIN,
  DETAIL_WAVES,
  GRAVITY,
  LEAN_GAIN,
  MID_WAVE_COUNT,
  PACKET_SKEW,
  PINCH_GAIN,
  SWELL_GROUPS,
  VERTEX_WAVES,
  swellGroupInfo,
} from './waves'

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
  /** 极致档波形：浪脊弯曲用两层扰动，并把 3 ~ 5 米的中尺度波也加入顶点位移。 */
  richWaves: boolean
  /**
   * 跟随相机的近密远疏网格（大水面用）：几何体的 xy 是相对网格中心的米数，z 是该顶点处的格子大小，
   * 顶点在着色器里换算回水面局部坐标并收在水面范围内。只支持 upAxis = 'z' 的自带平面。
   */
  followGrid: boolean
}

/**
 * 跟随网格的形状参数（session 用它生成几何体）。
 * 每条轴上的坐标由若干段等间距组成，越往外间距越大（每段翻倍），两条轴做乘积得到整张网格，天然没有裂缝。
 * 网格不是连续跟着相机滑动，而是每次整体挪 snap 米：间距不超过 snap 的顶点挪完后正好落在原来就有顶点的位置上，
 * 所以相机移动、旋转时它们在世界里的位置不变，浪不会跟着镜头抖。
 */
export const FOLLOW_GRID = {
  /** 网格整体对齐的步长 (m)，必须是 bands 里各个间距的整数倍。 */
  snap: 4,
  /** 从中心往外的各段：[间距 (m), 格数]。 */
  bands: [[0.25, 28], [0.5, 16], [1, 16], [2, 16], [4, 12]] as Array<[number, number]>,
  /** 再往外每格间距翻倍的格数（远处只需要铺满，不需要细节）。 */
  doublingSteps: 9,
  /** 最外一圈极远的顶点，着色器把它收到水面边界上。 */
  farRadius: 100000,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TslNode = any

/**
 * 压缩份额预算：长波 0.72 + 中尺度波 0.08 = 0.80。
 * 包络放大上限 1.1、浪脊弯曲带来的顺波向相位梯度上限约 1.1，0.80 × 1.1 × 1.1 < 1，所以聚拢本身永不自交。
 * 「浪尖卷曲」的水平位移不在这个预算内：调大后，几道大浪同相叠加的地方允许前脸翻过去（那正是钩形）。
 */

/**
 * 短波，填补顶点长波与法线贴图之间的尺度空档。默认只在片元里参与法线与泡沫；
 * 极致档把前两道（MID_WAVE_COUNT）也加入顶点位移，让近处的浪体轮廓有中尺度起伏。
 */

/** 泡沫拖尾回看：time 为回看秒数（再乘「泡沫拖尾」参数），keep 为那一刻泡沫剩余的比例。 */
const FOAM_TRAIL_TAPS = [
  { time: 0.45, keep: 0.85 },
  { time: 0.9, keep: 0.65 },
  { time: 1.4, keep: 0.45 },
  { time: 2.0, keep: 0.25 },
]

/** 多道不同方向的波很少同时到峰值，实际浪尖的归一化高度约 0.5 ~ 0.75，乘此系数后浪尖接近 1。 */
const CREST_GAIN = 1.4

const DEBUG_VIEW_INDEX: Record<WaterSpec['debugView'], number> = { off: 0, height: 1, squeeze: 2, foam: 3 }

export interface WaterMaterialHandle {
  variantKey: string
  material: MeshBasicNodeMaterial
  reflectionTarget: Object3D | null
  setSpec: (spec: WaterSpec, customNormal: Texture | null, customFoam: Texture | null) => void
  setTime: (time: number, waveTime: number, swellTime: number) => void
  setInvScale: (worldScale: Vector3) => void
  /** 网格一格的世界尺寸 (m)；采样不足的波会在顶点位移里淡出。未知时传 0。 */
  setCellSize: (meters: number) => void
  /** 跟随网格的中心：水面网格局部坐标系里的 xy（调用方负责按 FOLLOW_GRID.snap 对齐）。 */
  setGridCenter: (localX: number, localY: number) => void
  setSun: (direction: Vector3, color: Color, intensity: number, skyHorizon?: Color, skyTop?: Color) => void
  dispose: () => void
}

export function waterVariantKey(opts: WaterMaterialOptions): string {
  return `${opts.planar ? 1 : 0}|${opts.refraction ? 1 : 0}|${opts.caustics ? 1 : 0}|${opts.highDetail ? 1 : 0}|${opts.upAxis}|${opts.waves ? 1 : 0}|${opts.richWaves ? 1 : 0}|${opts.followGrid ? 1 : 0}`
}

export function createWaterMaterial(options: WaterMaterialOptions): WaterMaterialHandle {
  const defaultNormal = defaultWaterNormalTexture()
  const defaultFoam = defaultWaterFoamTexture()
  const defaultCaustics = defaultWaterCausticsTexture()

  const uTime = uniform(0)
  const uWaveTime = uniform(0)
  const uSwellTime = uniform(0)
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
  const uFoamScale = uniform(0.1)
  const uCrestFoam = uniform(0.65)
  const uCrestFoamThreshold = uniform(0.42)
  const uShoreFoamOn = uniform(1)
  const uUnderwaterSurfaceBrightness = uniform(0.45)
  const uSoftEdge = uniform(0.08)
  const uCausticsStrength = uniform(0.7)
  const uCausticsScale = uniform(0.22)
  const uWaveHeight = uniform(0)
  const uWaveSteepness = uniform(0.65)
  const uWaveBend = uniform(0.6)
  const uWaveLean = uniform(0.2)
  const uWaveCurl = uniform(0.6)
  const uCrestPower = uniform(0.75)
  const uCrestLift = uniform(0.14)
  /** ε^p，随「浪尖锐度」在 CPU 上算好。 */
  const uCrestRoundPow = uniform(Math.pow(CREST_ROUND, 0.75))
  const uCellSize = uniform(0)
  const uGridCenter = uniform(new Vector2(0, 0))
  // 泡沫拖尾每个回看点、每道长波的 (cos, sin)(ω·回看时长)，在 setSpec 里随「泡沫拖尾」参数更新
  const trailOmegas = VERTEX_WAVES.map(def => Math.sqrt(GRAVITY * ((Math.PI * 2) / def.length)))
  const uTrailTurns = FOAM_TRAIL_TAPS.map(() => trailOmegas.map(() => uniform(new Vector2(1, 0))))
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
  const follow = options.followGrid && options.upAxis === 'z'
  // 跟随网格：几何体里存的是相对网格中心的米数，这里换算成水面局部坐标，并收在水面范围 [-0.5, 0.5] 内
  const restLocal: TslNode = follow
    ? vec3(
      clamp(
        positionGeometry.xy.mul(vec2(uInvScale.x, uInvScale.z)).add(uGridCenter),
        vec2(-0.5, -0.5),
        vec2(0.5, 0.5),
      ),
      0.0,
    )
    : positionLocal
  // 每个顶点处的格子大小 (m)：跟随网格存在几何体的 z 里，普通平面是固定值
  const cellSize: TslNode = follow ? positionGeometry.z : uCellSize
  const restVertexXZ = modelWorldMatrix.mul(vec4(follow ? restLocal : positionGeometry, 1.0)).xz
  const surfXZ = varying(restVertexXZ)

  const rotatedDir = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    return vec2(uFlowDir.x.mul(c).sub(uFlowDir.y.mul(s)), uFlowDir.x.mul(s).add(uFlowDir.y.mul(c)))
  }

  // 与位置无关的每道波常量（方向、振幅、水平聚拢量），顶点/片元共用
  const rich = options.richWaves
  const vertexDefs = rich ? [...VERTEX_WAVES, ...DETAIL_WAVES.slice(0, MID_WAVE_COUNT)] : VERTEX_WAVES
  const detailDefs = rich
    ? DETAIL_WAVES.slice(MID_WAVE_COUNT)
    : options.highDetail ? DETAIL_WAVES : DETAIL_WAVES.slice(0, 2)
  const vertexWaves = vertexDefs.map((def, index) => {
    const k = (Math.PI * 2) / def.length
    const amp = uWaveHeight.mul(def.weight * AMP_GAIN)
    // 雅可比限幅：每道波的 k·Q 不超过自己的份额（预算见 VERTEX_WAVES 下方的说明），保证永不自交
    const pinch = min(amp.mul(PINCH_GAIN), float(def.share / k))
    const dir = rotatedDir(def.angle)
    const isMid = index >= VERTEX_WAVES.length
    return {
      def,
      k,
      omega: Math.sqrt(GRAVITY * k),
      dir,
      perp: vec2(dir.y.negate(), dir.x),
      amp,
      pinch,
      foamWeight: pinch.mul(k),
      isMid,
      // 网格太稀（一个波长不足 2.5 ~ 5 格）时，这道波不再位移顶点，只留在片元法线里，
      // 避免折线化，也避免跟随网格移动时顶点在采样不足的波上「游动」。只能用在顶点阶段。
      geoFade: float(1.0).sub(smoothstep(float(def.length / 5), float(def.length / 2.5), cellSize)),
    }
  })
  type VertexWave = (typeof vertexWaves)[number]

  // 浪脊弯曲：给每道波的相位叠加一个主要沿浪脊方向变化的低频扰动，让浪脊弯曲、错开、断成一段段，
  // 而不是一条贯穿水面的直线。扰动几乎不沿波的前进方向变化，所以不会额外挤压水面。
  // 返回相位偏移，以及（片元求法线用的）相位梯度在浪脊方向与前进方向上的分量。
  const bendOf = (xz: TslNode, wave: VertexWave, index: number, withGradient: boolean) => {
    // 中尺度波只有三五米长，弯不弯看不出来，直接跳过
    if (wave.isMid) return { phase: float(0.0), gradAcross: float(0.0), gradAlong: float(0.0) }
    const along = dot(xz, wave.dir)
    const across = dot(xz, wave.perp)
    const q1 = wave.k / BEND_PRIMARY.span
    const amount1 = uWaveBend.mul(rich ? BEND_PRIMARY.amount : BEND_PRIMARY.amountSolo)
    const a1 = across.mul(q1).add(index * 1.9 + 0.7).add(uWaveTime.mul(0.11 + index * 0.013))
    let phase: TslNode = sin(a1).mul(amount1)
    let gradAcross: TslNode = withGradient ? cos(a1).mul(amount1).mul(q1) : float(0.0)
    let gradAlong: TslNode = float(0.0)
    // 第二层扰动只给最长的几道波（它们的浪脊最显眼），其余的波一层就够
    if (rich && index < BEND_SECONDARY.waves) {
      const q2 = wave.k / BEND_SECONDARY.span
      const amount2 = uWaveBend.mul(BEND_SECONDARY.amount)
      const a2 = across.mul(q2).add(along.mul(q2 * BEND_SECONDARY.along)).add(index * 2.7 + 1.3)
        .sub(uWaveTime.mul(0.17 + index * 0.011))
      phase = phase.add(sin(a2).mul(amount2))
      if (withGradient) {
        const g2 = cos(a2).mul(amount2).mul(q2)
        gradAcross = gradAcross.add(g2)
        gradAlong = g2.mul(BEND_SECONDARY.along)
      }
    }
    return { phase, gradAcross, gradAlong }
  }

  // 单道波的剖面（s = sin θ，c = cos θ，浪尖在 θ = π/2）：
  //   山脊剖面 1 - 2·m^p，其中 m = (1 - s) / 2 是「离浪尖多远」(浪尖 0，浪谷 1)：
  //     p = 1 就是正弦；p 越小浪尖越尖、浪谷越宽越平；p = 0.5 时浪尖是一道折线山脊（两侧坡度不连续）。
  //     p 不能小于 0.5，否则浪尖处坡度无穷大。uCrestLift 把平均水位补回原处。
  //   + 前倾（-λ·s·c：迎着前进方向的一面变陡、背面变缓）
  // 每道波只多一次 pow，不需要额外的三角函数。
  // 返回剖面高度，以及（片元求法线用的）高度对相位 θ 的导数；两者共用同一个 pow 结果。
  const profileOf = (s: TslNode, c: TslNode, withSlope: boolean) => {
    // 浪尖圆角：直接用 m^p 时，只要 p < 1，浪尖处的曲率就是无穷大（p = 0.5 时坡度直接跳变），
    // 等于一条没有宽度的折痕：网格表示不出来，法线在一个像素内翻转，水面上就出现一道硬边。
    // 改用 (m + ε)^p - ε^p：离浪尖稍远处形状不变，浪尖本身是一段有限宽度的圆弧（约占波长的 5%），坡度连续过渡。
    const m = max(float(1.0).sub(s).mul(0.5), float(0.0)).add(CREST_ROUND)
    // w = m^(p-1)：高度用 m·w，坡度用 p·w
    const w = pow(m, uCrestPower.sub(1.0))
    const height: TslNode = float(1.0).add(uCrestLift).sub(m.mul(w).sub(uCrestRoundPow).mul(2.0)).sub(s.mul(c).mul(uWaveLean))
    const slope: TslNode = withSlope
      ? c.mul(w).mul(uCrestPower).sub(c.mul(c).mul(2.0).sub(1.0).mul(uWaveLean))
      : float(0.0)
    return { height, slope }
  }

  const detailWaves = detailDefs.map(def => {
    const k = (Math.PI * 2) / def.length
    const amp = uWaveHeight.mul(def.weight * AMP_GAIN)
    // 短波只在片元里算，远处按波长淡出防闪烁
    const fade = float(1.0).sub(smoothstep(float(def.length * 30), float(def.length * 110), eyeDist))
    return { def, k, omega: Math.sqrt(GRAVITY * k), dir: rotatedDir(def.angle), amp, fade, foamWeight: min(amp.mul(PINCH_GAIN * k), float(0.18)).mul(fade) }
  })

  let displacedLocal: TslNode = restLocal
  let waveSlope: TslNode = vec2(0.0, 0.0)
  let macroSlope: TslNode = vec2(0.0, 0.0)
  let waveCompress: TslNode = float(0.0)
  let waveNorm: TslNode = float(0.0)
  let squeezeNow: TslNode = float(0.0)
  let crestField: TslNode = float(0.0)
  let crestActive: TslNode = float(0.0)

  if (options.waves) {
    // 浪群包络：振幅不是在原地随机涨落，而是一个个「能量团」顺风往前走，速度比浪峰慢。
    // 浪峰从团的后缘追进来 -> 慢慢涨高变陡 -> 在团中间到顶（起沫）-> 从前缘穿出去时较快地塌平，
    // 所以盯着一道浪能看到「涨起、推进、破碎、消散」的完整过程；而能量团本身在持续往前移动，
    // 后面的浪峰接着追进来，重复这个过程，这就是推进感。
    // 团的位置 = 跟着浪峰走（uWaveTime）再按超越速度往后退（uSwellTime，已含「起落频率」）：
    // 起落频率为 0 时团和浪峰同速，浪高不再变化；越大浪峰穿过一个团越快。
    // 三对波各有自己的团（尺度、速度随波长变），不会整片水面同涨同落。
    const flowOrthoDir = vec2(uFlowDir.y.negate(), uFlowDir.x)
    const swellAt = (xz: TslNode, group: number): TslNode => {
      const cfg = SWELL_GROUPS[group]
      const info = swellGroupInfo(group)
      const along = dot(xz, uFlowDir).sub(uWaveTime.mul(info.crestSpeed)).add(uSwellTime.mul(info.overtake))
      const across = dot(xz, flowOrthoDir)
      // 沿浪脊方向把团错开、弯曲，避免排成整齐的横条
      const stagger = sin(across.mul(info.kAcross).add(cfg.offset)).mul(1.5)
        .add(sin(across.mul(info.kAcross * 0.43).sub(along.mul(info.kAlong * 0.21)).add(cfg.offset * 2)).mul(1.0))
      const psi = along.mul(info.kAlong).add(stagger)
      // 浪峰相对团是往前走的（对同一道浪峰，psi 随时间增大），减去 skew·sin(psi) 让包络沿 psi 增大方向「慢涨快落」
      const pulse = smoothstep(float(-0.75), float(0.75), sin(psi.sub(sin(psi).mul(PACKET_SKEW))))
      return mix(float(cfg.low), float(cfg.high), pulse)
    }
    const groupOf = (i: number) => Math.min(SWELL_GROUPS.length - 1, Math.floor(i / 2))

    // 顶点阶段：长波位移（高度 + Gerstner 水平聚拢）
    const vSwell = SWELL_GROUPS.map((_, g) => swellAt(restVertexXZ, g))
    let vHeight: TslNode = float(0.0)
    let vHoriz: TslNode = vec2(0.0, 0.0)
    vertexWaves.forEach((wave, i) => {
      const mod = vSwell[groupOf(i)]
      const theta = dot(restVertexXZ, wave.dir).mul(wave.k).add(wave.def.phase)
        .add(bendOf(restVertexXZ, wave, i, false).phase)
        .sub(uWaveTime.mul(wave.omega))
      const s = sin(theta)
      const c = cos(theta)
      vHeight = vHeight.add(profileOf(s, c, false).height.mul(wave.amp).mul(mod).mul(wave.geoFade))
      // 水平位移 = 向浪峰聚拢（上限 1.1 倍，在压缩份额预算内）+ 浪尖卷曲（浪峰上半部整体往前进方向推，
      // 越靠近浪尖推得越多，于是前脸变陡、浪尖探出去形成钩形；多道大浪叠在一起时允许轻微翻卷）
      const crestUp = max(s, float(0.0))
      const gather = c.mul(uWaveSteepness).add(crestUp.mul(crestUp).mul(uWaveCurl))
      vHoriz = vHoriz.add(wave.dir.mul(gather.mul(wave.pinch).mul(min(mod, float(1.1))).mul(wave.geoFade)))
    })
    // 用节点世界缩放的倒数把世界米数转回局部坐标，确保任意 scale 下都不撕裂
    displacedLocal = options.upAxis === 'z'
      ? vec3(
        restLocal.x.add(vHoriz.x.mul(uInvScale.x)),
        restLocal.y.sub(vHoriz.y.mul(uInvScale.z)),
        restLocal.z.add(vHeight.mul(uInvScale.y)),
      )
      : vec3(
        restLocal.x.add(vHoriz.x.mul(uInvScale.x)),
        restLocal.y.add(vHeight.mul(uInvScale.y)),
        restLocal.z.add(vHoriz.y.mul(uInvScale.z)),
      )

    // 片元阶段：逐像素解析法线（长波 + 只参与着色的短波）
    const vertexBend = vertexWaves.map((wave, i) => bendOf(surfXZ, wave, i, true))
    const vertexBase = vertexWaves.map((wave, i) => dot(surfXZ, wave.dir).mul(wave.k).add(wave.def.phase).add(vertexBend[i].phase))
    const detailBase = detailWaves.map(wave => dot(surfXZ, wave.dir).mul(wave.k).add(wave.def.phase))
    // 起落包络是几十米尺度的缓变量，在顶点算好插值过来即可，片元不再逐像素重算
    const swellVarying = varying(vec3(vSwell[0], vSwell[1], vSwell[2]))
    const fSwell: TslNode[] = [swellVarying.x, swellVarying.y, swellVarying.z]
    const waveSin: TslNode[] = []
    const waveCos: TslNode[] = []
    let vertexFoamWeight: TslNode = float(0.0)
    let midSlope: TslNode = vec2(0.0, 0.0)
    vertexWaves.forEach((wave, i) => {
      const mod = fSwell[groupOf(i)]
      const theta = vertexBase[i].sub(uWaveTime.mul(wave.omega))
      const s = sin(theta)
      const c = cos(theta)
      waveSin.push(s)
      waveCos.push(c)
      // 与顶点一致的单波剖面及其对相位的导数（共用一次 pow）
      const profile = profileOf(s, c, true)
      const leanHeight = profile.height
      const leanSlope = profile.slope
      const crestUp = max(s, float(0.0))
      // 相位梯度 = k·前进方向 + 浪脊弯曲带来的偏转
      const bend = vertexBend[i]
      const phaseGrad = wave.dir.mul(bend.gradAlong.add(wave.k)).add(wave.perp.mul(bend.gradAcross))
      const slope = phaseGrad.mul(leanSlope.mul(wave.amp).mul(mod))
      if (wave.isMid) {
        // 中尺度波在远处淡出法线贡献，防止低角度闪烁
        const fade = float(1.0).sub(smoothstep(float(wave.def.length * 30), float(wave.def.length * 110), eyeDist))
        midSlope = midSlope.add(slope.mul(fade))
      } else {
        macroSlope = macroSlope.add(slope)
      }
      // 水平位移造成的压缩量：聚拢项在浪尖最大，卷曲项在浪尖前脸最大（cos θ < 0 的一侧），法线据此在前脸变陡
      const squeeze = s.mul(uWaveSteepness).sub(crestUp.mul(c).mul(uWaveCurl).mul(2.0))
      waveCompress = waveCompress.add(squeeze.mul(wave.pinch).mul(wave.k).mul(min(mod, float(1.1))))
      waveNorm = waveNorm.add(leanHeight.mul(wave.def.weight).mul(mod))
      vertexFoamWeight = vertexFoamWeight.add(wave.foamWeight)
    })
    waveSlope = macroSlope.add(midSlope)
    // 短波只提供高度，用于让小波峰也能起沫；不再参与法线。
    // 纯正弦短波在法线里会形成一排排等间距的平行条纹（反射里特别明显），
    // 这个尺度（1 ~ 15 m）的细节交给多层法线贴图，它是不规则的。
    let detailNorm: TslNode = float(0.0)
    detailWaves.forEach((wave, i) => {
      const theta = detailBase[i].sub(uWaveTime.mul(wave.omega))
      detailNorm = detailNorm.add(sin(theta).mul(wave.def.weight).mul(wave.fade))
    })
    // 浪峰值 = 实际的归一化浪高（与顶点位移、次表面散射用的是同一个量），所以泡沫严格落在看得见的波峰上。
    // lookBack 回看过去某一刻同一块水面的浪高，用来生成浪峰走过后留在身后的淡拖尾。
    // 回看时刻的相位 = 当前相位 + ω·回看时长，回看时长只取决于「泡沫拖尾」参数，
    // 所以 cos/sin(ω·回看时长) 在 CPU 上算好传进来，这里用和角公式展开，每个回看点不再有三角函数。
    const crestAt = (tap: number): TslNode => {
      let acc: TslNode = float(0.0)
      vertexWaves.forEach((wave, i) => {
        // 拖尾只看长波（中尺度波太短，拖尾里看不出来），并省略剖面修正
        if (wave.isMid) return
        const turn = uTrailTurns[tap][i]
        // 回看只有 2 秒以内，直接沿用当前的起落包络（省掉每个回看点重算一遍）
        acc = acc.add(waveSin[i].mul(turn.x).add(waveCos[i].mul(turn.y)).mul(wave.def.weight).mul(fSwell[groupOf(i)]))
      })
      return acc.mul(CREST_GAIN)
    }

    // 当前时刻直接复用上面算好的浪高，并叠加短波高度，让小波峰在阈值调低时也能起沫
    squeezeNow = waveNorm.add(detailNorm.mul(1.6)).mul(CREST_GAIN)
    // 阈值 = 开始起沫的浪高；从阈值到浪尖是一段 0.55 宽的缓坡，只有最高的浪尖才到 1
    const crestStart = mix(float(0.0), float(0.8), clamp(uCrestFoamThreshold, float(0.0), float(1.0)))
    const crestEnd = crestStart.add(0.55)
    crestField = smoothstep(crestStart, crestEnd, squeezeNow)
    const taps = options.highDetail ? FOAM_TRAIL_TAPS : FOAM_TRAIL_TAPS.slice(0, 3)
    taps.forEach((tap, index) => {
      crestField = max(crestField, smoothstep(crestStart, crestEnd, crestAt(index)).mul(tap.keep * 0.6))
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
  // 下限 0.4：剖面本身已经把浪尖削尖了，这里再把竖直分量压到很小等于重复放大坡度，法线会在浪尖两侧突然翻转
  const crestPinchY = max(float(1.0).sub(waveCompress), float(0.4))
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
  const grazingFade = smoothstep(float(0.04), float(0.32), nDotV)
  const distortion = surfaceNormal.xz.mul(float(0.008).add(float(0.18).div(max(eyeDist, float(1.0))))).mul(uNormalScale).mul(float(0.35).add(grazingFade.mul(0.65)))
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
    // 贴图未覆盖或被清空（如低角度/接近静水面时）用天空渐变兜底，避免反射突然变黑
    reflectionColor = mix(fallbackReflection, mirrorReflector.rgb, mirrorReflector.a)
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

  // 双层海沫：R 通道是 512px 絮状多尺度气泡网丝，G 通道是门控噪波（使用独立的泡沫尺度 uFoamScale）
  const foamUv = surfXZ.mul(uFoamScale)
  const foamSampleA = foamTexNode.sample(foamUv.mul(1.85).add(flow.mul(1.25)))
  const foamSampleB = foamTexNode.sample(foamUv.mul(4.1).sub(flowOrtho.mul(1.45)))
  const foamWeb = foamSampleA.r.mul(0.62).add(foamSampleB.r.mul(0.38))
  const foamErode = foamSampleA.g.mul(0.55).add(foamSampleB.g.mul(0.45))

  const shoreRatio = clamp(waterDepth.div(max(uFoamWidth, float(0.01))), float(0.0), float(1.0))
  const shoreBase = float(1.0).sub(smoothstep(float(0.0), max(uFoamWidth, float(0.01)), waterDepth))
  const lapRipple = sin(shoreRatio.mul(12.0).sub(uTime.mul(2.2))).mul(0.5).add(0.5)
  const shoreBand = shoreBase.mul(float(0.62).add(lapRipple.mul(0.38))).mul(uShoreFoamOn)

  // 浪峰泡沫：遮罩 = 浪高超过阈值的程度（浪尖 1 -> 阈值处 0）。
  // 「波峰浪花」超过 1 的部分不再把遮罩整体顶满（那样会抹平渐变变成实心），只按比例放大最终不透明度
  let crestBand: TslNode = float(0.0)
  if (options.waves) {
    crestBand = crestField.mul(crestActive).mul(min(uCrestFoam, float(1.0)))
  }
  const crestBoost = max(uCrestFoam, float(1.0))

  const foamMask = clamp(max(shoreBand, crestBand), float(0.0), float(1.0))
  // 米级的大尺度絮状层：让泡沫先有「一团团云絮」的结构，细丝只是叠在上面的细节，避免满屏等大的颗粒点
  const foamCloud = foamTexNode.sample(foamUv.mul(0.45).add(flow.mul(0.4))).r
  const detail = foamCloud.mul(0.4).add(foamWeb.mul(0.45)).add(foamErode.mul(0.15))
  // 不透明度整体跟着遮罩走（浪尖最实 -> 边缘透明），贴图只决定「镂空多少」：
  // 边缘几乎全靠贴图丝缕且本身很淡，越靠近浪尖镂空越少，只有浪尖处接近不透明
  const webThreshold = mix(float(0.7), float(0.0), foamMask)
  const webPattern = smoothstep(webThreshold, webThreshold.add(0.45), detail)
  const tipFill = smoothstep(float(0.6), float(1.0), foamMask).mul(0.85)
  const foamAlpha = clamp(
    pow(foamMask, float(1.2)).mul(mix(webPattern, float(1.0), tipFill)).mul(uFoamIntensity).mul(crestBoost).mul(1.2),
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

  // 水下往上看水面（背面）：斯涅尔亮窗透出明亮天空与太阳光晕，四周呈全内反射波纹，不影响水上正面表现
  const upCos = clamp(dot(crispNormal, viewVec.negate()), float(0.0), float(1.0))
  const snellWindow = smoothstep(float(0.28), float(0.72), upCos)
  const skyWindowColor = mix(uShallowColor, vec3(0.75, 0.96, 1.0), float(0.65))
  const sunThrough = pow(max(dot(viewVec.negate(), sunDir), float(0.0)), float(12.0)).mul(0.85)
  const tirColor = mix(uDeepColor, uShallowColor, clamp(float(0.45).add(crispNormal.x.mul(0.15)), float(0.2), float(0.8)))
  const underwaterBackColor = mix(tirColor, skyWindowColor, snellWindow).add(uSunColor.mul(sunThrough)).mul(uUnderwaterSurfaceBrightness)
  const underwaterBackAlpha = mix(float(0.88), float(0.32), snellWindow)

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
  if (options.waves || follow) material.positionNode = displacedLocal
  material.colorNode = select(debugOn, debugColor, select(frontFacing, finalColor, underwaterBackColor))
  material.opacityNode = select(debugOn, float(1.0), select(frontFacing, max(finalAlpha, foamAlpha), underwaterBackAlpha))
  material.transparent = true
  material.depthWrite = true
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
      uFoamScale.value = spec.foamScale
      uCrestFoam.value = spec.crestFoam
      uCrestFoamThreshold.value = spec.crestFoamThreshold
      uShoreFoamOn.value = spec.shoreFoam ? 1 : 0
      uUnderwaterSurfaceBrightness.value = spec.underwaterSurfaceBrightness
      uSoftEdge.value = spec.softEdge
      uCausticsStrength.value = spec.causticsStrength
      uCausticsScale.value = spec.causticsScale
      uWaveHeight.value = spec.quality === 'fast' ? 0 : spec.waveHeight
      uWaveSteepness.value = spec.quality === 'fast' ? 0 : spec.waveSteepness
      uWaveBend.value = spec.waveBend
      uWaveLean.value = spec.waveLean * LEAN_GAIN
      uWaveCurl.value = spec.waveLean * CURL_GAIN
      // 浪尖锐度 0 ~ 1 对应剖面指数 1（正弦）~ 0.5（折线山脊）；尖剖面的平均高度偏低，按比例抬回去
      const ridge = Math.min(1, Math.max(0, spec.crestSharpness))
      uCrestPower.value = 1 - ridge * 0.5
      uCrestRoundPow.value = Math.pow(CREST_ROUND, uCrestPower.value)
      uCrestLift.value = ridge * 0.274
      FOAM_TRAIL_TAPS.forEach((tap, t) => {
        const lookBack = spec.foamTrail * tap.time
        trailOmegas.forEach((omega, i) => {
          uTrailTurns[t][i].value.set(Math.cos(omega * lookBack), Math.sin(omega * lookBack))
        })
      })
      uDebugView.value = DEBUG_VIEW_INDEX[spec.debugView]
      if (mirrorReflector) {
        mirrorReflector.reflector.resolutionScale = Math.max(0.25, spec.reflectionScale)
      }
      normalTexNode.value = customNormal ?? defaultNormal
      foamTexNode.value = customFoam ?? defaultFoam
    },
    setTime(time, waveTime, swellTime) {
      uSwellTime.value = swellTime
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
    setCellSize(meters) {
      uCellSize.value = Math.max(0, meters)
    },
    setGridCenter(localX, localY) {
      uGridCenter.value.set(localX, localY)
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
