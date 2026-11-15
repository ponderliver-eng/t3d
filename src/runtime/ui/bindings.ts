import type { UiBindingTarget, UiClickAction, UiNode } from './spec'

export interface UiValues {
  variables: Record<string, unknown>
  components: Record<string, Record<string, unknown>>
  screens: Record<string, boolean>
}

export const EMPTY_UI_VALUES: UiValues = { variables: {}, components: {}, screens: {} }

export function coerceUiValue(raw: string): unknown {
  const text = raw.trim()
  if (text === 'true') return true
  if (text === 'false') return false
  if (text !== '' && Number.isFinite(Number(text))) return Number(text)
  return raw
}

export function resolveUiTree(root: UiNode, values: UiValues, overrides?: Record<string, unknown>): UiNode {
  return resolveNode(root, values, overrides)
}

export function clickLabel(action: UiClickAction | undefined): string {
  if (!action) return ''
  if (action.kind === 'sendMessage') return action.message
  return action.varId
}

function resolveNode(node: UiNode, values: UiValues, overrides?: Record<string, unknown>): UiNode {
  const next: UiNode = {
    ...node,
    style: node.style ? { ...node.style } : undefined,
    progress: node.progress ? { ...node.progress } : undefined,
    children: node.children?.map(child => resolveNode(child, values, overrides)),
  }
  for (const binding of node.bindings ?? []) {
    const value = overrides && binding.id in overrides ? overrides[binding.id] : readSource(binding, values)
    if (value === undefined) continue
    applyBinding(next, binding.target, value)
  }
  return next
}

function readSource(binding: NonNullable<UiNode['bindings']>[number], values: UiValues): unknown {
  if (binding.source.kind === 'variable') {
    return binding.source.varId in values.variables ? values.variables[binding.source.varId] : undefined
  }
  const fields = values.components[binding.source.nodeId]
  if (!fields || !(binding.source.field in fields)) return undefined
  return fields[binding.source.field]
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'string') return value !== 'false' && value !== '0' && value !== ''
  return Boolean(value)
}

function applyBinding(node: UiNode, target: UiBindingTarget, value: unknown): void {
  if (target === 'visible') node.visible = asBoolean(value)
  else if (target === 'enabled') node.enabled = asBoolean(value)
  else if (target === 'text') node.text = String(value)
  else if (target === 'opacity') node.style = { ...(node.style ?? {}), opacity: Number(value) }
  else if (target === 'progress.value' && node.progress) node.progress = { ...node.progress, value: Number(value) }
}
