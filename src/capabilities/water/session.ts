import {
  Color,
  DirectionalLight,
  Mesh,
  PlaneGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three'
import { textureFor } from '../../editor/assets/textures'
import { useEditorStore } from '../../editor/scene/store'
import { registerBeforeRenderHook, type ViewportRenderContext } from '../../editor/viewport/renderHooks'
import { capabilityEnabled, type CapabilityRuntimeModule } from '../registry'
import { WATER_CAPABILITY_ID, normalizeWater, type WaterSpec } from './defaults'
import { createWaterMaterial, type WaterMaterialHandle } from './waterMaterial'

interface BoundMesh {
  kind: 'owned' | 'hosted'
  mesh: Mesh
  parent?: Object3D
  originalMaterial?: Material | Material[]
  originalGeometry?: BufferGeometry
  isPlane?: boolean
  handle: WaterMaterialHandle
}

const boundMeshes = new Map<string, BoundMesh>()
let sharedPlaneGeo: PlaneGeometry | null = null
let removeBeforeRender: (() => void) | null = null
let waterTime = 0

const tmpToCam = new Vector3()
const tmpSunDir = new Vector3(0.45, 0.72, 0.52).normalize()
const tmpSunColor = new Color('#fff7e0')

function getSharedPlaneGeometry(): PlaneGeometry {
  if (!sharedPlaneGeo) sharedPlaneGeo = new PlaneGeometry(1, 1, 96, 96)
  return sharedPlaneGeo
}

function findNodeObjects(scene: Object3D): Map<string, Object3D> {
  const out = new Map<string, Object3D>()
  scene.traverse(child => {
    const id = child.userData?.nodeId
    if (typeof id === 'string' && !child.userData?.t3dWaterMesh && !out.has(id)) out.set(id, child)
  })
  return out
}

function firstMeshOf(root: Object3D): Mesh | null {
  let found: Mesh | null = null
  root.traverse(child => {
    if (found) return
    if (child.userData?.t3dWaterMesh) return
    const mesh = child as Mesh
    if (mesh.isMesh) found = mesh
  })
  return found
}

function releaseBound(id: string) {
  const entry = boundMeshes.get(id)
  if (!entry) return
  entry.handle.reflectionTarget.removeFromParent()
  if (entry.kind === 'owned') {
    entry.mesh.removeFromParent()
  } else {
    if (entry.originalMaterial) entry.mesh.material = entry.originalMaterial
    if (entry.originalGeometry) entry.mesh.geometry = entry.originalGeometry
  }
  entry.handle.dispose()
  boundMeshes.delete(id)
}

function updateSunFromScene(scene: Object3D) {
  let lightFound: DirectionalLight | null = null
  scene.traverse(child => {
    if (lightFound) return
    if ((child as DirectionalLight).isDirectionalLight) lightFound = child as DirectionalLight
  })
  if (lightFound) {
    const dirLight = lightFound as DirectionalLight
    dirLight.getWorldPosition(tmpSunDir)
    dirLight.target.getWorldPosition(tmpToCam)
    tmpSunDir.sub(tmpToCam).normalize()
    if (tmpSunDir.lengthSq() < 1e-4) tmpSunDir.set(0.45, 0.72, 0.52).normalize()
    tmpSunColor.copy(dirLight.color)
    return dirLight.intensity
  }
  tmpSunDir.set(0.45, 0.72, 0.52).normalize()
  tmpSunColor.set('#fff7e0')
  return 1.0
}

function onBeforeRender(ctx: ViewportRenderContext) {
  const editor = useEditorStore.getState()
  if (!capabilityEnabled(editor.capabilities, WATER_CAPABILITY_ID)) {
    for (const id of [...boundMeshes.keys()]) releaseBound(id)
    return
  }

  waterTime += Math.min(0.05, Math.max(0, ctx.dt))

  const activeSpecs = new Map<string, WaterSpec>()
  for (const node of Object.values(editor.nodes)) {
    const raw = node.capabilities?.[WATER_CAPABILITY_ID]
    if (!raw || typeof raw !== 'object') continue
    const spec = normalizeWater(raw)
    if (!spec.enabled) continue
    if (node.kind !== 'empty' && node.kind !== 'plane' && node.kind !== 'model') continue
    activeSpecs.set(node.id, spec)
  }

  for (const id of [...boundMeshes.keys()]) {
    if (!activeSpecs.has(id)) releaseBound(id)
  }

  if (activeSpecs.size === 0) return

  const nodeObjects = findNodeObjects(ctx.scene)
  const sunIntensity = updateSunFromScene(ctx.scene)

  for (const [id, spec] of activeSpecs) {
    const root = nodeObjects.get(id)
    const node = editor.nodes[id]
    if (!root || !node) continue

    let entry = boundMeshes.get(id)
    if (node.kind === 'empty') {
      if (entry && (entry.kind !== 'owned' || entry.parent !== root)) {
        releaseBound(id)
        entry = undefined
      }
      if (!entry) {
        const handle = createWaterMaterial()
        const mesh = new Mesh(getSharedPlaneGeometry(), handle.material)
        mesh.name = 'water-surface'
        mesh.rotation.x = -Math.PI / 2
        mesh.frustumCulled = false
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.userData.nodeId = id
        mesh.userData.t3dWaterMesh = true
        mesh.add(handle.reflectionTarget)
        root.add(mesh)
        entry = { kind: 'owned', mesh, parent: root, handle }
        boundMeshes.set(id, entry)
      }
    } else {
      const hostMesh = firstMeshOf(root)
      if (!hostMesh) continue
      if (entry && (entry.kind !== 'hosted' || entry.mesh !== hostMesh)) {
        releaseBound(id)
        entry = undefined
      }
      if (!entry) {
        const isPlane = node.kind === 'plane'
        const handle = createWaterMaterial()
        hostMesh.add(handle.reflectionTarget)
        entry = {
          kind: 'hosted',
          mesh: hostMesh,
          originalMaterial: hostMesh.material,
          originalGeometry: hostMesh.geometry,
          isPlane,
          handle,
        }
        boundMeshes.set(id, entry)
      }
      if (entry.isPlane && hostMesh.geometry !== getSharedPlaneGeometry()) {
        hostMesh.geometry = getSharedPlaneGeometry()
      }
      if (hostMesh.material !== entry.handle.material) {
        hostMesh.material = entry.handle.material
      }
      hostMesh.castShadow = false
      hostMesh.receiveShadow = false
    }

    const customNormal = spec.normalMapAssetId ? textureFor(spec.normalMapAssetId, false) : null
    const customFoam = spec.foamMapAssetId ? textureFor(spec.foamMapAssetId, false) : null
    entry.handle.setSpec(spec, customNormal, customFoam)
    entry.handle.setTime(waterTime)
    entry.handle.setSun(tmpSunDir, tmpSunColor, sunIntensity)
  }
}

export function mount(): () => void {
  if (!removeBeforeRender) {
    removeBeforeRender = registerBeforeRenderHook('water', 30, onBeforeRender)
  }
  return dispose
}

export function dispose() {
  if (removeBeforeRender) {
    removeBeforeRender()
    removeBeforeRender = null
  }
  for (const id of [...boundMeshes.keys()]) releaseBound(id)
  sharedPlaneGeo?.dispose()
  sharedPlaneGeo = null
}

const waterRuntimeModule: CapabilityRuntimeModule = { mount, dispose }
export default waterRuntimeModule
