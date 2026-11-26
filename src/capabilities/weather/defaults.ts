export const WEATHER_CAPABILITY_ID = 'weather' as const

export type WeatherPreset = 'custom' | 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'sandstorm'
export type PrecipitationType = 'none' | 'rain' | 'snow' | 'sand'

/** 画面级天气系统参数（云层 + 降水粒子 + 地面湿润/积雪 + 雷暴闪电）。只存可序列化字段，不引用 Three.js。 */
export interface WeatherSettings {
  enabled: boolean
  preset: WeatherPreset

  // ── 1. 天空双层云（低空积云 + 高空卷云） ──
  cloudsEnabled: boolean
  /** 云量覆盖率 (0 ~ 1) */
  cloudCoverage: number
  /** 云体厚度与浓度 (0 ~ 2) */
  cloudDensity: number
  /** 云层基准高度 (m) */
  cloudAltitude: number
  /** 云朵水平尺度倍率 (0.2 ~ 4) */
  cloudScale: number
  /** 风速 (m/s) */
  cloudWindSpeed: number
  /** 风向角度 (0 ~ 360°) */
  cloudWindAngle: number
  /** 太阳方向银边/前向散射强度 (0 ~ 2) */
  cloudSilverLining: number
  /** 云底自阴影浓度 (0 ~ 1) */
  cloudShadowStrength: number
  /** 云基础色调 */
  cloudTint: string
  /** 高空丝缕卷云子开关 */
  cirrusEnabled: boolean
  /** 高空卷云覆盖率 (0 ~ 1) */
  cirrusCoverage: number

  // ── 2. 降水粒子（相机跟随 GPU 环绕盒） ──
  precipitationType: PrecipitationType
  /** 降水密度与不透明度 (0 ~ 1) */
  precipitationIntensity: number
  /** 下落/飘落速度倍率 (0.2 ~ 3) */
  precipitationSpeed: number
  /** 横向风偏斜强度 (0 ~ 20) */
  precipitationWind: number
  /** 粒子颜色 */
  precipitationColor: string
  /** 相机环绕降水盒边长 (m) */
  precipitationBoxSize: number
  /** 地面水花/扬尘扰动开关 */
  splashEnabled: boolean

  // ── 3. 表面湿润与积水（零改造默认支持所有标准材质） ──
  wetnessEnabled: boolean
  /** 表面湿润度 (0 ~ 1) */
  wetness: number
  /** 水平地面低洼积水坑覆盖率 (0 ~ 1) */
  puddleAmount: number
  /** 雨滴落入水坑的动态涟漪开关 */
  ripplesEnabled: boolean

  // ── 4. 表面积雪覆盖（零改造默认支持所有标准材质） ──
  snowCoverEnabled: boolean
  /** 表面积雪覆盖度 (0 ~ 1) */
  snowCover: number
  /** 积雪颜色 */
  snowColor: string

  // ── 5. 雷暴闪电 ──
  lightningEnabled: boolean
  /** 闪电频率 (0.1 ~ 2 次/十秒级别) */
  lightningFrequency: number
  /** 闪电瞬间闪光强度 (0.5 ~ 5) */
  lightningIntensity: number
}

export function defaultWeatherSettings(): WeatherSettings {
  return {
    enabled: true,
    preset: 'clear',

    cloudsEnabled: true,
    cloudCoverage: 0.45,
    cloudDensity: 1.0,
    cloudAltitude: 600,
    cloudScale: 1.0,
    cloudWindSpeed: 4,
    cloudWindAngle: 35,
    cloudSilverLining: 0.9,
    cloudShadowStrength: 0.6,
    cloudTint: '#ffffff',
    cirrusEnabled: true,
    cirrusCoverage: 0.35,

    precipitationType: 'none',
    precipitationIntensity: 0.7,
    precipitationSpeed: 1.0,
    precipitationWind: 2.5,
    precipitationColor: '#dce9f7',
    precipitationBoxSize: 28,
    splashEnabled: true,

    wetnessEnabled: false,
    wetness: 0.65,
    puddleAmount: 0.45,
    ripplesEnabled: true,

    snowCoverEnabled: false,
    snowCover: 0.65,
    snowColor: '#eef5ff',

    lightningEnabled: false,
    lightningFrequency: 0.6,
    lightningIntensity: 2.5,
  }
}

