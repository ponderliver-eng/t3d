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
import { defaultWaterFoamTexture, defaultWaterNormalTexture } from './proceduralTextures'

export interface WaterMaterialHandle {
  material: MeshBasicNodeMaterial
  reflectionTarget: Object3D
  setSpec: (spec: WaterSpec, customNormal: Texture | null, customFoam: Texture | null) => void
  setTime: (time: number) => void
  setSun: (direction: Vector3, color: Color, intensity: number) => void
  dispose: () => void
}

export function createWaterMaterial(): WaterMaterialHandle {
  const defaultNormal = defaultWaterNormalTexture()
  const defaultFoam = defaultWaterFoamTexture()

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
  const uWaveHeight = uniform(0)
  const uUsePlanar = uniform(1)

  const normalTexNode = texture(defaultNormal)
  const foamTexNode = texture(defaultFoam)

  // 1. 4 组主风向扇区 Gerstner 浪（非正交、非整数倍波长，形成自然长条浪脊而非圆形蛋托）
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
  const displacedLocal = vec3(
    positionLocal.x,
    positionLocal.y,
    positionLocal.z.add(waveOffset),
  )

  const dWaveDxz = dir1.mul(cos(p1).mul(k1).mul(0.46))
    .add(dir2.mul(cos(p2).mul(k2).mul(0.28)))
    .add(dir3.mul(cos(p3).mul(k3).mul(0.16)))
    .add(dir4.mul(cos(p4).mul(k4).mul(0.10)))
    .mul(uWaveHeight)

  // 2. Water Pro 核心：4 层非整数倍缩放、多向流动的高频细腻法线（保持远景平滑、近景碎波丰富）
  const baseUv = positionWorld.xz.mul(uWaveScale)
  const flow = uFlowDir.mul(uTime.mul(uFlowSpeed.mul(0.05)))
  const flowOrtho = vec2(uFlowDir.y.negate(), uFlowDir.x).mul(uTime.mul(uFlowSpeed.mul(0.038)))

  const n1 = normalTexNode.sample(baseUv.mul(0.37).add(flow.mul(0.7))).xyz.mul(2.0).sub(1.0)
  const n2 = normalTexNode.sample(baseUv.mul(0.91).sub(flowOrtho.mul(0.9))).xyz.mul(2.0).sub(1.0)
  const n3 = normalTexNode.sample(baseUv.mul(2.13).add(flow.mul(1.3).add(flowOrtho.mul(0.4)))).xyz.mul(2.0).sub(1.0)
  const n4 = normalTexNode.sample(baseUv.mul(4.71).sub(flow.mul(0.8).sub(flowOrtho.mul(1.2)))).xyz.mul(2.0).sub(1.0)

  const nAvg = n1.mul(0.32).add(n2.mul(0.28)).add(n3.mul(0.24)).add(n4.mul(0.16))
  const surfaceNormal = normalize(vec3(
    nAvg.x.mul(uNormalScale).sub(dWaveDxz.x.mul(1.2)),
    float(1.0),
    nAvg.y.mul(uNormalScale).sub(dWaveDxz.y.mul(1.2)),
  ))
  // 高光专用更锐利的高频微法线，切出细碎尖锐的波光闪点
  const nCrisp = n2.mul(0.25).add(n3.mul(0.4)).add(n4.mul(0.35))
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

  // 4. Three.js 原生 TSL reflector() 平面反射 + 距离自适应法线扰动
  const distortion = surfaceNormal.xz.mul(float(0.008).add(float(0.18).div(max(eyeDist, float(1.0))))).mul(uNormalScale)
  const mirrorSampler = reflector({ resolutionScale: 0.5 })
  if (mirrorSampler.uvNode) mirrorSampler.uvNode = mirrorSampler.uvNode.add(distortion)

  const reflDir = normalize(reflect(viewVec.negate(), surfaceNormal))
  const skyGrad = smoothstep(float(0.0), float(0.5), max(reflDir.y, float(0.0)))
  const fallbackReflection = mix(uSkyHorizonColor, uSkyTopColor, skyGrad)
  const reflectionColor = mix(fallbackReflection, mirrorSampler.rgb, uUsePlanar)

  // 5. 水深计算 + 屏幕空间折射（防面上方物体边缘鬼影）
  const depthScale = cameraFar.sub(cameraNear)
  const waterDepth = max(viewportLinearDepth.sub(linearDepth()).mul(depthScale), float(0.0))

  const refractUv = clamp(screenUV.add(distortion.mul(0.6)), vec2(0.002, 0.002), vec2(0.998, 0.998))
  const refractDepth = linearDepth(viewportDepthTexture(refractUv)).sub(linearDepth()).mul(depthScale)
  const safeRefractUv = select(refractDepth.greaterThan(float(0.0)), refractUv, screenUV)
  const underWaterColor = viewportSharedTexture(safeRefractUv).rgb

  // Beer-Lambert 指数吸收：浅水清澈透出折射水底，深水过渡到深海色
  const absorb = float(1.0).sub(exp(waterDepth.negate().div(max(uDepthAbsorption, float(0.1)))))
  const waterTint = mix(uShallowColor, uDeepColor, clamp(absorb, float(0.0), float(1.0)))
  const transmit = clamp(float(1.0).sub(absorb).mul(float(1.0).sub(uOpacity.mul(0.55))), float(0.0), float(1.0))
  const refractedBody = mix(waterTint, underWaterColor.mul(mix(vec3(1.0), uShallowColor, float(0.42))), transmit)

  // 6. 围绕接触水线的窄带镂空泡沫 + 波浪顶端浪花（仅基于真实水深差，绝不外扩到水上剪影）
  const foamNoise1 = foamTexNode.sample(baseUv.mul(2.8).add(flow.mul(1.4))).r
  const foamNoise2 = foamTexNode.sample(baseUv.mul(5.9).sub(flowOrtho.mul(1.7))).r
  const foamCell = foamNoise1.mul(0.55).add(foamNoise2.mul(0.45))

  const shoreBand = float(1.0).sub(smoothstep(float(0.0), max(uFoamWidth, float(0.01)), waterDepth))
  const crestActive = smoothstep(float(0.004), float(0.025), uWaveHeight)
  const crestBreakup = smoothstep(float(0.38), float(0.75), foamTexNode.sample(baseUv.mul(0.35).add(flow.mul(0.5))).r)
  const crestBand = smoothstep(float(0.36), float(0.88), waveNorm).mul(crestActive).mul(crestBreakup).mul(uCrestFoam)
  const foamMask = max(shoreBand, crestBand)
  const foamCut = smoothstep(float(0.58).sub(foamMask.mul(0.38)), float(0.82), foamCell)
  const foamAlpha = clamp(foamMask.mul(foamCut).mul(uFoamIntensity), float(0.0), float(1.0))

  // 7. 太阳碎金高光（可调光斑大小：由高光锐度映射）+ 次表面散射
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

  // 8. 最终合成：水下折射吸收 + 平面反射 + 碎金高光 + 极窄水线白沫
  const waterSurface = mix(refractedBody.add(sssColor), reflectionColor, fresnel).add(uSunColor.mul(sunSparkle))
  const finalColor = mix(waterSurface, uFoamColor, foamAlpha)

  const material = new MeshBasicNodeMaterial()
  material.positionNode = displacedLocal
  material.colorNode = finalColor
  material.opacityNode = float(1.0)
  material.transparent = true
  material.depthWrite = false
  material.side = DoubleSide

  return {
    material,
    reflectionTarget: mirrorSampler.target,
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
      uWaveHeight.value = spec.quality === 'fast' ? 0 : spec.waveHeight
      const planar = spec.quality !== 'fast' && spec.reflectionScale > 0
      uUsePlanar.value = planar ? 1 : 0
      mirrorSampler.reflector.resolutionScale = planar ? spec.reflectionScale : 0.25
      normalTexNode.value = customNormal ?? defaultNormal
      foamTexNode.value = customFoam ?? defaultFoam
    },
    setTime(time) {
      uTime.value = time
    },
    setSun(direction, color, intensity) {
      uSunDir.value.copy(direction).normalize()
      const boost = Math.min(2.0, Math.max(0.2, intensity))
      uSunColor.value.copy(color).multiplyScalar(boost)
    },
    dispose() {
      material.dispose()
    },
  }
}
