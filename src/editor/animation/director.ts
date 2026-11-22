import { clipDuration, clipNamesFor, projectClips } from '../assets/models'
import { useAssetStore } from '../assets/library'
import { useEditorStore } from '../scene/store'

export interface PlayClip {
  clip: string
  assetId?: string | null
  loop?: boolean
  fade?: number
  speed?: number
}

function resolveClipAndAsset(
  nodeAssetId: string | null | undefined,
  currentClipAssetId: string | null | undefined,
  clipOrAsset: string,
  explicitAssetId?: string | null,
): { clip: string; assetId: string | null } {
  const raw = (clipOrAsset ?? '').trim()
  if (!raw) return { clip: '', assetId: null }

  if (explicitAssetId) {
    return {
      clip: raw,
      assetId: explicitAssetId === nodeAssetId ? null : explicitAssetId,
    }
  }

  // 1. 角色自身模型包含该剪辑
  if (nodeAssetId && clipNamesFor(nodeAssetId).includes(raw)) {
    return { clip: raw, assetId: null }
  }

  // 2. 当前节点已绑定的外部动画资产包含该剪辑
  if (currentClipAssetId && clipNamesFor(currentClipAssetId).includes(raw)) {
    return { clip: raw, assetId: currentClipAssetId }
  }

  // 3. 在工程所有模型/动画资产中自动查找同名剪辑（优先 animation 资产）
  const allClips = projectClips()
  const matchedAnim = allClips.find((c) => c.kind === 'animation' && c.name === raw)
    ?? allClips.find((c) => c.name === raw)
  if (matchedAnim) {
    return {
      clip: matchedAnim.name,
      assetId: matchedAnim.assetId === nodeAssetId ? null : matchedAnim.assetId,
    }
  }

  // 4. 兜底：若传入的是动画资产 ID 或资产名，则自动取其首个剪辑
  const assets = useAssetStore.getState().assets
  const byAsset = assets[raw]
    ?? Object.values(assets).find((a) => (a.kind === 'animation' || a.kind === 'model') && a.name === raw)
  if (byAsset && (byAsset.kind === 'animation' || byAsset.kind === 'model')) {
    const firstClip = clipNamesFor(byAsset.id)[0]
    if (firstClip) {
      return {
        clip: firstClip,
        assetId: byAsset.id === nodeAssetId ? null : byAsset.id,
      }
    }
  }

  return {
    clip: raw,
    assetId: explicitAssetId === undefined ? (currentClipAssetId ?? null) : explicitAssetId,
  }
}

/** 播放全身。角色组件以后用它换待机、走、跑、跳。 */
export function playBody(nodeId: string, play: PlayClip) {
  const node = useEditorStore.getState().nodes[nodeId]
  if (!node) return
  const resolved = resolveClipAndAsset(node.assetId, node.clipAssetId, play.clip, play.assetId)
  if (!resolved.clip) return
  useEditorStore.getState().updateNode(nodeId, {
    clip: resolved.clip,
    clipAssetId: resolved.assetId,
    clipTime: 0,
    clipPlaying: true,
    clipLoop: play.loop ?? node.clipLoop !== false,
    clipMask: 'full',
    ...(play.fade !== undefined ? { clipFade: play.fade } : {}),
    ...(play.speed !== undefined ? { clipSpeed: play.speed } : {}),
  })
}

/** 在走跑之上只播上半身。下半身继续身体层。 */
export function playUpper(nodeId: string, play: PlayClip) {
  const node = useEditorStore.getState().nodes[nodeId]
  if (!node) return
  const resolved = resolveClipAndAsset(node.assetId, node.overlayAssetId, play.clip, play.assetId)
  if (!resolved.clip) return
  useEditorStore.getState().updateNode(nodeId, {
    overlayClip: resolved.clip,
    overlayAssetId: resolved.assetId,
    overlayTime: 0,
    overlayPlaying: true,
    overlayLoop: play.loop ?? false,
    ...(play.fade !== undefined ? { clipFade: play.fade } : {}),
  })
}

export function stopUpper(nodeId: string) {
  const node = useEditorStore.getState().nodes[nodeId]
  if (!node) return
  useEditorStore.getState().updateNode(nodeId, {
    overlayClip: '',
    overlayPlaying: false,
    overlayTime: 0,
  })
}

/** 身体层播到的进度，0 到 1。没有片段时是 0。 */
export function bodyProgress(nodeId: string): number {
  const node = useEditorStore.getState().nodes[nodeId]
  if (!node?.clip) return 0
  const duration = clipDuration(node.clipAssetId || node.assetId, node.clip)
  if (duration <= 0) return 0
  return Math.min(1, Math.max(0, node.clipTime / duration))
}
