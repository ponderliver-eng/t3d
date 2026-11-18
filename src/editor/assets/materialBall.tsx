import { useEffect, useState } from 'react'
import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { readAllMaterialThumbs, writeMaterialThumb } from './cache'
import { useAssetStore } from './library'
import { normalizeSlot, applySlot } from './materials'
import { warmProgress } from './project'
import { textureFor, unityMetallicRoughnessTextureFor } from './textures'
import type { PbrSlot } from '../scene/types'
import './materialBall.css'

const SIZE = 128
const cache = new Map<string, string>()
let hydrated = false

function ensureHydrated() {
  if (hydrated) return
  hydrated = true
  void readAllMaterialThumbs().then(rows => {
    let added = false
    for (const row of rows) {
      if (row.key && row.url && !cache.has(row.key)) {
        cache.set(row.key, row.url)
        added = true
      }
    }
    if (added) listeners.forEach(listener => listener())
  })
}

let renderer: WebGLRenderer | null = null
let scene: Scene | null = null
let camera: PerspectiveCamera | null = null
let mesh: Mesh | null = null

function stage(): { renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, mesh: Mesh } | null {
  if (renderer && scene && camera && mesh) return { renderer, scene, camera, mesh }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const nextRenderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
    nextRenderer.setSize(SIZE, SIZE, false)
    nextRenderer.setClearColor(0x000000, 0)
    nextRenderer.outputColorSpace = SRGBColorSpace
    nextRenderer.toneMapping = ACESFilmicToneMapping
    nextRenderer.toneMappingExposure = 1.05
    const nextScene = new Scene()
    const pmrem = new PMREMGenerator(nextRenderer)
    nextScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    const nextCamera = new PerspectiveCamera(32, 1, 0.05, 20)
    nextCamera.position.set(1.55, 0.98, 1.75)
    nextCamera.lookAt(0, 0, 0)
    const ambient = new AmbientLight(0xffffff, 0.22)
    const key = new DirectionalLight(0xffffff, 0.85)
    key.position.set(2.4, 3.2, 2)
    const fill = new DirectionalLight(0xb7c6dc, 0.28)
    fill.position.set(-2.6, 1.2, -1.4)
    nextScene.add(ambient, key, fill)
    const geometry = new SphereGeometry(0.72, 48, 32)
    geometry.setAttribute('uv2', geometry.attributes.uv)
    const nextMesh = new Mesh(geometry, new MeshStandardMaterial())
    nextScene.add(nextMesh)
    renderer = nextRenderer
    scene = nextScene
    camera = nextCamera
    mesh = nextMesh
    return { renderer: nextRenderer, scene: nextScene, camera: nextCamera, mesh: nextMesh }
  } catch {
    return null
  }
}

function stableMapToken(id: string | null | undefined, unity = false): string {
  if (!id) return ''
  const asset = useAssetStore.getState().assets[id]
  const hash = asset && 'hash' in asset ? asset.hash : ''
  return `${id}:${hash}:${unity ? 'u' : 's'}`
}

function signature(slot: PbrSlot): string {
  const surface = normalizeSlot(slot)
  const unity = surface.shader === 'unity-standard'
  return JSON.stringify([
    surface.shader,
    surface.color,
    surface.metalness,
    surface.roughness,
    surface.emissive,
    surface.emissiveIntensity,
    surface.opacity,
    surface.ao,
    surface.normalScale,
    surface.alphaMode,
    surface.alphaCutoff,
    surface.wireframe,
    surface.particleBlend ?? '',
    stableMapToken(surface.mapAssetId),
    stableMapToken(surface.normalAssetId),
    stableMapToken(surface.metallicRoughnessAssetId, unity),
    stableMapToken(surface.emissiveAssetId),
    stableMapToken(surface.aoAssetId ?? (unity ? surface.metallicRoughnessAssetId : null), unity && !surface.aoAssetId),
  ])
}

