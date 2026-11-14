import { useState, type ReactNode } from 'react'
import { Eye, EyeOff, Trash2, X } from 'lucide-react'
import { useEditorStore } from '../scene/store'
import { useI18n } from '../i18n'
import { useTaxonomyUi } from './taxonomyUi'
import {
  ALL_LAYERS_VISIBLE_MASK,
  findNextFreeBitIndex,
  reshapeCollisionRows,
  sortedLayers,
  sortedTags,
  toggleCollisionPair,
  type LayerDefinition,
  type TagDefinition,
} from './taxonomy'
import './taxonomy.css'

function uniqueName(base: string, names: string[]): string {
  if (!names.includes(base)) return base
  let index = 2
  while (names.includes(`${base} (${index})`)) index += 1
  return `${base} (${index})`
}

export default function TaxonomyDialogs() {
  const tagsOpen = useTaxonomyUi(state => state.tagsOpen)
  const layersOpen = useTaxonomyUi(state => state.layersOpen)
  if (!tagsOpen && !layersOpen) return null
  return tagsOpen ? <TagsDialog /> : <LayersDialog />
}

function DialogShell({
  title,
  subtitle,
  wide,
  children,
  footer,
}: {
  title: string
  subtitle: string
  wide?: boolean
  children: ReactNode
  footer: ReactNode
}) {
  const close = () => useTaxonomyUi.getState().close()
  const { t } = useI18n()
  return (
    <div className="tax-backdrop" onMouseDown={close}>
      <section className={wide ? 'tax-dialog tax-dialog--wide' : 'tax-dialog'} role="dialog" aria-label={title} onMouseDown={event => event.stopPropagation()}>
        <header className="tax-head">
          <div className="tax-head__text">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" title={t('tags.done')} onClick={close}><X size={14} /></button>
        </header>
        {children}
        <footer className="tax-foot">{footer}</footer>
      </section>
    </div>
  )
}

