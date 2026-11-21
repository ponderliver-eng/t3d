import type { FieldSchema } from '../schema/fieldSchema'
import type { GameDatabaseRow, GameDatabaseTableSchema } from '../../gameplay/types'

export type PackTier = 'content' | 'gameplay' | 'effect'
export type PackTrust = 'local' | 'imported'

export interface LicenseNote {
  asset: string
  license: string
  author?: string
  url?: string
}

export interface PackDependency {
  id: string
  version: string
}

export interface PackComponentDef {
  id: string
  name: string
  description?: string
  scriptId?: string
  fields: Record<string, FieldSchema>
  defaults: Record<string, unknown>
}

export interface PackCodeEntry {
  id: string
  name: string
  relativePath: string
  source: string
}

export interface PackRecipe {
  id: string
  name: string
  description: string
  tier: PackTier
  steps: string[]
  smoke?: string[]
}

export interface PackManifest {
  id: string
  version: string
  name: string
  description: string
  tier: PackTier
  engine: string
  dependencies: PackDependency[]
  provides: {
    tables?: string[]
    components?: string[]
    scripts?: string[]
    shaders?: string[]
    capabilities?: string[]
    recipes?: string[]
  }
  provenance: {
    sourceProject?: string
    createdBy: 'user' | 'ai'
    createdAt: string
    licenses: LicenseNote[]
  }
  trust: PackTrust
}

export interface PackBundle {
  manifest: PackManifest
  scripts: PackCodeEntry[]
  shaders: PackCodeEntry[]
  tables: GameDatabaseTableSchema[]
  defaultRows: Record<string, GameDatabaseRow[]>
  components: PackComponentDef[]
  recipes: PackRecipe[]
  readme: string
}

export interface InstalledPackRecord {
  bundle: PackBundle
  trusted: boolean
  installedAt: number
  sourceDir?: string
}
