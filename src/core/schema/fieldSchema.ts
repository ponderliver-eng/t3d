/**
 * 统一字段说明（FieldSchema）：
 * 供指令参数校验、能力包/玩法包默认值规范化、自动属性面板、AI 工具说明（JSON Schema）四处共用。
 */

export type NumberFieldSchema = {
  type: 'number'
  default: number
  min?: number
  max?: number
  step?: number
  label: string
  description?: string
  unit?: string
}

export type BooleanFieldSchema = {
  type: 'boolean'
  default: boolean
  label: string
  description?: string
}

export type StringFieldSchema = {
  type: 'string'
  default: string
  minLength?: number
  maxLength?: number
  label: string
  description?: string
}

export type ColorFieldSchema = {
  type: 'color'
  default: string
  label: string
  description?: string
}

export type Vec2FieldSchema = {
  type: 'vec2'
  default: readonly [number, number]
  label: string
  description?: string
}

export type Vec3FieldSchema = {
  type: 'vec3'
  default: readonly [number, number, number]
  label: string
  description?: string
}

export type Vec4FieldSchema = {
  type: 'vec4'
  default: readonly [number, number, number, number]
  label: string
  description?: string
}

export type EnumFieldSchema = {
  type: 'enum'
  options: ReadonlyArray<{ value: string; label: string }>
  default: string
  label: string
  description?: string
}

export type TextureFieldSchema = {
  type: 'texture'
  default?: string | null
  label: string
  description?: string
}

export type RefFieldSchema = {
  type: 'ref'
  target: 'asset' | 'node' | 'tableRow' | 'clip'
  kinds?: readonly string[]
  tableId?: string
  required?: boolean
  default?: string | null
  label: string
  description?: string
}

export type ObjectFieldSchema = {
  type: 'object'
  fields: Record<string, FieldSchema>
  label?: string
  description?: string
}

export type ListFieldSchema = {
  type: 'list'
  item: FieldSchema
  minItems?: number
  maxItems?: number
  default?: unknown[]
  label: string
  description?: string
}

export type FieldSchema = (
  | NumberFieldSchema
  | BooleanFieldSchema
  | StringFieldSchema
  | ColorFieldSchema
  | Vec2FieldSchema
  | Vec3FieldSchema
  | Vec4FieldSchema
  | EnumFieldSchema
  | TextureFieldSchema
  | RefFieldSchema
  | ObjectFieldSchema
  | ListFieldSchema
) & { optional?: boolean }

export interface SchemaValidationIssue {
  path: string
  message: string
  hint?: string
}

export type SchemaValidationResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; issues: SchemaValidationIssue[] }

export function safeVecDefault(type: 'vec2' | 'vec3' | 'vec4', rawDefault: unknown): number[] {
  const len = type === 'vec2' ? 2 : type === 'vec3' ? 3 : 4
  if (Array.isArray(rawDefault)) {
    return Array.from({ length: len }, (_, i) => {
      const v = rawDefault[i]
      return typeof v === 'number' && Number.isFinite(v) ? v : 0
    })
  }
  if (rawDefault && typeof rawDefault === 'object') {
    const obj = rawDefault as Record<string, unknown>
    const keys = ['x', 'y', 'z', 'w']
    return Array.from({ length: len }, (_, i) => {
      const v = obj[keys[i]]
      return typeof v === 'number' && Number.isFinite(v) ? v : 0
    })
  }
  return Array.from({ length: len }, () => 0)
}

export function defaultForSchema(schema: FieldSchema): unknown {
  switch (schema.type) {
    case 'number':
    case 'boolean':
    case 'string':
    case 'color':
    case 'enum':
      return schema.default
    case 'vec2':
    case 'vec3':
    case 'vec4':
      return safeVecDefault(schema.type, schema.default)
    case 'texture':
    case 'ref':
      return schema.default ?? null
    case 'list':
      return schema.default ? structuredClone(schema.default) : []
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(schema.fields)) {
        out[key] = defaultForSchema(child)
      }
      return out
    }
  }
}

