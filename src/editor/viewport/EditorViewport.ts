import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
  AmbientLight,
  Box3,
  BoxGeometry,
  BoxHelper,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Fog,
  LoopOnce,
  LoopRepeat,
  AnimationMixer,
  type AnimationAction,
  type BufferGeometry,
  type Light,
  type Material,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { translate } from '../i18n'
import { applyModelMaterials, applyNodeMaterial } from '../assets/materials'
import { clipDuration, getModelTemplate, instantiateModel, modelRevision } from '../assets/models'
import { clipsForSkeleton, humanoidBindingKey } from '../animation/humanoidPlayback'
import { activeAnimatorState, stepAnimator } from '../animation/animator'
import { lockClipInPlace, maskClip } from '../animation/playback'
import { useAssetStore } from '../assets/library'
import { bindTextureRenderer, environmentFor } from '../assets/textures'
import { EDITOR_HELPER_LAYER, layerBitIndex } from '../project/taxonomy'
import { capabilityEnabled } from '../../capabilities/registry'
import { tickPhysics } from '../../capabilities/physics/session'
import { disposeParticles, mountParticles, tickParticles } from '../../capabilities/particles/session'
import { collectNavSurfaces } from '../../capabilities/navigation/collect'
import { syncNavDebug } from '../../capabilities/navigation/debug'
import { consumeNavBake, navDebugGeometry, tickNavigation } from '../../capabilities/navigation/session'
import { boundsOf, refreshObjectBounds } from '../scene/bounds'
import { isLight, isMesh } from '../scene/kinds'
import { setSpawnProvider } from '../scene/spawn'
import { setEditorViewBridge, setGroundSnapper, setViewportAlign } from '../scene/viewportBridge'
import { useEditorStore } from '../scene/store'
import { localPoseFromWorld, poseComponents, worldPose } from '../scene/transform'
import type { SceneNode, ToneMap } from '../scene/types'
import { EditorCameraRig } from './cameraControls'
import { resolvePlayCamera } from './playCamera'
import { viewCubePose } from './viewCubeBridge'
import { createEditorGrid, gridStepForDistance } from './editorGrid'
import { createSceneGuide, type SceneGuide } from './lightCameraGizmo'
import { ScenePicturePipeline } from './picture'
import { createVolumeLight } from './volumeLight'

const DEG = Math.PI / 180

interface ViewData {
  nodeId: string
  pick?: Object3D
  material?: Material
  light?: Light
  guide?: SceneGuide
  sceneCamera?: PerspectiveCamera
  modelRoot?: Object3D
  modelKey?: string
  mixer?: AnimationMixer
  actions?: Map<string, AnimationAction>
  activeClip?: string
  activeOverlay?: string
  animatorState?: string
  animatorTime?: number
  pendingFade?: number
  bodyBlend?: ActionBlend
  overlayBlend?: ActionBlend
}

interface ActionBlend {
  from?: AnimationAction
  to: AnimationAction
  start: number
  duration: number
  loop: boolean
  speed: number
}

interface Baseline {
  id: string
  localPos: Vector3
  localQuat: Quaternion
  localScale: Vector3
  worldPos: Vector3
  worldQuat: Quaternion
}

interface Press {
  x: number
  y: number
  additive: boolean
}

export class EditorViewport {
  private readonly renderer: WebGPURenderer
  private readonly scene = new Scene()
  private readonly world = new Group()
  private readonly rig = new EditorCameraRig()
  private readonly transform: TransformControls
  private readonly gizmo: Object3D
  private readonly grid: Mesh
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private readonly objects = new Map<string, Group>()
  private readonly pickables: Object3D[] = []
  private readonly proxy = new Group()
  private selectionHelpers: BoxHelper[] = []
  private selectionKey = ''
  private attachKey = ''
  private cameraNonce = 0
  private driving = false
  private proxyAttached = false
  private singleId: string | null = null
  private baselines: Baseline[] = []
  private readonly proxyStart = new Vector3()
  private readonly proxyQuat = new Quaternion()
  private readonly proxyScale = new Vector3(1, 1, 1)
  private readonly cubeQuat = new Quaternion()
  private press: Press | null = null
  private marquee: HTMLDivElement | null = null
  private centerAttached = false
  private width = 0
  private height = 0
  private last = 0
  private clipWrite = 0
  private applyingAnimator = false
  private fpsFrames = 0
  private fpsAccum = 0
  private raf = 0
  private disposed = false
  private ready = false
  private picture: ScenePicturePipeline | null = null
  private readonly volume = createVolumeLight()
  private volumeMuted = false
  private readonly navDebug = new Group()
  private frameCamera: EditorCameraRig['active'] | null = null
  private playCameraWarned = ''
  private appliedViewNonce = 0
  private readonly unsubscribe: () => void
  private readonly unsubscribeAssets: () => void
  private readonly resizeObserver: ResizeObserver

