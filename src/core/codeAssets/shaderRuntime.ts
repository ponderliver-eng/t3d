import {
  AdditiveBlending,
  BackSide,
  Color,
  DataTexture,
  DoubleSide,
  FrontSide,
  MultiplyBlending,
  NoBlending,
  NormalBlending,
  RGBAFormat,
  SubtractiveBlending,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
} from 'three'
import * as tsl from 'three/tsl'
import {
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshSSSNodeMaterial,
  MeshStandardNodeMaterial,
  MeshToonNodeMaterial,
  PhysicalLightingModel,
} from 'three/webgpu'
import { defaultForSchema } from '../schema/fieldSchema'
import type { FieldSchema } from '../schema/fieldSchema'
import { checkAndTranspileTs, evaluateTranspiledModule, type CompileResult } from './compiler'

let textureResolver: ((assetId: string) => Texture | null) | null = null
let cachedFallbackTex: DataTexture | null = null

export function registerShaderTextureResolver(resolver: (assetId: string) => Texture | null): void {
  textureResolver = resolver
}

function fallbackWhiteTexture(): DataTexture {
  if (!cachedFallbackTex) {
    cachedFallbackTex = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat)
    cachedFallbackTex.needsUpdate = true
  }
  return cachedFallbackTex
}

function resolveTextureAsset(raw: unknown): Texture {
  if (typeof raw === 'string' && raw.trim() && textureResolver) {
    const tex = textureResolver(raw.trim())
    if (tex) return tex
  }
  if (raw && typeof raw === 'object' && 'isTexture' in raw) {
    return raw as Texture
  }
  if (raw && typeof raw === 'object' && 'value' in raw) {
    const val = (raw as { value?: unknown }).value
    if (val && typeof val === 'object' && 'isTexture' in val) return val as Texture
  }
  return fallbackWhiteTexture()
}

export type ShaderParamSchema = FieldSchema
export type ShaderParamMap = Record<string, ShaderParamSchema>

export type ShaderMode = 'lit' | 'unlit' | 'physical' | 'toon' | 'sss'
export type ShaderSide = 'front' | 'back' | 'double'
export type ShaderBlending = 'normal' | 'additive' | 'subtractive' | 'multiply' | 'none'

export interface ShaderLightingDirectContext {
  lightDirection: unknown
  lightColor: unknown
  normal: unknown
  viewDirection: unknown
  diffuseColor: unknown
  params: Record<string, unknown>
}

export interface ShaderLightingIndirectContext {
  normal: unknown
  viewDirection: unknown
  diffuseColor: unknown
  params: Record<string, unknown>
}

export interface ShaderSurfaceOutput {
  baseColor?: unknown
  normal?: unknown
  roughness?: unknown
  metalness?: unknown
  emissive?: unknown
  opacity?: unknown
  vertexOffset?: unknown
  clearcoat?: unknown
  clearcoatRoughness?: unknown
  clearcoatNormal?: unknown
  transmission?: unknown
  ior?: unknown
  thickness?: unknown
  attenuationColor?: unknown
  attenuationDistance?: unknown
  sheen?: unknown
  sheenRoughness?: unknown
  iridescence?: unknown
  iridescenceIOR?: unknown
  iridescenceThickness?: unknown
  anisotropy?: unknown
  dispersion?: unknown
  specularIntensity?: unknown
  specularColor?: unknown
}

export interface ShaderDefinition<P extends ShaderParamMap = ShaderParamMap> {
  name: string
  description?: string
  mode?: ShaderMode
  transparent?: boolean
  doubleSided?: boolean
  side?: ShaderSide
  depthWrite?: boolean
  depthTest?: boolean
  blending?: ShaderBlending
  alphaTest?: number
  wireframe?: boolean
  params: P
  surface: (params: Record<string, unknown>) => ShaderSurfaceOutput
  lighting?: {
    direct?: (ctx: ShaderLightingDirectContext) => unknown
    indirect?: (ctx: ShaderLightingIndirectContext) => unknown
  }
}

export interface PostEffectContext {
  color: unknown
  depth: unknown
  normal: unknown
  uv: unknown
  time: unknown
  deltaTime: unknown
  params: Record<string, unknown>
}

export interface PostEffectDefinition<P extends ShaderParamMap = ShaderParamMap> {
  __t3dPostEffect?: true
  name: string
  description?: string
  params?: P
  apply: (ctx: PostEffectContext) => unknown
}

