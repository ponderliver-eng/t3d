import type { ComponentType } from 'react'
import type { NodeKind, SceneNode, Vec3 } from '../editor/scene/types'
import type { RuleCondition, RuleEntry, RuleStep, SceneRuntimeHost } from '../runtime/sceneRuntime'

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

export interface GameplayPackComponentDef {
  componentId: string
  label: string
  color: string
  group?: 'character' | 'devices' | 'world' | 'pack'
  /** 空着表示适用于所有可挂载玩法的节点（mesh / model / empty）。 */
  appliesTo?: readonly NodeKind[]
  defaultData: () => Record<string, unknown>
  Card: ComponentType<{ node: SceneNode, packId: string, componentId: string, disabled: boolean }>
}

export interface GameplayPackTriggerDef {
  kind: string
  label: string
  paramHint?: 'none' | 'key' | 'message'
  /** 可选自定义轮询函数，返回 true 时触发该规则。 */
  poll?: (node: SceneNode, rule: RuleEntry, host: SceneRuntimeHost) => boolean
}

export interface GameplayPackConditionDef {
  kind: string
  label: string
  paramHint?: 'none' | 'tag' | 'formula' | 'compare'
  test: (node: SceneNode, cond: RuleCondition, helpers: { hasTag: (tag: string) => boolean, evaluate: (expr: string) => number }) => boolean
}

export interface GameplayPackActionContext {
  node: SceneNode
  actor: SceneNode
  step: RuleStep
  host: SceneRuntimeHost
  now: number
  evaluate: (expr: string) => number
  postMessage: (message: string, nodeId?: string, fields?: Record<string, number | string>) => void
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  orderMove: (nodeId: string, point: Vec3) => void
}

export interface GameplayPackActionDef {
  kind: string
  label: string
  tone?: string
  paramHint?: 'none' | 'text' | 'formula' | 'node' | 'tag' | 'targetFormula'
  placeholder?: string
  execute: (ctx: GameplayPackActionContext) => void
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
  /** 该玩法包提供的节点组件（数据自动存放在 node.gameplay.packs[packId][componentId]）。 */
  components?: GameplayPackComponentDef[]
  /** 向核心律令系统追加的触发词、条件词与动作指令。 */
  triggers?: GameplayPackTriggerDef[]
  conditions?: GameplayPackConditionDef[]
  actions?: GameplayPackActionDef[]
}

export const CORE_GAMEPLAY_PACK_ID = 't3d.core'
