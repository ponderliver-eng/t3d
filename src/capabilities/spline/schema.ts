import { defaultForSchema, normalizeBySchema, type ObjectFieldSchema } from '../../core/schema/fieldSchema'
import type { Vec3 } from '../../editor/scene/types'

export const SPLINE_CAPABILITY_ID = 'spline'
export const SPLINE_PATH_CAPABILITY_ID = 'splinePath'

export type SplinePlayMode = 'once' | 'loop' | 'pingPong'

export interface SplinePathData {
  points: Vec3[]
  closed: boolean
  tension: number
  color: string
}

export function defaultSplinePath(): SplinePathData {
  return {
    points: [
      [0, 0, 0],
      [3, 0, 2],
      [6, 0, -2],
      [9, 0, 0],
    ],
    closed: false,
    tension: 0.5,
    color: '#34d399',
  }
}

export function normalizeSplinePath(raw: unknown): SplinePathData {
  const def = defaultSplinePath()
  if (!raw || typeof raw !== 'object') return def
  const obj = raw as Record<string, unknown>
  const pts: Vec3[] = Array.isArray(obj.points)
    ? obj.points
        .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 3)
        .map((p) => [
          Number.isFinite(Number(p[0])) ? Number(p[0]) : 0,
          Number.isFinite(Number(p[1])) ? Number(p[1]) : 0,
          Number.isFinite(Number(p[2])) ? Number(p[2]) : 0,
        ])
    : def.points
  return {
    points: pts.length >= 2 ? pts : def.points,
    closed: typeof obj.closed === 'boolean' ? obj.closed : def.closed,
    tension: typeof obj.tension === 'number' && Number.isFinite(obj.tension)
      ? Math.max(0, Math.min(1, obj.tension))
      : def.tension,
    color: typeof obj.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(obj.color) ? obj.color : def.color,
  }
}

export interface SplineSpec {
  enabled: boolean
  pathNodeId: string | null
  mode: SplinePlayMode
  speed: number
  tension: number
  closed: boolean
  faceDirection: boolean
  planeXZ: boolean
  autoStart: boolean
  startProgress: number
}

export const SPLINE_SCHEMA: ObjectFieldSchema = {
  type: 'object',
  label: 'spline.title',
  fields: {
    enabled: { type: 'boolean', default: true, label: 'field.enable' },
    pathNodeId: { type: 'ref', target: 'node', kinds: ['spline'], default: null, label: 'spline.pathNode' },
    mode: {
      type: 'enum',
      default: 'loop',
      label: 'spline.mode',
      options: [
        { value: 'once', label: 'spline.mode.once' },
        { value: 'loop', label: 'spline.mode.loop' },
        { value: 'pingPong', label: 'spline.mode.pingPong' },
      ],
    },
    speed: { type: 'number', default: 4, min: 0.05, max: 200, step: 0.5, label: 'spline.speed' },
    tension: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.05, label: 'spline.curveTension' },
    closed: { type: 'boolean', default: false, label: 'field.closed' },
    faceDirection: { type: 'boolean', default: true, label: 'spline.face' },
    planeXZ: { type: 'boolean', default: false, label: 'spline.planeXZ' },
    autoStart: { type: 'boolean', default: true, label: 'spline.autoStart' },
    startProgress: { type: 'number', default: 0, min: 0, max: 1, step: 0.05, label: 'spline.start' },
  },
}

export function defaultSpline(): SplineSpec {
  return defaultForSchema(SPLINE_SCHEMA) as SplineSpec
}

export function normalizeSpline(raw: unknown): SplineSpec {
  return normalizeBySchema<SplineSpec>(SPLINE_SCHEMA, raw)
}
