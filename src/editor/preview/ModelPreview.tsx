import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  AnimationMixer,
  AxesHelper,
  BoxHelper,
  Color,
  DirectionalLight,
  GridHelper,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SkinnedMesh,
  Vector2,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type Material,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { reimportModel, setModelImportScale, setModelSockets } from '../assets/import'
import { useAssetStore, type ModelSocket } from '../assets/library'
import { MaterialBall } from '../assets/materialBall'
import { applyModelMaterials } from '../assets/materials'
import { getModelTemplate, instantiateModel, subscribeModels } from '../assets/models'
import { boundsOf, prepareSkinnedPickBounds } from '../scene/bounds'
import { useI18n } from '../i18n'
import { popPreviewWindow } from './previewStore'

type Shading = 'lit' | 'wire' | 'unlit'
type View = 'persp' | 'front' | 'top' | 'right'
interface MeshFact {
  name: string
  triangles: number
  vertices: number
  uv: boolean
  normal: boolean
  tangent: boolean
  color: boolean
}

interface BoneFact {
  name: string
  parent: string
}

interface ModelFacts {
  triangles: number
  vertices: number
  meshes: MeshFact[]
  bones: BoneFact[]
  morphs: number
  size: [number, number, number]
  humanoid: boolean
}

const TABS = [
  ['overview', 'preview.tabOverview'],
  ['mesh', 'preview.tabMesh'],
  ['anim', 'preview.tabAnim'],
  ['material', 'preview.tabMaterial'],
  ['socket', 'preview.tabSocket'],
  ['import', 'preview.tabImport'],
] as const
const SCALES = [0.01, 0.1, 1, 10, 100]