export function weatherPresetPatch(preset: Exclude<WeatherPreset, 'custom'>): Partial<WeatherSettings> {
  switch (preset) {
    case 'clear':
      return {
        preset: 'clear',
        cloudsEnabled: true,
        cloudCoverage: 0.38,
        cloudDensity: 0.9,
        cloudSilverLining: 0.95,
        cloudShadowStrength: 0.5,
        cloudTint: '#ffffff',
        cirrusEnabled: true,
        cirrusCoverage: 0.35,
        precipitationType: 'none',
        wetnessEnabled: false,
        snowCoverEnabled: false,
        lightningEnabled: false,
      }
    case 'cloudy':
      return {
        preset: 'cloudy',
        cloudsEnabled: true,
        cloudCoverage: 0.72,
        cloudDensity: 1.25,
        cloudSilverLining: 0.75,
        cloudShadowStrength: 0.75,
        cloudTint: '#e2e8f0',
        cirrusEnabled: true,
        cirrusCoverage: 0.5,
        precipitationType: 'none',
        wetnessEnabled: false,
        snowCoverEnabled: false,
        lightningEnabled: false,
      }
    case 'rain':
      return {
        preset: 'rain',
        cloudsEnabled: true,
        cloudCoverage: 0.82,
        cloudDensity: 1.35,
        cloudSilverLining: 0.55,
        cloudShadowStrength: 0.55,
        cloudTint: '#d0d9e6',
        cirrusEnabled: false,
        precipitationType: 'rain',
        precipitationIntensity: 0.85,
        precipitationSpeed: 1.15,
        precipitationWind: 3.5,
        precipitationColor: '#d8e8fa',
        splashEnabled: true,
        wetnessEnabled: true,
        wetness: 0.75,
        puddleAmount: 0.58,
        ripplesEnabled: true,
        snowCoverEnabled: false,
        lightningEnabled: false,
      }
    case 'storm':
      return {
        preset: 'storm',
        cloudsEnabled: true,
        cloudCoverage: 0.92,
        cloudDensity: 1.65,
        cloudSilverLining: 0.45,
        cloudShadowStrength: 0.72,
        cloudTint: '#9ba8ba',
        cirrusEnabled: false,
        precipitationType: 'rain',
        precipitationIntensity: 1.0,
        precipitationSpeed: 1.45,
        precipitationWind: 8.5,
        precipitationColor: '#c9dcf2',
        splashEnabled: true,
        wetnessEnabled: true,
        wetness: 0.92,
        puddleAmount: 0.76,
        ripplesEnabled: true,
        snowCoverEnabled: false,
        lightningEnabled: true,
        lightningFrequency: 0.85,
        lightningIntensity: 3.0,
      }
    case 'snow':
      return {
        preset: 'snow',
        cloudsEnabled: true,
        cloudCoverage: 0.76,
        cloudDensity: 1.15,
        cloudSilverLining: 0.65,
        cloudShadowStrength: 0.45,
        cloudTint: '#f2f6fc',
        cirrusEnabled: true,
        cirrusCoverage: 0.4,
        precipitationType: 'snow',
        precipitationIntensity: 0.92,
        precipitationSpeed: 0.85,
        precipitationWind: 2.2,
        precipitationColor: '#f7fbff',
        splashEnabled: false,
        wetnessEnabled: false,
        snowCoverEnabled: true,
        snowCover: 0.72,
        snowColor: '#eef5ff',
        lightningEnabled: false,
      }
    case 'sandstorm':
      return {
        preset: 'sandstorm',
        cloudsEnabled: true,
        cloudCoverage: 0.65,
        cloudDensity: 1.3,
        cloudSilverLining: 0.5,
        cloudShadowStrength: 0.65,
        cloudTint: '#e5c69e',
        cirrusEnabled: false,
        precipitationType: 'sand',
        precipitationIntensity: 0.85,
        precipitationSpeed: 1.4,
        precipitationWind: 14,
        precipitationColor: '#d9b07e',
        splashEnabled: true,
        wetnessEnabled: false,
        snowCoverEnabled: false,
        lightningEnabled: false,
      }
  }
}

