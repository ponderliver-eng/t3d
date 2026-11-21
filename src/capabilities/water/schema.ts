import type { ObjectFieldSchema } from '../../core/schema/fieldSchema'

/** 水体能力包字段说明（FieldSchema 样板） */
export const WATER_SCHEMA: ObjectFieldSchema = {
  type: 'object',
  label: '水体参数',
  fields: {
    enabled: { type: 'boolean', default: true, label: '启用' },
    preset: {
      type: 'enum',
      default: 'tropical',
      label: '水体预设',
      options: [
        { value: 'tropical', label: '热带海' },
        { value: 'ocean', label: '深海' },
        { value: 'lake', label: '湖泊' },
        { value: 'pool', label: '泳池' },
        { value: 'stylized', label: '风格化' },
      ],
    },
    quality: {
      type: 'enum',
      default: 'balanced',
      label: '画质档位',
      options: [
        { value: 'fast', label: '流畅' },
        { value: 'balanced', label: '均衡' },
        { value: 'ultra', label: '高画质' },
      ],
    },
    shallowColor: { type: 'color', default: '#2dd4bf', label: '浅水色' },
    deepColor: { type: 'color', default: '#0c4a6e', label: '深水色' },
    foamColor: { type: 'color', default: '#f8fafc', label: '泡沫颜色' },
    opacity: { type: 'number', default: 0.9, min: 0.1, max: 1, step: 0.01, label: '不透明度' },
    waveHeight: { type: 'number', default: 0.35, min: 0, max: 4, step: 0.05, label: '浪高' },
    waveSpeed: { type: 'number', default: 1, min: 0, max: 4, step: 0.05, label: '浪速' },
    swellRate: { type: 'number', default: 1, min: 0, max: 4, step: 0.05, label: '起落频率' },
    waveSteepness: { type: 'number', default: 0.55, min: 0, max: 1, step: 0.01, label: '波峰聚拢度' },
    waveBend: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: '浪线蜿蜒' },
    waveLean: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: '浪尖卷曲' },
    crestSharpness: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: '浪尖锐度' },
    crestFoam: { type: 'number', default: 0.85, min: 0, max: 2, step: 0.05, label: '波峰泡沫' },
    crestFoamThreshold: { type: 'number', default: 0.55, min: 0, max: 1, step: 0.01, label: '泡沫阈值' },
    foamTrail: { type: 'number', default: 1, min: 0, max: 1.5, step: 0.05, label: '泡沫拖尾' },
    flowSpeed: { type: 'number', default: 0.45, min: 0, max: 3, step: 0.05, label: '水流速度' },
    flowDirection: { type: 'number', default: 35, min: 0, max: 360, step: 1, label: '流向角度' },
    sssStrength: { type: 'number', default: 0.5, min: 0, max: 2, step: 0.05, label: '次表面散射' },
  },
}
