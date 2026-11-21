import type { CSSProperties } from 'react'
import { defaultForSchema, type FieldSchema, type ObjectFieldSchema } from './fieldSchema'

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
  gap: '8px',
  fontSize: '12px',
  color: '#d4d4d8',
}

const inputStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  height: '24px',
  padding: '0 6px',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '6px' : '8px' }}>
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
  if (field.type === 'object') {
    const objVal = (value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {}) as Record<string, unknown>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '6px', borderLeft: '2px solid rgba(255,255,255,0.08)' }}>
        {field.label && <div style={{ fontSize: '11px', color: '#a1a1aa' }}>{field.label}</div>}
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
    <label style={rowStyle} title={field.description ?? field.label}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#a1a1aa' }}>
        {field.label}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(64px, 1fr) 54px', gap: '6px', alignItems: 'center' }}>
            <input
              type="range"
              disabled={disabled}
              min={field.min}
              max={field.max}
              step={field.step ?? (field.max! - field.min! <= 2 ? 0.01 : 0.1)}
              value={num}
              onChange={(e) => onChange(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#3b82f6' }}
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
              style={{ ...inputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
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
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )
    case 'vec2':
    case 'vec3':
    case 'vec4': {
      const len = field.type === 'vec2' ? 2 : field.type === 'vec3' ? 3 : 4
      const arr = Array.isArray(value) ? value : [...field.default]
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
    case 'texture':
    case 'ref':
      return (
        <input
          type="text"
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.type === 'string' ? '' : `(${field.type})`}
          onChange={(e) => onChange(field.type === 'string' ? e.target.value : (e.target.value || null))}
          style={inputStyle}
        />
      )
    case 'list': {
      const items = Array.isArray(value) ? value : []
      return (
        <span style={{ fontSize: '11px', color: '#a1a1aa' }}>
          共 {items.length} 项
        </span>
      )
    }
  }
}
