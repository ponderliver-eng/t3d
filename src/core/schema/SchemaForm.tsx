import { useEffect, useState, type CSSProperties, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { Box, Database, FileBox, Film, Search, X } from 'lucide-react'
import { CLIP_MIME, readClipDrag } from '../../editor/animation/playback'
import { ASSET_MIME, NODE_MIME } from '../../editor/assets/import'
import { useAssetStore } from '../../editor/assets/library'
import { clipNamesFor, projectClips } from '../../editor/assets/models'
import { useEditorStore } from '../../editor/scene/store'
import { isMessageKey, useI18n } from '../../editor/i18n'
import { defaultForSchema, type FieldSchema, type ObjectFieldSchema, type RefFieldSchema } from './fieldSchema'

function usePhrase() {
  const { t } = useI18n()
  return (value?: string) => (!value ? '' : isMessageKey(value) ? t(value) : value)
}

export interface SchemaFormProps {
  schema: ObjectFieldSchema
  value: Record<string, unknown>
  disabled?: boolean
  compact?: boolean
  onChange: (nextValue: Record<string, unknown>, changedKey: string, fieldValue: unknown) => void
}

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '88px minmax(0, 1fr)',
  alignItems: 'center',
  gap: '10px',
  minHeight: '24px',
  fontSize: '12px',
  color: '#d4d4d8',
}

const inputStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  height: '24px',
  padding: '0 7px',
  borderRadius: '4px',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(0,0,0,0.28)',
  color: '#f4f4f5',
  fontSize: '12px',
  boxSizing: 'border-box',
}

export function SchemaForm({ schema, value, disabled = false, compact = false, onChange }: SchemaFormProps) {
  const entries = Object.entries(schema.fields)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '6px' : '7px' }}>
      {entries.map(([key, field]) => {
        const current = value[key] !== undefined ? value[key] : defaultForSchema(field)
        return (
          <SchemaFieldRow
            key={key}
            fieldKey={key}
            field={field}
            value={current}
            disabled={disabled}
            onChange={(nextFieldVal) => {
              onChange({ ...value, [key]: nextFieldVal }, key, nextFieldVal)
            }}
          />
        )
      })}
    </div>
  )
}

interface SchemaFieldRowProps {
  fieldKey: string
  field: FieldSchema
  value: unknown
  disabled: boolean
  onChange: (next: unknown) => void
}

function SchemaFieldRow({ field, value, disabled, onChange }: SchemaFieldRowProps) {
  const phrase = usePhrase()
  if (field.type === 'object') {
    const objVal = (value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {}) as Record<string, unknown>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '6px', borderLeft: '2px solid rgba(255,255,255,0.08)' }}>
        {field.label && <div style={{ fontSize: '11px', color: '#a1a1aa' }}>{phrase(field.label)}</div>}
        <SchemaForm
          schema={field}
          value={objVal}
          disabled={disabled}
          compact
          onChange={(nextObj) => onChange(nextObj)}
        />
      </div>
    )
  }

  return (
    <label style={rowStyle} title={phrase(field.description ?? field.label)}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#a1a1aa' }}>
        {phrase(field.label)}
      </span>
      <SchemaControl field={field} value={value} disabled={disabled} onChange={onChange} />
    </label>
  )
}

function SchemaControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: Exclude<FieldSchema, ObjectFieldSchema>
  value: unknown
  disabled: boolean
  onChange: (next: unknown) => void
}) {
  const { t } = useI18n()
  const phrase = usePhrase()
  switch (field.type) {
    case 'boolean':
      return (
        <input
          type="checkbox"
          disabled={disabled}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ justifySelf: 'start', accentColor: '#3b82f6' }}
        />
      )
    case 'number': {
      const num = typeof value === 'number' && Number.isFinite(value) ? value : field.default
      const hasRange = field.min !== undefined && field.max !== undefined
      if (hasRange) {
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(64px, 1fr) 52px', gap: '6px', alignItems: 'center' }}>
            <input
              type="range"
              disabled={disabled}
              min={field.min}
              max={field.max}
              step={field.step ?? (field.max! - field.min! <= 2 ? 0.01 : 0.1)}
              value={num}
              onChange={(e) => onChange(Number(e.target.value))}
              style={{ width: '100%', margin: 0, accentColor: '#4a9eff', cursor: disabled ? 'default' : 'pointer' }}
            />
            <input
              type="number"
              disabled={disabled}
              min={field.min}
              max={field.max}
              step={field.step ?? 'any'}
              value={Number.isInteger(num) ? num : Number(num.toFixed(3))}
              onChange={(e) => {
                const parsed = Number(e.target.value)
                if (Number.isFinite(parsed)) onChange(parsed)
              }}
              style={{ ...inputStyle, padding: '0 5px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
            />
          </div>
        )
      }
      return (
        <input
          type="number"
          disabled={disabled}
          step={field.step ?? 'any'}
          value={num}
          onChange={(e) => {
            const parsed = Number(e.target.value)
            if (Number.isFinite(parsed)) onChange(parsed)
          }}
          style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
        />
      )
    }
    case 'color': {
      const str = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : field.default
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="color"
            disabled={disabled}
            value={str}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: '28px', height: '22px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
          />
          <input
            type="text"
            disabled={disabled}
            value={str}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...inputStyle, fontFamily: 'monospace' }}
          />
        </div>
      )
    }
    case 'enum':
      return (
        <select
          disabled={disabled}
          value={typeof value === 'string' ? value : field.default}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{phrase(opt.label)}</option>
          ))}
        </select>
      )
    case 'vec2':
    case 'vec3':
    case 'vec4': {
      const len = field.type === 'vec2' ? 2 : field.type === 'vec3' ? 3 : 4
      const arr = Array.isArray(value) ? value : (defaultForSchema(field) as number[])
      return (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${len}, minmax(0, 1fr))`, gap: '4px' }}>
          {Array.from({ length: len }, (_, idx) => (
            <input
              key={idx}
              type="number"
              disabled={disabled}
              step="0.1"
              value={typeof arr[idx] === 'number' ? Number(arr[idx].toFixed(3)) : 0}
              onChange={(e) => {
                const parsed = Number(e.target.value)
                if (!Number.isFinite(parsed)) return
                const next = [...arr]
                while (next.length < len) next.push(0)
                next[idx] = parsed
                onChange(next.slice(0, len))
              }}
              style={{ ...inputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
            />
          ))}
        </div>
      )
    }
    case 'string':
      return (
        <input
          type="text"
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      )
    case 'texture':
      return (
        <AssetRefControl
          value={typeof value === 'string' ? value : null}
          kinds={['texture']}
          disabled={disabled}
          title={phrase(field.label)}
          onChange={(next) => onChange(next)}
        />
      )
    case 'ref':
      if (field.target === 'node') {
        return (
          <NodeRefControl
            value={typeof value === 'string' ? value : null}
            disabled={disabled}
            title={phrase(field.label)}
            onChange={(next) => onChange(next)}
          />
        )
      }
      if (field.target === 'asset') {
        return (
          <AssetRefControl
            value={typeof value === 'string' ? value : null}
            kinds={field.kinds}
            disabled={disabled}
            title={phrase(field.label)}
            onChange={(next) => onChange(next)}
          />
        )
      }
      if (field.target === 'clip') {
        return (
          <ClipRefControl
            value={typeof value === 'string' ? value : null}
            disabled={disabled}
            title={phrase(field.label)}
            onChange={(next) => onChange(next)}
          />
        )
      }
      if (field.target === 'tableRow') {
        return (
          <TableRowRefControl
            value={typeof value === 'string' ? value : null}
            tableId={field.tableId}
            disabled={disabled}
            title={phrase(field.label)}
            onChange={(next) => onChange(next)}
          />
        )
      }
      return (
        <input
          type="text"
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          placeholder={`(${(field as RefFieldSchema).target})`}
          onChange={(e) => onChange(e.target.value || null)}
          style={inputStyle}
        />
      )
    case 'list': {
      const items = Array.isArray(value) ? value : []
      return (
        <span style={{ fontSize: '11px', color: '#a1a1aa' }}>
          {t('schema.listCount', { count: items.length })}
        </span>
      )
    }
  }
}

const refSlotStyle = (dropping: boolean, disabled: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  minWidth: 0,
  height: '24px',
  padding: '0 4px 0 6px',
  borderRadius: '4px',
  border: dropping ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.12)',
  background: dropping ? 'rgba(59,130,246,0.16)' : 'rgba(0,0,0,0.28)',
  boxShadow: dropping ? '0 0 0 1px rgba(59,130,246,0.35)' : 'none',
  opacity: disabled ? 0.6 : 1,
  transition: 'border-color 0.12s, background 0.12s',
})

const refNameBtnStyle = (hasValue: boolean, missing: boolean): CSSProperties => ({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  background: 'transparent',
  border: 'none',
  padding: 0,
  textAlign: 'left',
  fontSize: '12px',
  color: missing ? '#fca5a5' : hasValue ? '#f4f4f5' : '#71717a',
  cursor: hasValue && !missing ? 'pointer' : 'default',
  overflow: 'hidden',
})

const refActionBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '18px',
  height: '18px',
  padding: 0,
  borderRadius: '3px',
  border: 'none',
  background: 'transparent',
  color: '#a1a1aa',
  cursor: 'pointer',
  flexShrink: 0,
}

function NodeRefControl({
  value,
  disabled,
  title,
  onChange,
}: {
  value: string | null
  disabled: boolean
  title: string
  onChange: (next: string | null) => void
}) {
  const { t } = useI18n()
  const nodes = useEditorStore((s) => s.nodes)
  const [dropping, setDropping] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const node = value ? nodes[value] : undefined
  const missing = Boolean(value && !node)

  const acceptsDrop = (e: DragEvent) => !disabled && e.dataTransfer.types.includes(NODE_MIME)
  const handleDrop = (e: DragEvent) => {
    setDropping(false)
    if (!acceptsDrop(e)) return
    const id = e.dataTransfer.getData(NODE_MIME)
    if (!id || !useEditorStore.getState().nodes[id]) return
    e.preventDefault()
    onChange(id)
  }

  return (
    <>
      <div
        style={refSlotStyle(dropping, disabled)}
        title={node ? t('schema.nodeTitle', { name: node.name, id: node.id }) : t('schema.dropNodeHint')}
        onDragEnter={(e) => {
          if (!acceptsDrop(e)) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragOver={(e) => {
          if (!acceptsDrop(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDropping(false)
        }}
        onDrop={handleDrop}
      >
        <button
          type="button"
          style={refNameBtnStyle(Boolean(value), missing)}
          onClick={() => {
            if (node) {
              useEditorStore.getState().setSelection([node.id])
              useEditorStore.getState().requestFocus()
            } else if (!disabled) {
              setPickerOpen(true)
            }
          }}
        >
          <Box size={12} style={{ color: node ? '#60a5fa' : '#71717a', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dropping ? t('schema.dropNode') : node ? node.name : missing ? t('schema.nodeMissing', { id: value?.slice(0, 8) ?? '' }) : t('schema.nodeEmpty')}
          </span>
        </button>
        {!disabled && (
          <button
            type="button"
            style={refActionBtnStyle}
            title={t('schema.pick', { name: title })}
            onClick={(e) => { e.preventDefault(); setPickerOpen(true) }}
          >
            <Search size={12} />
          </button>
        )}
        {!disabled && value && (
          <button
            type="button"
            style={refActionBtnStyle}
            title={t('schema.clearRef')}
            onClick={(e) => { e.preventDefault(); onChange(null) }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {pickerOpen && (
        <RefPickerModal
          title={t('schema.pick', { name: title })}
          selectedId={value}
          items={Object.values(nodes)
            .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
            .map((n) => ({ id: n.id, name: n.name, badge: n.kind }))}
          onSelect={(id) => {
            onChange(id)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}

function AssetRefControl({
  value,
  kinds,
  disabled,
  title,
  onChange,
}: {
  value: string | null
  kinds?: readonly string[]
  disabled: boolean
  title: string
  onChange: (next: string | null) => void
}) {
  const { t } = useI18n()
  const assets = useAssetStore((s) => s.assets)
  const [dropping, setDropping] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const asset = value ? assets[value] : undefined
  const missing = Boolean(value && !asset)

  const acceptsDrop = (e: DragEvent) => !disabled && e.dataTransfer.types.includes(ASSET_MIME)
  const handleDrop = (e: DragEvent) => {
    setDropping(false)
    if (!acceptsDrop(e)) return
    const id = e.dataTransfer.getData(ASSET_MIME)
    const dropped = id ? useAssetStore.getState().assets[id] : undefined
    if (!dropped) return
    if (kinds && kinds.length > 0 && !kinds.includes(dropped.kind)) return
    e.preventDefault()
    onChange(dropped.id)
  }

  const filteredAssets = Object.values(assets)
    .filter((a) => !kinds || kinds.length === 0 || kinds.includes(a.kind))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))

  return (
    <>
      <div
        style={refSlotStyle(dropping, disabled)}
        title={asset ? t('schema.assetTitle', { name: asset.name, kind: asset.kind }) : t('schema.dropAssetHint')}
        onDragEnter={(e) => {
          if (!acceptsDrop(e)) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragOver={(e) => {
          if (!acceptsDrop(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDropping(false)
        }}
        onDrop={handleDrop}
      >
        <button
          type="button"
          style={refNameBtnStyle(Boolean(value), missing)}
          onClick={() => {
            if (asset) {
              useEditorStore.getState().inspectAsset(asset.id)
            } else if (!disabled) {
              setPickerOpen(true)
            }
          }}
        >
          <FileBox size={12} style={{ color: asset ? '#34d399' : '#71717a', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dropping ? t('schema.dropAsset') : asset ? asset.name : missing ? t('schema.nodeMissing', { id: value?.slice(0, 8) ?? '' }) : t('schema.assetEmpty')}
          </span>
        </button>
        {!disabled && (
          <button
            type="button"
            style={refActionBtnStyle}
            title={t('schema.pick', { name: title })}
            onClick={(e) => { e.preventDefault(); setPickerOpen(true) }}
          >
            <Search size={12} />
          </button>
        )}
        {!disabled && value && (
          <button
            type="button"
            style={refActionBtnStyle}
            title={t('schema.clearRef')}
            onClick={(e) => { e.preventDefault(); onChange(null) }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {pickerOpen && (
        <RefPickerModal
          title={t('schema.pick', { name: title })}
          selectedId={value}
          items={filteredAssets.map((a) => ({ id: a.id, name: a.name, badge: a.kind }))}
          onSelect={(id) => {
            onChange(id)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}

function ClipRefControl({
  value,
  disabled,
  title,
  onChange,
}: {
  value: string | null
  disabled: boolean
  title: string
  onChange: (next: string | null) => void
}) {
  const { t } = useI18n()
  const [dropping, setDropping] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const clips = projectClips()
  const matched = value ? clips.find((c) => c.name === value) : undefined

  const acceptsDrop = (e: DragEvent) =>
    !disabled && (e.dataTransfer.types.includes(CLIP_MIME) || e.dataTransfer.types.includes(ASSET_MIME))

  const handleDrop = (e: DragEvent) => {
    setDropping(false)
    if (disabled) return
    const clipData = readClipDrag(e.dataTransfer.getData(CLIP_MIME))
    if (clipData?.clip) {
      e.preventDefault()
      onChange(clipData.clip)
      return
    }
    const assetId = e.dataTransfer.getData(ASSET_MIME)
    if (assetId) {
      const firstClip = clipNamesFor(assetId)[0]
      if (firstClip) {
        e.preventDefault()
        onChange(firstClip)
      }
    }
  }

  return (
    <>
      <div
        style={refSlotStyle(dropping, disabled)}
        title={value ? t('schema.clipTitle', { name: `${value}${matched ? ` (${matched.assetName})` : ''}` }) : t('schema.dropClipHint')}
        onDragEnter={(e) => {
          if (!acceptsDrop(e)) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragOver={(e) => {
          if (!acceptsDrop(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDropping(false)
        }}
        onDrop={handleDrop}
      >
        <button
          type="button"
          style={refNameBtnStyle(Boolean(value), false)}
          onClick={() => { if (!disabled) setPickerOpen(true) }}
        >
          <Film size={12} style={{ color: value ? '#fbbf24' : '#71717a', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dropping ? t('schema.dropClip') : value ? (matched ? `${matched.assetName} / ${value}` : value) : t('schema.clipEmpty')}
          </span>
        </button>
        {!disabled && (
          <button
            type="button"
            style={refActionBtnStyle}
            title={t('schema.pick', { name: title })}
            onClick={(e) => { e.preventDefault(); setPickerOpen(true) }}
          >
            <Search size={12} />
          </button>
        )}
        {!disabled && value && (
          <button
            type="button"
            style={refActionBtnStyle}
            title={t('schema.clearRef')}
            onClick={(e) => { e.preventDefault(); onChange(null) }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {pickerOpen && (
        <RefPickerModal
          title={t('schema.pick', { name: title })}
          selectedId={value}
          items={clips.map((c) => ({
            id: c.name,
            name: c.name,
            badge: `${c.assetName} · ${c.duration.toFixed(2)}s`,
          }))}
          onSelect={(id) => {
            onChange(id)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}

function TableRowRefControl({
  value,
  tableId,
  disabled,
  title,
  onChange,
}: {
  value: string | null
  tableId?: string
  disabled: boolean
  title: string
  onChange: (next: string | null) => void
}) {
  const { t } = useI18n()
  const gameDatabase = useEditorStore((s) => s.gameDatabase)
  const [pickerOpen, setPickerOpen] = useState(false)

  const rows = tableId
    ? (gameDatabase.tables[tableId] ?? []).map((r) => ({ id: r.id, name: r.name, badge: r.category ?? tableId }))
    : Object.entries(gameDatabase.tables).flatMap(([tid, list]) =>
        list.map((r) => ({ id: r.id, name: r.name, badge: `${tid}${r.category ? `/${r.category}` : ''}` })),
      )
  const matched = value ? rows.find((r) => r.id === value) : undefined
  const missing = Boolean(value && !matched)

  return (
    <>
      <div
        style={refSlotStyle(false, disabled)}
        title={matched ? `${matched.name} (${matched.id})` : t('schema.rowHint')}
      >
        <button
          type="button"
          style={refNameBtnStyle(Boolean(value), missing)}
          onClick={() => { if (!disabled) setPickerOpen(true) }}
        >
          <Database size={12} style={{ color: matched ? '#c084fc' : '#71717a', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {matched ? matched.name : missing ? t('schema.nodeMissing', { id: value?.slice(0, 8) ?? '' }) : t('schema.rowEmpty')}
          </span>
        </button>
        {!disabled && (
          <button
            type="button"
            style={refActionBtnStyle}
            title={t('schema.pick', { name: title })}
            onClick={(e) => { e.preventDefault(); setPickerOpen(true) }}
          >
            <Search size={12} />
          </button>
        )}
        {!disabled && value && (
          <button
            type="button"
            style={refActionBtnStyle}
            title={t('schema.clearRef')}
            onClick={(e) => { e.preventDefault(); onChange(null) }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {pickerOpen && (
        <RefPickerModal
          title={t('schema.pick', { name: title })}
          selectedId={value}
          items={rows}
          onSelect={(id) => {
            onChange(id)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}

function RefPickerModal({
  title,
  selectedId,
  items,
  onSelect,
  onClose,
}: {
  title: string
  selectedId: string | null
  items: Array<{ id: string; name: string; badge: string }>
  onSelect: (id: string | null) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = q
    ? items.filter((it) => it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q) || it.badge.toLowerCase().includes(q))
    : items

  return createPortal(
    <div className="asset-picker__backdrop" onMouseDown={onClose}>
      <section className="asset-picker" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header className="asset-picker__header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}><X size={14} /></button>
        </header>
        <div className="asset-picker__search">
          <Search size={12} />
          <input
            autoFocus
            value={query}
            placeholder={t('schema.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="asset-picker__list">
          <button type="button" className={!selectedId ? 'is-on' : ''} onClick={() => onSelect(null)}>
            <i />
            <span>{t('schema.clearPick')}</span>
          </button>
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selectedId === item.id ? 'is-on' : ''}
              onClick={() => onSelect(item.id)}
            >
              <i />
              <span>{item.name}</span>
              <em>{item.badge}</em>
            </button>
          ))}
          {filtered.length === 0 && <p>{t('schema.noMatch')}</p>}
        </div>
      </section>
    </div>,
    document.body,
  )
}
