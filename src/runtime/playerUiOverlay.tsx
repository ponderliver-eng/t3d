import { useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { juiceFlash, subscribeJuiceFlash } from '../gameplay/juiceClock'
import { playPrompt, subscribePlayPrompt } from './devices'
import type { SceneNode } from '../editor/scene/types'
import { UiScreenStack } from './ui/dom'
import type { UiDocument, UiLayer, UiNode } from './ui/spec'
import { dispatchUiClick, subscribeUiValues, uiValues } from './ui/values'
import { getRuntimeWorld } from './world'

interface UiAssetLike {
  kind?: string
  url?: string
  document?: UiDocument
}

let sceneRevision = 0
const sceneListeners = new Set<() => void>()

export function bumpPlayerUiScene(): void {
  sceneRevision += 1
  for (const fn of sceneListeners) fn()
}

function subscribeScene(fn: () => void): () => void {
  sceneListeners.add(fn)
  return () => sceneListeners.delete(fn)
}

function getSceneRevision(): number {
  return sceneRevision
}

function readStandaloneScreens(nodes: Record<string, SceneNode>) {
  const values = uiValues()
  const world = getRuntimeWorld()
  return Object.values(nodes).flatMap((node) => {
    if (node.kind !== 'screen' || node.visible === false) return []
    const screen = node.screen
    if (!screen?.documentId) return []
    const shown = node.id in values.screens ? values.screens[node.id] : screen.visibleOnPlay
    if (!shown) return []
    const asset = world.getAsset(screen.documentId) as UiAssetLike | undefined
    if (!asset || asset.kind !== 'ui' || !asset.document?.root) return []
    return [{ nodeId: node.id, layer: (screen.layer ?? 'hud') as UiLayer, root: asset.document.root }]
  })
}

function resolveTextureUrl(imageId: string): string | undefined {
  const asset = getRuntimeWorld().getAsset(imageId) as UiAssetLike | undefined
  return asset?.kind === 'texture' ? asset.url : undefined
}

function activateNode(node: UiNode) {
  if (!node.click) return
  dispatchUiClick(node.click, node.id)
}

function StandaloneUiApp() {
  useSyncExternalStore(subscribeScene, getSceneRevision)
  const values = useSyncExternalStore(subscribeUiValues, uiValues)
  const prompt = useSyncExternalStore(subscribePlayPrompt, playPrompt)
  const flash = useSyncExternalStore(subscribeJuiceFlash, juiceFlash)
  const mounts = readStandaloneScreens(getRuntimeWorld().getNodes())

  return (
    <>
      {mounts.length > 0 && (
        <UiScreenStack
          mounts={mounts}
          values={values}
          resolveImageUrl={resolveTextureUrl}
          onActivate={activateNode}
        />
      )}
      {prompt && (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: '56px',
            transform: 'translateX(-50%)',
            padding: '8px 16px',
            borderRadius: '8px',
            background: 'rgba(15, 23, 42, 0.82)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            color: '#f8fafc',
            fontSize: '13px',
            fontFamily: '"Segoe UI", sans-serif',
            pointerEvents: 'none',
            zIndex: 12,
          }}
        >
          {prompt}
        </div>
      )}
      {flash && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: flash,
            pointerEvents: 'none',
            zIndex: 11,
          }}
        />
      )}
    </>
  )
}

export function mountPlayerUiOverlay(container: HTMLElement): { dispose: () => void } {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;'
  container.appendChild(host)
  const root: Root = createRoot(host)
  root.render(<StandaloneUiApp />)
  return {
    dispose: () => {
      root.unmount()
      host.remove()
    },
  }
}
