import { create } from 'zustand'
import { ASSETS_ROOT, normalizeDir } from '../../editor/assets/folders'
import { useAssetStore } from '../../editor/assets/library'
import { projectDirectoryPath, useProjectDirectory } from '../../editor/project/disk'
import { electronBridge, joinProjectPath } from '../../editor/project/electronBridge'
import { useEditorStore } from '../../editor/scene/store'
import type { CodeDiagnostic } from './compiler'
import {
  clearAllCompiledScripts,
  compileAndRegisterScript,
  unregisterCompiledScript,
  type CompiledScriptAsset,
} from './scriptRuntime'
import { compileShaderSource, type CompiledShaderAsset } from './shaderRuntime'
import { RUNTIME_DTS_SUMMARY, SHADER_DTS_SUMMARY } from './typeDefs'

export { RUNTIME_DTS_SUMMARY, SHADER_DTS_SUMMARY }

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
  "include": ["Assets/**/*.ts", "scripts/**/*.ts", "shaders/**/*.ts", ".t3d/**/*.d.ts"]
}
`

export function codeAssetDirKey(kind: CodeAssetKind, id: string): string {
  return `code:${kind}:${id}`
}

export function defaultCodeAssetDir(kind: CodeAssetKind): string {
  return kind === 'shader' ? 'Assets/Shaders' : 'Assets/Scripts'
}

export function codeAssetFileName(kind: CodeAssetKind, id: string): string {
  return kind === 'shader' ? `${id}.shader.ts` : `${id}.ts`
}

function ensureFolderInStore(folder: string): void {
  const dir = normalizeDir(folder)
  if (dir === ASSETS_ROOT) return
  const store = useAssetStore.getState()
  if (!store.folders.includes(dir)) {
    useAssetStore.setState((s) => ({
      folders: [...new Set([...s.folders.map(normalizeDir), dir])].filter((f) => f !== ASSETS_ROOT),
      revision: s.revision + 1,
    }))
  }
}

export async function ensureCodeWorkspaceFiles(projectRoot?: string | null): Promise<void> {
  const dir = projectRoot ?? projectDirectoryPath()
  if (!dir) return
  const bridge = electronBridge()
  if (!bridge?.fs?.mkdir || !bridge?.fs?.writeTextFile) return
  await bridge.fs.mkdir(joinProjectPath(dir, '.t3d'))
  await bridge.fs.mkdir(joinProjectPath(dir, 'Assets/Scripts'))
  await bridge.fs.mkdir(joinProjectPath(dir, 'Assets/Shaders'))
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

export function codeAssetRelativePath(kind: CodeAssetKind, id: string, folder?: string): string {
  const dirKey = codeAssetDirKey(kind, id)
  const storedDir = useAssetStore.getState().assetDirs[dirKey]
  const existingRel = useCodeAssetStore.getState().assets[id]?.relativePath
  const existingAssetsDir =
    existingRel && (existingRel.startsWith(`${ASSETS_ROOT}/`) || existingRel === ASSETS_ROOT) && existingRel.includes('/')
      ? existingRel.slice(0, existingRel.lastIndexOf('/'))
      : null
  const targetDir = folder?.trim()
    ? normalizeDir(folder)
    : storedDir
      ? normalizeDir(storedDir)
      : existingAssetsDir
        ? normalizeDir(existingAssetsDir)
        : defaultCodeAssetDir(kind)
  return `${targetDir}/${codeAssetFileName(kind, id)}`
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
  folder?: string,
): Promise<CodeAssetRecord> {
  const id = normalizeCodeAssetId(kind, idOrName)
  const prevRel = useCodeAssetStore.getState().assets[id]?.relativePath
  const rel = codeAssetRelativePath(kind, id, folder)
  const targetDir = normalizeDir(rel.slice(0, rel.lastIndexOf('/')))
  ensureFolderInStore(targetDir)
  useAssetStore.getState().place(codeAssetDirKey(kind, id), targetDir)

  const record = compileCodeAsset(kind, id, rel, source)

  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge?.fs) {
    await ensureCodeWorkspaceFiles(dir)
    if (bridge.fs.mkdir) {
      await bridge.fs.mkdir(joinProjectPath(dir, targetDir))
    }
    await bridge.fs.writeTextFile(joinProjectPath(dir, rel), source)
    if (prevRel && prevRel !== rel && bridge.fs.unlinkFile) {
      await bridge.fs.unlinkFile(joinProjectPath(dir, prevRel)).catch(() => undefined)
    }
  }

  if (!record.ok && record.diagnostics.length > 0) {
    const first = record.diagnostics[0]
    useEditorStore.getState().log('warn', `${rel}:${first.line} ${first.message}`)
  } else {
    useEditorStore.getState().log('info', `代码资产已编译并热重载：${rel}`)
  }
  return record
}

export async function moveCodeAssetFile(kind: CodeAssetKind, id: string, nextDir: string): Promise<void> {
  const record = useCodeAssetStore.getState().assets[id]
  if (!record || record.kind !== kind) return
  const targetDir = normalizeDir(nextDir)
  const nextRel = `${targetDir}/${codeAssetFileName(kind, id)}`
  if (record.relativePath === nextRel) return
  const oldRel = record.relativePath
  useCodeAssetStore.getState().upsertAsset({ ...record, relativePath: nextRel })

  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (!dir || !bridge?.fs) return
  if (bridge.fs.mkdir) {
    await bridge.fs.mkdir(joinProjectPath(dir, targetDir)).catch(() => undefined)
  }
  if (bridge.fs.movePath && oldRel) {
    const moved = await bridge.fs.movePath(joinProjectPath(dir, oldRel), joinProjectPath(dir, nextRel)).then(() => true).catch(() => false)
    if (moved) return
  }
  await bridge.fs.writeTextFile(joinProjectPath(dir, nextRel), record.source)
  if (oldRel && oldRel !== nextRel && bridge.fs.unlinkFile) {
    await bridge.fs.unlinkFile(joinProjectPath(dir, oldRel)).catch(() => undefined)
  }
}

export function clearCodeAssetsSession(): void {
  clearAllCompiledScripts()
  useCodeAssetStore.getState().clear()
}

export async function deleteCodeAsset(id: string): Promise<void> {
  const record = useCodeAssetStore.getState().assets[id]
  if (!record) return
  if (record.kind === 'script') {
    unregisterCompiledScript(id)
  }
  const dirKey = codeAssetDirKey(record.kind, id)
  useCodeAssetStore.getState().removeAsset(id)
  useAssetStore.setState((state) => {
    if (!(dirKey in state.assetDirs)) return {}
    const next = { ...state.assetDirs }
    delete next[dirKey]
    return { assetDirs: next, revision: state.revision + 1 }
  })
  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge?.fs?.unlinkFile && record.relativePath) {
    await bridge.fs.unlinkFile(joinProjectPath(dir, record.relativePath)).catch(() => undefined)
  }
}

async function scanCodeDirectoryRecursive(
  projectRoot: string,
  relDir: string,
  seenIds: Set<string>,
): Promise<number> {
  const bridge = electronBridge()
  if (!bridge?.fs?.list || !bridge?.fs?.readTextFile) return 0
  const entries = await bridge.fs.list(joinProjectPath(projectRoot, relDir)).catch(() => [])
  let loaded = 0
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('.')) continue
    const rel = `${relDir}/${entry.name}`
    if (entry.kind === 'directory') {
      loaded += await scanCodeDirectoryRecursive(projectRoot, rel, seenIds)
      continue
    }
    if (entry.kind !== 'file' || !entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue
    const kind: CodeAssetKind = entry.name.endsWith('.shader.ts') ? 'shader' : 'script'
    const id = normalizeCodeAssetId(kind, entry.name)
    if (seenIds.has(id)) continue
    const source = await bridge.fs.readTextFile(joinProjectPath(projectRoot, rel)).catch(() => null)
    if (source === null) continue
    seenIds.add(id)
    if (relDir === ASSETS_ROOT || relDir.startsWith(`${ASSETS_ROOT}/`)) {
      const normalized = normalizeDir(relDir)
      ensureFolderInStore(normalized)
      useAssetStore.getState().place(codeAssetDirKey(kind, id), normalized)
    }
    compileCodeAsset(kind, id, rel, source)
    loaded += 1
  }
  return loaded
}

export async function scanProjectCodeAssets(projectRoot?: string | null): Promise<number> {
  const dir = projectRoot ?? projectDirectoryPath()
  const bridge = electronBridge()
  if (!dir || !bridge?.fs?.list || !bridge?.fs?.readTextFile) return 0

  const seenIds = new Set<string>()
  let loaded = await scanCodeDirectoryRecursive(dir, ASSETS_ROOT, seenIds)

  // 向后兼容旧工程根目录 scripts/ 与 shaders/
  for (const [kind, subDir] of [
    ['shader', 'shaders'],
    ['script', 'scripts'],
  ] as const) {
    const entries = await bridge.fs.list(joinProjectPath(dir, subDir)).catch(() => [])
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue
      const id = normalizeCodeAssetId(kind, entry.name)
      if (seenIds.has(id)) continue
      const rel = `${subDir}/${entry.name}`
      const source = await bridge.fs.readTextFile(joinProjectPath(dir, rel)).catch(() => null)
      if (source === null) continue
      seenIds.add(id)
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
  if (!cleanRel.endsWith('.ts') || cleanRel.endsWith('.d.ts')) return null
  const kind: CodeAssetKind | null = cleanRel.startsWith(`${ASSETS_ROOT}/`)
    ? cleanRel.endsWith('.shader.ts')
      ? 'shader'
      : 'script'
    : cleanRel.startsWith('shaders/')
      ? 'shader'
      : cleanRel.startsWith('scripts/')
        ? 'script'
        : null
  if (!kind) return null

  const source = await bridge.fs.readTextFile(joinProjectPath(dir, cleanRel)).catch(() => null)
  if (source === null) return null
  const fileName = cleanRel.split('/').pop() ?? cleanRel
  const id = normalizeCodeAssetId(kind, fileName)
  if (cleanRel.startsWith(`${ASSETS_ROOT}/`)) {
    const parentRel = normalizeDir(cleanRel.slice(0, cleanRel.lastIndexOf('/')))
    ensureFolderInStore(parentRel)
    useAssetStore.getState().place(codeAssetDirKey(kind, id), parentRel)
  }
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
