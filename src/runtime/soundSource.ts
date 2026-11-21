import type { SceneNode } from '../editor/scene/types'
import { syncSoundSources } from './audio'
import { defaultSoundSource, registerRuntimeSystem, type SceneRuntimeHost } from './sceneRuntime'
import { getRuntimeWorld } from './world'

function shown(nodes: Record<string, SceneNode>, id: string) {
  let current: SceneNode | undefined = nodes[id]
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    if (!current.visible) return false
    seen.add(current.id)
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return true
}

function stepSoundSources(_dt: number, host: SceneRuntimeHost) {
  const world = getRuntimeWorld()
  if (world.getPlayState() !== 'playing') return
  const nodes = world.getNodes()
  const items = []
  for (const node of Object.values(nodes)) {
    const spec = node.gameplay?.soundSource
    if (!spec || spec.enabled === false || !spec.assetId) continue
    if (!shown(nodes, node.id)) continue
    const view = { ...defaultSoundSource(), ...spec }
    const parent = host.resolveObject(node.id)
    if (!parent) continue
    items.push({
      nodeId: node.id,
      assetId: view.assetId,
      bus: 'sfx' as const,
      loop: view.loop,
      volume: view.volume,
      refDistance: view.refDistance,
      rolloff: view.rolloff,
      parent,
    })
  }
  syncSoundSources(items)
}

registerRuntimeSystem('core.soundSource', 45, stepSoundSources)
