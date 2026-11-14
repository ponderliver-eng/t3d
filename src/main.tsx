import { createRoot } from 'react-dom/client'
import { Cache } from 'three'
import App from './App'
import { openCachedProject } from './editor/assets/project'
import { PreviewStandalone } from './editor/preview/PreviewHost'
import { readPreviewHash } from './editor/preview/previewStore'
import './styles/global.css'

Cache.enabled = true

const splash = document.getElementById('boot-splash')
const standalone = readPreviewHash()
void openCachedProject().finally(() => {
  createRoot(document.getElementById('root')!).render(
    standalone ? <PreviewStandalone kind={standalone.kind} assetId={standalone.assetId} /> : <App />,
  )
  splash?.classList.add('boot-splash--hide')
  window.setTimeout(() => splash?.remove(), 200)
})
