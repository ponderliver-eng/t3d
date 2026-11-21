import { Color } from 'three'
import * as tsl from 'three/tsl'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { defaultForSchema } from '../schema/fieldSchema'
import type { FieldSchema } from '../schema/fieldSchema'
import { checkAndTranspileTs, evaluateTranspiledModule, type CompileResult } from './compiler'

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
    sin: (x: unknown) => (tsl.sin as (v: unknown) => unknown)(asNode(x)),
    cos: (x: unknown) => (tsl.cos as (v: unknown) => unknown)(asNode(x)),
    abs: (x: unknown) => (tsl.abs as (v: unknown) => unknown)(asNode(x)),
    floor: (x: unknown) => (tsl.floor as (v: unknown) => unknown)(asNode(x)),
    ceil: (x: unknown) => (tsl.ceil as (v: unknown) => unknown)(asNode(x)),
    fract: (x: unknown) => (tsl.fract as (v: unknown) => unknown)(asNode(x)),
    pow: (x: unknown, y: unknown) => (tsl.pow as (...args: unknown[]) => unknown)(asNode(x), asNode(y)),
    sqrt: (x: unknown) => (tsl.sqrt as (v: unknown) => unknown)(asNode(x)),
    min: (a: unknown, b: unknown) => (tsl.min as (...args: unknown[]) => unknown)(asNode(a), asNode(b)),
    max: (a: unknown, b: unknown) => (tsl.max as (...args: unknown[]) => unknown)(asNode(a), asNode(b)),
    dot: (a: unknown, b: unknown) => (tsl.dot as (...args: unknown[]) => unknown)(asNode(a), asNode(b)),
    cross: (a: unknown, b: unknown) => (tsl.cross as (...args: unknown[]) => unknown)(asNode(a), asNode(b)),
    normalize: (v: unknown) => (tsl.normalize as (x: unknown) => unknown)(asNode(v)),
    length: (v: unknown) => (tsl.length as (x: unknown) => unknown)(asNode(v)),
    uv: (index = 0) => tsl.uv(index),
    time: tsl.time,
    normalView: tsl.normalView,
    normalWorld: tsl.normalWorld,
    positionWorld: tsl.positionWorld,
    positionLocal: tsl.positionLocal,
    viewDirection: tsl.positionViewDirection,
    texture: () => tsl.vec4(1, 1, 1, 1),
  }
}

export function buildMaterialFromShader(
  def: ShaderDefinition,
  overrides?: Record<string, unknown>,
): { material: MeshStandardNodeMaterial | MeshBasicNodeMaterial; paramValues: Record<string, unknown> } {
  const paramValues: Record<string, unknown> = {}
  const runtimeParams: Record<string, unknown> = {}
  for (const [key, schema] of Object.entries(def.params ?? {})) {
    const val = overrides && key in overrides ? overrides[key] : defaultForSchema(schema)
    paramValues[key] = val
    runtimeParams[key] = paramToNode(schema, val)
  }

  const out = def.surface(runtimeParams)
  const isUnlit = def.mode === 'unlit'
  const material = isUnlit ? new MeshBasicNodeMaterial() : new MeshStandardNodeMaterial()

  if (out.baseColor !== undefined) {
    ;(material as unknown as { colorNode?: unknown }).colorNode = asNode(out.baseColor)
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

  return { material, paramValues }
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
    const { material, paramValues } = buildMaterialFromShader(evaluated.exports, overrides)
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
