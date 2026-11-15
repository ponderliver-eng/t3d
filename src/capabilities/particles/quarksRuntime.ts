import {
  DoubleSide,
  MeshBasicMaterial,
  type Object3D,
  type Side,
} from 'three'
import {
  ParticleSystem,
  QuarksLoader,
  QuarksUtil,
} from 'three.quarks'
import type { ParticleInstanceDesc, ParticleMaterialDesc, ParticleRuntime, StoredSimulation } from './runtime'
import { surfaceBlending, TslBatchedRenderer } from './tslBatch'

interface LiveEffect {
  id: string
  root: Object3D
  key: string
  playing: boolean
}

export function createQuarksRuntime(scene: Object3D): ParticleRuntime {
  const batch = new TslBatchedRenderer()
  batch.name = 'particles'
  scene.add(batch)
  const lives = new Map<string, LiveEffect>()
  const issues = new Map<string, string>()

  return {
    sync(instances) {
      const seen = new Set<string>()
      for (const instance of instances) {
        seen.add(instance.id)
        const key = instanceKey(instance)
        let live = lives.get(instance.id)
        if (!live || live.key !== key) {
          detach(live)
          const spawned = spawn(instance, batch, issues)
          if (!spawned) {
            lives.delete(instance.id)
            continue
          }
          live = spawned
          lives.set(instance.id, live)
        } else {
          issues.delete(instance.id)
        }
        if (live.root.parent !== instance.parent) instance.parent.add(live.root)
        setEmitterVisible(live.root, instance.visible)
        if (live.playing !== instance.playing) {
          if (instance.playing) QuarksUtil.play(live.root)
          else QuarksUtil.pause(live.root)
          live.playing = instance.playing
        }
      }
      for (const [id, live] of lives) {
        if (seen.has(id)) continue
        detach(live)
        lives.delete(id)
        issues.delete(id)
      }
    },
    update(dt) {
      batch.update(dt)
    },
    dispose() {
      for (const live of lives.values()) detach(live)
      lives.clear()
      issues.clear()
      batch.removeFromParent()
    },
    issue(id) {
      return issues.get(id) ?? null
    },
  }
}

function spawn(instance: ParticleInstanceDesc, batch: TslBatchedRenderer, issues: Map<string, string>): LiveEffect | null {
  try {
    const root = instance.simulation.format === 'loader'
      ? spawnLoader(instance, batch)
      : spawnSystem(instance, batch)
    if (!instance.playing) QuarksUtil.pause(root)
    issues.delete(instance.id)
    return { id: instance.id, root, key: instanceKey(instance), playing: instance.playing }
  } catch (error) {
    issues.set(instance.id, error instanceof Error ? error.message : String(error))
    return null
  }
}

function spawnSystem(instance: ParticleInstanceDesc, batch: TslBatchedRenderer) {
  const body = instance.simulation.body as Parameters<typeof ParticleSystem.fromJSON>[0]
  const system = ParticleSystem.fromJSON(body, { geometries: {}, materials: {}, textures: {}, images: {} } as never, {})
  system.material = makeMaterial(instance.material)
  system.emitter.position.set(0, 0, 0)
  batch.addSystem(system)
  return system.emitter
}

function spawnLoader(instance: ParticleInstanceDesc, batch: TslBatchedRenderer) {
  const root = new QuarksLoader().parse(instance.simulation.body)
  QuarksUtil.runOnAllParticleEmitters(root, emitter => {
    const system = emitter.system as ParticleSystem
    if (instance.material) system.material = makeMaterial(instance.material)
    batch.addSystem(system)
  })
  return root
}

function makeMaterial(desc: ParticleMaterialDesc | null) {
  const appearance = desc ?? {
    color: '#ffffff',
    opacity: 1,
    map: null,
    blend: 'additive' as const,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide as Side,
  }
  const blend = surfaceBlending(appearance.blend)
  const material = new MeshBasicMaterial({
    color: appearance.color,
    map: appearance.map,
    transparent: true,
    opacity: appearance.opacity,
    depthWrite: appearance.depthWrite,
    depthTest: appearance.depthTest,
    side: appearance.side,
    blending: blend.blending,
    premultipliedAlpha: blend.premultipliedAlpha,
  })
  if (blend.blendSrc) material.blendSrc = blend.blendSrc
  if (blend.blendDst) material.blendDst = blend.blendDst
  return material
}

function detach(live: LiveEffect | undefined) {
  if (!live) return
  QuarksUtil.runOnAllParticleEmitters(live.root, emitter => {
    const system = emitter.system as ParticleSystem
    system._renderer?.deleteSystem(system)
    system.dispose()
  })
  live.root.removeFromParent()
}

function setEmitterVisible(root: Object3D, visible: boolean) {
  root.visible = visible
  QuarksUtil.runOnAllParticleEmitters(root, emitter => {
    emitter.visible = visible
  })
}

function instanceKey(instance: ParticleInstanceDesc) {
  const material = instance.material
  return JSON.stringify({
    simulation: instance.simulation,
    playingShape: material && {
      color: material.color,
      opacity: material.opacity,
      blend: material.blend,
      depthWrite: material.depthWrite,
      depthTest: material.depthTest,
      side: material.side,
      map: material.map?.uuid ?? '',
    },
  })
}

export function simulationOf(value: unknown): StoredSimulation | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { format?: unknown, body?: unknown }
  if ((record.format === 'system' || record.format === 'loader') && record.body && typeof record.body === 'object') {
    return { format: record.format, body: record.body }
  }
  return null
}
