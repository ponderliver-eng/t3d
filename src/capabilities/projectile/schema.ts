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
  label: 'projectile.title',
  fields: {
    enabled: { type: 'boolean', default: true, label: 'field.enable' },
    mode: {
      type: 'enum',
      default: 'linear',
      label: 'projectile.mode',
      options: [
        { value: 'linear', label: 'projectile.mode.linear' },
        { value: 'homing', label: 'projectile.mode.homing' },
        { value: 'ballistic', label: 'projectile.mode.ballistic' },
      ],
    },
    speed: { type: 'number', default: 22, min: 0.5, max: 200, step: 1, label: 'projectile.speed' },
    gravity: { type: 'number', default: 9.8, min: 0, max: 50, step: 0.5, label: 'projectile.gravity' },
    turnRate: { type: 'number', default: 6, min: 0.1, max: 30, step: 0.5, label: 'projectile.turn' },
    maxLifetime: { type: 'number', default: 3, min: 0.1, max: 60, step: 0.2, label: 'projectile.life' },
    hitRadius: { type: 'number', default: 0.65, min: 0.05, max: 10, step: 0.05, label: 'projectile.hitRadius' },
    targetTag: { type: 'string', default: 'enemy', label: 'projectile.targetTag' },
    damage: { type: 'number', default: 10, min: 0, max: 9999, step: 1, label: 'projectile.damage' },
    destroyOnHit: { type: 'boolean', default: true, label: 'projectile.destroy' },
  },
}

export function defaultProjectile(): ProjectileSpec {
  return defaultForSchema(PROJECTILE_SCHEMA) as ProjectileSpec
}

export function normalizeProjectile(raw: unknown): ProjectileSpec {
  return normalizeBySchema<ProjectileSpec>(PROJECTILE_SCHEMA, raw)
}
