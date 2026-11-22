import { Color, DataTexture, RGBAFormat, type Texture } from 'three'
import * as tsl from 'three/tsl'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
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

export interface ShaderDefinition<P extends ShaderParamMap = ShaderParamMap> {
  name: string
  mode?: 'lit' | 'unlit'
  transparent?: boolean
  doubleSided?: boolean
  params: P
  surface: (params: Record<string, unknown>) => {
    baseColor?: unknown
    normal?: unknown
    roughness?: unknown
    metalness?: unknown
    emissive?: unknown
    opacity?: unknown
    vertexOffset?: unknown
  }
}

export interface CompiledShaderAsset {
  id: string
  file: string
  definition: ShaderDefinition
  material: MeshStandardNodeMaterial | MeshBasicNodeMaterial
  paramValues: Record<string, unknown>
}

function asNode(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return tsl.float(value)
  if (typeof value === 'boolean') return tsl.float(value ? 1 : 0)
  if (typeof value === 'string') return tsl.color(new Color(value))
  return value
}

function paramToNode(schema: FieldSchema, raw: unknown): unknown {
  const value = raw !== undefined ? raw : defaultForSchema(schema)
  if (schema.type === 'number') return tsl.float(Number(value) || 0)
  if (schema.type === 'boolean') return tsl.float(value ? 1 : 0)
  if (schema.type === 'color') return tsl.color(new Color(typeof value === 'string' ? value : '#ffffff'))
  if (schema.type === 'vec2') {
    const arr = Array.isArray(value) ? value : [0, 0]
    return tsl.vec2(Number(arr[0]) || 0, Number(arr[1]) || 0)
  }
  if (schema.type === 'vec3') {
    const arr = Array.isArray(value) ? value : [0, 0, 0]
    return tsl.vec3(Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0)
  }
  if (schema.type === 'vec4') {
    const arr = Array.isArray(value) ? value : [0, 0, 0, 1]
    return tsl.vec4(Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0, Number(arr[3]) ?? 1)
  }
  if (schema.type === 'texture' || (schema.type === 'ref' && schema.target === 'asset')) {
    return tsl.texture(resolveTextureAsset(value))
  }
  return value
}

export function createShaderSdk() {
  return {
    defineShader: <P extends ShaderParamMap>(def: ShaderDefinition<P>) => def,
    float: (x = 0) => tsl.float(x),
    vec2: (x = 0, y = 0) => tsl.vec2(x, y),
    vec3: (x = 0, y = 0, z = 0) => tsl.vec3(x, y, z),
    vec4: (x = 0, y = 0, z = 0, w = 1) => tsl.vec4(x, y, z, w),
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
    abs: (x: unknown) => (tsl.abs as (v: unknown) => unknown)(asNode(x)),
    sign: (x: unknown) => (tsl.sign as (v: unknown) => unknown)(asNode(x)),
    floor: (x: unknown) => (tsl.floor as (v: unknown) => unknown)(asNode(x)),
    ceil: (x: unknown) => (tsl.ceil as (v: unknown) => unknown)(asNode(x)),
    fract: (x: unknown) => (tsl.fract as (v: unknown) => unknown)(asNode(x)),
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
    fwidth: (x: unknown) => (tsl.fwidth as (v: unknown) => unknown)(asNode(x)),
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
    positionWorld: tsl.positionWorld,
    positionLocal: tsl.positionLocal,
    viewDirection: tsl.positionViewDirection,
    cameraPosition: tsl.cameraPosition,
    screenUV: tsl.screenUV,
    vertexColor: () => tsl.vertexColor(),
    texture: (texRef: unknown, uvNode?: unknown) => {
      const tex = resolveTextureAsset(texRef)
      return uvNode !== undefined
        ? tsl.texture(tex, asNode(uvNode) as never)
        : tsl.texture(tex)
    },
  }
}

const VALID_SURFACE_KEYS = new Set([
  'baseColor',
  'normal',
  'roughness',
  'metalness',
  'emissive',
  'opacity',
  'vertexOffset',
])

export function buildMaterialFromShader(
  def: ShaderDefinition,
  overrides?: Record<string, unknown>,
  options?: { strict?: boolean },
): { material: MeshStandardNodeMaterial | MeshBasicNodeMaterial; paramValues: Record<string, unknown>; warnings: string[] } {
  const paramValues: Record<string, unknown> = {}
  const runtimeParams: Record<string, unknown> = {}
  const accessedParams = new Set<string>()
  const declaredKeys = Object.keys(def.params ?? {})
  for (const [key, schema] of Object.entries(def.params ?? {})) {
    const val = overrides && key in overrides ? overrides[key] : defaultForSchema(schema)
    paramValues[key] = val
    runtimeParams[key] = paramToNode(schema, val)
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
      positionLocal: tsl.positionLocal,
      positionWorld: tsl.positionWorld,
      normalLocal: tsl.normalLocal,
      normalView: tsl.normalView,
      normalWorld: tsl.normalWorld,
      viewDirection: tsl.positionViewDirection,
      cameraPosition: tsl.cameraPosition,
      screenUV: tsl.screenUV,
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
    if (options?.strict) {
      throw new Error(msg)
    }
    warnings.push(msg)
  }

  if (out.opacity !== undefined && !def.transparent) {
    warnings.push('surface() 返回了 opacity，建议设置 transparent: true 才会生效')
  }

  const isUnlit = def.mode === 'unlit'
  const material = isUnlit ? new MeshBasicNodeMaterial() : new MeshStandardNodeMaterial()

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

  if (!isUnlit && material instanceof MeshStandardNodeMaterial) {
    if (out.roughness !== undefined) (material as unknown as { roughnessNode?: unknown }).roughnessNode = asNode(out.roughness)
    if (out.metalness !== undefined) (material as unknown as { metalnessNode?: unknown }).metalnessNode = asNode(out.metalness)
    if (out.emissive !== undefined) (material as unknown as { emissiveNode?: unknown }).emissiveNode = asNode(out.emissive)
    if (out.normal !== undefined) (material as unknown as { normalNode?: unknown }).normalNode = asNode(out.normal)
  }

  if (def.transparent) material.transparent = true
  if (def.doubleSided) material.side = 2 // DoubleSide
  material.needsUpdate = true

  return { material, paramValues, warnings }
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
  const evaluated = evaluateTranspiledModule<ShaderDefinition>(fileName, transpiled.jsCode, {
    't3d/shader': sdk,
  })
  if (!evaluated.ok || !evaluated.exports || typeof evaluated.exports.surface !== 'function') {
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
              message: '着色器必须通过 export default defineShader({ ... }) 导出',
              hint: '请检查默认导出是否包含 name、params 和 surface 函数',
            },
          ],
    }
  }

  try {
    const { material, paramValues } = buildMaterialFromShader(evaluated.exports, overrides, { strict: true })
    return {
      ok: true,
      diagnostics: transpiled.diagnostics,
      jsCode: transpiled.jsCode,
      exports: {
        id,
        file: fileName,
        definition: evaluated.exports,
        material,
        paramValues,
      },
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
