export const BUOYANCY_CAPABILITY_ID = 'buoyancy'

export type BuoyancySampleMode = 'box4' | 'box8' | 'center'

export interface BuoyancySpec {
  enabled: boolean
  /** 浮力倍率：1.0 时完全浸没恰好抵消重力，> 1 会浮出水面（默认 1.6）。 */
  buoyancyForce: number
  /** 水中线性阻力，抑制上下弹跳和漂移。 */
  waterDrag: number
  /** 水中角阻力，抑制剧烈摇晃与翻滚。 */
  angularDrag: number
  /** 采样点分布：底面四点适合船只/箱子，八角适合全浸没物体，中心适合球/浮标。 */
  sampleMode: BuoyancySampleMode
  /** 有效吃水深度 (m)；0 表示按碰撞盒高度自动估算。 */
  draftDepth: number
}

export function defaultBuoyancy(): BuoyancySpec {
  return {
    enabled: true,
    buoyancyForce: 1.6,
    waterDrag: 2.5,
    angularDrag: 2.0,
    sampleMode: 'box4',
    draftDepth: 0,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeBuoyancy(raw: unknown): BuoyancySpec {
  const base = defaultBuoyancy()
  if (!raw || typeof raw !== 'object') return base
  const input = raw as Record<string, unknown>
  const mode = input.sampleMode === 'box8' || input.sampleMode === 'center' ? input.sampleMode : 'box4'
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
    buoyancyForce: clamp(finite(input.buoyancyForce, base.buoyancyForce), 0, 10),
    waterDrag: clamp(finite(input.waterDrag, base.waterDrag), 0, 20),
    angularDrag: clamp(finite(input.angularDrag, base.angularDrag), 0, 20),
    sampleMode: mode,
    draftDepth: clamp(finite(input.draftDepth, base.draftDepth), 0, 20),
  }
}
