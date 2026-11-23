import type { EffectAsset, MaterialAsset, PrefabAsset, SceneAsset, UiAsset } from './library'
import { assetDirectory, assetName, useAssetStore, type FileAsset } from './library'
import {
  artifactKey,
  migrateLegacyFilesToMeta,
  patchAssetMeta,
  readAssetMetas,
  readFileBytes,
  readIdbArtifact,
  readIdbFiles,
  readSceneDocument,
  sha256,
  writeSceneDocument,
  type AssetMeta,
  type CachedFile,
} from './cache'
import { fileKindFor, warmCachedAsset } from './import'
import { useEditorStore } from '../scene/store'
import { useAgentStore } from '../../ai/agentLoop'
import { createFreshScene } from '../scene/seed'
import {
  clearCodeAssetsSession,
  codeAssetDirKey,
  codeAssetFileName,
  exportCodeAssetsToDirectory,
  moveCodeAssetFile,
  useCodeAssetStore,
} from '../../core/codeAssets/workspace'
import { translate } from '../i18n'
import { usePrefsStore } from '../prefs/store'
import type { ProjectDocument, ProjectWorkspace } from '../scene/document'
import { restoreInspectorEntries, snapshotInspectorEntries, useInspectorMemory } from '../panels/inspectorMemory'
import { defaultCapabilities, normalizeCapabilities } from '../../capabilities/registry'
import { ensureGameDatabase, resolveEnabledPackIds } from '../../gameplay/registry'
import { ALL_LAYERS_VISIBLE_MASK, defaultLayers, defaultTags, ensureLayers, ensureTags } from '../project/taxonomy'
import { normalizePicture, type SceneNode } from '../scene/types'
import { serializeNavMeshes } from '../../capabilities/navigation/archive'
import { collectUiImageIds } from '../../runtime/ui/tree'
import { modelLoadedFromArtifact, releaseModel } from './models'
import { compareShadersWithLastRun, gpuCounters, pipelineRecordCount, pipelineRecordsSince, startCostCapture, stopCostCapture, type PipelineRecord } from '../../runtime/frameProfile'
import { releaseTexture, rendererInitMs, rendererReadyAt, setWarmBumpDeferred, textureLoadBytes, textureLoadSource, textureReadMs, unityMrLoadInfo, warmUnityMetallicRoughness } from './textures'
import { ASSETS_ROOT, normalizeDir } from './folders'
import {
  adoptAsset,
  assetRecord,
  assetRecords,
  begin,
  beginPath,
  bindDirectoryFlush,
  DEFAULT_ASSET_FOLDERS,
  ensureDirectory,
  isDirectoryProject,
  listAssetDirectories,
  listAssetFiles,
  moveAssetFile,
  parentProjectPath,
  pickDirectory,
  pruneArtifacts,
  readArtifact,
  readProjectPath,
  readProjectText,
  recordsFromUnknown,
  removeEmptyDirectory,
  ensureDirectoryPermission,
  retargetAsset,
  scaffold,
  setDirectoryFlushEnabled,
  snapshotSources,
  useProjectDirectory,
  writeArtifact,
  writeSourceAsset,
  type DirectoryAssetRecord,
} from '../project/disk'
import { RecentProjectService, type RecentProject } from '../project/recents'
import { directoryBaseName, electronBridge, joinProjectPath } from '../project/electronBridge'

const MAP_KEYS = ['mapAssetId', 'normalAssetId', 'metallicRoughnessAssetId', 'roughnessAssetId', 'metalnessAssetId', 'emissiveAssetId', 'aoAssetId'] as const

let opening: Promise<void> | null = null
let saveTimer = 0
let autosaveBound = false
let warmToken = 0
let layoutBound = false
let layoutSuspended = 0
let layoutPrevious = { folders: [] as string[], assetDirs: {} as Record<string, string> }
let layoutChain: Promise<void> = Promise.resolve()

export interface WarmProgress {
  completed: number
  total: number
}

let warmState: WarmProgress | null = null
const warmListeners = new Set<() => void>()

export function warmProgress(): WarmProgress | null {
  return warmState
}

export function subscribeWarmProgress(listener: () => void): () => void {
  warmListeners.add(listener)
  return () => warmListeners.delete(listener)
}

function setWarmProgress(next: WarmProgress | null) {
  warmState = next
  warmListeners.forEach(listener => listener())
}

export function openCachedProject(): Promise<void> {
  opening ??= openCachedNow().catch(error => {
    opening = null
    console.warn('[cache] 打开项目失败', error)
    useEditorStore.getState().log('warn', translate('log.cacheOpenFail'))
  })
  return opening
}

export function bindProjectAutosave() {
  if (autosaveBound) return
  autosaveBound = true
  bindDirectoryFlush(() => { void saveProjectNow() })
  bindDirectoryLayout()
  useEditorStore.subscribe(scheduleSave)
  useAssetStore.subscribe(scheduleSave)
  useInspectorMemory.subscribe(scheduleSave)
  useAgentStore.subscribe((state, prev) => {
    if (state.panelOpen !== prev.panelOpen || state.panelScrollTop !== prev.panelScrollTop) {
      scheduleSave()
    }
  })
  window.addEventListener('beforeunload', () => { void saveProjectNow() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void saveProjectNow()
  })
}

export function notifyProjectSaved() {
  const name = useProjectDirectory.getState().name
  useEditorStore.getState().notify(name ? translate('menu.savedDirectory', { name }) : translate('menu.saved'))
}

function createFreshProjectDocument(): ProjectDocument {
  const fresh = createFreshScene('主场景')
  const sceneAsset: SceneAsset = {
    id: fresh.id,
    name: fresh.name,
    kind: 'scene',
    nodes: fresh.nodes,
    picture: fresh.picture,
  }
  return {
    schemaVersion: 2,
    savedAt: Date.now(),
    activeSceneId: fresh.id,
    nodes: fresh.nodes,
    selection: [fresh.selectedId],
    picture: fresh.picture,
    library: [sceneAsset],
    folders: withDefaultFolders([]),
    assetDirs: {},
    capabilities: defaultCapabilities(),
    gameplayPacks: [...resolveEnabledPackIds()],
    gameDatabase: ensureGameDatabase(undefined, undefined),
    tags: defaultTags(),
    layers: defaultLayers(),
    editorCullingMask: ALL_LAYERS_VISIBLE_MASK,
    physicsCollisionMatrixEnabled: false,
    physicsCollisionRowMasks: {},
    navMeshes: {},
    workspace: {
      assetBrowseDir: ASSETS_ROOT,
      assetExpanded: [ASSETS_ROOT],
    },
  }
}

export async function createDirectoryProject(): Promise<void> {
  if (useEditorStore.getState().playState !== 'stopped') return
  try {
    const picked = await pickDirectory()
    if (!picked) return
    const name = typeof picked === 'string' ? directoryBaseName(picked) : picked.name
    if (await readProjectText(picked)) {
      const opened = await openSource(picked, false)
      if (opened) useEditorStore.getState().log('info', translate('log.projectExists', { name }))
      return
    }
    window.clearTimeout(saveTimer)
    suspendLayout()
    setDirectoryFlushEnabled(false)
    try {
      await scaffold(picked)
      if (typeof picked === 'string') {
        await beginPath(picked, name, [], null)
        RecentProjectService.addPath(picked, name)
      } else {
        await begin(picked, name, [], null)
        RecentProjectService.add(picked, name)
      }
      const freshDocument = createFreshProjectDocument()
      replaceSession(freshDocument)
      useEditorStore.getState().ensureSceneAsset()
    } finally {
      setDirectoryFlushEnabled(true)
      await resumeLayout()
    }
    await saveProjectNow()
    const message = translate('log.projectCreated', { name })
    useEditorStore.getState().log('info', message)
    useEditorStore.getState().notify(message)
  } catch (error) {
    await salvageProject(error)
  }
}

