import { useAssetStore } from '../../editor/assets/library'
import { useEditorStore } from '../../editor/scene/store'
import { translate } from '../../editor/i18n'
import { QUARKS_VERSION } from './defaults'

export function saveEffectFromNode(nodeId: string) {
  const editor = useEditorStore.getState()
  const node = editor.nodes[nodeId]
  if (!node?.effect || node.effect.assetId || !node.effect.simulation) return
  const id = crypto.randomUUID()
  const name = uniqueName(node.name)
  useAssetStore.getState().add({
    id,
    name,
    kind: 'effect',
    quarksVersion: node.effect.quarksVersion || QUARKS_VERSION,
    simulation: node.effect.simulation,
    materialAssetId: node.effect.materialAssetId,
  })
  useAssetStore.getState().place(id)
  editor.updateNode(nodeId, {
    effect: { ...node.effect, assetId: id, simulation: null },
  })
  editor.log('info', translate('particles.saved', { name }))
}

function uniqueName(base: string) {
  const names = new Set(Object.values(useAssetStore.getState().assets).map(asset => asset.name))
  const stripped = base.replace(/ \d+$/, '')
  if (!names.has(stripped)) return stripped
  let index = 2
  while (names.has(`${stripped} ${index}`)) index += 1
  return `${stripped} ${index}`
}
