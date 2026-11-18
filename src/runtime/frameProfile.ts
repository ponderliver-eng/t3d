const buckets = new Map<string, number>()
let frames = 0

export function beginFrameCosts() {
  frames += 1
}

export function measureCost(id: string, run: () => void) {
  const start = performance.now()
  run()
  const ms = performance.now() - start
  buckets.set(id, (buckets.get(id) ?? 0) + ms)
}

export function takeCostAverages(): { id: string, ms: number }[] {
  const count = Math.max(1, frames)
  const rows = [...buckets.entries()].map(([id, sum]) => ({ id, ms: sum / count }))
  buckets.clear()
  frames = 0
  return rows.filter(row => row.ms >= 0.05).sort((a, b) => b.ms - a.ms).slice(0, 8)
}
