import { Color, UnsignedByteType, Vector3, type Camera, type Scene, type WebGPURenderer } from 'three/webgpu'
import { RenderPipeline } from 'three/webgpu'
import { abs, clamp, diffuseColor, exp, float, hue, max, metalness, mix, mrt, normalView, output, packNormalToRGB, pass, roughness, sample, saturation, screenUV, smoothstep, uniform, unpackRGBToNormal, vec3, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ssao } from 'three/addons/tsl/display/SSAONode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { ssr } from 'three/addons/tsl/display/SSRNode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import type { ScenePicture } from '../editor/scene/types'
import { composeSkyFog, skyFogActive, skyFogRevision } from '../capabilities/sky/session'
import { buildHeightFogPass, heightFogActive, heightFogPipelineKey, type HeightFogPassHandle } from '../capabilities/fog/session'
import {
  buildWeatherObjectDripNode,
  buildWeatherSkyPass,
  buildWeatherSurfacePass,
  weatherActive,
  weatherNeedsNormals,
  weatherPipelineKey,
  type WeatherSkyPassHandle,
  type WeatherSurfacePassHandle,
} from '../capabilities/weather/session'
import { anyUnderwaterEffectEnabled, sampleUnderwaterView } from '../capabilities/water/session'
import { buildPostEffectNode, getCompiledPostEffect, getPostEffectRevision, setCompiledShaderParam } from '../core/codeAssets/shaderRuntime'

interface CustomPostEffectEntry {
  id: string
  params?: Record<string, unknown>
}

export function readCustomPostEffects(picture: ScenePicture): CustomPostEffectEntry[] {
  const raw = picture.capabilities?.postEffects
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : []
  const result: CustomPostEffectEntry[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { id?: unknown; enabled?: unknown; params?: unknown }
    if (rec.enabled === false) continue
    if (typeof rec.id !== 'string' || !rec.id.trim()) continue
    const id = rec.id.trim()
    if (!getCompiledPostEffect(id)) continue
    result.push({
      id,
      params: rec.params && typeof rec.params === 'object' ? (rec.params as Record<string, unknown>) : undefined,
    })
  }
  return result
}

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

interface UnderwaterUniforms {
  weight: { value: number }
  density: { value: number }
  fogStart: { value: number }
  tint: { value: number }
  color: { value: Color }
}

export interface PicturePipelineOptions {
  /** 可选：在最终 SMAA 之前合成自定义节点（如编辑器选中轮廓） */
  beforeAntiAlias?: (scene: Scene, camera: Camera, graded: { rgb: unknown; a: unknown }) => { node: unknown; dispose?: () => void }
  onError?: (message: string) => void
}

