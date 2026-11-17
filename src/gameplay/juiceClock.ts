let holdUntil = 0
let shakeAmp = 0
let shakeUntil = 0
let flashColor = ''
let flashUntil = 0
const flashListeners = new Set<() => void>()

export function scalePlayDt(dt: number, now = performance.now() / 1000): number {
  if (now < holdUntil) return 0
  return dt
}

export function juiceShake(now = performance.now() / 1000): { x: number, y: number } {
  if (now >= shakeUntil || shakeAmp <= 0) return { x: 0, y: 0 }
  return { x: (Math.random() - 0.5) * shakeAmp, y: (Math.random() - 0.5) * shakeAmp }
}

export function juiceFlash(): string {
  if (performance.now() / 1000 >= flashUntil) return ''
  return flashColor
}

export function subscribeJuiceFlash(listener: () => void): () => void {
  flashListeners.add(listener)
  return () => flashListeners.delete(listener)
}

export function clearJuice() {
  holdUntil = 0
  shakeAmp = 0
  shakeUntil = 0
  if (flashColor) {
    flashColor = ''
    flashUntil = 0
    flashListeners.forEach(listener => listener())
  }
}

export function armJuice(hitStopSec: number, shake: number, color: string, now: number) {
  if (hitStopSec > 0) holdUntil = Math.max(holdUntil, now + hitStopSec)
  if (shake > 0) {
    shakeAmp = shake
    shakeUntil = now + 0.28
  }
  if (color) {
    flashColor = color
    flashUntil = now + 0.12
    flashListeners.forEach(listener => listener())
    window.setTimeout(() => flashListeners.forEach(listener => listener()), 140)
  }
}
