import type { UiClickAction } from './spec'
import { coerceUiValue, EMPTY_UI_VALUES, type UiValues } from './bindings'

type Listener = () => void

let variables: Record<string, unknown> = {}
let components: Record<string, Record<string, unknown>> = {}
let screens: Record<string, boolean> = {}
let snapshot: UiValues = EMPTY_UI_VALUES
const listeners = new Set<Listener>()
const clickListeners = new Set<(action: UiClickAction, nodeId: string) => void>()

function publish(): void {
  snapshot = {
    variables: { ...variables },
    components: Object.fromEntries(Object.entries(components).map(([id, fields]) => [id, { ...fields }])),
    screens: { ...screens },
  }
  for (const listener of listeners) listener()
}

export function uiValues(): UiValues {
  return snapshot
}

export function subscribeUiValues(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function writeUiVariable(varId: string, value: unknown): void {
  variables = { ...variables, [varId]: value }
  publish()
}

export function writeUiComponent(nodeId: string, field: string, value: unknown): void {
  components = { ...components, [nodeId]: { ...(components[nodeId] ?? {}), [field]: value } }
  publish()
}

export function setScreenVisible(nodeId: string, visible: boolean): void {
  screens = { ...screens, [nodeId]: visible }
  publish()
}

export function resetUiValues(): void {
  variables = {}
  components = {}
  screens = {}
  publish()
}

export function onUiClick(listener: (action: UiClickAction, nodeId: string) => void): () => void {
  clickListeners.add(listener)
  return () => clickListeners.delete(listener)
}

export function dispatchUiClick(action: UiClickAction, nodeId: string): void {
  if (action.kind === 'setVariable') writeUiVariable(action.varId, coerceUiValue(action.value))
  for (const listener of clickListeners) listener(action, nodeId)
}
