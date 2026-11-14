export interface StoredNavMesh {
  bytes: string
  mode: 'solo' | 'tileCache'
  signature: string
  triangles: number
}

const saved = new Map<string, StoredNavMesh>()
let epoch = 0

export function navEpoch(): number {
  return epoch
}

export function navRecord(sceneId: string): StoredNavMesh | null {
  return saved.get(sceneId) ?? null
}

export function rememberNavMesh(sceneId: string, record: StoredNavMesh) {
  if (!sceneId) return
  saved.set(sceneId, record)
}

export function forgetNavMesh(sceneId: string) {
  saved.delete(sceneId)
}

export function serializeNavMeshes(): Record<string, StoredNavMesh> | undefined {
  if (saved.size === 0) return undefined
  return Object.fromEntries(saved)
}

export function hydrateNavMeshes(value: unknown) {
  saved.clear()
  epoch += 1
  if (!value || typeof value !== 'object') return
  for (const [id, record] of Object.entries(value as Record<string, unknown>)) {
    const cleaned = cleanRecord(record)
    if (cleaned) saved.set(id, cleaned)
  }
}

export function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

export function decodeBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function cleanRecord(value: unknown): StoredNavMesh | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<StoredNavMesh>
  if (typeof record.bytes !== 'string' || record.bytes.length === 0) return null
  if (record.mode !== 'solo' && record.mode !== 'tileCache') return null
  if (typeof record.signature !== 'string') return null
  return {
    bytes: record.bytes,
    mode: record.mode,
    signature: record.signature,
    triangles: typeof record.triangles === 'number' ? record.triangles : 0,
  }
}
