export const WEATHER_CAPABILITY_ID = 'weather' as const

export type WeatherPreset = 'custom' | 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'sandstorm'
export type PrecipitationType = 'none' | 'rain' | 'snow' | 'sand'

/** 画面级天气系统参数（三层大气云系 + 降水/沙尘暴粒子 + 表面湿润/雨滴流淌/积雪 + 雷暴闪电）。只存可序列化字段，不引用 Three.js。 */
export interface WeatherSettings {
  enabled: boolean
  preset: WeatherPreset

  // ── 1. 天空三层大气云系（低空体积积云 + 中空层积云 + 高空流线卷云） ──
  cloudsEnabled: boolean
  /** 低空 3D 体积积云层开关（16 步高预算体渲染） */
  lowCloudsEnabled: boolean
  /** 中空高积云/层云层开关（视差层） */
  midCloudsEnabled: boolean
  /** 高空流线冰晶卷云层开关 */
  highCloudsEnabled: boolean
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
  /** 兼容旧字段：高空卷云子开关 */
  cirrusEnabled: boolean
  /** 高空卷云覆盖率 (0 ~ 1) */
  cirrusCoverage: number

  // ── 2. 降水与沙尘暴粒子（相机跟随三层环绕盒） ──
  precipitationType: PrecipitationType
  /** 降水密度与不透明度 (0 ~ 1) */
  precipitationIntensity: number
  /** 下落/翻滚速度倍率 (0.2 ~ 3) */
  precipitationSpeed: number
  /** 横向风偏斜强度 (0 ~ 20) */
  precipitationWind: number
  /** 粒子颜色 */
  precipitationColor: string
  /** 相机环绕降水盒边长 (m) */
  precipitationBoxSize: number
  /** 雨丝速度拉伸长度倍率 (0.05 ~ 1) */
  rainStreakLength: number
  /** 雨丝显示强度/可见度 (0.2 ~ 3) */
  rainStreakIntensity: number
  /** 空中雨丝屏幕空间折射开关（关闭可节省一次半分辨率离屏 Pass） */
  rainRefractionEnabled: boolean
  /** 雪花粒子尺寸倍率 (0.3 ~ 2) */
  snowParticleSize: number
  /** 雪花飘落左右随机摆动幅度 (0 ~ 3) */
  snowSway: number
  /** 沙尘暴大气能见度黄沙雾化浓度 (0 ~ 1) */
  sandstormHaze: number
  /** 地面水花扰动开关 */
  splashEnabled: boolean

  // ── 3. 表面湿润、水坑涟漪与物体表面雨滴流淌（零改造默认支持所有标准材质） ──
  wetnessEnabled: boolean
  /** 表面湿润度 (0 ~ 1) */
  wetness: number
  /** 水平地面低洼积水坑覆盖率 (0 ~ 1) */
  puddleAmount: number
  /** 雨滴落入水坑的动态涟漪开关 */
  ripplesEnabled: boolean
  /** 地面水坑涟漪数量占比 (0.05 ~ 1，控制出现概率而非缩放 Tile) */
  rippleDensity: number
  /** 地面水坑涟漪显示强度 (0 ~ 2) */
  rippleIntensity: number
  /** 角色与物体表面雨滴流淌水痕开关 */
  rainDripsEnabled: boolean
  /** 角色与物体表面水滴数量 (0.05 ~ 3，控制水珠出现概率与多级流道密度) */
  rainDripsDensity: number
  /** 角色与物体表面水滴折射与高光强度 (0 ~ 2) */
  rainDripsIntensity: number
  /** 角色与物体表面流淌水滴粗细倍率 (0.3 ~ 2.5) */
  rainDripsScale: number
  /** 物体表面雨滴流淌速度 (0.2 ~ 3) */
  rainDripsSpeed: number

  // ── 4. 表面积雪覆盖（保留实时地面阴影与冷色雪影） ──
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
    lowCloudsEnabled: true,
    midCloudsEnabled: false,
    highCloudsEnabled: true,
    cloudCoverage: 0.45,
    cloudDensity: 1.0,
    cloudAltitude: 600,
    cloudScale: 1.0,
    cloudWindSpeed: 4,
    cloudWindAngle: 35,
    cloudSilverLining: 0.95,
    cloudShadowStrength: 0.6,
    cloudTint: '#ffffff',
    cirrusEnabled: true,
    cirrusCoverage: 0.4,

