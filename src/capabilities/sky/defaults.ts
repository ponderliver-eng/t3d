export const SKY_CAPABILITY_ID = 'sky' as const

export type SkyNorthSetting = '+X' | '-X' | '+Z' | '-Z'

/** 画面级天空。只放可序列化的数，不引用 Three.js。 */
export interface SkySettings {
  /** 0–24 小时。 */
  timeOfDay: number
  latitude: number
  /** 1–365。 */
  dayOfYear: number
  north: SkyNorthSetting
  /** 烘进天空贴图的亮度。画面色调映射还会再作用一次，所以默认不要用库里的 40。 */
  exposure: number
  turbidity: number
  groundAlbedo: number
  sunDisc: boolean
  /** 太阳角直径，度。约 0.53 是真实日轮。 */
  sunAngularDiameter: number
  /** 物理太阳照度的倍率。1 会远亮于现有曝光。 */
  sunIntensity: number
  sunShadow: boolean
  /** 随时间自动锁定场景中第一个方向光的角度 */
  lockFirstDirectionalLight: boolean
  /** 随时间相对变化第一个方向光的强度与颜色（以节点原设置为正午基准） */
  syncFirstDirectionalLightAppearance: boolean
  fog: boolean
  fogDensity: number
  fogHeightFalloff: number
  fogBaseHeight: number
  fogMaxOpacity: number
  /** 关掉跟随天空时，高度雾使用这个颜色。 */
  fogColor: string
  fogSkyColor: boolean
  /** 空气透视。打开后每帧更新一张查找表。 */
  haze: boolean
  /** 0 没有雾气，1 是查找表里的浓度。 */
  hazeStrength: number
  /**
   * 光学路径放大。查找表按公里切片，1 时几十米几乎没有雾。
   * 越大，越近的表面也会往天空色靠。
   */
  hazeNear: number
  stars: boolean
  /** 星星亮度。1 为默认。 */
  starIntensity: number
  /** 星点大小，像素。 */
  starSize: number
  /** 银河亮度。0 为隐藏。 */
  milkyWay: number
  moon: boolean
  /** 月亮角直径，度。 */
  moonAngularDiameter: number
  moonPhase: number
  /** 月光整体强度。 */
  moonLight: number
  mirrorBelowHorizon: boolean
}

export function defaultSkySettings(): SkySettings {
  return {
    timeOfDay: 15,
    latitude: 35,
    dayOfYear: 172,
    north: '+Z',
    exposure: 2.5,
    turbidity: 1,
    groundAlbedo: 0.3,
    sunDisc: true,
    sunAngularDiameter: 0.53,
    sunIntensity: 0.12,
    sunShadow: true,
    lockFirstDirectionalLight: false,
    syncFirstDirectionalLightAppearance: false,
    fog: false,
    fogDensity: 0.3,
    fogHeightFalloff: 300,
    fogBaseHeight: 0,
    fogMaxOpacity: 1,
    fogColor: '#c9d6e6',
    fogSkyColor: true,
    haze: false,
    hazeStrength: 1,
    hazeNear: 200,
    stars: false,
    starIntensity: 1,
    starSize: 0.7,
    milkyWay: 0.25,
    moon: false,
    moonAngularDiameter: 0.53,
    moonPhase: 0.5,
    moonLight: 1,
    mirrorBelowHorizon: false,
  }
}

const NORTH: readonly SkyNorthSetting[] = ['+X', '-X', '+Z', '-Z']

export function normalizeSkySettings(value: unknown): SkySettings {
  const base = defaultSkySettings()
  if (!value || typeof value !== 'object') return base
  const raw = value as Partial<SkySettings>
  return {
    timeOfDay: clamp(raw.timeOfDay, base.timeOfDay, 0, 24),
    latitude: clamp(raw.latitude, base.latitude, -90, 90),
    dayOfYear: Math.round(clamp(raw.dayOfYear, base.dayOfYear, 1, 365)),
    north: typeof raw.north === 'string' && NORTH.includes(raw.north as SkyNorthSetting) ? raw.north as SkyNorthSetting : base.north,
    exposure: clamp(raw.exposure, base.exposure, 0, 120),
    turbidity: clamp(raw.turbidity, base.turbidity, 0, 12),
    groundAlbedo: clamp(raw.groundAlbedo, base.groundAlbedo, 0, 1),
    sunDisc: bool(raw.sunDisc, base.sunDisc),
    sunAngularDiameter: clamp(raw.sunAngularDiameter, base.sunAngularDiameter, 0.05, 12),
    sunIntensity: clamp(raw.sunIntensity, base.sunIntensity, 0, 4),
    sunShadow: bool(raw.sunShadow, base.sunShadow),
    lockFirstDirectionalLight: bool(raw.lockFirstDirectionalLight, base.lockFirstDirectionalLight),
    syncFirstDirectionalLightAppearance: bool(raw.syncFirstDirectionalLightAppearance, base.syncFirstDirectionalLightAppearance),
    fog: bool(raw.fog, base.fog),
    fogDensity: clamp(raw.fogDensity, base.fogDensity, 0, 12),
    fogHeightFalloff: clamp(raw.fogHeightFalloff, base.fogHeightFalloff, 1, 8000),
    fogBaseHeight: clamp(raw.fogBaseHeight, base.fogBaseHeight, -500, 8000),
    fogMaxOpacity: clamp(raw.fogMaxOpacity, base.fogMaxOpacity, 0, 1),
    fogColor: colorOf(raw.fogColor, base.fogColor),
    fogSkyColor: bool(raw.fogSkyColor, base.fogSkyColor),
    haze: bool(raw.haze, base.haze),
    hazeStrength: clamp(raw.hazeStrength, base.hazeStrength, 0, 3),
    hazeNear: clamp(raw.hazeNear, base.hazeNear, 1, 1000),
    stars: bool(raw.stars, base.stars),
    starIntensity: clamp(raw.starIntensity, base.starIntensity, 0, 4),
    starSize: clamp(raw.starSize, base.starSize, 0.2, 3),
    milkyWay: clamp(raw.milkyWay, base.milkyWay, 0, 2),
    moon: bool(raw.moon, base.moon),
    moonAngularDiameter: clamp(raw.moonAngularDiameter, base.moonAngularDiameter, 0.05, 12),
    moonPhase: clamp(raw.moonPhase, base.moonPhase, 0, 1),
    moonLight: clamp(raw.moonLight, base.moonLight, 0, 3),
    mirrorBelowHorizon: bool(raw.mirrorBelowHorizon, base.mirrorBelowHorizon),
  }
}

function clamp(value: unknown, fallback: number, min: number, max: number) {
  const next = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, next))
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function colorOf(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}
