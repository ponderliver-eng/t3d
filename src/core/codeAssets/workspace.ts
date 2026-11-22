import { create } from 'zustand'
import { projectDirectoryPath, useProjectDirectory } from '../../editor/project/disk'
import { electronBridge, joinProjectPath } from '../../editor/project/electronBridge'
import { useEditorStore } from '../../editor/scene/store'
import type { CodeDiagnostic } from './compiler'
import { compileAndRegisterScript, type CompiledScriptAsset } from './scriptRuntime'
import { compileShaderSource, type CompiledShaderAsset } from './shaderRuntime'

export type CodeAssetKind = 'shader' | 'script'

export interface CodeAssetRecord {
  id: string
  kind: CodeAssetKind
  name: string
  relativePath: string
  source: string
  diagnostics: CodeDiagnostic[]
  ok: boolean
  updatedAt: number
  compiledShader?: CompiledShaderAsset
  compiledScript?: CompiledScriptAsset
}

interface CodeAssetState {
  assets: Record<string, CodeAssetRecord>
  selectedId: string | null
  revision: number
  selectAsset: (id: string | null) => void
  upsertAsset: (record: CodeAssetRecord) => void
  removeAsset: (id: string) => void
  clear: () => void
}

export const useCodeAssetStore = create<CodeAssetState>((set) => ({
  assets: {},
  selectedId: null,
  revision: 0,
  selectAsset: (id) => set({ selectedId: id }),
  upsertAsset: (record) =>
    set((state) => ({ assets: { ...state.assets, [record.id]: record }, revision: state.revision + 1 })),
  removeAsset: (id) =>
    set((state) => {
      const next = { ...state.assets }
      delete next[id]
      return {
        assets: next,
        selectedId: state.selectedId === id ? null : state.selectedId,
        revision: state.revision + 1,
      }
    }),
  clear: () => set((state) => ({ assets: {}, selectedId: null, revision: state.revision + 1 })),
}))

const PROJECT_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "t3d/runtime": [".t3d/runtime.d.ts"],
      "t3d/shader": [".t3d/shader.d.ts"]
    }
  },
  "include": ["scripts/**/*.ts", "shaders/**/*.ts", ".t3d/**/*.d.ts"]
}
`

const RUNTIME_DTS_SUMMARY = `export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Vec4 { x: number; y: number; z: number; w: number }
export type ScriptParamSchema =
  | { type: 'number'; default: number; min?: number; max?: number; step?: number; label: string; description?: string }
  | { type: 'boolean'; default: boolean; label: string; description?: string }
  | { type: 'string'; default: string; label: string; description?: string }
  | { type: 'color'; default: string; label: string; description?: string }
  | { type: 'vec2'; default: readonly [number, number]; label: string; description?: string }
  | { type: 'vec3'; default: readonly [number, number, number]; label: string; description?: string }
  | { type: 'enum'; options: ReadonlyArray<{ value: string; label: string }>; default: string; label: string; description?: string }
  | { type: 'texture'; default?: string | null; label: string; description?: string }
  | { type: 'ref'; target: 'node' | 'asset' | 'clip' | 'tableRow'; kinds?: readonly string[]; tableId?: string; default?: string | null; label: string; description?: string }
  | Record<string, unknown>
