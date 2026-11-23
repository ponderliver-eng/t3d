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
  label: 'tween.title',
  fields: {
    enabled: { type: 'boolean', default: true, label: 'field.enable' },
    property: {
      type: 'enum',
      default: 'floatBob',
      label: 'tween.kind',
      options: [
        { value: 'floatBob', label: 'tween.kind.floatBob' },
        { value: 'positionOffset', label: 'tween.kind.positionOffset' },
        { value: 'rotationOffset', label: 'tween.kind.rotationOffset' },
        { value: 'scaleMultiplier', label: 'tween.kind.scaleMultiplier' },
      ],
    },
    delta: { type: 'vec3', default: [0, 0.35, 0], label: 'tween.delta' },
    duration: { type: 'number', default: 1.2, min: 0.05, max: 60, step: 0.1, label: 'tween.duration' },
    delay: { type: 'number', default: 0, min: 0, max: 30, step: 0.1, label: 'tween.delay' },
    ease: {
      type: 'enum',
      default: 'inOutSine',
      label: 'tween.ease',
      options: [
        { value: 'linear', label: 'tween.ease.linear' },
        { value: 'inOutSine', label: 'tween.ease.inOutSine' },
        { value: 'outQuad', label: 'tween.ease.outQuad' },
        { value: 'inOutQuad', label: 'tween.ease.inOutQuad' },
        { value: 'outCubic', label: 'tween.ease.outCubic' },
        { value: 'inOutCubic', label: 'tween.ease.inOutCubic' },
        { value: 'outBack', label: 'tween.ease.outBack' },
        { value: 'outBounce', label: 'tween.ease.outBounce' },
        { value: 'outElastic', label: 'tween.ease.outElastic' },
      ],
    },
    loopMode: {
      type: 'enum',
      default: 'pingPong',
      label: 'tween.repeat',
      options: [
        { value: 'once', label: 'tween.repeat.once' },
        { value: 'loop', label: 'tween.repeat.loop' },
        { value: 'pingPong', label: 'tween.repeat.pingPong' },
      ],
    },
    autoStart: { type: 'boolean', default: true, label: 'tween.autoStart' },
  },
}

export function defaultTween(): TweenSpec {
  return defaultForSchema(TWEEN_SCHEMA) as TweenSpec
}

export function normalizeTween(raw: unknown): TweenSpec {
  return normalizeBySchema<TweenSpec>(TWEEN_SCHEMA, raw)
}