export interface ShaderUniformEntry {
  schema: FieldSchema
  node: { value: unknown }
}

export type AnyNodeMaterial =
  | MeshStandardNodeMaterial
  | MeshBasicNodeMaterial
  | MeshPhysicalNodeMaterial
  | MeshToonNodeMaterial
  | MeshSSSNodeMaterial

export interface CompiledShaderAsset {
  id: string
  file: string
  kind?: 'shader' | 'postEffect'
  definition: ShaderDefinition
  postEffectDefinition?: PostEffectDefinition
  material: AnyNodeMaterial
  paramValues: Record<string, unknown>
  uniforms: Record<string, ShaderUniformEntry>
}

function asNode(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return tsl.float(value)
  if (typeof value === 'boolean') return tsl.float(value ? 1 : 0)
  if (typeof value === 'string') return tsl.color(new Color(value))
  return value
}

function coerceUniformValue(schema: FieldSchema, raw: unknown): unknown {
  const value = raw !== undefined ? raw : defaultForSchema(schema)
  if (schema.type === 'number') return Number(value) || 0
  if (schema.type === 'boolean') return value ? 1 : 0
  if (schema.type === 'color') return new Color(typeof value === 'string' ? value : '#ffffff')
  if (schema.type === 'vec2') {
    const arr = Array.isArray(value) ? value : [0, 0]
    return new Vector2(Number(arr[0]) || 0, Number(arr[1]) || 0)
  }
  if (schema.type === 'vec3') {
    const arr = Array.isArray(value) ? value : [0, 0, 0]
    return new Vector3(Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0)
  }
  if (schema.type === 'vec4') {
    const arr = Array.isArray(value) ? value : [0, 0, 0, 1]
    return new Vector4(Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0, Number(arr[3]) ?? 1)
  }
  if (schema.type === 'texture' || (schema.type === 'ref' && schema.target === 'asset')) {
    return resolveTextureAsset(value)
  }
  return value
}

function paramToNode(schema: FieldSchema, raw: unknown): { node: unknown; uniformEntry?: ShaderUniformEntry } {
  if (schema.type === 'number' || schema.type === 'boolean' || schema.type === 'color' || schema.type === 'vec2' || schema.type === 'vec3' || schema.type === 'vec4') {
    const uVal = coerceUniformValue(schema, raw)
    const uNode = tsl.uniform(uVal as never) as unknown as { value: unknown }
    return { node: uNode, uniformEntry: { schema, node: uNode } }
  }
  if (schema.type === 'texture' || (schema.type === 'ref' && schema.target === 'asset')) {
    const tex = resolveTextureAsset(raw !== undefined ? raw : defaultForSchema(schema))
    const texNode = tsl.texture(tex) as unknown as { value: unknown }
    return { node: texNode, uniformEntry: { schema, node: texNode } }
  }
  const value = raw !== undefined ? raw : defaultForSchema(schema)
  return { node: value }
}

const tslBag = tsl as unknown as Record<string, unknown>
const tslFn = (name: string) => (...args: unknown[]) => {
  const fn = tslBag[name]
  if (typeof fn !== 'function') {
    throw new Error(`当前 three/tsl 版本不支持节点函数 "${name}"`)
  }
  return (fn as (...a: unknown[]) => unknown)(...args.map(asNode))
}