function TagsDialog() {
  const { t } = useI18n()
  const tags = useEditorStore(state => state.tags)
  const rows = sortedTags(tags)
  const add = () => {
    const name = uniqueName(t('tags.addDefault'), rows.map(tag => tag.name))
    useEditorStore.getState().setTags([...tags, { id: `tag_${crypto.randomUUID().slice(0, 8)}`, name }])
  }
  const rename = (tag: TagDefinition, name: string) => {
    const next = name.trim()
    if (!next || next === tag.name) return
    if (rows.some(item => item.id !== tag.id && item.name === next)) return
    useEditorStore.getState().setTags(tags.map(item => item.id === tag.id ? { ...item, name: next } : item))
  }
  return (
    <DialogShell
      title={t('tags.title')}
      subtitle={t('tags.subtitle')}
      footer={(
        <>
          <button type="button" className="is-primary" onClick={add}>{t('tags.add')}</button>
          <button type="button" onClick={() => useTaxonomyUi.getState().close()}>{t('tags.done')}</button>
        </>
      )}
    >
      <div className="tax-scroll">
        {rows.map(tag => (
          <div key={tag.id} className="tax-item">
            <div className="tax-item__main">
              <input type="text" defaultValue={tag.name} key={`${tag.id}:${tag.name}`} onBlur={event => rename(tag, event.target.value)} />
              <div className="tax-item__meta">{tag.id}</div>
            </div>
            <button type="button" className="tax-delete" title={t('tags.remove')} onClick={() => useEditorStore.getState().setTags(tags.filter(item => item.id !== tag.id))}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </DialogShell>
  )
}

function LayersDialog() {
  const { t } = useI18n()
  const layers = useEditorStore(state => state.layers)
  const mask = useEditorStore(state => state.editorCullingMask)
  const matrixOn = useEditorStore(state => state.physicsCollisionMatrixEnabled)
  const matrixRows = useEditorStore(state => state.physicsCollisionRowMasks)
  const [tab, setTab] = useState<'layers' | 'physics'>('layers')
  const ordered = sortedLayers(layers)
  const add = () => {
    const bit = findNextFreeBitIndex(layers)
    if (bit == null) return
    const name = uniqueName(t('layers.addDefault'), layers.map(layer => layer.name))
    useEditorStore.getState().setLayers([...layers, { id: `layer_${crypto.randomUUID().slice(0, 8)}`, name, bitIndex: bit }])
  }
  const rename = (layer: LayerDefinition, name: string) => {
    const next = name.trim()
    if (!next || layer.builtIn || next === layer.name) return
    if (layers.some(item => item.id !== layer.id && item.name === next)) return
    useEditorStore.getState().setLayers(layers.map(item => item.id === layer.id ? { ...item, name: next } : item))
  }
  const shown = (layer: LayerDefinition) => (mask & (1 << layer.bitIndex)) !== 0
  const pairs: Array<[LayerDefinition, LayerDefinition]> = []
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) pairs.push([ordered[i], ordered[j]])
  }
  return (
    <DialogShell
      wide
      title={t('layers.title')}
      subtitle={t('layers.subtitle')}
      footer={(
        <>
          <button type="button" className="is-primary" disabled={tab !== 'layers'} onClick={add}>{t('layers.add')}</button>
          <button type="button" onClick={() => useTaxonomyUi.getState().close()}>{t('layers.done')}</button>
        </>
      )}
    >
      <div className="tax-tabs">
        <button type="button" className={tab === 'layers' ? 'is-on' : ''} onClick={() => setTab('layers')}>{t('layers.tabLayers')}</button>
        <button type="button" className={tab === 'physics' ? 'is-on' : ''} onClick={() => setTab('physics')}>{t('layers.tabPhysics')}</button>
      </div>
      {tab === 'layers' ? (
        <div className="tax-scroll">
          {ordered.map(layer => (
            <div key={layer.id} className="tax-item">
              <span className="tax-bit">{layer.bitIndex}</span>
              <div className="tax-item__main">
                <input type="text" defaultValue={layer.name} key={`${layer.id}:${layer.name}`} readOnly={layer.builtIn} onBlur={event => rename(layer, event.target.value)} />
                <div className="tax-item__meta">{layer.builtIn ? `${layer.id} · ${t('layers.builtIn')}` : layer.id}</div>
              </div>
              <div className="tax-actions">
                <button type="button" className="tax-icon" aria-pressed={shown(layer)} title={shown(layer) ? t('layers.hide') : t('layers.show')} onClick={() => {
                  const bit = (1 << layer.bitIndex) >>> 0
                  const current = (useEditorStore.getState().editorCullingMask ?? ALL_LAYERS_VISIBLE_MASK) >>> 0
                  useEditorStore.getState().setEditorCullingMask(shown(layer) ? (current & ~bit) >>> 0 : (current | bit) >>> 0)
                }}>{shown(layer) ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                {!layer.builtIn && (
                  <button type="button" className="tax-delete" title={t('layers.remove')} onClick={() => useEditorStore.getState().setLayers(layers.filter(item => item.id !== layer.id))}><Trash2 size={14} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tax-scroll">
          <label className="tax-switch">
            <span>{t('layers.matrixEnable')}</span>
            <input type="checkbox" checked={matrixOn} onChange={event => {
              const on = event.target.checked
              useEditorStore.getState().setPhysicsCollisionMatrix(on, on ? reshapeCollisionRows(matrixRows, ordered) : matrixRows)
            }} />
          </label>
          <p className="tax-note">{t('layers.matrixHint')}</p>
          {matrixOn && pairs.map(([row, column]) => {
            const on = ((matrixRows[row.id] ?? 0) & (1 << column.bitIndex)) !== 0
            return (
              <label key={`${row.id}:${column.id}`} className="tax-pair">
                <span>{row.name} × {column.name}</span>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => useEditorStore.getState().setPhysicsCollisionMatrix(true, toggleCollisionPair(matrixRows, row, column, !on))}
                />
              </label>
            )
          })}
          {matrixOn && pairs.length === 0 && <p className="tax-note">{t('layers.matrixEmpty')}</p>}
        </div>
      )}
    </DialogShell>
  )
}
