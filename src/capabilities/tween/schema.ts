import { defaultForSchema, normalizeBySchema, type ObjectFieldSchema } from '../../core/schema/fieldSchema'
import type { EasingName } from '../../runtime/motion'

export const TWEEN_CAPABILITY_ID = 'tween'

export type TweenPropertyMode = 'positionOffset' | 'rotationOffset' | 'scaleMultiplier' | 'floatBob'
export type TweenLoopMode = 'once' | 'loop' | 'pingPong'

export interface TweenSpec {
  enabled: boolean
  property: TweenPropertyMode
  delta: [number, number, number]
  duration: number
  delay: number
  ease: EasingName
  loopMode: TweenLoopMode
  autoStart: boolean
}

export const TWEEN_SCHEMA: ObjectFieldSchema = {
  type: 'object',
  label: 'Tween 补间动效',
  fields: {
    enabled: { type: 'boolean', default: true, label: '启用' },
    property: {
      type: 'enum',
      default: 'floatBob',
      label: '动效类型',
      options: [
        { value: 'floatBob', label: '悬浮浮动 (PingPong)' },
        { value: 'positionOffset', label: '位置偏移' },
        { value: 'rotationOffset', label: '旋转角度 (度)' },
        { value: 'scaleMultiplier', label: '缩放倍率变化' },
      ],
    },
    delta: { type: 'vec3', default: [0, 0.35, 0], label: '变化量 (X/Y/Z)' },
    duration: { type: 'number', default: 1.2, min: 0.05, max: 60, step: 0.1, label: '单程时长 (秒)' },
    delay: { type: 'number', default: 0, min: 0, max: 30, step: 0.1, label: '起始延迟 (秒)' },
    ease: {
      type: 'enum',
      default: 'inOutSine',
      label: '缓动曲线',
      options: [
        { value: 'linear', label: '线性 (Linear)' },
        { value: 'inOutSine', label: '正弦缓入缓出 (Sine)' },
        { value: 'outQuad', label: '二次缓出 (OutQuad)' },
        { value: 'inOutQuad', label: '二次缓入缓出 (InOutQuad)' },
        { value: 'outCubic', label: '三次缓出 (OutCubic)' },
        { value: 'inOutCubic', label: '三次缓入缓出 (InOutCubic)' },
        { value: 'outBack', label: '回弹 (OutBack)' },
        { value: 'outBounce', label: '弹跳 (OutBounce)' },
        { value: 'outElastic', label: '弹性 (OutElastic)' },
      ],
    },
    loopMode: {
      type: 'enum',
      default: 'pingPong',
      label: '循环模式',
      options: [
        { value: 'once', label: '单次' },
        { value: 'loop', label: '从头循环' },
        { value: 'pingPong', label: '往返 (PingPong)' },
      ],
    },
    autoStart: { type: 'boolean', default: true, label: '试玩自动播放' },
  },
}

export function defaultTween(): TweenSpec {
  return defaultForSchema(TWEEN_SCHEMA) as TweenSpec
}

export function normalizeTween(raw: unknown): TweenSpec {
  return normalizeBySchema<TweenSpec>(TWEEN_SCHEMA, raw)
}
