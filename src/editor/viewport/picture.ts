import { UnsignedByteType, type Camera, type Object3D, type Scene, type WebGPURenderer } from 'three/webgpu'
import { RenderPipeline } from 'three/webgpu'
import { abs, diffuseColor, hue, metalness, mix, mrt, normalView, output, packNormalToRGB, pass, roughness, sample, saturation, smoothstep, uniform, unpackRGBToNormal, vec4 } from 'three/tsl'
import { useEditorStore } from '../scene/store'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ssao } from 'three/addons/tsl/display/SSAONode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { ssr } from 'three/addons/tsl/display/SSRNode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import type { ScenePicture } from '../scene/types'
import { SelectionOutlineNode } from './selectionOutline'
import { composeSkyFog, skyFogActive, skyFogRevision } from '../../capabilities/sky/session'

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

interface DofUniforms {
  focus: { value: number }
  focal: { value: number }
  bokeh: { value: number }
}

interface SsgiUniforms {
  sliceCount: { value: number }
  stepCount: { value: number }
  radius: { value: number }
  giIntensity: { value: number }
  aoIntensity: { value: number }
  getAONode: () => { r: unknown }
  getGINode: () => { rgb: unknown }
}

export class ScenePicturePipeline {
  private pipeline: RenderPipeline | null = null
  private bloomNode: BloomUniforms | null = null
  private dofNode: DofUniforms | null = null
  private ssrNode: SsrUniforms | null = null
  private ssgiNode: SsgiUniforms | null = null
  private denoiseNodes: Array<{ dispose: () => void }> = []
  private outlineNode: SelectionOutlineNode | null = null
  private key = ''
  private failed = false

  constructor(private readonly renderer: WebGPURenderer) {}

  usesEffects(picture: ScenePicture, hasOutline = false): boolean {
    return hasOutline || picture.bloom || picture.ssr || picture.ssgi || picture.aa !== false || picture.ao || picture.dof || picture.hue !== 0 || picture.saturation !== 1 || skyFogActive()
  }

  render(scene: Scene, camera: Camera, picture: ScenePicture, width: number, height: number, outlineTargets: readonly Object3D[] = [], flashTarget: Object3D | null = null) {
    const key = [camera.uuid, picture.toneMapping, picture.bloom, picture.ssr, picture.ssgi, picture.ssgi && picture.ssgiDenoise, picture.aa !== false, picture.ao, picture.dof, picture.hue !== 0 || picture.saturation !== 1, skyFogRevision(), width, height].join('|')
    if (this.failed && this.key === key) {
      this.renderer.render(scene, camera)
      return
    }
    if (this.key !== key || !this.pipeline) {
      this.failed = false
      this.rebuild(scene, camera, picture, key)
    }
    if (this.outlineNode) {
      this.outlineNode.selectedRoots.length = 0
      for (const obj of outlineTargets) this.outlineNode.selectedRoots.push(obj)
      this.outlineNode.flashRoot = flashTarget
    }
    if (this.bloomNode) {
      this.bloomNode.strength.value = picture.bloomStrength
      this.bloomNode.radius.value = picture.bloomRadius
      this.bloomNode.threshold.value = picture.bloomThreshold
    }
    if (this.dofNode) {
      this.dofNode.focus.value = picture.dofFocus
      this.dofNode.focal.value = picture.dofFocal
      this.dofNode.bokeh.value = picture.dofBokeh
    }
    if (this.ssrNode) {
      this.ssrNode.quality.value = picture.ssrQuality
      this.ssrNode.maxDistance.value = picture.ssrDistance
      this.ssrNode.thickness.value = picture.ssrThickness
      this.ssrNode.intensity.value = picture.ssrIntensity
    }
    if (this.ssgiNode) {
      this.ssgiNode.sliceCount.value = Math.max(1, Math.round(picture.ssgiSlices))
      this.ssgiNode.stepCount.value = Math.max(1, Math.round(picture.ssgiSteps))
      this.ssgiNode.radius.value = picture.ssgiRadius
      this.ssgiNode.giIntensity.value = picture.ssgiIntensity
      this.ssgiNode.aoIntensity.value = picture.ssgiOcclusion
    }
    try {
      this.pipeline?.render()
    } catch (error) {
      this.failed = true
      const message = error instanceof Error ? error.message : String(error)
      console.error(error)
      useEditorStore.getState().log('error', `画面效果失败：${message}`)
      this.renderer.render(scene, camera)
    }
  }

