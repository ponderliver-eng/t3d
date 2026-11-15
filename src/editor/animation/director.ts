import { clipDuration } from '../assets/models'
import { useEditorStore } from '../scene/store'

export interface PlayClip {
  clip: string
  assetId?: string | null
  loop?: boolean
  fade?: number
}

/** 播放全身。角色组件以后用它换待机、走、跑、跳。 */
export function playBody(nodeId: string, play: PlayClip) {
  const node = useEditorStore.getState().nodes[nodeId]
  if (!node) return
  useEditorStore.getState().updateNode(nodeId, {
    clip: play.clip,
    clipAssetId: play.assetId === undefined ? node.clipAssetId : play.assetId,
    clipTime: 0,
    clipPlaying: true,
    clipLoop: play.loop ?? node.clipLoop !== false,
    clipMask: 'full',
    ...(play.fade !== undefined ? { clipFade: play.fade } : {}),
  })
}

/** 在走跑之上只播上半身。下半身继续身体层。 */
export function playUpper(nodeId: string, play: PlayClip) {
  const node = useEditorStore.getState().nodes[nodeId]
  if (!node) return
  useEditorStore.getState().updateNode(nodeId, {
    overlayClip: play.clip,
    overlayAssetId: play.assetId === undefined ? node.overlayAssetId ?? null : play.assetId,
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