export function createShaderSdk() {
  return {
    defineShader: <P extends ShaderParamMap>(def: ShaderDefinition<P>) => def,
    definePostEffect: <P extends ShaderParamMap>(def: PostEffectDefinition<P>): PostEffectDefinition<P> => ({
      ...def,
      __t3dPostEffect: true,
    }),
    float: (x = 0) => tsl.float(x),
    int: (x = 0) => tsl.int(x),
    uint: (x = 0) => tsl.uint(x),
    vec2: (x = 0, y = 0) => tsl.vec2(x, y),
    vec3: (x = 0, y = 0, z = 0) => tsl.vec3(x, y, z),
    vec4: (x = 0, y = 0, z = 0, w = 1) => tsl.vec4(x, y, z, w),
    ivec2: tslFn('ivec2'),
    ivec3: tslFn('ivec3'),
    ivec4: tslFn('ivec4'),
    uvec2: tslFn('uvec2'),
    uvec3: tslFn('uvec3'),
    uvec4: tslFn('uvec4'),
    mat3: tslFn('mat3'),
    mat4: tslFn('mat4'),
    uniform: (val: unknown) => tsl.uniform(val as never),
    varying: (node: unknown, name?: string) => (tsl.varying as (...a: unknown[]) => unknown)(asNode(node), name),
    Fn: tsl.Fn,
    If: tsl.If,
    Loop: tsl.Loop,
    Break: tsl.Break,
    Continue: tsl.Continue,
    select: (cond: unknown, a: unknown, b: unknown) =>
      (tsl.select as (...args: unknown[]) => unknown)(asNode(cond), asNode(a), asNode(b)),
    color: (hexOrR: string | number, g?: number, b?: number) =>
      typeof hexOrR === 'string' ? tsl.color(new Color(hexOrR)) : tsl.vec3(hexOrR, g ?? hexOrR, b ?? hexOrR),
    mix: (a: unknown, b: unknown, t: unknown) => (tsl.mix as (...args: unknown[]) => unknown)(asNode(a), asNode(b), asNode(t)),
    clamp: (x: unknown, minVal: unknown, maxVal: unknown) =>
      (tsl.clamp as (...args: unknown[]) => unknown)(asNode(x), asNode(minVal), asNode(maxVal)),
    smoothstep: (edge0: unknown, edge1: unknown, x: unknown) =>
      (tsl.smoothstep as (...args: unknown[]) => unknown)(asNode(edge0), asNode(edge1), asNode(x)),
    step: (edge: unknown, x: unknown) => (tsl.step as (...args: unknown[]) => unknown)(asNode(edge), asNode(x)),
    tan: (x: unknown) => (tsl.tan as (v: unknown) => unknown)(asNode(x)),
    sin: (x: unknown) => (tsl.sin as (v: unknown) => unknown)(asNode(x)),
    cos: (x: unknown) => (tsl.cos as (v: unknown) => unknown)(asNode(x)),
    asin: tslFn('asin'),
    acos: tslFn('acos'),
    atan: tslFn('atan'),
    atan2: tslFn('atan2'),
    radians: tslFn('radians'),
    degrees: tslFn('degrees'),
    abs: (x: unknown) => (tsl.abs as (v: unknown) => unknown)(asNode(x)),
    sign: (x: unknown) => (tsl.sign as (v: unknown) => unknown)(asNode(x)),
    floor: (x: unknown) => (tsl.floor as (v: unknown) => unknown)(asNode(x)),
    ceil: (x: unknown) => (tsl.ceil as (v: unknown) => unknown)(asNode(x)),
    round: tslFn('round'),
    trunc: tslFn('trunc'),
    fract: (x: unknown) => (tsl.fract as (v: unknown) => unknown)(asNode(x)),
    mod: tslFn('mod'),
    pow: (x: unknown, y: unknown) => (tsl.pow as (...args: unknown[]) => unknown)(asNode(x), asNode(y)),
    sqrt: (x: unknown) => (tsl.sqrt as (v: unknown) => unknown)(asNode(x)),
    exp: (x: unknown) => (tsl.exp as (v: unknown) => unknown)(asNode(x)),
    log: (x: unknown) => (tsl.log as (v: unknown) => unknown)(asNode(x)),
    saturate: (x: unknown) => (tsl.saturate as (v: unknown) => unknown)(asNode(x)),
    min: (a: unknown, b: unknown) => (tsl.min as (...args: unknown[]) => unknown)(asNode(a), asNode(b)),
    max: (a: unknown, b: unknown) => (tsl.max as (...args: unknown[]) => unknown)(asNode(a), asNode(b)),
    dot: (a: unknown, b: unknown) => (tsl.dot as (...args: unknown[]) => unknown)(asNode(a), asNode(b)),
    cross: (a: unknown, b: unknown) => (tsl.cross as (...args: unknown[]) => unknown)(asNode(a), asNode(b)),
    normalize: (v: unknown) => (tsl.normalize as (x: unknown) => unknown)(asNode(v)),
    length: (v: unknown) => (tsl.length as (x: unknown) => unknown)(asNode(v)),
    distance: (a: unknown, b: unknown) => (tsl.distance as (...args: unknown[]) => unknown)(asNode(a), asNode(b)),
    reflect: (incident: unknown, normal: unknown) => (tsl.reflect as (...args: unknown[]) => unknown)(asNode(incident), asNode(normal)),
    refract: tslFn('refract'),
    faceforward: tslFn('faceforward'),
    fwidth: (x: unknown) => (tsl.fwidth as (v: unknown) => unknown)(asNode(x)),
    dFdx: tslFn('dFdx'),
    dFdy: tslFn('dFdy'),
    hash: tslFn('hash'),
    fresnel: (normalNode: unknown, viewDirNode: unknown, power: unknown = 3) => {
      const n = (tsl.normalize as (x: unknown) => unknown)(asNode(normalNode))
      const v = (tsl.normalize as (x: unknown) => unknown)(asNode(viewDirNode))
      const ndotv = (tsl.clamp as (...args: unknown[]) => { oneMinus: () => unknown })(
        (tsl.dot as (...args: unknown[]) => unknown)(n, v),
        0,
        1,
      )
      return (tsl.pow as (...args: unknown[]) => unknown)(ndotv.oneMinus(), asNode(power))
    },
    uv: (index = 0) => tsl.uv(index),
    time: tsl.time,
    deltaTime: tsl.deltaTime,
    normalView: tsl.normalView,
    normalWorld: tsl.normalWorld,
    normalLocal: tsl.normalLocal,
    tangentLocal: tslBag.tangentLocal,
    tangentView: tslBag.tangentView,
    tangentWorld: tslBag.tangentWorld,
    positionGeometry: tsl.positionGeometry,
    positionWorld: tsl.positionWorld,
    positionLocal: tsl.positionLocal,
    positionView: tsl.positionView,
    viewDirection: tsl.positionViewDirection,
    positionViewDirection: tsl.positionViewDirection,
    cameraPosition: tsl.cameraPosition,
    cameraNear: tsl.cameraNear,
    cameraFar: tsl.cameraFar,
    cameraViewMatrix: tsl.cameraViewMatrix,
    cameraProjectionMatrix: tsl.cameraProjectionMatrix,
    modelWorldMatrix: tsl.modelWorldMatrix,
    modelViewMatrix: tsl.modelViewMatrix,
    frontFacing: tsl.frontFacing,
    screenUV: tsl.screenUV,
    screenCoordinate: tslBag.screenCoordinate,
    screenSize: tslBag.screenSize,
    viewportCoordinate: tslBag.viewportCoordinate,
    viewportSize: tslBag.viewportSize,
    linearDepth: (...args: unknown[]) => (tsl.linearDepth as (...a: unknown[]) => unknown)(...args.map(asNode)),
    viewportLinearDepth: tslBag.viewportLinearDepth,
    viewportDepthTexture: (...args: unknown[]) =>
      (tslBag.viewportDepthTexture as ((...a: unknown[]) => unknown) | undefined)?.(...args.map(asNode)),
    viewportSharedTexture: (...args: unknown[]) =>
      (tslBag.viewportSharedTexture as ((...a: unknown[]) => unknown) | undefined)?.(...args.map(asNode)),
    vertexColor: () => tsl.vertexColor(),
    texture: (texRef: unknown, uvNode?: unknown) => {
      const tex = resolveTextureAsset(texRef)
      return uvNode !== undefined
        ? tsl.texture(tex, asNode(uvNode) as never)
        : tsl.texture(tex)
    },
  }
}

