import { Color, DoubleSide, Object3D, Texture, Vector2, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  length,
  linearDepth,
  max,
  min,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  reflector,
  screenUV,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  viewportDepthTexture,
  viewportLinearDepth,
  viewportSharedTexture,
} from 'three/tsl'
import type { WaterSpec } from './defaults'
import { defaultWaterCausticsTexture, defaultWaterFoamTexture, defaultWaterNormalTexture } from './proceduralTextures'

export interface WaterMaterialOptions {
  /** 是否开启真实平面反射（关闭时不创建 reflector，真正省掉整趟离屏反射渲染）。 */
  planar: boolean
  /** 是否开启屏幕空间折射与水底采样。 */
  refraction: boolean
  /** 是否开启浅水焦散光斑。 */
  caustics: boolean
  /** 是否使用 4 层高细节法线（关闭时降为 2 层以节省纹理采样）。 */
  highDetail: boolean
  /** 顶点波浪位移的局部轴：自带旋转 -90° 的平面用 'z'，普通未旋转模型用 'y'。 */
  upAxis: 'y' | 'z'
}

export interface WaterMaterialHandle {
  variantKey: string
  material: MeshBasicNodeMaterial
  reflectionTarget: Object3D | null
  setSpec: (spec: WaterSpec, customNormal: Texture | null, customFoam: Texture | null) => void
  setTime: (time: number) => void
  setSun: (direction: Vector3, color: Color, intensity: number, skyHorizon?: Color, skyTop?: Color) => void
  dispose: () => void
}

export function waterVariantKey(opts: WaterMaterialOptions): string {
  return `${opts.planar ? 1 : 0}|${opts.refraction ? 1 : 0}|${opts.caustics ? 1 : 0}|${opts.highDetail ? 1 : 0}|${opts.upAxis}`
}

