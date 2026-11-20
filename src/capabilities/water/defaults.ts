export const WATER_CAPABILITY_ID = 'water'

export type WaterQuality = 'fast' | 'balanced' | 'ultra'
export type WaterPresetId = 'tropical' | 'ocean' | 'lake' | 'pool' | 'stylized'
export type WaterDebugView = 'off' | 'height' | 'squeeze' | 'foam'
export const WATER_DEBUG_VIEWS: WaterDebugView[] = ['off', 'height', 'squeeze', 'foam']

export interface WaterSpec {
  enabled: boolean
  preset: WaterPresetId
  quality: WaterQuality
  shallowColor: string
  deepColor: string
  foamColor: string
  sunColor: string
  depthAbsorption: number
  opacity: number
  normalScale: number
  waveScale: number
  flowSpeed: number
  flowDirection: number
  fresnelPower: number
  reflectivity: number
  specularStrength: number
  specularSize: number
  sssStrength: number
  foamWidth: number
  foamIntensity: number
  /** 泡沫贴图平铺尺度（独立于波纹尺度）。 */
  foamScale: number
  crestFoam: number
  /** 波峰泡沫出现阈值（越高越少，只留最高浪尖；越低越多）。 */
  crestFoamThreshold: number
  /** 浪峰泡沫拖尾时长倍率（0 = 泡沫只贴在浪峰上，越大浪峰走过后留得越久）。 */
  foamTrail: number
  /** 浪的起落频率倍率（1 = 一个浪从涨起到平掉约 4 ~ 7 秒；越大起落越快，0 = 浪高不随时间变化）。 */
  swellRate: number
  /** 调试视图：只看波高 / 挤压值 / 泡沫遮罩，用于调参，不影响性能档位。 */
  debugView: WaterDebugView
  waveHeight: number
  /** 大浪推进速度倍率（0 可定格波浪）。 */
  waveSpeed: number
  /** 3D Gerstner 波峰聚拢度 (0 = 柔和正弦，1 = 尖锐浪脊)。 */
  waveSteepness: number
  /** 浪线蜿蜒：俯视看浪脊的走向 (0 = 笔直的平行浪脊，1 = 明显弯曲、错开成一段段)。改变的是浪的分布，不是单个浪的形状。 */
  waveBend: number
  /** 浪尖卷曲：单个浪的剖面 (0 = 前后对称，1 = 浪尖往前进方向探出、前脸陡立成钩形)。 */
  waveLean: number
  /** 浪尖锐度：单个浪的剖面 (0 = 圆润的正弦，1 = 浪尖是一道折线山脊、浪谷宽而平)。 */
  crestSharpness: number
  reflectionScale: number
  /** 岸边透明过渡羽化深度 (m)，消除水岸锯齿硬边。 */
  softEdge: number
  /** 开关：平面反射（关闭时不创建 reflector，真正零反射开销）。 */
  planarReflection: boolean
  /** 开关：屏幕空间折射。 */
  refraction: boolean
  /** 开关：浅水焦散光斑。 */
  caustics: boolean
  causticsStrength: number
  causticsScale: number
  /** 开关：岸边泡沫与拍岸波纹。 */
  shoreFoam: boolean
  normalMapAssetId: string | null
  foamMapAssetId: string | null
}

export const WATER_QUALITY_PRESETS: Record<WaterQuality, {
  reflectionScale: number
  waveHeight: number
  planarReflection: boolean
  refraction: boolean
  caustics: boolean
  shoreFoam: boolean
}> = {
  fast: { reflectionScale: 0, waveHeight: 0, planarReflection: false, refraction: false, caustics: false, shoreFoam: true },
  balanced: { reflectionScale: 0.5, waveHeight: 0, planarReflection: true, refraction: true, caustics: true, shoreFoam: true },
  ultra: { reflectionScale: 0.75, waveHeight: 0.04, planarReflection: true, refraction: true, caustics: true, shoreFoam: true },
}

type StylePresetFields = Omit<
  WaterSpec,
  | 'enabled' | 'preset' | 'quality' | 'reflectionScale'
  | 'planarReflection' | 'refraction' | 'caustics' | 'shoreFoam'
  | 'normalMapAssetId' | 'foamMapAssetId' | 'foamTrail' | 'swellRate' | 'debugView'
>

