import { defaultForSchema, normalizeBySchema, type ObjectFieldSchema } from '../../core/schema/fieldSchema'

export const CROWD_CAPABILITY_ID = 'crowd'

export type CrowdFormationType = 'line' | 'grid' | 'wedge' | 'circle'

export interface CrowdSpec {
  enabled: boolean
  radius: number
  maxSpeed: number
  separationWeight: number
  cohesionWeight: number
  alignmentWeight: number
  planeXZ: boolean
  faceDirection: boolean
}

export const CROWD_SCHEMA: ObjectFieldSchema = {
  type: 'object',
  label: '群体避让 (Crowd)',
  fields: {
    enabled: { type: 'boolean', default: true, label: '启用' },
    radius: { type: 'number', default: 0.8, min: 0.2, max: 10, step: 0.1, label: '避让半径 (m)' },
    maxSpeed: { type: 'number', default: 4.5, min: 0.1, max: 50, step: 0.5, label: '最大速度 (m/s)' },
    separationWeight: { type: 'number', default: 1.8, min: 0, max: 10, step: 0.1, label: '分离权重' },
    cohesionWeight: { type: 'number', default: 0.25, min: 0, max: 5, step: 0.05, label: '凝聚权重' },
    alignmentWeight: { type: 'number', default: 0.35, min: 0, max: 5, step: 0.05, label: '对齐权重' },
    planeXZ: { type: 'boolean', default: true, label: 'XZ 平面移动' },
    faceDirection: { type: 'boolean', default: true, label: '朝向移动方向' },
  },
}

export function defaultCrowd(): CrowdSpec {
  return defaultForSchema(CROWD_SCHEMA) as CrowdSpec
}

export function normalizeCrowd(raw: unknown): CrowdSpec {
  return normalizeBySchema<CrowdSpec>(CROWD_SCHEMA, raw)
}