/** 把当前项目（缓存或已有磁盘工程）完整另存为所选目录下的新工程，并改由该目录继续保存。 */
export async function saveCacheAsDirectoryProject(): Promise<void> {
  if (useEditorStore.getState().playState !== 'stopped') return
  try {
    const picked = await pickDirectory()
    if (!picked) return
    const name = typeof picked === 'string' ? directoryBaseName(picked) : picked.name
    if (await readProjectText(picked)) {
      const message = translate('log.projectSaveAsOccupied', { name })
      useEditorStore.getState().log('warn', message)
      useEditorStore.getState().notify(message)
      return
    }
    await publishSessionToDirectory(picked, name)
    const message = translate('log.projectSavedAs', { name })
    useEditorStore.getState().log('info', message)
    useEditorStore.getState().notify(message)
  } catch (error) {
    await salvageProject(error)
  }
}

async function publishSessionToDirectory(picked: FileSystemDirectoryHandle | string, name: string) {
  window.clearTimeout(saveTimer)
  suspendLayout()
  setDirectoryFlushEnabled(false)
  try {
    const codeAssets = Object.values(useCodeAssetStore.getState().assets).map(a => ({
      relativePath: a.relativePath,
      source: a.source,
    }))
    const sources = await collectSources()
    const artifacts = await collectArtifacts(sources)
    await scaffold(picked)
    if (typeof picked === 'string') {
      await beginPath(picked, name, [], null)
      RecentProjectService.addPath(picked, name)
      await exportCodeAssetsToDirectory(picked, codeAssets)
    } else {
      await begin(picked, name, [], null)
      RecentProjectService.add(picked, name)
    }
    useAssetStore.setState({ folders: withDefaultFolders(useAssetStore.getState().folders) })
    await runPool(sources, 4, async file => {
      const meta = metaForSource(file, artifacts.has(file.hash))
      const directory = assetDirectory(file.id, useAssetStore.getState().assetDirs)
      await writeSourceAsset(meta, file.bytes, directory)
    })
    for (const [hash, glb] of artifacts) await writeArtifact(artifactKey(hash), glb)
    await reconcileLooseAssets()
  } finally {
    setDirectoryFlushEnabled(true)
    await resumeLayout()
  }
  await saveProjectNow()
}

export async function openDirectoryProject(): Promise<void> {
  if (useEditorStore.getState().playState !== 'stopped') return
  try {
    const picked = await pickDirectory()
    if (!picked) return
    await openSource(picked, true)
  } catch (error) {
    await salvageProject(error)
  }
}

export async function saveProjectNow() {
  const editor = useEditorStore.getState()
  if (editor.playState !== 'stopped' || editor.gesture) return
  editor.flushActiveScene()
  const library = Object.values(useAssetStore.getState().assets).filter(
    (asset): asset is MaterialAsset | PrefabAsset | SceneAsset | EffectAsset | UiAsset => asset.kind === 'material' || asset.kind === 'prefab' || asset.kind === 'scene' || asset.kind === 'effect' || asset.kind === 'ui',
  )
  const catalog = useAssetStore.getState()
  const document: ProjectDocument = {
    schemaVersion: 2,
    savedAt: Date.now(),
    activeSceneId: editor.activeSceneId,
    nodes: editor.nodes,
    selection: editor.selection,
    picture: editor.picture,
    library,
    folders: catalog.folders,
    assetDirs: catalog.assetDirs,
    capabilities: editor.capabilities,
    gameplayPacks: editor.gameplayPacks,
    gameDatabase: editor.gameDatabase,
    tags: editor.tags,
    layers: editor.layers,
    editorCullingMask: editor.editorCullingMask,
    physicsCollisionMatrixEnabled: editor.physicsCollisionMatrixEnabled,
    physicsCollisionRowMasks: editor.physicsCollisionRowMasks,
    navMeshes: serializeNavMeshes(),
    workspace: currentWorkspace(),
  }
  await writeSceneDocument(document)
}

function scheduleSave() {
  if (!usePrefsStore.getState().autoSave) return
  const editor = useEditorStore.getState()
  if (editor.playState !== 'stopped' || editor.gesture) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => { void saveProjectNow() }, 300)
}

async function openCachedNow() {
  try {
    await RecentProjectService.seedFromLegacy()
  } catch (error) {
    console.warn('[project] 最近工程列表不可用', error)
  }
  if (usePrefsStore.getState().openLastProject) {
    const opened = await restoreLastProject()
    if (opened) return
  }
  await openNow()
}

async function restoreLastProject(): Promise<boolean> {
  const [last] = RecentProjectService.getAll()
  if (!last) return false
  if (last.path && electronBridge()) return restorePath(last)
  const handle = await RecentProjectService.handleOf(last.id)
  if (!handle) {
    RecentProjectService.remove(last.id)
    return false
  }
  const allowed = await ensureDirectoryPermission(handle)
  if (!allowed) {
    useEditorStore.getState().log('info', translate('log.projectPermission'))
    return false
  }
  try {
    const opened = await openSource(handle, false)
    if (!opened) {
      if (!(await readProjectText(handle))) RecentProjectService.remove(last.id)
      return false
    }
    return true
  } catch (error) {
    console.warn('[project] 恢复工程目录失败', error)
    if (isDirectoryProject()) await saveProjectNow().catch(saveError => console.warn('[project] 补存失败', saveError))
    useEditorStore.getState().log('warn', failureText(error))
    return isDirectoryProject()
  }
}

async function restorePath(last: RecentProject): Promise<boolean> {
  if (!last.path) return false
  const bridge = electronBridge()
  if (!bridge) return false
  await bridge.fs.authorizeRoot?.(last.path)
  const exists = await bridge.fs.exists(joinProjectPath(last.path, 'project.t3d'))
    || await bridge.fs.exists(joinProjectPath(last.path, 'project.t3d.tmp'))
  if (!exists) {
    RecentProjectService.remove(last.id)
    useEditorStore.getState().log('warn', translate('log.projectMissing'))
    return false
  }
  try {
    return await openSource(last.path, false)
  } catch (error) {
    console.warn('[project] 恢复工程目录失败', error)
    if (isDirectoryProject()) await saveProjectNow().catch(saveError => console.warn('[project] 补存失败', saveError))
    useEditorStore.getState().log('warn', failureText(error))
    return isDirectoryProject()
  }
}

