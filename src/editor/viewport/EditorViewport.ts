import {
  ACESFilmicToneMapping,
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
import { tickPhysics } from '../../capabilities/physics/session'
import { physicsDebugActive, syncPhysicsDebug } from './physicsDebug'
import { boundsOf, refreshObjectBounds } from '../scene/bounds'
import { isLight, isMesh } from '../scene/kinds'
import { setSpawnProvider } from '../scene/spawn'
import { setGroundSnapper } from '../scene/viewportBridge'
import { useEditorStore } from '../scene/store'
import { localPoseFromWorld, poseComponents, worldPose } from '../scene/transform'
import type { SceneNode } from '../scene/types'
import { EditorCameraRig } from './cameraControls'
import { viewCubePose } from './viewCubeBridge'
import { createEditorGrid } from './editorGrid'
import { createSceneGuide, type SceneGuide } from './lightCameraGizmo'
import { ScenePicturePipeline } from './picture'

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
  loadedClips?: Set<string>
  activeClip?: string
  clipBinding?: string
  boundSource?: string
  animatorState?: string
  animatorTime?: number
  pendingFade?: number
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
  private rightPress: { x: number, y: number, moved: boolean } | null = null
  private marquee: HTMLDivElement | null = null
  private centerAttached = false
  private contextHandler: ((x: number, y: number, id: string | null) => void) | null = null
  private width = 0
  private height = 0
  private last = 0
  private clipWrite = 0
  private applyingAnimator = false
  private statTick = 0
  private raf = 0
  private disposed = false
  private ready = false
  private picture: ScenePicturePipeline | null = null
  private readonly physicsDebug = new Group()
  private readonly unsubscribe: () => void
  private readonly unsubscribeAssets: () => void
  private readonly resizeObserver: ResizeObserver

  constructor(private readonly canvas: HTMLCanvasElement, private readonly stage: HTMLElement) {
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
    this.physicsDebug.name = 'physics-debug'
    this.scene.add(this.physicsDebug)
    root.add(this.world)
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
    this.marquee?.remove()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown, true)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('contextmenu', this.onContext)
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
    if (state.cameraNonce !== this.cameraNonce) {
      this.cameraNonce = state.cameraNonce
      if (state.cameraAction === 'focus') this.focusSelection()
      else if (state.cameraAction === 'focus-all') this.focusAll()
      else this.rig.setView(state.cameraView)
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

    const marker = new Mesh(new OctahedronGeometry(0.16, 0), new MeshBasicMaterial({ color: '#b0b0b0', wireframe: true }))
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

  setContextHandler(handler: ((x: number, y: number, id: string | null) => void) | null) {
    this.contextHandler = handler
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
    const center = box.getCenter(new Vector3())
    const radius = Math.max(box.getSize(new Vector3()).length() * 0.5, 0.6)
    this.rig.focus(center, radius)
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
    if (event.button === 2) this.rightPress = { x: event.clientX, y: event.clientY, moved: false }
  }

  private onPointerMove = (event: PointerEvent) => {
    this.rig.pointerMove(event)
    if (this.rightPress && (event.buttons & 2)) {
      const dx = event.clientX - this.rightPress.x
      const dy = event.clientY - this.rightPress.y
      if (dx * dx + dy * dy > 16) this.rightPress.moved = true
    }
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
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    const dragged = press && this.marquee?.style.display === 'block'
    if (this.marquee) this.marquee.style.display = 'none'
    if (!press || event.button !== 0) return
    if (dragged) this.selectMarquee(press.x, press.y, event.clientX, event.clientY, press.additive)
    else this.pick(press.x, press.y, press.additive)
  }

  private onWheel = (event: WheelEvent) => {
    this.rig.wheel(event)
  }

  private onContext = (event: MouseEvent) => {
    event.preventDefault()
    const moved = this.rightPress?.moved ?? false
    this.rightPress = null
    if (moved) return
    const id = this.pickId(event.clientX, event.clientY)
    if (id && !useEditorStore.getState().selection.includes(id)) useEditorStore.getState().setSelection([id])
    this.contextHandler?.(event.clientX, event.clientY, id)
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
      const ndc = point.project(this.rig.active)
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
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return null
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.rig.active)
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
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return { point: [0, 0, 0], nodeId: null }
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.rig.active)
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

  private tick = (time: number) => {
    if (this.disposed) return
    const dt = Math.min(0.05, this.last ? (time - this.last) / 1000 : 0)
    this.last = time
    this.rig.update(dt)
    tickPhysics(dt)
    const editor = useEditorStore.getState()
    syncPhysicsDebug(
      this.scene,
      this.physicsDebug,
      editor.nodes,
      physicsDebugActive(editor.capabilities, editor.playState !== 'stopped'),
    )
    this.refreshGuides()
    for (const helper of this.selectionHelpers) {
      const target = (helper as { object?: Object3D }).object
      if (target) refreshObjectBounds(target)
      helper.update()
    }
    this.flattenGizmo()
    this.paintViewCube()
    if (this.ready && this.picture && this.width > 1 && this.height > 1) {
    this.updateMixers(dt)
    this.applyPicture()
    this.sampleStats()
      const camera = this.rig.active
      const picture = useEditorStore.getState().picture
      if (!this.picture.usesEffects(picture)) {
        this.renderer.render(this.scene, camera)
      } else {
        this.picture.render(this.scene, camera, picture, this.width, this.height)
      }
    }
    this.raf = requestAnimationFrame(this.tick)
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
    this.renderer.toneMappingExposure = picture.exposure
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

  private sampleStats() {
    this.statTick = (this.statTick + 1) % 20
    if (this.statTick !== 0) return
    let objects = 0
    let triangles = 0
    this.scene.traverse(child => {
      const mesh = child as Mesh
      if (!mesh.isMesh || !mesh.visible) return
      objects += 1
      const index = mesh.geometry.index
      const positions = mesh.geometry.getAttribute('position')
      triangles += index ? index.count / 3 : (positions?.count ?? 0) / 3
    })
    useEditorStore.getState().setViewportStats(objects, Math.round(triangles))
  }

  private ensureModel(group: Group, node: SceneNode) {
    const data = dataOf(group)
    const key = node.assetId ? `${node.assetId}@${modelRevision(node.assetId)}` : ''
    if (!node.assetId || data.modelKey === key) {
      this.attachExternalClips(data, node)
      return
    }
    const instance = instantiateModel(node.assetId)
    if (!instance) return
    if (data.modelRoot) group.remove(data.modelRoot)
    data.mixer?.stopAllAction()
    instance.object.traverse(child => { child.userData.nodeId = node.id })
    group.add(instance.object)
    const mixer = new AnimationMixer(instance.object)
    const actions = new Map<string, AnimationAction>()
    for (const clip of instance.clips) actions.set(clipId(node.assetId, clip.name), mixer.clipAction(clip))
    data.modelRoot = instance.object
    data.pick = instance.object
    data.modelKey = key
    data.mixer = mixer
    data.actions = actions
    data.loadedClips = new Set([node.assetId])
    data.activeClip = ''
    this.attachExternalClips(data, node)
  }

  private attachExternalClips(data: ViewData, node: SceneNode) {
    if (!data.mixer || !data.actions) return
    if (!node.clipAssetId || !node.assetId) {
      this.dropExternalClips(data)
      return
    }
    const binding = humanoidBindingKey(node.clipAssetId, node.assetId)
    if (data.clipBinding === binding) return
    this.dropExternalClips(data)
    const extra = getModelTemplate(node.clipAssetId)
    if (!extra) return
    for (const clip of clipsForSkeleton(node.clipAssetId, node.assetId)) {
      const key = clipId(node.clipAssetId, clip.name)
      if (!data.actions.has(key)) data.actions.set(key, data.mixer.clipAction(clip))
    }
    data.boundSource = node.clipAssetId
    data.clipBinding = binding
    data.activeClip = ''
  }

  private dropExternalClips(data: ViewData) {
    const prefix = data.boundSource ? `${data.boundSource}:` : ''
    if (data.actions && prefix) {
      for (const [key, action] of data.actions) {
        if (!key.startsWith(prefix)) continue
        action.stop()
        data.actions.delete(key)
      }
    }
    if (prefix && data.activeClip?.startsWith(prefix)) data.activeClip = ''
    data.boundSource = ''
    data.clipBinding = ''
  }

  private playbackSource(node: SceneNode) {
    const animator = node.animator?.enabled ? activeAnimatorState(node.animator) : undefined
    if (animator) {
      return {
        sourceId: animator.clipAssetId || node.assetId || '',
        clip: animator.clip,
        loop: animator.loop,
        speed: Number.isFinite(animator.speed) ? animator.speed : 1,
        fade: node.clipFade ?? 0.15,
        inPlace: animator.inPlace ?? node.clipInPlace === true,
        mask: animator.mask && animator.mask !== 'full' ? animator.mask : 'full' as const,
      }
    }
    return {
      sourceId: node.clipAssetId || node.assetId || '',
      clip: node.clip,
      loop: node.clipLoop !== false,
      speed: node.clipSpeed ?? 1,
      fade: node.clipFade ?? 0.15,
        inPlace: node.clipInPlace === true,
        mask: node.clipMask === 'upper' || node.clipMask === 'lower' ? node.clipMask : 'full' as const,
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

  private syncClip(data: ViewData, node: SceneNode) {
    if (!data.mixer || !data.actions || !node.assetId) return
    this.applyAnimatorParameters(data, node)
    node = useEditorStore.getState().nodes[node.id] ?? node
    if (!node.assetId) return
    const play = this.playbackSource(node)
    const key = play.clip && play.sourceId ? this.actionKey(node.assetId, play.sourceId, play.clip, play.mask, play.inPlace) : ''
    const action = key ? this.ensurePlaybackAction(data, node.assetId, play.sourceId, play.clip, play.mask, play.inPlace) : undefined
    const fade = data.pendingFade ?? play.fade
    data.pendingFade = undefined
    if (data.activeClip !== key) {
      const previous = data.activeClip ? data.actions.get(data.activeClip) : undefined
      if (action) {
        this.configureAction(action, play.loop, play.speed)
        if (node.clipPlaying && previous && previous !== action && fade > 0) {
          action.reset().play()
          action.fadeIn(fade)
          previous.fadeOut(fade)
        } else {
          previous?.stop()
          action.reset().play()
          action.paused = !node.clipPlaying
          action.time = node.clipTime
        }
      } else previous?.stop()
      data.activeClip = key
    }
    if (action) {
      this.configureAction(action, play.loop, play.speed)
      action.paused = !node.clipPlaying
      if (!node.clipPlaying && Math.abs(action.time - node.clipTime) > 0.001) {
        action.time = node.clipTime
        data.mixer.update(0)
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
      if (!node.clipPlaying) continue
      data.mixer.update(dt)
      const action = data.actions?.get(data.activeClip ?? '')
      if (action && action.loop === LoopOnce && !action.isRunning() && action.time > 0) {
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

  private paintViewCube() {
    this.cubeQuat.copy(this.rig.active.quaternion).invert()
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

function clipId(assetId: string | null, name: string): string {
  return `${assetId ?? ''}:${name}`
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
