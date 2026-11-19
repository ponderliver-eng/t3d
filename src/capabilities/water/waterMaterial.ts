import { Color, DoubleSide, Object3D, Texture, Vector2, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
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
  setTime: (time: number, waveTime: number) => void
  setInvScale: (worldScale: Vector3) => void
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
  const uWaveTime = uniform(0)
  const uInvScale = uniform(new Vector3(1, 1, 1))
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
  const uCrestFoamThreshold = uniform(0.42)
  const uShoreFoamOn = uniform(1)
  const uSoftEdge = uniform(0.08)
  const uCausticsStrength = uniform(0.7)
  const uCausticsScale = uniform(0.22)
  const uWaveHeight = uniform(0)
  const uWaveSteepness = uniform(0.65)

  const normalTexNode = texture(defaultNormal)
  const foamTexNode = texture(defaultFoam)
  const causticsTexNode = texture(defaultCaustics)

  // 1. 物理色散 Gerstner 长浪脊：86% 能量集中在主风向 ±18° 扇区形成连绵浪脊，杜绝圆形小山丘
  const dir1 = uFlowDir
  const dir2 = normalize(vec2(uFlowDir.x.mul(0.97).sub(uFlowDir.y.mul(0.24)), uFlowDir.x.mul(0.24).add(uFlowDir.y.mul(0.97))))
  const dir3 = normalize(vec2(uFlowDir.x.mul(0.95).add(uFlowDir.y.mul(0.31)), uFlowDir.y.mul(0.95).sub(uFlowDir.x.mul(0.31))))
  const dir4 = normalize(vec2(uFlowDir.x.mul(0.79).sub(uFlowDir.y.mul(0.61)), uFlowDir.x.mul(0.61).add(uFlowDir.y.mul(0.79))))

  const k1 = float(0.22)
  const k2 = float(0.37)
  const k3 = float(0.61)
  const k4 = float(0.96)

  // 真实水波色散：波长越长推进越快，短波相对慢
  const p1 = dot(positionWorld.xz, dir1).mul(k1).sub(uWaveTime.mul(1.85))
  const p2 = dot(positionWorld.xz, dir2).mul(k2).sub(uWaveTime.mul(1.42))
  const p3 = dot(positionWorld.xz, dir3).mul(k3).sub(uWaveTime.mul(1.08))
  const p4 = dot(positionWorld.xz, dir4).mul(k4).sub(uWaveTime.mul(0.82))

  // 柔和波群包络（沿主浪脊方向缓慢聚散）
  const groupEnv = clamp(
    float(0.92).add(sin(dot(positionWorld.xz, dir2).mul(0.05).sub(uWaveTime.mul(0.32))).mul(0.22)),
    float(0.7),
    float(1.18),
  )

  const s1 = sin(p1)
  const s2 = sin(p2)
  const s3 = sin(p3)
  const s4 = sin(p4)
  const c1w = cos(p1)
  const c2w = cos(p2)
  const c3w = cos(p3)
  const c4w = cos(p4)

  const rawWave = s1.mul(0.46).add(s2.mul(0.26)).add(s3.mul(0.16)).add(s4.mul(0.12))
  const effHeight = uWaveHeight.mul(groupEnv)
  const waveNorm = rawWave.mul(groupEnv)
  const waveOffset = rawWave.mul(effHeight)

  // 严格雅可比限幅的 3D Gerstner 水平挤压：总压缩率 Σ(k_i * Q_i) <= 0.84 < 1，保证永不自交
  const q1 = min(effHeight.mul(0.46).mul(2.1), float(0.21).div(k1)).mul(uWaveSteepness)
  const q2 = min(effHeight.mul(0.26).mul(2.1), float(0.21).div(k2)).mul(uWaveSteepness)
  const q3 = min(effHeight.mul(0.16).mul(2.1), float(0.21).div(k3)).mul(uWaveSteepness)
  const q4 = min(effHeight.mul(0.12).mul(2.1), float(0.21).div(k4)).mul(uWaveSteepness)
  const horizOffset = dir1.mul(c1w.mul(q1))
    .add(dir2.mul(c2w.mul(q2)))
    .add(dir3.mul(c3w.mul(q3)))
    .add(dir4.mul(c4w.mul(q4)))

  // 用节点世界缩放的倒数把世界米数转回局部坐标，确保任意 scale 下都不撕裂
  const displacedLocal = options.upAxis === 'z'
    ? vec3(
      positionLocal.x.add(horizOffset.x.mul(uInvScale.x)),
      positionLocal.y.sub(horizOffset.y.mul(uInvScale.z)),
      positionLocal.z.add(waveOffset.mul(uInvScale.y)),
    )
    : vec3(
      positionLocal.x.add(horizOffset.x.mul(uInvScale.x)),
      positionLocal.y.add(waveOffset.mul(uInvScale.y)),
      positionLocal.z.add(horizOffset.y.mul(uInvScale.z)),
    )

  const dWaveDxz = dir1.mul(c1w.mul(k1).mul(0.46))
    .add(dir2.mul(c2w.mul(k2).mul(0.26)))
    .add(dir3.mul(c3w.mul(k3).mul(0.16)))
    .add(dir4.mul(c4w.mul(k4).mul(0.12)))
    .mul(effHeight)
    .mul(float(1.0).add(uWaveSteepness.mul(0.65)))

  // 视距抗锯齿衰减（远景逐步平滑高频碎波法线，消除低角度像素闪烁噪点）
  const worldToEye = cameraPosition.sub(positionWorld)
  const eyeDist = length(worldToEye)
  const viewVec = normalize(worldToEye)
  const highFreqFade = float(1.0).sub(smoothstep(float(18.0), float(110.0), eyeDist))

  // 2. 多向流动法线（highDetail 时 4 层精细叠加，轻量模式下 2 层省采样）
  const baseUv = positionWorld.xz.mul(uWaveScale)
  const flow = uFlowDir.mul(uTime.mul(uFlowSpeed.mul(0.05)))
  const flowOrtho = vec2(uFlowDir.y.negate(), uFlowDir.x).mul(uTime.mul(uFlowSpeed.mul(0.038)))

  const n1 = normalTexNode.sample(baseUv.mul(0.37).add(flow.mul(0.7))).xyz.mul(2.0).sub(1.0)
  const n2 = normalTexNode.sample(baseUv.mul(0.91).sub(flowOrtho.mul(0.9))).xyz.mul(2.0).sub(1.0)
  let nAvg = n1.mul(0.54).add(n2.mul(0.46).mul(float(0.35).add(highFreqFade.mul(0.65))))
  let nCrisp = n2.mul(float(0.3).add(highFreqFade.mul(0.7)))
  if (options.highDetail) {
    const n3 = normalTexNode.sample(baseUv.mul(2.13).add(flow.mul(1.3).add(flowOrtho.mul(0.4)))).xyz.mul(2.0).sub(1.0)
    const n4 = normalTexNode.sample(baseUv.mul(4.71).sub(flow.mul(0.8).sub(flowOrtho.mul(1.2)))).xyz.mul(2.0).sub(1.0)
    const detail = n3.mul(0.24).add(n4.mul(0.16)).mul(highFreqFade)
    nAvg = n1.mul(0.32).add(n2.mul(0.28)).add(detail)
    nCrisp = n2.mul(0.25).add(n3.mul(0.4).add(n4.mul(0.35)).mul(highFreqFade))
  }

  const surfaceNormal = normalize(vec3(
    nAvg.x.mul(uNormalScale).sub(dWaveDxz.x.mul(1.4)),
    float(1.0),
    nAvg.y.mul(uNormalScale).sub(dWaveDxz.y.mul(1.4)),
  ))
  const waveMacroNormal = normalize(vec3(
    dWaveDxz.x.negate().mul(1.6),
    float(1.0),
    dWaveDxz.y.negate().mul(1.6),
  ))
  const crispNormal = normalize(vec3(
    nCrisp.x.mul(uNormalScale).mul(1.45).sub(dWaveDxz.x.mul(1.2)),
    float(1.0),
    nCrisp.y.mul(uNormalScale).mul(1.45).sub(dWaveDxz.y.mul(1.2)),
  ))

  // 3. 视线与 Schlick 菲涅尔
  const nDotV = max(dot(surfaceNormal, viewVec), float(0.001))
  const rf0 = float(0.025)
  const fresnel = clamp(
    pow(float(1.0).sub(nDotV), uFresnelPower).mul(float(1.0).sub(rf0)).add(rf0).mul(uReflectivity),
    float(0.0),
    float(1.0),
  )

  // 4. 反射：仅当 planar === true 时创建 reflector(bounces: false)；否则使用太阳仰角 + 背景色天空渐变
  const distortion = surfaceNormal.xz.mul(float(0.008).add(float(0.18).div(max(eyeDist, float(1.0))))).mul(uNormalScale)
  const reflDir = normalize(reflect(viewVec.negate(), surfaceNormal))
  const skyGrad = smoothstep(float(0.0), float(0.5), max(reflDir.y, float(0.0)))
  const fallbackReflection = mix(uSkyHorizonColor, uSkyTopColor, skyGrad)

  let reflectionTarget: Object3D | null = null
  let mirrorReflector: ReturnType<typeof reflector> | null = null
  let reflectionColor = fallbackReflection
  if (options.planar) {
    mirrorReflector = reflector({ resolutionScale: 0.5, bounces: false })
    if (mirrorReflector.uvNode) {
      mirrorReflector.uvNode = clamp(mirrorReflector.uvNode.add(distortion) as never, vec2(0.002, 0.002), vec2(0.998, 0.998))
    }
    reflectionTarget = mirrorReflector.target
    reflectionColor = mirrorReflector.rgb
  }

  // 5. 垂直水深修正：仅在开启 refraction（具备屏幕深度采样）时读取 viewportLinearDepth，关闭折射时彻底解耦深度拷贝
  const depthScale = cameraFar.sub(cameraNear)
  let waterDepth = max(uDepthAbsorption, float(2.0))
  if (options.refraction) {
    const bgLinear = viewportLinearDepth
    const hasBed = bgLinear.lessThan(float(0.999))
    const rawRayDepth = max(bgLinear.sub(linearDepth()).mul(depthScale), float(0.0))
    const rayWaterDepth = select(hasBed, rawRayDepth, float(20.0))
    const verticalFactor = clamp(abs(viewVec.y).mul(1.15).add(0.22), float(0.22), float(1.0))
    waterDepth = rayWaterDepth.mul(verticalFactor)
  }
  const absorb = float(1.0).sub(exp(waterDepth.negate().div(max(uDepthAbsorption, float(0.1)))))
  const waterTint = mix(uShallowColor, uDeepColor, clamp(absorb, float(0.0), float(1.0)))

  let refractedBody = waterTint
  if (options.refraction) {
    // 浅岸处平滑收小折射偏移，防止贴岸边缘产生水底畸变撕裂
    const depthRefractFade = clamp(waterDepth.mul(1.6), float(0.0), float(1.0))
    const refractUv = clamp(screenUV.add(distortion.mul(0.6).mul(depthRefractFade)), vec2(0.002, 0.002), vec2(0.998, 0.998))
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

  // 6. 岸边软过渡（仅在开启折射/深度采样时羽化）+ 周期性拍岸浪花
  const edgeOpacity = options.refraction
    ? select(
      uSoftEdge.greaterThan(float(0.002)),
      smoothstep(float(0.0), max(uSoftEdge, float(0.005)), waterDepth),
      float(1.0),
    )
    : float(1.0)
  const finalAlpha = options.refraction ? edgeOpacity : clamp(uOpacity.add(0.25), float(0.35), float(1.0))

  const foamNoise1 = foamTexNode.sample(baseUv.mul(2.8).add(flow.mul(1.4))).r
  const foamNoise2 = foamTexNode.sample(baseUv.mul(5.9).sub(flowOrtho.mul(1.7))).r
  const foamCell = foamNoise1.mul(0.55).add(foamNoise2.mul(0.45))

  const shoreRatio = clamp(waterDepth.div(max(uFoamWidth, float(0.01))), float(0.0), float(1.0))
  const shoreBase = float(1.0).sub(smoothstep(float(0.0), max(uFoamWidth, float(0.01)), waterDepth))
  const lapRipple = sin(shoreRatio.mul(12.0).sub(uTime.mul(2.2))).mul(0.5).add(0.5)
  const shoreBand = shoreBase.mul(float(0.62).add(lapRipple.mul(0.38))).mul(uShoreFoamOn)

  const crestActive = smoothstep(float(0.004), float(0.025), uWaveHeight)
  const crestBreakup = smoothstep(float(0.28), float(0.70), foamTexNode.sample(baseUv.mul(vec2(0.55, 0.25)).add(flow.mul(0.5))).r)
  const crestStart = uCrestFoamThreshold
  const crestEnd = min(uCrestFoamThreshold.add(0.45), float(1.05))
  const crestBand = smoothstep(crestStart, crestEnd, waveNorm).mul(crestActive).mul(crestBreakup).mul(uCrestFoam)
  const foamMask = max(shoreBand, crestBand)
  const foamCut = smoothstep(float(0.56).sub(foamMask.mul(0.40)), float(0.82), foamCell)
  const foamAlpha = clamp(foamMask.mul(foamCut).mul(uFoamIntensity), float(0.0), float(1.0))

  // 7. 太阳碎金高光（高光也吃远景防闪烁淡出）+ 大浪坡面体积明暗 + 波峰透光次表面散射
  const sunDir = normalize(uSunDir)
  const sunSlope = max(dot(waveMacroNormal, sunDir), float(0.0))
  const waveShade = mix(float(0.72), float(1.18), sunSlope)
  const sunRefl = normalize(reflect(sunDir.negate(), crispNormal))
  const specDot = max(dot(viewVec, sunRefl), float(0.0))
  const specPower = mix(float(2200.0), float(120.0), clamp(uSpecularSize, float(0.0), float(1.0)))
  const specGain = mix(float(3.2), float(1.1), clamp(uSpecularSize, float(0.0), float(1.0)))
  const sunSparkle = pow(specDot, specPower).mul(uSpecularStrength).mul(specGain).mul(float(0.35).add(highFreqFade.mul(0.65)))
  const crestThin = mix(float(0.55), float(1.35), smoothstep(float(-0.2), float(0.8), waveNorm))
  const sunScatter = pow(max(dot(viewVec, sunDir.negate()), float(0.0)), float(5.0))
    .mul(max(float(1.0).sub(nDotV), float(0.1)))
    .mul(crestThin)
    .mul(uSssStrength)
  const sssColor = uShallowColor.mul(sunScatter).mul(0.55)

  // 8. 最终合成（波浪迎光亮背光暗 + 泡沫底部微暗边增加漂浮厚度感）
  const litBody = refractedBody.mul(waveShade).add(sssColor)
  const waterSurface = mix(litBody, reflectionColor, fresnel).add(uSunColor.mul(sunSparkle))
  const foamShadow = smoothstep(float(0.05), float(0.35), foamAlpha).mul(float(1.0).sub(foamAlpha))
  const shadedWater = waterSurface.mul(float(1.0).sub(foamShadow.mul(0.18)))
  const finalColor = mix(shadedWater, uFoamColor, foamAlpha)

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
      uCrestFoamThreshold.value = spec.crestFoamThreshold
      uShoreFoamOn.value = spec.shoreFoam ? 1 : 0
      uSoftEdge.value = spec.softEdge
      uCausticsStrength.value = spec.causticsStrength
      uCausticsScale.value = spec.causticsScale
      uWaveHeight.value = spec.quality === 'fast' ? 0 : spec.waveHeight
      uWaveSteepness.value = spec.quality === 'fast' ? 0 : spec.waveSteepness
      if (mirrorReflector) {
        mirrorReflector.reflector.resolutionScale = Math.max(0.25, spec.reflectionScale)
      }
      normalTexNode.value = customNormal ?? defaultNormal
      foamTexNode.value = customFoam ?? defaultFoam
    },
    setTime(time, waveTime) {
      uTime.value = time
      uWaveTime.value = waveTime
    },
    setInvScale(worldScale) {
      uInvScale.value.set(
        1 / Math.max(0.001, Math.abs(worldScale.x)),
        1 / Math.max(0.001, Math.abs(worldScale.y)),
        1 / Math.max(0.001, Math.abs(worldScale.z)),
      )
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
