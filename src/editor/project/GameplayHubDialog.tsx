import { useEffect, useMemo, useState } from 'react'
import { Layers, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useEditorStore } from '../scene/store'
import { useI18n } from '../i18n'
import {
  type GameDatabaseColumn,
  type GameDatabaseRow,
} from '../../gameplay/types'
import { defaultRows, listEnabledTableSchemas, tableRows } from '../../gameplay/registry'
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
            <p>{t('hub.count', { tables: String(schemas.length) })}</p>
          </div>
          <button type="button" title={t('tags.done')} onClick={() => useEditorStore.getState().setGameplayHubOpen(false)}><X size={14} /></button>
        </header>
        <div className="hub-toolbar">
          {active && (
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
        {active && (
          <div className="hub-body">
            <aside className="hub-side">
              <div className="hub-muted">{t('hub.catalog')}</div>
              <div className="hub-side__pack">{t('hub.corePack')}</div>
              {schemas.map(schema => (
                <button key={schema.tableId} type="button" className={schema.tableId === active.tableId ? 'hub-nav is-on' : 'hub-nav'} onClick={() => { setTableId(schema.tableId); setQuery('') }}>
                  <Layers size={14} />
                  <span className="hub-nav__text">
                    <strong>{schema.title}</strong>
                    <em>{t('hub.rowCount', { count: String(tableRows(database, schema.tableId).length) })}</em>
                  </span>
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
  const swatch = typeof fields.color === 'string' ? fields.color : ''
  return (
    <div className="hub-row">
      <div className={swatch ? 'hub-row__top' : 'hub-row__top hub-row__top--plain'}>
        {swatch && <i className="hub-swatch" style={{ background: swatch }} />}
        <label className="hub-field"><span>{t('hub.id')}</span><input className="hub-input" value={row.id} onChange={event => onPatch({ id: event.target.value })} /></label>
        <label className="hub-field"><span>{t('hub.name')}</span><input className="hub-input" value={row.name} onChange={event => onPatch({ name: event.target.value })} /></label>
        <label className="hub-field">
          <span>{t('hub.category')}</span>
          <ChoiceField
            title={t('hub.category')}
            value={row.category ?? ''}
            empty={t('picker.none')}
            rows={categoryChoices(row.category)}
            onChange={category => onPatch({ category })}
          />
        </label>
        <button type="button" className="hub-icon" title={t('hub.delete')} onClick={onRemove}><Trash2 size={13} /></button>
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
        <label className="hub-field hub-field--wide">
          <span>{t('hub.note')}</span>
          <input className="hub-input" value={row.description ?? ''} onChange={event => onPatch({ description: event.target.value })} />
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
  const { t } = useI18n()
  if (column.type === 'boolean') {
    return (
      <label className="hub-field hub-check">
        <input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />
        <span>{column.label}</span>
      </label>
    )
  }
  if (column.type === 'color' || column.key === 'blockPrefix' || column.type === 'select') {
    const current = typeof value === 'string' ? value : ''
    const palette = column.type === 'color' && current && !COLOR_CHOICES.includes(current)
      ? [current, ...COLOR_CHOICES]
      : COLOR_CHOICES
    const rows = column.type === 'color'
      ? palette.map(item => ({ id: item, name: item }))
      : column.key === 'blockPrefix'
        ? prefixChoices(current)
        : (column.options ?? []).map(option => ({ id: option.value, name: option.label }))
    return (
      <label className="hub-field">
        <span>{column.label}</span>
        <ChoiceField
          title={column.label}
          value={current}
          empty={column.key === 'blockPrefix' ? t('hub.noBlock') : t('picker.none')}
          rows={rows}
          swatch={column.type === 'color'}
          onChange={onChange}
        />
      </label>
    )
  }
  const shown = value === undefined || value === null ? '' : String(value)
  return (
    <label className="hub-field">
      <span>{column.label}</span>
      <input
        className="hub-input"
        type={column.type === 'number' ? 'number' : 'text'}
        step={column.type === 'number' ? 'any' : undefined}
        value={shown}
        onChange={event => onChange(column.type === 'number' ? Number(event.target.value) : event.target.value)}
      />
    </label>
  )
}

const COLOR_CHOICES = ['#4a9eff', '#4caf50', '#ff9800', '#f44336', '#f5a623', '#7c8ef5', '#ab47bc', '#e0e0e0', '#ffffff']

function categoryChoices(current = ''): { id: string, name: string }[] {
  const found = new Set<string>(['Team', 'State', 'State/Control', 'Action', 'Interactive', 'Combat', 'Interact'])
  const tables = useEditorStore.getState().gameDatabase?.tables ?? {}
  for (const list of Object.values(tables)) {
    for (const row of list) if (row.category?.trim()) found.add(row.category.trim())
  }
  if (current.trim()) found.add(current.trim())
  return [...found].map(id => ({ id, name: id }))
}

function prefixChoices(current: string): { id: string, name: string }[] {
  const found = new Set<string>(['Team', 'State', 'Action', 'Interactive'])
  for (const row of useEditorStore.getState().gameDatabase?.tables?.tags ?? []) {
    const head = row.id.split('.')[0]
    if (head) found.add(head)
  }
  if (current.trim()) found.add(current.trim())
  return [...found].map(id => ({ id, name: id }))
}

function ChoiceField({
  title,
  value,
  empty,
  rows,
  swatch,
  onChange,
}: {
  title: string
  value: string
  empty: string
  rows: { id: string, name: string }[]
  swatch?: boolean
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const known = !value || rows.some(row => row.id === value)
  const label = value ? (rows.find(row => row.id === value)?.name ?? value) : empty
  return (
    <>
      <button type="button" className={known ? 'hub-ref' : 'hub-ref is-missing'} onClick={() => setOpen(true)}>
        {swatch && value ? <i className="hub-swatch hub-swatch--inline" style={{ background: value }} /> : null}
        <span>{label}</span>
        <Search size={12} />
      </button>
      {open && (
        <ChoiceList
          title={title}
          selectedId={value}
          rows={rows}
          empty={empty}
          swatch={swatch}
          onSelect={id => { onChange(id); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function ChoiceList({
  title,
  selectedId,
  rows,
  empty,
  swatch,
  onSelect,
  onClose,
}: {
  title: string
  selectedId: string
  rows: { id: string, name: string }[]
  empty: string
  swatch?: boolean
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = rows.filter(row => !q || row.name.toLowerCase().includes(q) || row.id.toLowerCase().includes(q))
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="hub-picker" onMouseDown={onClose}>
      <section className="hub-picker__panel" role="dialog" aria-label={title} onMouseDown={event => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose}><X size={14} /></button>
        </header>
        <label className="hub-search">
          <Search size={12} />
          <input value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <div className="hub-picker__list">
          <button type="button" className={!selectedId ? 'is-on' : ''} onClick={() => onSelect('')}>{empty}</button>
          {shown.map(row => (
            <button key={row.id} type="button" className={selectedId === row.id ? 'is-on' : ''} onClick={() => onSelect(row.id)}>
              {swatch ? <i className="hub-swatch hub-swatch--inline" style={{ background: row.id }} /> : null}
              <span>{row.name}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function freshRow(tableId: string, index: number, columns: GameDatabaseColumn[]): GameDatabaseRow {
  const fields: Record<string, unknown> = {}
  for (const column of columns) {
    if (column.defaultValue !== undefined) fields[column.key] = column.defaultValue
  }
  return { id: `${tableId}_${index}`, name: `新条目 #${index}`, category: 'Default', description: '', fields }
}
