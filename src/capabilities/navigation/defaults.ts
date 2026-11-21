import type { NavSettings, NodeKind, NodeNavigation } from '../../editor/scene/types'

const DEFAULT_NAV_SETTINGS: NavSettings = {
  cellSize: 0.2,
  cellHeight: 0.2,
  walkableSlopeAngle: 45,
  agentRadius: 0.35,
  agentHeight: 1.8,
  maxObstacles: 32,
}

export interface RecastBakeConfig {
  mode: 'solo' | 'tileCache'
  cs: number
  ch: number
  walkableSlopeAngle: number
  walkableHeight: number
  walkableClimb: number
  walkableRadius: number
  maxObstacles: number
  tileSize: number
  expectedLayersPerTile: number
  borderSize: number
}

export function navSignature(settings: NavSettings): string {
  return JSON.stringify(settings)
}

/** 作者参数是米和度。Recast 的高度、爬升和半径要用格子数。 */
export function recastBakeConfig(settings: NavSettings): RecastBakeConfig {
  const cs = Math.max(0.05, settings.cellSize)
  const ch = Math.max(0.05, settings.cellHeight)
  const walkableRadius = Math.max(1, Math.ceil(Math.max(0.05, settings.agentRadius) / cs))
  const walkableHeight = Math.max(3, Math.ceil(Math.max(0.2, settings.agentHeight) / ch))
  const walkableClimb = Math.max(1, Math.floor(0.25 / ch))
  const maxObstacles = Math.max(0, Math.min(128, Math.floor(settings.maxObstacles)))
  return {
    mode: maxObstacles > 0 ? 'tileCache' : 'solo',
    cs,
    ch,
    walkableSlopeAngle: Math.min(89, Math.max(0, settings.walkableSlopeAngle)),
    walkableHeight,
    walkableClimb,
    walkableRadius,
    maxObstacles,
    tileSize: 32,
    expectedLayersPerTile: 4,
    borderSize: walkableRadius + 3,
  }
}

export function defaultNodeNavigation(kind: NodeKind): NodeNavigation {
  if (kind === 'empty') return { role: 'obstacle', radius: 0.5, height: 2 }
  return { role: 'surface', radius: 0.5, height: 2 }
}

export function navSettingsOf(settings: Partial<NavSettings> | undefined): NavSettings {
  return { ...DEFAULT_NAV_SETTINGS, ...settings }
}
