import { translate } from '../../editor/i18n'
import { useEditorStore } from '../../editor/scene/store'
import { WATER_CAPABILITY_ID, defaultWater } from './defaults'

export function createWaterNode(parentId: string | null = null): string | null {
  const store = useEditorStore.getState()
  store.createNode('empty', parentId)
  const id = useEditorStore.getState().selection.at(-1) ?? null
  if (!id) return null
  useEditorStore.getState().updateNode(id, {
    name: translate('water.title'),
    scale: [20, 1, 20],
    capabilities: {
      [WATER_CAPABILITY_ID]: { ...defaultWater(), enabled: true },
    },
  })
  return id
}