export async function openRecentProject(id: string): Promise<void> {
  if (useEditorStore.getState().playState !== 'stopped') return
  const known = RecentProjectService.getAll().find(item => item.id === id)
  if (!known) {
    RecentProjectService.remove(id)
    useEditorStore.getState().log('warn', translate('log.projectMissing'))
    return
  }
  if (known.path) {
    const bridge = electronBridge()
    if (!bridge) {
      useEditorStore.getState().log('info', translate('log.projectPermission'))
      return
    }
    await bridge.fs.authorizeRoot?.(known.path)
    try {
      const opened = await openSource(known.path, true)
      if (!opened) RecentProjectService.remove(id)
    } catch (error) {
      await salvageProject(error)
    }
    return
  }
  const handle = await RecentProjectService.handleOf(id)
  if (!handle) {
    RecentProjectService.remove(id)
    useEditorStore.getState().log('warn', translate('log.projectMissing'))
    return
  }
  try {
    const allowed = await ensureDirectoryPermission(handle)
    if (!allowed) {
      useEditorStore.getState().log('info', translate('log.projectPermission'))
      return
    }
    const opened = await openSource(handle, true)
    if (!opened && !(await readProjectText(handle))) RecentProjectService.remove(id)
  } catch (error) {
    await salvageProject(error)
  }
}

async function openSource(source: FileSystemDirectoryHandle | string, announce: boolean): Promise<boolean> {
  const timeline = startOpenTimeline()
  const parsed = await readDirectoryFile(source)
  timeline.mark('read')
  if (typeof parsed === 'string') timeline.stop()
  if (parsed === 'missing') {
    useEditorStore.getState().log('warn', translate('log.projectMissing'))
    return false
  }
  if (parsed === 'invalid') {
    useEditorStore.getState().log('error', translate('log.projectInvalid'))
    return false
  }
  const started = performance.now()
  const token = nextWarmToken()
  suspendLayout()
  setDirectoryFlushEnabled(false)
  let metas: AssetMeta[] = parsed.assets
  let document = parsed.document
  try {
    if (typeof source === 'string') {
      await beginPath(source, parsed.name, parsed.assets, parsed.document)
      RecentProjectService.addPath(source, parsed.name)
    } else {
      await begin(source, parsed.name, parsed.assets, parsed.document)
      await RecentProjectService.add(source, parsed.name)
    }
    timeline.mark('session')
    const folders = mergeFolders(parsed.document.folders ?? [], await listAssetDirectories())
    timeline.mark('scan')
    document = { ...parsed.document, folders }
    replaceSession(document)
    timeline.mark('session')
    const adopted = await reconcileLooseAssets()
    timeline.mark('scan')
    metas = [...parsed.assets, ...adopted]
    useEditorStore.getState().ensureSceneAsset()
  } catch (error) {
    timeline.stop()
    throw error
  } finally {
    setDirectoryFlushEnabled(true)
    await resumeLayout()
  }
  timeline.mark('session')
  await saveProjectNow()
  timeline.mark('save')
  const sceneMs = performance.now() - started
  if (announce) useEditorStore.getState().log('info', translate('log.projectOpened', { name: parsed.name }))
  if (metas.length === 0) {
    timeline.stop()
    useEditorStore.getState().log('info', translate('log.opened', { ms: Math.round(sceneMs) }))
    return true
  }
  void warmAssets(token, metas, document, started, sceneMs, timeline)
  return true
}

async function openNow() {
  const started = performance.now()
  const timeline = startOpenTimeline()
  const token = nextWarmToken()
  await migrateLegacyFilesToMeta()
  const [metas, stored] = await Promise.all([readAssetMetas(), readSceneDocument<ProjectDocument>()])
  timeline.mark('read')
  const document = validDocument(stored)
  if (document) {
    useAssetStore.getState().loadCatalog(document.folders ?? [], document.assetDirs ?? {})
    for (const record of document.library) {
      if (!useAssetStore.getState().assets[record.id]) useAssetStore.getState().add(record)
    }
    const placed = applyWorkspace(document)
    if (placed) {
      useAssetStore.getState().setBrowseDir(placed.browseDir)
      useAssetStore.getState().setExpanded(placed.expanded)
    }
    useEditorStore.getState().loadDocument(document)
  }
  useEditorStore.getState().ensureSceneAsset()
  timeline.mark('session')
  const sceneMs = performance.now() - started
  if (metas.length === 0) {
    timeline.stop()
    useEditorStore.getState().log('info', translate('log.opened', { ms: Math.round(sceneMs) }))
    return
  }
  void warmAssets(token, metas, document, started, sceneMs, timeline)
}

