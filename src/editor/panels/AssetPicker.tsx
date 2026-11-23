import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { LayoutGrid, List, Search, X } from 'lucide-react'
import { MaterialBall } from '../assets/materialBall'
import { subscribeModels } from '../assets/models'
import { useAssetStore, type ProjectAsset } from '../assets/library'
import { useI18n, type MessageKey } from '../i18n'
import './AssetPicker.css'

const PICKER_VIEW_KEY = 't3d.assetPicker.view'
const LEGACY_TEXTURE_VIEW_KEY = 't3d.texturePicker.view'

function readPickerView(): 'list' | 'grid' {
  try {
    const val = localStorage.getItem(PICKER_VIEW_KEY) ?? localStorage.getItem(LEGACY_TEXTURE_VIEW_KEY)
    return val === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

export function AssetPicker({
  title,
  kinds,
  selectedId,
  include,
  onSelect,
  onClose,
}: {
  title: string
  kinds: Array<ProjectAsset['kind']>
  selectedId: string | null
  include?: (asset: ProjectAsset) => boolean
  onSelect: (id: string | null) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const assets = useAssetStore(state => state.assets)
  const [view, setView] = useState<'list' | 'grid'>(readPickerView)
  const thumbs = view === 'grid'
  const [query, setQuery] = useState('')
  const [modelVersion, setModelVersion] = useState(0)
  useEffect(() => subscribeModels(() => setModelVersion(value => value + 1)), [])
  const q = query.trim().toLowerCase()
  const chooseView = (next: 'list' | 'grid') => {
    setView(next)
    try { localStorage.setItem(PICKER_VIEW_KEY, next) } catch { /* 记住失败不影响选择 */ }
  }
  const items = useMemo(() => Object.values(assets).filter(asset => {
    if (!kinds.includes(asset.kind)) return false
    if (include && !include(asset)) return false
    return !q || asset.name.toLowerCase().includes(q)
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh')), [assets, kinds, include, q, modelVersion])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="asset-picker__backdrop" onMouseDown={onClose}>
      <section className={`asset-picker${thumbs ? ' asset-picker--thumbs' : ''}`} role="dialog" aria-label={title} onMouseDown={event => event.stopPropagation()}>
        <header className="asset-picker__header">
          <h2>{title}</h2>
          <div className="asset-picker__views" onMouseDown={event => event.stopPropagation()}>
            <button type="button" className={view === 'grid' ? 'is-on' : ''} title={t('picker.thumbs')} aria-label={t('picker.thumbs')} onMouseDown={event => event.stopPropagation()} onClick={() => chooseView('grid')}><LayoutGrid size={13} /></button>
            <button type="button" className={view === 'list' ? 'is-on' : ''} title={t('picker.list')} aria-label={t('picker.list')} onMouseDown={event => event.stopPropagation()} onClick={() => chooseView('list')}><List size={13} /></button>
          </div>
          <button type="button" className="asset-picker__close" onClick={onClose}><X size={14} /></button>
        </header>
        <div className="asset-picker__search">
          <Search size={12} />
          <input autoFocus value={query} placeholder={t('picker.search')} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className={`asset-picker__list${thumbs ? ' is-thumbs' : ''}`}>
          <button type="button" className={!selectedId ? 'is-on' : ''} onClick={() => onSelect(null)}>
            {thumbs ? <div className="asset-picker__thumb"><i /></div> : <i />}
            <span>{t('picker.none')}</span>
          </button>
          {items.map(asset => (
            <button key={asset.id} type="button" title={asset.name} className={selectedId === asset.id ? 'is-on' : ''} onClick={() => onSelect(asset.id)}>
              {thumbs ? (
                <div className="asset-picker__thumb">
                  <AssetMark asset={asset} large />
                </div>
              ) : (
                <AssetMark asset={asset} />
              )}
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

function AssetMark({ asset, large = false }: { asset: ProjectAsset, large?: boolean }) {
  if (asset.kind === 'texture' && asset.url && !asset.fileName.toLowerCase().endsWith('.ktx2')) {
    return <img src={asset.url} alt="" />
  }
  if ((asset.kind === 'model' || asset.kind === 'texture') && 'thumb' in asset && asset.thumb) return <img src={asset.thumb} alt="" />
  if (asset.kind === 'material') return <MaterialBall slot={asset.slot} size={large ? 'lg' : 'sm'} />
  return <i />
}