export const WATER_STYLE_PRESETS: Record<WaterPresetId, StylePresetFields> = {
  tropical: {
    shallowColor: '#14b8a6',
    deepColor: '#063354',
    foamColor: '#f8fafc',
    sunColor: '#fff7e0',
    depthAbsorption: 1.7,
    opacity: 0.83,
    normalScale: 2,
    waveScale: 0.08,
    flowSpeed: 0.9,
    flowDirection: 32,
    fresnelPower: 5.0,
    reflectivity: 0.18,
    specularStrength: 3.95,
    specularSize: 0.58,
    sssStrength: 1.5,
    foamWidth: 0.4,
    foamIntensity: 0.75,
    foamScale: 0.1,
    crestFoam: 0.55,
    crestFoamThreshold: 0.42,
    waveHeight: 0.35,
    waveSpeed: 0.35,
    waveSteepness: 0.65,
    waveBend: 0.6,
    waveLean: 0.5,
    crestSharpness: 0.5,
    softEdge: 0.08,
    causticsStrength: 0.7,
    causticsScale: 0.22,
  },
  ocean: {
    shallowColor: '#0369a1',
    deepColor: '#071b33',
    foamColor: '#e2e8f0',
    sunColor: '#ffefcc',
    depthAbsorption: 0.4,
    opacity: 0.65,
    normalScale: 2,
    waveScale: 0.18,
    flowSpeed: 0.15,
    flowDirection: 20,
    fresnelPower: 5.0,
    reflectivity: 0.16,
    specularStrength: 4,
    specularSize: 0.62,
    sssStrength: 1.6,
    foamWidth: 0.35,
    foamIntensity: 0.55,
    foamScale: 0.16,
    crestFoam: 0.85,
    crestFoamThreshold: 0.42,
    waveHeight: 1.2,
    waveSpeed: 0.35,
    waveSteepness: 0.82,
    waveBend: 0.7,
    waveLean: 0.6,
    crestSharpness: 0.7,
    softEdge: 0.1,
    causticsStrength: 0.25,
    causticsScale: 0.16,
  },
  lake: {
    shallowColor: '#155e63',
    deepColor: '#08222a',
    foamColor: '#cbd5e1',
    sunColor: '#fff3d6',
    depthAbsorption: 1.3,
    opacity: 0.42,
    normalScale: 2,
    waveScale: 0.08,
    flowSpeed: 0.22,
    flowDirection: 45,
    fresnelPower: 5.2,
    reflectivity: 0.18,
    specularStrength: 3.95,
    specularSize: 0.68,
    sssStrength: 0.55,
    foamWidth: 0.15,
    foamIntensity: 0.4,
    foamScale: 0.08,
    crestFoam: 0.2,
    crestFoamThreshold: 0.5,
    waveHeight: 0.04,
    waveSpeed: 0.35,
    waveSteepness: 0.35,
    waveBend: 0.5,
    waveLean: 0.3,
    crestSharpness: 0.3,
    softEdge: 0.08,
    causticsStrength: 0.35,
    causticsScale: 0.24,
  },
  pool: {
    shallowColor: '#38bdf8',
    deepColor: '#0284c7',
    foamColor: '#ffffff',
    sunColor: '#ffffff',
    depthAbsorption: 4.5,
    opacity: 0.07,
    normalScale: 2,
    waveScale: 0.08,
    flowSpeed: 0.25,
    flowDirection: 15,
    fresnelPower: 4.2,
    reflectivity: 0.3,
    specularStrength: 4,
    specularSize: 0.34,
    sssStrength: 0.2,
    foamWidth: 0.1,
    foamIntensity: 0,
    foamScale: 0.1,
    crestFoam: 0,
    crestFoamThreshold: 0.5,
    waveHeight: 0,
    waveSpeed: 0.35,
    waveSteepness: 0.2,
    waveBend: 0.4,
    waveLean: 0.2,
    crestSharpness: 0.2,
    softEdge: 0.03,
    causticsStrength: 0.95,
    causticsScale: 0.36,
  },
  stylized: {
    shallowColor: '#06b6d4',
    deepColor: '#1e40af',
    foamColor: '#ffffff',
    sunColor: '#fffbeb',
    depthAbsorption: 2.0,
    opacity: 0.65,
    normalScale: 2,
    waveScale: 0.18,
    flowSpeed: 0.38,
    flowDirection: 30,
    fresnelPower: 3.4,
    reflectivity: 0.18,
    specularStrength: 3.95,
    specularSize: 0.68,
    sssStrength: 0.55,
    foamWidth: 0.32,
    foamIntensity: 1.2,
    foamScale: 0.15,
    crestFoam: 0.7,
    crestFoamThreshold: 0.42,
    waveHeight: 0.65,
    waveSpeed: 0.35,
    waveSteepness: 0.7,
    waveBend: 0.55,
    waveLean: 0.5,
    crestSharpness: 0.5,
    softEdge: 0.06,
    causticsStrength: 0.5,
    causticsScale: 0.28,
  },
}

