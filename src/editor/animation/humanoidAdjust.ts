/** 叠在自动重定向上的模型微调。默认全 0，步幅默认 1。非默认值进入模型缓存版本。 */

export interface HumanoidRetargetAdjust {
  shoulderSpreadDeg?: number
  shoulderWidthRatio?: number
  armSpreadDeg?: number
  elbowBendDeg?: number
  hipSpreadDeg?: number
  kneeBendDeg?: number
  footPitchDeg?: number
  hipsHeightLegRatio?: number
  strideScale?: number
}

const ANGLE_LIMIT = 35
const SHOULDER_ROTATE_MIN = -90
const SHOULDER_WIDTH_LIMIT = 1
const HEIGHT_LIMIT = 0.5
const STRIDE_MIN = 0.25
const STRIDE_MAX = 2.5

export interface NormalizedHumanoidRetargetAdjust {
  shoulderSpreadDeg: number
  shoulderWidthRatio: number
  armSpreadDeg: number
  elbowBendDeg: number
  hipSpreadDeg: number
  kneeBendDeg: number
  footPitchDeg: number
  hipsHeightLegRatio: number
  strideScale: number
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

export function normalizeHumanoidRetargetAdjust(raw?: HumanoidRetargetAdjust | null): NormalizedHumanoidRetargetAdjust {
  return {
    shoulderSpreadDeg: clamp(raw?.shoulderSpreadDeg ?? 0, SHOULDER_ROTATE_MIN, ANGLE_LIMIT, 0),
    shoulderWidthRatio: clamp(raw?.shoulderWidthRatio ?? 0, -SHOULDER_WIDTH_LIMIT, SHOULDER_WIDTH_LIMIT, 0),
    armSpreadDeg: clamp(raw?.armSpreadDeg ?? 0, -ANGLE_LIMIT, ANGLE_LIMIT, 0),
    elbowBendDeg: clamp(raw?.elbowBendDeg ?? 0, -ANGLE_LIMIT, ANGLE_LIMIT, 0),
    hipSpreadDeg: clamp(raw?.hipSpreadDeg ?? 0, -ANGLE_LIMIT, ANGLE_LIMIT, 0),
    kneeBendDeg: clamp(raw?.kneeBendDeg ?? 0, -ANGLE_LIMIT, ANGLE_LIMIT, 0),
    footPitchDeg: clamp(raw?.footPitchDeg ?? 0, -ANGLE_LIMIT, ANGLE_LIMIT, 0),
    hipsHeightLegRatio: clamp(raw?.hipsHeightLegRatio ?? 0, -HEIGHT_LIMIT, HEIGHT_LIMIT, 0),
    strideScale: clamp(raw?.strideScale ?? 1, STRIDE_MIN, STRIDE_MAX, 1),
  }
}

export function humanoidRetargetAdjustIsDefault(raw?: HumanoidRetargetAdjust | null): boolean {
  const n = normalizeHumanoidRetargetAdjust(raw)
  return n.shoulderSpreadDeg === 0
    && n.shoulderWidthRatio === 0
    && n.armSpreadDeg === 0
    && n.elbowBendDeg === 0
    && n.hipSpreadDeg === 0
    && n.kneeBendDeg === 0
    && n.footPitchDeg === 0
    && n.hipsHeightLegRatio === 0
    && n.strideScale === 1
}

export function humanoidRetargetAdjustCacheKey(raw?: HumanoidRetargetAdjust | null): string {
  if (humanoidRetargetAdjustIsDefault(raw)) return ''
  const n = normalizeHumanoidRetargetAdjust(raw)
  return [
    n.shoulderSpreadDeg, n.shoulderWidthRatio, n.armSpreadDeg, n.elbowBendDeg,
    n.hipSpreadDeg, n.kneeBendDeg, n.footPitchDeg, n.hipsHeightLegRatio, n.strideScale,
  ].join(',')
}
