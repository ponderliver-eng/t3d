import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { AssetPicker } from '../editor/panels/AssetPicker'
import { useAssetStore } from '../editor/assets/library'
import { useEditorStore } from '../editor/scene/store'
import type { NodeKind } from '../editor/scene/types'
import { useI18n } from '../editor/i18n'
import '../editor/panels/AssetPicker.css'

export function TagField({ value, disabled, onChange }: { value: string, disabled: boolean, onChange: (id: string) => void }) {
  const { t } = useI18n()
  const tags = useEditorStore(state => state.tags)
  const [open, setOpen] = useState(false)
  const current = tags.find(tag => tag.id === value || tag.name === value)
  return (
    <>
      <PickButton disabled={disabled} label={current?.name || (value ? t('picker.missing') : t('picker.none'))} onClick={() => setOpen(true)} />
      {open && (
        <ListPicker
          title={t('rule.pickTag')}
          selectedId={current?.id ?? ''}
          rows={tags.map(tag => ({ id: tag.id, name: tag.name }))}
          onSelect={id => { onChange(id); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

export function NodeField({
  value,
  kinds,
  title,
  disabled,
  onChange,
}: {
  value: string
  kinds?: NodeKind[]
  title: string
  disabled: boolean
  onChange: (id: string) => void
}) {
  const { t } = useI18n()
  const nodes = useEditorStore(state => state.nodes)
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => Object.values(nodes)
    .filter(node => !kinds || kinds.includes(node.kind))
    .map(node => ({ id: node.id, name: node.name, hint: node.kind }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh')), [nodes, kinds])
  const current = rows.find(row => row.id === value || row.name === value)
  return (
    <>
      <PickButton disabled={disabled} label={current?.name || (value ? t('picker.missing') : t('picker.none'))} onClick={() => setOpen(true)} />
      {open && (
        <ListPicker
          title={title}
          selectedId={current?.id ?? ''}
          rows={rows}
          onSelect={id => { onChange(id); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

export function PrefabField({ value, disabled, onChange }: { value: string, disabled: boolean, onChange: (id: string) => void }) {
  const { t } = useI18n()
  const assets = useAssetStore(state => state.assets)
  const [open, setOpen] = useState(false)
  const current = assets[value] ?? Object.values(assets).find(item => item.kind === 'prefab' && item.name === value)
  return (
    <>
      <PickButton disabled={disabled} label={current?.name || (value ? t('picker.missing') : t('picker.none'))} onClick={() => setOpen(true)} />
      {open && (
        <AssetPicker
          title={t('rule.pickPrefab')}
          kinds={['prefab']}
          selectedId={current?.id ?? null}
          onSelect={id => { onChange(id ?? ''); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function PickButton({ label, disabled, onClick }: { label: string, disabled: boolean, onClick: () => void }) {
  return (
    <button type="button" className="asset-ref" disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      <Search size={12} />
    </button>
  )
}

function ListPicker({
  title,
  selectedId,
  rows,
  onSelect,
  onClose,
}: {
  title: string
  selectedId: string
  rows: { id: string, name: string, hint?: string }[]
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = rows.filter(row => !q || row.name.toLowerCase().includes(q))
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="asset-picker__backdrop rule-picker" onMouseDown={onClose}>
      <section className="asset-picker" role="dialog" aria-label={title} onMouseDown={event => event.stopPropagation()}>
        <header className="asset-picker__header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}><X size={14} /></button>
        </header>
        <div className="asset-picker__search">
          <Search size={12} />
          <input autoFocus value={query} placeholder={t('picker.search')} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="asset-picker__list">
          <button type="button" className={!selectedId ? 'is-on' : ''} onClick={() => onSelect('')}>
            <i />
            <span>{t('picker.none')}</span>
          </button>
          {shown.map(row => (
            <button key={row.id} type="button" className={selectedId === row.id ? 'is-on' : ''} onClick={() => onSelect(row.id)}>
              <i />
              <span>{row.name}</span>
              {row.hint ? <em>{row.hint}</em> : null}
            </button>
          ))}
          {shown.length === 0 && <p>{t('rule.pickEmpty')}</p>}
        </div>
      </section>
    </div>,
    document.body,
  )
}