const PHYSICAL_SURFACE_KEYS = new Set([
  'clearcoat',
  'clearcoatRoughness',
  'clearcoatNormal',
  'transmission',
  'ior',
  'thickness',
  'attenuationColor',
  'attenuationDistance',
  'sheen',
  'sheenRoughness',
  'iridescence',
  'iridescenceIOR',
  'iridescenceThickness',
  'anisotropy',
  'dispersion',
  'specularIntensity',
  'specularColor',
])

const VALID_SURFACE_KEYS = new Set([
  'baseColor',
  'normal',
  'roughness',
  'metalness',
  'emissive',
  'opacity',
  'vertexOffset',
  ...PHYSICAL_SURFACE_KEYS,
])

function applyLightingContribution(target: { directDiffuse?: unknown; directSpecular?: unknown; indirectDiffuse?: unknown; indirectSpecular?: unknown }, result: unknown, kind: 'direct' | 'indirect') {
  if (!result || typeof result !== 'object') return
  const r = result as { diffuse?: unknown; specular?: unknown; addAssign?: unknown }
  if ('diffuse' in r || 'specular' in r) {
    if (r.diffuse !== undefined) {
      const slot = kind === 'direct' ? target.directDiffuse : target.indirectDiffuse
      ;(slot as { addAssign?: (v: unknown) => void })?.addAssign?.(asNode(r.diffuse))
    }
    if (r.specular !== undefined) {
      const slot = kind === 'direct' ? target.directSpecular : target.indirectSpecular
      ;(slot as { addAssign?: (v: unknown) => void })?.addAssign?.(asNode(r.specular))
    }
    return
  }
  const slot = kind === 'direct' ? target.directDiffuse : target.indirectDiffuse
  ;(slot as { addAssign?: (v: unknown) => void })?.addAssign?.(asNode(result))
}

