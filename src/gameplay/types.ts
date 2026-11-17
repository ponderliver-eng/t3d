/** 玩法包登记的一张表。行数据集中存在工程里，不为一行建文件。 */
export interface GameDatabaseColumn {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'color' | 'select'
  defaultValue?: unknown
  options?: Array<{ value: string, label: string }>
}

export interface GameDatabaseRow {
  id: string
  name: string
  category?: string
  description?: string
  fields?: Record<string, unknown>
}

export interface GameDatabaseTableSchema {
  tableId: string
  title: string
  description?: string
  packId: string
  columns: GameDatabaseColumn[]
  defaultRows?: GameDatabaseRow[]
}

export interface GameDatabase {
  tables: Record<string, GameDatabaseRow[]>
}

export interface GameplayPackManifest {
  id: string
  name: string
  description: string
  builtIn?: boolean
  /** 核心包不可关。 */
  core?: boolean
  dependencies?: string[]
  tables?: GameDatabaseTableSchema[]
}

export const CORE_GAMEPLAY_PACK_ID = 't3d.core'
