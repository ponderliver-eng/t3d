import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImageDown, RotateCcw, Scaling, X } from 'lucide-react'
import { type FileAsset, useAssetStore } from '../assets/library'
import {
  canResizeTextureFile,
  probeTextureInfo,
  resizeTextureAssets,
  restoreTextureOriginals,
  type TextureResizeProbe,
} from '../assets/textureResize'
import { useI18n } from '../i18n'
import { useEditorStore } from '../scene/store'
import './TextureResizeDialog.css'

const SIZE_PRESETS = [2048, 1024, 512, 256] as const

function formatBytes(bytes: number): string {
  if (bytes <= 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function scaledPreview(width: number, height: number, maxSize: number): string {
  const longest = Math.max(width, height)
  if (longest <= maxSize) return ''
  const scale = maxSize / longest
  return `${Math.max(1, Math.round(width * scale))}×${Math.max(1, Math.round(height * scale))}`
}

export function TextureResizeDialog({
  initialAssetIds,
  onClose,
}: {
  initialAssetIds: string[]
  onClose: () => void
}) {
  const { t } = useI18n()
  const assets = useAssetStore(state => state.assets)
  const [scopeAll, setScopeAll] = useState(initialAssetIds.length === 0)
  const [maxSize, setMaxSize] = useState<number>(1024)
  const [search, setSearch] = useState('')
  const [probes, setProbes] = useState<Record<string, TextureResizeProbe>>({})
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialAssetIds))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number, total: number } | null>(null)

  const initialSet = useMemo(() => new Set(initialAssetIds), [initialAssetIds])

  const allTextures = useMemo(() => {
    const list: FileAsset[] = []
    for (const asset of Object.values(assets)) {
      if (asset.kind === 'texture') list.push(asset)
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [assets])

  const scopedTextures = useMemo(() => {
    if (scopeAll || initialSet.size === 0) return allTextures
    return allTextures.filter(asset => initialSet.has(asset.id))
  }, [allTextures, initialSet, scopeAll])

  const visibleTextures = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return scopedTextures
    return scopedTextures.filter(asset =>
      asset.name.toLowerCase().includes(q) || asset.fileName.toLowerCase().includes(q),
    )
  }, [scopedTextures, search])

  const refreshProbes = useCallback(async (targets: FileAsset[]) => {
    const entries = await Promise.all(targets.map(async asset => [asset.id, await probeTextureInfo(asset)] as const))
    setProbes(current => {
      const next = { ...current }
      for (const [id, probe] of entries) next[id] = probe
      return next
    })
  }, [])

  useEffect(() => {
    void refreshProbes(scopedTextures)
  }, [refreshProbes, scopedTextures])

  useEffect(() => {
    if (scopeAll) {
      setSelected(new Set(allTextures.filter(asset => canResizeTextureFile(asset.fileName)).map(asset => asset.id)))
    }
  }, [scopeAll, allTextures])

  const selectedIds = useMemo(
    () => visibleTextures.filter(asset => selected.has(asset.id) && canResizeTextureFile(asset.fileName)).map(asset => asset.id),
    [selected, visibleTextures],
  )

  const restorableIds = useMemo(
    () => selectedIds.filter(id => probes[id]?.hasOriginal),
    [probes, selectedIds],
  )

  const toggleItem = (id: string) => {
    if (busy) return
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectOversized = () => {
    const next = new Set<string>()
    for (const asset of visibleTextures) {
      const info = probes[asset.id]
      if (!info?.supported) continue
      if (Math.max(info.width, info.height) > maxSize) next.add(asset.id)
    }
    setSelected(next)
  }

  const selectBackedUp = () => {
    const next = new Set<string>()
    for (const asset of visibleTextures) {
      if (probes[asset.id]?.hasOriginal) next.add(asset.id)
    }
    setSelected(next)
  }

  const runResize = async () => {
    if (busy || selectedIds.length === 0) return
    setBusy(true)
    setProgress({ done: 0, total: selectedIds.length })
    try {
      const result = await resizeTextureAssets(selectedIds, maxSize, (done, total) => setProgress({ done, total }))
      await refreshProbes(scopedTextures)
      useEditorStore.getState().log(
        result.failed > 0 ? 'warn' : 'info',
        t('texResize.done', { updated: result.updated, skipped: result.skipped, failed: result.failed }),
      )
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const runRestore = async () => {
    if (busy || restorableIds.length === 0) return
    setBusy(true)
    setProgress({ done: 0, total: restorableIds.length })
    try {
      const result = await restoreTextureOriginals(restorableIds, (done, total) => setProgress({ done, total }))
      await refreshProbes(scopedTextures)
      useEditorStore.getState().log(
        result.failed > 0 ? 'warn' : 'info',
        t('texResize.restored', { updated: result.updated, failed: result.failed }),
      )
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return createPortal(
    <div className="tex-resize__backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <div className="tex-resize" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
        <div className="tex-resize__header">
          <div className="tex-resize__title">
            <Scaling size={16} />
            <span>{t('texResize.title')}</span>
          </div>
          <button type="button" className="tex-resize__close" disabled={busy} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="tex-resize__controls">
          <div className="tex-resize__row">
            <span className="tex-resize__label">{t('texResize.maxEdge')}</span>
            <div className="tex-resize__presets">
              {SIZE_PRESETS.map(size => (
                <button
                  key={size}
                  type="button"
                  disabled={busy}
                  className={`tex-resize__preset ${maxSize === size ? 'is-active' : ''}`}
                  onClick={() => setMaxSize(size)}
                >
                  {size}px
                </button>
              ))}
            </div>
            <input
              type="search"
              className="tex-resize__search"
              placeholder={t('texResize.search')}
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <div className="tex-resize__row">
            {initialAssetIds.length > 0 && (
              <button
                type="button"
                className={`tex-resize__chip-btn ${scopeAll ? 'is-active' : ''}`}
                disabled={busy}
                onClick={() => setScopeAll(value => !value)}
              >
                {scopeAll ? t('texResize.scopeCurrent') : t('texResize.scopeAll', { count: allTextures.length })}
              </button>
            )}
            <button
              type="button"
              className="tex-resize__chip-btn"
              disabled={busy}
              onClick={() => setSelected(new Set(visibleTextures.filter(a => canResizeTextureFile(a.fileName)).map(a => a.id)))}
            >
              {t('texResize.selectAll')}
            </button>
            <button type="button" className="tex-resize__chip-btn" disabled={busy} onClick={selectOversized}>
              {t('texResize.selectLarge', { size: maxSize })}
            </button>
            <button type="button" className="tex-resize__chip-btn" disabled={busy} onClick={selectBackedUp}>
              {t('texResize.selectBackedUp')}
            </button>
            <button type="button" className="tex-resize__chip-btn" disabled={busy} onClick={() => setSelected(new Set())}>
              {t('texResize.clear')}
            </button>
          </div>
        </div>

        <div className="tex-resize__list">
          {visibleTextures.length === 0 && (
            <div className="tex-resize__empty">{t('texResize.empty')}</div>
          )}
          {visibleTextures.map(asset => {
            const info = probes[asset.id]
            const supported = canResizeTextureFile(asset.fileName)
            const checked = selected.has(asset.id) && supported
            const preview = info && info.width > 0 ? scaledPreview(info.width, info.height, maxSize) : ''
            return (
              <label key={asset.id} className={`tex-resize__item ${supported ? '' : 'is-disabled'}`}>
                <input
                  type="checkbox"
                  disabled={!supported || busy}
                  checked={checked}
                  onChange={() => toggleItem(asset.id)}
                />
                {asset.thumb
                  ? <img className="tex-resize__thumb" src={asset.thumb} alt="" />
                  : <div className="tex-resize__thumb" />}
                <div className="tex-resize__info">
                  <div className="tex-resize__name">{asset.name}</div>
                  <div className="tex-resize__meta">
                    <span>{info ? (info.width > 0 ? `${info.width}×${info.height}` : t('texResize.unsupported')) : '...'}</span>
                    {info && info.byteLength > 0 && <span>{formatBytes(info.byteLength)}</span>}
                    {info?.hasOriginal && <span className="tex-resize__badge">{t('texResize.backedUp')}</span>}
                  </div>
                </div>
                <div className={`tex-resize__target ${preview ? '' : 'is-muted'}`}>
                  {!supported
                    ? t('texResize.skipFormat')
                    : preview
                      ? `→ ${preview}`
                      : info && info.width > 0
                        ? (info.hasOriginal ? t('texResize.restoreOrSkip') : t('texResize.alreadySmall'))
                        : ''}
                </div>
              </label>
            )
          })}
        </div>

        <div className="tex-resize__footer">
          <div className="tex-resize__status">
            {progress
              ? t('texResize.progress', { done: progress.done, total: progress.total })
              : t('texResize.backupHint')}
          </div>
          <div className="tex-resize__actions">
            <button
              type="button"
              className="tex-resize__btn"
              disabled={busy || restorableIds.length === 0}
              onClick={() => void runRestore()}
            >
              <RotateCcw size={13} />
              {t('texResize.restore', { count: restorableIds.length })}
            </button>
            <button
              type="button"
              className="tex-resize__btn tex-resize__btn--primary"
              disabled={busy || selectedIds.length === 0}
              onClick={() => void runResize()}
            >
              <ImageDown size={13} />
              {t('texResize.apply', { count: selectedIds.length })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
