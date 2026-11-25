export const HEIGHT_FOG_CAPABILITY_ID = 'fog' as const

/** 高度雾与远近雾能力包配置。只存放可序列化的纯数据，不引用 Three.js。 */
export interface HeightFogSettings {
  /** 总开关。 */
  enabled: boolean
  /** 整体最大不透明度（0 ~ 1）。 */
  opacity: number
  /** 是否作用于天空/背景像素。 */
  affectSky: boolean

  /** 高度雾开关。 */
  heightEnabled: boolean
  /** 是否开启高度雾三色垂直渐变（关闭时统一使用底层颜色）。 */
  heightGradient: boolean
  /** 高度雾底层颜色（标准线及以下）。 */
  heightColor: string
  /** 高度雾中层颜色（过渡带中部）。 */
  heightMidColor: string
  /** 高度雾顶层颜色（过渡带顶部）。 */
  heightTopColor: string
  /** 高度标准线（米）：低于此高度雾最浓，高于此线开始向上过渡衰减。 */
  heightBase: number
  /** 高度过渡范围（米）：从标准线向上衰减到 0 的高度区间。 */
  heightRange: number
  /** 高度雾浓度（0 ~ 1）。 */
  heightDensity: number
  /** 高度过渡曲线软硬度（0.2 ~ 4）。 */
  heightFalloff: number
  /** 高度雾随机噪点开关。 */
  heightNoiseEnabled: boolean
  /** 高度雾噪点空间尺度。 */
  heightNoiseScale: number
  /** 高度雾噪点扰动强度（0 ~ 1）。 */
  heightNoiseIntensity: number
  /** 高度雾噪点飘动速度。 */
  heightNoiseSpeed: number

  /** 远近雾开关。 */
  distanceEnabled: boolean
  /** 远近雾近端颜色（靠近起点）。 */
  distanceNearColor: string
  /** 远近雾远端颜色（靠近终点）。 */
  distanceFarColor: string
  /** 远近雾起点（米）。 */
  distanceStart: number
  /** 远近雾终点（米）。 */
  distanceEnd: number
  /** 远近雾过渡范围（米）：控制起雾初期的渐入柔化带宽。 */
  distanceTransition: number
  /** 远近雾最大浓度（0 ~ 1）。 */
  distanceDensity: number
  /** 远近雾随机噪点开关。 */
  distanceNoiseEnabled: boolean
  /** 远近雾噪点空间尺度。 */
  distanceNoiseScale: number
  /** 远近雾噪点扰动强度（0 ~ 1）。 */
  distanceNoiseIntensity: number
  /** 远近雾噪点飘动速度。 */
  distanceNoiseSpeed: number
}

export function defaultHeightFogSettings(): HeightFogSettings {
  return {
    enabled: false,
    opacity: 1,
    affectSky: false,

    heightEnabled: true,
    heightGradient: true,
    heightColor: '#5c789c',
    heightMidColor: '#8fa8c8',
    heightTopColor: '#c7d9ee',
    heightBase: 0.3,
    heightRange: 2,
    heightDensity: 0.85,
    heightFalloff: 1.2,
    heightNoiseEnabled: false,
    heightNoiseScale: 0.35,
    heightNoiseIntensity: 0.4,
    heightNoiseSpeed: 0.3,

    distanceEnabled: true,
    distanceNearColor: '#b8cbe0',
    distanceFarColor: '#6f89ab',
    distanceStart: 5,
    distanceEnd: 50,
    distanceTransition: 15,
    distanceDensity: 0.9,
    distanceNoiseEnabled: false,
    distanceNoiseScale: 0.08,
    distanceNoiseIntensity: 0.35,
    distanceNoiseSpeed: 0.25,
  }
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function colorHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback
}

export function normalizeHeightFogSettings(value: unknown): HeightFogSettings {
  const base = defaultHeightFogSettings()
  if (!value || typeof value !== 'object') return base
  const raw = value as Partial<HeightFogSettings> & {
    distanceColor?: unknown
    noiseEnabled?: unknown
    noiseScale?: unknown
    noiseIntensity?: unknown
    noiseSpeed?: unknown
  }
  const distanceStart = clamp(raw.distanceStart, base.distanceStart, 0, 2000)
  const distanceEnd = Math.max(distanceStart + 0.1, clamp(raw.distanceEnd, base.distanceEnd, 0.1, 4000))
  const legacyNoiseEnabled = typeof raw.noiseEnabled === 'boolean' ? raw.noiseEnabled : undefined
  const heightColor = colorHex(raw.heightColor, base.heightColor)
  const legacyDistColor = typeof raw.distanceColor === 'string' ? colorHex(raw.distanceColor, base.distanceNearColor) : null

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    opacity: clamp(raw.opacity, base.opacity, 0, 1),
    affectSky: typeof raw.affectSky === 'boolean' ? raw.affectSky : base.affectSky,

    heightEnabled: typeof raw.heightEnabled === 'boolean' ? raw.heightEnabled : base.heightEnabled,
    heightGradient: typeof raw.heightGradient === 'boolean' ? raw.heightGradient : base.heightGradient,
    heightColor,
    heightMidColor: colorHex(raw.heightMidColor, base.heightMidColor),
    heightTopColor: colorHex(raw.heightTopColor, base.heightTopColor),
    heightBase: clamp(raw.heightBase, base.heightBase, -200, 500),
    heightRange: clamp(raw.heightRange, base.heightRange, 0.05, 500),
    heightDensity: clamp(raw.heightDensity, base.heightDensity, 0, 1),
    heightFalloff: clamp(raw.heightFalloff, base.heightFalloff, 0.2, 4),
    heightNoiseEnabled: typeof raw.heightNoiseEnabled === 'boolean' ? raw.heightNoiseEnabled : (legacyNoiseEnabled ?? base.heightNoiseEnabled),
    heightNoiseScale: clamp(raw.heightNoiseScale ?? raw.noiseScale, base.heightNoiseScale, 0.01, 5),
    heightNoiseIntensity: clamp(raw.heightNoiseIntensity ?? raw.noiseIntensity, base.heightNoiseIntensity, 0, 1),
    heightNoiseSpeed: clamp(raw.heightNoiseSpeed ?? raw.noiseSpeed, base.heightNoiseSpeed, 0, 5),

    distanceEnabled: typeof raw.distanceEnabled === 'boolean' ? raw.distanceEnabled : base.distanceEnabled,
    distanceNearColor: colorHex(raw.distanceNearColor, legacyDistColor ?? base.distanceNearColor),
    distanceFarColor: colorHex(raw.distanceFarColor, legacyDistColor ?? base.distanceFarColor),
    distanceStart,
    distanceEnd,
    distanceTransition: clamp(raw.distanceTransition, base.distanceTransition, 0, 2000),
    distanceDensity: clamp(raw.distanceDensity, base.distanceDensity, 0, 1),
    distanceNoiseEnabled: typeof raw.distanceNoiseEnabled === 'boolean' ? raw.distanceNoiseEnabled : base.distanceNoiseEnabled,
    distanceNoiseScale: clamp(raw.distanceNoiseScale, base.distanceNoiseScale, 0.005, 5),
    distanceNoiseIntensity: clamp(raw.distanceNoiseIntensity, base.distanceNoiseIntensity, 0, 1),
    distanceNoiseSpeed: clamp(raw.distanceNoiseSpeed, base.distanceNoiseSpeed, 0, 5),
  }
}
