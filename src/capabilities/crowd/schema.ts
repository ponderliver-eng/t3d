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
  label: 'crowd.title',
  fields: {
    enabled: { type: 'boolean', default: true, label: 'field.enable' },
    radius: { type: 'number', default: 0.8, min: 0.2, max: 10, step: 0.1, label: 'crowd.radius' },
    maxSpeed: { type: 'number', default: 4.5, min: 0.1, max: 50, step: 0.5, label: 'crowd.maxSpeed' },
    separationWeight: { type: 'number', default: 1.8, min: 0, max: 10, step: 0.1, label: 'crowd.separation' },
    cohesionWeight: { type: 'number', default: 0.25, min: 0, max: 5, step: 0.05, label: 'crowd.cohesion' },
    alignmentWeight: { type: 'number', default: 0.35, min: 0, max: 5, step: 0.05, label: 'crowd.alignment' },
    planeXZ: { type: 'boolean', default: true, label: 'crowd.planeXZ' },
    faceDirection: { type: 'boolean', default: true, label: 'crowd.face' },
  },
}

export function defaultCrowd(): CrowdSpec {
  return defaultForSchema(CROWD_SCHEMA) as CrowdSpec
}

export function normalizeCrowd(raw: unknown): CrowdSpec {
  return normalizeBySchema<CrowdSpec>(CROWD_SCHEMA, raw)
}