function ensureSlotTexturesReady(slot: PbrSlot): boolean {
  const surface = normalizeSlot(slot)
  const unity = surface.shader === 'unity-standard'
  const assets = useAssetStore.getState().assets
  const check = (id: string | null | undefined, colorMap: boolean, useUnityMr = false): boolean => {
    if (!id) return true
    const asset = assets[id]
    if (!asset || asset.kind !== 'texture') return true
    const tex: Texture | null = useUnityMr ? unityMetallicRoughnessTextureFor(id) : textureFor(id, colorMap)
    return tex !== null
  }
  const r1 = check(surface.mapAssetId, true)
  const r2 = check(surface.normalAssetId, false)
  const r3 = check(surface.metallicRoughnessAssetId, false, unity)
  const r4 = check(surface.emissiveAssetId, true)
  const r5 = check(surface.aoAssetId ?? (unity ? surface.metallicRoughnessAssetId : null), false, unity && !surface.aoAssetId)
  return r1 && r2 && r3 && r4 && r5
}

const pendingQueue = new Map<string, PbrSlot>()
const listeners = new Set<() => void>()
let pumpTimer = 0
let pumpRaf = 0

function schedulePump() {
  if (pumpTimer || pumpRaf) return
  if (warmProgress()) {
    pumpTimer = window.setTimeout(() => {
      pumpTimer = 0
      schedulePump()
    }, 100)
    return
  }
  pumpRaf = requestAnimationFrame(pumpQueue)
}

function pumpQueue() {
  pumpRaf = 0
  if (warmProgress()) {
    schedulePump()
    return
  }
  const started = performance.now()
  let count = 0
  for (const [key, slot] of [...pendingQueue.entries()]) {
    if (cache.has(key)) {
      pendingQueue.delete(key)
      continue
    }
    if (!ensureSlotTexturesReady(slot)) {
      // 贴图尚在后台加载中，等贴图触发 bump 后再绘制，避免画半成品
      continue
    }
    pendingQueue.delete(key)
    renderMaterialBallNow(key, slot)
    count += 1
    if (count >= 1 || performance.now() - started >= 3) break
  }
  if (count > 0) listeners.forEach(listener => listener())
  const hasReady = [...pendingQueue.values()].some(slot => ensureSlotTexturesReady(slot))
  if (hasReady) schedulePump()
}

function renderMaterialBallNow(key: string, slot: PbrSlot): string {
  const cached = cache.get(key)
  if (cached) return cached
  const view = stage()
  if (!view) return ''
  try {
    const next = applySlot(view.mesh.material as Material, slot)
    if (next !== view.mesh.material) {
      ;(view.mesh.material as Material).dispose()
      view.mesh.material = next
    }
    view.renderer.render(view.scene, view.camera)
    const url = view.renderer.domElement.toDataURL('image/png')
    cache.set(key, url)
    writeMaterialThumb(key, url)
    if (cache.size > 256) {
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
    return url
  } catch {
    return ''
  }
}

export function renderMaterialBall(slot: PbrSlot): string {
  ensureHydrated()
  return renderMaterialBallNow(signature(slot), slot)
}

export function MaterialBall({ slot, size = 'sm' }: { slot: PbrSlot, size?: 'sm' | 'md' | 'lg' }) {
  ensureHydrated()
  const revision = useAssetStore(state => state.revision)
  const key = signature(slot)
  const hit = cache.get(key) ?? ''
  const [fallback, setFallback] = useState('')
  const [, setTick] = useState(0)

  useEffect(() => {
    const onDone = () => setTick(value => value + 1)
    listeners.add(onDone)
    return () => { listeners.delete(onDone) }
  }, [])

  useEffect(() => {
    if (hit) {
      setFallback(hit)
      return
    }
    pendingQueue.set(key, slot)
    schedulePump()
  }, [key, hit, slot, revision])

  const url = hit || fallback
  const className = size === 'sm' ? 'material-ball' : `material-ball material-ball--${size}`
  if (!url) return <i className={`${className} material-ball--flat`} style={{ background: slot.color }} />
  return <img className={className} src={url} alt="" />
}
