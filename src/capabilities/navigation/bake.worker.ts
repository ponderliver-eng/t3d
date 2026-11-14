import { exportNavMesh, exportTileCache, init } from 'recast-navigation'
import { generateSoloNavMesh, generateTileCache } from 'recast-navigation/generators'
import type { BakeWorkerRequest, BakeWorkerResponse } from './protocol'

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BakeWorkerRequest>) => void) | null
  postMessage: (message: BakeWorkerResponse, transfer?: Transferable[]) => void
}

scope.onmessage = async event => {
  const { positions, indices, config } = event.data
  try {
    await init()
    if (config.mode === 'tileCache') {
      const result = generateTileCache(positions, indices, {
        cs: config.cs,
        ch: config.ch,
        walkableSlopeAngle: config.walkableSlopeAngle,
        walkableHeight: config.walkableHeight,
        walkableClimb: config.walkableClimb,
        walkableRadius: config.walkableRadius,
        borderSize: config.borderSize,
        tileSize: config.tileSize,
        expectedLayersPerTile: config.expectedLayersPerTile,
        maxObstacles: config.maxObstacles,
      })
      if (!result.success) {
        scope.postMessage({ ok: false, error: result.error })
        return
      }
      const bytes = exportTileCache(result.navMesh, result.tileCache)
      result.navMesh.destroy()
      result.tileCache.destroy()
      const copy = new Uint8Array(bytes)
      scope.postMessage({ ok: true, bytes: copy, mode: 'tileCache' }, [copy.buffer])
      return
    }
    const result = generateSoloNavMesh(positions, indices, {
      cs: config.cs,
      ch: config.ch,
      walkableSlopeAngle: config.walkableSlopeAngle,
      walkableHeight: config.walkableHeight,
      walkableClimb: config.walkableClimb,
      walkableRadius: config.walkableRadius,
    })
    if (!result.success) {
      scope.postMessage({ ok: false, error: result.error })
      return
    }
    const bytes = exportNavMesh(result.navMesh)
    result.navMesh.destroy()
    const copy = new Uint8Array(bytes)
    scope.postMessage({ ok: true, bytes: copy, mode: 'solo' }, [copy.buffer])
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
