import { LoopOnce, LoopRepeat, type AnimationAction, type AnimationClip, type AnimationMixer } from 'three'
import type { SceneNode } from '../../editor/scene/types'
import { activeAnimatorState } from '../animation/animator'
import { mergedHumanoidSlots, preserveHumanoidAvatarOverrides } from '../animation/humanoidAvatar'
import { bindHumanoidClip } from '../animation/humanoidRetarget'
import type { ModelHumanoid } from '../animation/humanoidRig'
import type { HumanoidRetargetAdjust } from '../animation/humanoidAdjust'
import type { ModelHumanoidAvatar } from '../animation/humanoidAvatar'
import { lockClipInPlace, maskClip } from '../animation/playback'

export interface ActionBlend {
  from?: AnimationAction
  to: AnimationAction
  start: number
  duration: number
  loop: boolean
  speed: number
}

export interface PlaybackSourceDesc {
  sourceId: string
  clip: string
  loop: boolean
  speed: number
  fade: number
  inPlace: boolean
  mask: 'full' | 'upper' | 'lower'
  playing: boolean
  time: number
}

/**
 * 统一计算节点身体层（`body`）动画播放源与遮罩：
 * 当上半身覆盖（`overlayClip && overlayPlaying`）激活且身体层为 `full` 时，自动降级为 `lower`（仅下半身），防止边跑边挥砍滑步。
 */
export function resolveBodyPlaybackSource(node: SceneNode): PlaybackSourceDesc {
  const animator = node.animator?.enabled ? activeAnimatorState(node.animator) : undefined
  const overlayOn = Boolean(node.overlayClip && node.overlayPlaying)
  if (animator) {
    const mask = animator.mask && animator.mask !== 'full' ? animator.mask : ('full' as const)
    return {
      sourceId: animator.clipAssetId || node.assetId || '',
      clip: animator.clip,
      loop: animator.loop,
      speed: Number.isFinite(animator.speed) ? animator.speed : 1,
      fade: node.clipFade ?? 0.15,
      inPlace: animator.inPlace ?? node.clipInPlace === true,
      mask: overlayOn && mask === 'full' ? ('lower' as const) : mask,
      playing: node.clipPlaying,
      time: node.clipTime,
    }
  }
  const mask = node.clipMask === 'upper' || node.clipMask === 'lower' ? node.clipMask : ('full' as const)
  return {
    sourceId: node.clipAssetId || node.assetId || '',
    clip: node.clip,
    loop: node.clipLoop !== false,
    speed: node.clipSpeed ?? 1,
    fade: node.clipFade ?? 0.15,
    inPlace: node.clipInPlace === true,
    mask: overlayOn && mask === 'full' ? ('lower' as const) : mask,
    playing: node.clipPlaying,
    time: node.clipTime,
  }
}

/**
 * 统一计算节点上半身覆盖层（`overlay`）动画播放源。
 */
export function resolveOverlayPlaybackSource(node: SceneNode): PlaybackSourceDesc | null {
  if (!node.overlayClip) return null
  return {
    sourceId: node.overlayAssetId || node.assetId || '',
    clip: node.overlayClip,
    loop: node.overlayLoop === true,
    speed: 1,
    fade: node.clipFade ?? 0.15,
    inPlace: true,
    mask: 'upper' as const,
    playing: node.overlayPlaying === true,
    time: node.overlayTime ?? 0,
  }
}

export function configureAnimationAction(action: AnimationAction, loop: boolean, speed: number) {
  action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1)
  action.clampWhenFinished = !loop
  action.timeScale = speed
}

/**
 * 统一的全身/分层动作步幅相位对齐（Phase Sync）与显式权重过渡启动。
 */
export function beginActionBlend(
  mixer: AnimationMixer | undefined,
  actions: Map<string, AnimationAction> | undefined,
  previous: AnimationAction | undefined,
  next: AnimationAction,
  loop: boolean,
  speed: number,
  fade: number,
  keep?: AnimationAction,
): ActionBlend | undefined {
  const duration = Math.max(0, fade)
  const previousDuration = previous?.getClip().duration || 1
  const nextDuration = next.getClip().duration || 1
  const phase = previous
    ? (((previous.time % previousDuration) + previousDuration) % previousDuration) / previousDuration
    : 0
  if (actions) {
    for (const item of actions.values()) {
      if (item === previous || item === next || item === keep) continue
      item.stop()
    }
  }
  configureAnimationAction(next, loop, speed)
  next.stopFading()
  next.enabled = true
  next.paused = false
  next.weight = duration > 0 && previous && previous !== next ? 0 : 1
  next.time = phase * nextDuration
  next.play()
  if (previous && previous !== next) {
    previous.stopFading()
    previous.enabled = true
    previous.paused = false
    previous.weight = 1
    previous.play()
  }
  const blend: ActionBlend = { from: previous, to: next, start: mixer?.time ?? 0, duration, loop, speed }
  return duration > 0 && previous && previous !== next ? blend : finishActionBlend(actions, blend, keep)
}

