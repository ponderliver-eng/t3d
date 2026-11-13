import { useEffect, useRef } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three'
import { useEditorStore } from '../scene/store'
import type { CameraView } from '../scene/types'
import { viewCubePose } from './viewCubeBridge'

const FACES: { view: CameraView; label: string; position: [number, number, number]; rotation: [number, number, number] }[] = [
  { view: 'front', label: '前', position: [0, 0, 0.5], rotation: [0, 0, 0] },
  { view: 'back', label: '后', position: [0, 0, -0.5], rotation: [0, Math.PI, 0] },
  { view: 'right', label: '右', position: [0.5, 0, 0], rotation: [0, Math.PI / 2, 0] },
  { view: 'left', label: '左', position: [-0.5, 0, 0], rotation: [0, -Math.PI / 2, 0] },
  { view: 'top', label: '上', position: [0, 0.5, 0], rotation: [-Math.PI / 2, 0, 0] },
  { view: 'bottom', label: '下', position: [0, -0.5, 0], rotation: [Math.PI / 2, 0, 0] },
]

export default function ViewCube() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pickRef = useRef<((x: number, y: number) => CameraView | null) | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(84, 84, false)
    renderer.outputColorSpace = SRGBColorSpace
    const scene = new Scene()
    const camera = new PerspectiveCamera(38, 1, 0.1, 10)
    camera.position.set(0, 0, 3.4)
    const group = new Group()
    const materials: MeshBasicMaterial[] = []
    for (const face of FACES) {
      const material = new MeshBasicMaterial({ map: faceTexture(face.label) })
      materials.push(material)
      const mesh = new Mesh(new PlaneGeometry(1, 1), material)
      mesh.position.set(...face.position)
      mesh.rotation.set(...face.rotation)
      mesh.userData.view = face.view
      group.add(mesh)
    }
    const edges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1, 1, 1)),
      new LineBasicMaterial({ color: 0x9a9a9a }),
    )
    edges.raycast = () => {}
    group.add(edges)
    scene.add(group)

    const raycaster = new Raycaster()
    const pointer = new Vector2()
    pickRef.current = (x, y) => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 2) return null
      pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(group.children, false)[0]
      return (hit?.object.userData.view as CameraView | undefined) ?? null
    }

    let frame = 0
    const tick = () => {
      group.quaternion.set(viewCubePose.x, viewCubePose.y, viewCubePose.z, viewCubePose.w)
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      pickRef.current = null
      materials.forEach(material => {
        material.map?.dispose()
        material.dispose()
      })
      edges.geometry.dispose()
      ;(edges.material as LineBasicMaterial).dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <div className="viewcube">
      <canvas
        ref={canvasRef}
        className="viewcube__canvas"
        width={84}
        height={84}
        onPointerDown={event => {
          const view = pickRef.current?.(event.clientX, event.clientY)
          if (view) useEditorStore.getState().requestView(view)
        }}
      />
      <button type="button" className="viewcube__home" onClick={() => useEditorStore.getState().requestView('persp')}>
        透视
      </button>
    </div>
  )
}

function faceTexture(label: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return new CanvasTexture(canvas)
  context.fillStyle = '#2c2c2c'
  context.fillRect(0, 0, 128, 128)
  context.strokeStyle = '#6a6a6a'
  context.lineWidth = 6
  context.strokeRect(4, 4, 120, 120)
  context.fillStyle = '#e8e8e8'
  context.font = '700 58px "Segoe UI", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, 64, 68)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
