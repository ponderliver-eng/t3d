import { useEditorStore } from '../editor/scene/store'
import { syncSoundSources } from './audio'
import { defaultSoundSource, registerRuntimeSystem, RUNTIME_STAGE, type SceneRuntimeHost } from './sceneRuntime'

function stepSoundSources(_dt: number, host: SceneRuntimeHost) {
  const state = useEditorStore.getState()
  if (state.playState !== 'playing') return
  const items = []
  for (const node of Object.values(state.nodes)) {
    const spec = node.gameplay?.soundSource
    if (!spec?.enabled || !spec.assetId) continue
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

registerRuntimeSystem('core.soundSource', RUNTIME_STAGE.PRE_RENDER, stepSoundSources)