  constructor(private readonly canvas: HTMLCanvasElement, private readonly stage: HTMLElement) {
    this.frameCamera = this.rig.persp
    this.renderer = new WebGPURenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    this.scene.background = new Color(0x141414)
    this.rig.persp.layers.enable(EDITOR_HELPER_LAYER)
    this.rig.ortho.layers.enable(EDITOR_HELPER_LAYER)
    this.raycaster.layers.enable(EDITOR_HELPER_LAYER)

    const root = new Group()
    this.scene.add(root)
    this.scene.add(this.volume.mesh)
    this.navDebug.name = 'nav-debug'
    this.scene.add(this.navDebug)
    root.add(this.world)
    mountParticles(this.scene)
    const ambient = new AmbientLight(0xffffff, 0.28)
    ambient.layers.enableAll()
    root.add(ambient)

    this.grid = createEditorGrid()
    root.add(this.grid)

    this.proxy.name = 'gizmo-proxy'
    root.add(this.proxy)

    this.transform = new TransformControls(this.rig.active, canvas)
    this.transform.size = 0.85
    this.gizmo = this.transform.getHelper()
    root.add(this.gizmo)
    this.gizmo.traverse(child => {
      child.castShadow = false
      child.receiveShadow = false
    })
    this.transform.addEventListener('mouseDown', this.onGizmoDown)
    this.transform.addEventListener('objectChange', this.onGizmoChange)
    this.transform.addEventListener('mouseUp', this.onGizmoUp)

    this.rig.onViewLabel = label => {
      queueMicrotask(() => useEditorStore.getState().setProjectionLabel(label))
    }
    this.rig.onActiveCamera = () => {
      this.transform.camera = this.rig.active
    }

    setSpawnProvider(() => {
      const direction = new Vector3()
      this.rig.active.getWorldDirection(direction)
      direction.y = 0
      if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1)
      direction.normalize()
      const point = this.rig.active.position.clone().addScaledVector(direction, 6)
      return [point.x, 0, point.z]
    })
    setGroundSnapper(ids => this.measureSnap(ids))
    setViewportAlign({
      read: () => this.rig.capture(),
      place: (position, quaternion) => {
        this.rig.lookThrough(
          new Vector3(position[0], position[1], position[2]),
          new Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]),
        )
      },
    })
    setEditorViewBridge({
      read: () => this.rig.snapshot(),
      apply: view => this.rig.restore(view),
    })

    this.canvas.addEventListener('pointerdown', this.onPointerDown, true)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('contextmenu', this.onContext)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(stage)
    this.resize()
    this.unsubscribe = useEditorStore.subscribe(() => this.onStore())
    this.unsubscribeAssets = useAssetStore.subscribe(() => this.onStore())
    this.onStore()
    void this.boot()
    this.raf = requestAnimationFrame(this.tick)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.unsubscribe()
    this.unsubscribeAssets()
    this.resizeObserver.disconnect()
    setSpawnProvider(() => [0, 0, 0])
    setGroundSnapper(null)
    setViewportAlign(null)
    setEditorViewBridge(null)
    this.marquee?.remove()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown, true)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('contextmenu', this.onContext)
    disposeParticles()
    this.volume.dispose()
    this.picture?.dispose()
    this.transform.dispose()
    this.rig.dispose()
    this.clearHelpers()
    for (const group of this.objects.values()) disposeObject(group)
    this.objects.clear()
    this.grid.geometry.dispose()
    const gridMaterial = this.grid.material as Material | Material[]
    if (Array.isArray(gridMaterial)) gridMaterial.forEach(item => item.dispose())
    else gridMaterial.dispose()
    this.renderer.dispose()
  }

  private resize() {
    const rect = this.stage.getBoundingClientRect()
    this.width = rect.width
    this.height = rect.height
    if (rect.width < 2 || rect.height < 2) return
    this.renderer.setSize(rect.width, rect.height, false)
    this.rig.resize(rect.width, rect.height)
  }

  private onStore = () => {
    const state = useEditorStore.getState()
    if (state.editorViewNonce !== this.appliedViewNonce) {
      this.appliedViewNonce = state.editorViewNonce
      if (state.editorView) this.rig.restore(state.editorView)
    }
    if (state.cameraNonce !== this.cameraNonce) {
      this.cameraNonce = state.cameraNonce
      const locked = state.playState !== 'stopped' && resolvePlayCamera(state.nodes, state.tags).id !== null
      if (!locked) {
        if (state.cameraAction === 'focus') this.focusSelection()
        else if (state.cameraAction === 'focus-all') this.focusAll()
        else this.rig.setView(state.cameraView)
      }
    }
    this.sync()
  }

  private sync() {
    const state = useEditorStore.getState()
    for (const [id, group] of this.objects) {
      if (!state.nodes[id]) {
        group.parent?.remove(group)
        disposeObject(group)
        this.objects.delete(id)
      }
    }

    for (const id of orderedIds(state.nodes)) {
      const node = state.nodes[id]
      let group = this.objects.get(id)
      if (!group) {
        group = this.createView(node)
        this.objects.set(id, group)
      }
      if (group.parent !== this.world) this.world.add(group)
      const skipTransform = this.driving && (this.singleId === id || this.baselines.some(item => item.id === id))
      if (!skipTransform) {
        const pose = worldPose(state.nodes, id)
        group.position.copy(pose.position)
        group.quaternion.copy(pose.quaternion)
        group.scale.copy(pose.scale)
      }
      const layerBit = layerBitIndex(node.renderLayerId, state.layers)
      group.visible = node.visible && (state.editorCullingMask & (1 << layerBit)) !== 0
      this.updateView(group, node, state.playState === 'stopped')
      applyNodeLayers(group, layerBit)
    }

    this.pickables.length = 0
    for (const group of this.objects.values()) {
      const pick = dataOf(group).pick
      if (pick) this.pickables.push(pick)
    }

    applyCameraMask(this.rig.persp, state.editorCullingMask)
    applyCameraMask(this.rig.ortho, state.editorCullingMask)
    this.raycaster.layers.mask = this.rig.persp.layers.mask
    this.grid.visible = state.gridVisible && state.playState === 'stopped'
    this.placeGrid()
    this.transform.mode = state.gizmoMode
    this.transform.space = state.gizmoSpace
    this.transform.translationSnap = state.snap ? state.snapStep : null
    this.transform.rotationSnap = state.snap ? 15 * DEG : null
    this.transform.scaleSnap = state.snap ? 0.1 : null
    this.transform.enabled = state.playState === 'stopped'
    this.transform.camera = this.rig.active

    const selectionKey = `${state.playState}:${state.selection.join('|')}`
    if (selectionKey !== this.selectionKey) {
      this.selectionKey = selectionKey
      this.rebuildHelpers()
    }

    const attachKey = [
      state.selection.map(id => `${id}:${state.nodes[id]?.locked ? 1 : 0}`).join(','),
      state.gizmoMode,
      state.gizmoSpace,
      state.gizmoOrigin,
      state.playState,
    ].join('|')
    if (!this.driving && attachKey !== this.attachKey) {
      this.attachKey = attachKey
      this.attachToSelection()
    }
  }

  private createView(node: SceneNode): Group {
    const group = new Group()
    group.name = node.name
    group.userData.nodeId = node.id
    const data = dataOf(group)
    data.nodeId = node.id

    if (isMesh(node.kind)) {
      const material = new MeshStandardMaterial({
        color: node.color,
        roughness: node.kind === 'plane' ? 0.92 : 0.58,
        metalness: 0.04,
      })
      const mesh = new Mesh(meshGeometry(node.kind), material)
      mesh.frustumCulled = false
      mesh.castShadow = node.castShadow
      mesh.receiveShadow = node.receiveShadow
      mesh.userData.nodeId = node.id
      group.add(mesh)
      data.pick = mesh
      data.material = material
      return group
    }

    if (node.kind === 'model') {
      group.userData.nodeId = node.id
      return group
    }

    if (isLight(node.kind)) {
      const light = createLight(node)
      group.add(light)
      if (light instanceof DirectionalLight || light instanceof SpotLight) {
        light.target.position.set(0, -1, 0)
        group.add(light.target)
      }
      const guide = createSceneGuide(node.kind)
      if (guide) mountGuide(group, guide, node.id)
      data.light = light
      data.guide = guide ?? undefined
      return group
    }

    if (node.kind === 'camera') {
      const camera = new PerspectiveCamera(node.fov, 1, node.near, node.far)
      group.add(camera)
      const guide = createSceneGuide(node.kind)
      if (guide) mountGuide(group, guide, node.id)
      data.guide = guide ?? undefined
      data.sceneCamera = camera
      return group
    }

    const marker = new Mesh(
      new OctahedronGeometry(0.16, 0),
      new MeshBasicMaterial({ color: node.kind === 'screen' ? '#4a9eff' : '#b0b0b0', wireframe: true }),
    )
    marker.userData.nodeId = node.id
    markHelper(marker)
    group.add(marker)
    data.pick = marker
    return group
  }

  private updateView(group: Group, node: SceneNode, editing: boolean) {
    const data = dataOf(group)
    group.name = node.name
    if (isMesh(node.kind)) {
      const mesh = data.pick as Mesh | undefined
      if (mesh?.isMesh) {
        const material = applyNodeMaterial(mesh, node)
        data.material = material
        mesh.castShadow = node.castShadow
        mesh.receiveShadow = node.receiveShadow
      }
    }
    if (node.kind === 'model') {
      this.ensureModel(group, node)
      if (data.modelRoot) {
        const file = node.assetId ? useAssetStore.getState().assets[node.assetId] : undefined
        const importScale = file && 'importScale' in file && typeof file.importScale === 'number' && file.importScale > 0 ? file.importScale : 1
        data.modelRoot.scale.setScalar(importScale)
        applyModelMaterials(data.modelRoot, node.slots)
        data.modelRoot.traverse(child => {
          const mesh = child as Mesh
          if (!mesh.isMesh) return
          mesh.castShadow = node.castShadow
          mesh.receiveShadow = node.receiveShadow
        })
      }
      this.syncClip(data, node)
    }
    if (data.light) {
      data.light.color.set(node.color)
      data.light.intensity = node.intensity
      data.light.castShadow = node.castShadow
      if (data.light instanceof PointLight || data.light instanceof SpotLight) {
        data.light.distance = node.range
        data.light.decay = node.decay
      }
      if (data.light instanceof SpotLight) {
        data.light.angle = (node.spotAngle * Math.PI) / 180
        data.light.penumbra = node.penumbra
        data.light.shadow.bias = node.shadowBias
        data.light.shadow.normalBias = node.shadowNormalBias
      }
      if (data.light instanceof DirectionalLight) {
        data.light.shadow.bias = node.shadowBias
        data.light.shadow.normalBias = node.shadowNormalBias
        const distance = Math.max(node.range, 4)
        data.light.shadow.camera.far = distance * 4
        data.light.shadow.camera.left = -distance
        data.light.shadow.camera.right = distance
        data.light.shadow.camera.top = distance
        data.light.shadow.camera.bottom = -distance
        data.light.shadow.camera.updateProjectionMatrix()
      }
      if (data.light instanceof HemisphereLight) data.light.groundColor.set(node.groundColor)
    }
    if (data.sceneCamera) {
      let changed = false
      if (data.sceneCamera.fov !== node.fov) { data.sceneCamera.fov = node.fov; changed = true }
      if (data.sceneCamera.near !== node.near) { data.sceneCamera.near = node.near; changed = true }
      if (data.sceneCamera.far !== node.far) { data.sceneCamera.far = node.far; changed = true }
      if (changed) data.sceneCamera.updateProjectionMatrix()
    }
    const showHelpers = editing && useEditorStore.getState().helpersVisible
    if (data.guide) {
      const selected = useEditorStore.getState().selection.includes(node.id)
      data.guide.refresh(node, group.scale, this.aspect(), showHelpers, selected)
    }
    if (data.pick && data.pick !== data.guide?.icon && !isMesh(node.kind) && node.kind !== 'model') data.pick.visible = showHelpers
    const pickMesh = data.pick as Mesh | undefined
    if (pickMesh?.material instanceof MeshBasicMaterial && !isMesh(node.kind)) pickMesh.material.color.set(node.color)
  }

  private measureSnap(ids: string[]) {
    const down = new Vector3(0, -1, 0)
    const moves: { id: string, position: [number, number, number] }[] = []
    for (const id of ids) {
      const object = this.objects.get(id)
      const node = useEditorStore.getState().nodes[id]
      if (!object || !node) continue
      const source = dataOf(object).pick ?? object
      const box = boundsOf(source)
      if (box.isEmpty()) continue
      const origin = new Vector3(box.getCenter(new Vector3()).x, box.max.y + 0.05, box.getCenter(new Vector3()).z)
      const ray = new Raycaster(origin, down, 0, 800)
      ray.layers.mask = this.raycaster.layers.mask
      let ground = 0
      let found = false
      for (const hit of ray.intersectObjects(this.pickables, true)) {
        let current: Object3D | null = hit.object
        let self = false
        while (current) {
          if (current.userData.nodeId === id) {
            self = true
            break
          }
          current = current.parent
        }
        if (self) continue
        ground = hit.point.y
        found = true
        break
      }
      if (!found) ground = 0
      const delta = ground - box.min.y
      if (Math.abs(delta) < 0.0001) continue
      const nodes = useEditorStore.getState().nodes
      const world = worldPose(nodes, id)
      world.position.y += delta
      const parent = node.parentId ? worldPose(nodes, node.parentId) : null
      const local = localPoseFromWorld(parent, world)
      moves.push({ id, position: [local.position.x, local.position.y, local.position.z] })
    }
    return moves
  }

  private attachToSelection() {
    const { nodes, selection, playState, gizmoOrigin } = useEditorStore.getState()
    const ids = selection.filter(id => nodes[id] && !nodes[id].locked)
    this.centerAttached = false
    if (playState !== 'stopped' || ids.length === 0) {
      this.transform.detach()
      this.proxyAttached = false
      this.singleId = null
      return
    }
    if (ids.length === 1 && gizmoOrigin === 'pivot') {
      const object = this.objects.get(ids[0])
      if (!object) return
      this.proxyAttached = false
      this.singleId = ids[0]
      this.transform.attach(object)
      return
    }
    const anchorId = [...selection].reverse().find(id => ids.includes(id)) ?? ids[0]
    const anchor = this.objects.get(anchorId)
    if (!anchor) return
    if (gizmoOrigin === 'center') {
      const box = new Box3()
      for (const id of ids) {
        const object = this.objects.get(id)
        if (!object) continue
        const next = boundsOf(dataOf(object).pick ?? object)
        if (!next.isEmpty()) box.union(next)
      }
      if (!box.isEmpty()) box.getCenter(this.proxy.position)
      else anchor.getWorldPosition(this.proxy.position)
      this.centerAttached = true
    } else {
      anchor.getWorldPosition(this.proxy.position)
    }
    anchor.getWorldQuaternion(this.proxy.quaternion)
    this.proxy.scale.set(1, 1, 1)
    this.proxy.updateMatrixWorld(true)
    this.proxyAttached = true
    this.singleId = null
    this.transform.attach(this.proxy)
  }

  private onGizmoDown = () => {
    const state = useEditorStore.getState()
    const ids = state.selection.filter(id => state.nodes[id] && !state.nodes[id].locked)
    this.driving = true
    this.baselines = []
    if (this.proxyAttached) {
      this.proxyStart.copy(this.proxy.position)
      this.proxyQuat.copy(this.proxy.quaternion)
      this.proxyScale.copy(this.proxy.scale)
      for (const id of ids) {
        const object = this.objects.get(id)
        if (!object) continue
        const worldPos = new Vector3()
        const worldQuat = new Quaternion()
        object.getWorldPosition(worldPos)
        object.getWorldQuaternion(worldQuat)
        this.baselines.push({
          id,
          localPos: object.position.clone(),
          localQuat: object.quaternion.clone(),
          localScale: object.scale.clone(),
          worldPos,
          worldQuat,
        })
      }
    }
    const label = state.gizmoMode === 'rotate' ? '旋转' : state.gizmoMode === 'scale' ? '缩放' : '移动'
    state.beginGesture(label)
  }

  private onGizmoChange = () => {
    if (this.proxyAttached) this.applyProxy()
    else if (this.singleId) this.writeObject(this.singleId)
  }

  private onGizmoUp = () => {
    if (this.proxyAttached) this.applyProxy()
    else if (this.singleId) this.writeObject(this.singleId)
    this.driving = false
    this.baselines = []
    this.attachKey = ''
    useEditorStore.getState().endGesture()
  }

  private applyProxy() {
    const mode = this.transform.mode
    const delta = this.proxy.position.clone().sub(this.proxyStart)
    const qDelta = this.proxyQuat.clone().invert().multiply(this.proxy.quaternion)
    for (const base of this.baselines) {
      const object = this.objects.get(base.id)
      if (!object?.parent) continue
      if (mode === 'translate') {
        object.position.copy(object.parent.worldToLocal(base.worldPos.clone().add(delta)))
        object.quaternion.copy(base.localQuat)
        object.scale.copy(base.localScale)
      } else if (mode === 'rotate') {
        const worldQuat = qDelta.clone().multiply(base.worldQuat)
        const parentQuat = new Quaternion()
        object.parent.getWorldQuaternion(parentQuat)
        object.quaternion.copy(parentQuat.invert()).multiply(worldQuat)
        const worldPos = base.worldPos.clone()
        if (this.centerAttached) {
          worldPos.sub(this.proxyStart).applyQuaternion(qDelta).add(this.proxyStart)
        }
        object.position.copy(object.parent.worldToLocal(worldPos))
        object.scale.copy(base.localScale)
      } else {
        const startScale = this.proxyScale
        object.scale.set(
          base.localScale.x * this.proxy.scale.x / (startScale.x || 1),
          base.localScale.y * this.proxy.scale.y / (startScale.y || 1),
          base.localScale.z * this.proxy.scale.z / (startScale.z || 1),
        )
        if (this.centerAttached) {
          const offset = base.worldPos.clone().sub(this.proxyStart).multiply(this.proxy.scale)
          object.position.copy(object.parent.worldToLocal(this.proxyStart.clone().add(offset)))
          object.quaternion.copy(base.localQuat)
        } else {
          object.position.copy(base.localPos)
          object.quaternion.copy(base.localQuat)
        }
      }
      this.writeObject(base.id)
    }
  }

  private writeObject(id: string) {
    const object = this.objects.get(id)
    const nodes = useEditorStore.getState().nodes
    const node = nodes[id]
    if (!object || !node) return
    const world = {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    }
    const parent = node.parentId ? worldPose(nodes, node.parentId) : null
    useEditorStore.getState().updateNode(id, poseComponents(localPoseFromWorld(parent, world)))
  }

  private rebuildHelpers() {
    this.clearHelpers()
    const { selection, playState } = useEditorStore.getState()
    if (playState !== 'stopped') return
    for (const id of selection) {
      const pick = dataOf(this.objects.get(id) ?? new Group()).pick
      const source = pick ?? this.objects.get(id)
      if (!source) continue
      const helper = new BoxHelper(source, 0x4a9eff)
      helper.raycast = () => {}
      const material = helper.material as Material & { depthTest?: boolean; transparent?: boolean }
      material.depthTest = false
      material.transparent = true
      helper.renderOrder = 20
      markHelper(helper)
      this.scene.add(helper)
      this.selectionHelpers.push(helper)
    }
  }

  private clearHelpers() {
    for (const helper of this.selectionHelpers) {
      helper.parent?.remove(helper)
      helper.geometry.dispose()
      const material = helper.material as Material
      material.dispose()
    }
    this.selectionHelpers = []
  }

  private focusSelection() {
    const { selection } = useEditorStore.getState()
    const box = new Box3()
    for (const id of selection) {
      const pick = dataOf(this.objects.get(id) ?? new Group()).pick
      if (!pick) continue
      const next = boundsOf(pick)
      if (next.isEmpty()) {
        const point = new Vector3()
        pick.getWorldPosition(point)
        box.expandByPoint(point)
      } else {
        box.union(next)
      }
    }
    if (box.isEmpty()) return
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const radius = Math.max(size.length() * 0.5, 0.6)
    const flat = size.y < Math.max(size.x, size.z) * 0.08 && Math.max(size.x, size.z) > 1
    this.rig.focus(center, radius, flat)
  }

  private focusAll() {
    const box = new Box3()
    for (const group of this.objects.values()) {
      const pick = dataOf(group).pick ?? group
      const next = boundsOf(pick)
      if (!next.isEmpty()) box.union(next)
    }
    if (box.isEmpty()) return
    const center = box.getCenter(new Vector3())
    const radius = Math.max(box.getSize(new Vector3()).length() * 0.5, 1)
    this.rig.focus(center, radius)
  }

  private onPointerDown = (event: PointerEvent) => {
    const active = document.activeElement as HTMLElement | null
    if (active && active !== this.canvas && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur()
    const gizmo = this.transform.axis !== null && event.button === 0 && !event.altKey
    this.press = null
    if (gizmo) return
    if (this.playCameraLocked()) {
      event.preventDefault()
      return
    }
    if (this.rig.pointerDown(event)) {
      this.canvas.setPointerCapture(event.pointerId)
      return
    }
    if (event.button === 0) {
      this.press = {
        x: event.clientX,
        y: event.clientY,
        additive: event.ctrlKey || event.metaKey || event.shiftKey,
      }
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    this.rig.pointerMove(event)
    if (!this.press) return
    const dx = event.clientX - this.press.x
    const dy = event.clientY - this.press.y
    if (dx * dx + dy * dy < 16) return
    if (!this.canvas.hasPointerCapture(event.pointerId)) this.canvas.setPointerCapture(event.pointerId)
    const box = this.ensureMarquee()
    const stage = this.stage.getBoundingClientRect()
    const left = Math.min(this.press.x, event.clientX) - stage.left
    const top = Math.min(this.press.y, event.clientY) - stage.top
    box.style.display = 'block'
    box.style.left = `${left}px`
    box.style.top = `${top}px`
    box.style.width = `${Math.abs(dx)}px`
    box.style.height = `${Math.abs(dy)}px`
  }

  private onPointerUp = (event: PointerEvent) => {
    const press = this.press
    this.press = null
    this.rig.pointerUp()
    this.commitView()
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    const dragged = press && this.marquee?.style.display === 'block'
    if (this.marquee) this.marquee.style.display = 'none'
    if (!press || event.button !== 0) return
    if (dragged) this.selectMarquee(press.x, press.y, event.clientX, event.clientY, press.additive)
    else this.pick(press.x, press.y, press.additive)
  }

  private onWheel = (event: WheelEvent) => {
    if (this.playCameraLocked()) {
      event.preventDefault()
      return
    }
    this.rig.wheel(event)
    this.commitView()
  }

  private onContext = (event: MouseEvent) => {
    event.preventDefault()
  }

  private ensureMarquee() {
    if (this.marquee) return this.marquee
    const box = document.createElement('div')
    box.className = 'viewport-marquee'
    this.stage.appendChild(box)
    this.marquee = box
    return box
  }

  private selectMarquee(x0: number, y0: number, x1: number, y1: number, additive: boolean) {
    const left = Math.min(x0, x1)
    const right = Math.max(x0, x1)
    const top = Math.min(y0, y1)
    const bottom = Math.max(y0, y1)
    const rect = this.canvas.getBoundingClientRect()
    const ids: string[] = []
    const nodes = useEditorStore.getState().nodes
    for (const [id, group] of this.objects) {
      const node = nodes[id]
      if (!node?.visible || node.locked) continue
      const source = dataOf(group).pick ?? group
      const box = boundsOf(source)
      const point = box.isEmpty() ? group.getWorldPosition(new Vector3()) : box.getCenter(new Vector3())
      const ndc = point.project(this.viewCamera())
      if (ndc.z < -1 || ndc.z > 1) continue
      const sx = (ndc.x * 0.5 + 0.5) * rect.width + rect.left
      const sy = (-ndc.y * 0.5 + 0.5) * rect.height + rect.top
      if (sx >= left && sx <= right && sy >= top && sy <= bottom) ids.push(id)
    }
    const store = useEditorStore.getState()
    if (additive) store.setSelection([...new Set([...store.selection, ...ids])])
    else store.setSelection(ids)
  }

  private pickId(clientX: number, clientY: number): string | null {
    if (!this.aimPointer(clientX, clientY)) return null
    const hits = this.raycaster.intersectObjects(this.pickables, true)
    for (const hit of hits) {
      let object: Object3D | null = hit.object
      while (object && !object.userData.nodeId) object = object.parent
      if (!object || !isRendered(object)) continue
      const id = object.userData.nodeId as string
      if (useEditorStore.getState().nodes[id]?.locked) continue
      return id
    }
    return null
  }

  private pick(clientX: number, clientY: number, additive: boolean) {
    const id = this.pickId(clientX, clientY)
    const { selection, setSelection } = useEditorStore.getState()
    if (!id) {
      if (!additive) setSelection([])
      return
    }
    if (additive) setSelection(selection.includes(id) ? selection.filter(item => item !== id) : [...selection, id])
    else setSelection([id])
  }

  raycastDrop(clientX: number, clientY: number): { point: [number, number, number], nodeId: string | null } {
    if (!this.aimPointer(clientX, clientY)) return { point: [0, 0, 0], nodeId: null }
    const hits = this.raycaster.intersectObjects(this.pickables, true)
    for (const hit of hits) {
      let object: Object3D | null = hit.object
      while (object && !object.userData.nodeId) object = object.parent
      if (!object || !isRendered(object)) continue
      return {
        point: [hit.point.x, hit.point.y, hit.point.z],
        nodeId: object.userData.nodeId as string,
      }
    }
    const ray = this.raycaster.ray
    if (Math.abs(ray.direction.y) > 1e-4) {
      const distance = -ray.origin.y / ray.direction.y
      if (distance > 0) {
        const point = ray.origin.clone().addScaledVector(ray.direction, distance)
        return { point: [point.x, 0, point.z], nodeId: null }
      }
    }
    return { point: [0, 0, 0], nodeId: null }
  }

  private gridStep = 1

  private placeGrid() {
    const distance = Math.max(this.rig.orbitDistance, 1)
    const next = gridStepForDistance(distance)
    if (next > this.gridStep * 1.4 || next < this.gridStep / 1.4) this.gridStep = next
    const setGridLevel = this.grid.userData.setGridLevel as ((cell: number, distance: number) => void) | undefined
    const reach = Math.max(distance * 2.8, 48)
    setGridLevel?.(this.gridStep, reach)
    const camera = this.rig.active.position
    this.grid.position.x = Math.round(camera.x / this.gridStep) * this.gridStep
    this.grid.position.z = Math.round(camera.z / this.gridStep) * this.gridStep
    this.grid.scale.set(reach / 2000, 1, reach / 2000)
  }

  private boot = async () => {
    try {
      await this.renderer.init()
      if (this.disposed) return
      bindTextureRenderer(this.renderer)
      const backend = this.renderer.backend as { isWebGPUBackend?: boolean }
      const label = translate(backend.isWebGPUBackend ? 'log.webgpu' : 'log.webgl2')
      useEditorStore.getState().setRenderBackend(label)
      useEditorStore.getState().log('info', translate('log.backend', { label }))
      this.picture = new ScenePicturePipeline(this.renderer)
      this.ready = true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useEditorStore.getState().setRenderBackend('初始化失败')
      useEditorStore.getState().log('error', translate('log.rendererFail', { message }))
    }
  }

  private commitView() {
    if (this.rig.dragging) return
    useEditorStore.getState().rememberEditorView(this.rig.snapshot())
  }

  private tick = (time: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const elapsed = this.last ? (time - this.last) / 1000 : 0
    const dt = Math.min(0.05, elapsed)
    this.last = time
    if (elapsed > 0) {
      this.fpsFrames += 1
      this.fpsAccum += elapsed
    }
    if (this.playCameraLocked()) this.rig.pointerUp()
    this.rig.update(dt)
    this.commitView()
    this.placeGrid()
    tickPhysics(dt)
    tickNavigation()
    if (this.ready) tickParticles(dt, id => this.objects.get(id) ?? null)
    const bake = consumeNavBake()
    if (bake) {
      const roots = bake.surfaceIds.flatMap(id => {
        const group = this.objects.get(id)
        return group ? [group] : []
      })
      bake.finish(collectNavSurfaces(roots))
    }
    const editor = useEditorStore.getState()
    syncNavDebug(
      this.navDebug,
      navDebugGeometry(),
      capabilityEnabled(editor.capabilities, 'navigation') && (editor.helpersVisible || editor.playState !== 'stopped'),
    )
    this.refreshGuides()
    for (const helper of this.selectionHelpers) {
      const target = (helper as { object?: Object3D }).object
      if (target) refreshObjectBounds(target)
      helper.update()
    }
    this.flattenGizmo()
    this.frameCamera = this.activeCamera()
    this.paintViewCube()
    if (this.ready && this.picture && this.width > 1 && this.height > 1) {
      this.updateMixers(dt)
      const camera = this.viewCamera()
      const picture = useEditorStore.getState().picture
      if (!picture.volume) this.volumeMuted = false
      try {
        this.applyPicture()
        if (this.volumeMuted) this.volume.mesh.visible = false
        if (!this.picture.usesEffects(picture)) {
          this.renderer.render(this.scene, camera)
        } else {
          this.picture.render(this.scene, camera, picture, this.width, this.height)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(error)
        if (picture.volume && !this.volumeMuted) {
          this.volumeMuted = true
          this.volume.mesh.visible = false
          useEditorStore.getState().log('error', `体积光绘制失败：${message}`)
        }
      }
    }
    this.publishStats()
  }

  private aspect() {
    return this.width / Math.max(this.height, 1)
  }

  private refreshGuides() {
    const state = useEditorStore.getState()
    const show = state.playState === 'stopped' && state.helpersVisible
    const aspect = this.aspect()
    for (const [id, group] of this.objects) {
      const guide = dataOf(group).guide
      const node = state.nodes[id]
      if (!guide || !node) continue
      guide.refresh(node, group.scale, aspect, show, state.selection.includes(id))
    }
  }

  private toneMappingOf(mode: ToneMap) {
    if (mode === 'none') return NoToneMapping
    if (mode === 'linear') return LinearToneMapping
    if (mode === 'reinhard') return ReinhardToneMapping
    if (mode === 'cineon') return CineonToneMapping
    if (mode === 'agx') return AgXToneMapping
    if (mode === 'neutral') return NeutralToneMapping
    return ACESFilmicToneMapping
  }

  private applyPicture() {
    const picture = useEditorStore.getState().picture
    const env = environmentFor(picture.envAssetId)
    if (env) {
      if (this.scene.environment !== env) this.scene.environment = env
      if (this.scene.background !== env) this.scene.background = env
    } else {
      if (this.scene.environment) this.scene.environment = null
      const background = this.scene.background
      if (!(background instanceof Color) || `#${background.getHexString()}` !== picture.background.toLowerCase()) {
        this.scene.background = new Color(picture.background)
      }
    }
    this.renderer.toneMapping = this.toneMappingOf(picture.toneMapping)
    this.renderer.toneMappingExposure = picture.exposure
    this.volume.sync(picture)
    if (picture.fog) {
      const fog = this.scene.fog instanceof Fog ? this.scene.fog : new Fog(picture.fogColor, picture.fogNear, picture.fogFar)
      fog.color.set(picture.fogColor)
      fog.near = picture.fogNear
      fog.far = picture.fogFar
      this.scene.fog = fog
    } else if (this.scene.fog) {
      this.scene.fog = null
    }
  }

  private publishStats() {
    if (this.fpsFrames < 1 || this.fpsAccum < 0.5) return
    const fps = this.fpsFrames / this.fpsAccum
    const frameMs = (this.fpsAccum / this.fpsFrames) * 1000
    this.fpsFrames = 0
    this.fpsAccum = 0
    let objects = 0
    let vertices = 0
    const materials = new Set<string>()
    const textures = new Set<string>()
    this.scene.traverse(child => {
      const mesh = child as Mesh
      if (!mesh.isMesh || !mesh.visible) return
      objects += 1
      vertices += mesh.geometry.getAttribute('position')?.count ?? 0
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of list) {
        if (!material) continue
        materials.add(material.uuid)
        for (const value of Object.values(material)) {
          const texture = value as { isTexture?: boolean, uuid?: string }
          if (texture?.isTexture && texture.uuid) textures.add(texture.uuid)
        }
      }
    })
    const info = this.renderer.info.render
    const camera = this.rig.active.position
    useEditorStore.getState().setViewportStats({
      objects,
      triangles: info.triangles,
      vertices,
      materials: materials.size,
      textures: textures.size,
      calls: info.drawCalls,
      fps: Math.round(fps * 10) / 10,
      frameMs: Math.round(frameMs * 10) / 10,
      camera: [camera.x, camera.y, camera.z],
      orbit: this.rig.orbitDistance,
    })
  }

  private ensureModel(group: Group, node: SceneNode) {
    const data = dataOf(group)
    const key = node.assetId ? `${node.assetId}@${modelRevision(node.assetId)}` : ''
    if (!node.assetId || data.modelKey === key) return
    const instance = instantiateModel(node.assetId)
    if (!instance) return
    if (data.modelRoot) group.remove(data.modelRoot)
    data.mixer?.stopAllAction()
    instance.object.traverse(child => { child.userData.nodeId = node.id })
    group.add(instance.object)
    const mixer = new AnimationMixer(instance.object)
    data.modelRoot = instance.object
    data.pick = instance.object
    data.modelKey = key
    data.mixer = mixer
    data.actions = new Map<string, AnimationAction>()
    data.activeClip = ''
    data.activeOverlay = ''
    data.bodyBlend = undefined
    data.overlayBlend = undefined
  }

  private playbackSource(node: SceneNode) {
    const animator = node.animator?.enabled ? activeAnimatorState(node.animator) : undefined
    const overlayOn = Boolean(node.overlayClip && node.overlayPlaying)
    if (animator) {
      const mask = animator.mask && animator.mask !== 'full' ? animator.mask : 'full' as const
      return {
        sourceId: animator.clipAssetId || node.assetId || '',
        clip: animator.clip,
        loop: animator.loop,
        speed: Number.isFinite(animator.speed) ? animator.speed : 1,
        fade: node.clipFade ?? 0.15,
        inPlace: animator.inPlace ?? node.clipInPlace === true,
        mask: overlayOn && mask === 'full' ? 'lower' as const : mask,
        playing: node.clipPlaying,
        time: node.clipTime,
      }
    }
    const mask = node.clipMask === 'upper' || node.clipMask === 'lower' ? node.clipMask : 'full' as const
    return {
      sourceId: node.clipAssetId || node.assetId || '',
      clip: node.clip,
      loop: node.clipLoop !== false,
      speed: node.clipSpeed ?? 1,
      fade: node.clipFade ?? 0.15,
      inPlace: node.clipInPlace === true,
      mask: overlayOn && mask === 'full' ? 'lower' as const : mask,
      playing: node.clipPlaying,
      time: node.clipTime,
    }
  }

  private overlaySource(node: SceneNode) {
    if (!node.overlayClip) return null
    return {
      sourceId: node.overlayAssetId || node.assetId || '',
      clip: node.overlayClip,
      loop: node.overlayLoop === true,
      speed: 1,
      fade: node.clipFade ?? 0.15,
      inPlace: true,
      mask: 'upper' as const,
      playing: node.overlayPlaying === true,
      time: node.overlayTime ?? 0,
    }
  }

  private actionKey(ownerId: string, sourceId: string, clipName: string, mask: 'full' | 'upper' | 'lower', inPlace: boolean) {
    const binding = sourceId === ownerId
      ? `${ownerId}@${modelRevision(ownerId)}`
      : humanoidBindingKey(sourceId, ownerId)
    return `${binding}:${clipName}:${mask}:${inPlace ? 1 : 0}`
  }

  private ensurePlaybackAction(
    data: ViewData,
    ownerId: string,
    sourceId: string,
    clipName: string,
    mask: 'full' | 'upper' | 'lower',
    inPlace: boolean,
  ) {
    if (!data.mixer || !data.actions || !sourceId || !clipName) return undefined
    const key = this.actionKey(ownerId, sourceId, clipName, mask, inPlace)
    const existing = data.actions.get(key)
    if (existing) return existing
    const ownClips = getModelTemplate(ownerId)?.clips ?? []
    const clips = sourceId === ownerId ? ownClips : clipsForSkeleton(sourceId, ownerId)
    const found = clips.find(clip => clip.name === clipName)
      ?? (sourceId !== ownerId && clips.length === 1 ? clips[0] : undefined)
      ?? (sourceId === ownerId ? undefined : ownClips.find(clip => clip.name === clipName))
    if (!found) return undefined
    let clip = found
    if (mask === 'upper') clip = maskClip(clip, 'upperBody')
    if (mask === 'lower') clip = maskClip(clip, 'lowerBody')
    if (inPlace) clip = lockClipInPlace(clip)
    const action = data.mixer.clipAction(clip)
    data.actions.set(key, action)
    return action
  }

  private configureAction(action: AnimationAction, loop: boolean, speed: number) {
    action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1)
    action.clampWhenFinished = !loop
    action.timeScale = speed
  }

  private beginBlend(
    data: ViewData,
    previous: AnimationAction | undefined,
    next: AnimationAction,
    loop: boolean,
    speed: number,
    fade: number,
    keep?: AnimationAction,
  ) {
    const duration = Math.max(0, fade)
    const previousDuration = previous?.getClip().duration || 1
    const nextDuration = next.getClip().duration || 1
    const phase = previous ? ((previous.time % previousDuration) + previousDuration) % previousDuration / previousDuration : 0
    if (data.actions) {
      for (const item of data.actions.values()) {
        if (item === previous || item === next || item === keep) continue
        item.stop()
      }
    }
    this.configureAction(next, loop, speed)
    next.stopFading()
    next.enabled = true
    next.paused = false
    next.weight = duration > 0 && previous && previous !== next ? 0 : 1
    next.time = phase * nextDuration
    next.play()
    if (previous && previous !== next) {
      previous.stopFading()
      previous.enabled = true
      previous.paused = false
      previous.weight = 1
      previous.play()
    }
    const blend = { from: previous, to: next, start: data.mixer?.time ?? 0, duration, loop, speed }
    return duration > 0 && previous && previous !== next ? blend : this.finishBlend(data, blend, keep)
  }

  /** 淡出结束后把目标动作卸掉再绑上，清掉全身轨残留的混合权重。 */
  private finishBlend(data: ViewData, blend: ActionBlend, keep?: AnimationAction) {
    const time = blend.to.time
    if (data.actions) {
      for (const item of data.actions.values()) {
        if (item === keep) continue
        item.stop()
      }
    } else if (blend.from && blend.from !== blend.to && blend.from !== keep) {
      blend.from.stop()
    }
    this.configureAction(blend.to, blend.loop, blend.speed)
    blend.to.stopFading()
    blend.to.enabled = true
    blend.to.paused = false
    blend.to.weight = 1
    blend.to.time = time
    blend.to.play()
    return undefined
  }

  private stepBlend(data: ViewData, blend: ActionBlend | undefined, keep?: AnimationAction) {
    if (!blend || !data.mixer) return blend
    const elapsed = data.mixer.time - blend.start
    const t = blend.duration <= 0 ? 1 : Math.min(1, elapsed / blend.duration)
    const from = blend.from
    if (t < 1 && from && from !== blend.to) {
      from.enabled = true
      from.paused = false
      from.weight = 1 - t
      blend.to.enabled = true
      blend.to.paused = false
      blend.to.weight = t
      return blend
    }
    return this.finishBlend(data, blend, keep)
  }

  private syncClip(data: ViewData, node: SceneNode) {
    if (!data.mixer || !data.actions || !node.assetId) return
    this.applyAnimatorParameters(data, node)
    node = useEditorStore.getState().nodes[node.id] ?? node
    if (!node.assetId) return
    this.syncLayer(data, node, 'body')
    this.syncLayer(data, node, 'overlay')
  }

  private syncLayer(data: ViewData, node: SceneNode, layer: 'body' | 'overlay') {
    if (!data.mixer || !data.actions || !node.assetId) return
    const play = layer === 'body' ? this.playbackSource(node) : this.overlaySource(node)
    const currentKey = layer === 'body' ? data.activeClip : data.activeOverlay
    const key = play?.clip && play.sourceId ? this.actionKey(node.assetId, play.sourceId, play.clip, play.mask, play.inPlace) : ''
    const action = key && play ? this.ensurePlaybackAction(data, node.assetId, play.sourceId, play.clip, play.mask, play.inPlace) : undefined
    const fade = layer === 'body' ? (data.pendingFade ?? play?.fade ?? node.clipFade ?? 0) : (node.clipFade ?? 0)
    if (layer === 'body') data.pendingFade = undefined
    if (currentKey !== key) {
      const previous = currentKey ? data.actions.get(currentKey) : undefined
      if (action && play) {
        this.configureAction(action, play.loop, play.speed)
        const currentBlend = layer === 'body' ? data.bodyBlend : data.overlayBlend
        if (currentBlend?.to === action) {
          action.paused = !play.playing
        } else if (play.playing && previous && previous !== action && fade > 0) {
          const keep = layer === 'body'
            ? (node.overlayPlaying ? data.actions.get(data.activeOverlay ?? '') : undefined)
            : data.actions.get(data.activeClip ?? '')
          const blend = this.beginBlend(data, previous, action, play.loop, play.speed, fade, keep)
          if (layer === 'body') data.bodyBlend = blend
          else data.overlayBlend = blend
        } else {
          const keep = layer === 'body'
            ? (node.overlayPlaying ? data.actions.get(data.activeOverlay ?? '') : undefined)
            : data.actions.get(data.activeClip ?? '')
          for (const item of data.actions.values()) {
            if (item === action || item === keep) continue
            item.stop()
          }
          if (layer === 'body') data.bodyBlend = undefined
          else data.overlayBlend = undefined
          action.reset().play()
          action.weight = 1
          action.paused = !play.playing
          action.time = play.time
        }
      } else if (previous) {
        if (fade > 0) previous.fadeOut(fade)
        else previous.stop()
        if (layer === 'body') data.bodyBlend = undefined
        else data.overlayBlend = undefined
      }
      if (layer === 'body') data.activeClip = key
      else data.activeOverlay = key
    }
    if (action && play) {
      this.configureAction(action, play.loop, play.speed)
      action.paused = !play.playing
      if (!play.playing && Math.abs(action.time - play.time) > 0.001) {
        action.time = play.time
      }
    }
  }

  private applyAnimatorParameters(data: ViewData, node: SceneNode) {
    if (!node.animator?.enabled || this.applyingAnimator) return
    if (data.animatorState !== node.animator.stateId) {
      data.animatorState = node.animator.stateId
      data.animatorTime = 0
    }
    const state = activeAnimatorState(node.animator)
    const duration = clipDuration(state?.clipAssetId || node.assetId, state?.clip ?? '')
    const stepped = stepAnimator(node.animator, data.animatorTime ?? 0, duration)
    if (!stepped.changed) return
    this.applyingAnimator = true
    data.animatorState = stepped.controller.stateId
    data.animatorTime = 0
    data.pendingFade = stepped.fade
    useEditorStore.getState().updateNode(node.id, { animator: stepped.controller })
    this.applyingAnimator = false
  }

  private updateMixers(dt: number) {
    const nodes = useEditorStore.getState().nodes
    let write = false
    if (performance.now() - this.clipWrite > 120) {
      this.clipWrite = performance.now()
      write = true
    }
    for (const [id, group] of this.objects) {
      const node = nodes[id]
      const data = dataOf(group)
      if (!node || !data.mixer) continue
      if (node.animator?.enabled && node.clipPlaying) {
        if (data.animatorState !== node.animator.stateId) {
          data.animatorState = node.animator.stateId
          data.animatorTime = 0
        }
        const state = activeAnimatorState(node.animator)
        const duration = clipDuration(state?.clipAssetId || node.assetId, state?.clip ?? '')
        data.animatorTime = (data.animatorTime ?? 0) + dt * (state?.speed || 1)
        const stepped = stepAnimator(node.animator, data.animatorTime, duration)
        if (stepped.changed && !this.applyingAnimator) {
          this.applyingAnimator = true
          data.animatorState = stepped.controller.stateId
          data.animatorTime = 0
          data.pendingFade = stepped.fade
          useEditorStore.getState().updateNode(id, { animator: stepped.controller })
          this.applyingAnimator = false
        }
      }
      if (!(node.clipPlaying || node.overlayPlaying)) continue
      const overlayKeep = node.overlayPlaying ? data.actions?.get(data.activeOverlay ?? '') : undefined
      const bodyKeep = node.clipPlaying ? data.actions?.get(data.activeClip ?? '') : undefined
      data.bodyBlend = this.stepBlend(data, data.bodyBlend, overlayKeep)
      data.overlayBlend = this.stepBlend(data, data.overlayBlend, bodyKeep)
      data.mixer.update(dt)
      const action = data.actions?.get(data.activeClip ?? '')
      const overlay = data.actions?.get(data.activeOverlay ?? '')
      if (overlay && node.overlayPlaying && overlay.loop === LoopOnce && !overlay.isRunning() && overlay.time > 0) {
        useEditorStore.getState().updateNode(id, { overlayPlaying: false, overlayTime: overlay.time })
      } else if (write && overlay && node.overlayClip) {
        useEditorStore.getState().updateNode(id, { overlayTime: overlay.time })
      }
      if (action && node.clipPlaying && action.loop === LoopOnce && !action.isRunning() && action.time > 0) {
        const end = node.clipEnd ?? 'hold'
        if (end === 'stop') {
          useEditorStore.getState().updateNode(id, { clipPlaying: false, clipTime: action.time })
        } else if (end === 'default' && node.animator?.enabled) {
          const animator = node.animator
          const target = animator.defaultStateId || animator.states[0]?.id
          if (target && target !== animator.stateId) {
            data.animatorState = target
            data.animatorTime = 0
            useEditorStore.getState().updateNode(id, { animator: { ...animator, stateId: target } })
          } else if (!action.paused) action.paused = true
        } else if (end === 'default') {
          action.reset().play()
          action.time = 0
          useEditorStore.getState().updateNode(id, { clipTime: 0 })
        } else if (!action.paused) action.paused = true
        continue
      }
      if (write && action) useEditorStore.getState().updateNode(id, { clipTime: action.time })
    }
  }

  private flattenGizmo() {
    this.gizmo.traverse(object => {
      object.renderOrder = 1000
      object.castShadow = false
      object.receiveShadow = false
      const material = (object as Mesh).material as Material | Material[] | undefined
      if (!material) return
      const list = Array.isArray(material) ? material : [material]
      for (const item of list) {
        item.depthTest = false
        item.depthWrite = false
        item.transparent = true
      }
    })
  }

  private viewCamera() {
    return this.frameCamera ?? this.rig.active
  }

  /** 用正在看的那台相机发出射线，并沿用它的近远裁剪。相机图标若和视口重合，交点在镜头上，距离是 0，不该挡住后面的物体。 */
  private aimPointer(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const camera = this.viewCamera()
    this.raycaster.near = camera.near
    this.raycaster.far = camera.far
    this.raycaster.setFromCamera(this.pointer, camera)
    return true
  }

  private playCameraLocked() {
    const state = useEditorStore.getState()
    return state.playState !== 'stopped' && resolvePlayCamera(state.nodes, state.tags).id !== null
  }

  private activeCamera() {
    const state = useEditorStore.getState()
    if (state.playState === 'stopped') {
      this.playCameraWarned = ''
      return this.rig.active
    }
    const chosen = resolvePlayCamera(state.nodes, state.tags)
    const node = chosen.id ? state.nodes[chosen.id] : undefined
    const camera = node ? dataOf(this.objects.get(node.id) ?? new Group()).sceneCamera : undefined
    if (!node || !camera) return this.rig.active
    camera.fov = node.fov
    camera.near = Math.max(0.001, node.near)
    camera.far = Math.max(camera.near + 0.01, node.far)
    camera.aspect = this.aspect()
    camera.updateProjectionMatrix()
    applyCameraMask(camera, state.editorCullingMask)
    this.raycaster.layers.mask = camera.layers.mask
    camera.updateMatrixWorld(true)
    if (chosen.multipleMain && this.playCameraWarned !== node.id) {
      this.playCameraWarned = node.id
      state.log('warn', translate('log.playCameraMany', { name: node.name }))
    }
    return camera
  }

  private paintViewCube() {
    this.viewCamera().getWorldQuaternion(this.cubeQuat).invert()
    viewCubePose.x = this.cubeQuat.x
    viewCubePose.y = this.cubeQuat.y
    viewCubePose.z = this.cubeQuat.z
    viewCubePose.w = this.cubeQuat.w
  }
}