async function warmAssets(token: number, metas: AssetMeta[], document: ProjectDocument | null, started: number, sceneMs: number, timeline: OpenTimeline) {
  const { ids: referenced, unityMrIds, plainIds } = referencedAssetIds(document)
  const warmStart = performance.now()
  const modelSpan = wallSpan()
  const textureSpan = wallSpan()
  let mrDirectHits = 0
  const ordered = [...metas].sort((a, b) => rank(a, referenced) - rank(b, referenced))
  const initialAssets: FileAsset[] = []
  const warmQueue: { meta: AssetMeta, asset: FileAsset }[] = []
  const unreferencedWarm: string[] = []
  for (const rawMeta of ordered) {
    const cleanMeta = stripRedundantThumb(rawMeta)
    const asset = createFileAssetFromMeta(cleanMeta)
    initialAssets.push(asset)
    if (referenced.has(cleanMeta.id)) {
      warmQueue.push({ meta: cleanMeta, asset })
    } else if (needsMetadataDiscovery(cleanMeta)) {
      warmQueue.push({ meta: cleanMeta, asset })
      unreferencedWarm.push(`${cleanMeta.name}（${discoveryReason(cleanMeta)}）`)
    }
  }
  // 场景没用到却要加载的资源：正常只在导入后第一次打开出现，反复出现说明登记信息没存住
  if (unreferencedWarm.length > 0) {
    const shown = unreferencedWarm.slice(0, 8).join('、')
    const more = unreferencedWarm.length > 8 ? ` 等 ${unreferencedWarm.length} 个` : ''
    useEditorStore.getState().log('info', `打开时补登记了场景未引用的资源：${shown}${more}`)
  }
  setWarmBumpDeferred(true)
  useAssetStore.getState().addMany(initialAssets)

  const totalWarm = warmQueue.length
  let warmedCount = 0
  if (totalWarm > 0) setWarmProgress({ completed: 0, total: totalWarm })
  let hits = 0
  let parsed = 0
  let failed = 0
  let modelMs = 0
  let textureMs = 0
  let bc7Hits = 0
  let baseHits = 0
  let texBytes = 0
  let texReadMs = 0
  try {
    await runPool(warmQueue, 6, async ({ meta: cleanMeta, asset }) => {
      if (!warmCurrent(token)) return
      try {
        await materialize(cleanMeta, true, asset)
        if (!warmCurrent(token)) return
        const stepStart = performance.now()
        // 只被当作 Unity 金属光滑图使用的贴图：直接读重排成品，不加载原图
        const mrOnly = cleanMeta.kind === 'texture' && Boolean(asset.thumb)
          && unityMrIds.has(cleanMeta.id) && !plainIds.has(cleanMeta.id)
        let ok = true
        if (mrOnly) {
          await warmUnityMetallicRoughness(cleanMeta.id)
        } else {
          ok = await warmCachedAsset(asset)
          if (ok && cleanMeta.kind === 'texture' && unityMrIds.has(cleanMeta.id)) {
            await warmUnityMetallicRoughness(cleanMeta.id)
          }
        }
        // 成品在盘上、登记却写着没有：补上，否则这个文件每次打开都会被重新加载
        if (ok && !cleanMeta.artifactReady && (cleanMeta.kind === 'model' || cleanMeta.kind === 'animation') && modelLoadedFromArtifact(cleanMeta.id)) {
          void patchAssetMeta(cleanMeta.id, { artifactReady: true }).catch(() => undefined)
        }
        const stepEnd = performance.now()
        const stepElapsed = stepEnd - stepStart
        if (cleanMeta.kind === 'model' || cleanMeta.kind === 'animation') {
          modelMs += stepElapsed
          modelSpan.add(stepStart, stepEnd)
        } else if (cleanMeta.kind === 'texture' || cleanMeta.kind === 'environment') {
          textureMs += stepElapsed
          textureSpan.add(stepStart, stepEnd)
        }
        if (!warmCurrent(token)) {
          releaseRuntimeAsset(asset.id, asset.url)
          useAssetStore.getState().remove(asset.id)
          return
        }
        const mrInfo = cleanMeta.kind === 'texture' ? unityMrLoadInfo(cleanMeta.id) : null
        if (mrInfo) {
          texBytes += mrInfo.bytes
          texReadMs += mrInfo.readMs
          mrDirectHits += 1
        }
        if (!ok) failed += 1
        else if ((cleanMeta.kind === 'model' || cleanMeta.kind === 'animation') && cleanMeta.artifactReady) hits += 1
        else if (mrOnly) {
          if (mrInfo) {
            hits += 1
            if (mrInfo.source === 'bc7') bc7Hits += 1
            else baseHits += 1
          } else {
            parsed += 1
          }
        }
        else if (cleanMeta.kind === 'texture') {
          const src = textureLoadSource(asset.id)
          if (src === 'bc7') { hits += 1; bc7Hits += 1; texBytes += textureLoadBytes(asset.id); texReadMs += textureReadMs(asset.id) }
          else if (src === 'base') { hits += 1; baseHits += 1; texBytes += textureLoadBytes(asset.id) }
          else parsed += 1
        }
        else parsed += 1
      } catch (error) {
        failed += 1
        console.warn('[cache] 资源恢复失败', cleanMeta.name, error)
      } finally {
        if (warmCurrent(token)) {
          warmedCount += 1
          setWarmProgress({ completed: warmedCount, total: totalWarm })
        }
      }
    })
  } finally {
    setWarmBumpDeferred(false)
  }
  if (!warmCurrent(token)) {
    timeline.stop()
    return
  }
  setWarmProgress(null)
  if (isDirectoryProject()) {
    const validKeys = new Set<string>()
    for (const meta of metas) {
      if ((meta.kind === 'model' || meta.kind === 'animation') && meta.hash) {
        validKeys.add(artifactKey(meta.hash))
      }
    }
    void pruneArtifacts(validKeys).catch(() => undefined)
  }
  const total = Math.round(performance.now() - started)
  useEditorStore.getState().log(
    'info',
    `${translate('log.openedDetail', {
      total,
      scene: Math.round(sceneMs),
      model: Math.round(modelMs),
      texture: Math.round(textureMs),
      hits,
      parsed,
      failed,
    })} [BC7 ${bc7Hits} · 裸像素 ${baseHits} · 金属光滑图直读 ${mrDirectHits} · ${(texBytes / (1024 * 1024)).toFixed(1)}MB · 读盘累计 ${Math.round(texReadMs)}ms]`,
  )
  const warmMs = performance.now() - warmStart
  const gpuBefore = gpuCounters()
  const pipelineMark = pipelineRecordCount()
  startCostCapture()
  const precompiled = waitForPrecompile()
  window.dispatchEvent(new CustomEvent('t3d:warm-complete'))
  // 贴图到齐后材质才换上贴图：这之后的着色器编译与贴图上传不在上面的统计里，单独量到画面稳定为止
  const warmDoneAt = performance.now()
  const readyAt = await waitForRenderer()
  await precompiled
  const compileMs = Math.max(0, performance.now() - readyAt)
  const settle = await waitForSmoothFrames()
  const busy = timeline.stop()
  const costs = stopCostCapture()
  const gpuAfter = gpuCounters()
  if (!warmCurrent(token)) return
  const costText = costs.filter(row => row.ms >= 1).slice(0, 6).map(row => `${row.id} ${Math.round(row.ms)}ms`).join(' · ')
  // 细节只进开发者工具控制台，日志面板只留一行时间线
  console.debug(translate('log.openProfile', {
    costs: costText || '-',
    shaders: gpuAfter.shaders - gpuBefore.shaders,
    pipelines: gpuAfter.pipelines - gpuBefore.pipelines,
    asyncPipelines: gpuAfter.asyncPipelines - gpuBefore.asyncPipelines,
    asyncMs: Math.round(gpuAfter.asyncMs - gpuBefore.asyncMs),
    asyncWorst: Math.round(gpuAfter.asyncWorst),
    earlyShaders: gpuBefore.shaders,
    earlyPipelines: gpuBefore.pipelines + gpuBefore.asyncPipelines,
  }))
  if (import.meta.env.DEV) {
    const pipelineRecords = pipelineRecordsSince(pipelineMark)
    const pipelineText = describePipelines(pipelineRecords)
    if (pipelineText) console.debug(pipelineText)
    for (const line of describePipelineDiffs(pipelineRecords)) console.debug(`管线差异：${line}`)
    const shaderRun = compareShadersWithLastRun()
    if (shaderRun.unique > 0) console.debug(`着色器文本：共 ${shaderRun.unique} 份不同文本，其中 ${shaderRun.same} 份与上次记录相同`)
  }
  useEditorStore.getState().log('info', translate('log.openTimeline', {
    read: Math.round(timeline.phase('read')),
    session: Math.round(timeline.phase('session')),
    scan: Math.round(timeline.phase('scan')),
    save: Math.round(timeline.phase('save')),
    warm: Math.round(warmMs),
    model: Math.round(modelSpan.length()),
    texture: Math.round(textureSpan.length()),
    init: Math.round(rendererInitMs()),
    wait: Math.round(Math.max(0, readyAt - warmDoneAt)),
    compile: Math.round(compileMs),
    settle: Math.round(settle.total),
    frames: settle.frames,
    slow: settle.slow,
    worst: Math.round(settle.worst),
    tasks: busy.count,
    busy: Math.round(busy.total),
    longest: Math.round(busy.longest),
  }))
}

/** 打开工程的墙上时钟时间线：各阶段耗时，外加主线程被长任务（超过 50ms）占用的情况。 */
interface OpenTimeline {
  /** 记下「从上一次 mark 到现在」这一段属于哪个阶段。 */
  mark: (phase: string) => void
  phase: (phase: string) => number
  stop: () => { count: number, total: number, longest: number }
}

function startOpenTimeline(): OpenTimeline {
  const phases = new Map<string, number>()
  let last = performance.now()
  const busy = { count: 0, total: 0, longest: 0 }
  let observer: PerformanceObserver | null = null
  try {
    observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        busy.count += 1
        busy.total += entry.duration
        busy.longest = Math.max(busy.longest, entry.duration)
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    observer = null
  }
  return {
    mark(phase) {
      const now = performance.now()
      phases.set(phase, (phases.get(phase) ?? 0) + now - last)
      last = now
    },
    phase: phase => phases.get(phase) ?? 0,
    stop() {
      observer?.disconnect()
      observer = null
      return busy
    },
  }
}

/** 一类资源从第一个开始到最后一个结束的墙上时钟跨度（并发加载时，累计耗时会远大于它）。 */
function wallSpan() {
  let first = Infinity
  let last = -Infinity
  return {
    add(start: number, end: number) {
      first = Math.min(first, start)
      last = Math.max(last, end)
    },
    length: () => (last > first ? last - first : 0),
  }
}

