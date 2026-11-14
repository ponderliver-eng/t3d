import { useState, type PointerEvent } from 'react'
import { useI18n } from '../i18n'
import { useAssetStore } from '../assets/library'
import { MaterialPreview } from './MaterialPreview'
import { ModelPreview } from './ModelPreview'
import { TexturePreview } from './TexturePreview'
import { usePreviewStore, type PreviewKind, type PreviewWindow } from './previewStore'
import './preview.css'

export function PreviewHost() {
  const windows = usePreviewStore(state => state.windows)
  return (
    <>
      {windows.map(item => <PreviewFrame key={item.id} item={item} />)}
    </>
  )
}

export function PreviewStandalone({ kind, assetId }: { kind: PreviewKind, assetId: string }) {
  const { t } = useI18n()
  const storedName = useAssetStore(state => state.assets[assetId]?.name ?? '')
  const title = storedName || t('preview.title')
  return (
    <div className="preview-standalone">
      <header>{title}</header>
      <PreviewBody kind={kind} assetId={assetId} standalone />
    </div>
  )
}

function PreviewFrame({ item }: { item: PreviewWindow }) {
  const [drag, setDrag] = useState<{ x: number, y: number, left: number, top: number } | null>(null)
  const move = (event: PointerEvent) => {
    if (!drag) return
    usePreviewStore.getState().movePreview(item.id, drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y)
  }
  return (
    <section
      className={`preview-window${item.kind === 'model' ? ' preview-window--model' : ''}`}
      style={{ left: item.x, top: item.y, zIndex: item.z }}
      onPointerDown={() => usePreviewStore.getState().bringToFront(item.id)}
    >
      <header
        onPointerDown={event => {
          if ((event.target as HTMLElement).closest('button')) return
          event.currentTarget.setPointerCapture(event.pointerId)
          setDrag({ x: event.clientX, y: event.clientY, left: item.x, top: item.y })
        }}
        onPointerMove={move}
        onPointerUp={() => setDrag(null)}
      >
        <span>{item.title}</span>
        <button type="button" onClick={() => usePreviewStore.getState().closePreview(item.id)}>×</button>
      </header>
      <PreviewBody kind={item.kind} assetId={item.assetId} />
    </section>
  )
}

function PreviewBody({ kind, assetId, standalone = false }: { kind: PreviewKind, assetId: string, standalone?: boolean }) {
  if (kind === 'model') return <ModelPreview assetId={assetId} standalone={standalone} />
  if (kind === 'texture') return <TexturePreview assetId={assetId} standalone={standalone} />
  if (kind === 'environment') return <TexturePreview assetId={assetId} environment standalone={standalone} />
  return <MaterialPreview assetId={assetId} kind={kind} standalone={standalone} />
}
