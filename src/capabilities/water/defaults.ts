export const WATER_CAPABILITY_ID = 'water'

export type WaterQuality = 'fast' | 'balanced' | 'ultra'
export type WaterPresetId = 'tropical' | 'ocean' | 'lake' | 'pool' | 'stylized'

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
  crestFoam: number
  waveHeight: number
  reflectionScale: number
  normalMapAssetId: string | null
  foamMapAssetId: string | null
}

export const WATER_QUALITY_PRESETS: Record<WaterQuality, { reflectionScale: number, waveHeight: number }> = {
  fast: { reflectionScale: 0, waveHeight: 0 },
  balanced: { reflectionScale: 0.5, waveHeight: 0 },
  ultra: { reflectionScale: 0.75, waveHeight: 0.04 },
}

export const WATER_STYLE_PRESETS: Record<WaterPresetId, Omit<WaterSpec, 'enabled' | 'preset' | 'quality' | 'reflectionScale' | 'normalMapAssetId' | 'foamMapAssetId'>> = {
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
    crestFoam: 0.55,
    waveHeight: 0.2,
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
    crestFoam: 0.85,
    waveHeight: 0.75,
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
    crestFoam: 0.2,
    waveHeight: 0.04,
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
    crestFoam: 0,
    waveHeight: 0,
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
    crestFoam: 0.7,
    waveHeight: 0.43,
  },
}

export function defaultWater(): WaterSpec {
  return {
    enabled: false,
    preset: 'tropical',
    quality: 'balanced',
    ...WATER_STYLE_PRESETS.tropical,
    reflectionScale: WATER_QUALITY_PRESETS.balanced.reflectionScale,
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
    waveScale: finite(record.waveScale, base.waveScale, 0.02, 4),
    flowSpeed: finite(record.flowSpeed, base.flowSpeed, 0, 5),
    flowDirection: finite(record.flowDirection, base.flowDirection, 0, 360),
    fresnelPower: finite(record.fresnelPower, base.fresnelPower, 0.5, 10),
    reflectivity: finite(record.reflectivity, base.reflectivity, 0, 1),
    specularStrength: finite(record.specularStrength, base.specularStrength, 0, 5),
    specularSize: finite(record.specularSize, base.specularSize, 0.02, 1),
    sssStrength: finite(record.sssStrength, base.sssStrength, 0, 3),
    foamWidth: finite(record.foamWidth, base.foamWidth, 0, 4),
    foamIntensity: finite(record.foamIntensity, base.foamIntensity, 0, 3),
    crestFoam: finite(record.crestFoam, base.crestFoam, 0, 2),
    waveHeight: finite(record.waveHeight, base.waveHeight, 0, 2),
    reflectionScale: finite(record.reflectionScale, WATER_QUALITY_PRESETS[quality].reflectionScale, 0, 1),
    normalMapAssetId: typeof record.normalMapAssetId === 'string' ? record.normalMapAssetId : null,
    foamMapAssetId: typeof record.foamMapAssetId === 'string' ? record.foamMapAssetId : null,
  }
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
