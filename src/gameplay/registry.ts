import {
  CORE_GAMEPLAY_PACK_ID,
  type GameDatabase,
  type GameDatabaseRow,
  type GameDatabaseTableSchema,
  type GameplayPackManifest,
} from './types'

const packs = new Map<string, GameplayPackManifest>()

export function registerGameplayPack(pack: GameplayPackManifest) {
  packs.set(pack.id, pack)
}

export function listGameplayPacks(): GameplayPackManifest[] {
  return [...packs.values()]
}

export function resolveEnabledPackIds(enabled?: string[] | null): Set<string> {
  const next = new Set<string>([CORE_GAMEPLAY_PACK_ID, ...(enabled ?? [])])
  let changed = true
  while (changed) {
    changed = false
    for (const id of [...next]) {
      for (const dep of packs.get(id)?.dependencies ?? []) {
        if (!next.has(dep)) {
          next.add(dep)
          changed = true
        }
      }
    }
  }
  return next
}

export function listEnabledTableSchemas(enabled?: string[] | null): GameDatabaseTableSchema[] {
  const on = resolveEnabledPackIds(enabled)
  const schemas: GameDatabaseTableSchema[] = []
  for (const pack of packs.values()) {
    if (!on.has(pack.id)) continue
    for (const table of pack.tables ?? []) schemas.push(table)
  }
  return schemas
}

export function tableSchema(tableId: string): GameDatabaseTableSchema | undefined {
  for (const pack of packs.values()) {
    const found = pack.tables?.find(table => table.tableId === tableId)
    if (found) return found
  }
  return undefined
}

export function defaultRows(tableId: string): GameDatabaseRow[] {
  return structuredClone(tableSchema(tableId)?.defaultRows ?? [])
}

/** 工程里还没有这张表时，用包登记的默认行。空表保持为空，重置默认由编辑器写入。 */
export function tableRows(database: GameDatabase | null | undefined, tableId: string): GameDatabaseRow[] {
  const existing = database?.tables?.[tableId]
  if (existing) return existing
  return defaultRows(tableId)
}

export function createDefaultGameDatabase(enabled?: string[] | null): GameDatabase {
  const tables: Record<string, GameDatabaseRow[]> = {}
  for (const schema of listEnabledTableSchemas(enabled)) {
    tables[schema.tableId] = structuredClone(schema.defaultRows ?? [])
  }
  return { tables }
}

export function ensureGameDatabase(value: unknown, enabled?: string[] | null): GameDatabase {
  const base = createDefaultGameDatabase(enabled)
  if (!value || typeof value !== 'object') return base
  const tables = (value as GameDatabase).tables
  if (!tables || typeof tables !== 'object') return base
  for (const [tableId, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) continue
    base.tables[tableId] = rows.flatMap(row => cleanRow(row))
  }
  return base
}

function cleanRow(value: unknown): GameDatabaseRow[] {
  if (!value || typeof value !== 'object') return []
  const row = value as GameDatabaseRow
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return []
  return [{
    id: row.id,
    name: row.name,
    category: typeof row.category === 'string' ? row.category : '',
    description: typeof row.description === 'string' ? row.description : '',
    fields: row.fields && typeof row.fields === 'object' ? { ...row.fields } : {},
  }]
}

export function findRow(database: GameDatabase | null | undefined, tableId: string, id: string): GameDatabaseRow | undefined {
  const key = id.trim()
  if (!key) return undefined
  return tableRows(database, tableId).find(row => row.id === key)
}
