import { Color, Matrix4, type Camera } from 'three'
import {
  clamp,
  dot,
  float,
  floor,
  fract,
  getViewPosition,
  isBackgroundDepth,
  length,
  max,
  min,
  mix,
  pow,
  screenUV,
  select,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import type { ScenePicture } from '../../editor/scene/types'
import { getRuntimeWorld } from '../../runtime/world'
import { capabilityEnabled } from '../registry'
import {
  HEIGHT_FOG_CAPABILITY_ID,
  defaultHeightFogSettings,
  normalizeHeightFogSettings,
  type HeightFogSettings,
} from './defaults'

let mounted = false
let removeHook: (() => void) | null = null
let elapsedTime = 0

function currentSettings(pictureOverride?: ScenePicture): HeightFogSettings {
  try {
    const world = getRuntimeWorld()
    if (!capabilityEnabled(world.getCapabilities(), HEIGHT_FOG_CAPABILITY_ID)) {
      return defaultHeightFogSettings()
    }
    const picture = pictureOverride ?? world.getPicture()
    return normalizeHeightFogSettings(picture.capabilities?.[HEIGHT_FOG_CAPABILITY_ID])
  } catch {
    if (!pictureOverride) return defaultHeightFogSettings()
    return normalizeHeightFogSettings(pictureOverride.capabilities?.[HEIGHT_FOG_CAPABILITY_ID])
  }
}

export function mount() {
  if (mounted) return () => shutdown()
  mounted = true
  elapsedTime = 0
  removeHook =
    getRuntimeWorld().registerBeforeRenderHook?.(HEIGHT_FOG_CAPABILITY_ID, 25, (ctx) => {
      elapsedTime += ctx.dt
    }) ?? null
  return () => shutdown()
}

export function dispose() {
  shutdown()
}

function shutdown() {
  mounted = false
  removeHook?.()
  removeHook = null
}

/** 当前高度雾能力包是否处于激活状态。 */
export function heightFogActive(picture?: ScenePicture): boolean {
  if (!mounted) return false
  const s = currentSettings(picture)
  return s.enabled && s.opacity > 0 && (s.heightEnabled || s.distanceEnabled)
}

/** 用于触发 RenderPipeline 重建的管线结构签名（按开关精确裁剪着色器分支）。 */
export function heightFogPipelineKey(picture?: ScenePicture): string {
  if (!heightFogActive(picture)) return 'off'
  const s = currentSettings(picture)
  const hNoise = s.heightEnabled && s.heightNoiseEnabled ? 1 : 0
  const dNoise = s.distanceEnabled && s.distanceNoiseEnabled ? 1 : 0
  return `on:${hNoise}:${dNoise}`
}

/**
 * 零三角函数的高性能 3D Hash（Dave Hoskins hash13 变体）：
 * 仅使用纯乘加与 `fract`/`dot`，避免全屏像素着色器执行高延迟 `sin()`。
 */
function fastHash13(p: unknown) {
  const q = fract(vec3(p as never).mul(0.1031))
  const r = q.add(dot(q, q.yzx.add(33.33)))
  return fract(r.x.add(r.y).mul(r.z))
}

/**
 * 轻量单层平滑 3D Value Noise（无 `sin()`，8 次乘加哈希 + 三线性插值）：
 * 相比 2 层 FBM + `sin()` 哈希减少约 75%~85% ALU 开销，同时保持柔和的立体雾团感。
 */
function fastValueNoise3D(p: unknown) {
  const i = floor(p as never)
  const f = fract(p as never)
  const u = f.mul(f).mul(vec3(3, 3, 3).sub(f.mul(2)))

  const n000 = fastHash13(i)
  const n100 = fastHash13(i.add(vec3(1, 0, 0)))
  const n010 = fastHash13(i.add(vec3(0, 1, 0)))
  const n110 = fastHash13(i.add(vec3(1, 1, 0)))
  const n001 = fastHash13(i.add(vec3(0, 0, 1)))
  const n101 = fastHash13(i.add(vec3(1, 0, 1)))
  const n011 = fastHash13(i.add(vec3(0, 1, 1)))
  const n111 = fastHash13(i.add(vec3(1, 1, 1)))

  const nx00 = mix(n000, n100, u.x)
  const nx10 = mix(n010, n110, u.x)
  const nx01 = mix(n001, n101, u.x)
  const nx11 = mix(n011, n111, u.x)
  const nxy0 = mix(nx00, nx10, u.y)
  const nxy1 = mix(nx01, nx11, u.y)
  return mix(nxy0, nxy1, u.z)
}

export interface HeightFogPassHandle {
  node: unknown
  sync: (picture: ScenePicture, camera: Camera) => void
}

/**
 * 在 TSL 后期管线中合成「高度雾 + 远近雾 + 独立噪点」。
 * 显式传入主相机投影逆矩阵与世界矩阵，保证世界空间 Y 轴高度严格锁定不随镜头旋转偏移，
 * 同时兼容 WebGPU 与 WebGL2 后端。
 */
export function buildHeightFogPass(
  colorNode: { rgb: unknown; a: unknown },
  scenePass: { getTextureNode: (name: string) => unknown },
  options: { heightNoise: boolean; distanceNoise: boolean },
): HeightFogPassHandle {
  const uCameraWorldMatrix = uniform(new Matrix4())
  const uCameraProjInverse = uniform(new Matrix4())
  const uOpacity = uniform(1)
  const uAffectSky = uniform(0)

  const uHeightEnabled = uniform(1)
  const uHeightBottomColor = uniform(new Color('#5c789c'))
  const uHeightMidColor = uniform(new Color('#8fa8c8'))
  const uHeightTopColor = uniform(new Color('#c7d9ee'))
  const uHeightBase = uniform(0.3)
  const uHeightRange = uniform(2)
  const uHeightDensity = uniform(0.85)
  const uHeightFalloff = uniform(1.2)
  const uHeightNoiseScale = uniform(0.35)
  const uHeightNoiseIntensity = uniform(0.4)
  const uHeightNoiseTime = uniform(0)

  const uDistEnabled = uniform(1)
  const uDistNearColor = uniform(new Color('#b8cbe0'))
  const uDistFarColor = uniform(new Color('#6f89ab'))
  const uDistStart = uniform(5)
  const uDistEnd = uniform(50)
  const uDistTrans = uniform(15)
  const uDistDensity = uniform(0.9)
  const uDistNoiseScale = uniform(0.08)
  const uDistNoiseIntensity = uniform(0.35)
  const uDistNoiseTime = uniform(0)

  const depthNode = scenePass.getTextureNode('depth') as never
  const isBg = isBackgroundDepth(depthNode)

  const viewPos = getViewPosition(screenUV, depthNode, uCameraProjInverse)
  const viewDist = length(viewPos)
  const worldPos = uCameraWorldMatrix.mul(vec4(viewPos, 1.0)).xyz

  // 1. 高度雾：低于 heightBase 时最浓，在 [heightBase, heightBase + heightRange] 内按曲线过渡到 0
  const hNorm = clamp(worldPos.y.sub(uHeightBase).div(max(uHeightRange, float(0.001))), 0.0, 1.0)
  const hCurve = pow(float(1.0).sub(hNorm), max(uHeightFalloff, float(0.05)))
  const hBaseWeight = hCurve.mul(uHeightDensity).mul(uHeightEnabled)

  // 2. 远近雾：起点 distanceStart、终点 distanceEnd、过渡范围 distanceTransition
  const dMain = smoothstep(uDistStart, max(uDistStart.add(0.01), uDistEnd), viewDist)
  const dRamp = smoothstep(uDistStart, uDistStart.add(max(uDistTrans, float(0.01))), viewDist)
  const dBaseWeight = dMain
    .mul(mix(float(1.0), dRamp, clamp(uDistTrans.div(max(uDistEnd.sub(uDistStart), float(0.01))), 0.0, 1.0)))
    .mul(uDistDensity)
    .mul(uDistEnabled)

  // 3. 独立的轻量 3D 世界空间噪点扰动（按需编译，互不干扰）
  let hWeight = hBaseWeight
  if (options.heightNoise) {
    const hSamplePos = worldPos
      .mul(uHeightNoiseScale)
      .add(vec3(uHeightNoiseTime, uHeightNoiseTime.mul(0.37), uHeightNoiseTime.mul(0.71)))
    const hNoise = fastValueNoise3D(hSamplePos)
    const hMod = mix(float(1.0), clamp(hNoise.mul(1.7).add(0.15), 0.0, 1.5), uHeightNoiseIntensity)
    hWeight = clamp(hBaseWeight.mul(hMod), 0.0, 1.0)
  }

  let dWeight = dBaseWeight
  if (options.distanceNoise) {
    const dSamplePos = worldPos
      .mul(uDistNoiseScale)
      .add(vec3(uDistNoiseTime.mul(0.83), uDistNoiseTime.mul(0.29), uDistNoiseTime))
    const dNoise = fastValueNoise3D(dSamplePos)
    const dMod = mix(float(1.0), clamp(dNoise.mul(1.7).add(0.15), 0.0, 1.5), uDistNoiseIntensity)
    dWeight = clamp(dBaseWeight.mul(dMod), 0.0, 1.0)
  }

  // 天空/背景像素处理：若未开启 affectSky，雾量为 0；开启时按远近雾主导合成
  const combinedRaw = clamp(max(hWeight, dWeight).add(min(hWeight, dWeight).mul(0.35)), 0.0, 1.0)
  const skyFogAmount = clamp(dWeight.mul(uDistEnabled).add(hWeight.mul(0.25).mul(uHeightEnabled)), 0.0, 1.0).mul(uAffectSky)
  const fogFactor = select(isBg, skyFogAmount, combinedRaw).mul(uOpacity)

  const weightSum = max(hWeight.add(dWeight), float(0.0001))
  const distRatio = dWeight.div(weightSum)

  // 高度雾三色垂直渐变（底层 -> 中层 -> 顶层）
  const hMidT = clamp(hNorm.mul(2.0), 0.0, 1.0)
  const hTopT = clamp(hNorm.mul(2.0).sub(1.0), 0.0, 1.0)
  const heightGradColor = mix(mix(uHeightBottomColor, uHeightMidColor, hMidT), uHeightTopColor, hTopT)

  // 远近雾近端 -> 远端双色渐变
  const distGradColor = mix(uDistNearColor, uDistFarColor, dMain)

  const blendedFogColor = mix(heightGradColor, distGradColor, distRatio)

  const outRgb = mix(colorNode.rgb as never, blendedFogColor as never, fogFactor)
  const node = vec4(outRgb, colorNode.a as never)

  return {
    node,
    sync: (picture: ScenePicture, camera: Camera) => {
      const s = currentSettings(picture)
      camera.updateMatrixWorld()
      uCameraWorldMatrix.value.copy(camera.matrixWorld)
      uCameraProjInverse.value.copy(camera.projectionMatrixInverse)
      uOpacity.value = s.enabled ? s.opacity : 0
      uAffectSky.value = s.affectSky ? 1 : 0

      uHeightEnabled.value = s.heightEnabled ? 1 : 0
      uHeightBottomColor.value.set(s.heightColor)
      uHeightMidColor.value.set(s.heightGradient ? s.heightMidColor : s.heightColor)
      uHeightTopColor.value.set(s.heightGradient ? s.heightTopColor : s.heightColor)
      uHeightBase.value = s.heightBase
      uHeightRange.value = s.heightRange
      uHeightDensity.value = s.heightDensity
      uHeightFalloff.value = s.heightFalloff
      if (options.heightNoise) {
        uHeightNoiseScale.value = s.heightNoiseScale
        uHeightNoiseIntensity.value = s.heightNoiseIntensity
        uHeightNoiseTime.value = elapsedTime * s.heightNoiseSpeed
      }

      uDistEnabled.value = s.distanceEnabled ? 1 : 0
      uDistNearColor.value.set(s.distanceNearColor)
      uDistFarColor.value.set(s.distanceFarColor)
      uDistStart.value = s.distanceStart
      uDistEnd.value = s.distanceEnd
      uDistTrans.value = s.distanceTransition
      uDistDensity.value = s.distanceDensity
      if (options.distanceNoise) {
        uDistNoiseScale.value = s.distanceNoiseScale
        uDistNoiseIntensity.value = s.distanceNoiseIntensity
        uDistNoiseTime.value = elapsedTime * s.distanceNoiseSpeed
      }
    },
  }
}
