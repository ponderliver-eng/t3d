import {
  Euler,
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'
import type { CameraView } from '../scene/types'

const LOOK_SPEED = 0.0055

const VIEW_LABEL: Record<CameraView, string> = {
  persp: '透视',
  top: '顶视图',
  bottom: '底视图',
  front: '前视图',
  back: '后视图',
  left: '左视图',
  right: '侧视图',
}

const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

let navigating = false

export function isViewportNavigating() {
  return navigating
}

export class EditorCameraRig {
  readonly persp = new PerspectiveCamera(50, 1, 0.05, 2000)
  readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.05, 2000)
  active: PerspectiveCamera | OrthographicCamera = this.persp
  view: CameraView = 'persp'
  readonly pivot = new Vector3(0, 0.5, 0)
  orbitDistance = 12
  onViewLabel?: (label: string) => void
  onActiveCamera?: () => void

  private yaw = 0
  private pitch = 0
  private orthoSize = 8
  private drag: 'look' | 'pan' | 'orbit' | null = null
  private keys = new Set<string>()
  private width = 1
  private height = 1
  private lastX = 0
  private lastY = 0

  constructor() {
    this.persp.position.set(7.5, 4.8, 8.5)
    this.persp.lookAt(this.pivot)
    this.orbitDistance = this.persp.position.distanceTo(this.pivot)
    this.readYawPitch()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.clearKeys)
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.clearKeys)
  }

  get dragging() {
    return this.drag !== null
  }

  resize(width: number, height: number) {
    this.width = Math.max(width, 1)
    this.height = Math.max(height, 1)
    this.persp.aspect = this.width / this.height
    this.persp.updateProjectionMatrix()
    this.updateOrthoFrustum()
  }

  pointerDown(event: PointerEvent): boolean {
    const navigate = event.button === 2 || event.button === 1 || (event.button === 0 && event.altKey)
    if (!navigate) return false
    if (this.view !== 'persp') this.exitOrtho()
    this.drag = event.button === 1 ? 'pan' : event.altKey && event.button === 0 ? 'orbit' : 'look'
    navigating = true
    this.lastX = event.clientX
    this.lastY = event.clientY
    event.preventDefault()
    return true
  }

  pointerMove(event: PointerEvent) {
    if (!this.drag) return
    const dx = event.clientX - this.lastX
    const dy = event.clientY - this.lastY
    this.lastX = event.clientX
    this.lastY = event.clientY
    if (dx === 0 && dy === 0) return
    if (this.drag === 'pan') {
      this.pan(dx, dy)
      return
    }
    this.yaw -= dx * LOOK_SPEED
    this.pitch = MathUtils.clamp(this.pitch - dy * LOOK_SPEED, -1.45, 1.45)
    this.writeYawPitch()
    const forward = this.forward()
    if (this.drag === 'orbit') this.persp.position.copy(this.pivot).addScaledVector(forward, -this.orbitDistance)
    else this.pivot.copy(this.persp.position).addScaledVector(forward, this.orbitDistance)
  }

  pointerUp() {
    this.drag = null
    navigating = false
  }

  wheel(event: WheelEvent) {
    event.preventDefault()
    const dy = Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 80)
    const factor = Math.exp(dy * 0.0011)
    if (this.view !== 'persp') {
      this.orthoSize = MathUtils.clamp(this.orthoSize * factor, 0.35, 200)
      this.updateOrthoFrustum()
      return
    }
    this.orbitDistance = MathUtils.clamp(this.orbitDistance * factor, 0.4, 400)
    this.persp.position.copy(this.pivot).addScaledVector(this.forward(), -this.orbitDistance)
  }

  update(dt: number) {
    if (this.drag !== 'look' || this.view !== 'persp') return
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 24 : 8) * dt
    const move = new Vector3()
    const forward = this.forward()
    const right = new Vector3(1, 0, 0).applyQuaternion(this.persp.quaternion)
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.add(forward)
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(forward)
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.add(right)
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.sub(right)
    if (move.lengthSq() === 0) return
    move.normalize().multiplyScalar(speed)
    this.persp.position.add(move)
    this.pivot.add(move)
  }

  capture(): { position: [number, number, number], quaternion: [number, number, number, number] } {
    const camera = this.view === 'persp' ? this.persp : this.ortho
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
    }
  }

  lookThrough(position: Vector3, quaternion: Quaternion) {
    this.persp.position.copy(position)
    this.persp.quaternion.copy(quaternion)
    this.readYawPitch()
    this.pivot.copy(this.persp.position).addScaledVector(this.forward(), Math.max(this.orbitDistance, 0.4))
    this.use(this.persp, 'persp', VIEW_LABEL.persp)
  }

  focus(center: Vector3, radius: number, flat = false) {
    this.pivot.copy(center)
    if (this.view !== 'persp') {
      this.orthoSize = Math.max(radius, 0.8)
      const direction = new Vector3()
      this.ortho.getWorldDirection(direction)
      this.ortho.position.copy(center).addScaledVector(direction, -16)
      this.ortho.lookAt(center)
      this.updateOrthoFrustum()
      return
    }
    if (flat && this.pitch > -0.55) {
      this.pitch = -0.55
      this.writeYawPitch()
    }
    this.orbitDistance = Math.max(radius * 2.4, 2)
    this.persp.position.copy(center).addScaledVector(this.forward(), -this.orbitDistance)
  }

  setView(view: CameraView) {
    if (view === 'persp') {
      if (this.view !== 'persp') this.exitOrtho()
      return
    }
    const direction = {
      top: new Vector3(0, 1, 0),
      bottom: new Vector3(0, -1, 0),
      front: new Vector3(0, 0, 1),
      back: new Vector3(0, 0, -1),
      right: new Vector3(1, 0, 0),
      left: new Vector3(-1, 0, 0),
    }[view]
    const up = view === 'top' ? new Vector3(0, 0, -1) : view === 'bottom' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
    this.ortho.up.copy(up)
    this.ortho.position.copy(this.pivot).addScaledVector(direction, 16)
    this.ortho.lookAt(this.pivot)
    this.orthoSize = 8
    this.updateOrthoFrustum()
    this.use(this.ortho, view, VIEW_LABEL[view])
  }

  private exitOrtho() {
    this.persp.position.copy(this.ortho.position)
    this.persp.quaternion.copy(this.ortho.quaternion)
    this.readYawPitch()
    this.orbitDistance = Math.max(this.persp.position.distanceTo(this.pivot), 0.4)
    this.persp.position.copy(this.pivot).addScaledVector(this.forward(), -this.orbitDistance)
    this.use(this.persp, 'persp', '透视')
  }

  private use(camera: PerspectiveCamera | OrthographicCamera, view: CameraView, label: string) {
    this.active = camera
    this.view = view
    this.onViewLabel?.(label)
    this.onActiveCamera?.()
  }

  private pan(dx: number, dy: number) {
    const camera = this.active
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    const scale = (this.view === 'persp' ? this.orbitDistance : this.orthoSize) * 0.0016
    const delta = right.multiplyScalar(-dx * scale).add(up.multiplyScalar(dy * scale))
    camera.position.add(delta)
    this.pivot.add(delta)
  }

  private forward() {
    return new Vector3(0, 0, -1).applyQuaternion(this.persp.quaternion)
  }

  private readYawPitch() {
    const forward = this.forward()
    this.pitch = Math.asin(MathUtils.clamp(forward.y, -1, 1))
    this.yaw = Math.atan2(-forward.x, -forward.z)
  }

  private writeYawPitch() {
    this.persp.quaternion.setFromEuler(new Euler(this.pitch, this.yaw, 0, 'YXZ'))
  }

  private updateOrthoFrustum() {
    const aspect = this.width / this.height
    const size = this.orthoSize
    this.ortho.left = -size * aspect
    this.ortho.right = size * aspect
    this.ortho.top = size
    this.ortho.bottom = -size
    this.ortho.updateProjectionMatrix()
  }

  private onKeyDown = (event: KeyboardEvent) => {
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    this.keys.add(event.code)
    if (this.drag === 'look' && FLY_KEYS.has(event.code)) event.preventDefault()
  }

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code)
  }

  private clearKeys = () => {
    this.keys.clear()
    this.drag = null
    navigating = false
  }
}
