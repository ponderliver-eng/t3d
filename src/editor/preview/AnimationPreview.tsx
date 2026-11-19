import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Repeat } from 'lucide-react'
import {
  AmbientLight,
  AnimationMixer,
  BufferAttribute,
  Color,
  DirectionalLight,
  GridHelper,
  IntType,
  LoopOnce,
  LoopRepeat,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  SkinnedMesh,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { clipsForSkeleton } from '../animation/humanoidPlayback'
import { useAssetStore, type FileAsset } from '../assets/library'
import { applyModelMaterials } from '../assets/materials'
import { getModelTemplate, instantiateModel, loadModelTemplate, subscribeModels } from '../assets/models'
import { useI18n } from '../i18n'
import { boundsOf, prepareSkinnedPickBounds } from '../scene/bounds'
import { useEditorStore } from '../scene/store'
import { popPreviewWindow } from './previewStore'

export function AnimationPreview({ assetId, standalone = false }: { assetId: string, standalone?: boolean }) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const assets = useAssetStore(state => state.assets)
  const selection = useEditorStore(state => state.selection)
  const nodes = useEditorStore(state => state.nodes)
  const models = useMemo(
    () => Object.values(assets).filter((item): item is FileAsset => item.kind === 'model').sort((a, b) => a.name.localeCompare(b.name)),
    [assets],
  )
  const preferredModelId = useMemo(() => {
    for (const id of selection) {
      const node = nodes[id]
      if (node?.kind === 'model' && node.assetId && assets[node.assetId]?.kind === 'model') return node.assetId
    }
    const humanoid = models.find(item => Boolean(item.humanoidAvatar?.slots.Hips))
    return humanoid?.id ?? models[0]?.id ?? ''
  }, [assets, models, nodes, selection])

  const [actorId, setActorId] = useState(preferredModelId)
  const [clipName, setClipName] = useState('')
  const [clips, setClips] = useState<string[]>([])
  const [playing, setPlaying] = useState(true)
  const [loop, setLoop] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!actorId && preferredModelId) setActorId(preferredModelId)
  }, [actorId, preferredModelId])

  const ctrlRef = useRef<{
    play: (name: string, loopOn: boolean, spd: number) => number
    pause: (paused: boolean) => void
    scrub: (t: number) => void
    setSpeed: (spd: number) => void
  } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !actorId) return
    const renderer = new WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setClearColor(0x141414)
    const scene = new Scene()
    scene.background = new Color(0x141414)
    const camera = new PerspectiveCamera(45, 1, 0.01, 500)
    camera.position.set(2.5, 1.8, 3.2)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    const ambient = new AmbientLight(0xffffff, 0.5)
    const sun = new DirectionalLight(0xffffff, 1.4)
    sun.position.set(3, 5, 2)
    scene.add(ambient, sun)
    const grid = new GridHelper(10, 10, 0x3a4450, 0x2a313a)
    scene.add(grid)

    let root: Object3D | null = null
    let mixer: AnimationMixer | null = null
    let action: AnimationAction | null = null
    let frame = 0
    let requestedSource = false
    let requestedActor = false

    const disposeMaterials = (target: Object3D | null) => {
      if (!target) return
      target.traverse(child => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        if (mesh.userData.previewGeometryCloned) mesh.geometry?.dispose()
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const item of list) item?.dispose()
      })
    }

    const fit = (target: Object3D) => {
      const box = boundsOf(target)
      const center = box.getCenter(new Vector3())
      const extent = box.getSize(new Vector3()).length()
      if (box.isEmpty() || !Number.isFinite(extent) || extent <= 1e-6) return
      const distance = (extent * 0.5) / Math.tan((camera.fov * Math.PI) / 360) * 1.4
      controls.target.copy(center)
      camera.position.set(center.x + distance * 0.65, center.y + distance * 0.35, center.z + distance * 0.7)
      camera.near = Math.max(distance * 0.01, 1e-5)
      camera.far = Math.max(distance * 40, 50)
      camera.updateProjectionMatrix()
      controls.update()
    }

    const mount = () => {
      const sourceTpl = getModelTemplate(assetId)
      if (!sourceTpl && !requestedSource) {
        requestedSource = true
        const src = useAssetStore.getState().assets[assetId]
        if (src && 'fileName' in src) void loadModelTemplate(src).catch(() => undefined)
      }
      const instance = instantiateModel(actorId)
      if (!instance) {
        setReady(false)
        if (!requestedActor) {
          requestedActor = true
          const act = useAssetStore.getState().assets[actorId]
          if (act && 'fileName' in act) void loadModelTemplate(act).catch(() => undefined)
        }
        return
      }
      if (!sourceTpl) return
      if (root) {
        scene.remove(root)
        disposeMaterials(root)
      }
      mixer?.stopAllAction()
      root = instance.object
      const actorAsset = useAssetStore.getState().assets[actorId]
      const scale = actorAsset && 'importScale' in actorAsset && typeof actorAsset.importScale === 'number' && actorAsset.importScale > 0 ? actorAsset.importScale : 1
      root.scale.setScalar(scale)
      root.traverse(child => {
        child.visible = true
        const mesh = child as SkinnedMesh
        if (mesh.isSkinnedMesh) mesh.frustumCulled = false
        if (mesh.isMesh && mesh.geometry) {
          const skinIndex = mesh.geometry.attributes.skinIndex as (BufferAttribute & { gpuType?: number, isInterleavedBufferAttribute?: boolean }) | undefined
          if (skinIndex && (skinIndex.array instanceof Uint32Array || skinIndex.array instanceof Int32Array || skinIndex.array instanceof Uint16Array || skinIndex.gpuType === IntType || skinIndex.isInterleavedBufferAttribute)) {
            const cloned = mesh.geometry.clone()
            const next = new Float32Array(skinIndex.count * 4)
            for (let i = 0; i < skinIndex.count; i += 1) {
              next[i * 4] = skinIndex.getX(i)
              next[i * 4 + 1] = skinIndex.getY(i)
              next[i * 4 + 2] = skinIndex.getZ(i)
              next[i * 4 + 3] = skinIndex.getW(i)
            }
            cloned.setAttribute('skinIndex', new BufferAttribute(next, 4, false))
            mesh.geometry = cloned
            mesh.userData.previewGeometryCloned = true
          }
        }
      })
      scene.add(root)
      prepareSkinnedPickBounds(root)
      const slots = getModelTemplate(actorId)?.slots
      if (slots) applyModelMaterials(root, slots)
      mixer = new AnimationMixer(root)
      const available = clipsForSkeleton(assetId, actorId)
      const names = available.map(item => item.name)
      setClips(names)
      const first = names[0] ?? ''
      setClipName(current => (current && names.includes(current) ? current : first))
      setReady(true)
      fit(root)
      const playClip = available.find(item => item.name === first)
      if (playClip) {
        action = mixer.clipAction(playClip)
        action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1)
        action.clampWhenFinished = !loop
        action.timeScale = speed
        action.reset().play()
        setDuration(playClip.duration)
        setPlaying(true)
      }
    }

    ctrlRef.current = {
      play: (name, loopOn, spd) => {
        if (!mixer) return 0
        const found = clipsForSkeleton(assetId, actorId).find(item => item.name === name)
        if (!found) return 0
        action?.stop()
        action = mixer.clipAction(found)
        action.setLoop(loopOn ? LoopRepeat : LoopOnce, loopOn ? Infinity : 1)
        action.clampWhenFinished = !loopOn
        action.timeScale = spd
        action.reset().play()
        return found.duration
      },
      pause: paused => { if (action) action.paused = paused },
      scrub: next => { if (action && mixer) { action.time = next; mixer.update(0) } },
      setSpeed: spd => { if (action) action.timeScale = spd },
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
    const stopModels = subscribeModels(mount)
    const stopAssets = useAssetStore.subscribe(() => {
      if (!root) return
      const slots = getModelTemplate(actorId)?.slots
      if (slots) applyModelMaterials(root, slots)
    })
    mount()

    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (mixer && action && !action.paused) {
        mixer.update(dt)
        setTime(action.time)
      }
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      stopModels()
      stopAssets()
      observer.disconnect()
      mixer?.stopAllAction()
      disposeMaterials(root)
      grid.dispose()
      controls.dispose()
      renderer.dispose()
      ctrlRef.current = null
    }
  }, [actorId, assetId])

  useEffect(() => {
    ctrlRef.current?.pause(!playing)
  }, [playing])

  useEffect(() => {
    ctrlRef.current?.setSpeed(speed)
  }, [speed])

  return (
    <div className="preview-view">
      <div className="preview-view__stage">
        <canvas ref={canvasRef} />
        {!actorId && <div className="preview-view__empty">{t('preview.noActor')}</div>}
        {actorId && !ready && <div className="preview-view__empty">{t('preview.loading')}</div>}
      </div>
      <div className="preview-view__bar">
        <label className="tex-edit__field">
          <span>{t('preview.actor')}</span>
          <select value={actorId} onChange={event => setActorId(event.target.value)}>
            {models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {clips.length > 1 && (
          <select
            value={clipName}
            onChange={event => {
              const next = event.target.value
              setClipName(next)
              const dur = ctrlRef.current?.play(next, loop, speed) ?? 0
              setDuration(dur)
              setPlaying(true)
            }}
          >
            {clips.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
        <button type="button" className="tex-edit__icon" onClick={() => setPlaying(value => !value)}>
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0.01, duration)}
          step={0.01}
          value={Math.min(time, Math.max(0.01, duration))}
          onChange={event => {
            const next = Number(event.target.value)
            setTime(next)
            setPlaying(false)
            ctrlRef.current?.pause(true)
            ctrlRef.current?.scrub(next)
          }}
        />
        <button
          type="button"
          className={`tex-edit__icon${loop ? ' is-on' : ''}`}
          title={t('anim.loop')}
          onClick={() => {
            const next = !loop
            setLoop(next)
            if (clipName) {
              const dur = ctrlRef.current?.play(clipName, next, speed) ?? 0
              setDuration(dur)
              setPlaying(true)
            }
          }}
        >
          <Repeat size={13} />
        </button>
        <select value={speed} onChange={event => setSpeed(Number(event.target.value))}>
          {[0.25, 0.5, 1, 1.5, 2].map(v => <option key={v} value={v}>{v}x</option>)}
        </select>
        {!standalone && (
          <button type="button" className="tex-edit__ghost" onClick={() => popPreviewWindow('animation', assetId)}>
            {t('preview.popout')}
          </button>
        )}
      </div>
    </div>
  )
}