const PRESETS: readonly WeatherPreset[] = ['custom', 'clear', 'cloudy', 'rain', 'storm', 'snow', 'sandstorm']
const PRECIPITATIONS: readonly PrecipitationType[] = ['none', 'rain', 'snow', 'sand']

export function normalizeWeatherSettings(value: unknown): WeatherSettings {
  const base = defaultWeatherSettings()
  if (!value || typeof value !== 'object') return base
  const raw = value as Partial<WeatherSettings>
  return {
    enabled: bool(raw.enabled, base.enabled),
    preset: typeof raw.preset === 'string' && PRESETS.includes(raw.preset as WeatherPreset) ? (raw.preset as WeatherPreset) : base.preset,

    cloudsEnabled: bool(raw.cloudsEnabled, base.cloudsEnabled),
    cloudCoverage: clamp(raw.cloudCoverage, base.cloudCoverage, 0, 1),
    cloudDensity: clamp(raw.cloudDensity, base.cloudDensity, 0, 2),
    cloudAltitude: clamp(raw.cloudAltitude, base.cloudAltitude, 100, 3000),
    cloudScale: clamp(raw.cloudScale, base.cloudScale, 0.2, 4),
    cloudWindSpeed: clamp(raw.cloudWindSpeed, base.cloudWindSpeed, 0, 30),
    cloudWindAngle: clamp(raw.cloudWindAngle, base.cloudWindAngle, 0, 360),
    cloudSilverLining: clamp(raw.cloudSilverLining, base.cloudSilverLining, 0, 2),
    cloudShadowStrength: clamp(raw.cloudShadowStrength, base.cloudShadowStrength, 0, 1),
    cloudTint: colorOf(raw.cloudTint, base.cloudTint),
    cirrusEnabled: bool(raw.cirrusEnabled, base.cirrusEnabled),
    cirrusCoverage: clamp(raw.cirrusCoverage, base.cirrusCoverage, 0, 1),

    precipitationType: typeof raw.precipitationType === 'string' && PRECIPITATIONS.includes(raw.precipitationType as PrecipitationType)
      ? (raw.precipitationType as PrecipitationType)
      : base.precipitationType,
    precipitationIntensity: clamp(raw.precipitationIntensity, base.precipitationIntensity, 0, 1),
    precipitationSpeed: clamp(raw.precipitationSpeed, base.precipitationSpeed, 0.2, 3),
    precipitationWind: clamp(raw.precipitationWind, base.precipitationWind, 0, 20),
    precipitationColor: colorOf(raw.precipitationColor, base.precipitationColor),
    precipitationBoxSize: clamp(raw.precipitationBoxSize, base.precipitationBoxSize, 12, 60),
    splashEnabled: bool(raw.splashEnabled, base.splashEnabled),

    wetnessEnabled: bool(raw.wetnessEnabled, base.wetnessEnabled),
    wetness: clamp(raw.wetness, base.wetness, 0, 1),
    puddleAmount: clamp(raw.puddleAmount, base.puddleAmount, 0, 1),
    ripplesEnabled: bool(raw.ripplesEnabled, base.ripplesEnabled),

    snowCoverEnabled: bool(raw.snowCoverEnabled, base.snowCoverEnabled),
    snowCover: clamp(raw.snowCover, base.snowCover, 0, 1),
    snowColor: colorOf(raw.snowColor, base.snowColor),

    lightningEnabled: bool(raw.lightningEnabled, base.lightningEnabled),
    lightningFrequency: clamp(raw.lightningFrequency, base.lightningFrequency, 0.1, 2),
    lightningIntensity: clamp(raw.lightningIntensity, base.lightningIntensity, 0.5, 5),
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
