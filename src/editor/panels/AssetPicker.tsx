import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { useAssetStore, type ProjectAsset } from '../assets/library'
import { useI18n, type MessageKey } from '../i18n'
import './AssetPicker.css'

export function AssetPicker({
  title,
  kinds,
  selectedId,
  onSelect,
  onClose,
}: {
  title: string
  kinds: Array<ProjectAsset['kind']>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const assets = useAssetStore(state => state.assets)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const items = useMemo(() => Object.values(assets).filter(asset => {
    if (!kinds.includes(asset.kind)) return false
    return !q || asset.name.toLowerCase().includes(q)
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh')), [assets, kinds, q])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="asset-picker__backdrop" onMouseDown={onClose}>
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
          <button type="button" className={!selectedId ? 'is-on' : ''} onClick={() => onSelect(null)}>
            <i />
            <span>{t('picker.none')}</span>
          </button>
          {items.map(asset => (
            <button key={asset.id} type="button" className={selectedId === asset.id ? 'is-on' : ''} onClick={() => onSelect(asset.id)}>
              <AssetMark asset={asset} />
              <span>{asset.name}</span>
              <em>{t(`asset.${asset.kind}` as MessageKey)}</em>
            </button>
          ))}
          {items.length === 0 && <p>{t('picker.empty')}</p>}
        </div>
      </section>
    </div>,
    document.body,
  )
}

function AssetMark({ asset }: { asset: ProjectAsset }) {
  if (asset.kind === 'texture' && asset.url && !asset.fileName.toLowerCase().endsWith('.ktx2')) {
    return <img src={asset.url} alt="" />
  }
  if ('thumb' in asset && asset.thumb) return <img src={asset.thumb} alt="" />
  if (asset.kind === 'material') return <i style={{ background: asset.slot.color }} />
  return <i />
}
