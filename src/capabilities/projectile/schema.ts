import { defaultForSchema, normalizeBySchema, type ObjectFieldSchema } from '../../core/schema/fieldSchema'

export const PROJECTILE_CAPABILITY_ID = 'projectile'

export type ProjectileMode = 'linear' | 'homing' | 'ballistic'

export interface ProjectileSpec {
  enabled: boolean
  mode: ProjectileMode
  speed: number
  gravity: number
  turnRate: number
  maxLifetime: number
  hitRadius: number
  targetTag: string
  damage: number
  destroyOnHit: boolean
}

export const PROJECTILE_SCHEMA: ObjectFieldSchema = {
  type: 'object',
  label: '通用弹道 (Projectile)',
  fields: {
    enabled: { type: 'boolean', default: true, label: '启用' },
    mode: {
      type: 'enum',
      default: 'linear',
      label: '弹道模式',
      options: [
        { value: 'linear', label: '直线飞行' },
        { value: 'homing', label: '自动追踪' },
        { value: 'ballistic', label: '抛物线' },
      ],
    },
    speed: { type: 'number', default: 22, min: 0.5, max: 200, step: 1, label: '飞行速度 (m/s)' },
    gravity: { type: 'number', default: 9.8, min: 0, max: 50, step: 0.5, label: '重力加速度' },
    turnRate: { type: 'number', default: 6, min: 0.1, max: 30, step: 0.5, label: '追踪转向率 (rad/s)' },
    maxLifetime: { type: 'number', default: 3, min: 0.1, max: 60, step: 0.2, label: '最大寿命 (s)' },
    hitRadius: { type: 'number', default: 0.65, min: 0.05, max: 10, step: 0.05, label: '命中判定半径 (m)' },
    targetTag: { type: 'string', default: 'enemy', label: '目标标签' },
    damage: { type: 'number', default: 10, min: 0, max: 9999, step: 1, label: '伤害值' },
    destroyOnHit: { type: 'boolean', default: true, label: '命中后回池/销毁' },
  },
}

export function defaultProjectile(): ProjectileSpec {
  return defaultForSchema(PROJECTILE_SCHEMA) as ProjectileSpec
}

export function normalizeProjectile(raw: unknown): ProjectileSpec {
  return normalizeBySchema<ProjectileSpec>(PROJECTILE_SCHEMA, raw)
}
