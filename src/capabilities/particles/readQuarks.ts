import type { ParticleBlend } from '../../editor/scene/types'
import type { StoredSimulation } from './runtime'

export interface QuarksAppearance {
  color: string
  blend: ParticleBlend
  opacity: number
  depthWrite: boolean
  /** data URL 或 http URL。没有贴图时为空。 */
  image: string | null
}

export interface QuarksDocument {
  simulation: StoredSimulation
  appearance: QuarksAppearance
}

const DEFAULT_APPEARANCE: QuarksAppearance = {
  color: '#ff8c33',
  blend: 'additive',
  opacity: 1,
  depthWrite: false,
  image: null,
}

/** 把外部 Quarks JSON 收成工程里的模拟和外观。认不出来就返回 null。 */
export function readQuarksDocument(json: unknown): QuarksDocument | null {
  if (!json || typeof json !== 'object') return null
  const record = json as Record<string, unknown>
  if (record.version === '3.0' && record.shape && typeof record.shape === 'object') {
    const body = { ...record }
    delete body.material
    delete body.texture
    return {
      simulation: { format: 'system', body },
      appearance: appearanceFromFields(record, DEFAULT_APPEARANCE),
    }
  }
  if (record.object && typeof record.object === 'object') {
    const system = findSystem(record.object)
    return {
      simulation: { format: 'loader', body: record },
      appearance: appearanceFromLoader(record, system),
    }
  }
  return null
}

export function asSimulation(value: unknown): StoredSimulation | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { format?: unknown, body?: unknown }
  if ((record.format === 'system' || record.format === 'loader') && record.body && typeof record.body === 'object') {
    return { format: record.format, body: record.body }
  }
  return readQuarksDocument(value)?.simulation ?? null
}

function appearanceFromLoader(root: Record<string, unknown>, system: Record<string, unknown> | null): QuarksAppearance {
  const materials = Array.isArray(root.materials) ? root.materials : []
  const materialId = system && typeof system.material === 'string' ? system.material : ''
  const material = materials.find(item => item && typeof item === 'object' && (item as { uuid?: string }).uuid === materialId) as Record<string, unknown> | undefined
  const appearance = appearanceFromFields(material ?? system ?? {}, DEFAULT_APPEARANCE)
  appearance.image = firstImage(root)
  return appearance
}

function appearanceFromFields(source: Record<string, unknown>, fallback: QuarksAppearance): QuarksAppearance {
  const premultiplied = source.premultipliedAlpha === true
  return {
    color: cssColor(source.color) ?? fallback.color,
    blend: premultiplied ? 'premultiply' : blendFromThree(source.blending, fallback.blend),
    opacity: typeof source.opacity === 'number' ? source.opacity : fallback.opacity,
    depthWrite: typeof source.depthWrite === 'boolean' ? source.depthWrite : fallback.depthWrite,
    image: fallback.image,
  }
}

function blendFromThree(value: unknown, fallback: ParticleBlend): ParticleBlend {
  if (value === 2) return 'additive'
  if (value === 4) return 'multiply'
  if (value === 1) return 'alpha'
  if (value === 5) return 'premultiply'
  return fallback
}

function cssColor(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `#${Math.max(0, Math.min(0xffffff, value)).toString(16).padStart(6, '0')}`
}

function firstImage(root: Record<string, unknown>): string | null {
  if (!Array.isArray(root.images)) return null
  for (const image of root.images) {
    if (image && typeof image === 'object' && typeof (image as { url?: unknown }).url === 'string') {
      const url = (image as { url: string }).url
      if (url.length > 0) return url
    }
  }
  return null
}

function findSystem(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.ps && typeof record.ps === 'object') return record.ps as Record<string, unknown>
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      const found = findSystem(child)
      if (found) return found
    }
  }
  return null
}