export type ScriptParamMap = Record<string, ScriptParamSchema>
export interface NodeHandle {
  readonly id: string; readonly name: string; readonly tags: readonly string[]; readonly parent: NodeHandle | null
  position: Vec3; rotation: Vec3; scale: Vec3; visible: boolean
  hasTag(tag: string): boolean
  addTag(tag: string): void
  removeTag(tag: string): void
  getChildren(): readonly NodeHandle[]
  sendMessage(name: string, payload?: unknown): void
  destroy(): void
}
export interface ScriptContext<P = Record<string, unknown>, S = Record<string, unknown>> {
  readonly node: NodeHandle; readonly params: P; readonly state: S; readonly elapsedTime: number
  position: Vec3; rotation: Vec3; scale: Vec3; visible: boolean
  readonly forward: Vec3; readonly right: Vec3
  distanceTo(target: Vec3 | NodeHandle): number
  hasTag(tag: string): boolean
  addTag(tag: string): void
  removeTag(tag: string): void
  directionTo(target: Vec3 | NodeHandle, options?: { planeXZ?: boolean }): Vec3
  translate(delta: Vec3, space?: 'local' | 'world'): void
  rotateY(radians: number): void
  moveToward(target: Vec3 | NodeHandle, maxDistance: number, options?: { faceTarget?: boolean; planeXZ?: boolean }): boolean
  lookAt(target: Vec3 | NodeHandle, options?: { yOnly?: boolean }): void
  sendMessage(name: string, payload?: unknown): void
  broadcast(name: string, payload?: unknown): void
  findNodeById(id: string): NodeHandle | null
  findNodesByTag(tag: string): readonly NodeHandle[]
  findNodesInRadius(center: Vec3, radius: number, tag?: string): readonly NodeHandle[]
  cloneNode(templateOrName: string | NodeHandle, options?: { position?: Vec3; rotation?: Vec3; scale?: Vec3; parent?: NodeHandle | string | null; visible?: boolean; name?: string; initMessage?: string; initPayload?: unknown }): NodeHandle | null
  spawnPrefab(prefabId: string, options?: { position?: Vec3; rotation?: Vec3; name?: string }): NodeHandle | null
  destroyNode(node: NodeHandle): void
  readonly pool: {
    preload(templateOrPrefab: string | NodeHandle, count: number): void
    acquire(templateOrPrefab: string | NodeHandle, options?: { position?: Vec3; rotation?: Vec3; scale?: Vec3; payload?: unknown }): NodeHandle | null
    release(node: NodeHandle): void
    stats(templateOrPrefab?: string | NodeHandle): { active: number; pooled: number; total: number }
  }
  after(seconds: number, callback: () => void): number
  every(seconds: number, callback: () => void): number
  cancelTimer(timerId: number): void
  readonly spline: {
    create(pointsOrParent: string | NodeHandle | ReadonlyArray<Vec3 | NodeHandle>, options?: { closed?: boolean; tension?: number }): {
      readonly length: number; readonly closed: boolean; readonly points: readonly Vec3[]
      pointAt(t: number): Vec3; tangentAt(t: number): Vec3
      pointAtDistance(distance: number): Vec3; tangentAtDistance(distance: number): Vec3
    }
    follow(pointsOrParent: string | NodeHandle | ReadonlyArray<Vec3 | NodeHandle>, options?: {
      speed?: number; closed?: boolean; tension?: number; loop?: boolean; pingPong?: boolean
      faceDirection?: boolean; planeXZ?: boolean; startProgress?: number; onArrive?: () => void
    }): boolean
    stop(): void
    readonly isFollowing: boolean
    readonly progress: number
  }
  readonly tween: {
    to(target: NodeHandle | { position?: Vec3; rotation?: Vec3; scale?: Vec3 }, props: { position?: Vec3; rotation?: Vec3; scale?: Vec3 }, duration: number, options?: { ease?: string; delay?: number; repeat?: number; yoyo?: boolean; onUpdate?: (p: number) => void; onComplete?: () => void }): number
    value(from: number, to: number, duration: number, onUpdate: (val: number) => void, options?: { ease?: string; delay?: number; repeat?: number; yoyo?: boolean; onComplete?: () => void }): number
    punchScale(strength?: number, duration?: number): number
    shakePosition(intensity?: number, duration?: number): number
    cancel(tweenId: number): void
    cancelAll(): void
  }
  readonly curve: {
    create(keys: ReadonlyArray<readonly [number, number] | { t: number; v: number; mode?: 'linear' | 'smooth' | 'step' }>, options?: { wrap?: 'clamp' | 'loop' | 'pingPong' }): { eval(t: number): number }
    eval(keys: ReadonlyArray<readonly [number, number] | { t: number; v: number; mode?: 'linear' | 'smooth' | 'step' }>, t: number, options?: { wrap?: 'clamp' | 'loop' | 'pingPong' }): number
    ease(name: string, t: number): number
    parabola(t: number, height?: number): number
    pulse(t: number): number
  }
  readonly input: {
    isPressed(a: string): boolean
    justPressed(a: string): boolean
    isKeyPressed(code: string): boolean
    axis2D(a: string): Vec2
    pointerDelta(): Vec2
    pointerPosition(): Vec2
    wheelDelta(): number
    isMouseButtonPressed(button: 0 | 1 | 2): boolean
    justPressedMouseButton(button: 0 | 1 | 2): boolean
    justReleasedMouseButton(button: 0 | 1 | 2): boolean
  }
  readonly ui: {
    getVar(k: string): unknown
    setVar(k: string, v: unknown): void
    onEvent(eventName: string, handler: (payload?: unknown) => void): () => void
    showScreen(screenIdOrName: string): void
    hideScreen(screenIdOrName: string): void
    toggleScreen(screenIdOrName: string): void
    isScreenVisible(screenIdOrName: string): boolean
    worldToScreen(position: Vec3 | NodeHandle): { x: number; y: number; ndcX: number; ndcY: number; visible: boolean } | null
  }
  readonly audio: { playSfx(id: string, opts?: { volume?: number }): void; playBgm(id: string): void; stopBgm(): void }
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
}
export interface GizmosApi {
  readonly isSelected: boolean
  line(from: Vec3 | NodeHandle, to: Vec3 | NodeHandle, opts?: { color?: string }): void
  arrow(from: Vec3 | NodeHandle, dir: Vec3, length?: number, opts?: { color?: string }): void
  wireSphere(center: Vec3 | NodeHandle, radius: number, opts?: { color?: string }): void
  wireBox(center: Vec3 | NodeHandle, size: Vec3, opts?: { color?: string }): void
  disc(center: Vec3 | NodeHandle, radius: number, opts?: { normal?: Vec3; color?: string }): void
  radiusHandle(paramKey: string, opts?: { center?: Vec3 | NodeHandle; axis?: 'x' | 'y' | 'z'; color?: string }): void
  positionHandle(paramKey: string, opts?: { color?: string }): void
}
export function defineBehavior<P extends ScriptParamMap, S extends Record<string, unknown>>(def: {
  name: string; description?: string; params?: P; state?: () => S
  onStart?: (self: ScriptContext<Record<string, any>, S>) => void
  onSpawn?: (self: ScriptContext<Record<string, any>, S>, payload?: unknown) => void
  onUpdate?: (self: ScriptContext<Record<string, any>, S>, dt: number) => void
  onDestroy?: (self: ScriptContext<Record<string, any>, S>) => void
  onMessage?: (self: ScriptContext<Record<string, any>, S>, msg: { name: string; payload?: unknown }) => void
  onDrawGizmos?: (self: ScriptContext<Record<string, any>, S>, gizmos: GizmosApi) => void
}): unknown
export function defineSystem<S extends Record<string, unknown>>(def: {
  name: string; description?: string; stage?: 'prePhysics' | 'postPhysics' | 'postAnimation' | 'preRender'; order?: number
  state?: () => S; createState?: () => S
  onMount?: (world: Omit<ScriptContext<Record<string, any>, S>, 'node' | 'params' | 'state' | 'position' | 'rotation' | 'scale' | 'visible'>, state: S) => void
  onStep?: (world: Omit<ScriptContext<Record<string, any>, S>, 'node' | 'params' | 'state' | 'position' | 'rotation' | 'scale' | 'visible'>, state: S, dt: number) => void
  onUpdate?: (world: Omit<ScriptContext<Record<string, any>, S>, 'node' | 'params' | 'state' | 'position' | 'rotation' | 'scale' | 'visible'>, state: S, dt: number) => void
  onDispose?: (world: Omit<ScriptContext<Record<string, any>, S>, 'node' | 'params' | 'state' | 'position' | 'rotation' | 'scale' | 'visible'>, state: S) => void
}): unknown
`

const SHADER_DTS_SUMMARY = `export interface ShaderNode {
  add(other: unknown): ShaderNode; sub(other: unknown): ShaderNode; mul(other: unknown): ShaderNode; div(other: unknown): ShaderNode
  clamp(min?: unknown, max?: unknown): ShaderNode; abs(): ShaderNode; fract(): ShaderNode; floor(): ShaderNode
}
export function defineShader(def: {
  name: string; mode?: 'lit' | 'unlit'; transparent?: boolean; doubleSided?: boolean
  params: Record<string, unknown>
  surface: (params: Record<string, any>) => {
    baseColor?: unknown; normal?: unknown; roughness?: unknown; metalness?: unknown
    emissive?: unknown; opacity?: unknown; vertexOffset?: unknown
  }
}): unknown
export function float(x?: number): ShaderNode
export function vec2(x?: number, y?: number): ShaderNode
export function vec3(x?: number, y?: number, z?: number): ShaderNode
export function vec4(x?: number, y?: number, z?: number, w?: number): ShaderNode
export function color(hexOrR: string | number, g?: number, b?: number): ShaderNode
export function mix(a: unknown, b: unknown, t: unknown): ShaderNode
export function clamp(x: unknown, min: unknown, max: unknown): ShaderNode
export function smoothstep(edge0: unknown, edge1: unknown, x: unknown): ShaderNode
export function step(edge: unknown, x: unknown): ShaderNode
export function sin(x: unknown): ShaderNode
export function cos(x: unknown): ShaderNode
export function tan(x: unknown): ShaderNode
export function abs(x: unknown): ShaderNode
export function sign(x: unknown): ShaderNode
export function floor(x: unknown): ShaderNode
export function ceil(x: unknown): ShaderNode
export function fract(x: unknown): ShaderNode
export function pow(x: unknown, y: unknown): ShaderNode
export function sqrt(x: unknown): ShaderNode
export function exp(x: unknown): ShaderNode
export function log(x: unknown): ShaderNode
export function saturate(x: unknown): ShaderNode
export function min(a: unknown, b: unknown): ShaderNode
export function max(a: unknown, b: unknown): ShaderNode
export function dot(a: unknown, b: unknown): ShaderNode
export function cross(a: unknown, b: unknown): ShaderNode
export function normalize(v: unknown): ShaderNode
export function length(v: unknown): ShaderNode
export function distance(a: unknown, b: unknown): ShaderNode
export function reflect(incident: unknown, normal: unknown): ShaderNode
export function fwidth(x: unknown): ShaderNode
export function fresnel(normal: unknown, viewDir: unknown, power?: unknown): ShaderNode
export function texture(texRef: unknown, uv?: unknown): ShaderNode
export function uv(index?: number): ShaderNode
export const time: ShaderNode
export const deltaTime: ShaderNode
export const normalView: ShaderNode
export const normalWorld: ShaderNode
export const normalLocal: ShaderNode
export const positionWorld: ShaderNode
export const positionLocal: ShaderNode
export const viewDirection: ShaderNode
export const cameraPosition: ShaderNode
export const screenUV: ShaderNode
export function vertexColor(): ShaderNode
`

export async function ensureCodeWorkspaceFiles(projectRoot?: string | null): Promise<void> {
  const dir = projectRoot ?? projectDirectoryPath()
  if (!dir) return
  const bridge = electronBridge()
  if (!bridge?.fs?.mkdir || !bridge?.fs?.writeTextFile) return
  await bridge.fs.mkdir(joinProjectPath(dir, '.t3d'))
  await bridge.fs.mkdir(joinProjectPath(dir, 'scripts'))
  await bridge.fs.mkdir(joinProjectPath(dir, 'shaders'))
  await bridge.fs.writeTextFile(joinProjectPath(dir, '.t3d/runtime.d.ts'), RUNTIME_DTS_SUMMARY)
  await bridge.fs.writeTextFile(joinProjectPath(dir, '.t3d/shader.d.ts'), SHADER_DTS_SUMMARY)
  await bridge.fs.writeTextFile(joinProjectPath(dir, 'tsconfig.json'), PROJECT_TSCONFIG)
}

export function normalizeCodeAssetId(kind: CodeAssetKind, nameOrId: string): string {
  const clean = nameOrId
    .trim()
    .replace(/\.(shader\.ts|ts)$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
  return clean || `${kind}_${Date.now().toString(36)}`
}

export function codeAssetRelativePath(kind: CodeAssetKind, id: string): string {
  return kind === 'shader' ? `shaders/${id}.shader.ts` : `scripts/${id}.ts`
}

export function compileCodeAsset(
  kind: CodeAssetKind,
  id: string,
  relativePath: string,
  source: string,
): CodeAssetRecord {
  if (kind === 'shader') {
    const res = compileShaderSource(id, relativePath, source)
    const record: CodeAssetRecord = {
      id,
      kind,
      name: res.exports?.definition.name ?? id,
      relativePath,
      source,
      diagnostics: res.diagnostics,
      ok: res.ok,
      updatedAt: Date.now(),
      compiledShader: res.exports,
    }
    useCodeAssetStore.getState().upsertAsset(record)
    return record
  }

  const res = compileAndRegisterScript(id, relativePath, source)
  const record: CodeAssetRecord = {
    id,
    kind,
    name: res.exports?.behavior?.name ?? res.exports?.system?.name ?? id,
    relativePath,
    source,
    diagnostics: res.diagnostics,
    ok: res.ok,
    updatedAt: Date.now(),
    compiledScript: res.exports,
  }
  useCodeAssetStore.getState().upsertAsset(record)
  return record
}

export async function saveAndCompileCodeAsset(
  kind: CodeAssetKind,
  idOrName: string,
  source: string,
): Promise<CodeAssetRecord> {
  const id = normalizeCodeAssetId(kind, idOrName)
  const rel = codeAssetRelativePath(kind, id)
  const record = compileCodeAsset(kind, id, rel, source)

  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge?.fs) {
    await ensureCodeWorkspaceFiles(dir)
    await bridge.fs.writeTextFile(joinProjectPath(dir, rel), source)
  }

  if (!record.ok && record.diagnostics.length > 0) {
    const first = record.diagnostics[0]
    useEditorStore.getState().log('warn', `${rel}:${first.line} ${first.message}`)
  } else {
    useEditorStore.getState().log('info', `代码资产已编译并热重载：${rel}`)
  }
  return record
}

export async function scanProjectCodeAssets(projectRoot?: string | null): Promise<number> {
  const dir = projectRoot ?? projectDirectoryPath()
  const bridge = electronBridge()
  if (!dir || !bridge?.fs?.list || !bridge?.fs?.readTextFile) return 0

  let loaded = 0
  for (const [kind, subDir] of [
    ['shader', 'shaders'],
    ['script', 'scripts'],
  ] as const) {
    const entries = await bridge.fs.list(joinProjectPath(dir, subDir)).catch(() => [])
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.ts')) continue
      const rel = `${subDir}/${entry.name}`
      const source = await bridge.fs.readTextFile(joinProjectPath(dir, rel)).catch(() => null)
      if (source === null) continue
      const id = normalizeCodeAssetId(kind, entry.name)
      compileCodeAsset(kind, id, rel, source)
      loaded += 1
    }
  }
  return loaded
}

export async function reloadCodeAssetFromDisk(relativePath: string): Promise<CodeAssetRecord | null> {
  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (!dir || !bridge?.fs?.readTextFile) return null
  const cleanRel = relativePath.replace(/\\/g, '/')
  const kind: CodeAssetKind | null = cleanRel.startsWith('shaders/')
    ? 'shader'
    : cleanRel.startsWith('scripts/')
      ? 'script'
      : null
  if (!kind || !cleanRel.endsWith('.ts')) return null

  const source = await bridge.fs.readTextFile(joinProjectPath(dir, cleanRel)).catch(() => null)
  if (source === null) return null
  const fileName = cleanRel.split('/').pop() ?? cleanRel
  const id = normalizeCodeAssetId(kind, fileName)
  return compileCodeAsset(kind, id, cleanRel, source)
}

export function defaultTemplateFor(kind: CodeAssetKind, name: string): string {
  if (kind === 'shader') {
    return `import { defineShader, color, mix, sin, time, uv } from 't3d/shader'