export function buildMaterialFromShader(
  def: ShaderDefinition,
  overrides?: Record<string, unknown>,
  options?: { strict?: boolean },
): {
  material: AnyNodeMaterial
  paramValues: Record<string, unknown>
  uniforms: Record<string, ShaderUniformEntry>
  warnings: string[]
} {
  const paramValues: Record<string, unknown> = {}
  const runtimeParams: Record<string, unknown> = {}
  const uniforms: Record<string, ShaderUniformEntry> = {}
  const accessedParams = new Set<string>()
  const declaredKeys = Object.keys(def.params ?? {})
  for (const [key, schema] of Object.entries(def.params ?? {})) {
    const val = overrides && key in overrides ? overrides[key] : defaultForSchema(schema)
    paramValues[key] = val
    const built = paramToNode(schema, val)
    runtimeParams[key] = built.node
    if (built.uniformEntry) uniforms[key] = built.uniformEntry
  }

  const trackedParams = new Proxy(runtimeParams, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') accessedParams.add(prop)
      return Reflect.get(target, prop, receiver)
    },
  })

  const surfaceArg = new Proxy(
    {
      params: trackedParams,
      uv: tsl.uv(0),
      time: tsl.time,
      deltaTime: tsl.deltaTime,
      positionGeometry: tsl.positionGeometry,
      positionLocal: tsl.positionLocal,
      positionWorld: tsl.positionWorld,
      positionView: tsl.positionView,
      normalLocal: tsl.normalLocal,
      normalView: tsl.normalView,
      normalWorld: tsl.normalWorld,
      viewDirection: tsl.positionViewDirection,
      positionViewDirection: tsl.positionViewDirection,
      cameraPosition: tsl.cameraPosition,
      cameraNear: tsl.cameraNear,
      cameraFar: tsl.cameraFar,
      frontFacing: tsl.frontFacing,
      screenUV: tsl.screenUV,
      linearDepth: tsl.linearDepth,
      vertexColor: tsl.vertexColor(),
    } as Record<string, unknown>,
    {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && prop in runtimeParams) {
          return Reflect.get(trackedParams, prop)
        }
        return Reflect.get(target, prop, receiver)
      },
    },
  )

  const out = def.surface(surfaceArg) as Record<string, unknown>
  const warnings: string[] = []
  if (!out || typeof out !== 'object') {
    throw new Error('surface() 必须返回一个包含表面输出属性的对象')
  }

  const outKeys = Object.keys(out).filter((k) => out[k] !== undefined)
  const unknownKeys = outKeys.filter((k) => !VALID_SURFACE_KEYS.has(k))
  if (unknownKeys.length > 0) {
    const mapped = unknownKeys.map((k) => (k === 'color' ? 'color（应为 baseColor）' : k)).join('、')
    if (options?.strict) {
      throw new Error(`surface() 返回了无效字段：${mapped}`)
    }
    warnings.push(`surface() 返回了未识别字段：${mapped}`)
  }

  const validCount = outKeys.filter((k) => VALID_SURFACE_KEYS.has(k)).length
  if (validCount === 0 && !out.color) {
    throw new Error('surface() 未返回任何有效输出字段（如 baseColor / emissive / roughness / opacity）')
  }

  const unusedParams = declaredKeys.filter((k) => !accessedParams.has(k))
  if (unusedParams.length > 0) {
    const msg = `params 中声明了 ${unusedParams.join('、')}，但 surface() 中未使用`
    if (options?.strict && !def.lighting) {
      throw new Error(msg)
    }
    warnings.push(msg)
  }

  if (out.opacity !== undefined && !def.transparent) {
    warnings.push('surface() 返回了 opacity，建议设置 transparent: true 才会生效')
  }

  const isUnlit = def.mode === 'unlit'
  const usesPhysical = def.mode === 'physical' || outKeys.some((k) => PHYSICAL_SURFACE_KEYS.has(k))
  let material: AnyNodeMaterial
  if (isUnlit) {
    material = new MeshBasicNodeMaterial()
  } else if (def.mode === 'toon') {
    material = new MeshToonNodeMaterial()
  } else if (def.mode === 'sss') {
    material = new MeshSSSNodeMaterial()
  } else if (usesPhysical) {
    material = new MeshPhysicalNodeMaterial()
  } else {
    material = new MeshStandardNodeMaterial()
  }

  const baseColorNode = out.baseColor !== undefined ? out.baseColor : out.color
  if (baseColorNode !== undefined) {
    ;(material as unknown as { colorNode?: unknown }).colorNode = asNode(baseColorNode)
  }
  if (out.opacity !== undefined) {
    ;(material as unknown as { opacityNode?: unknown }).opacityNode = asNode(out.opacity)
  }
  if (out.vertexOffset !== undefined) {
    ;(material as unknown as { positionNode?: unknown }).positionNode = tsl.positionLocal.add(asNode(out.vertexOffset) as never)
  }

  if (!isUnlit) {
    if (out.roughness !== undefined) (material as unknown as { roughnessNode?: unknown }).roughnessNode = asNode(out.roughness)
    if (out.metalness !== undefined) (material as unknown as { metalnessNode?: unknown }).metalnessNode = asNode(out.metalness)
    if (out.emissive !== undefined) (material as unknown as { emissiveNode?: unknown }).emissiveNode = asNode(out.emissive)
    if (out.normal !== undefined) (material as unknown as { normalNode?: unknown }).normalNode = asNode(out.normal)
  }

  if (!isUnlit && material instanceof MeshPhysicalNodeMaterial) {
    const physMap: Array<[keyof ShaderSurfaceOutput, string]> = [
      ['clearcoat', 'clearcoatNode'],
      ['clearcoatRoughness', 'clearcoatRoughnessNode'],
      ['clearcoatNormal', 'clearcoatNormalNode'],
      ['transmission', 'transmissionNode'],
      ['ior', 'iorNode'],
      ['thickness', 'thicknessNode'],
      ['attenuationColor', 'attenuationColorNode'],
      ['attenuationDistance', 'attenuationDistanceNode'],
      ['sheen', 'sheenNode'],
      ['sheenRoughness', 'sheenRoughnessNode'],
      ['iridescence', 'iridescenceNode'],
      ['iridescenceIOR', 'iridescenceIORNode'],
      ['iridescenceThickness', 'iridescenceThicknessNode'],
      ['anisotropy', 'anisotropyNode'],
      ['dispersion', 'dispersionNode'],
      ['specularIntensity', 'specularIntensityNode'],
      ['specularColor', 'specularColorNode'],
    ]
    for (const [key, nodeProp] of physMap) {
      if (out[key] !== undefined) {
        ;(material as unknown as Record<string, unknown>)[nodeProp] = asNode(out[key])
      }
    }
  }

  if (!isUnlit && def.lighting && (typeof def.lighting.direct === 'function' || typeof def.lighting.indirect === 'function')) {
    const customLighting = def.lighting
    class CustomShaderLightingModel extends PhysicalLightingModel {
      override direct(
        lightData: { lightDirection: unknown; lightColor: unknown; reflectedLight: { directDiffuse?: unknown; directSpecular?: unknown } },
        builder: unknown,
      ): void {
        if (typeof customLighting.direct === 'function') {
          const res = customLighting.direct({
            lightDirection: lightData.lightDirection,
            lightColor: lightData.lightColor,
            normal: tsl.normalView,
            viewDirection: tsl.positionViewDirection,
            diffuseColor: tsl.diffuseColor,
            params: trackedParams,
          })
          applyLightingContribution(lightData.reflectedLight, res, 'direct')
          return
        }
        super.direct(lightData as never, builder as never)
      }

      override indirect(builder: Parameters<PhysicalLightingModel['indirect']>[0]): void {
        if (typeof customLighting.indirect === 'function') {
          const res = customLighting.indirect({
            normal: tsl.normalView,
            viewDirection: tsl.positionViewDirection,
            diffuseColor: tsl.diffuseColor,
            params: trackedParams,
          })
          const reflectedLight = (builder as unknown as { context?: { reflectedLight?: { indirectDiffuse?: unknown; indirectSpecular?: unknown } } })?.context?.reflectedLight
          if (reflectedLight) {
            applyLightingContribution(reflectedLight, res, 'indirect')
          }
          return
        }
        super.indirect(builder)
      }
    }
    ;(material as unknown as { setupLightingModel?: () => unknown }).setupLightingModel = () => new CustomShaderLightingModel()
  }

  if (def.transparent) material.transparent = true
  if (def.side === 'back') material.side = BackSide
  else if (def.side === 'double' || def.doubleSided) material.side = DoubleSide
  else if (def.side === 'front') material.side = FrontSide
  if (typeof def.depthWrite === 'boolean') material.depthWrite = def.depthWrite
  if (typeof def.depthTest === 'boolean') material.depthTest = def.depthTest
  if (def.blending === 'additive') material.blending = AdditiveBlending
  else if (def.blending === 'subtractive') material.blending = SubtractiveBlending
  else if (def.blending === 'multiply') material.blending = MultiplyBlending
  else if (def.blending === 'none') material.blending = NoBlending
  else if (def.blending === 'normal') material.blending = NormalBlending
  if (typeof def.alphaTest === 'number' && Number.isFinite(def.alphaTest)) material.alphaTest = def.alphaTest
  if (typeof def.wireframe === 'boolean') material.wireframe = def.wireframe
  material.needsUpdate = true

  return { material, paramValues, uniforms, warnings }
}