export function defaultWater(): WaterSpec {
  return {
    enabled: false,
    preset: 'tropical',
    quality: 'balanced',
    ...WATER_STYLE_PRESETS.tropical,
    ...WATER_QUALITY_PRESETS.balanced,
    foamTrail: 1,
    swellRate: 1,
    debugView: 'off',
    normalMapAssetId: null,
    foamMapAssetId: null,
  }
}

export function normalizeWater(raw: unknown): WaterSpec {
  const base = defaultWater()
  if (!raw || typeof raw !== 'object') return base
  const record = raw as Partial<WaterSpec>
  const preset = record.preset && record.preset in WATER_STYLE_PRESETS ? record.preset : base.preset
  const quality = record.quality && record.quality in WATER_QUALITY_PRESETS ? record.quality : base.quality
  const qualPreset = WATER_QUALITY_PRESETS[quality]
  return {
    enabled: record.enabled === true,
    preset,
    quality,
    shallowColor: typeof record.shallowColor === 'string' ? record.shallowColor : base.shallowColor,
    deepColor: typeof record.deepColor === 'string' ? record.deepColor : base.deepColor,
    foamColor: typeof record.foamColor === 'string' ? record.foamColor : base.foamColor,
    sunColor: typeof record.sunColor === 'string' ? record.sunColor : base.sunColor,
    depthAbsorption: finite(record.depthAbsorption, base.depthAbsorption, 0.1, 30),
    opacity: finite(record.opacity, base.opacity, 0.05, 1),
    normalScale: finite(record.normalScale, base.normalScale, 0, 3),
    waveScale: finite(record.waveScale, base.waveScale, 0.01, 1),
    flowSpeed: finite(record.flowSpeed, base.flowSpeed, 0, 5),
    flowDirection: finite(record.flowDirection, base.flowDirection, 0, 360),
    fresnelPower: finite(record.fresnelPower, base.fresnelPower, 0.5, 10),
    reflectivity: finite(record.reflectivity, base.reflectivity, 0, 1),
    specularStrength: finite(record.specularStrength, base.specularStrength, 0, 5),
    specularSize: finite(record.specularSize, base.specularSize, 0.02, 1),
    sssStrength: finite(record.sssStrength, base.sssStrength, 0, 3),
    foamWidth: finite(record.foamWidth, base.foamWidth, 0, 4),
    foamIntensity: finite(record.foamIntensity, base.foamIntensity, 0, 3),
    foamScale: finite(record.foamScale, base.foamScale, 0.01, 2),
    crestFoam: finite(record.crestFoam, base.crestFoam, 0, 2),
    crestFoamThreshold: finite(record.crestFoamThreshold, base.crestFoamThreshold, 0, 0.9),
    foamTrail: finite(record.foamTrail, base.foamTrail, 0, 1.5),
    swellRate: finite(record.swellRate, base.swellRate, 0, 4),
    debugView: record.debugView && WATER_DEBUG_VIEWS.includes(record.debugView) ? record.debugView : 'off',
    waveHeight: finite(record.waveHeight, base.waveHeight, 0, 3),
    waveSpeed: finite(record.waveSpeed, base.waveSpeed, 0, 4),
    waveSteepness: finite(record.waveSteepness, base.waveSteepness, 0, 1),
    waveBend: finite(record.waveBend, base.waveBend, 0, 1),
    waveLean: finite(record.waveLean, base.waveLean, 0, 1),
    crestSharpness: finite(record.crestSharpness, base.crestSharpness, 0, 1),
    reflectionScale: finite(record.reflectionScale, qualPreset.reflectionScale, 0, 1),
    softEdge: finite(record.softEdge, base.softEdge, 0, 1),
    planarReflection: typeof record.planarReflection === 'boolean' ? record.planarReflection : qualPreset.planarReflection,
    refraction: typeof record.refraction === 'boolean' ? record.refraction : qualPreset.refraction,
    caustics: typeof record.caustics === 'boolean' ? record.caustics : qualPreset.caustics,
    causticsStrength: finite(record.causticsStrength, base.causticsStrength, 0, 2),
    causticsScale: finite(record.causticsScale, base.causticsScale, 0.04, 2),
    shoreFoam: typeof record.shoreFoam === 'boolean' ? record.shoreFoam : qualPreset.shoreFoam,
    normalMapAssetId: typeof record.normalMapAssetId === 'string' ? record.normalMapAssetId : null,
    foamMapAssetId: typeof record.foamMapAssetId === 'string' ? record.foamMapAssetId : null,
  }
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
