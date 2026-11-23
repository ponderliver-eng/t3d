import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  SpotLight,
  Vector3,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { syncCapabilityRuntimes } from '../capabilities/registry'
import { compileAndRegisterScript } from '../core/codeAssets/scriptRuntime'
import {
  bindGlobalInputListeners,
  injectVirtualInput,
  normalizeInputMap,
  setInputActionMap,
} from '../core/input/actionMap'
import type { SceneNode, ScenePicture, Vec3 } from '../editor/scene/types'
import type { GameDatabase } from '../gameplay/types'
import { attachAudioListener } from '../runtime/audio'
import '../runtime/camera'
import '../runtime/character'
import '../runtime/locomotion'
import '../runtime/devices'
import '../runtime/rules'
import { stepSceneRuntime, type SceneRuntimeHost } from '../runtime/sceneRuntime'
import '../runtime/soundSource'
import { setRuntimeWorld, type RuntimeAssetSummary, type RuntimeRenderContext, type RuntimeWorld } from '../runtime/world'

interface ExportedProjectPayload {
  version?: number
  name?: string
  activeSceneId?: string
  nodes: Record<string, SceneNode>
  picture?: ScenePicture
  capabilities?: Record<string, boolean>
  gameplayPacks?: string[]
  gameDatabase?: GameDatabase
  assets?: Record<string, RuntimeAssetSummary>
  scripts?: Array<{ id: string; relativePath: string; source: string }>
  shaders?: Array<{ id: string; relativePath: string; source: string }>
  inputMap?: unknown
}

const DEG_TO_RAD = Math.PI / 180

function createGeometryForNode(node: SceneNode) {
  if (node.kind === 'box') return new BoxGeometry(1, 1, 1)
  if (node.kind === 'sphere') return new SphereGeometry(0.5, 24, 16)
  if (node.kind === 'cylinder') return new CylinderGeometry(0.5, 0.5, 1, 24)
  if (node.kind === 'capsule') return new CapsuleGeometry(0.35, 0.7, 8, 16)
  if (node.kind === 'plane') {
    const geo = new PlaneGeometry(10, 10)
    geo.rotateX(-Math.PI / 2)
    return geo
  }
  return null
}

function buildStandaloneWorld(payload: ExportedProjectPayload) {
  let nodes: Record<string, SceneNode> = structuredClone(payload.nodes ?? {})
  const picture = (payload.picture ?? {}) as ScenePicture
  const capabilities = payload.capabilities ?? {}
  const gameplayPacks = payload.gameplayPacks ?? ['core']
  const gameDatabase = payload.gameDatabase ?? { tables: {} }
  const assets = payload.assets ?? {}
  const activeSceneId = payload.activeSceneId ?? 'default'
  const beforeRenderHooks: Array<{ id: string; order: number; hook: (ctx: RuntimeRenderContext) => void }> = []

  const world: RuntimeWorld = {
    getNodes: () => nodes,
    setNodes: (next) => {
      nodes = next
    },
    updateNode: (id, patch) => {
      const current = nodes[id]
      if (!current) return
      nodes = { ...nodes, [id]: { ...current, ...patch } }
    },
    getActiveSceneId: () => activeSceneId,
    getPicture: () => picture,
    getCapabilities: () => capabilities,
    getGameplayPacks: () => gameplayPacks,
    getGameDatabase: () => gameDatabase,
    getTags: () => [],
    getAsset: (id) => assets[id],
    listAssets: () => Object.values(assets),
    getPlayState: () => 'playing',
    markPlayDirty: () => {},
    log: (level, message) => {
      if (level === 'error') console.error('[T3D Player]', message)
      else if (level === 'warn') console.warn('[T3D Player]', message)
      else console.info('[T3D Player]', message)
    },
    registerBeforeRenderHook: (id, order, hook) => {
      const entry = { id, order, hook }
      beforeRenderHooks.push(entry)
      beforeRenderHooks.sort((a, b) => a.order - b.order)
      return () => {
        const idx = beforeRenderHooks.indexOf(entry)
        if (idx >= 0) beforeRenderHooks.splice(idx, 1)
      }
    },
  }

  return { world, beforeRenderHooks }
}