export function createWaterMaterial(options: WaterMaterialOptions): WaterMaterialHandle {
  const defaultNormal = defaultWaterNormalTexture()
  const defaultFoam = defaultWaterFoamTexture()
  const defaultCaustics = defaultWaterCausticsTexture()

  const uTime = uniform(0)
  const uShallowColor = uniform(new Color('#14b8a6'))
  const uDeepColor = uniform(new Color('#063354'))
  const uFoamColor = uniform(new Color('#f8fafc'))
  const uSunColor = uniform(new Color('#fff7e0'))
  const uSkyTopColor = uniform(new Color('#7dd3fc'))
  const uSkyHorizonColor = uniform(new Color('#e0f2fe'))
  const uSunDir = uniform(new Vector3(0.45, 0.72, 0.52).normalize())

  const uDepthAbsorption = uniform(2.8)
  const uOpacity = uniform(0.25)
  const uNormalScale = uniform(0.38)
  const uWaveScale = uniform(0.24)
  const uFlowDir = uniform(new Vector2(0.85, 0.52))
  const uFlowSpeed = uniform(0.45)
  const uFresnelPower = uniform(5.0)
  const uReflectivity = uniform(0.92)
  const uSpecularStrength = uniform(2.2)
  const uSpecularSize = uniform(0.24)
  const uSssStrength = uniform(0.45)
  const uFoamWidth = uniform(0.28)
  const uFoamIntensity = uniform(0.9)
  const uCrestFoam = uniform(0.65)
  const uShoreFoamOn = uniform(1)
  const uSoftEdge = uniform(0.08)
  const uCausticsStrength = uniform(0.7)
  const uCausticsScale = uniform(0.22)
  const uWaveHeight = uniform(0)

  const normalTexNode = texture(defaultNormal)
  const foamTexNode = texture(defaultFoam)
  const causticsTexNode = texture(defaultCaustics)

  // 1. 4 组主风向扇区波浪（兼容局部 Z 轴朝上平面与普通 Y 轴朝上模型）
  const dir1 = uFlowDir
  const dir2 = normalize(vec2(uFlowDir.x.mul(0.92).sub(uFlowDir.y.mul(0.39)), uFlowDir.x.mul(0.39).add(uFlowDir.y.mul(0.92))))
  const dir3 = normalize(vec2(uFlowDir.x.mul(0.88).add(uFlowDir.y.mul(0.47)), uFlowDir.y.mul(0.88).sub(uFlowDir.x.mul(0.47))))
  const dir4 = normalize(vec2(uFlowDir.x.mul(0.97).sub(uFlowDir.y.mul(0.24)), uFlowDir.x.mul(0.24).add(uFlowDir.y.mul(0.97))))

  const k1 = float(0.42)
  const k2 = float(0.73)
  const k3 = float(1.31)
  const k4 = float(2.17)

  const p1 = dot(positionWorld.xz, dir1).mul(k1).add(uTime.mul(1.15))
  const p2 = dot(positionWorld.xz, dir2).mul(k2).add(uTime.mul(1.52))
  const p3 = dot(positionWorld.xz, dir3).mul(k3).add(uTime.mul(2.04))
  const p4 = dot(positionWorld.xz, dir4).mul(k4).add(uTime.mul(2.61))

  const s1 = sin(p1)
  const s2 = sin(p2)
  const s3 = sin(p3)
  const s4 = sin(p4)
  const waveNorm = s1.mul(0.46).add(s2.mul(0.28)).add(s3.mul(0.16)).add(s4.mul(0.10))
  const waveOffset = waveNorm.mul(uWaveHeight)
  const displacedLocal = options.upAxis === 'z'
    ? vec3(positionLocal.x, positionLocal.y, positionLocal.z.add(waveOffset))
    : vec3(positionLocal.x, positionLocal.y.add(waveOffset), positionLocal.z)

  const dWaveDxz = dir1.mul(cos(p1).mul(k1).mul(0.46))
    .add(dir2.mul(cos(p2).mul(k2).mul(0.28)))
    .add(dir3.mul(cos(p3).mul(k3).mul(0.16)))
    .add(dir4.mul(cos(p4).mul(k4).mul(0.10)))
    .mul(uWaveHeight)

  // 2. 多向流动法线（highDetail 时 4 层精细叠加，轻量模式下 2 层省采样）
  const baseUv = positionWorld.xz.mul(uWaveScale)
  const flow = uFlowDir.mul(uTime.mul(uFlowSpeed.mul(0.05)))
  const flowOrtho = vec2(uFlowDir.y.negate(), uFlowDir.x).mul(uTime.mul(uFlowSpeed.mul(0.038)))

  const n1 = normalTexNode.sample(baseUv.mul(0.37).add(flow.mul(0.7))).xyz.mul(2.0).sub(1.0)
  const n2 = normalTexNode.sample(baseUv.mul(0.91).sub(flowOrtho.mul(0.9))).xyz.mul(2.0).sub(1.0)
  let nAvg = n1.mul(0.54).add(n2.mul(0.46))
  let nCrisp = n2
  if (options.highDetail) {
    const n3 = normalTexNode.sample(baseUv.mul(2.13).add(flow.mul(1.3).add(flowOrtho.mul(0.4)))).xyz.mul(2.0).sub(1.0)
    const n4 = normalTexNode.sample(baseUv.mul(4.71).sub(flow.mul(0.8).sub(flowOrtho.mul(1.2)))).xyz.mul(2.0).sub(1.0)
    nAvg = n1.mul(0.32).add(n2.mul(0.28)).add(n3.mul(0.24)).add(n4.mul(0.16))
    nCrisp = n2.mul(0.25).add(n3.mul(0.4)).add(n4.mul(0.35))
  }

  const surfaceNormal = normalize(vec3(
    nAvg.x.mul(uNormalScale).sub(dWaveDxz.x.mul(1.2)),
    float(1.0),
    nAvg.y.mul(uNormalScale).sub(dWaveDxz.y.mul(1.2)),
  ))
  const crispNormal = normalize(vec3(
    nCrisp.x.mul(uNormalScale).mul(1.45).sub(dWaveDxz.x.mul(1.1)),
    float(1.0),
    nCrisp.y.mul(uNormalScale).mul(1.45).sub(dWaveDxz.y.mul(1.1)),
  ))

  // 3. 视线与 Schlick 菲涅尔
  const worldToEye = cameraPosition.sub(positionWorld)
  const eyeDist = length(worldToEye)
  const viewVec = normalize(worldToEye)
  const nDotV = max(dot(surfaceNormal, viewVec), float(0.001))
  const rf0 = float(0.025)
  const fresnel = clamp(
    pow(float(1.0).sub(nDotV), uFresnelPower).mul(float(1.0).sub(rf0)).add(rf0).mul(uReflectivity),
    float(0.0),
    float(1.0),
  )

  // 4. 反射：仅当 planar === true 时创建 reflector()，关闭时真正零反射渲染开销
  const distortion = surfaceNormal.xz.mul(float(0.008).add(float(0.18).div(max(eyeDist, float(1.0))))).mul(uNormalScale)
  const reflDir = normalize(reflect(viewVec.negate(), surfaceNormal))
  const skyGrad = smoothstep(float(0.0), float(0.5), max(reflDir.y, float(0.0)))
  const fallbackReflection = mix(uSkyHorizonColor, uSkyTopColor, skyGrad)

  let reflectionTarget: Object3D | null = null
  let mirrorReflector: ReturnType<typeof reflector> | null = null
  let reflectionColor = fallbackReflection
  if (options.planar) {
    mirrorReflector = reflector({ resolutionScale: 0.5 })
    if (mirrorReflector.uvNode) {
      mirrorReflector.uvNode = clamp(mirrorReflector.uvNode.add(distortion) as never, vec2(0.002, 0.002), vec2(0.998, 0.998))
    }
    reflectionTarget = mirrorReflector.target
    reflectionColor = mirrorReflector.rgb
  }

  // 5. 水深、屏幕空间折射、岸边软羽化与浅水焦散
  const depthScale = cameraFar.sub(cameraNear)
  const waterDepth = max(viewportLinearDepth.sub(linearDepth()).mul(depthScale), float(0.0))
  const absorb = float(1.0).sub(exp(waterDepth.negate().div(max(uDepthAbsorption, float(0.1)))))
  const waterTint = mix(uShallowColor, uDeepColor, clamp(absorb, float(0.0), float(1.0)))

  let refractedBody = waterTint
  if (options.refraction) {
    const refractUv = clamp(screenUV.add(distortion.mul(0.6)), vec2(0.002, 0.002), vec2(0.998, 0.998))
    const refractDepth = linearDepth(viewportDepthTexture(refractUv)).sub(linearDepth()).mul(depthScale)
    const safeRefractUv = select(refractDepth.greaterThan(float(0.0)), refractUv, screenUV)
    let underWaterColor = viewportSharedTexture(safeRefractUv).rgb

    if (options.caustics) {
      const causticsCoord = positionWorld.xz.add(surfaceNormal.xz.mul(clamp(waterDepth.mul(0.22), float(0.0), float(0.8))))
      const cUv1 = causticsCoord.mul(uCausticsScale).add(flow.mul(0.85))
      const cUv2 = causticsCoord.mul(uCausticsScale.mul(1.37)).sub(flowOrtho.mul(1.15))
      const c1 = causticsTexNode.sample(cUv1).r
      const c2 = causticsTexNode.sample(cUv2).r
      const causticMask = min(c1, c2).mul(1.6).add(c1.mul(c2)).mul(0.55)
      const shallowFade = exp(waterDepth.negate().mul(0.45)).mul(smoothstep(float(0.0), float(0.18), waterDepth))
      underWaterColor = underWaterColor.add(uSunColor.mul(causticMask).mul(shallowFade).mul(uCausticsStrength))
    }

    const transmit = clamp(float(1.0).sub(absorb).mul(float(1.0).sub(uOpacity.mul(0.55))), float(0.0), float(1.0))
    refractedBody = mix(waterTint, underWaterColor.mul(mix(vec3(1.0), uShallowColor, float(0.42))), transmit)
  }

  // 6. 岸边软过渡（消除交界硬切锯齿）+ 周期性拍岸浪花
  const edgeOpacity = select(
    uSoftEdge.greaterThan(float(0.002)),
    smoothstep(float(0.0), max(uSoftEdge, float(0.005)), waterDepth),
    float(1.0),
  )
  const finalAlpha = options.refraction ? edgeOpacity : clamp(absorb.mul(0.4).add(uOpacity).mul(edgeOpacity), float(0.12), float(1.0))

  const foamNoise1 = foamTexNode.sample(baseUv.mul(2.8).add(flow.mul(1.4))).r
  const foamNoise2 = foamTexNode.sample(baseUv.mul(5.9).sub(flowOrtho.mul(1.7))).r
  const foamCell = foamNoise1.mul(0.55).add(foamNoise2.mul(0.45))

  const shoreRatio = clamp(waterDepth.div(max(uFoamWidth, float(0.01))), float(0.0), float(1.0))
  const shoreBase = float(1.0).sub(smoothstep(float(0.0), max(uFoamWidth, float(0.01)), waterDepth))
  const lapRipple = sin(shoreRatio.mul(12.0).sub(uTime.mul(2.2))).mul(0.5).add(0.5)
  const shoreBand = shoreBase.mul(float(0.62).add(lapRipple.mul(0.38))).mul(uShoreFoamOn)

  const crestActive = smoothstep(float(0.004), float(0.025), uWaveHeight)
  const crestBreakup = smoothstep(float(0.38), float(0.75), foamTexNode.sample(baseUv.mul(0.35).add(flow.mul(0.5))).r)
  const crestBand = smoothstep(float(0.36), float(0.88), waveNorm).mul(crestActive).mul(crestBreakup).mul(uCrestFoam)
  const foamMask = max(shoreBand, crestBand)
  const foamCut = smoothstep(float(0.58).sub(foamMask.mul(0.38)), float(0.82), foamCell)
  const foamAlpha = clamp(foamMask.mul(foamCut).mul(uFoamIntensity), float(0.0), float(1.0))

  // 7. 太阳碎金高光 + 次表面散射
  const sunDir = normalize(uSunDir)
  const sunRefl = normalize(reflect(sunDir.negate(), crispNormal))
  const specDot = max(dot(viewVec, sunRefl), float(0.0))
  const specPower = mix(float(2200.0), float(120.0), clamp(uSpecularSize, float(0.0), float(1.0)))
  const specGain = mix(float(3.2), float(1.1), clamp(uSpecularSize, float(0.0), float(1.0)))
  const sunSparkle = pow(specDot, specPower).mul(uSpecularStrength).mul(specGain)
  const sunScatter = pow(max(dot(viewVec, sunDir.negate()), float(0.0)), float(5.0))
    .mul(max(float(1.0).sub(nDotV), float(0.1)))
    .mul(uSssStrength)
  const sssColor = uShallowColor.mul(sunScatter).mul(0.55)

  // 8. 最终合成
  const waterSurface = mix(refractedBody.add(sssColor), reflectionColor, fresnel).add(uSunColor.mul(sunSparkle))
  const finalColor = mix(waterSurface, uFoamColor, foamAlpha)

  const material = new MeshBasicNodeMaterial()
  material.positionNode = displacedLocal
  material.colorNode = finalColor
  material.opacityNode = max(finalAlpha, foamAlpha)
  material.transparent = true
  material.depthWrite = false
  material.side = DoubleSide

  return {
    variantKey: waterVariantKey(options),
    material,
    reflectionTarget,
    setSpec(spec, customNormal, customFoam) {
      uShallowColor.value.set(spec.shallowColor)
      uDeepColor.value.set(spec.deepColor)
      uFoamColor.value.set(spec.foamColor)
      uSunColor.value.set(spec.sunColor)
      uDepthAbsorption.value = spec.depthAbsorption
      uOpacity.value = spec.opacity
      uNormalScale.value = spec.normalScale
      uWaveScale.value = spec.waveScale
      uFlowSpeed.value = spec.flowSpeed
      const rad = (spec.flowDirection * Math.PI) / 180
      uFlowDir.value.set(Math.cos(rad), Math.sin(rad))
      uFresnelPower.value = spec.fresnelPower
      uReflectivity.value = spec.reflectivity
      uSpecularStrength.value = spec.specularStrength
      uSpecularSize.value = spec.specularSize
      uSssStrength.value = spec.sssStrength
      uFoamWidth.value = spec.foamWidth
      uFoamIntensity.value = spec.foamIntensity
      uCrestFoam.value = spec.crestFoam
      uShoreFoamOn.value = spec.shoreFoam ? 1 : 0
      uSoftEdge.value = spec.softEdge
      uCausticsStrength.value = spec.causticsStrength
      uCausticsScale.value = spec.causticsScale
      uWaveHeight.value = spec.quality === 'fast' ? 0 : spec.waveHeight
      if (mirrorReflector) {
        mirrorReflector.reflector.resolutionScale = Math.max(0.25, spec.reflectionScale)
      }
      normalTexNode.value = customNormal ?? defaultNormal
      foamTexNode.value = customFoam ?? defaultFoam
    },
    setTime(time) {
      uTime.value = time
    },
    setSun(direction, color, intensity, skyHorizon, skyTop) {
      uSunDir.value.copy(direction).normalize()
      const boost = Math.min(2.0, Math.max(0.2, intensity))
      uSunColor.value.copy(color).multiplyScalar(boost)
      if (skyHorizon) uSkyHorizonColor.value.copy(skyHorizon)
      if (skyTop) uSkyTopColor.value.copy(skyTop)
    },
    dispose() {
      material.dispose()
    },
  }
}