export class RuntimePicturePipeline {
  private pipeline: RenderPipeline | null = null
  private scenePass: ReturnType<typeof pass> | null = null
  private bloomNode: BloomUniforms | null = null
  private dofNode: DofUniforms | null = null
  private ssrNode: SsrUniforms | null = null
  private ssgiNode: SsgiUniforms | null = null
  private heightFogPass: HeightFogPassHandle | null = null
  private weatherSurfacePass: WeatherSurfacePassHandle | null = null
  private weatherSkyPass: WeatherSkyPassHandle | null = null
  private underwaterNode: UnderwaterUniforms | null = null
  private readonly camWorldPos = new Vector3()
  private denoiseNodes: Array<{ dispose: () => void }> = []
  private customDispose: (() => void) | null = null
  private key = ''
  private failed = false

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly options: PicturePipelineOptions = {},
  ) {
    patchRendererPrecompileRenderTarget(renderer)
  }

  usesEffects(picture: ScenePicture, extraActive = false): boolean {
    return extraActive || picture.bloom || picture.ssr || picture.ssgi || picture.aa !== false || picture.ao || picture.dof || picture.hue !== 0 || picture.saturation !== 1 || skyFogActive() || heightFogActive(picture) || weatherActive(picture) || anyUnderwaterEffectEnabled() || readCustomPostEffects(picture).length > 0
  }

  render(scene: Scene, camera: Camera, picture: ScenePicture, width: number, height: number, beforeRender?: () => void) {
    const underwaterEnabled = anyUnderwaterEffectEnabled()
    const customPosts = readCustomPostEffects(picture)
    const customPostKey = customPosts.length > 0 ? `${getPostEffectRevision()}:${customPosts.map((p) => p.id).join(',')}` : ''
    const key = [camera.uuid, picture.toneMapping, picture.bloom, picture.ssr, picture.ssgi, picture.ssgi && picture.ssgiDenoise, picture.aa !== false, picture.ao, picture.dof, picture.hue !== 0 || picture.saturation !== 1, skyFogRevision(), heightFogPipelineKey(picture), weatherPipelineKey(picture), underwaterEnabled, customPostKey, width, height].join('|')
    if (this.failed && this.key === key) {
      this.renderer.render(scene, camera)
      return
    }
    if (this.key !== key || !this.pipeline) {
      this.failed = false
      this.rebuild(scene, camera, picture, key)
    }
    beforeRender?.()
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
    if (this.heightFogPass) {
      this.heightFogPass.sync(picture, camera)
    }
    if (this.weatherSurfacePass) {
      this.weatherSurfacePass.sync(picture, camera)
    }
    if (this.weatherSkyPass) {
      this.weatherSkyPass.sync(picture, camera)
    }
    if (this.underwaterNode) {
      camera.getWorldPosition(this.camWorldPos)
      const underwater = sampleUnderwaterView(this.camWorldPos.x, this.camWorldPos.y, this.camWorldPos.z)
      if (underwater) {
        this.underwaterNode.weight.value = underwater.weight
        this.underwaterNode.density.value = underwater.fogDensity
        this.underwaterNode.fogStart.value = underwater.fogStart
        this.underwaterNode.tint.value = underwater.tint
        this.underwaterNode.color.value.set(underwater.color)
      } else {
        this.underwaterNode.weight.value = 0
      }
    }
    for (const post of customPosts) {
      if (!post.params) continue
      for (const [k, v] of Object.entries(post.params)) {
        setCompiledShaderParam(post.id, k, v)
      }
    }
    try {
      this.pipeline?.render()
    } catch (error) {
      this.failed = true
      const message = error instanceof Error ? error.message : String(error)
      console.error(error)
      this.options.onError?.(`画面效果失败：${message}`)
      this.renderer.render(scene, camera)
    }
  }

  async precompile(scene: Scene, camera: Camera, usedEffects: boolean): Promise<void> {
    const target = usedEffects && !this.failed
      ? this.scenePass as unknown as { compileAsync?: (renderer: WebGPURenderer) => Promise<void> } | null
      : null
    if (target && typeof target.compileAsync === 'function') {
      await target.compileAsync(this.renderer)
      return
    }
    await this.renderer.compileAsync(scene, camera)
  }

  dispose() {
    this.customDispose?.()
    this.customDispose = null
    this.clearDenoise()
    this.pipeline?.dispose()
    this.pipeline = null
    this.scenePass = null
  }

  private rebuild(scene: Scene, camera: Camera, picture: ScenePicture, key: string) {
    this.customDispose?.()
    this.customDispose = null
    this.clearDenoise()
    this.pipeline?.dispose()
    const scenePass = pass(scene, camera, { samples: 0 })
    this.scenePass = scenePass
    const needsBuffers = picture.ao || picture.ssr || picture.ssgi || weatherNeedsNormals(picture)
    if (needsBuffers) {
      const mrtNode = mrt({
        output,
        normal: vec4(packNormalToRGB(normalView), diffuseColor.a),
        metalrough: vec4(metalness, roughness, buildWeatherObjectDripNode() as never, diffuseColor.a),
      })
      const materialBlend = mrtNode.getBlendMode('output')
      mrtNode.setBlendMode('normal', materialBlend)
      mrtNode.setBlendMode('metalrough', materialBlend)
      scenePass.setMRT(mrtNode)
    }
    const beauty = needsBuffers ? scenePass.getTextureNode('output') : scenePass
    let current: { rgb: unknown, a: unknown, add: (node: unknown) => unknown, mul: (node: unknown) => unknown } = beauty as never
    this.bloomNode = null
    this.ssrNode = null
    this.ssgiNode = null
    const normalNode = needsBuffers ? sceneNormal(scenePass, true) : null
    if (picture.ao && normalNode) {
      const aoPass = ssao(scenePass.getTextureNode('depth'), normalNode as never, camera) as { r: unknown }
      current = current.mul(aoPass.r) as typeof current
    }
    const wKey = weatherPipelineKey(picture)
    const wParts = wKey === 'off' ? null : wKey.split(':')
    const wClouds = wParts ? Number(wParts[1]) : 0
    const wWet = wParts ? Number(wParts[2]) : 0
    const wSnow = wParts ? Number(wParts[3]) : 0
    const wSand = wParts ? Number(wParts[4]) : 0
    if ((wWet > 0 || wSnow > 0 || wSand > 0) && normalNode) {
      const surfacePass = buildWeatherSurfacePass(current, scenePass, normalNode, {
        wetness: (wWet & 1) !== 0,
        ripples: (wWet & 2) !== 0,
        drips: (wWet & 4) !== 0,
        snow: wSnow === 1,
        sandHaze: wSand === 1,
      })
      this.weatherSurfacePass = surfacePass
      current = surfacePass.node as typeof current
    } else {
      this.weatherSurfacePass = null
    }
    if (picture.ssgi && normalNode) {
      const depth = scenePass.getTextureNode('depth')
      const ssgiPass = ssgi(beauty as never, depth, normalNode as never, camera as never)
      ssgiPass.resolutionScale = 1
      this.ssgiNode = ssgiPass
      let ao: { r: unknown } = ssgiPass.getAONode()
      let gi: { rgb: unknown } = ssgiPass.getGINode()
      if (picture.ssgiDenoise) {
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
      const coc = smoothstep(0, focal, abs(viewZ.negate().sub(focus)))
      const weight = smoothstep(0.08, 0.45, coc)
      current = mix(current as never, blurred as never, weight) as unknown as typeof current
    } else {
      this.dofNode = null
    }
    if (skyFogActive()) current = composeSkyFog(current, scenePass) as typeof current
    if (wClouds > 0 || wSand > 0) {
      const skyCloudPass = buildWeatherSkyPass(current, scenePass, {
        lowClouds: (wClouds & 1) !== 0,
        midClouds: (wClouds & 2) !== 0,
        highClouds: (wClouds & 4) !== 0,
        sandHaze: wSand === 1,
      })
      this.weatherSkyPass = skyCloudPass
      current = skyCloudPass.node as typeof current
    } else {
      this.weatherSkyPass = null
    }
    if (heightFogActive(picture)) {
      const fogKey = heightFogPipelineKey(picture)
      const [, hFlag, dFlag] = fogKey.split(':')
      const fogPass = buildHeightFogPass(current, scenePass, {
        heightNoise: hFlag === '1',
        distanceNoise: dFlag === '1',
      })
      this.heightFogPass = fogPass
      current = fogPass.node as typeof current
    } else {
      this.heightFogPass = null
    }
    if (anyUnderwaterEffectEnabled()) {
      const weight = uniform(0)
      const density = uniform(0.25)
      const fogStart = uniform(0.5)
      const tint = uniform(0.15)
      const color = uniform(new Color('#0d5c75'))
      this.underwaterNode = { weight, density, fogStart, tint, color }
      const viewDist = abs(scenePass.getViewZNode())
      const fogDist = max(float(0), viewDist.sub(fogStart))
      const fogFactor = clamp(float(1).sub(exp(fogDist.negate().mul(density))), 0, 1)
      const nearTint = mix(current.rgb as never, (current.rgb as { mul: (v: unknown) => never }).mul(mix(vec3(1, 1, 1), color as never, float(0.65))), tint as never)
      const fogged = mix(nearTint as never, color as never, fogFactor)
      current = vec4(mix(current.rgb as never, fogged as never, weight as never), current.a as never) as unknown as typeof current
    } else {
      this.underwaterNode = null
    }
    let graded = picture.hue !== 0 || picture.saturation !== 1
      ? vec4(saturation(hue(current.rgb as never, picture.hue), picture.saturation), current.a as never)
      : current
    const customPosts = readCustomPostEffects(picture)
    if (customPosts.length > 0) {
      const postDepth = scenePass.getViewZNode()
      const postNormal = normalNode ?? sceneNormal(scenePass, true)
      for (const post of customPosts) {
        try {
          const next = buildPostEffectNode(
            post.id,
            {
              color: graded,
              depth: postDepth,
              normal: postNormal,
              uv: screenUV,
            },
            post.params,
          )
          if (next) graded = next as typeof graded
        } catch (err) {
          console.warn(`[T3D PostEffect] ${post.id} 构建失败，已跳过:`, err)
        }
      }
    }
    let preOutput: unknown = graded
    if (this.options.beforeAntiAlias) {
      const res = this.options.beforeAntiAlias(scene, camera, graded as { rgb: unknown; a: unknown })
      preOutput = res.node
      this.customDispose = res.dispose ?? null
    }
    const outputNode = picture.aa !== false ? smaa(preOutput as never) : preOutput
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

/**
 * 修复 Three.js 0.187 WebGPURenderer 在 PassNode.compileAsync 期间跨帧 yield 时
 * 因 useFrameBufferTarget === false 未恢复 renderTarget，导致 Background.material 等材质
 * 以 renderTarget === null（单输出）编译却绑定到多输出 MRT RenderContext 的管线失配问题。
 */
function patchRendererPrecompileRenderTarget(renderer: WebGPURenderer) {
  const internal = renderer as unknown as {
    __t3dPrecompilePatched?: boolean
    _beginPreCompile?: (state: { useFrameBufferTarget?: boolean; renderTarget?: unknown }) => void
    setRenderTarget: (target: unknown) => void
  }
  if (internal.__t3dPrecompilePatched || typeof internal._beginPreCompile !== 'function') return
  const origBegin = internal._beginPreCompile.bind(renderer)
  internal._beginPreCompile = (state) => {
    if (state && state.renderTarget != null && !state.useFrameBufferTarget) {
      internal.setRenderTarget(state.renderTarget)
    }
    origBegin(state)
  }
  internal.__t3dPrecompilePatched = true
}
