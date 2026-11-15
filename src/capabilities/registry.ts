export interface CapabilityManifest {
  id: string
  defaultEnabled: boolean
}

/** 官方能力包清单。新增一项就在这里登记，并在 src/capabilities/<id>/ 下放数据和实现。 */
export const CAPABILITIES = [
  { id: 'physics', defaultEnabled: true },
  { id: 'navigation', defaultEnabled: true },
  { id: 'particles', defaultEnabled: false },
] as const satisfies readonly CapabilityManifest[]

export type CapabilityId = (typeof CAPABILITIES)[number]['id']

export function defaultCapabilities(): Record<CapabilityId, boolean> {
  return Object.fromEntries(CAPABILITIES.map(item => [item.id, item.defaultEnabled])) as Record<CapabilityId, boolean>
}

export function normalizeCapabilities(value: unknown): Record<CapabilityId, boolean> {
  const next = defaultCapabilities()
  if (!value || typeof value !== 'object') return next
  const record = value as Record<string, unknown>
  for (const item of CAPABILITIES) {
    if (typeof record[item.id] === 'boolean') next[item.id] = record[item.id] as boolean
  }
  return next
}

export function capabilityEnabled(capabilities: Record<string, boolean> | undefined, id: CapabilityId): boolean {
  if (!capabilities || typeof capabilities[id] !== 'boolean') return defaultCapabilities()[id]
  return capabilities[id]
}