export function normalizeBySchema<T = unknown>(
  schema: FieldSchema,
  raw: unknown,
  options?: { clampNumbers?: boolean },
): T {
  const clampNumbers = options?.clampNumbers ?? true
  switch (schema.type) {
    case 'number': {
      const num = typeof raw === 'number' && Number.isFinite(raw) ? raw : schema.default
      if (!clampNumbers) return num as T
      let next = num
      if (schema.min !== undefined) next = Math.max(schema.min, next)
      if (schema.max !== undefined) next = Math.min(schema.max, next)
      return next as T
    }
    case 'boolean':
      return (typeof raw === 'boolean' ? raw : schema.default) as T
    case 'string':
      return (typeof raw === 'string' ? raw : schema.default) as T
    case 'color':
      return (typeof raw === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : schema.default) as T
    case 'vec2':
    case 'vec3':
    case 'vec4': {
      const len = schema.type === 'vec2' ? 2 : schema.type === 'vec3' ? 3 : 4
      const fallback = safeVecDefault(schema.type, schema.default)
      if (!Array.isArray(raw)) return fallback as T
      const out: number[] = []
      for (let i = 0; i < len; i += 1) {
        const v = raw[i]
        out.push(typeof v === 'number' && Number.isFinite(v) ? v : fallback[i])
      }
      return out as T
    }
    case 'enum': {
      if (typeof raw === 'string' && schema.options.some((opt) => opt.value === raw)) {
        return raw as T
      }
      return schema.default as T
    }
    case 'texture':
    case 'ref':
      return (typeof raw === 'string' && raw.length > 0 ? raw : null) as T
    case 'list': {
      if (!Array.isArray(raw)) return defaultForSchema(schema) as T
      return raw.map((entry) => normalizeBySchema(schema.item, entry, options)) as T
    }
    case 'object': {
      const src = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {}
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(schema.fields)) {
        out[key] = normalizeBySchema(child, src[key], options)
      }
      return out as T
    }
  }
}

export function validateBySchema<T = unknown>(
  schema: FieldSchema,
  raw: unknown,
  path = '',
): SchemaValidationResult<T> {
  const issues: SchemaValidationIssue[] = []
  const value = validateInner(schema, raw, path, issues)
  if (issues.length > 0) {
    return { ok: false, issues }
  }
  return { ok: true, value: value as T }
}

function validateInner(
  schema: FieldSchema,
  raw: unknown,
  path: string,
  issues: SchemaValidationIssue[],
): unknown {
  const loc = path || '(root)'
  switch (schema.type) {
    case 'number': {
      if (raw === undefined) return schema.default
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        issues.push({
          path: loc,
          message: `${schema.label} 必须是有效数字`,
          hint: `请传入数字${schema.min !== undefined || schema.max !== undefined ? `（范围 ${schema.min ?? '-∞'} ~ ${schema.max ?? '+∞'}）` : ''}`,
        })
        return schema.default
      }
      if (schema.min !== undefined && raw < schema.min) {
        issues.push({
          path: loc,
          message: `${schema.label} 不能小于 ${schema.min}（当前为 ${raw}）`,
          hint: `请调整到 ${schema.min} 以上`,
        })
      }
      if (schema.max !== undefined && raw > schema.max) {
        issues.push({
          path: loc,
          message: `${schema.label} 不能大于 ${schema.max}（当前为 ${raw}）`,
          hint: `请调整到 ${schema.max} 以下`,
        })
      }
      return raw
    }
    case 'boolean': {
      if (raw === undefined) return schema.default
      if (typeof raw !== 'boolean') {
        issues.push({ path: loc, message: `${schema.label} 必须是布尔值`, hint: '请传入 true 或 false' })
        return schema.default
      }
      return raw
    }
    case 'string': {
      if (raw === undefined || (schema.optional && raw === null)) return schema.default
      if (typeof raw !== 'string') {
        issues.push({ path: loc, message: `${schema.label} 必须是字符串` })
        return schema.default
      }
      if (schema.minLength !== undefined && raw.length < schema.minLength) {
        issues.push({ path: loc, message: `${schema.label} 长度不能少于 ${schema.minLength}` })
      }
      if (schema.maxLength !== undefined && raw.length > schema.maxLength) {
        issues.push({ path: loc, message: `${schema.label} 长度不能超过 ${schema.maxLength}` })
      }
      return raw
    }
    case 'color': {
      if (raw === undefined) return schema.default
      if (typeof raw !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(raw)) {
        issues.push({ path: loc, message: `${schema.label} 必须是十六进制颜色值`, hint: '格式如 #ff5a1e' })
        return schema.default
      }
      return raw
    }
    case 'vec2':
    case 'vec3':
    case 'vec4': {
      const fallback = safeVecDefault(schema.type, schema.default)
      if (raw === undefined) return fallback
      const expected = schema.type === 'vec2' ? 2 : schema.type === 'vec3' ? 3 : 4
      if (!Array.isArray(raw) || raw.length !== expected || raw.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        issues.push({
          path: loc,
          message: `${schema.label} 必须是长度为 ${expected} 的数字数组`,
          hint: `示例：${JSON.stringify(fallback)}`,
        })
        return fallback
      }
      return [...raw]
    }
    case 'enum': {
      if (raw === undefined) return schema.default
      if (typeof raw !== 'string' || !schema.options.some((opt) => opt.value === raw)) {
        const allowed = schema.options.map((o) => o.value).join(', ')
        issues.push({
          path: loc,
          message: `${schema.label} 的值 "${String(raw)}" 不在可选范围内`,
          hint: `可选值：${allowed}`,
        })
        return schema.default
      }
      return raw
    }
    case 'texture':
    case 'ref': {
      if (raw === undefined) {
        if (schema.type === 'ref' && schema.required && !schema.default) {
          issues.push({ path: loc, message: `${schema.label} 不能为空` })
        }
        return schema.default ?? null
      }
      if (raw === null) {
        if (schema.type === 'ref' && schema.required) {
          issues.push({ path: loc, message: `${schema.label} 不能为空` })
        }
        return null
      }
      if (typeof raw !== 'string' || raw.length === 0) {
        issues.push({ path: loc, message: `${schema.label} 必须是有效引用 ID 或 null` })
        return null
      }
      return raw
    }
    case 'list': {
      if (raw === undefined) return defaultForSchema(schema)
      if (!Array.isArray(raw)) {
        issues.push({ path: loc, message: `${schema.label} 必须是数组` })
        return []
      }
      if (schema.minItems !== undefined && raw.length < schema.minItems) {
        issues.push({ path: loc, message: `${schema.label} 至少需要 ${schema.minItems} 项` })
      }
      if (schema.maxItems !== undefined && raw.length > schema.maxItems) {
        issues.push({ path: loc, message: `${schema.label} 最多允许 ${schema.maxItems} 项` })
      }
      return raw.map((item, idx) => validateInner(schema.item, item, `${path}[${idx}]`, issues))
    }
    case 'object': {
      let objRaw = raw
      if (typeof objRaw === 'string' && Object.keys(schema.fields).length === 0) {
        try {
          objRaw = JSON.parse(objRaw)
        } catch {
          // keep original string to trigger validation error below
        }
      }
      if (objRaw !== undefined && (objRaw === null || typeof objRaw !== 'object' || Array.isArray(objRaw))) {
        issues.push({ path: loc, message: `${schema.label ?? loc} 必须是对象` })
        return defaultForSchema(schema)
      }
      const src = (objRaw ?? {}) as Record<string, unknown>
      if (Object.keys(schema.fields).length === 0) {
        return { ...src }
      }
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(schema.fields)) {
        if (child.optional && src[key] === undefined) {
          continue
        }
        const nextPath = path ? `${path}.${key}` : key
        out[key] = validateInner(child, src[key], nextPath, issues)
      }
      return out
    }
  }
}

