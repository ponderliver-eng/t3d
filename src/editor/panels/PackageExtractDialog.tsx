import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Clapperboard, Globe, Image, Minus, Palette, Plus, Search, X } from 'lucide-react'
import { scanPackageArchive, scanPackageAssets, type PackageAssetScannerDirectory, type PackageAssetScannerEntry, type PackageAssetScannerResult, type PackageExtractableAssetKind } from '../assets/package/packageAssetScanner'
import { extractPackageEntries, withReferencedTextures, type PackageExtractionProgress } from '../assets/package/extractPackage'
import type { PackageModelAssetRole } from '../assets/package/packageAssetRoleGuess'
import { normalizeDir } from '../assets/folders'
import { useAssetStore } from '../assets/library'
import { selectTab } from '../layout/events'
import { useEditorStore } from '../scene/store'
import { electronBridge } from '../project/electronBridge'
import { useI18n, type MessageKey } from '../i18n'
import './PackageExtractDialog.css'

export function PackageExtractDialog({ file, open, onClose }: { file: File | null; open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const [result, setResult] = useState<PackageAssetScannerResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [targetDirectory, setTargetDirectory] = useState('Assets/Imported')
  const [directoryMode, setDirectoryMode] = useState<'flat' | 'preserve'>('flat')
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState<PackageExtractionProgress | null>(null)
  const [slowScan, setSlowScan] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null)
  const [query, setQuery] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open || !file) return
    let cancelled = false
    const slowTimer = window.setTimeout(() => { if (!cancelled) setSlowScan(true) }, 5000)
    setLoading(true)
    setSlowScan(false)
    setError(null)
    setResult(null)
    setSelectedIds(new Set())
    setTargetDirectory(defaultTarget(file.name))
    setDirectoryMode('flat')
    setDiagnosticsOpen(false)
    setExtracting(false)
    setProgress(null)
    setScanProgress(null)
    setQuery('')
    // 桌面版：主进程流式解压建索引，整包不进内存；这个会话要一直留到对话框关闭（提取时按偏移读文件）
    const packageBridge = electronBridge()?.package
    const sessionId = `pkg_${crypto.randomUUID().replace(/-/g, '')}`
    const stopProgress = packageBridge?.onProgress(payload => {
      if (!cancelled && payload.sessionId === sessionId) setScanProgress({ done: payload.done, total: payload.total })
    })
    const scanInMemory = async () => {
      if (file.size > BROWSER_PACKAGE_LIMIT) throw new Error(t('pkg.tooLargeForBrowser', { size: formatSize(file.size) }))
      return scanPackageAssets(await file.arrayBuffer())
    }
    const scan = async () => {
      if (!packageBridge) return scanInMemory()
      let opened: Awaited<ReturnType<typeof packageBridge.open>>
      try {
        opened = await packageBridge.open(sessionId, file)
      } catch (err) {
        // 文件不是从本地磁盘选的（拿不到路径）时退回整包读进内存的老路
        if (err instanceof Error && err.message.includes('本地路径')) return scanInMemory()
        throw err
      }
      return scanPackageArchive(opened.entries.map(entry => ({
        path: entry.path,
        type: entry.type,
        size: entry.size,
        inline: entry.inline,
        read: async () => new Uint8Array(await packageBridge.read(sessionId, entry.offset, entry.size)),
      })))
    }
    scan()
      .then(next => {
        if (cancelled) return
        setResult(next)
        setSelectedIds(new Set(next.entries.map(entry => entry.id)))
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => {
        window.clearTimeout(slowTimer)
        if (!cancelled) { setLoading(false); setSlowScan(false); setScanProgress(null) }
      })
    return () => {
      cancelled = true
      window.clearTimeout(slowTimer)
      stopProgress?.()
      abortRef.current?.abort()
      void packageBridge?.close(sessionId).catch(() => undefined)
    }
    // 依赖里不放 t：它只用来拼报错文案，切换语言不应该重新扫描一遍
  }, [file, open])

  const entries = result?.entries ?? []
  const totals = useMemo(() => ({
    model: entries.filter(entry => entry.kind === 'model').length,
    texture: entries.filter(entry => entry.kind === 'texture').length,
    animation: entries.filter(entry => entry.kind === 'animation').length,
    material: entries.filter(entry => entry.kind === 'material').length,
    scene: entries.filter(entry => entry.kind === 'scene').length,
  }), [entries])
  const selected = entries.filter(entry => selectedIds.has(entry.id))
  const expanded = useMemo(
    () => withReferencedTextures(selected, entries, result?.materialBindingSources),
    [entries, selectedIds, result?.materialBindingSources],
  )
  const filter = query.trim().toLowerCase()

  const extract = async () => {
    if (expanded.length === 0 || extracting) return
    setExtracting(true)
    setProgress({ phase: 'textures', completed: 0, total: expanded.length })
    const abort = new AbortController()
    abortRef.current = abort
    const totalBytes = expanded.reduce((sum, entry) => sum + entry.sizeBytes, 0)
    try {
      const done = await extractPackageEntries(expanded, {
        // 文件多或体积大时走批量模式：入库后立刻放掉内存里的副本，用到时再加载
        bulk: expanded.length > BULK_FILE_COUNT || totalBytes > BULK_BYTES,
        signal: abort.signal,
        targetDirectory: normalizeDir(targetDirectory),
        directoryMode,
        mergeAnimations: false,
        roles: reviewedRoles(entries, {}),
        carrierBodies: reviewedLinks(entries, {}, {}),
        materialBindingSources: result?.materialBindingSources,
        onProgress: setProgress,
      })
      const editor = useEditorStore.getState()
      if (done.imported.length) {
        editor.log('info', t('pkg.extractSuccess', { count: done.imported.length }))
        useAssetStore.getState().setBrowseDir(normalizeDir(targetDirectory))
        editor.inspectAsset(null)
        selectTab('tab-project')
      }
      if (done.cancelled) editor.log('warn', t('pkg.cancelled', { count: done.imported.length }))
      if (done.failed.length) {
        editor.log('error', t('pkg.extractFailed', { count: done.failed.length }))
        // 逐条列出失败的文件和原因，不让失败悄悄过去
        const shown = done.failed.slice(0, 20).map(item => `${item.name}：${item.error}`).join('\n')
        editor.log('error', `${t('pkg.failedList', { count: done.failed.length })}\n${shown}${done.failed.length > 20 ? '\n…' : ''}`)
      }
      if (done.failed.length === 0 && !done.cancelled) onClose()
    } catch (err) {
      useEditorStore.getState().log('error', t('pkg.scanFailed', { detail: err instanceof Error ? err.message : String(err) }))
    } finally {
      abortRef.current = null
      setExtracting(false)
      setProgress(null)
    }
  }

  if (!open) return null
  return (
    <div className="pkg-extract__backdrop" role="dialog" aria-modal="true">
      <div className={`pkg-extract${extracting ? ' pkg-extract--busy' : ''}`}>
        <header className="pkg-extract__header">
          <div>
            <h2>{t('pkg.title')}</h2>
            <p>{file?.name ?? t('pkg.noFile')}</p>
          </div>
          <button type="button" className="pkg-extract__close" title={t('pkg.close')} aria-label={t('pkg.close')} onClick={onClose} disabled={extracting}><X size={16} /></button>
        </header>
        <section className="pkg-extract__summary">
          <Summary label={t('pkg.models')} value={totals.model} icon={Box} color="#9fc5ff" />
          <Summary label={t('pkg.textures')} value={totals.texture} icon={Image} color="#a9e7b0" />
          <Summary label={t('pkg.animations')} value={totals.animation} icon={Clapperboard} color="#f2cf7f" />
          <Summary label={t('pkg.materials')} value={totals.material} icon={Palette} color="#d4b8ff" />
          <Summary label={t('pkg.scenes')} value={totals.scene} icon={Globe} color="#7ce0d3" />
          <Summary label={t('pkg.hidden')} value={result?.stats.hidden ?? 0} />
          <Summary label={t('pkg.unsupported')} value={result?.stats.unsupported ?? 0} />
        </section>
        <main className="pkg-extract__body">
          {loading && (
            <div className="pkg-extract__empty">
              <span>{t('pkg.scanning')}</span>
              {scanProgress && scanProgress.total > 0 && (
                <small>{t('pkg.scanProgress', {
                  percent: Math.min(100, Math.round(scanProgress.done / scanProgress.total * 100)),
                  done: formatSize(scanProgress.done),
                  total: formatSize(scanProgress.total),
                })}</small>
              )}
              {slowScan && <small>{t('pkg.scanningSlow')}</small>}
            </div>
          )}
          {error && <div className="pkg-extract__error">{t('pkg.scanFailed', { detail: error })}</div>}
          {!loading && !error && result && entries.length === 0 && <div className="pkg-extract__empty">{t('pkg.empty')}</div>}
          {!loading && !error && result && entries.length > 0 && (
            <>
              <div className="pkg-extract__toolbar">
                <button type="button" onClick={() => setSelectedIds(new Set(entries.map(entry => entry.id)))}>{t('pkg.selectAll')}</button>
                <button type="button" onClick={() => setSelectedIds(new Set())}>{t('pkg.selectNone')}</button>
                <button type="button" onClick={() => setSelectedIds(new Set(entries.filter(entry => entry.kind === 'model').map(entry => entry.id)))}>{t('pkg.selectModels')}</button>
                <button type="button" onClick={() => setSelectedIds(new Set(entries.filter(entry => entry.kind === 'texture').map(entry => entry.id)))}>{t('pkg.selectTextures')}</button>
                <button type="button" onClick={() => setSelectedIds(new Set(entries.filter(entry => entry.kind === 'animation').map(entry => entry.id)))}>{t('pkg.selectAnimations')}</button>
                <button type="button" onClick={() => setSelectedIds(new Set(entries.filter(entry => entry.kind === 'material').map(entry => entry.id)))}>{t('pkg.selectMaterials')}</button>
                <button type="button" onClick={() => setSelectedIds(new Set(entries.filter(entry => entry.kind === 'scene').map(entry => entry.id)))}>{t('pkg.selectScenes')}</button>
                <label className="pkg-extract__target">
                  <span>{t('pkg.targetDirectory')}</span>
                  <input value={targetDirectory} onChange={event => setTargetDirectory(event.target.value)} onBlur={() => setTargetDirectory(normalizeDir(targetDirectory))} />
                </label>
                <label className="pkg-extract__target pkg-extract__target--mode">
                  <span>{t('pkg.directoryMode')}</span>
                  <select value={directoryMode} onChange={event => setDirectoryMode(event.target.value as 'flat' | 'preserve')}>
                    <option value="flat">{t('pkg.directoryModeFlat')}</option>
                    <option value="preserve">{t('pkg.directoryModePreserve')}</option>
                  </select>
                </label>
                <button type="button" onClick={() => setDiagnosticsOpen(value => !value)}>{diagnosticsOpen ? t('pkg.hideDiagnostics') : t('pkg.showDiagnostics')}</button>
              </div>
              {diagnosticsOpen && result && (
                <div className="pkg-extract__diagnostics">
                  <div className="pkg-extract__diagnostics-grid">
                    {(['hidden', 'unsupported', 'missingPathname', 'missingAssetBytes'] as const).map(key => (
                      <div key={key}><span>{t(`pkg.diag.${key}` as MessageKey)}</span><strong>{result.stats[key]}</strong></div>
                    ))}
                  </div>
                  {result.diagnostics.length > 0 && (
                    <section className="pkg-extract__diagnostics-section">
                      <strong>{t('pkg.diag.scan')}</strong>
                      <ul>{result.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}><strong>{item.code}</strong><span>{item.path ? `${item.path}: ` : ''}{item.message}</span></li>)}</ul>
                    </section>
                  )}
                </div>
              )}
              <label className="pkg-extract__filter">
                <Search size={14} />
                <input
                  value={query}
                  placeholder={t('pkg.filterPlaceholder')}
                  onChange={event => setQuery(event.target.value)}
                />
                {query && <button type="button" aria-label={t('pkg.close')} onClick={() => setQuery('')}><X size={12} /></button>}
              </label>
              <DirectoryTree
                directory={result.tree}
                root
                filter={filter}
                selectedIds={selectedIds}
                onToggleEntry={id => setSelectedIds(prev => toggleSet(prev, id))}
                onToggleDirectory={(ids, checked) => setSelectedIds(prev => {
                  const next = new Set(prev)
                  for (const id of ids) { if (checked) next.add(id); else next.delete(id) }
                  return next
                })}
              />
            </>
          )}
        </main>
        <footer className="pkg-extract__footer">
          <div className="pkg-extract__footer-note">{t('pkg.selectedSummary', { count: expanded.length })} · {normalizeDir(targetDirectory)} · {t('pkg.previewOnly')}</div>
          <div className="pkg-extract__footer-actions">
            <button type="button" className="pkg-extract__primary" disabled={expanded.length === 0 || extracting} onClick={() => { void extract() }}>
              {extracting ? t('pkg.extracting') : t('pkg.extractSelected', { count: expanded.length })}
            </button>
            <button type="button" className="pkg-extract__secondary" disabled={extracting} onClick={onClose}>{t('pkg.close')}</button>
          </div>
        </footer>
        {extracting && (
          <div className="pkg-extract__busy-overlay">
            <div className="pkg-extract__busy-card" role="status">
              <span className="pkg-extract__spinner" />
              <div className="pkg-extract__busy-copy">
                <strong>{t('pkg.extractingTitle')}</strong>
                <span>{t('pkg.extractingProgress', { completed: progress?.completed ?? 0, total: progress?.total ?? expanded.length })}</span>
              </div>
              <div className="pkg-extract__progress" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.round(((progress?.completed ?? 0) / Math.max(1, progress?.total ?? expanded.length)) * 100))}%` }} />
              </div>
              <p className="pkg-extract__busy-file" title={progress?.fileName || undefined}>
                {progress ? `${t(`pkg.phase.${progress.phase}` as MessageKey)}${progress.fileName ? ` · ${progress.fileName}` : ''}` : ''}
              </p>
              <div className="pkg-extract__busy-actions">
                <button type="button" className="pkg-extract__secondary" onClick={() => abortRef.current?.abort()}>{t('pkg.cancel')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 网页版只能把整包读进内存，超过这个大小直接拒绝，避免浏览器崩溃。 */
const BROWSER_PACKAGE_LIMIT = 1024 * 1024 * 1024
/** 超过这两个值按批量模式导入（和直接拖文件导入的阈值一致）。 */
const BULK_FILE_COUNT = 12
const BULK_BYTES = 256 * 1024 * 1024

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
  return `${Math.round(bytes / 1024 / 1024)}MB`
}

const KIND_MARK: Record<PackageExtractableAssetKind, typeof Box> = {
  model: Box,
  texture: Image,
  animation: Clapperboard,
  material: Palette,
  scene: Globe,
}

function KindMark({ kind }: { kind: PackageExtractableAssetKind }) {
  const { t } = useI18n()
  const Icon = KIND_MARK[kind]
  const label = t(`pkg.kind.${kind}` as MessageKey)
  return (
    <span className={`pkg-extract__kind pkg-extract__kind--${kind}`} title={label} aria-label={label}>
      <Icon size={15} />
    </span>
  )
}

function Summary({ label, value, icon: Icon, color }: { label: string; value: number; icon?: typeof Box; color?: string }) {
  return (
    <div className="pkg-extract__summary-item">
      <span>{Icon && <Icon size={13} color={color} />}{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DirectoryTree(props: {
  directory: PackageAssetScannerDirectory
  root?: boolean
  filter: string
  selectedIds: Set<string>
  onToggleEntry: (id: string) => void
  onToggleDirectory: (ids: string[], checked: boolean) => void
}) {
  const { t } = useI18n()
  const entries = props.directory.entries.filter(entry => matchesFilter(entry, props.filter))
  const children = props.directory.children.filter(child => directoryVisible(child, props.filter))
  const visibleIds = collectVisibleIds(props.directory, props.filter)
  const state = selectionState(visibleIds, props.selectedIds)
  if (!props.root && entries.length === 0 && children.length === 0) return null
  const content = (
    <>
      {entries.map(entry => (
        <div key={entry.id} className="pkg-extract__entry">
          <input type="checkbox" checked={props.selectedIds.has(entry.id)} onChange={() => props.onToggleEntry(entry.id)} aria-label={entry.fileName} />
          <KindMark kind={entry.kind} />
          <div className="pkg-extract__entry-main">
            <strong>{entry.fileName}</strong>
            <span>{entry.originalPath}</span>
          </div>
          <div className="pkg-extract__entry-meta">
            {entry.conversionNote && <span>{entry.conversionNote}</span>}
            {entry.companionFiles.length > 0 && <span>{t('pkg.companions', { count: entry.companionFiles.length })}</span>}
            {entry.warnings.length > 0 && <span>{t('pkg.warnings', { count: entry.warnings.length })}</span>}
          </div>
        </div>
      ))}
      {children.map(child => <DirectoryTree key={child.path} {...props} directory={child} root={false} />)}
      {props.root && entries.length === 0 && children.length === 0 && <div className="pkg-extract__empty">{t('pkg.filterEmpty')}</div>}
    </>
  )
  if (props.root) return <div className="pkg-extract__tree">{content}</div>
  return (
    <details className="pkg-extract__dir" open>
      <summary>
        <span className="pkg-extract__dir-twist">
          <Plus size={11} strokeWidth={2.75} className="pkg-extract__dir-plus" />
          <Minus size={11} strokeWidth={2.75} className="pkg-extract__dir-minus" />
        </span>
        <DirectoryCheck state={state} onToggle={() => props.onToggleDirectory(visibleIds, state !== 'checked')} />
        <span className="pkg-extract__dir-name">{props.directory.name}</span>
      </summary>
      <div className="pkg-extract__dir-body">{content}</div>
    </details>
  )
}

function DirectoryCheck({ state, onToggle }: { state: 'checked' | 'mixed' | 'empty'; onToggle: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'mixed' }, [state])
  return <input ref={ref} className="pkg-extract__dir-check" type="checkbox" checked={state === 'checked'} onClick={event => event.stopPropagation()} onChange={onToggle} />
}

function selectionState(ids: string[], selected: Set<string>): 'checked' | 'mixed' | 'empty' {
  if (ids.length === 0) return 'empty'
  const count = ids.filter(id => selected.has(id)).length
  if (count === 0) return 'empty'
  return count === ids.length ? 'checked' : 'mixed'
}

function matchesFilter(entry: PackageAssetScannerEntry, filter: string): boolean {
  if (!filter) return true
  return entry.fileName.toLowerCase().includes(filter) || entry.originalPath.toLowerCase().includes(filter)
}

function directoryVisible(directory: PackageAssetScannerDirectory, filter: string): boolean {
  if (!filter) return true
  if (directory.entries.some(entry => matchesFilter(entry, filter))) return true
  return directory.children.some(child => directoryVisible(child, filter))
}

function collectVisibleIds(directory: PackageAssetScannerDirectory, filter: string): string[] {
  const ids = directory.entries.filter(entry => matchesFilter(entry, filter)).map(entry => entry.id)
  for (const child of directory.children) {
    if (directoryVisible(child, filter)) ids.push(...collectVisibleIds(child, filter))
  }
  return ids
}

function toggleSet(source: Set<string>, id: string): Set<string> {
  const next = new Set(source)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function reviewedRoles(entries: PackageAssetScannerEntry[], overrides: Record<string, PackageModelAssetRole>) {
  const out: Record<string, PackageModelAssetRole> = {}
  for (const entry of entries) {
    const role = overrides[entry.id] ?? entry.roleGuess?.role
    if (role) out[entry.id] = role
  }
  return out
}

function reviewedLinks(entries: PackageAssetScannerEntry[], overrides: Record<string, PackageModelAssetRole>, links: Record<string, string>) {
  const out: Record<string, string> = {}
  const bodies = new Set(entries.filter(entry => (overrides[entry.id] ?? entry.roleGuess?.role) === 'modelBody').map(entry => entry.id))
  for (const entry of entries) {
    if ((overrides[entry.id] ?? entry.roleGuess?.role) !== 'animationCarrier') continue
    const linked = links[entry.id] ?? entry.roleGuess?.relatedBodyEntryIds?.[0]
    if (linked && bodies.has(linked)) out[entry.id] = linked
  }
  return out
}

function defaultTarget(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[<>:"|?*\u0000-\u001f\\/]+/g, '_').trim() || 'Package'
  return normalizeDir(`Assets/Imported/${base}`)
}