function dataOf(group: Group): ViewData {
  return group.userData as ViewData
}

function orderedIds(nodes: Record<string, SceneNode>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id) || !nodes[id]) return
    const parentId = nodes[id].parentId
    if (parentId) visit(parentId)
    if (seen.has(id) || !nodes[id]) return
    seen.add(id)
    out.push(id)
  }
  Object.keys(nodes).forEach(visit)
  return out
}

function applyNodeLayers(group: Object3D, bit: number) {
  group.traverse(child => {
    const light = child as Light
    if (light.isLight) {
      light.layers.enableAll()
      return
    }
    child.layers.set(bit)
  })
}

function applyCameraMask(camera: { layers: { disableAll(): void, enable(bit: number): void } }, mask: number) {
  camera.layers.disableAll()
  for (let bit = 0; bit < 32; bit += 1) {
    if ((mask & (1 << bit)) !== 0) camera.layers.enable(bit)
  }
  camera.layers.enable(EDITOR_HELPER_LAYER)
}

function markHelper(object: Object3D, blockRaycast = false) {
  object.traverse(child => {
    child.layers.set(EDITOR_HELPER_LAYER)
    child.castShadow = false
    child.receiveShadow = false
    if (blockRaycast) child.raycast = () => {}
  })
}

function meshGeometry(kind: SceneNode['kind']): BufferGeometry {
  switch (kind) {
    case 'sphere': return new SphereGeometry(0.5, 32, 24)
    case 'plane': return new PlaneGeometry(1, 1)
    case 'cylinder': return new CylinderGeometry(0.5, 0.5, 1, 24)
    case 'capsule': return new CapsuleGeometry(0.3, 0.5, 6, 16)
    case 'cone': return new ConeGeometry(0.5, 1, 24)
    default: return new BoxGeometry(1, 1, 1)
  }
}

