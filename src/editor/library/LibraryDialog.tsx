import { useEffect, useMemo, useState } from 'react'
import { Boxes, Library, Search, Sparkles, Swords, X } from 'lucide-react'
import { capabilityEnabled } from '../../capabilities/registry'
import { useEditorStore } from '../scene/store'
import { useI18n, type MessageKey } from '../i18n'
import { LIBRARY_ITEMS, LIBRARY_SHELVES, type LibraryItem, type LibraryShelf } from './catalog'
import './LibraryDialog.css'

const SHELF_ICON = {
  capability: Sparkles,
  gameplay: Boxes,
  genre: Swords,
  asset: Library,
} as const

export default function LibraryDialog() {
  const open = useEditorStore(state => state.libraryOpen)
  if (!open) return null
  return <LibraryWindow />
}

function LibraryWindow() {
  const { t } = useI18n()
  const capabilities = useEditorStore(state => state.capabilities)
  const [shelf, setShelf] = useState<LibraryShelf>('capability')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(LIBRARY_ITEMS[0]?.id ?? '')
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return LIBRARY_ITEMS.filter(item => {
      if (item.shelf !== shelf) return false
      if (!q) return true
      return `${t(item.name)} ${t(item.detail)}`.toLowerCase().includes(q)
    })
  }, [query, shelf, t])
  const selected = items.find(item => item.id === selectedId) ?? items[0] ?? null

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useEditorStore.getState().setLibraryOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!items.some(item => item.id === selectedId)) setSelectedId(items[0]?.id ?? '')
  }, [items, selectedId])

  return (
    <div className="lib-backdrop" onMouseDown={() => useEditorStore.getState().setLibraryOpen(false)}>
      <section className="lib" role="dialog" aria-label={t('library.title')} onMouseDown={event => event.stopPropagation()}>
        <aside className="lib-rail">
          <div className="lib-brand">
            <Library size={18} />
            <div>
              <strong>{t('library.title')}</strong>
              <span>{t('library.official')}</span>
            </div>
          </div>
          <nav>
            {LIBRARY_SHELVES.map(id => {
              const Icon = SHELF_ICON[id]
              const count = LIBRARY_ITEMS.filter(item => item.shelf === id).length
              return (
                <button key={id} type="button" className={shelf === id ? 'is-on' : ''} onClick={() => { setShelf(id); setQuery('') }}>
                  <Icon size={15} />
                  <span>{t(`library.shelf.${id}` as MessageKey)}</span>
                  <em>{count}</em>
                </button>
              )
            })}
          </nav>
        </aside>
        <div className="lib-stage">
          <header className="lib-top">
            <div>
              <h2>{t(`library.shelf.${shelf}` as MessageKey)}</h2>
              <p>{t(`library.shelfHint.${shelf}` as MessageKey)}</p>
            </div>
            <label className="lib-search">
              <Search size={14} />
              <input value={query} placeholder={t('library.search')} onChange={event => setQuery(event.target.value)} />
            </label>
            <button type="button" className="lib-close" title={t('settings.close')} onClick={() => useEditorStore.getState().setLibraryOpen(false)}><X size={16} /></button>
          </header>
          <div className="lib-split">
            <div className="lib-grid">
              {items.length === 0 && <div className="lib-empty">{t('library.empty')}</div>}
              {items.map(item => {
                const on = item.kind === 'capability' && item.capabilityId ? capabilityEnabled(capabilities, item.capabilityId) : false
                return (
                  <button key={item.id} type="button" className={`lib-card${selected?.id === item.id ? ' is-on' : ''}`} onClick={() => setSelectedId(item.id)}>
                    <Art id={item.id} hue={item.hue} />
                    <div className="lib-card__body">
                      <strong>{t(item.name)}</strong>
                      <span>{t(item.detail)}</span>
                      <em className={on ? 'is-on' : item.kind === 'soon' ? 'is-soon' : ''}>{item.kind === 'soon' ? t('library.soon') : on ? t('library.on') : t('library.off')}</em>
                    </div>
                  </button>
                )
              })}
            </div>
            {selected && <Detail item={selected} />}
          </div>
        </div>
      </section>
    </div>
  )
}

function Detail({ item }: { item: LibraryItem }) {
  const { t } = useI18n()
  const capabilities = useEditorStore(state => state.capabilities)
  const on = item.kind === 'capability' && item.capabilityId ? capabilityEnabled(capabilities, item.capabilityId) : false
  const points = t(item.points).split('\n').filter(Boolean)
  const toggle = () => {
    if (item.kind !== 'capability' || !item.capabilityId) return
    useEditorStore.getState().setCapability(item.capabilityId, !on)
  }
  return (
    <aside className="lib-detail">
      <Art id={item.id} hue={item.hue} large />
      <div className="lib-detail__copy">
        <span className="lib-kicker">{t('library.official')}</span>
        <h3>{t(item.name)}</h3>
        <p>{t(item.detail)}</p>
        <h4>{t('library.includes')}</h4>
        <ul>{points.map(point => <li key={point}>{point}</li>)}</ul>
        <div className="lib-switch-row">
          <div>
            <strong>{t('library.switch')}</strong>
            <span>{item.shelf === 'asset' ? t('library.assetNote') : item.kind === 'soon' ? t('library.soonNote') : on ? t('library.on') : t('library.off')}</span>
          </div>
          <button type="button" className={`lib-switch${on ? ' is-on' : ''}`} disabled={item.kind !== 'capability'} aria-pressed={on} onClick={toggle}>
            <i />
          </button>
        </div>
      </div>
    </aside>
  )
}

function Art({ id, hue, large = false }: { id: string, hue: string, large?: boolean }) {
  return (
    <div className={`lib-art lib-art--${id}${large ? ' lib-art--large' : ''}`} style={{ ['--lib-hue' as string]: hue }} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}
