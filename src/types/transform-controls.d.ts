declare module 'three/addons/controls/TransformControls.js' {
  import { Camera, Object3D } from 'three'

  export class TransformControls {
    constructor(camera: Camera, domElement?: HTMLElement | null)
    camera: Camera
    enabled: boolean
    mode: 'translate' | 'rotate' | 'scale'
    space: 'world' | 'local'
    axis: string | null
    dragging: boolean
    size: number
    translationSnap: number | null
    rotationSnap: number | null
    scaleSnap: number | null
    attach(object: Object3D): this
    detach(): this
    getHelper(): Object3D
    dispose(): void
    addEventListener(type: string, listener: () => void): void
    removeEventListener(type: string, listener: () => void): void
  }
}