function mountSceneObjects(scene: Scene, nodes: Record<string, SceneNode>): Map<string, Group> {
  const map = new Map<string, Group>()
  const root = new Group()
  scene.add(root)

  for (const node of Object.values(nodes)) {
    const group = new Group()
    group.name = node.name
    group.visible = node.visible !== false
    group.position.set(node.position[0], node.position[1], node.position[2])
    group.rotation.set(
      node.rotation[0] * DEG_TO_RAD,
      node.rotation[1] * DEG_TO_RAD,
      node.rotation[2] * DEG_TO_RAD,
      'XYZ',
    )
    group.scale.set(node.scale[0], node.scale[1], node.scale[2])

    const geo = createGeometryForNode(node)
    if (geo) {
      const mat = new MeshStandardMaterial({ color: node.color || '#8c96a4', roughness: 0.7, metalness: 0.1 })
      const mesh = new Mesh(geo, mat)
      mesh.castShadow = Boolean(node.castShadow)
      mesh.receiveShadow = node.receiveShadow !== false
      group.add(mesh)
    } else if (node.kind === 'directional-light') {
      const light = new DirectionalLight(node.color || '#ffffff', node.intensity ?? 2)
      light.castShadow = Boolean(node.castShadow)
      group.add(light)
    } else if (node.kind === 'point-light') {
      const light = new PointLight(node.color || '#ffffff', node.intensity ?? 2, node.range ?? 15)
      group.add(light)
    } else if (node.kind === 'spot-light') {
      const light = new SpotLight(node.color || '#ffffff', node.intensity ?? 2, node.range ?? 15)
      group.add(light)
    } else if (node.kind === 'hemisphere-light') {
      const light = new HemisphereLight(node.color || '#dbeafe', '#334155', node.intensity ?? 1)
      group.add(light)
    }

    map.set(node.id, group)
  }

  for (const node of Object.values(nodes)) {
    const obj = map.get(node.id)
    if (!obj) continue
    const parent = node.parentId ? map.get(node.parentId) : undefined
    ;(parent ?? root).add(obj)
  }

  // 保底基础环境光，避免无灯光场景全黑
  const hasAnyLight = Object.values(nodes).some((n) => n.kind.endsWith('-light'))
  if (!hasAnyLight) {
    scene.add(new AmbientLight('#ffffff', 0.65))
    const key = new DirectionalLight('#ffffff', 1.6)
    key.position.set(6, 12, 8)
    scene.add(key)
  }

  return map
}

function attachTouchOverlay(container: HTMLElement) {
  if (!('ontouchstart' in window) && navigator.maxTouchPoints <= 0) return
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:20;'
  const jumpBtn = document.createElement('button')
  jumpBtn.textContent = '跳跃'
  jumpBtn.style.cssText =
    'position:absolute;right:24px;bottom:28px;width:64px;height:64px;border-radius:999px;border:1px solid rgba(255,255,255,0.28);background:rgba(15,23,42,0.55);color:#fff;font-size:13px;pointer-events:auto;'
  jumpBtn.addEventListener('pointerdown', () => injectVirtualInput({ type: 'actionDown', action: 'Jump' }))
  jumpBtn.addEventListener('pointerup', () => injectVirtualInput({ type: 'actionUp', action: 'Jump' }))
  jumpBtn.addEventListener('pointercancel', () => injectVirtualInput({ type: 'actionUp', action: 'Jump' }))
  overlay.appendChild(jumpBtn)
  container.appendChild(overlay)
}

async function createRenderer(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
  try {
    const webgpu = new WebGPURenderer({ canvas, antialias: true })
    await webgpu.init()
    return webgpu
  } catch {
    const webgl = new WebGPURenderer({ canvas, antialias: true, forceWebGL: true })
    await webgl.init()
    return webgl
  }
}

async function boot() {
  const rootEl = document.getElementById('player-root') ?? document.body
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;width:100vw;height:100vh;'
  rootEl.appendChild(canvas)

  const params = new URLSearchParams(window.location.search)
  const projectUrl = params.get('project') || './project.t3d.json'
  const response = await fetch(projectUrl)
  if (!response.ok) throw new Error(`无法加载工程数据: ${projectUrl}`)
  const payload = (await response.json()) as ExportedProjectPayload

  if (payload.inputMap) {
    setInputActionMap(normalizeInputMap(payload.inputMap))
  }
  bindGlobalInputListeners()
  attachTouchOverlay(rootEl)

  const { world, beforeRenderHooks } = buildStandaloneWorld(payload)
  setRuntimeWorld(world)
  syncCapabilityRuntimes(world.getCapabilities())
  for (const script of payload.scripts ?? []) {
    compileAndRegisterScript(script.id, script.relativePath, script.source)
  }

  const renderer = await createRenderer(canvas)
  const scene = new Scene()
  scene.background = new Color(payload.picture?.background || '#181d26')
  const camera = new PerspectiveCamera(55, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1000)
  camera.position.set(0, 4, 8)
  camera.lookAt(0, 1, 0)
  attachAudioListener(camera)

  const objects = mountSceneObjects(scene, world.getNodes())

  const resize = () => {
    const w = window.innerWidth
    const h = Math.max(1, window.innerHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  const viewForward = new Vector3()
  const host: SceneRuntimeHost = {
    ready: true,
    resolveObject: (id) => objects.get(id) ?? null,
    updateAnimations: () => {},
    // 不能直接读 camera.rotation.y：欧拉角在有俯仰时会偏，镜头转过 90° 后还会整个翻面
    yaw: () => {
      camera.getWorldDirection(viewForward)
      if (viewForward.x * viewForward.x + viewForward.z * viewForward.z < 1e-6) return camera.rotation.y
      return Math.atan2(-viewForward.x, -viewForward.z)
    },
    pitch: () => camera.rotation.x,
    poseCamera: (position: Vec3, lookAt: Vec3, fov: number) => {
      camera.position.set(position[0], position[1], position[2])
      camera.lookAt(new Vector3(lookAt[0], lookAt[1], lookAt[2]))
      if (fov > 0 && camera.fov !== fov) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
    },
  }

  let lastTime = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000))
    lastTime = now
    stepSceneRuntime(dt, host)
    for (const item of beforeRenderHooks) {
      item.hook({ renderer, scene, camera, dt })
    }
    renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

void boot().catch((err) => {
  console.error('[T3D Player] 启动失败:', err)
})
