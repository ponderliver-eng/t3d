import type { AnimationClip } from 'three'
import { getModelTemplate, modelRevision } from '../assets/models'
import { patchAssetMeta } from '../assets/cache'
import { useAssetStore } from '../assets/library'
import { humanoidAvatarCacheKey, mergedHumanoidSlots, preserveHumanoidAvatarOverrides, type ModelHumanoidAvatar } from './humanoidAvatar'
import { humanoidRetargetAdjustCacheKey, humanoidRetargetAdjustIsDefault, normalizeHumanoidRetargetAdjust, type HumanoidRetargetAdjust } from './humanoidAdjust'
import { bindHumanoidClip } from './humanoidRetarget'

const cache = new Map<string, AnimationClip[]>()

export function saveHumanoidSettings(
  assetId: string,
  patch: { humanoidAvatar?: ModelHumanoidAvatar | null; humanoidRetarget?: HumanoidRetargetAdjust | null },
  persist = true,
) {
  useAssetStore.setState(state => {
    const asset = state.assets[assetId]
    if (!asset || !('fileName' in asset)) return {}
    const next = { ...asset }
    if ('humanoidAvatar' in patch) {
      if (patch.humanoidAvatar) next.humanoidAvatar = patch.humanoidAvatar
      else delete next.humanoidAvatar
    }
    if ('humanoidRetarget' in patch) {
      if (patch.humanoidRetarget && !humanoidRetargetAdjustIsDefault(patch.humanoidRetarget)) next.humanoidRetarget = normalizeHumanoidRetargetAdjust(patch.humanoidRetarget)
      else delete next.humanoidRetarget
    }
    return { assets: { ...state.assets, [assetId]: next }, revision: state.revision + 1 }
  })
  if (!persist) return
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset || !('fileName' in asset)) return
  void patchAssetMeta(assetId, {
    humanoidAvatar: asset.humanoidAvatar ?? null,
    humanoidRetarget: asset.humanoidRetarget ?? null,
  })
}

function fileAdjust(assetId: string): HumanoidRetargetAdjust | null {
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset || !('fileName' in asset)) return null
  return asset.humanoidRetarget ?? null
}

export function humanoidBindingKey(sourceId: string, targetId: string): string {
  const target = useAssetStore.getState().assets[targetId]
  const avatar = target && 'fileName' in target ? target.humanoidAvatar : null
  return [
    sourceId,
    modelRevision(sourceId),
    targetId,
    modelRevision(targetId),
    humanoidRetargetAdjustCacheKey(fileAdjust(targetId)),
    humanoidAvatarCacheKey(avatar),
  ].join('|')
}

/** 把源片段绑到目标骨架。同名且腿长比不超过 5% 时原样返回。 */
export function clipsForSkeleton(sourceId: string, targetId: string): AnimationClip[] {
  const source = getModelTemplate(sourceId)
  if (!source) return []
  const target = getModelTemplate(targetId)
  const targetProfile = target?.humanoid.profile
  if (!targetProfile || sourceId === targetId) return source.clips
  const assets = useAssetStore.getState().assets
  const targetAsset = assets[targetId]
  const sourceAsset = assets[sourceId]
  const targetAvatar = targetAsset && 'fileName' in targetAsset
    ? preserveHumanoidAvatarOverrides(target.humanoid.avatar, targetAsset.humanoidAvatar) ?? targetAsset.humanoidAvatar ?? target.humanoid.avatar
    : target.humanoid.avatar
  const adjust = targetAsset && 'fileName' in targetAsset ? targetAsset.humanoidRetarget : null
  const key = humanoidBindingKey(sourceId, targetId)
  const hit = cache.get(key)
  if (hit) return hit
  const slots = mergedHumanoidSlots(targetAvatar)
  const sourceAvatar = sourceAsset && 'fileName' in sourceAsset
    ? preserveHumanoidAvatarOverrides(source.humanoid?.avatar, sourceAsset.humanoidAvatar) ?? source.humanoid?.avatar ?? null
    : source.humanoid?.avatar ?? null
  const clips: AnimationClip[] = []
  for (const clip of source.clips) {
    const bound = bindHumanoidClip({
      clip,
      sourceProfile: source.humanoid?.profile ?? null,
      sourceSkeletons: source.humanoid?.skeletons ?? [],
      sourceAvatar,
      targetProfile,
      targetSlots: slots,
      adjust: adjust && !humanoidRetargetAdjustIsDefault(adjust) ? normalizeHumanoidRetargetAdjust(adjust) : null,
    })
    if (bound) clips.push(bound)
  }
  cache.set(key, clips)
  return clips
}