/** 把打开期间新建的渲染管线按绘制目标、按材质归类，写成一行日志（完整清单另打到控制台）。 */
function describePipelines(records: PipelineRecord[]): string {
  if (!records.length) return ''
  const tally = (key: (record: PipelineRecord) => string, only?: (record: PipelineRecord) => boolean) => {
    const map = new Map<string, { live: number, pre: number }>()
    for (const record of records) {
      if (only && !only(record)) continue
      const row = map.get(key(record)) ?? { live: 0, pre: 0 }
      if (record.precompiled) row.pre += 1
      else row.live += 1
      map.set(key(record), row)
    }
    return [...map.entries()].sort((a, b) => (b[1].live + b[1].pre) - (a[1].live + a[1].pre))
  }
  const targets = tally(record => record.target)
    .map(([target, row]) => `[${target}] 现编 ${row.live} 预编 ${row.pre}`)
    .join(' ; ')
  const materials = tally(record => record.material, record => !record.precompiled)
    .slice(0, 12)
    .map(([material, row]) => `${material}×${row.live}`)
    .join(' · ')
  // 同一材质、同一目标既被预编译又被现编译：说明预编译出的那条没对上，白编了
  const preKeys = new Set(records.filter(record => record.precompiled).map(record => `${record.id}|${record.target}`))
  const wasted = records.filter(record => !record.precompiled && preKeys.has(`${record.id}|${record.target}`)).length
  const liveIds = new Set(records.filter(record => !record.precompiled).map(record => record.id)).size
  const preIds = new Set(records.filter(record => record.precompiled).map(record => record.id)).size
  console.table(records.map(({ material, id, target, precompiled }) => ({ material, id, target, precompiled })))
  return `管线明细：按绘制目标 ${targets} ｜ 现编译的材质 ${materials || '-'} ｜ 现编译涉及 ${liveIds} 个材质，预编译涉及 ${preIds} 个材质，预编译后同目标又现编 ${wasted} 条`
}

/** 两段文本第一处不同在哪一行、共有多少行不同。完全相同返回 null。 */
function firstDifference(a: string, b: string): string | null {
  if (a === b) return null
  const left = a.split('\n')
  const right = b.split('\n')
  const length = Math.max(left.length, right.length)
  let first = -1
  let count = 0
  for (let i = 0; i < length; i++) {
    if (left[i] === right[i]) continue
    count += 1
    if (first < 0) first = i
  }
  const clip = (text: string | undefined) => (text ?? '（无）').trim().slice(0, 150)
  // 行数不同时逐行对比会整体错位，另外列出只在乙里出现的几行，才看得出多了什么
  const known = new Set(left.map(line => line.trim()))
  const extra = left.length === right.length ? [] : right.map(line => line.trim())
    .filter(line => line.length > 12 && !known.has(line))
    .filter(line => !/^(@binding|nodeUniform\d+ : |var nodeVar|nodeVar\d+ = )/.test(line) || /shadow|Shadow|env|fog|light/i.test(line))
    .slice(0, 6)
    .map(line => line.slice(0, 110))
  const extraText = extra.length ? `；乙独有的行举例：${extra.map(line => `「${line}」`).join(' ')}` : ''
  return `${left.length}/${right.length} 行，${count} 行不同，第 ${first + 1} 行：甲「${clip(left[first])}」乙「${clip(right[first])}」${extraText}`
}

function compareRecords(title: string, a: PipelineRecord, b: PipelineRecord): string {
  const parts: string[] = []
  const vertex = firstDifference(a.vertex, b.vertex)
  const fragment = firstDifference(a.fragment, b.fragment)
  const state = a.state === b.state ? null : (() => {
    let i = 0
    while (i < a.state.length && a.state[i] === b.state[i]) i += 1
    const from = Math.max(0, i - 40)
    return `甲「${a.state.slice(from, i + 80)}」乙「${b.state.slice(from, i + 80)}」`
  })()
  parts.push(vertex ? `顶点着色器 ${vertex}` : '顶点着色器相同')
  parts.push(fragment ? `片元着色器 ${fragment}` : '片元着色器相同')
  parts.push(state ? `管线状态不同 ${state}` : '管线状态相同')
  return `${title}（${a.material}）：${parts.join(' ｜ ')}`
}

/**
 * 找出三类「本该共用却各编一条」的管线，各取一对比较差在哪：
 * 预编译后又现编的同一材质、同一材质现编的多条、阴影材质的多条。
 */
function describePipelineDiffs(records: PipelineRecord[]): string[] {
  const lines: string[] = []
  const live = records.filter(record => !record.precompiled)
  const pre = records.filter(record => record.precompiled)
  for (const record of pre) {
    const twin = live.find(item => item.id === record.id && item.target === record.target)
    if (!twin) continue
    lines.push(compareRecords('预编译(甲)与现编译(乙)对不上', record, twin))
    break
  }
  const groups = new Map<string, PipelineRecord[]>()
  for (const record of live) {
    const key = `${record.id}|${record.target}`
    groups.set(key, [...(groups.get(key) ?? []), record])
  }
  const ranked = [...groups.values()].filter(group => group.length > 1).sort((a, b) => b.length - a.length)
  const shadow = ranked.find(group => group[0].material === 'ShadowMaterial')
  const other = ranked.find(group => group[0].material !== 'ShadowMaterial')
  if (other) lines.push(compareRecords(`同一材质现编 ${other.length} 条，取前两条`, other[0], other[1]))
  if (shadow) lines.push(compareRecords(`阴影现编 ${shadow.length} 条，取前两条`, shadow[0], shadow[1]))
  return lines
}

/** 等主视口的着色器预编译结束（最多等 20 秒）。要在发出 t3d:warm-complete 之前调用。 */
function waitForPrecompile(): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      window.removeEventListener('t3d:precompile-done', done)
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(done, 20000)
    window.addEventListener('t3d:precompile-done', done)
  })
}

/** 等主视口渲染器初始化完成，返回它就绪的时刻（最多等 10 秒）。 */
function waitForRenderer(): Promise<number> {
  const started = performance.now()
  return new Promise(resolve => {
    const step = () => {
      const readyAt = rendererReadyAt()
      if (readyAt !== null || performance.now() - started > 10000) {
        resolve(readyAt ?? performance.now())
        return
      }
      requestAnimationFrame(step)
    }
    step()
  })
}

/**
 * 等到连续 3 帧都在 34ms 以内（最多等 20 秒），用来量资源到齐、渲染器就绪之后的着色器编译与贴图上传卡顿。
 * 返回总时长、期间的帧数、其中超过 34ms 的帧数、最长一帧的时长。
 */
