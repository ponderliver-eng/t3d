import { useEditorStore } from '../editor/scene/store'
import type { SceneNode } from '../editor/scene/types'
import { syncSoundSources } from './audio'
import { defaultSoundSource, registerRuntimeSystem, type SceneRuntimeHost } from './sceneRuntime'

function shown(nodes: ReturnType<typeof useEditorStore.getState>['nodes'], id: string) {
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
  const state = useEditorStore.getState()
  if (state.playState !== 'playing') return
  const items = []
  for (const node of Object.values(state.nodes)) {
    const spec = node.gameplay?.soundSource
    if (!spec || spec.enabled === false || !spec.assetId) continue
    if (!shown(state.nodes, node.id)) continue
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