export default defineShader({
  name: '${name}',
  mode: 'lit',
  params: {
    baseColor: { type: 'color', default: '#4a9eff', label: '主颜色' },
    glowColor: { type: 'color', default: '#93c5fd', label: '脉冲颜色' },
    speed: { type: 'number', default: 2, min: 0, max: 20, label: '脉冲速度' },
  },
  surface(p) {
    const wave = sin(uv().y.mul(8).add(time.mul(p.speed))).mul(0.5).add(0.5)
    return {
      baseColor: mix(p.baseColor, p.glowColor, wave),
      roughness: 0.35,
      metalness: 0.1,
    }
  },
})
`
  }
  return `import { defineBehavior } from 't3d/runtime'

export default defineBehavior({
  name: '${name}',
  params: {
    speed: { type: 'number', default: 2, min: 0, max: 30, label: '旋转速度' },
  },
  state: () => ({
    elapsed: 0,
  }),
  onUpdate(self, dt) {
    self.state.elapsed += dt
    self.rotation = {
      x: self.rotation.x,
      y: self.rotation.y + self.params.speed * dt,
      z: self.rotation.z,
    }
  },
})
`
}

let hotReloadBound = false

export async function exportCodeAssetsToDirectory(
  dir: string,
  records: ReadonlyArray<{ relativePath: string; source: string }>,
): Promise<void> {
  const bridge = electronBridge()
  if (!dir || !bridge?.fs?.writeTextFile || records.length === 0) return
  await ensureCodeWorkspaceFiles(dir)
  for (const item of records) {
    const cleanRel = item.relativePath.replace(/\\/g, '/')
    const parentRel = cleanRel.includes('/') ? cleanRel.slice(0, cleanRel.lastIndexOf('/')) : ''
    if (parentRel && bridge.fs.mkdir) {
      await bridge.fs.mkdir(joinProjectPath(dir, parentRel)).catch(() => undefined)
    }
    await bridge.fs.writeTextFile(joinProjectPath(dir, cleanRel), item.source)
  }
  await scanProjectCodeAssets(dir)
}

export function bindCodeAssetHotReload(): void {
  if (hotReloadBound) return
  hotReloadBound = true

  const bridge = electronBridge()
  bridge?.codeAssets?.onChanged((payload) => {
    void reloadCodeAssetFromDisk(payload.relativePath).then((record) => {
      if (!record) return
      if (!record.ok && record.diagnostics.length > 0) {
        const first = record.diagnostics[0]
        useEditorStore.getState().log('warn', `外部修改热重载报错 ${record.relativePath}:${first.line} ${first.message}`)
      } else {
        useEditorStore.getState().log('info', `已热重载外部修改：${record.relativePath}`)
      }
    })
  })

  const syncCurrentProject = () => {
    const dir = projectDirectoryPath()
    if (!dir) return
    void ensureCodeWorkspaceFiles(dir)
      .then(() => scanProjectCodeAssets(dir))
      .then(() => bridge?.codeAssets?.watchProject(dir))
      .catch(() => undefined)
  }

  useProjectDirectory.subscribe((state, prev) => {
    if (state.active && (state.epoch !== prev.epoch || state.name !== prev.name || !prev.active)) {
      syncCurrentProject()
    }
  })
  syncCurrentProject()
}
