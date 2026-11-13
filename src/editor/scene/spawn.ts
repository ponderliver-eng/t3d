import type { Vec3 } from './types'

let provider = (): Vec3 => [0, 0, 0]

export function setSpawnProvider(next: () => Vec3) {
  provider = next
}

export function getSpawn(): Vec3 {
  return provider()
}
