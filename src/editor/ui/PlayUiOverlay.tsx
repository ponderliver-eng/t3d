import { useSyncExternalStore } from 'react'
import { juiceFlash, subscribeJuiceFlash } from '../../gameplay/juiceClock'
import { useAssetStore } from '../assets/library'
import { translate } from '../i18n'
import { useEditorStore } from '../scene/store'
import type { UiNode } from '../../runtime/ui/spec'
import { UiScreenStack } from '../../runtime/ui/dom'
import { dispatchUiClick } from '../../runtime/ui/values'
import { playPrompt, subscribePlayPrompt } from '../../runtime/devices'
import { readPlayScreens } from './ScreenCard'
import { useUiValues } from './runtimeStore'

export function PlayUiOverlay() {
  const nodes = useEditorStore(state => state.nodes)
  const revision = useAssetStore(state => state.revision)
  const values = useUiValues()
  const prompt = useSyncExternalStore(subscribePlayPrompt, playPrompt)
  const flash = useSyncExternalStore(subscribeJuiceFlash, juiceFlash)
  const mounts = readPlayScreens(nodes)
  return (
    <>
      {mounts.length > 0 && (
        <UiScreenStack
          key={revision}
          mounts={mounts}
          values={values}
          resolveImageUrl={textureUrl}
          onActivate={node => activate(node)}
        />
      )}
      {prompt && <div className="play-prompt">{prompt}</div>}
      {flash && <div className="play-flash" style={{ background: flash }} />}
    </>
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
