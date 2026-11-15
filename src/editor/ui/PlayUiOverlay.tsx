import { useAssetStore } from '../assets/library'
import { translate } from '../i18n'
import { useEditorStore } from '../scene/store'
import type { UiNode } from '../../runtime/ui/spec'
import { UiScreenStack } from '../../runtime/ui/dom'
import { dispatchUiClick } from '../../runtime/ui/values'
import { readPlayScreens } from './ScreenCard'
import { useUiValues } from './runtimeStore'

export function PlayUiOverlay() {
  const nodes = useEditorStore(state => state.nodes)
  const revision = useAssetStore(state => state.revision)
  const values = useUiValues()
  const mounts = readPlayScreens(nodes)
  if (mounts.length === 0) return null
  return (
    <UiScreenStack
      key={revision}
      mounts={mounts}
      values={values}
      resolveImageUrl={textureUrl}
      onActivate={node => activate(node)}
    />
  )
}

function activate(node: UiNode) {
  if (!node.click) return
  dispatchUiClick(node.click, node.id)
  if (node.click.kind === 'sendMessage') {
    useEditorStore.getState().log('info', translate('log.uiMessage', { message: node.click.message }))
  }
}

function textureUrl(imageId: string): string | undefined {
  const asset = useAssetStore.getState().assets[imageId]
  return asset?.kind === 'texture' ? asset.url : undefined
}
