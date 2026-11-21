import type { Camera, Scene, Texture } from 'three'
import type { SceneNode, ScenePicture, Vec3 } from '../editor/scene/types'
import type { GameDatabase } from '../gameplay/types'

export type RuntimeLogLevel = 'info' | 'warn' | 'error'

export interface RuntimeRenderContext {
  renderer: unknown
  scene: Scene
  camera: Camera
  dt: number
}

export interface RuntimeSimulationPose {
  id: string
  position: [number, number, number]
  rotation: [number, number, number, number]
}

export interface RuntimeAssetSummary {
  id: string
  name: string
  kind: string
  url?: string
  clipCatalog?: Array<{ name: string; duration: number }>
  simulation?: unknown
  materialAssetId?: string | null
  quarksVersion?: string
}

export interface RuntimeTagDef {
  id: string
  name: string
  layer?: number
  mask?: number
  collidesWith?: string[]
}

export interface RuntimeWorld {
  getNodes(): Record<string, SceneNode>
  setNodes(nodes: Record<string, SceneNode>): void
  updateNode(id: string, patch: Partial<SceneNode>): void
  getActiveSceneId(): string
  getPicture(): ScenePicture
  getCapabilities(): Record<string, boolean>
  getGameplayPacks(): string[]
  getGameDatabase(): GameDatabase
  getTags(): readonly RuntimeTagDef[]
  getAsset(id: string): RuntimeAssetSummary | undefined
  listAssets(): readonly RuntimeAssetSummary[]
  getPlayState(): 'stopped' | 'playing' | 'paused'
  markPlayDirty(): void
  log(level: RuntimeLogLevel, message: string): void

  getSelection?(): readonly string[]
  applySimulation?(poses: RuntimeSimulationPose[]): void
  collisionGroupsForLayer?(renderLayerId: string | undefined): number | undefined
  resolveTexture?(assetId: string): Promise<Texture | null>
  getTexture?(assetId: string, srgb?: boolean): Texture | null
  resolveParticleDesc?(materialId: string | null | undefined): unknown
  registerBeforeRenderHook?(id: string, order: number, hook: (ctx: RuntimeRenderContext) => void): () => void
  resolveAssetUrl?(assetId: string): Promise<string | null>
  clipDuration?(assetId: string | null | undefined, clipName: string): number
  playBody?(nodeId: string, clipName: string, options?: { assetId?: string | null; loop?: boolean; fade?: number; speed?: number }): void
  playUpper?(nodeId: string, clipName: string, options?: { assetId?: string | null; loop?: boolean; fade?: number; speed?: number }): void
  stopUpper?(nodeId: string, fade?: number): void
  bodyProgress?(nodeId: string): number
  forcePlayCamera?(cameraId: string, duration?: number): void
  clearPlayCameraForce?(): void
  instantiatePrefab?(prefabIdOrName: string, options?: { parentId?: string | null; position?: Vec3 }): boolean
  translate?(key: string, vars?: Record<string, string | number>): string
}

const EMPTY_DATABASE: GameDatabase = { tables: {} }
const EMPTY_PICTURE = {} as ScenePicture

const FALLBACK_WORLD: RuntimeWorld = {
  getNodes: () => ({}),
  setNodes: () => {},
  updateNode: () => {},
  getActiveSceneId: () => '',
  getPicture: () => EMPTY_PICTURE,
  getCapabilities: () => ({}),
  getGameplayPacks: () => ['core'],
  getGameDatabase: () => EMPTY_DATABASE,
  getTags: () => [],
  getAsset: () => undefined,
  listAssets: () => [],
  getPlayState: () => 'stopped',
  markPlayDirty: () => {},
  log: (level, message) => {
    if (level === 'error') console.error('[T3D]', message)
    else if (level === 'warn') console.warn('[T3D]', message)
    else console.info('[T3D]', message)
  },
}

let activeWorld: RuntimeWorld = FALLBACK_WORLD

export function setRuntimeWorld(world: RuntimeWorld): void {
  activeWorld = world
}

export function getRuntimeWorld(): RuntimeWorld {
  return activeWorld
}