  dispose() {
    this.outlineNode?.dispose()
    this.outlineNode = null
    this.clearDenoise()
    this.pipeline?.dispose()
    this.pipeline = null
  }

  private rebuild(scene: Scene, camera: Camera, picture: ScenePicture, key: string) {
    this.outlineNode?.dispose()
    this.outlineNode = null
    this.clearDenoise()
    this.pipeline?.dispose()
    // 画布开了 4 倍采样。这张离屏图若跟着多重采样，深度不能再被反射读取，射线没有落点。抗锯齿由后面的 SMAA 负责。
    const scenePass = pass(scene, camera, { samples: 0 })
    const needsBuffers = picture.ao || picture.ssr || picture.ssgi
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
    this.ssgiNode = null
    const normalNode = needsBuffers ? sceneNormal(scenePass, picture.ssr) : null
    if (picture.ao && normalNode) {
      const aoPass = ssao(scenePass.getTextureNode('depth'), normalNode as never, camera) as { r: unknown }
      current = current.mul(aoPass.r) as typeof current
    }
    if (picture.ssgi && normalNode) {
      const depth = scenePass.getTextureNode('depth')
      const ssgiPass = ssgi(beauty as never, depth, normalNode as never, camera as never)
      ssgiPass.resolutionScale = 1
      this.ssgiNode = ssgiPass
      let ao: { r: unknown } = ssgiPass.getAONode()
      let gi: { rgb: unknown } = ssgiPass.getGINode()
      if (picture.ssgiDenoise) {
        // 采样方向固定，空间降噪才压得住颗粒。关掉时不进这个分支，节点不会被创建。
        ssgiPass.useTemporalFiltering = false
        const aoDenoised = denoise(ao as never, depth as never, normalNode as never, camera as never)
        const giDenoised = denoise(gi as never, depth as never, normalNode as never, camera as never)
        this.denoiseNodes.push(aoDenoised, giDenoised)
        ao = aoDenoised as unknown as { r: unknown }
        gi = giDenoised as unknown as { rgb: unknown }
      }
      const darkened = current.mul(ao.r) as typeof current
      current = darkened.add(gi.rgb) as typeof current
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
      const focus = uniform(picture.dofFocus)
      const focal = uniform(picture.dofFocal)
      const bokeh = uniform(picture.dofBokeh)
      this.dofNode = { focus, focal, bokeh }
      const viewZ = scenePass.getViewZNode()
      const blurred = dof(current as never, viewZ, focus, focal, bokeh)
      // 库里的合成用的是被模糊过的弥散圆，失焦背景的高光会渗进清晰轮廓。
      // 这里改用该像素自己的景深权重，对焦处保持原色。
      const coc = smoothstep(0, focal, abs(viewZ.negate().sub(focus)))
      const weight = smoothstep(0.08, 0.45, coc)
      current = mix(current as never, blurred as never, weight) as unknown as typeof current
    } else {
      this.dofNode = null
    }
    if (skyFogActive()) current = composeSkyFog(current, scenePass) as typeof current
    const graded = picture.hue !== 0 || picture.saturation !== 1
      ? vec4(saturation(hue(current.rgb as never, picture.hue), picture.saturation), current.a as never)
      : current
    const outlinePass = new SelectionOutlineNode(scene, camera)
    this.outlineNode = outlinePass
    const outlineSample = (outlinePass as unknown as { rgb: unknown, a: unknown })
    const withOutline = vec4(
      mix((graded as { rgb: unknown }).rgb as never, outlineSample.rgb as never, outlineSample.a as never),
      (graded as { a: unknown }).a as never,
    )
    const outputNode = picture.aa !== false ? smaa(withOutline as never) : withOutline
    const pipeline = new RenderPipeline(this.renderer, outputNode as never)
    pipeline.outputColorTransform = true
    this.pipeline = pipeline
    this.key = key
  }

  private clearDenoise() {
    for (const node of this.denoiseNodes) node.dispose()
    this.denoiseNodes = []
  }
}

function sceneNormal(scenePass: ReturnType<typeof pass>, packed: boolean) {
  const texture = scenePass.getTextureNode('normal')
  if (!packed) return texture
  scenePass.getTexture('normal').type = UnsignedByteType
  scenePass.getTexture('metalrough').type = UnsignedByteType
  return sample(uv => unpackRGBToNormal(texture.sample(uv).rgb))
}
