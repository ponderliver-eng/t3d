export type UfbxNode = {
  name: string
  parent: number
  t: [number, number, number]
  r: [number, number, number, number]
  s: [number, number, number]
  mesh: number
  skin: number
  isRoot: boolean
  isBone: boolean
  helper: boolean
}

export type UfbxPrimitive = {
  material: number
  vertexCount: number
  indexCount: number
  pos: number
  nrm: number
  uv: number
  col: number
  joints: number
  weights: number
  indices: number
  uv1?: number
  uv2?: number
  uv3?: number
  min: [number, number, number]
  max: [number, number, number]
}

export type UfbxMesh = {
  name: string
  primitives: UfbxPrimitive[]
}

export type UfbxSkin = {
  name: string
  joints: number[]
  ibm: number
}

export type UfbxMaterial = {
  name: string
  baseColor: [number, number, number, number]
  baseTex: number
  metallic: number
  roughness: number
  metallicTex: number
  roughnessTex: number
  normalTex: number
  occlusionTex: number
  emissive: [number, number, number]
  emissiveTex: number
  opacity: number
  opacityTex: number
  doubleSided: boolean
  unlit: boolean
  shader: string
}

export type UfbxTexture = {
  name: string
  filename: string
  relative: string
  absolute: string
  content: number
  size: number
}

export type UfbxTrack = {
  node: number
  path: 'translation' | 'rotation' | 'scale'
  count: number
  times: number
  values: number
  constant: boolean
}

export type UfbxAnimation = {
  name: string
  duration: number
  tracks: UfbxTrack[]
}

export type UfbxScene = {
  meta: {
    unitMeters: number
    exporter: number
    creator: string
    version: number
  }
  nodes: UfbxNode[]
  meshes: UfbxMesh[]
  skins: UfbxSkin[]
  materials: UfbxMaterial[]
  textures: UfbxTexture[]
  animations: UfbxAnimation[]
  arena: Uint8Array
}

type UfbxWasmModule = {
  _malloc(n: number): number
  _free(p: number): void
  _fbx_open(ptr: number, size: number): number
  _fbx_error(): number
  _fbx_json(h: number): number
  _fbx_arena(h: number): number
  _fbx_arena_size(h: number): number
  _fbx_close(h: number): void
  HEAPU8: Uint8Array
  UTF8ToString(ptr: number): string
}

let modulePromise: Promise<UfbxWasmModule> | null = null

async function getUfbxModule(): Promise<UfbxWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      // @ts-expect-error generated Emscripten single-file module
      const mod = await import('./fbxReader.js')
      const factory = (mod.default ?? mod) as () => Promise<UfbxWasmModule>
      return factory()
    })().catch(err => {
      modulePromise = null
      throw err
    })
  }
  return modulePromise
}

export async function readFbxWithUfbx(bytes: Uint8Array): Promise<UfbxScene> {
  const m = await getUfbxModule()
  const ptr = m._malloc(bytes.byteLength)
  m.HEAPU8.set(bytes, ptr)
  const handle = m._fbx_open(ptr, bytes.byteLength)
  m._free(ptr)
  if (handle === 0) {
    throw new Error(`ufbx: ${m.UTF8ToString(m._fbx_error()) || 'unknown FBX parse error'}`)
  }
  try {
    const json = m.UTF8ToString(m._fbx_json(handle))
    const arenaPtr = m._fbx_arena(handle)
    const arenaSize = m._fbx_arena_size(handle)
    const arena = new Uint8Array(arenaSize)
    arena.set(m.HEAPU8.subarray(arenaPtr, arenaPtr + arenaSize))
    const scene = JSON.parse(json) as Omit<UfbxScene, 'arena'>
    return { ...scene, arena }
  } finally {
    m._fbx_close(handle)
  }
}

export const ufbxF32 = (scene: UfbxScene, offset: number, count: number): Float32Array =>
  new Float32Array(scene.arena.buffer, scene.arena.byteOffset + offset, count)

export const ufbxU16 = (scene: UfbxScene, offset: number, count: number): Uint16Array =>
  new Uint16Array(scene.arena.buffer, scene.arena.byteOffset + offset, count)

export const ufbxU32 = (scene: UfbxScene, offset: number, count: number): Uint32Array =>
  new Uint32Array(scene.arena.buffer, scene.arena.byteOffset + offset, count)

export const ufbxBytes = (scene: UfbxScene, offset: number, size: number): Uint8Array =>
  scene.arena.subarray(offset, offset + size)
