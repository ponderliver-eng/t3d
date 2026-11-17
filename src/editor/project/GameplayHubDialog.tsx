import { useEffect, useMemo, useState } from 'react'
import { Database, Package, Plus, RotateCcw, Search, X } from 'lucide-react'
import { useEditorStore } from '../scene/store'
import { useI18n } from '../i18n'
import {
  CORE_GAMEPLAY_PACK_ID,
  type GameDatabaseColumn,
  type GameDatabaseRow,
} from '../../gameplay/types'
import { defaultRows, listEnabledTableSchemas, listGameplayPacks, tableRows } from '../../gameplay/registry'
import './GameplayHubDialog.css'
import '../prefs/SettingsDialog.css'

export default function GameplayHubDialog() {
  const open = useEditorStore(state => state.gameplayHubOpen)
  if (!open) return null
  return <Hub />
}

function Hub() {
  const { t } = useI18n()
  const database = useEditorStore(state => state.gameDatabase) ?? { tables: {} }
  const packsEnabled = useEditorStore(state => state.gameplayPacks) ?? []
  const [tab, setTab] = useState<'database' | 'packs'>('database')
  const [tableId, setTableId] = useState('tags')
  const [query, setQuery] = useState('')
  const schemas = listEnabledTableSchemas(packsEnabled)
  const active = schemas.find(schema => schema.tableId === tableId) ?? schemas[0]
  const rows = active ? tableRows(database, active.tableId) : []
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !q || `${row.id} ${row.name} ${row.category ?? ''} ${row.description ?? ''}`.toLowerCase().includes(q))
  }, [rows, query])

  const writeRows = (next: GameDatabaseRow[], label: string) => {
    if (!active || !database) return
    const tables = { ...database.tables, [active.tableId]: next }
    useEditorStore.getState().commitGameplay(packsEnabled, { tables }, label)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useEditorStore.getState().setGameplayHubOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.45)' }}
      onMouseDown={event => event.stopPropagation()}
    >
      <section className="hub-window" role="dialog" aria-label={t('hub.title')} onMouseDown={event => event.stopPropagation()}>
        <header className="hub-head">
          <div>
            <h2>{t('hub.title')}</h2>
            <p>{t('hub.count', { packs: String(listGameplayPacks().length), tables: String(schemas.length) })}</p>
          </div>
          <button type="button" title={t('tags.done')} onClick={() => useEditorStore.getState().setGameplayHubOpen(false)}><X size={14} /></button>
        </header>
        <div className="hub-toolbar">
          <button type="button" className={tab === 'database' ? 'is-on' : ''} onClick={() => setTab('database')}>
            <Database size={13} /> {t('hub.database', { count: String(schemas.length) })}
          </button>
          <button type="button" className={tab === 'packs' ? 'is-on' : ''} onClick={() => setTab('packs')}>
            <Package size={13} /> {t('hub.packs')}
          </button>
          {tab === 'database' && active && (
            <>
              <label className="hub-search">
                <Search size={13} />
                <input value={query} placeholder={t('hub.search', { name: active.title })} onChange={event => setQuery(event.target.value)} />
              </label>
              <button type="button" title={t('hub.reset')} onClick={() => writeRows(defaultRows(active.tableId), t('hub.reset'))}>
                <RotateCcw size={12} /> {t('hub.reset')}
              </button>
              <button type="button" className="is-on" onClick={() => writeRows([...rows, freshRow(active.tableId, rows.length + 1, active.columns)], t('hub.add'))}>
                <Plus size={12} /> {t('hub.add')}
              </button>
            </>
          )}
        </div>
        {tab === 'packs' ? <PackList /> : active && (
          <div className="hub-body">
            <aside className="hub-side">
              <div className="hub-muted">{t('hub.catalog')}</div>
              {schemas.map(schema => (
                <button key={schema.tableId} type="button" className={schema.tableId === active.tableId ? 'is-on' : ''} onClick={() => { setTableId(schema.tableId); setQuery('') }}>
                  <strong>{schema.title}</strong>
                  <span className="hub-muted">{t('hub.rowCount', { count: String(tableRows(database, schema.tableId).length) })}</span>
                </button>
              ))}
            </aside>
            <section className="hub-main">
              <div className="hub-table-head">
                <div>
                  <strong>{active.title}</strong>
                  <p>{active.description}</p>
                </div>
                <span className="hub-muted">{t('hub.showing', { shown: String(shown.length), total: String(rows.length) })}</span>
              </div>
              <div className="hub-rows">
                {shown.length === 0 && <div className="hub-empty">{t('hub.empty')}</div>}
                {shown.map(({ row, index }) => (
                  <RowCard
                    key={`${row.id}-${index}`}
                    row={row}
                    columns={active.columns}
                    onPatch={patch => writeRows(rows.map((item, at) => at === index ? { ...item, ...patch } : item), active.title)}
                    onRemove={() => writeRows(rows.filter((_, at) => at !== index), active.title)}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  )
}

function PackList() {
  const { t } = useI18n()
  const enabled = useEditorStore(state => state.gameplayPacks)
  return (
    <div className="hub-packs">
      {listGameplayPacks().map(pack => {
        const on = pack.core || enabled.includes(pack.id) || pack.id === CORE_GAMEPLAY_PACK_ID
        return (
          <article key={pack.id} className="hub-pack">
            <div>
              <h3>{pack.name}</h3>
              <p>{pack.description}</p>
            </div>
            <label className="hub-field hub-check">
              <input type="checkbox" checked={on} disabled={pack.core === true} onChange={() => undefined} />
              <span>{on ? t('hub.enabled') : t('hub.disabled')}</span>
            </label>
          </article>
        )
      })}
      <p className="hub-muted">{t('hub.packHint')}</p>
    </div>
  )
}

function RowCard({
  row,
  columns,
  onPatch,
  onRemove,
}: {
  row: GameDatabaseRow
  columns: GameDatabaseColumn[]
  onPatch: (patch: Partial<GameDatabaseRow>) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const fields = row.fields ?? {}
  return (
    <div className="hub-row">
      <div className="hub-row__top">
        <label className="hub-field"><span>{t('hub.id')}</span><input value={row.id} onChange={event => onPatch({ id: event.target.value })} /></label>
        <label className="hub-field"><span>{t('hub.name')}</span><input value={row.name} onChange={event => onPatch({ name: event.target.value })} /></label>
        <label className="hub-field"><span>{t('hub.category')}</span><input value={row.category ?? ''} onChange={event => onPatch({ category: event.target.value })} /></label>
        <button type="button" onClick={onRemove}>{t('hub.delete')}</button>
      </div>
      <div className="hub-row__fields">
        {columns.map(column => (
          <ColumnField
            key={column.key}
            column={column}
            value={fields[column.key]}
            onChange={value => onPatch({ fields: { ...fields, [column.key]: value } })}
          />
        ))}
        <label className="hub-field" style={{ gridColumn: 'span 2' }}>
          <span>{t('hub.note')}</span>
          <input value={row.description ?? ''} onChange={event => onPatch({ description: event.target.value })} />
        </label>
      </div>
    </div>
  )
}

function ColumnField({
  column,
  value,
  onChange,
}: {
  column: GameDatabaseColumn
  value: unknown
  onChange: (value: unknown) => void
}) {
  if (column.type === 'boolean') {
    return (
      <label className="hub-field hub-check">
        <input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />
        <span>{column.label}</span>
      </label>
    )
  }
  if (column.type === 'color') {
    const color = typeof value === 'string' && value ? value : '#ffffff'
    return (
      <label className="hub-field">
        <span>{column.label}</span>
        <input type="color" value={color} onChange={event => onChange(event.target.value)} />
      </label>
    )
  }
  if (column.type === 'select') {
    return (
      <label className="hub-field">
        <span>{column.label}</span>
        <select value={String(value ?? '')} onChange={event => onChange(event.target.value)}>
          {(column.options ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    )
  }
  const shown = value === undefined || value === null ? '' : String(value)
  return (
    <label className="hub-field">
      <span>{column.label}</span>
      <input
        type={column.type === 'number' ? 'number' : 'text'}
        step={column.type === 'number' ? 'any' : undefined}
        value={shown}
        onChange={event => onChange(column.type === 'number' ? Number(event.target.value) : event.target.value)}
      />
    </label>
  )
}

function freshRow(tableId: string, index: number, columns: GameDatabaseColumn[]): GameDatabaseRow {
  const fields: Record<string, unknown> = {}
  for (const column of columns) {
    if (column.defaultValue !== undefined) fields[column.key] = column.defaultValue
  }
  return { id: `${tableId}_${index}`, name: `新条目 #${index}`, category: 'Default', description: '', fields }
}
