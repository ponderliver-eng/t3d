import {
  exportNavMesh,
  exportTileCache,
  getNavMeshPositionsAndIndices,
  importNavMesh,
  importTileCache,
  init,
  NavMeshQuery,
  type NavMesh,
  type TileCache,
  type CylinderObstacle,
} from 'recast-navigation'
import { createDefaultTileCacheMeshProcess } from 'recast-navigation/generators'
import type { BakeWorkerResponse } from './protocol'
import type { NavDebugMesh, NavObstacleDesc, NavRecord, NavigationWorld } from './world'
import type { RecastBakeConfig } from './defaults'
import type { Vec3 } from '../../editor/scene/types'

export async function createRecastNavigation(): Promise<NavigationWorld> {
  await init()
  return new RecastNavigation()
}

class RecastNavigation implements NavigationWorld {
  private navMesh: NavMesh | null = null
  private tileCache: TileCache | null = null
  private query: NavMeshQuery | null = null
  private retained: unknown[] = []
  private carved = new Map<string, CylinderObstacle>()
  private worker: Worker | null = null
  private mode: 'solo' | 'tileCache' = 'solo'

  async bake(positions: Float32Array, indices: Uint32Array, config: RecastBakeConfig, signal: AbortSignal) {
    if (signal.aborted) throw abortError()
    this.worker?.terminate()
    const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    const response = await new Promise<BakeWorkerResponse>((resolve, reject) => {
      const stop = () => {
        worker.terminate()
        reject(abortError())
      }
      if (signal.aborted) {
        stop()
        return
      }
      signal.addEventListener('abort', stop, { once: true })
      worker.onmessage = (event: MessageEvent<BakeWorkerResponse>) => {
        signal.removeEventListener('abort', stop)
        resolve(event.data)
      }
      worker.onerror = () => {
        signal.removeEventListener('abort', stop)
        reject(new Error('navigation worker failed'))
      }
      const positionCopy = new Float32Array(positions)
      const indexCopy = new Uint32Array(indices)
      worker.postMessage(
        { positions: positionCopy, indices: indexCopy, config },
        [positionCopy.buffer, indexCopy.buffer],
      )
    })
    if (this.worker === worker) this.worker = null
    worker.terminate()
    if (signal.aborted) throw abortError()
    if (!response.ok) throw new Error(response.error || 'bake failed')
    await this.restore({ bytes: response.bytes, mode: response.mode })
  }

  async restore(record: NavRecord) {
    this.releaseMesh()
    if (record.mode === 'tileCache') {
      const imported = importTileCache(record.bytes, createDefaultTileCacheMeshProcess())
      this.navMesh = imported.navMesh
      this.tileCache = imported.tileCache
      this.retained = [imported.allocator, imported.compressor]
      this.mode = 'tileCache'
    } else {
      this.navMesh = importNavMesh(record.bytes).navMesh
      this.mode = 'solo'
    }
    this.query = new NavMeshQuery(this.navMesh)
    this.query.defaultQueryHalfExtents = { x: 2, y: 4, z: 2 }
  }

  clear() {
    this.releaseMesh()
  }

  obstacles(items: NavObstacleDesc[]) {
    const cache = this.tileCache
    const mesh = this.navMesh
    if (!cache || !mesh || this.mode !== 'tileCache') return
    let changed = this.carved.size > 0 || items.length > 0
    for (const obstacle of this.carved.values()) cache.removeObstacle(obstacle)
    this.carved.clear()
    for (const item of items) {
      const added = cache.addCylinderObstacle(
        { x: item.position[0], y: item.position[1], z: item.position[2] },
        item.radius,
        item.height,
      )
      if (!added.success || !added.obstacle) continue
      this.carved.set(item.id, added.obstacle)
    }
    if (!changed) return
    for (let step = 0; step < 8; step += 1) {
      const updated = cache.update(mesh)
      if (updated.upToDate) break
    }
  }

  findPath(start: Vec3, end: Vec3): Vec3[] | null {
    if (!this.query) return null
    const result = this.query.computePath(
      { x: start[0], y: start[1], z: start[2] },
      { x: end[0], y: end[1], z: end[2] },
    )
    if (!result.success || result.path.length === 0) return null
    return result.path.map(point => [point.x, point.y, point.z] as Vec3)
  }

  debug(): NavDebugMesh | null {
    if (!this.navMesh) return null
    const [positions, indices] = getNavMeshPositionsAndIndices(this.navMesh)
    if (positions.length === 0 || indices.length === 0) return null
    return {
      positions: Float32Array.from(positions),
      indices: Uint32Array.from(indices),
    }
  }

  exportRecord(): NavRecord | null {
    if (!this.navMesh) return null
    if (this.mode === 'tileCache' && this.tileCache) {
      return { bytes: new Uint8Array(exportTileCache(this.navMesh, this.tileCache)), mode: 'tileCache' }
    }
    return { bytes: new Uint8Array(exportNavMesh(this.navMesh)), mode: 'solo' }
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.releaseMesh()
  }

  private releaseMesh() {
    this.carved.clear()
    this.query?.destroy()
    this.query = null
    this.tileCache?.destroy()
    this.tileCache = null
    this.navMesh?.destroy()
    this.navMesh = null
    this.retained.splice(0, this.retained.length)
    this.mode = 'solo'
  }
}

function abortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}
