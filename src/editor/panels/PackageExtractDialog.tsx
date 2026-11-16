import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Clapperboard, Image, Minus, Palette, Plus, X } from 'lucide-react'
import { scanPackageAssets, type PackageAssetScannerDirectory, type PackageAssetScannerEntry, type PackageAssetScannerResult, type PackageExtractableAssetKind } from '../assets/package/packageAssetScanner'
import { extractPackageEntries, withReferencedTextures, type PackageExtractionProgress } from '../assets/package/extractPackage'
import type { PackageModelAssetRole } from '../assets/package/packageAssetRoleGuess'
import { normalizeDir } from '../assets/folders'
import { useAssetStore } from '../assets/library'
import { selectTab } from '../layout/events'
import { useEditorStore } from '../scene/store'
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
  const [roleOverrides, setRoleOverrides] = useState<Record<string, PackageModelAssetRole>>({})
  const [carrierBodyLinks, setCarrierBodyLinks] = useState<Record<string, string>>({})
  const [advancedOpen, setAdvancedOpen] = useState(true)
  const [mergeAnimations, setMergeAnimations] = useState(false)

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
    setRoleOverrides({})
    setCarrierBodyLinks({})
    setMergeAnimations(false)
    file.arrayBuffer()
      .then(buffer => scanPackageAssets(buffer))
      .then(next => {
        if (cancelled) return
        setResult(next)
        setSelectedIds(new Set(next.entries.map(entry => entry.id)))
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => {
        window.clearTimeout(slowTimer)
        if (!cancelled) { setLoading(false); setSlowScan(false) }
      })
    return () => { cancelled = true; window.clearTimeout(slowTimer) }
  }, [file, open])

  const entries = result?.entries ?? []
  const totals = useMemo(() => ({
    model: entries.filter(entry => entry.kind === 'model').length,
    texture: entries.filter(entry => entry.kind === 'texture').length,
    animation: entries.filter(entry => entry.kind === 'animation').length,
    material: entries.filter(entry => entry.kind === 'material').length,
  }), [entries])
  const selected = entries.filter(entry => selectedIds.has(entry.id))
  const expanded = useMemo(() => withReferencedTextures(selected, entries), [entries, selectedIds])
  const directoryIds = useMemo(() => result ? directoryEntryIds(result.tree) : new Map<string, string[]>(), [result])
  const bodies = entries.filter(entry => (roleOverrides[entry.id] ?? entry.roleGuess?.role) === 'modelBody')
  const bodyOptions = bodies.map(entry => <option key={entry.id} value={entry.id}>{entry.fileName}</option>)
  const groups = mergeAnimations ? mergeGroups(entries, selectedIds, roleOverrides, carrierBodyLinks) : []

  const extract = async () => {
    if (expanded.length === 0 || extracting) return
    setExtracting(true)
    setProgress({ phase: 'textures', completed: 0, total: expanded.length })
    try {
      const done = await extractPackageEntries(expanded, {
        targetDirectory: normalizeDir(targetDirectory),
        directoryMode,
        mergeAnimations,
        roles: reviewedRoles(entries, roleOverrides),
        carrierBodies: reviewedLinks(entries, roleOverrides, carrierBodyLinks),
        onProgress: setProgress,
      })
      const editor = useEditorStore.getState()
      if (done.imported.length) {
        editor.log('info', t('pkg.extractSuccess', { count: done.imported.length }))
        useAssetStore.getState().setBrowseDir(normalizeDir(targetDirectory))
        editor.inspectAsset(null)
        selectTab('tab-project')
      }
      if (done.failed.length) editor.log('error', t('pkg.extractFailed', { count: done.failed.length }))
      if (done.failed.length === 0) onClose()
    } finally {
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
          <Summary label={t('pkg.hidden')} value={result?.stats.hidden ?? 0} />
          <Summary label={t('pkg.unsupported')} value={result?.stats.unsupported ?? 0} />
        </section>
        <main className="pkg-extract__body">
          {loading && <div className="pkg-extract__empty"><span>{t('pkg.scanning')}</span>{slowScan && <small>{t('pkg.scanningSlow')}</small>}</div>}
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
              <details className={`pkg-extract__advanced${mergeAnimations ? ' pkg-extract__advanced--enabled' : ''}`} open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
                <summary>
                  <span className="pkg-extract__advanced-title"><span>{advancedOpen ? '↑' : '↓'}</span><span>{t('pkg.advancedOptions')}</span></span>
                  <span className="pkg-extract__advanced-status">{mergeAnimations ? t('pkg.advancedOptionsEnabled') : t('pkg.advancedOptionsOff')}</span>
                </summary>
                <div className="pkg-extract__advanced-options">
                  <label>
                    <input type="checkbox" checked={mergeAnimations} onChange={event => setMergeAnimations(event.target.checked)} />
                    <span>{t('pkg.mergeFbxAnimations')}</span>
                  </label>
                </div>
              </details>
              {groups.length > 0 && (
                <section className="pkg-extract__merge-preview">
                  <header>
                    <strong>{t('pkg.mergePreview.title')}</strong>
                    <span>{t('pkg.mergePreview.summary', { bodies: groups.length, carriers: groups.reduce((sum, group) => sum + group.carriers.length, 0) })}</span>
                  </header>
                  <div className="pkg-extract__merge-preview-list">
                    {groups.map(group => (
                      <article key={group.body.id} className="pkg-extract__merge-preview-item">
                        <div className="pkg-extract__merge-preview-body"><strong>{group.body.fileName}</strong><span>{group.body.originalPath}</span></div>
                        <div className="pkg-extract__merge-preview-clips">{group.carriers.map(carrier => <span key={carrier.id}>{clipLabel(carrier)}</span>)}</div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              <DirectoryTree
                directory={result.tree}
                root
                selectedIds={selectedIds}
                directoryIds={directoryIds}
                roles={roleOverrides}
                links={carrierBodyLinks}
                bodyOptions={bodyOptions}
                showRoles={mergeAnimations}
                onToggleEntry={id => setSelectedIds(prev => toggleSet(prev, id))}
                onToggleDirectory={(ids, checked) => setSelectedIds(prev => {
                  const next = new Set(prev)
                  for (const id of ids) { if (checked) next.add(id); else next.delete(id) }
                  return next
                })}
                onRole={(id, role) => {
                  setRoleOverrides(prev => ({ ...prev, [id]: role }))
                  if (role !== 'animationCarrier') setCarrierBodyLinks(prev => { const next = { ...prev }; delete next[id]; return next })
                }}
                onLink={(id, bodyId) => setCarrierBodyLinks(prev => { const next = { ...prev }; if (bodyId) next[id] = bodyId; else delete next[id]; return next })}
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
            <div className="pkg-extract__busy-card">
              <div className="pkg-extract__busy-head">
                <span className="pkg-extract__spinner" />
                <div>
                  <strong>{t('pkg.extractingTitle')}</strong>
                  <span>{t('pkg.extractingProgress', { completed: progress?.completed ?? 0, total: progress?.total ?? expanded.length })}</span>
                </div>
              </div>
              <p>{progress ? `${t(`pkg.phase.${progress.phase}` as MessageKey)}${progress.fileName ? ` · ${progress.fileName}` : ''}` : ''}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const KIND_MARK: Record<PackageExtractableAssetKind, typeof Box> = {
  model: Box,
  texture: Image,
  animation: Clapperboard,
  material: Palette,
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
  selectedIds: Set<string>
  directoryIds: Map<string, string[]>
  roles: Record<string, PackageModelAssetRole>
  links: Record<string, string>
  bodyOptions: ReactNode
  showRoles: boolean
  onToggleEntry: (id: string) => void
  onToggleDirectory: (ids: string[], checked: boolean) => void
  onRole: (id: string, role: PackageModelAssetRole) => void
  onLink: (id: string, bodyId: string) => void
}) {
  const { t } = useI18n()
  const ids = props.directoryIds.get(props.directory.path) ?? []
  const state = selectionState(ids, props.selectedIds)
  const content = (
    <>
      {props.directory.entries.map(entry => {
        const role = props.roles[entry.id] ?? entry.roleGuess?.role
        const showRole = props.showRoles && (entry.kind === 'model' || entry.kind === 'animation')
        return (
          <div key={entry.id} className="pkg-extract__entry">
            <input type="checkbox" checked={props.selectedIds.has(entry.id)} onChange={() => props.onToggleEntry(entry.id)} aria-label={entry.fileName} />
            <KindMark kind={entry.kind} />
            <div className="pkg-extract__entry-main">
              <strong>{entry.fileName}</strong>
              <span>{entry.originalPath}</span>
              {showRole && (
                <div className="pkg-extract__role-line">
                  <span className={`pkg-extract__role-badge pkg-extract__role-badge--${role ?? 'unknownModel'}`}>{t(`pkg.role.${role ?? 'unknownModel'}` as MessageKey)}</span>
                  {entry.roleGuess && <span>{t(`pkg.confidence.${entry.roleGuess.confidence}` as MessageKey)}</span>}
                </div>
              )}
            </div>
            <div className="pkg-extract__entry-meta">
              {showRole && (
                <select className="pkg-extract__role-select" value={role ?? 'unknownModel'} aria-label={t('pkg.roleOverrideFor', { name: entry.fileName })} onChange={event => props.onRole(entry.id, event.target.value as PackageModelAssetRole)}>
                  <option value="modelBody">{t('pkg.role.modelBody')}</option>
                  <option value="animationCarrier">{t('pkg.role.animationCarrier')}</option>
                  <option value="ordinaryModel">{t('pkg.role.ordinaryModel')}</option>
                  <option value="unknownModel">{t('pkg.role.unknownModel')}</option>
                </select>
              )}
              {showRole && role === 'animationCarrier' && (
                <select className="pkg-extract__role-select" value={props.links[entry.id] ?? entry.roleGuess?.relatedBodyEntryIds?.[0] ?? ''} aria-label={t('pkg.carrierBodyFor', { name: entry.fileName })} onChange={event => props.onLink(entry.id, event.target.value)}>
                  <option value="">{t('pkg.noCarrierBody')}</option>
                  {props.bodyOptions}
                </select>
              )}
              {entry.conversionNote && <span>{entry.conversionNote}</span>}
              {entry.companionFiles.length > 0 && <span>{t('pkg.companions', { count: entry.companionFiles.length })}</span>}
              {entry.warnings.length > 0 && <span>{t('pkg.warnings', { count: entry.warnings.length })}</span>}
            </div>
          </div>
        )
      })}
      {props.directory.children.map(child => <DirectoryTree key={child.path} {...props} directory={child} root={false} />)}
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
        <DirectoryCheck state={state} onToggle={() => props.onToggleDirectory(ids, state !== 'checked')} />
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

function directoryEntryIds(root: PackageAssetScannerDirectory): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const visit = (directory: PackageAssetScannerDirectory): string[] => {
    const ids = directory.entries.map(entry => entry.id)
    for (const child of directory.children) ids.push(...visit(child))
    out.set(directory.path, ids)
    return ids
  }
  visit(root)
  return out
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

function mergeGroups(entries: PackageAssetScannerEntry[], selected: Set<string>, overrides: Record<string, PackageModelAssetRole>, links: Record<string, string>) {
  const bodies = new Map(entries.filter(entry => selected.has(entry.id) && entry.extension === 'fbx' && (overrides[entry.id] ?? entry.roleGuess?.role) === 'modelBody').map(entry => [entry.id, entry]))
  const grouped = new Map<string, PackageAssetScannerEntry[]>()
  for (const entry of entries) {
    if (!selected.has(entry.id) || entry.extension !== 'fbx') continue
    if ((overrides[entry.id] ?? entry.roleGuess?.role) !== 'animationCarrier') continue
    const bodyId = links[entry.id] ?? entry.roleGuess?.relatedBodyEntryIds?.find(id => bodies.has(id))
    if (!bodyId || !bodies.has(bodyId)) continue
    grouped.set(bodyId, [...(grouped.get(bodyId) ?? []), entry])
  }
  return [...grouped].map(([id, carriers]) => ({ body: bodies.get(id)!, carriers }))
}

function clipLabel(entry: PackageAssetScannerEntry): string {
  const base = entry.fileName.replace(/\.[^.]+$/, '')
  const marker = base.lastIndexOf('@')
  return marker >= 0 ? base.slice(marker + 1) : base
}

function defaultTarget(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[<>:"|?*\u0000-\u001f\\/]+/g, '_').trim() || 'Package'
  return normalizeDir(`Assets/Imported/${base}`)
}