const compiledShaders = new Map<string, CompiledShaderAsset>()
const compiledPostEffects = new Map<string, CompiledShaderAsset>()
let postEffectRevision = 0

export function getPostEffectRevision(): number {
  return postEffectRevision
}

export function getCompiledPostEffect(effectId: string): CompiledShaderAsset | undefined {
  return compiledPostEffects.get(effectId)
}

export function buildPostEffectNode(
  effectId: string,
  ctx: {
    color: unknown
    depth: unknown
    normal: unknown
    uv: unknown
  },
  overrides?: Record<string, unknown>,
): unknown {
  const compiled = compiledPostEffects.get(effectId)
  if (!compiled?.postEffectDefinition) return ctx.color
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      updateCompiledShaderParam(compiled, k, v)
    }
  }
  const runtimeParams: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(compiled.uniforms)) {
    runtimeParams[k] = v.node
  }
  for (const [k, v] of Object.entries(compiled.paramValues)) {
    if (!(k in runtimeParams)) runtimeParams[k] = v
  }
  const res = compiled.postEffectDefinition.apply({
    color: ctx.color,
    depth: ctx.depth,
    normal: ctx.normal,
    uv: ctx.uv,
    time: tsl.time,
    deltaTime: tsl.deltaTime,
    params: runtimeParams,
  })
  return res !== undefined ? asNode(res) : ctx.color
}

