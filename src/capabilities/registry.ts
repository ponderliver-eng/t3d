export type CapabilityCategory = 'scene-object' | 'physics' | 'environment' | 'animation'

export interface CapabilityRuntimeModule {
  /** 能力包启用或加载完成时的可选挂载钩子。返回清理函数。 */
  mount?: () => (() => void) | void
  /** 能力包关闭时的清理钩子。 */
  dispose?: () => void
}

export interface CapabilityManifest {
  id: string
  defaultEnabled: boolean
  category?: CapabilityCategory
  /** 依赖的其它能力包 id（如 vehicle 依赖 ['physics']）。 */
  dependencies?: readonly string[]
  /** 按需动态加载运行时模块，未开启的能力包不进入主包首屏内存。 */
  loadRuntime?: () => Promise<CapabilityRuntimeModule>
}

/** 官方能力包清单。新增一项就在这里登记，并在 src/capabilities/<id>/ 下放数据和实现。 */
export const CAPABILITIES = [
  { id: 'physics', defaultEnabled: true, category: 'physics' },
  { id: 'buoyancy', defaultEnabled: true, category: 'physics', dependencies: ['physics'], loadRuntime: () => import('./buoyancy/session') },
  { id: 'navigation', defaultEnabled: true, category: 'physics' },
  { id: 'spline', defaultEnabled: true, category: 'animation', loadRuntime: () => import('./spline/session') },
  { id: 'tween', defaultEnabled: true, category: 'animation', loadRuntime: () => import('./tween/session') },
  { id: 'particles', defaultEnabled: false, category: 'scene-object' },
  { id: 'sky', defaultEnabled: false, category: 'environment', loadRuntime: () => import('./sky/session') },
  { id: 'water', defaultEnabled: false, category: 'environment', loadRuntime: () => import('./water/session') },
] as const satisfies readonly CapabilityManifest[]

export type CapabilityId = (typeof CAPABILITIES)[number]['id']

const loadedModules = new Map<string, CapabilityRuntimeModule>()
const activeCleanup = new Map<string, () => void>()
const pendingLoads = new Map<string, Promise<void>>()
const dynamicCapabilities = new Map<string, CapabilityManifest>()

export function registerDynamicCapability(manifest: CapabilityManifest) {
  dynamicCapabilities.set(manifest.id, manifest)
}

export function unregisterDynamicCapability(id: string) {
  const cleanup = activeCleanup.get(id)
  if (cleanup) {
    cleanup()
    activeCleanup.delete(id)
  }
  loadedModules.get(id)?.dispose?.()
  loadedModules.delete(id)
  dynamicCapabilities.delete(id)
}

export function allCapabilityManifests(): CapabilityManifest[] {
  return [...(CAPABILITIES as readonly CapabilityManifest[]), ...dynamicCapabilities.values()]
}

export function defaultCapabilities(): Record<CapabilityId, boolean> {
  const base = Object.fromEntries(CAPABILITIES.map(item => [item.id, item.defaultEnabled])) as Record<string, boolean>
  for (const item of dynamicCapabilities.values()) base[item.id] = item.defaultEnabled
  return base as Record<CapabilityId, boolean>
}

export function normalizeCapabilities(value: unknown): Record<CapabilityId, boolean> {
  const next = defaultCapabilities() as Record<string, boolean>
  if (!value || typeof value !== 'object') return next as Record<CapabilityId, boolean>
  const record = value as Record<string, unknown>
  for (const item of allCapabilityManifests()) {
    if (typeof record[item.id] === 'boolean') next[item.id] = record[item.id] as boolean
  }
  return next as Record<CapabilityId, boolean>
}

export function capabilityEnabled(capabilities: Record<string, boolean> | undefined, id: CapabilityId | string): boolean {
  const defaults = defaultCapabilities() as Record<string, boolean>
  if (!capabilities || typeof capabilities[id] !== 'boolean') return defaults[id] ?? false
  const manifest = allCapabilityManifests().find(item => item.id === id)
  if (manifest?.dependencies) {
    for (const dep of manifest.dependencies) {
      if (!capabilityEnabled(capabilities, dep)) return false
    }
  }
  return capabilities[id]
}

/** 根据当前工程的 capabilities 开关，按需懒加载已启用的能力包或卸载已关闭的能力包。 */
export function syncCapabilityRuntimes(capabilities: Record<string, boolean> | undefined) {
  for (const item of allCapabilityManifests()) {
    const enabled = capabilityEnabled(capabilities, item.id)
    if (!enabled) {
      const cleanup = activeCleanup.get(item.id)
      if (cleanup) {
        cleanup()
        activeCleanup.delete(item.id)
      }
      loadedModules.get(item.id)?.dispose?.()
      continue
    }
    if (!item.loadRuntime || activeCleanup.has(item.id) || pendingLoads.has(item.id)) continue
    const cached = loadedModules.get(item.id)
    if (cached) {
      const cleanup = cached.mount?.()
      activeCleanup.set(item.id, typeof cleanup === 'function' ? cleanup : () => undefined)
      continue
    }
    const loader = item.loadRuntime
    const task = loader().then(mod => {
      pendingLoads.delete(item.id)
      loadedModules.set(item.id, mod)
      if (capabilityEnabled(capabilities, item.id) && !activeCleanup.has(item.id)) {
        const cleanup = mod.mount?.()
        activeCleanup.set(item.id, typeof cleanup === 'function' ? cleanup : () => undefined)
      }
    }).catch(error => {
      pendingLoads.delete(item.id)
      console.warn(`[capability] ${item.id} 加载失败`, error)
    })
    pendingLoads.set(item.id, task)
  }
}
