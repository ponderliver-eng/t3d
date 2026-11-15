import type { Object3D } from 'three'
import { capabilityEnabled } from '../registry'
import { useAssetStore } from '../../editor/assets/library'
import { particleDescFor } from '../../editor/assets/materials'
import { useEditorStore } from '../../editor/scene/store'
import { asSimulation } from './readQuarks'
import type { ParticleInstanceDesc, ParticleRuntime } from './runtime'

let runtime: ParticleRuntime | null = null
let loading: Promise<void> | null = null
let scene: Object3D | null = null
let generation = 0

export function mountParticles(root: Object3D) {
  scene = root
}

export function tickParticles(dt: number, parentOf: (id: string) => Object3D | null) {
  const state = useEditorStore.getState()
  if (!capabilityEnabled(state.capabilities, 'particles') || !scene) {
    disposeParticles()
    return
  }
  if (!runtime) {
    ensureRuntime()
    return
  }
  const instances: ParticleInstanceDesc[] = []
  for (const node of Object.values(state.nodes)) {
    if (node.kind !== 'effect' || !node.effect) continue
    const parent = parentOf(node.id)
    if (!parent) continue
    const resolved = resolveInstance(node.id, node.effect, node.visible, parent)
    if (resolved) instances.push(resolved)
  }
  runtime.sync(instances)
  runtime.update(dt)
}

export function particleIssue(id: string): string | null {
  return runtime?.issue(id) ?? null
}

export function disposeParticles() {
  generation += 1
  runtime?.dispose()
  runtime = null
  loading = null
}

function ensureRuntime() {
  if (loading || !scene) return
  const token = generation
  const root = scene
  loading = import('./quarksRuntime').then(module => {
    if (token !== generation) return
    runtime = module.createQuarksRuntime(root)
  }).catch(error => {
    console.warn('[particles] three.quarks 加载失败', error)
  }).finally(() => {
    if (token === generation) loading = null
  })
}

function resolveInstance(id: string, effect: NonNullable<import('../../editor/scene/types').SceneNode['effect']>, visible: boolean, parent: Object3D): ParticleInstanceDesc | null {
  const assets = useAssetStore.getState().assets
  let simulation = effect.simulation
  let materialId = effect.materialAssetId
  if (effect.assetId) {
    const asset = assets[effect.assetId]
    if (!asset || asset.kind !== 'effect') return null
    simulation = asset.simulation
    materialId = effect.materialAssetId ?? asset.materialAssetId
  }
  const stored = asSimulation(simulation)
  if (!stored) return null
  const material = particleDescFor(materialId)
  if (material === 'incompatible') return null
  return {
    id,
    parent,
    simulation: stored,
    material,
    playing: effect.playing,
    visible,
  }
}

export function effectVersion(effect: { assetId: string | null, quarksVersion: string }): string {
  if (!effect.assetId) return effect.quarksVersion
  const asset = useAssetStore.getState().assets[effect.assetId]
  if (!asset || asset.kind !== 'effect') return effect.quarksVersion
  return asset.quarksVersion
}
