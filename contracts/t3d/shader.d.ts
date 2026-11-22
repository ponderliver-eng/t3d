/**
 * T3D 着色器资产接口契约（阶段 0 定稿）
 * 对应工程目录中的 `.t3d/shader.d.ts`，供 AI、应用内检查器与外部编辑器使用。
 */

export type ShaderParamSchema =
  | { type: 'number'; default: number; min?: number; max?: number; step?: number; label: string; unit?: string }
  | { type: 'boolean'; default: boolean; label: string }
  | { type: 'string'; default: string; label: string }
  | { type: 'color'; default: string; label: string }
  | { type: 'vec2'; default: readonly [number, number]; label: string }
  | { type: 'vec3'; default: readonly [number, number, number]; label: string }
  | { type: 'vec4'; default: readonly [number, number, number, number]; label: string }
  | { type: 'enum'; options: ReadonlyArray<{ value: string; label: string }>; default: string; label: string }
  | { type: 'texture'; default?: string; label: string }

export type ShaderParamMap = Record<string, ShaderParamSchema>

export type ShaderScalar = number | ShaderFloatNode

export interface ShaderNode {
  add(other: ShaderScalar | ShaderNode): this
  sub(other: ShaderScalar | ShaderNode): this
  mul(other: ShaderScalar | ShaderNode): this
  div(other: ShaderScalar | ShaderNode): this
  mod(other: ShaderScalar | ShaderNode): this
  pow(other: ShaderScalar | ShaderNode): this
  min(other: ShaderScalar | ShaderNode): this
  max(other: ShaderScalar | ShaderNode): this
  clamp(minVal?: ShaderScalar, maxVal?: ShaderScalar): this
  abs(): this
  floor(): this
  ceil(): this
  fract(): this
  saturate(): this
  oneMinus(): this
  negate(): this
}

export interface ShaderFloatNode extends ShaderNode {
  readonly __kind?: 'float'
}

export interface ShaderVec2Node extends ShaderNode {
  readonly x: ShaderFloatNode
  readonly y: ShaderFloatNode
  length(): ShaderFloatNode
  normalize(): ShaderVec2Node
  dot(other: ShaderVec2Node): ShaderFloatNode
}

export interface ShaderVec3Node extends ShaderNode {
  readonly x: ShaderFloatNode
  readonly y: ShaderFloatNode
  readonly z: ShaderFloatNode
  readonly r: ShaderFloatNode
  readonly g: ShaderFloatNode
  readonly b: ShaderFloatNode
  readonly xy: ShaderVec2Node
  length(): ShaderFloatNode
  normalize(): ShaderVec3Node
  dot(other: ShaderVec3Node): ShaderFloatNode
  cross(other: ShaderVec3Node): ShaderVec3Node
}

export interface ShaderVec4Node extends ShaderNode {
  readonly x: ShaderFloatNode
  readonly y: ShaderFloatNode
  readonly z: ShaderFloatNode
  readonly w: ShaderFloatNode
  readonly r: ShaderFloatNode
  readonly g: ShaderFloatNode
  readonly b: ShaderFloatNode
  readonly a: ShaderFloatNode
  readonly xy: ShaderVec2Node
  readonly xyz: ShaderVec3Node
  readonly rgb: ShaderVec3Node
  length(): ShaderFloatNode
  normalize(): ShaderVec4Node
}

export interface ShaderTextureRef {
  readonly __kind?: 'texture'
}

export type ShaderParamRuntimeValue<S extends ShaderParamSchema> =
  S['type'] extends 'number' ? ShaderFloatNode :
  S['type'] extends 'boolean' ? ShaderFloatNode :
  S['type'] extends 'color' ? ShaderVec3Node :
  S['type'] extends 'vec2' ? ShaderVec2Node :
  S['type'] extends 'vec3' ? ShaderVec3Node :
  S['type'] extends 'vec4' ? ShaderVec4Node :
  S['type'] extends 'texture' ? ShaderTextureRef :
  string

export type ShaderParamValues<P extends ShaderParamMap> = {
  readonly [K in keyof P]: ShaderParamRuntimeValue<P[K]>
}

export interface SurfaceContext<P extends ShaderParamMap> {
  readonly params: ShaderParamValues<P>
  readonly uv: ShaderVec2Node
  readonly time: ShaderFloatNode
  readonly deltaTime: ShaderFloatNode
  readonly positionLocal: ShaderVec3Node
  readonly positionWorld: ShaderVec3Node
  readonly normalLocal: ShaderVec3Node
  readonly normalWorld: ShaderVec3Node
  readonly viewDirection: ShaderVec3Node
  readonly vertexColor: ShaderVec4Node
  readonly cameraPosition: ShaderVec3Node
  readonly screenUV: ShaderVec2Node
}

