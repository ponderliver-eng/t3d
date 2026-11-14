import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  Box3,
  BoxHelper,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { instantiateModel, subscribeModels } from '../assets/models'
import { popPreviewWindow } from './previewStore'

type Shading = 'lit' | 'wire' | 'unlit'
type View = 'persp' | 'front' | 'top' | 'right'

export function ModelPreview({ assetId, standalone = false }: { assetId: string, standalone?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const api = useRef<{ reset: () => void, view: (view: View) => void, setShading: (mode: Shading) => void, setGrid: (on: boolean) => void, setBounds: (on: boolean) => void, setTurn: (on: boolean) => void, setYaw: (yaw: number) => void } | null>(null)
  const [shading, setShading] = useState<Shading>('lit')
  const [grid, setGrid] = useState(true)
  const [bounds, setBounds] = useState(false)
  const [turntable, setTurntable] = useState(false)
  const [yaw, setYaw] = useState(35)
  const [stats, setStats] = useState('')
  const [ready, setReady] = useState(false)

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
    const raycaster = new Raycaster()
    const pointer = new Vector2()

    const fit = (view: View) => {
      if (!root) return
      const boundsBox = new Box3().setFromObject(root)
      const center = boundsBox.getCenter(new Vector3())
      const size = boundsBox.getSize(new Vector3())
      const radius = Math.max(size.length() * 0.5, 0.5)
      controls.target.copy(center)
      const distance = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.35
      if (view === 'front') camera.position.set(center.x, center.y, center.z + distance)
      else if (view === 'top') camera.position.set(center.x, center.y + distance, center.z + 0.01)
      else if (view === 'right') camera.position.set(center.x + distance, center.y, center.z)
      else camera.position.set(center.x + distance * 0.7, center.y + distance * 0.45, center.z + distance * 0.7)
      camera.near = Math.max(distance / 200, 0.01)
      camera.far = Math.max(distance * 20, 100)
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
        for (const item of list) {
          const wire = item as Material & { wireframe?: boolean }
          wire.wireframe = mode === 'wire'
        }
      })
    }

    const mount = () => {
      const instance = instantiateModel(assetId)
      if (!instance) {
        setReady(false)
        return
      }
      if (root) scene.remove(root)
      box?.removeFromParent()
      root = instance.object
      scene.add(root)
      box = new BoxHelper(root, 0x4a9eff)
      box.visible = false
      scene.add(box)
      let triangles = 0
      root.traverse(child => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        const index = mesh.geometry.index
        const positions = mesh.geometry.getAttribute('position')
        triangles += index ? index.count / 3 : (positions?.count ?? 0) / 3
      })
      const size = new Box3().setFromObject(root).getSize(new Vector3())
      setStats(`${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m · ${Math.round(triangles).toLocaleString()} 面`)
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
    }
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect || rect.width < 2) return
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
      root.traverse(child => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
        const colored = material as { emissive?: Color }
        colored.emissive?.set(hit?.object === mesh ? '#4a9eff' : '#000000')
      })
    }
    canvas.addEventListener('pointerdown', onClick)
    const stop = subscribeModels(mount)
    mount()
    const tick = () => {
      if (spin && root) root.rotation.y += 0.006
      box?.update()
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      stop()
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onClick)
      controls.dispose()
      renderer.dispose()
      api.current = null
    }
  }, [assetId])

  useEffect(() => { api.current?.setShading(shading) }, [shading])
  useEffect(() => { api.current?.setGrid(grid) }, [grid])
  useEffect(() => { api.current?.setBounds(bounds) }, [bounds])
  useEffect(() => { api.current?.setTurn(turntable) }, [turntable])
  useEffect(() => { api.current?.setYaw(yaw) }, [yaw])

  return (
    <div className="preview-view">
      <div className="preview-view__stage">
        <canvas ref={canvasRef} />
        {stats && <div className="preview-view__chip">{stats}</div>}
        {!ready && <div className="preview-view__empty">模型还在读取</div>}
      </div>
      <div className="preview-view__bar">
        <select value={shading} onChange={event => setShading(event.target.value as Shading)}>
          <option value="lit">光照</option>
          <option value="wire">线框</option>
          <option value="unlit">无光</option>
        </select>
        <button type="button" className={grid ? 'is-on' : ''} onClick={() => setGrid(value => !value)}>网格</button>
        <button type="button" className={bounds ? 'is-on' : ''} onClick={() => setBounds(value => !value)}>包围盒</button>
        <button type="button" className={turntable ? 'is-on' : ''} onClick={() => setTurntable(value => !value)}>旋转</button>
        <button type="button" onClick={() => api.current?.view('front')}>前</button>
        <button type="button" onClick={() => api.current?.view('top')}>顶</button>
        <button type="button" onClick={() => api.current?.view('right')}>右</button>
        <button type="button" onClick={() => api.current?.reset()}>复位</button>
        <label>灯光 <input type="range" min={0} max={360} value={yaw} onChange={event => setYaw(Number(event.target.value))} /></label>
        {!standalone && <button type="button" onClick={() => popPreviewWindow('model', assetId)}>独立窗口</button>}
      </div>
    </div>
  )
}
