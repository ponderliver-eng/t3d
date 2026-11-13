import { type Camera, type Scene, type WebGPURenderer } from 'three/webgpu'
import { RenderPipeline } from 'three/webgpu'
import { hue, mrt, normalView, output, pass, saturation, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ssao } from 'three/addons/tsl/display/SSAONode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import type { ScenePicture } from '../scene/types'

interface BloomUniforms {
  strength: { value: number }
  radius: { value: number }
  threshold: { value: number }
}

export class ScenePicturePipeline {
  private pipeline: RenderPipeline | null = null
  private bloomNode: BloomUniforms | null = null
  private key = ''
  private failed = false

  constructor(private readonly renderer: WebGPURenderer) {}

  usesEffects(picture: ScenePicture): boolean {
    return picture.bloom || picture.ao || picture.dof || picture.hue !== 0 || picture.saturation !== 1
  }

  render(scene: Scene, camera: Camera, picture: ScenePicture, width: number, height: number) {
    if (this.failed) {
      this.renderer.render(scene, camera)
      return
    }
    const key = [camera.uuid, picture.bloom, picture.ao, picture.dof, picture.hue !== 0 || picture.saturation !== 1, width, height].join('|')
    if (this.key !== key || !this.pipeline) this.rebuild(scene, camera, picture, key)
    if (this.bloomNode) {
      this.bloomNode.strength.value = picture.bloomStrength
      this.bloomNode.radius.value = picture.bloomRadius
      this.bloomNode.threshold.value = picture.bloomThreshold
    }
    try {
      this.pipeline?.render()
    } catch (error) {
      this.failed = true
      console.error(error)
      this.renderer.render(scene, camera)
    }
  }

  dispose() {
    this.pipeline?.dispose()
    this.pipeline = null
  }

  private rebuild(scene: Scene, camera: Camera, picture: ScenePicture, key: string) {
    this.pipeline?.dispose()
    const scenePass = pass(scene, camera)
    if (picture.ao) scenePass.setMRT(mrt({ output, normal: normalView }))
    const base = picture.ao ? scenePass.getTextureNode('output') : scenePass
    let current: { rgb: unknown, a: unknown, add: (node: unknown) => unknown, mul: (node: unknown) => unknown } = base as never
    this.bloomNode = null
    if (picture.ao) {
      const aoPass = ssao(scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal'), camera) as { r: unknown }
      current = current.mul(aoPass.r) as typeof current
    }
    if (picture.bloom) {
      const bloomPass = bloom(current as never, picture.bloomStrength, picture.bloomRadius, picture.bloomThreshold)
      this.bloomNode = bloomPass
      current = current.add(bloomPass) as typeof current
    }
    if (picture.dof) {
      current = dof(current as never, scenePass.getViewZNode(), picture.dofFocus, picture.dofFocal, picture.dofBokeh) as unknown as typeof current
    }
    const graded = picture.hue !== 0 || picture.saturation !== 1
      ? vec4(saturation(hue(current.rgb as never, picture.hue), picture.saturation), current.a as never)
      : current
    const pipeline = new RenderPipeline(this.renderer, graded as never)
    pipeline.outputColorTransform = true
    this.pipeline = pipeline
    this.key = key
  }
}