export function ModelPreview({ assetId, standalone = false }: { assetId: string, standalone?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const api = useRef<PreviewApi | null>(null)
  const { t } = useI18n()
  const asset = useAssetStore(state => state.assets[assetId])
  const importScale = asset && 'importScale' in asset && typeof asset.importScale === 'number' && asset.importScale > 0 ? asset.importScale : 1
  const sockets = asset && 'sockets' in asset ? asset.sockets ?? [] : []
  const fileName = asset && 'fileName' in asset ? asset.fileName : ''
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('overview')
  const [shading, setShading] = useState<Shading>('lit')
  const [grid, setGrid] = useState(true)
  const [bounds, setBounds] = useState(false)
  const [turntable, setTurntable] = useState(false)
  const [yaw, setYaw] = useState(35)
  const [facts, setFacts] = useState<ModelFacts | null>(null)
  const [ready, setReady] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [solo, setSolo] = useState<string | null>(null)
  const [bone, setBone] = useState<string | null>(null)
  const [clip, setClip] = useState('')
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [time, setTime] = useState(0)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setClearColor(0x141414)
    const scene = new Scene()
    scene.background = new Color(0x141414)
    const camera = new PerspectiveCamera(45, 1, 0.01, 500)
    camera.position.set(3, 2, 4)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    const ambient = new AmbientLight(0xffffff, 0.45)
    const sun = new DirectionalLight(0xffffff, 1.4)
    sun.position.set(3, 5, 2)
    scene.add(ambient, sun)
    const gridHelper = new GridHelper(10, 10, 0x3a4450, 0x2a313a)
    scene.add(gridHelper)
    let root: Object3D | null = null
    let box: BoxHelper | null = null
    let frame = 0
    let mode: Shading = 'lit'
    let spin = false
    let mixer: AnimationMixer | null = null
    let action: AnimationAction | null = null
    let axes: AxesHelper | null = null
    const raycaster = new Raycaster()
    const pointer = new Vector2()

    const fit = (view: View) => {
      if (!root) return
      const boundsBox = boundsOf(root)
      const center = boundsBox.getCenter(new Vector3())
      const extent = boundsBox.getSize(new Vector3()).length()
      if (boundsBox.isEmpty() || !Number.isFinite(center.x) || !Number.isFinite(extent) || extent <= 1e-8) {
        controls.target.set(0, 0, 0)
        camera.position.set(3, 2, 4)
        camera.near = 0.01
        camera.far = 500
        camera.updateProjectionMatrix()
        controls.update()
        return
      }
      const radius = extent * 0.5
      const distance = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.35
      controls.target.copy(center)
      if (view === 'front') camera.position.set(center.x, center.y, center.z + distance)
      else if (view === 'top') camera.position.set(center.x, center.y + distance, center.z + distance * 0.001)
      else if (view === 'right') camera.position.set(center.x + distance, center.y, center.z)
      else camera.position.set(center.x + distance * 0.7, center.y + distance * 0.45, center.z + distance * 0.7)
      camera.near = Math.max(distance * 0.01, 1e-5)
      camera.far = Math.max(distance * 40, 50)
      camera.updateProjectionMatrix()
      controls.update()
    }
    const applyShading = () => {
      if (!root) return
      root.traverse(child => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        const original = (mesh.userData.previewLit ?? mesh.material) as Material | Material[]
        mesh.userData.previewLit = original
        if (mode === 'unlit') {
          const source = Array.isArray(original) ? original[0] : original
          const basic = mesh.userData.previewBasic as MeshBasicMaterial | undefined
            ?? new MeshBasicMaterial({ color: (source as { color?: Color }).color ?? '#ffffff', map: (source as { map?: MeshBasicMaterial['map'] }).map ?? null })
          mesh.userData.previewBasic = basic
          mesh.material = basic
          return
        }
        mesh.material = original
        const list = Array.isArray(original) ? original : [original]
        for (const item of list) (item as Material & { wireframe?: boolean }).wireframe = mode === 'wire'
      })
    }
    const paintPick = (name: string | null) => {
      if (!root) return
      root.traverse(child => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        const hidden = Boolean(name && soloName && mesh.name !== soloName)
        mesh.visible = !hidden
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
        const colored = material as { emissive?: Color }
        colored.emissive?.set(name && mesh.name === name ? '#4a9eff' : '#000000')
      })
    }
    let soloName: string | null = null
    const mount = () => {
      const instance = instantiateModel(assetId)
      if (!instance) {
        setReady(false)
        return
      }
      if (root) scene.remove(root)
      box?.removeFromParent()
      axes?.removeFromParent()
      mixer?.stopAllAction()
      root = instance.object
      const currentScale = useAssetStore.getState().assets[assetId]
      const scale = currentScale && 'importScale' in currentScale && typeof currentScale.importScale === 'number' && currentScale.importScale > 0 ? currentScale.importScale : 1
      root.scale.setScalar(scale)
      root.traverse(child => {
        const mesh = child as SkinnedMesh
        if (mesh.isSkinnedMesh) mesh.frustumCulled = false
      })
      scene.add(root)
      prepareSkinnedPickBounds(root)
      box = new BoxHelper(root, 0x4a9eff)
      box.visible = false
      scene.add(box)
      mixer = new AnimationMixer(root)
      const facts = readFacts(root, getModelTemplate(assetId)?.humanoid.avatar?.slots.Hips ? true : false)
      setFacts(facts)
      setClip(current => current || getModelTemplate(assetId)?.clips[0]?.name || '')
      setReady(true)
      applyShading()
      fit('persp')
    }
    api.current = {
      reset: () => fit('persp'),
      view: fit,
      setShading: next => { mode = next; applyShading() },
      setGrid: on => { gridHelper.visible = on },
      setBounds: on => { if (box) box.visible = on },
      setTurn: on => { spin = on },
      setYaw: next => {
        const rad = next * Math.PI / 180
        sun.position.set(Math.cos(rad) * 4, 4, Math.sin(rad) * 4)
      },
      setScale: scale => {
        if (!root) return
        root.scale.setScalar(scale)
        prepareSkinnedPickBounds(root)
        fit('persp')
      },
      highlight: name => paintPick(name),
      solo: name => { soloName = name; paintPick(name) },
      showBone: name => {
        axes?.removeFromParent()
        axes = null
        if (!root || !name) return
        const matches: Object3D[] = []
        root.traverse(child => { if (child.name === name) matches.push(child) })
        const found = matches[0]
        if (!found) return
        axes = new AxesHelper(0.25)
        found.add(axes)
      },
      play: (name, nextLoop, nextSpeed) => {
        if (!mixer || !root) return 0
        const source = getModelTemplate(assetId)?.clips.find(item => item.name === name)
        if (!source) return 0
        action?.stop()
        action = mixer.clipAction(source)
        action.setLoop(nextLoop ? LoopRepeat : LoopOnce, nextLoop ? Infinity : 1)
        action.clampWhenFinished = !nextLoop
        action.timeScale = nextSpeed
        action.reset().play()
        return source.duration
      },
      pause: on => { if (action) action.paused = on },
      scrub: next => { if (action && mixer) { action.time = next; mixer.update(0) } },
      speed: next => { if (action) action.timeScale = next },
      clock: () => action?.time ?? 0,
    }
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect || rect.width < 2 || rect.height < 2) return
      renderer.setSize(rect.width, rect.height, false)
      camera.aspect = rect.width / Math.max(rect.height, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    if (canvas.parentElement) observer.observe(canvas.parentElement)
    resize()
    const onClick = (event: PointerEvent) => {
      if (!root) return
      const rect = canvas.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(root, true).find(item => (item.object as Mesh).isMesh)
      const name = hit?.object.name ?? null
      setPicked(name)
      paintPick(soloName ?? name)
    }
    canvas.addEventListener('pointerdown', onClick)
    const stop = subscribeModels(mount)
    const stopAssets = useAssetStore.subscribe(() => {
      if (!root) return
      const currentSlots = getModelTemplate(assetId)?.slots
      if (currentSlots) applyModelMaterials(root, currentSlots)
    })
    mount()
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (spin && root) root.rotation.y += 0.006
      if (mixer && action && !action.paused) {
        mixer.update(dt)
        setTime(action.time)
      }
      if (root && box?.visible) {
        prepareSkinnedPickBounds(root)
        box.update()
      }
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      stop()
      stopAssets()
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onClick)
      controls.dispose()
      renderer.dispose()
      api.current = null
    }
  }, [assetId, reload])

  useEffect(() => { api.current?.setShading(shading) }, [shading])
  useEffect(() => { api.current?.setGrid(grid) }, [grid])
  useEffect(() => { api.current?.setBounds(bounds) }, [bounds])
  useEffect(() => { api.current?.setTurn(turntable) }, [turntable])
  useEffect(() => { api.current?.setYaw(yaw) }, [yaw])
  useEffect(() => { api.current?.setScale(importScale) }, [importScale])
  useEffect(() => { api.current?.highlight(picked) }, [picked])
  useEffect(() => { api.current?.solo(solo) }, [solo])
  useEffect(() => { api.current?.showBone(bone) }, [bone])

  const clips = getModelTemplate(assetId)?.clips ?? []
  const slots = getModelTemplate(assetId)?.slots ?? []
  const advice = facts ? scaleAdvice(facts, importScale) : null
  const play = (name: string) => {
    setClip(name)
    setPlaying(true)
    api.current?.play(name, loop, speed)
  }

  return (
    <div className="model-preview">
      <div className="model-preview__stage">
        <canvas ref={canvasRef} />
        {!ready && <div className="preview-view__empty">{t('preview.pendingModel')}</div>}
        {facts && <div className="model-preview__hud">{facts.size.map(value => formatMeters(value * importScale)).join(' × ')} m</div>}
        <div className="model-preview__toolbar">
          <div className="model-preview__pills">
            {(['lit', 'wire', 'unlit'] as const).map(mode => (
              <button key={mode} type="button" className={shading === mode ? 'is-on' : ''} onClick={() => setShading(mode)}>{t(`preview.${mode}`)}</button>
            ))}
          </div>
          <div className="model-preview__pills">
            <button type="button" className={grid ? 'is-on' : ''} onClick={() => setGrid(value => !value)}>{t('view.grid')}</button>
            <button type="button" className={bounds ? 'is-on' : ''} onClick={() => setBounds(value => !value)}>{t('preview.bounds')}</button>
            <button type="button" className={turntable ? 'is-on' : ''} onClick={() => setTurntable(value => !value)}>{t('preview.turn')}</button>
          </div>
          <div className="model-preview__pills">
            <button type="button" onClick={() => api.current?.view('front')}>{t('view.front')}</button>
            <button type="button" onClick={() => api.current?.view('top')}>{t('view.top')}</button>
            <button type="button" onClick={() => api.current?.view('right')}>{t('view.right')}</button>
            <button type="button" onClick={() => api.current?.reset()}>{t('preview.reset')}</button>
          </div>
          <label className="model-preview__light">{t('preview.light')}<input type="range" min={0} max={360} value={yaw} onChange={event => setYaw(Number(event.target.value))} /><code>{yaw}</code></label>
          {!standalone && <button type="button" className="model-preview__pills" onClick={() => popPreviewWindow('model', assetId)}>{t('preview.popout')}</button>}
        </div>
        {advice && (
          <div className="model-preview__notice">
            <span>{t('preview.scaleHint', { height: formatMeters(advice.height), scale: advice.scale })}</span>
            <button type="button" onClick={() => setModelImportScale(assetId, advice.scale)}>{t('preview.useScale', { scale: advice.scale })}</button>
          </div>
        )}
      </div>
      <aside className="model-preview__side">
        <div className="model-preview__tabs">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{t(label)}</button>
          ))}
        </div>
        <div className="model-preview__body">
          {tab === 'overview' && facts && (
            <>
              <div className="model-preview__stats">
                <Stat label={t('preview.triangles')} value={facts.triangles.toLocaleString()} />
                <Stat label={t('preview.vertices')} value={facts.vertices.toLocaleString()} />
                <Stat label={t('preview.meshes')} value={String(facts.meshes.length)} />
                <Stat label={t('preview.slots')} value={String(slots.length)} />
                <Stat label={t('preview.bones')} value={String(facts.bones.length)} />
                <Stat label={t('preview.tabAnim')} value={String(clips.length)} />
              </div>
              <div className="model-preview__caps">
                <span className={facts.meshes.some(mesh => mesh.uv) ? 'is-on' : ''}>UV</span>
                <span className={facts.meshes.some(mesh => mesh.normal) ? 'is-on' : ''}>Normal</span>
                <span className={facts.meshes.some(mesh => mesh.tangent) ? 'is-on' : ''}>Tangent</span>
                <span className={facts.humanoid ? 'is-on' : ''}>{t('preview.bones')}</span>
              </div>
            </>
          )}
          {tab === 'mesh' && (
            facts && facts.meshes.length > 0 ? facts.meshes.map(mesh => (
              <button
                key={mesh.name}
                type="button"
                className={`model-preview__card ${picked === mesh.name ? 'is-on' : ''} ${solo === mesh.name ? 'is-solo' : ''}`}
                onClick={() => setPicked(mesh.name)}
                onDoubleClick={() => setSolo(current => current === mesh.name ? null : mesh.name)}
              >
                <strong>{mesh.name || t('preview.meshes')}</strong>
                <em>{mesh.triangles.toLocaleString()}</em>
                <small>UV {mesh.uv ? 1 : 0} · {mesh.tangent ? 'Tangent' : '—'}</small>
              </button>
            )) : <p className="model-preview__empty">{t('preview.noMesh')}</p>
          )}
          {tab === 'anim' && (
            <>
              {clips.length > 0 ? clips.map(item => (
                <button key={item.name} type="button" className={`model-preview__card ${clip === item.name ? 'is-on' : ''}`} onClick={() => play(item.name)}>
                  <strong>{item.name}</strong>
                  <em>{item.duration.toFixed(2)}s</em>
                </button>
              )) : <p className="model-preview__empty">{t('preview.noClip')}</p>}
              {clips.length > 0 && (
                <div className="model-preview__play">
                  <button type="button" className={playing ? 'is-on' : ''} onClick={() => { setPlaying(value => !value); api.current?.pause(playing) }}>{playing ? t('inspector.pause') : t('inspector.play')}</button>
                  <label><input type="checkbox" checked={loop} onChange={event => { setLoop(event.target.checked); if (clip) api.current?.play(clip, event.target.checked, speed) }} />{t('anim.loop')}</label>
                  <select value={speed} onChange={event => { const next = Number(event.target.value); setSpeed(next); api.current?.speed(next) }}>
                    {[0.25, 0.5, 1, 1.5, 2].map(value => <option key={value} value={value}>{value}x</option>)}
                  </select>
                  <input type="range" min={0} max={clips.find(item => item.name === clip)?.duration || 1} step={0.01} value={time} onChange={event => { const next = Number(event.target.value); setTime(next); setPlaying(false); api.current?.pause(true); api.current?.scrub(next) }} />
                </div>
              )}
            </>
          )}
          {tab === 'material' && slots.map(slot => (
            <div key={slot.name} className="model-preview__card">
              <MaterialBall slot={slot} />
              <strong>{slot.name}</strong>
            </div>
          ))}
          {tab === 'socket' && (
            <>
              {sockets.length === 0 && <p className="model-preview__empty">{t('preview.socketEmpty')}</p>}
              {sockets.map(socket => (
                <div key={socket.id} className={`model-preview__card ${bone === socket.bone ? 'is-on' : ''}`}>
                  <button type="button" onClick={() => setBone(socket.bone)}>{socket.name}</button>
                  <em>{socket.bone}</em>
                  <button type="button" onClick={() => setModelSockets(assetId, sockets.filter(item => item.id !== socket.id))}>×</button>
                </div>
              ))}
              {(facts?.bones.length ?? 0) === 0 && <p className="model-preview__empty">{t('preview.noBone')}</p>}
              {facts?.bones.map(item => (
                <div key={item.name} className={`model-preview__card ${bone === item.name ? 'is-on' : ''}`}>
                  <button type="button" onClick={() => setBone(item.name)}>{item.name}</button>
                  <em>{item.parent}</em>
                  <button type="button" onClick={() => addSocket(assetId, sockets, item.name)}>+</button>
                </div>
              ))}
            </>
          )}
          {tab === 'import' && (
            <div className="model-preview__import">
              <div className="model-preview__field">
                <label>{t('preview.importScale')}</label>
                <input type="number" min={0.001} step={0.01} value={importScale} onChange={event => setModelImportScale(assetId, Number(event.target.value))} />
              </div>
              <div className="model-preview__scales">
                {SCALES.map(value => (
                  <button key={value} type="button" className={Math.abs(importScale - value) < 1e-4 ? 'is-on' : ''} onClick={() => setModelImportScale(assetId, value)}>{value}x</button>
                ))}
              </div>
              {facts && <p>{t('preview.scaleHint', { height: formatMeters(facts.size[1] * importScale), scale: advice?.scale ?? importScale })}</p>}
              <div className="model-preview__field"><label>{t('preview.source')}</label><span>{fileName}</span></div>
              <button type="button" className="model-preview__reimport" onClick={() => { void reimportModel(assetId).then(() => setReload(value => value + 1)) }}>{t('preview.reimport')}</button>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function Stat({ label, value }: { label: string, value: string }) {
  return (
    <div className="model-preview__stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

interface PreviewApi {
  reset: () => void
  view: (view: View) => void
  setShading: (mode: Shading) => void
  setGrid: (on: boolean) => void
  setBounds: (on: boolean) => void
  setTurn: (on: boolean) => void
  setYaw: (yaw: number) => void
  setScale: (scale: number) => void
  highlight: (name: string | null) => void
  solo: (name: string | null) => void
  showBone: (name: string | null) => void
  play: (name: string, loop: boolean, speed: number) => number
  pause: (on: boolean) => void
  scrub: (time: number) => void
  speed: (speed: number) => void
  clock: () => number
}

function readFacts(root: Object3D, humanoid: boolean): ModelFacts {
  const meshes: MeshFact[] = []
  const bones: BoneFact[] = []
  let triangles = 0
  let vertices = 0
  let morphs = 0
  root.traverse(child => {
    const mesh = child as Mesh
    if (mesh.isMesh) {
      const geometry = mesh.geometry
      const position = geometry.getAttribute('position')
      const count = geometry.index ? geometry.index.count / 3 : (position?.count ?? 0) / 3
      triangles += count
      vertices += position?.count ?? 0
      morphs += geometry.morphAttributes.position?.length ?? 0
      meshes.push({
        name: mesh.name || `Mesh ${meshes.length + 1}`,
        triangles: Math.round(count),
        vertices: position?.count ?? 0,
        uv: Boolean(geometry.getAttribute('uv')),
        normal: Boolean(geometry.getAttribute('normal')),
        tangent: Boolean(geometry.getAttribute('tangent')),
        color: Boolean(geometry.getAttribute('color')),
      })
    }
    const skinned = child as SkinnedMesh
    if (skinned.isSkinnedMesh) {
      for (const bone of skinned.skeleton?.bones ?? []) {
        if (bones.some(item => item.name === bone.name)) continue
        bones.push({ name: bone.name, parent: bone.parent?.name ?? '' })
      }
    }
  })
  const size = boundsOf(root).getSize(new Vector3())
  const scale = root.scale.x || 1
  return {
    triangles: Math.round(triangles),
    vertices,
    meshes,
    bones,
    morphs,
    size: [size.x / scale, size.y / scale, size.z / scale],
    humanoid,
  }
}

function formatMeters(value: number) {
  const abs = Math.abs(value)
  if (!Number.isFinite(abs)) return '0'
  if (abs >= 100) return value.toFixed(1)
  if (abs >= 0.01) return value.toFixed(2)
  if (abs === 0) return '0'
  return value.toFixed(4)
}

function scaleAdvice(facts: ModelFacts, scale: number): { scale: number, height: number } | null {
  const height = facts.size[1] * scale
  const extent = Math.max(facts.size[0], facts.size[1], facts.size[2]) * scale
  if (facts.humanoid && height >= 0.008 && height < 0.04) return { scale: Number((scale * 100).toFixed(4)), height }
  if (facts.humanoid && height >= 0.04 && height < 0.45) return { scale: Number((scale * 10).toFixed(4)), height }
  if (facts.humanoid && height > 8 && height <= 20) return { scale: Number((scale * 0.1).toFixed(4)), height }
  if (facts.humanoid && height > 20 && height < 400) return { scale: Number((scale * 0.01).toFixed(4)), height }
  if (!facts.humanoid && (extent < 0.05 || extent > 120)) {
    const next = extent < 0.05 ? 10 : 0.01
    return { scale: Number((scale * next).toFixed(4)), height }
  }
  return null
}

function addSocket(assetId: string, sockets: ModelSocket[], bone: string) {
  if (sockets.some(item => item.bone === bone)) return
  setModelSockets(assetId, [...sockets, { id: crypto.randomUUID(), name: bone, bone }])
}