export function fieldSchemaToJsonSchema(schema: FieldSchema): Record<string, unknown> {
  const desc = schema.description ? `${schema.label ?? ''}：${schema.description}` : schema.label
  switch (schema.type) {
    case 'number':
      return {
        type: 'number',
        description: desc,
        default: schema.default,
        ...(schema.min !== undefined ? { minimum: schema.min } : {}),
        ...(schema.max !== undefined ? { maximum: schema.max } : {}),
      }
    case 'boolean':
      return { type: 'boolean', description: desc, default: schema.default }
    case 'string':
      return {
        type: 'string',
        description: desc,
        default: schema.default,
        ...(schema.minLength !== undefined ? { minLength: schema.minLength } : {}),
        ...(schema.maxLength !== undefined ? { maxLength: schema.maxLength } : {}),
      }
    case 'color':
      return { type: 'string', description: `${desc}（十六进制颜色如 #ffffff）`, default: schema.default }
    case 'vec2':
    case 'vec3':
    case 'vec4': {
      const len = schema.type === 'vec2' ? 2 : schema.type === 'vec3' ? 3 : 4
      return {
        type: 'array',
        description: desc,
        items: { type: 'number' },
        minItems: len,
        maxItems: len,
        default: safeVecDefault(schema.type, schema.default),
      }
    }
    case 'enum':
      return {
        type: 'string',
        description: `${desc}（${schema.options.map((o) => `${o.value}:${o.label}`).join('，')}）`,
        enum: schema.options.map((o) => o.value),
        default: schema.default,
      }
    case 'texture':
      return { type: ['string', 'null'], description: `${desc}（贴图资产 ID）`, default: schema.default ?? null }
    case 'ref':
      return {
        type: schema.required ? 'string' : ['string', 'null'],
        description: `${desc}（引用目标：${schema.target}${schema.kinds?.length ? `，种类：${schema.kinds.join('/')}` : ''}）`,
      }
    case 'list':
      return {
        type: 'array',
        description: desc,
        items: fieldSchemaToJsonSchema(schema.item),
      }
    case 'object': {
      const entries = Object.entries(schema.fields)
      if (entries.length === 0) {
        return {
          type: 'object',
          ...(desc ? { description: desc } : {}),
          additionalProperties: true,
        }
      }
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, child] of entries) {
        properties[key] = fieldSchemaToJsonSchema(child)
        if (!child.optional && child.type === 'ref' && child.required) {
          required.push(key)
        }
      }
      return {
        type: 'object',
        ...(desc ? { description: desc } : {}),
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      }
    }
  }
}
