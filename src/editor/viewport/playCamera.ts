import { childrenOf } from '../scene/kinds'
import { TAG_ID_MAIN_CAMERA, TAG_NAME_MAIN_CAMERA, type TagDefinition } from '../project/taxonomy'
import type { SceneNode } from '../scene/types'

export interface PlayCameraChoice {
  id: string | null
  multipleMain: boolean
}

let forcedCameraId = ''

export function forcePlayCamera(id: string) {
  forcedCameraId = id
}

export function clearPlayCameraForce() {
  forcedCameraId = ''
}

/** 试玩镜头：律令指定的相机优先，其次 MainCamera，否则用层级里的第一台可见相机。 */
export function resolvePlayCamera(nodes: Record<string, SceneNode>, tags: TagDefinition[]): PlayCameraChoice {
  const forced = forcedCameraId ? nodes[forcedCameraId] : undefined
  if (forced?.kind === 'camera' && forced.visible) return { id: forced.id, multipleMain: false }
  const cameras: SceneNode[] = []
  const walk = (parentId: string | null) => {
    for (const node of childrenOf(nodes, parentId)) {
      if (node.kind === 'camera' && node.visible) cameras.push(node)
      walk(node.id)
    }
  }
  walk(null)
  const mainTagId = tags.find(tag => tag.id === TAG_ID_MAIN_CAMERA || tag.name === TAG_NAME_MAIN_CAMERA)?.id ?? TAG_ID_MAIN_CAMERA
  const mains = cameras.filter(node => node.tagId === mainTagId || node.tagId === TAG_NAME_MAIN_CAMERA)
  if (mains.length > 0) return { id: mains[0].id, multipleMain: mains.length > 1 }
  return { id: cameras[0]?.id ?? null, multipleMain: false }
}