export function updateCompiledShaderParam(
  compiled: CompiledShaderAsset,
  paramName: string,
  value: unknown,
): boolean {
  const entry = compiled.uniforms[paramName]
  if (!entry) return false
  entry.node.value = coerceUniformValue(entry.schema, value)
  compiled.paramValues[paramName] = value
  return true
}

export function setCompiledShaderParam(shaderId: string, paramName: string, value: unknown): boolean {
  const compiled = compiledShaders.get(shaderId)
  if (!compiled) return false
  return updateCompiledShaderParam(compiled, paramName, value)
}

export function getCompiledShaderParam(shaderId: string, paramName: string): unknown {
  return compiledShaders.get(shaderId)?.paramValues[paramName]
}

export function compileShaderSource(
  id: string,
  fileName: string,
  source: string,
  overrides?: Record<string, unknown>,
): CompileResult<CompiledShaderAsset> {
  const transpiled = checkAndTranspileTs(fileName, source)
  if (!transpiled.ok || !transpiled.jsCode) {
    return { ok: false, diagnostics: transpiled.diagnostics }
  }
  const sdk = createShaderSdk()
  const evaluated = evaluateTranspiledModule<ShaderDefinition | PostEffectDefinition>(fileName, transpiled.jsCode, {
    't3d/shader': sdk,
  })
  if (!evaluated.ok || !evaluated.exports) {
    return {
      ok: false,
      diagnostics: evaluated.diagnostics.length
        ? evaluated.diagnostics
        : [
            {
              file: fileName,
              line: 1,
              column: 1,
              severity: 'error',
              message: '着色器必须通过 export default defineShader({ ... }) 或 definePostEffect({ ... }) 导出',
              hint: '请检查默认导出是否包含 name、params 和 surface/apply 函数',
            },
          ],
    }
  }

  const rawExports = evaluated.exports as unknown as Record<string, unknown>
  if (rawExports.__t3dPostEffect && typeof rawExports.apply === 'function') {
    const postDef = evaluated.exports as PostEffectDefinition
    try {
      const paramValues: Record<string, unknown> = {}
      const uniforms: Record<string, ShaderUniformEntry> = {}
      for (const [key, schema] of Object.entries(postDef.params ?? {})) {
        const val = overrides && key in overrides ? overrides[key] : defaultForSchema(schema)
        paramValues[key] = val
        const built = paramToNode(schema, val)
        if (built.uniformEntry) uniforms[key] = built.uniformEntry
      }
      const compatDef: ShaderDefinition = {
        name: postDef.name,
        description: postDef.description,
        mode: 'unlit',
        params: postDef.params ?? {},
        surface: () => ({ baseColor: tsl.vec3(1, 1, 1) }),
      }
      const compiled: CompiledShaderAsset = {
        id,
        file: fileName,
        kind: 'postEffect',
        definition: compatDef,
        postEffectDefinition: postDef,
        material: new MeshBasicNodeMaterial(),
        paramValues,
        uniforms,
      }
      compiledPostEffects.set(id, compiled)
      compiledShaders.set(id, compiled)
      postEffectRevision += 1
      return {
        ok: true,
        diagnostics: transpiled.diagnostics,
        jsCode: transpiled.jsCode,
        exports: compiled,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        diagnostics: [
          {
            file: fileName,
            line: 1,
            column: 1,
            severity: 'error',
            message: `TSL 后期特效构建失败：${msg}`,
            hint: '请检查 apply() 参数与返回节点',
          },
        ],
      }
    }
  }

  if (typeof rawExports.surface !== 'function') {
    return {
      ok: false,
      diagnostics: [
        {
          file: fileName,
          line: 1,
          column: 1,
          severity: 'error',
          message: '着色器必须通过 export default defineShader({ ... }) 或 definePostEffect({ ... }) 导出',
          hint: '请检查默认导出是否包含 name、params 和 surface/apply 函数',
        },
      ],
    }
  }

  const shaderDef = evaluated.exports as ShaderDefinition
  try {
    const { material, paramValues, uniforms } = buildMaterialFromShader(shaderDef, overrides, { strict: true })
    const compiled: CompiledShaderAsset = {
      id,
      file: fileName,
      kind: 'shader',
      definition: shaderDef,
      material,
      paramValues,
      uniforms,
    }
    compiledShaders.set(id, compiled)
    return {
      ok: true,
      diagnostics: transpiled.diagnostics,
      jsCode: transpiled.jsCode,
      exports: compiled,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      diagnostics: [
        {
          file: fileName,
          line: 1,
          column: 1,
          severity: 'error',
          message: `TSL 着色器构建失败：${msg}`,
          hint: '请检查 surface() 返回的节点类型及运算参数',
        },
      ],
    }
  }
}

export const BUILTIN_SHADER_PRESETS: Record<string, { name: string; mode: 'lit' | 'unlit'; description: string }> = {
  lit: { name: '标准 PBR', mode: 'lit', description: '基础 PBR 物理材质预设' },
  'unity-standard': { name: 'Unity Standard 兼容', mode: 'lit', description: '金属度/光滑度兼容表面着色器' },
  'unlit-color': { name: '纯色无光照', mode: 'unlit', description: '不受光照影响的纯色表面' },
  'unlit-texture': { name: '贴图无光照', mode: 'unlit', description: '不受光照影响的贴图表面' },
  'particle-unlit': { name: '粒子无光照', mode: 'unlit', description: '半透明粒子专用的无光照表面' },
}