export interface SurfaceOutput {
  baseColor?: ShaderVec3Node | string
  normal?: ShaderVec3Node
  roughness?: ShaderFloatNode | number
  metalness?: ShaderFloatNode | number
  emissive?: ShaderVec3Node | string
  opacity?: ShaderFloatNode | number
  alphaTest?: number
  vertexOffset?: ShaderVec3Node
}

export interface ShaderDefinition<P extends ShaderParamMap> {
  name: string
  description?: string
  /** 'lit' 走标准 PBR 受光；'unlit' 不受光照，直接输出颜色与透明度 */
  mode?: 'lit' | 'unlit'
  transparent?: boolean
  doubleSided?: boolean
  params?: P
  surface(ctx: SurfaceContext<P>): SurfaceOutput
}

export interface CompiledShaderAsset<P extends ShaderParamMap = ShaderParamMap> {
  readonly __t3dKind: 'shader'
  readonly definition: ShaderDefinition<P>
}

export function defineShader<P extends ShaderParamMap = Record<string, never>>(
  definition: ShaderDefinition<P>,
): CompiledShaderAsset<P>

// --- 白名单 TSL 内置输入节点（从 't3d/shader' 导入） ---

export function uv(index?: number): ShaderVec2Node
export const time: ShaderFloatNode
export const deltaTime: ShaderFloatNode
export const positionLocal: ShaderVec3Node
export const positionWorld: ShaderVec3Node
export const normalLocal: ShaderVec3Node
export const normalView: ShaderVec3Node
export const normalWorld: ShaderVec3Node
export const viewDirection: ShaderVec3Node
export const cameraPosition: ShaderVec3Node
export const screenUV: ShaderVec2Node
export function vertexColor(): ShaderVec4Node

// --- 白名单 TSL 构造与函数 ---

export function float(value: number): ShaderFloatNode
export function vec2(x: ShaderScalar, y: ShaderScalar): ShaderVec2Node
export function vec3(x: ShaderScalar, y: ShaderScalar, z: ShaderScalar): ShaderVec3Node
export function vec4(x: ShaderScalar, y: ShaderScalar, z: ShaderScalar, w: ShaderScalar): ShaderVec4Node
export function color(hexOrR: string | number, g?: number, b?: number): ShaderVec3Node

export function sin<T extends ShaderNode>(x: T): T
export function cos<T extends ShaderNode>(x: T): T
export function tan<T extends ShaderNode>(x: T): T
export function abs<T extends ShaderNode>(x: T): T
export function sign<T extends ShaderNode>(x: T): T
export function floor<T extends ShaderNode>(x: T): T
export function ceil<T extends ShaderNode>(x: T): T
export function fract<T extends ShaderNode>(x: T): T
export function pow<T extends ShaderNode>(base: T, exp: ShaderScalar | T): T
export function sqrt<T extends ShaderNode>(x: T): T
export function exp<T extends ShaderNode>(x: T): T
export function log<T extends ShaderNode>(x: T): T
export function saturate<T extends ShaderNode>(x: T): T

export function min<T extends ShaderNode>(a: T, b: ShaderScalar | T): T
export function max<T extends ShaderNode>(a: T, b: ShaderScalar | T): T
export function clamp<T extends ShaderNode>(x: T, minVal: ShaderScalar | T, maxVal: ShaderScalar | T): T
export function mix<T extends ShaderNode>(a: T, b: T, t: ShaderScalar | ShaderFloatNode): T
export function step<T extends ShaderNode>(edge: ShaderScalar | T, x: T): T
export function smoothstep<T extends ShaderNode>(edge0: ShaderScalar | T, edge1: ShaderScalar | T, x: T): T

export function dot(a: ShaderVec2Node, b: ShaderVec2Node): ShaderFloatNode
export function dot(a: ShaderVec3Node, b: ShaderVec3Node): ShaderFloatNode
export function cross(a: ShaderVec3Node, b: ShaderVec3Node): ShaderVec3Node
export function normalize<T extends ShaderVec2Node | ShaderVec3Node | ShaderVec4Node>(v: T): T
export function length(v: ShaderVec2Node | ShaderVec3Node | ShaderVec4Node): ShaderFloatNode
export function distance(a: ShaderVec3Node, b: ShaderVec3Node): ShaderFloatNode
export function reflect(incident: ShaderVec3Node, normal: ShaderVec3Node): ShaderVec3Node
export function fwidth<T extends ShaderNode>(x: T): T

export function texture(tex: ShaderTextureRef, uv: ShaderVec2Node): ShaderVec4Node
export function fresnel(normalWorld: ShaderVec3Node, viewDir: ShaderVec3Node, power?: ShaderScalar): ShaderFloatNode
