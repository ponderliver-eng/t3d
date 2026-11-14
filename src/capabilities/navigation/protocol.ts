import type { RecastBakeConfig } from './defaults'

export interface BakeWorkerRequest {
  positions: Float32Array
  indices: Uint32Array
  config: RecastBakeConfig
}

export type BakeWorkerResponse =
  | { ok: true, bytes: Uint8Array, mode: 'solo' | 'tileCache' }
  | { ok: false, error: string }
