import { defaultForSchema, normalizeBySchema, type ObjectFieldSchema } from '../../core/schema/fieldSchema'

export const SPLINE_CAPABILITY_ID = 'spline'

export type SplinePlayMode = 'once' | 'loop' | 'pingPong'

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
  label: 'Spline 路径运动',
  fields: {
    enabled: { type: 'boolean', default: true, label: '启用' },
    pathNodeId: { type: 'ref', target: 'node', default: null, label: '路径父节点（取其子节点为路点）' },
    mode: {
      type: 'enum',
      default: 'loop',
      label: '运行模式',
      options: [
        { value: 'once', label: '单次到达' },
        { value: 'loop', label: '循环' },
        { value: 'pingPong', label: '往返' },
      ],
    },
    speed: { type: 'number', default: 4, min: 0.05, max: 200, step: 0.5, label: '移动速度 (m/s)' },
    tension: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.05, label: '曲线张力' },
    closed: { type: 'boolean', default: false, label: '闭合曲线' },
    faceDirection: { type: 'boolean', default: true, label: '朝向路径切线' },
    planeXZ: { type: 'boolean', default: false, label: '保持当前高度 (XZ)' },
    autoStart: { type: 'boolean', default: true, label: '试玩自动启动' },
    startProgress: { type: 'number', default: 0, min: 0, max: 1, step: 0.05, label: '起始进度 (0~1)' },
  },
}

export function defaultSpline(): SplineSpec {
  return defaultForSchema(SPLINE_SCHEMA) as SplineSpec
}

export function normalizeSpline(raw: unknown): SplineSpec {
  return normalizeBySchema<SplineSpec>(SPLINE_SCHEMA, raw)
}
