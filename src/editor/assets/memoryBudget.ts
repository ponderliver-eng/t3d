/**
 * 贴图显存预算的纯计算部分（不依赖 three 和浏览器，方便单测）。
 *
 * 浏览器里查不到真实显存，这里全部是按尺寸和格式估算的数字。
 */

const BUDGET_KEY = 't3d.memory.textureBudgetMb'
const DEFAULT_BUDGET_MB = 3072
const MIN_BUDGET_MB = 256

/** 降级后贴图最长边不低于这个值：再小就糊得没法看了。 */
const MIN_DEGRADED_SIZE = 256

export interface MipLevelSize {
  width: number
  height: number
}

/** 贴图显存预算（字节）。可用 localStorage 的 t3d.memory.textureBudgetMb 覆盖。 */
export function textureBudgetBytes(): number {
  let mb = DEFAULT_BUDGET_MB
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BUDGET_KEY) : null
    const parsed = raw ? Number(raw) : Number.NaN
    if (Number.isFinite(parsed) && parsed >= MIN_BUDGET_MB) mb = parsed
  } catch {
    // 读不到本地存储时用默认值
  }
  return mb * 1024 * 1024
}

/** 未压缩 RGBA8 贴图的估算字节数。 */
export function estimateRgbaBytes(width: number, height: number, mipmaps: boolean, bytesPerPixel = 4): number {
  const base = Math.max(0, width) * Math.max(0, height) * bytesPerPixel
  return mipmaps ? Math.round(base * 4 / 3) : base
}

/**
 * 已用量超过预算时，新加载的压缩贴图要跳过几级最清晰的 mip。
 * 每跳一级显存降到 1/4。压缩贴图的基准级宽高必须是 4 的倍数，不满足就少跳。
 */
export function chooseMipSkip(usedBytes: number, budgetBytes: number, levels: readonly MipLevelSize[]): number {
  if (budgetBytes <= 0 || levels.length <= 1) return 0
  const ratio = usedBytes / budgetBytes
  let skip = ratio >= 1.25 ? 2 : ratio >= 1 ? 1 : 0
  skip = Math.min(skip, levels.length - 1)
  while (skip > 0) {
    const level = levels[skip]!
    const usable = level.width % 4 === 0
      && level.height % 4 === 0
      && Math.max(level.width, level.height) >= MIN_DEGRADED_SIZE
    if (usable) break
    skip -= 1
  }
  return skip
}

/** 把降级的贴图恢复成全清晰度后，预计的总用量。 */
export function projectedBytesAfterRestore(usedBytes: number, degraded: ReadonlyArray<{ bytes: number, skip: number }>): number {
  let total = usedBytes
  for (const item of degraded) total += item.bytes * (4 ** item.skip - 1)
  return total
}

/** 恢复后仍留有余量才恢复，避免「恢复 → 超预算 → 又降级」来回抖动。 */
export function canRestoreDegraded(usedBytes: number, budgetBytes: number, degraded: ReadonlyArray<{ bytes: number, skip: number }>): boolean {
  if (degraded.length === 0) return false
  return projectedBytesAfterRestore(usedBytes, degraded) <= budgetBytes * 0.85
}