/**
 * 淡出结束后将非保留动作彻底 `stop()`，清理残留权重。
 */
export function finishActionBlend(
  actions: Map<string, AnimationAction> | undefined,
  blend: ActionBlend,
  keep?: AnimationAction,
): undefined {
  const time = blend.to.time
  if (actions) {
    for (const item of actions.values()) {
      if (item === keep) continue
      item.stop()
    }
  } else if (blend.from && blend.from !== blend.to && blend.from !== keep) {
    blend.from.stop()
  }
  configureAnimationAction(blend.to, blend.loop, blend.speed)
  blend.to.stopFading()
  blend.to.enabled = true
  blend.to.paused = false
  blend.to.weight = 1
  blend.to.time = time
  blend.to.play()
  return undefined
}

/**
 * 每帧推进 `ActionBlend` 权重插值。
 */
export function stepActionBlend(
  mixer: AnimationMixer | undefined,
  actions: Map<string, AnimationAction> | undefined,
  blend: ActionBlend | undefined,
  keep?: AnimationAction,
): ActionBlend | undefined {
  if (!blend || !mixer) return blend
  const elapsed = mixer.time - blend.start
  const t = blend.duration <= 0 ? 1 : Math.min(1, elapsed / blend.duration)
  const from = blend.from
  if (t < 1 && from && from !== blend.to) {
    from.enabled = true
    from.paused = false
    from.weight = 1 - t
    blend.to.enabled = true
    blend.to.paused = false
    blend.to.weight = t
    return blend
  }
  return finishActionBlend(actions, blend, keep)
}

export interface HumanoidClipBuildOptions {
  rawClip: AnimationClip
  sourceId: string
  ownerAssetId: string
  sourceHumanoid?: ModelHumanoid | null
  targetHumanoid?: ModelHumanoid | null
  sourceAvatarOverride?: ModelHumanoidAvatar | null
  targetAvatarOverride?: ModelHumanoidAvatar | null
  targetRetargetAdjust?: HumanoidRetargetAdjust | null
  mask?: 'full' | 'upper' | 'lower'
  inPlace?: boolean
}

/**
 * 统一的跨骨架人形重定向 + 上下半身遮罩（`maskClip`）+ 原地锁根（`lockClipInPlace`）剪辑构建。
 */
export function buildPlayableClip(opts: HumanoidClipBuildOptions): AnimationClip {
  let clip = opts.rawClip
  if (opts.sourceId !== opts.ownerAssetId && opts.targetHumanoid?.profile) {
    const targetAvatar =
      preserveHumanoidAvatarOverrides(opts.targetHumanoid.avatar, opts.targetAvatarOverride) ??
      opts.targetHumanoid.avatar
    const sourceAvatar =
      preserveHumanoidAvatarOverrides(opts.sourceHumanoid?.avatar ?? null, opts.sourceAvatarOverride) ??
      (opts.sourceHumanoid?.avatar ?? null)
    const bound = bindHumanoidClip({
      clip: opts.rawClip,
      sourceProfile: opts.sourceHumanoid?.profile ?? null,
      sourceSkeletons: opts.sourceHumanoid?.skeletons ?? [],
      sourceAvatar,
      targetProfile: opts.targetHumanoid.profile,
      targetSlots: mergedHumanoidSlots(targetAvatar),
      adjust: opts.targetRetargetAdjust ?? null,
    })
    if (bound) clip = bound
  }
  const mask = opts.mask ?? 'full'
  if (mask === 'upper') clip = maskClip(clip, 'upperBody')
  else if (mask === 'lower') clip = maskClip(clip, 'lowerBody')
  if (opts.inPlace) clip = lockClipInPlace(clip)
  return clip
}
