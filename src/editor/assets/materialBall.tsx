import { useMemo } from 'react'
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
import { useAssetStore } from './library'
import { normalizeSlot, applySlot } from './materials'
import { textureFor, unityMetallicRoughnessTextureFor } from './textures'
import type { PbrSlot } from '../scene/types'
import './materialBall.css'

const SIZE = 128
const cache = new Map<string, string>()

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

function mapToken(id: string | null | undefined, colorMap: boolean, unity = false): string {
  if (!id) return ''
  const texture: Texture | null = unity ? unityMetallicRoughnessTextureFor(id) : textureFor(id, colorMap)
  if (!texture) return `${id}:0`
  const image = texture.image as { width?: number } | undefined
  return `${texture.uuid}:${image?.width ?? 0}`
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
    mapToken(surface.mapAssetId, true),
    mapToken(surface.normalAssetId, false),
    mapToken(surface.metallicRoughnessAssetId, false, unity),
    mapToken(surface.emissiveAssetId, true),
    mapToken(surface.aoAssetId, false),
  ])
}

export function renderMaterialBall(slot: PbrSlot): string {
  const key = signature(slot)
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
    if (cache.size > 96) {
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
    return url
  } catch {
    return ''
  }
}

export function MaterialBall({ slot, size = 'sm' }: { slot: PbrSlot, size?: 'sm' | 'md' | 'lg' }) {
  const revision = useAssetStore(state => state.revision)
  const url = useMemo(() => renderMaterialBall(slot), [slot, revision])
  const className = size === 'sm' ? 'material-ball' : `material-ball material-ball--${size}`
  if (!url) return <i className={`${className} material-ball--flat`} style={{ background: slot.color }} />
  return <img className={className} src={url} alt="" />
}