    precipitationType: 'none',
    precipitationIntensity: 0.75,
    precipitationSpeed: 1.0,
    precipitationWind: 2.5,
    precipitationColor: '#dce9f7',
    precipitationBoxSize: 28,
    rainStreakLength: 0.45,
    rainStreakIntensity: 1.2,
    rainRefractionEnabled: true,
    snowParticleSize: 1.0,
    snowSway: 1.0,
    sandstormHaze: 0.75,
    splashEnabled: true,

    wetnessEnabled: false,
    wetness: 0.65,
    puddleAmount: 0.45,
    ripplesEnabled: true,
    rippleDensity: 0.65,
    rippleIntensity: 1.0,
    rainDripsEnabled: true,
    rainDripsDensity: 0.55,
    rainDripsIntensity: 1.0,
    rainDripsScale: 1.0,
    rainDripsSpeed: 1.0,

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
        lowCloudsEnabled: true,
        midCloudsEnabled: false,
        highCloudsEnabled: true,
        cloudCoverage: 0.42,
        cloudDensity: 0.95,
        cloudSilverLining: 1.0,
        cloudShadowStrength: 0.52,
        cloudTint: '#ffffff',
        cirrusEnabled: true,
        cirrusCoverage: 0.38,
        precipitationType: 'none',
        wetnessEnabled: false,
        snowCoverEnabled: false,
        lightningEnabled: false,
      }
    case 'cloudy':
      return {
        preset: 'cloudy',
        cloudsEnabled: true,
        lowCloudsEnabled: true,
        midCloudsEnabled: true,
        highCloudsEnabled: true,
        cloudCoverage: 0.72,
        cloudDensity: 1.25,
        cloudSilverLining: 0.8,
        cloudShadowStrength: 0.72,
        cloudTint: '#e2e8f0',
        cirrusEnabled: true,
        cirrusCoverage: 0.55,
        precipitationType: 'none',
        wetnessEnabled: false,
        snowCoverEnabled: false,
        lightningEnabled: false,
      }
    case 'rain':
      return {
        preset: 'rain',
        cloudsEnabled: true,
        lowCloudsEnabled: true,
        midCloudsEnabled: true,
        highCloudsEnabled: false,
        cloudCoverage: 0.84,
        cloudDensity: 1.45,
        cloudSilverLining: 0.90,
        cloudShadowStrength: 0.78,
        cloudTint: '#cfd8e6',
        cirrusEnabled: false,
        precipitationType: 'rain',
        precipitationIntensity: 0.85,
        precipitationSpeed: 1.15,
        precipitationWind: 3.5,
        precipitationColor: '#d8e8fa',
        rainStreakLength: 0.50,
        splashEnabled: true,
        wetnessEnabled: true,
        wetness: 0.78,
        puddleAmount: 0.58,
        ripplesEnabled: true,
        rippleDensity: 0.68,
        rippleIntensity: 1.0,
        rainDripsEnabled: true,
        rainDripsDensity: 0.58,
        rainDripsIntensity: 1.0,
        rainDripsSpeed: 1.0,
        snowCoverEnabled: false,
        lightningEnabled: false,
      }
    case 'storm':
      return {
        preset: 'storm',
        cloudsEnabled: true,
        lowCloudsEnabled: true,
        midCloudsEnabled: true,
        highCloudsEnabled: false,
        cloudCoverage: 0.92,
        cloudDensity: 1.75,
        cloudSilverLining: 0.95,
        cloudShadowStrength: 0.90,
        cloudTint: '#9aa8ba',
        cirrusEnabled: false,
        precipitationType: 'rain',
        precipitationIntensity: 1.0,
        precipitationSpeed: 1.45,
        precipitationWind: 8.5,
        precipitationColor: '#c9dcf2',
        rainStreakLength: 0.75,
        splashEnabled: true,
        wetnessEnabled: true,
        wetness: 0.92,
        puddleAmount: 0.76,
        ripplesEnabled: true,
        rippleDensity: 0.88,
        rippleIntensity: 1.25,
        rainDripsEnabled: true,
        rainDripsDensity: 0.78,
        rainDripsIntensity: 1.2,
        rainDripsSpeed: 1.4,
        snowCoverEnabled: false,
        lightningEnabled: true,
        lightningFrequency: 0.85,
        lightningIntensity: 3.0,
      }
    case 'snow':
      return {
        preset: 'snow',
        cloudsEnabled: true,
        lowCloudsEnabled: true,
        midCloudsEnabled: true,
        highCloudsEnabled: false,
        cloudCoverage: 0.76,
        cloudDensity: 1.15,
        cloudSilverLining: 0.65,
        cloudShadowStrength: 0.48,
        cloudTint: '#f2f6fc',
        cirrusEnabled: false,
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
        lowCloudsEnabled: true,
        midCloudsEnabled: true,
        highCloudsEnabled: false,
        cloudCoverage: 0.78,
        cloudDensity: 1.45,
        cloudSilverLining: 0.45,
        cloudShadowStrength: 0.68,
        cloudTint: '#dfbc92',
        cirrusEnabled: false,
        precipitationType: 'sand',
        precipitationIntensity: 0.92,
        precipitationSpeed: 1.35,
        precipitationWind: 14,
        precipitationColor: '#d8ab74',
        sandstormHaze: 0.82,
        splashEnabled: false,
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
    lowCloudsEnabled: bool(raw.lowCloudsEnabled, base.lowCloudsEnabled),
    midCloudsEnabled: bool(raw.midCloudsEnabled, base.midCloudsEnabled),
    highCloudsEnabled: bool(raw.highCloudsEnabled, bool(raw.cirrusEnabled, base.highCloudsEnabled)),
    cloudCoverage: clamp(raw.cloudCoverage, base.cloudCoverage, 0, 1),
    cloudDensity: clamp(raw.cloudDensity, base.cloudDensity, 0, 2),
    cloudAltitude: clamp(raw.cloudAltitude, base.cloudAltitude, 100, 3000),
    cloudScale: clamp(raw.cloudScale, base.cloudScale, 0.2, 4),
    cloudWindSpeed: clamp(raw.cloudWindSpeed, base.cloudWindSpeed, 0, 30),
    cloudWindAngle: clamp(raw.cloudWindAngle, base.cloudWindAngle, 0, 360),
    cloudSilverLining: clamp(raw.cloudSilverLining, base.cloudSilverLining, 0, 2),
    cloudShadowStrength: clamp(raw.cloudShadowStrength, base.cloudShadowStrength, 0, 1),
    cloudTint: colorOf(raw.cloudTint, base.cloudTint),
    cirrusEnabled: bool(raw.highCloudsEnabled, bool(raw.cirrusEnabled, base.cirrusEnabled)),
    cirrusCoverage: clamp(raw.cirrusCoverage, base.cirrusCoverage, 0, 1),

    precipitationType: typeof raw.precipitationType === 'string' && PRECIPITATIONS.includes(raw.precipitationType as PrecipitationType)
      ? (raw.precipitationType as PrecipitationType)
      : base.precipitationType,
    precipitationIntensity: clamp(raw.precipitationIntensity, base.precipitationIntensity, 0, 1),
    precipitationSpeed: clamp(raw.precipitationSpeed, base.precipitationSpeed, 0.2, 3),
    precipitationWind: clamp(raw.precipitationWind, base.precipitationWind, 0, 20),
    precipitationColor: colorOf(raw.precipitationColor, base.precipitationColor),
    precipitationBoxSize: clamp(raw.precipitationBoxSize, base.precipitationBoxSize, 12, 60),
    rainStreakLength: clamp(raw.rainStreakLength, base.rainStreakLength, 0.05, 1),
    rainStreakIntensity: clamp(raw.rainStreakIntensity, base.rainStreakIntensity, 0.2, 3),
    rainRefractionEnabled: bool(raw.rainRefractionEnabled, base.rainRefractionEnabled),
    snowParticleSize: clamp(raw.snowParticleSize, base.snowParticleSize, 0.3, 2),
    snowSway: clamp(raw.snowSway, base.snowSway, 0, 3),
    sandstormHaze: clamp(raw.sandstormHaze, base.sandstormHaze, 0, 1),
    splashEnabled: bool(raw.splashEnabled, base.splashEnabled),

    wetnessEnabled: bool(raw.wetnessEnabled, base.wetnessEnabled),
    wetness: clamp(raw.wetness, base.wetness, 0, 1),
    puddleAmount: clamp(raw.puddleAmount, base.puddleAmount, 0, 1),
    ripplesEnabled: bool(raw.ripplesEnabled, base.ripplesEnabled),
    rippleDensity: clamp(raw.rippleDensity, base.rippleDensity, 0.05, 1),
    rippleIntensity: clamp(raw.rippleIntensity, base.rippleIntensity, 0, 2),
    rainDripsEnabled: bool(raw.rainDripsEnabled, base.rainDripsEnabled),
    rainDripsDensity: clamp(raw.rainDripsDensity, base.rainDripsDensity, 0.05, 3),
    rainDripsIntensity: clamp(raw.rainDripsIntensity, base.rainDripsIntensity, 0, 2),
    rainDripsScale: clamp(raw.rainDripsScale, base.rainDripsScale, 0.3, 2.5),
    rainDripsSpeed: clamp(raw.rainDripsSpeed, base.rainDripsSpeed, 0.2, 3),

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
