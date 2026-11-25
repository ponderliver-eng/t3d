import { useRef, useState, type PointerEvent } from 'react'
import { useI18n } from '../i18n'
import { useAssetStore } from '../assets/library'
import { AnimationPreview } from './AnimationPreview'
import { AudioPreview } from './AudioPreview'
import { DocumentPreview } from './DocumentPreview'
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

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function PreviewFrame({ item }: { item: PreviewWindow }) {
  const frameRef = useRef<HTMLElement>(null)
  const [drag, setDrag] = useState<{ x: number, y: number, left: number, top: number } | null>(null)
  const [resize, setResize] = useState<{
    dir: ResizeDir
    startX: number
    startY: number
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  const move = (event: PointerEvent) => {
    if (!drag) return
    usePreviewStore.getState().movePreview(item.id, drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y)
  }

  const startResize = (dir: ResizeDir) => (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return
    event.currentTarget.setPointerCapture(event.pointerId)
    usePreviewStore.getState().bringToFront(item.id)
    setResize({
      dir,
      startX: event.clientX,
      startY: event.clientY,
      left: item.x,
      top: item.y,
      width: item.width ?? rect.width,
      height: item.height ?? rect.height,
    })
  }

  const onResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!resize) return
    const dx = event.clientX - resize.startX
    const dy = event.clientY - resize.startY
    const minW = item.kind === 'document' ? 420 : item.kind === 'audio' ? 320 : 360
    const minH = item.kind === 'document' ? 300 : item.kind === 'audio' ? 180 : 240
    const maxW = Math.max(minW, window.innerWidth - 16)
    const maxH = Math.max(minH, window.innerHeight - 16)

    let nextW = resize.width
    let nextH = resize.height
    let nextX = resize.left
    let nextY = resize.top

    if (resize.dir.includes('e')) {
      nextW = Math.min(maxW, Math.max(minW, resize.width + dx))
    }
    if (resize.dir.includes('s')) {
      nextH = Math.min(maxH, Math.max(minH, resize.height + dy))
    }
    if (resize.dir.includes('w')) {
      const clampedW = Math.min(maxW, Math.max(minW, resize.width - dx))
      nextX = resize.left + (resize.width - clampedW)
      nextW = clampedW
    }
    if (resize.dir.includes('n')) {
      const clampedH = Math.min(maxH, Math.max(minH, resize.height - dy))
      nextY = Math.max(0, resize.top + (resize.height - clampedH))
      nextH = resize.height - (nextY - resize.top)
    }

    usePreviewStore.getState().resizePreview(item.id, Math.round(nextW), Math.round(nextH), Math.round(nextX), Math.round(nextY))
  }

  return (
    <section
      ref={frameRef}
      className={`preview-window${item.kind === 'model' ? ' preview-window--model' : item.kind === 'audio' ? ' preview-window--audio' : item.kind === 'document' ? ' preview-window--document' : ''}`}
      style={{
        left: item.x,
        top: item.y,
        zIndex: item.z,
        ...(item.width !== undefined ? { width: item.width } : {}),
        ...(item.height !== undefined ? { height: item.height } : {}),
      }}
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
      {RESIZE_DIRS.map(dir => (
        <div
          key={dir}
          className={`preview-window__resize preview-window__resize--${dir}`}
          onPointerDown={startResize(dir)}
          onPointerMove={onResizeMove}
          onPointerUp={() => setResize(null)}
          onPointerCancel={() => setResize(null)}
        />
      ))}
    </section>
  )
}

function PreviewBody({ kind, assetId, standalone = false }: { kind: PreviewKind, assetId: string, standalone?: boolean }) {
  if (kind === 'model') return <ModelPreview assetId={assetId} standalone={standalone} />
  if (kind === 'animation') return <AnimationPreview assetId={assetId} standalone={standalone} />
  if (kind === 'audio') return <AudioPreview assetId={assetId} standalone={standalone} />
  if (kind === 'document') return <DocumentPreview assetId={assetId} standalone={standalone} />
  if (kind === 'texture') return <TexturePreview assetId={assetId} standalone={standalone} />
  if (kind === 'environment') return <TexturePreview assetId={assetId} environment standalone={standalone} />
  return <MaterialPreview assetId={assetId} kind={kind} standalone={standalone} />
}