function waitForSmoothFrames(): Promise<{ total: number, frames: number, slow: number, worst: number }> {
  const started = performance.now()
  return new Promise(resolve => {
    let previous = started
    let smooth = 0
    let frames = 0
    let slow = 0
    let worst = 0
    const step = () => {
      const now = performance.now()
      const frame = now - previous
      previous = now
      frames += 1
      worst = Math.max(worst, frame)
      if (frame <= 34) {
        smooth += 1
      } else {
        smooth = 0
        slow += 1
      }
      if (smooth >= 3 || now - started > 20000) {
        resolve({ total: now - started, frames, slow, worst })
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

function stripRedundantThumb(meta: AssetMeta): AssetMeta {
  if ((meta.kind === 'animation' || meta.kind === 'audio' || meta.kind === 'environment' || meta.kind === 'document') && meta.thumb) {
    void patchAssetMeta(meta.id, { thumb: null }).catch(() => undefined)
    return { ...meta, thumb: null }
  }
  return meta
}

function needsMetadataDiscovery(meta: AssetMeta): boolean {
  // 缩略图为 null 才算没出过；空串表示出图失败过，不再每次打开都重试
  if (meta.kind === 'model') return !meta.artifactReady || meta.thumb == null
  if (meta.kind === 'animation') return !meta.artifactReady || !meta.clipCatalog?.length
  if (meta.kind === 'texture') return false
  return false
}

function discoveryReason(meta: AssetMeta): string {
  if (!meta.artifactReady) return '缺成品'
  if (meta.kind === 'animation') return '缺片段目录'
  return '缺缩略图'
}

function createFileAssetFromMeta(meta: AssetMeta): FileAsset {
  return {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    fileName: meta.fileName,
    hash: meta.hash,
    thumb: meta.thumb,
    url: '',
    ...(meta.humanoidAvatar ? { humanoidAvatar: meta.humanoidAvatar } : {}),
    ...(meta.humanoidRetarget ? { humanoidRetarget: meta.humanoidRetarget } : {}),
    ...(meta.clipCatalog ? { clipCatalog: meta.clipCatalog } : {}),
    ...(typeof meta.importScale === 'number' ? { importScale: meta.importScale } : {}),
    ...(meta.sockets?.length ? { sockets: meta.sockets } : {}),
    ...(meta.materialHint ? { materialHint: meta.materialHint } : {}),
  }
}

async function materialize(meta: AssetMeta, readBytesNow = true, target?: FileAsset): Promise<FileAsset> {
  const asset = target ?? createFileAssetFromMeta(meta)
  if (!readBytesNow) return asset
  // 模型、动画、贴图、环境贴图均由各自的加载器在缓存未命中时按需调用 ensureAssetUrl，启动时绝不预读源文件
  if (meta.kind === 'model' || meta.kind === 'animation' || meta.kind === 'texture' || meta.kind === 'environment') {
    return asset
  }
  const bytes = await readFileBytes(meta.id)
  if (!bytes) throw new Error('缓存里没有源文件')
  asset.url = URL.createObjectURL(new Blob([bytes]))
  useAssetStore.getState().patch(asset.id, { url: asset.url })
  return asset
}

function rank(meta: AssetMeta, referenced: Set<string>): number {
  const used = referenced.has(meta.id) ? 0 : 2
  const ready = meta.artifactReady ? 0 : 1
  return used + ready
}

/**
 * ids：当前场景用到的全部资源；unityMrIds：被当作 Unity 金属光滑图使用的贴图；
 * plainIds：以普通方式（颜色、法线等，或非 Unity 着色器的金属粗糙度）使用的贴图。
 * 只在 unityMrIds 里、不在 plainIds 里的贴图，打开时只需要重排后的成品，不需要原图。
 */
function referencedAssetIds(document: ProjectDocument | null): { ids: Set<string>, unityMrIds: Set<string>, plainIds: Set<string> } {
  const ids = new Set<string>()
  const unityMrIds = new Set<string>()
  const plainIds = new Set<string>()
  if (!document) return { ids, unityMrIds, plainIds }
  collectNodeAssets(document.nodes, ids, unityMrIds, plainIds)
  if (document.picture.envAssetId) ids.add(document.picture.envAssetId)

  // 只展开当前激活场景用到的特效、UI 与材质球，不预热未上场的其他材质/预制体/非激活场景
  for (const record of document.library) {
    if (record.kind === 'effect' && ids.has(record.id) && record.materialAssetId) {
      ids.add(record.materialAssetId)
    }
    if (record.kind === 'ui' && ids.has(record.id)) {
      collectUiImageIds(record.document.root, ids)
    }
  }
  for (const record of document.library) {
    if (record.kind === 'material' && ids.has(record.id)) {
      collectMapAssets(record.slot, ids, unityMrIds, plainIds)
    }
  }
  return { ids, unityMrIds, plainIds }
}

function collectMapAssets(
  source: { shader?: string } & Partial<Record<(typeof MAP_KEYS)[number], string | null>>,
  ids: Set<string>,
  unityMrIds?: Set<string>,
  plainIds?: Set<string>,
) {
  for (const key of MAP_KEYS) {
    const value = source[key]
    if (!value) continue
    ids.add(value)
    if (key === 'metallicRoughnessAssetId' && source.shader === 'unity-standard') unityMrIds?.add(value)
    else plainIds?.add(value)
  }
}

function collectNodeAssets(nodes: Record<string, SceneNode>, ids: Set<string>, unityMrIds?: Set<string>, plainIds?: Set<string>) {
  for (const node of Object.values(nodes)) {
    if (node.assetId) ids.add(node.assetId)
    if (node.clipAssetId) ids.add(node.clipAssetId)
    if (node.overlayAssetId) ids.add(node.overlayAssetId)
    if (node.animator) {
      for (const state of node.animator.states) {
        if (state.clipAssetId) ids.add(state.clipAssetId)
      }
    }
    if (node.materialAssetId) ids.add(node.materialAssetId)
    if (node.effect?.assetId) ids.add(node.effect.assetId)
    if (node.effect?.materialAssetId) ids.add(node.effect.materialAssetId)
    if (node.screen?.documentId) ids.add(node.screen.documentId)
    if (node.partOverrides) {
      for (const override of Object.values(node.partOverrides)) {
        if (override.materialAssetId) ids.add(override.materialAssetId)
      }
    }
    collectMapAssets(node, ids, unityMrIds, plainIds)
    for (const slot of node.slots) {
      if (slot.materialAssetId) ids.add(slot.materialAssetId)
      collectMapAssets(slot, ids, unityMrIds, plainIds)
    }
  }
}

function bindDirectoryLayout() {
  if (layoutBound) return
  layoutBound = true
  const current = useAssetStore.getState()
  layoutPrevious = { folders: current.folders, assetDirs: current.assetDirs }
  useAssetStore.subscribe(state => {
    const prev = layoutPrevious
    layoutPrevious = { folders: state.folders, assetDirs: state.assetDirs }
    if (layoutSuspended > 0 || !isDirectoryProject()) return
    const folders = state.folders.filter(folder => !prev.folders.includes(folder))
    const removed = prev.folders.filter(folder => !state.folders.includes(folder)).sort((a, b) => b.length - a.length)
    const moves: Array<{ id: string, dir: string }> = []
    for (const asset of Object.values(state.assets)) {
      if (!('fileName' in asset)) continue
      const record = assetRecord(asset.id)
      if (!record) continue
      const dir = assetDirectory(asset.id, state.assetDirs)
      if (parentProjectPath(record.relativePath) !== dir) moves.push({ id: asset.id, dir })
    }
    const codeMoves: Array<{ kind: 'script' | 'shader', id: string, dir: string }> = []
    for (const code of Object.values(useCodeAssetStore.getState().assets)) {
      const dirKey = codeAssetDirKey(code.kind, code.id)
      if (!(dirKey in state.assetDirs)) continue
      const dir = assetDirectory(dirKey, state.assetDirs)
      if (code.relativePath !== `${dir}/${codeAssetFileName(code.kind, code.id)}`) {
        codeMoves.push({ kind: code.kind, id: code.id, dir })
      }
    }
    if (folders.length === 0 && removed.length === 0 && moves.length === 0 && codeMoves.length === 0) return
    layoutChain = layoutChain.then(async () => {
      for (const folder of folders) await ensureDirectory(folder)
      for (const move of moves) await moveAssetFile(move.id, move.dir)
      for (const move of codeMoves) await moveCodeAssetFile(move.kind, move.id, move.dir)
      for (const folder of removed) await removeEmptyDirectory(folder)
    }).catch(error => {
      console.warn('[project] 目录同步失败', error)
    })
  })
}

function suspendLayout() {
  layoutSuspended += 1
}

async function resumeLayout() {
  layoutSuspended = Math.max(0, layoutSuspended - 1)
  if (layoutSuspended > 0 || !isDirectoryProject()) return
  for (const folder of useAssetStore.getState().folders) await ensureDirectory(folder)
  const state = useAssetStore.getState()
  for (const asset of Object.values(state.assets)) {
    if (!('fileName' in asset)) continue
    const record = assetRecord(asset.id)
    if (!record) continue
    const dir = assetDirectory(asset.id, state.assetDirs)
    if (parentProjectPath(record.relativePath) === dir) continue
    await moveAssetFile(asset.id, dir)
  }
  for (const code of Object.values(useCodeAssetStore.getState().assets)) {
    const dirKey = codeAssetDirKey(code.kind, code.id)
    if (!(dirKey in state.assetDirs)) continue
    const dir = assetDirectory(dirKey, state.assetDirs)
    if (code.relativePath === `${dir}/${codeAssetFileName(code.kind, code.id)}`) continue
    await moveCodeAssetFile(code.kind, code.id, dir)
  }
}

async function readDirectoryFile(source: FileSystemDirectoryHandle | string): Promise<{ name: string, document: ProjectDocument, assets: DirectoryAssetRecord[] } | 'missing' | 'invalid'> {
  const text = await readProjectText(source)
  if (!text) return 'missing'
  try {
    const parsed = JSON.parse(text) as { schemaVersion?: number, name?: string, document?: ProjectDocument, assets?: unknown }
    if (parsed.schemaVersion !== 1) return 'invalid'
    const document = validDocument(parsed.document ?? null)
    if (!document) return 'invalid'
    const fallback = typeof source === 'string' ? directoryBaseName(source) : source.name
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : fallback
    return { name, document, assets: recordsFromUnknown(parsed.assets) }
  } catch {
    return 'invalid'
  }
}

function replaceSession(document: ProjectDocument) {
  clearCodeAssetsSession()
  for (const asset of Object.values(useAssetStore.getState().assets)) {
    releaseRuntimeAsset(asset.id, 'url' in asset ? asset.url : '')
  }
  const assets: Record<string, MaterialAsset | PrefabAsset | SceneAsset | EffectAsset | UiAsset> = {}
  for (const record of document.library) assets[record.id] = record
  const placed = applyWorkspace(document)
  useAssetStore.getState().loadSession(
    assets,
    document.folders ?? [],
    document.assetDirs ?? {},
    placed?.browseDir,
    placed?.expanded,
  )
  useEditorStore.getState().loadDocument(document)
}

async function collectSources(): Promise<CachedFile[]> {
  const byId = new Map<string, CachedFile>()
  if (isDirectoryProject()) {
    for (const item of await snapshotSources()) {
      byId.set(item.meta.id, {
        id: item.meta.id,
        name: item.meta.name,
        kind: item.meta.kind,
        fileName: item.meta.fileName,
        hash: item.meta.hash,
        thumb: item.meta.thumb,
        bytes: item.bytes,
      })
    }
  } else {
    for (const file of await readIdbFiles()) byId.set(file.id, file)
  }
  for (const asset of Object.values(useAssetStore.getState().assets)) {
    if (!('fileName' in asset)) continue
    const previous = byId.get(asset.id)
    const bytes = await bytesOf(asset.url, previous?.bytes ?? null)
    if (!bytes) continue
    byId.set(asset.id, {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      fileName: asset.fileName,
      hash: asset.hash || previous?.hash || await sha256(bytes),
      thumb: asset.thumb,
      bytes,
    })
  }
  for (const file of byId.values()) {
    if (useAssetStore.getState().assets[file.id]) continue
    useAssetStore.getState().add({
      id: file.id,
      name: file.name,
      kind: file.kind,
      url: URL.createObjectURL(new Blob([file.bytes])),
      fileName: file.fileName,
      hash: file.hash,
      thumb: file.thumb,
    })
    useAssetStore.getState().place(file.id, ASSETS_ROOT)
  }
  return [...byId.values()]
}

async function collectArtifacts(files: CachedFile[]): Promise<Map<string, ArrayBuffer>> {
  const artifacts = new Map<string, ArrayBuffer>()
  const fromDirectory = isDirectoryProject()
  for (const file of files) {
    if ((file.kind !== 'model' && file.kind !== 'animation') || !file.hash || artifacts.has(file.hash)) continue
    const glb = fromDirectory ? await readArtifact(artifactKey(file.hash)) : await readIdbArtifact(file.hash)
    if (glb) artifacts.set(file.hash, glb)
  }
  return artifacts
}

function metaForSource(file: CachedFile, artifactReady: boolean): AssetMeta {
  const asset = useAssetStore.getState().assets[file.id]
  const base: AssetMeta = {
    id: file.id,
    name: file.name,
    kind: file.kind,
    fileName: file.fileName,
    hash: file.hash,
    thumb: file.thumb,
    byteLength: file.bytes.byteLength,
    artifactReady,
  }
  if (!asset || !('fileName' in asset)) return base
  return {
    ...base,
    name: asset.name,
    kind: asset.kind,
    fileName: asset.fileName,
    hash: asset.hash || file.hash,
    thumb: asset.thumb,
    ...(asset.humanoidAvatar !== undefined ? { humanoidAvatar: asset.humanoidAvatar } : {}),
    ...(asset.humanoidRetarget !== undefined ? { humanoidRetarget: asset.humanoidRetarget } : {}),
    ...(asset.clipCatalog !== undefined ? { clipCatalog: asset.clipCatalog } : {}),
    ...(typeof asset.importScale === 'number' ? { importScale: asset.importScale } : {}),
    ...(asset.sockets !== undefined ? { sockets: asset.sockets } : {}),
    ...(asset.materialHint ? { materialHint: asset.materialHint } : {}),
  }
}

async function reconcileLooseAssets(): Promise<AssetMeta[]> {
  const paths = await listAssetFiles()
  const onDisk = new Set(paths)
  const adopted: AssetMeta[] = []
  const byHash = new Map(assetRecords().filter(record => record.hash).map(record => [record.hash, record]))
  for (const relativePath of paths) {
    if (assetRecords().some(record => record.relativePath === relativePath)) continue
    const fileName = relativePath.split('/').pop() ?? ''
    const kind = fileKindFor(fileName)
    if (!kind) continue
    const bytes = await readProjectPath(relativePath)
    if (!bytes) continue
    const hash = await sha256(bytes)
    const existing = byHash.get(hash)
    if (existing) {
      if (!onDisk.has(existing.relativePath)) {
        retargetAsset(existing.id, relativePath)
        useAssetStore.getState().place(existing.id, parentProjectPath(relativePath))
      }
      continue
    }
    const id = crypto.randomUUID()
    const record: DirectoryAssetRecord = {
      id,
      name: assetName(fileName),
      kind,
      fileName,
      hash,
      thumb: null,
      byteLength: bytes.byteLength,
      artifactReady: false,
      relativePath,
    }
    adoptAsset(record)
    useAssetStore.getState().place(id, parentProjectPath(relativePath))
    adopted.push(record)
    byHash.set(hash, record)
  }
  if (adopted.length > 0) useEditorStore.getState().log('info', translate('log.projectLoose', { count: adopted.length }))
  return adopted
}

async function bytesOf(url: string, fallback: ArrayBuffer | null): Promise<ArrayBuffer | null> {
  if (url) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.arrayBuffer()
    } catch {
      // 浏览器对象地址失效时使用已保存的字节。
    }
  }
  return fallback
}

function releaseRuntimeAsset(id: string, url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  releaseModel(id)
  releaseTexture(id)
}

function nextWarmToken(): number {
  warmToken += 1
  return warmToken
}

function warmCurrent(token: number): boolean {
  return token === warmToken
}

function withDefaultFolders(folders: string[]): string[] {
  return [...new Set([...folders, ...DEFAULT_ASSET_FOLDERS].map(folder => normalizeDir(folder)))].filter(folder => folder !== ASSETS_ROOT)
}

function mergeFolders(folders: string[], diskFolders: string[]): string[] {
  return [...new Set([...folders, ...diskFolders].map(folder => normalizeDir(folder)))].filter(folder => folder !== ASSETS_ROOT)
}

async function salvageProject(error: unknown) {
  console.warn('[project]', error)
  if (isDirectoryProject()) await saveProjectNow().catch(saveError => console.warn('[project] 补存失败', saveError))
  useEditorStore.getState().log('error', failureText(error))
}

function failureText(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'browser') return translate('log.projectBrowser')
  const message = error instanceof Error ? error.message : String(error)
  return translate('log.projectFailed', { message })
}

function cleanAssetDirs(value: ProjectDocument['assetDirs']): Record<string, string> {
  if (!value) return {}
  const dirs: Record<string, string> = {}
  for (const [id, dir] of Object.entries(value)) {
    if (typeof dir === 'string') dirs[id] = dir
  }
  return dirs
}

function validDocument(document: ProjectDocument | null): ProjectDocument | null {
  if (!document || (document.schemaVersion !== 1 && document.schemaVersion !== 2) || !document.nodes) return null
  const library = Array.isArray(document.library) ? document.library : []
  const scenes = library.filter((asset): asset is SceneAsset => asset.kind === 'scene')
  const activeSceneId = document.activeSceneId && scenes.some(scene => scene.id === document.activeSceneId)
    ? document.activeSceneId
    : scenes[0]?.id ?? ''
  return {
    schemaVersion: 2,
    savedAt: document.savedAt || Date.now(),
    activeSceneId,
    nodes: document.nodes,
    selection: Array.isArray(document.selection) ? document.selection : [],
    picture: normalizePicture(document.picture),
    navMeshes: document.navMeshes,
    library,
    folders: Array.isArray(document.folders) ? document.folders.filter(item => typeof item === 'string') : [],
    assetDirs: cleanAssetDirs(document.assetDirs),
    capabilities: normalizeCapabilities(document.capabilities),
    gameplayPacks: [...resolveEnabledPackIds(document.gameplayPacks)],
    gameDatabase: ensureGameDatabase(document.gameDatabase, document.gameplayPacks),
    tags: ensureTags(document.tags),
    layers: ensureLayers(document.layers),
    editorCullingMask: typeof document.editorCullingMask === 'number' ? document.editorCullingMask >>> 0 : ALL_LAYERS_VISIBLE_MASK,
    physicsCollisionMatrixEnabled: document.physicsCollisionMatrixEnabled === true,
    physicsCollisionRowMasks: document.physicsCollisionRowMasks ?? {},
    workspace: document.workspace ? cleanWorkspace(document.workspace) : undefined,
  }
}

let projectSessionLive = false

function currentWorkspace(): ProjectWorkspace {
  const catalog = useAssetStore.getState()
  const agent = useAgentStore.getState()
  return {
    assetExpanded: Object.entries(catalog.expanded).filter(([, open]) => open).map(([path]) => path),
    assetBrowseDir: catalog.browseDir,
    inspectedAssetId: useEditorStore.getState().inspectedAssetId,
    inspector: snapshotInspectorEntries(),
    aiPanelOpen: agent.panelOpen,
    aiPanelScrollTop: agent.panelScrollTop,
  }
}

function cleanWorkspace(value: ProjectWorkspace): ProjectWorkspace {
  const assetExpanded = Array.isArray(value.assetExpanded) ? value.assetExpanded.filter(item => typeof item === 'string') : []
  const inspector: NonNullable<ProjectWorkspace['inspector']> = {}
  if (value.inspector && typeof value.inspector === 'object') {
    for (const [subject, entry] of Object.entries(value.inspector)) {
      if (!entry || typeof entry !== 'object' || typeof entry.scroll !== 'number' || !Number.isFinite(entry.scroll)) continue
      const open: Record<string, boolean> = {}
      if (entry.open && typeof entry.open === 'object') {
        for (const [card, flag] of Object.entries(entry.open)) {
          if (typeof flag === 'boolean') open[card] = flag
        }
      }
      inspector[subject] = {
        scroll: Math.max(0, entry.scroll),
        open,
        slot: typeof entry.slot === 'number' ? entry.slot : null,
      }
    }
  }
  return {
    assetExpanded,
    assetBrowseDir: typeof value.assetBrowseDir === 'string' ? normalizeDir(value.assetBrowseDir) : ASSETS_ROOT,
    inspectedAssetId: typeof value.inspectedAssetId === 'string' ? value.inspectedAssetId : null,
    inspector,
    ...(typeof value.aiPanelOpen === 'boolean' ? { aiPanelOpen: value.aiPanelOpen } : {}),
    ...(typeof value.aiPanelScrollTop === 'number' && Number.isFinite(value.aiPanelScrollTop)
      ? { aiPanelScrollTop: Math.max(0, Math.round(value.aiPanelScrollTop)) }
      : {}),
  }
}

function expandedRecord(paths: string[]): Record<string, boolean> {
  const expanded: Record<string, boolean> = {}
  for (const path of paths) {
    if (path.trim()) expanded[normalizeDir(path)] = true
  }
  if (Object.keys(expanded).length === 0) expanded[ASSETS_ROOT] = true
  return expanded
}

/** 有存档就恢复；第一次打开旧工程先留着本机滚动，换工程则清空，避免串到别的工程。 */
function applyWorkspace(document: ProjectDocument): { browseDir: string, expanded: Record<string, boolean> } | null {
  const fresh = !projectSessionLive
  projectSessionLive = true
  if (!document.workspace) {
    if (!fresh) {
      restoreInspectorEntries({})
      useAgentStore.getState().restorePanelWorkspace(false, 0)
    }
    return null
  }
  const workspace = cleanWorkspace(document.workspace)
  restoreInspectorEntries(workspace.inspector)
  useAgentStore.getState().restorePanelWorkspace(
    Boolean(workspace.aiPanelOpen),
    workspace.aiPanelScrollTop ?? 0,
  )
  return {
    browseDir: workspace.assetBrowseDir || ASSETS_ROOT,
    expanded: expandedRecord(workspace.assetExpanded ?? []),
  }
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  if (items.length === 0) return
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      await worker(items[current])
    }
  })
  await Promise.all(runners)
}