function createLight(node: SceneNode): Light {
  if (node.kind === 'directional-light') {
    const light = new DirectionalLight(node.color, node.intensity)
    light.castShadow = node.castShadow
    light.shadow.mapSize.set(2048, 2048)
    light.shadow.camera.near = 0.5
    light.shadow.camera.far = Math.max(node.range, 4) * 4
    light.shadow.camera.left = -node.range
    light.shadow.camera.right = node.range
    light.shadow.camera.top = node.range
    light.shadow.camera.bottom = -node.range
    light.shadow.bias = node.shadowBias
    light.shadow.normalBias = node.shadowNormalBias
    return light
  }
  if (node.kind === 'point-light') {
    const light = new PointLight(node.color, node.intensity, node.range, node.decay)
    light.castShadow = node.castShadow
    light.shadow.bias = node.shadowBias
    light.shadow.normalBias = node.shadowNormalBias
    return light
  }
  if (node.kind === 'spot-light') {
    const light = new SpotLight(node.color, node.intensity, node.range, node.spotAngle * DEG, node.penumbra, node.decay)
    light.castShadow = node.castShadow
    light.shadow.bias = node.shadowBias
    light.shadow.normalBias = node.shadowNormalBias
    return light
  }
  return new HemisphereLight(node.color, node.groundColor, node.intensity)
}

function mountGuide(group: Group, guide: SceneGuide, nodeId: string) {
  guide.icon.userData.nodeId = nodeId
  markHelper(guide.icon)
  markHelper(guide.lines, true)
  group.add(guide.icon)
  group.add(guide.lines)
  dataOf(group).pick = guide.icon
}

function isRendered(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function disposeObject(object: Object3D) {
  object.traverse(child => {
    const mesh = child as Mesh
    mesh.geometry?.dispose()
    const material = mesh.material as Material | Material[] | undefined
    if (Array.isArray(material)) material.forEach(item => item.dispose())
    else material?.dispose()
  })
}
