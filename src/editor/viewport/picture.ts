import { UnsignedByteType, type Camera, type Scene, type WebGPURenderer } from 'three/webgpu'
import { RenderPipeline } from 'three/webgpu'
import { diffuseColor, hue, metalness, mrt, normalView, output, packNormalToRGB, pass, roughness, sample, saturation, unpackRGBToNormal, vec4 } from 'three/tsl'
import { useEditorStore } from '../scene/store'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ssao } from 'three/addons/tsl/display/SSAONode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { ssr } from 'three/addons/tsl/display/SSRNode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import type { ScenePicture } from '../scene/types'

interface BloomUniforms {
  strength: { value: number }
  radius: { value: number }
  threshold: { value: number }
}

interface SsrUniforms {
  quality: { value: number }
  maxDistance: { value: number }
  thickness: { value: number }
  intensity: { value: number }
}

export class ScenePicturePipeline {
  private pipeline: RenderPipeline | null = null
  private bloomNode: BloomUniforms | null = null
  private ssrNode: SsrUniforms | null = null
  private key = ''
  private failed = false

  constructor(private readonly renderer: WebGPURenderer) {}

  usesEffects(picture: ScenePicture): boolean {
    return picture.bloom || picture.ssr || picture.aa !== false || picture.ao || picture.dof || picture.hue !== 0 || picture.saturation !== 1
  }

  render(scene: Scene, camera: Camera, picture: ScenePicture, width: number, height: number) {
    const key = [camera.uuid, picture.bloom, picture.ssr, picture.aa !== false, picture.ao, picture.dof, picture.hue !== 0 || picture.saturation !== 1, width, height].join('|')
    if (this.failed && this.key === key) {
      this.renderer.render(scene, camera)
      return
    }
    if (this.key !== key || !this.pipeline) {
      this.failed = false
      this.rebuild(scene, camera, picture, key)
    }
    if (this.bloomNode) {
      this.bloomNode.strength.value = picture.bloomStrength
      this.bloomNode.radius.value = picture.bloomRadius
      this.bloomNode.threshold.value = picture.bloomThreshold
    }
    if (this.ssrNode) {
      this.ssrNode.quality.value = picture.ssrQuality
      this.ssrNode.maxDistance.value = picture.ssrDistance
      this.ssrNode.thickness.value = picture.ssrThickness
      this.ssrNode.intensity.value = picture.ssrIntensity
    }
    try {
      this.pipeline?.render()
    } catch (error) {
      this.failed = true
      const message = error instanceof Error ? error.message : String(error)
      console.error(error)
      useEditorStore.getState().log('error', `屏幕反射失败：${message}`)
      this.renderer.render(scene, camera)
    }
  }

  dispose() {
    this.pipeline?.dispose()
    this.pipeline = null
  }

  private rebuild(scene: Scene, camera: Camera, picture: ScenePicture, key: string) {
    this.pipeline?.dispose()
    // 画布开了 4 倍采样。这张离屏图若跟着多重采样，深度不能再被反射读取，射线没有落点。抗锯齿由后面的 SMAA 负责。
    const scenePass = pass(scene, camera, { samples: 0 })
    const needsBuffers = picture.ao || picture.ssr
    if (needsBuffers) {
      // 编辑器网格等半透明辅助物没有金属度和粗糙度，默认不混合会把整张地面覆写成 0。
      const mrtNode = mrt({
        output,
        normal: vec4(picture.ssr ? packNormalToRGB(normalView) : normalView, diffuseColor.a),
        ...(picture.ssr ? { metalrough: vec4(metalness, roughness, 0, diffuseColor.a) } : {}),
      })
      const materialBlend = mrtNode.getBlendMode('output')
      mrtNode.setBlendMode('normal', materialBlend)
      if (picture.ssr) mrtNode.setBlendMode('metalrough', materialBlend)
      scenePass.setMRT(mrtNode)
    }
    const beauty = needsBuffers ? scenePass.getTextureNode('output') : scenePass
    let current: { rgb: unknown, a: unknown, add: (node: unknown) => unknown, mul: (node: unknown) => unknown } = beauty as never
    this.bloomNode = null
    this.ssrNode = null
    const normalNode = needsBuffers ? sceneNormal(scenePass, picture.ssr) : null
    if (picture.ao && normalNode) {
      const aoPass = ssao(scenePass.getTextureNode('depth'), normalNode as never, camera) as { r: unknown }
      current = current.mul(aoPass.r) as typeof current
    }
    if (picture.ssr && normalNode) {
      const metalRough = scenePass.getTextureNode('metalrough')
      const ssrPass = ssr(beauty as never, scenePass.getTextureNode('depth'), normalNode as never, {
        metalnessNode: metalRough.r,
        roughnessNode: metalRough.g,
        reflectNonMetals: true,
        camera,
      })
      ssrPass.resolutionScale = 1
      ssrPass.binaryRefine = true
      this.ssrNode = ssrPass
      current = current.add(ssrPass.rgb) as typeof current
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
    const outputNode = picture.aa !== false ? smaa(graded as never) : graded
    const pipeline = new RenderPipeline(this.renderer, outputNode as never)
    pipeline.outputColorTransform = true
    this.pipeline = pipeline
    this.key = key
  }
}

function sceneNormal(scenePass: ReturnType<typeof pass>, packed: boolean) {
  const texture = scenePass.getTextureNode('normal')
  if (!packed) return texture
  scenePass.getTexture('normal').type = UnsignedByteType
  scenePass.getTexture('metalrough').type = UnsignedByteType
  return sample(uv => unpackRGBToNormal(texture.sample(uv).rgb))
}
