import type { ObjectFieldSchema } from '../../core/schema/fieldSchema'

/** 水体能力包字段说明（FieldSchema 样板） */
export const WATER_SCHEMA: ObjectFieldSchema = {
  type: 'object',
  label: 'water.schema',
  fields: {
    enabled: { type: 'boolean', default: true, label: 'field.enable' },
    preset: {
      type: 'enum',
      default: 'tropical',
      label: 'water.style',
      options: [
        { value: 'tropical', label: 'water.preset.tropical' },
        { value: 'ocean', label: 'water.preset.ocean' },
        { value: 'lake', label: 'water.preset.lake' },
        { value: 'pool', label: 'water.preset.pool' },
        { value: 'stylized', label: 'water.preset.stylized' },
      ],
    },
    quality: {
      type: 'enum',
      default: 'balanced',
      label: 'water.quality',
      options: [
        { value: 'fast', label: 'water.quality.fast' },
        { value: 'balanced', label: 'water.quality.balanced' },
        { value: 'ultra', label: 'water.quality.ultra' },
      ],
    },
    shallowColor: { type: 'color', default: '#2dd4bf', label: 'water.shallow' },
    deepColor: { type: 'color', default: '#0c4a6e', label: 'water.deep' },
    foamColor: { type: 'color', default: '#f8fafc', label: 'water.foamColor' },
    opacity: { type: 'number', default: 0.9, min: 0.1, max: 1, step: 0.01, label: 'water.opacity' },
    waveHeight: { type: 'number', default: 0.35, min: 0, max: 4, step: 0.05, label: 'water.waveHeight' },
    waveSpeed: { type: 'number', default: 1, min: 0, max: 4, step: 0.05, label: 'water.waveSpeed' },
    swellRate: { type: 'number', default: 1, min: 0, max: 4, step: 0.05, label: 'water.swellRate' },
    waveSteepness: { type: 'number', default: 0.55, min: 0, max: 1, step: 0.01, label: 'water.waveSteepness' },
    waveBend: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: 'water.waveBend' },
    waveLean: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: 'water.waveLean' },
    crestSharpness: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: 'water.crestSharpness' },
    crestFoam: { type: 'number', default: 0.85, min: 0, max: 2, step: 0.05, label: 'water.crestFoam' },
    crestFoamThreshold: { type: 'number', default: 0.55, min: 0, max: 1, step: 0.01, label: 'water.crestThreshold' },
    foamTrail: { type: 'number', default: 1, min: 0, max: 1.5, step: 0.05, label: 'water.foamTrail' },
    flowSpeed: { type: 'number', default: 0.45, min: 0, max: 3, step: 0.05, label: 'water.flowSpeed' },
    flowDirection: { type: 'number', default: 35, min: 0, max: 360, step: 1, label: 'water.flowDir' },
    sssStrength: { type: 'number', default: 0.5, min: 0, max: 2, step: 0.05, label: 'water.sss' },
  },
}
