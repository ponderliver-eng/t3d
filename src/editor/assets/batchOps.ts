import {
  codeAssetDirKey,
  deleteCodeAsset,
  normalizeCodeAssetId,
  saveAndCompileCodeAsset,
  useCodeAssetStore,
  type CodeAssetKind,
  type CodeAssetRecord,
} from '../../core/codeAssets/workspace'
import { translate } from '../i18n'
import { useEditorStore } from '../scene/store'
import type { PbrSlot, SceneNode } from '../scene/types'
import {
  forgetFile,
  hasOriginalTextureBackup,
  readFileBytes,
  readOriginalTextureBackup,
  rememberFile,
  writeOriginalTextureBackup,
  type CachedFile,
} from './cache'
import {
  ASSETS_ROOT,
  dirName,
  isWithin,
  joinDir,
  normalizeDir,
  parentDir,
  relocateDir,
  uniqueFolderName,
} from './folders'
import { referencedBy } from './import'
import {
  assetDirectory,
  ensureScenesLoaded,
  useAssetStore,
  type FileAsset,
  type ProjectAsset,
} from './library'
import { releaseModel } from './models'
import {
  assetItemKey,
  codeItemKey,
  dirItemKey,
  parseProjectItemKey,
  useProjectSelectionStore,
  type ProjectItemKey,
} from './projectSelection'
import { releaseTexture } from './textures'

export interface NormalizedProjectSelection {
  dirs: string[]
  assetIds: string[]
  codes: Array<{ kind: CodeAssetKind; id: string }>
}

/**
 * 父子选区归一化：
 * 1. 若同时选中了父目录与子目录，只保留最顶层目录；
 * 2. 剔除所有已经位于被选中目录子树内的散落资产和代码资产。
 */
export function normalizeTopLevelSelection(keys: readonly ProjectItemKey[]): NormalizedProjectSelection {
  const assetState = useAssetStore.getState()
  const codeState = useCodeAssetStore.getState()
  const rawDirs: string[] = []
  const rawAssets: string[] = []
  const rawCodes: Array<{ kind: CodeAssetKind; id: string }> = []
  const seenDirs = new Set<string>()
  const seenAssets = new Set<string>()
  const seenCodes = new Set<string>()

  for (const key of keys) {
    const parsed = parseProjectItemKey(key)
    if (!parsed) continue
    if (parsed.type === 'dir') {
      if (parsed.path === ASSETS_ROOT || seenDirs.has(parsed.path)) continue
      seenDirs.add(parsed.path)
      rawDirs.push(parsed.path)
    } else if (parsed.type === 'asset') {
      if (!assetState.assets[parsed.id] || seenAssets.has(parsed.id)) continue
      seenAssets.add(parsed.id)
      rawAssets.push(parsed.id)
    } else {
      const record = codeState.assets[parsed.id]
      if (!record || seenCodes.has(parsed.id)) continue
      seenCodes.add(parsed.id)
      rawCodes.push({ kind: record.kind, id: record.id })
    }
  }

  const topDirs = rawDirs.filter(dir => !rawDirs.some(other => other !== dir && isWithin(dir, other)))
  const insideSelectedDir = (dir: string) => topDirs.some(parent => isWithin(dir, parent))

  const assetIds = rawAssets.filter(id => !insideSelectedDir(assetDirectory(id, assetState.assetDirs)))
  const codes = rawCodes.filter(item => {
    const dir = assetDirectory(codeAssetDirKey(item.kind, item.id), assetState.assetDirs)
    return !insideSelectedDir(dir)
  })

  return { dirs: topDirs, assetIds, codes }
}

/**
 * 校验选中条目是否允许移动到 `targetDir`：
 * - 任何被选中的目录都不能移入自身或其后代目录；
 * - 至少有 1 项的实际所在目录会发生改变。
 */
export function canMoveProjectItems(keys: readonly ProjectItemKey[], targetDir: string): boolean {
  const target = normalizeDir(targetDir)
  const norm = normalizeTopLevelSelection(keys)
  if (norm.dirs.length === 0 && norm.assetIds.length === 0 && norm.codes.length === 0) return false

  for (const dir of norm.dirs) {
    if (dir === ASSETS_ROOT || isWithin(target, dir)) return false
  }

  const { assetDirs } = useAssetStore.getState()
  const anyDirMoves = norm.dirs.some(dir => parentDir(dir) !== target)
  const anyAssetMoves = norm.assetIds.some(id => assetDirectory(id, assetDirs) !== target)
  const anyCodeMoves = norm.codes.some(c => assetDirectory(codeAssetDirKey(c.kind, c.id), assetDirs) !== target)
  return anyDirMoves || anyAssetMoves || anyCodeMoves
}

/**
 * 原子批量移动目录、普通资产和代码资产到 `targetDir`。
 * 底层 `useAssetStore` 只触发一次订阅回调，`project.ts` 顺序同步磁盘移动。
 */
export function moveProjectItems(keys: readonly ProjectItemKey[], targetDir: string): ProjectItemKey[] {
  const target = normalizeDir(targetDir)
  if (!canMoveProjectItems(keys, target)) return []

  const norm = normalizeTopLevelSelection(keys)
  const dirMoves: Array<{ from: string; to: string }> = []
  const nextKeys: ProjectItemKey[] = []

  for (const from of norm.dirs) {
    const to = joinDir(target, dirName(from))
    if (from !== to) dirMoves.push({ from, to })
    nextKeys.push(dirItemKey(to))
  }

  const itemMoves: Record<string, string> = {}
  for (const id of norm.assetIds) {
    itemMoves[id] = target
    nextKeys.push(assetItemKey(id))
  }
  for (const code of norm.codes) {
    itemMoves[codeAssetDirKey(code.kind, code.id)] = target
    nextKeys.push(codeItemKey(code.kind, code.id))
  }

  useAssetStore.getState().relocateBatch(
    dirMoves,
    itemMoves,
    target === ASSETS_ROOT ? [] : [target],
  )
  useProjectSelectionStore.getState().setSelectedKeys(nextKeys)
  return nextKeys
}

function allocateNameFromSet(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base)
    return base
  }
  let index = 2
  while (taken.has(`${base} ${index}`)) index += 1
  const next = `${base} ${index}`
  taken.add(next)
  return next
}

function allocateCodeIdFromSet(kind: CodeAssetKind, baseId: string, taken: Set<string>): string {
  const clean = normalizeCodeAssetId(kind, baseId)
  if (!taken.has(clean)) {
    taken.add(clean)
    return clean
  }
  let index = 2
  while (taken.has(`${clean}_${index}`)) index += 1
  const next = `${clean}_${index}`
  taken.add(next)
  return next
}

function remapSlotRefs(slot: PbrSlot, idMap: ReadonlyMap<string, string>): PbrSlot {
  const mapRef = (id?: string | null) => (id && idMap.has(id) ? idMap.get(id)! : (id ?? null))
  return {
    ...slot,
    ...(slot.materialAssetId !== undefined ? { materialAssetId: mapRef(slot.materialAssetId) } : {}),
    mapAssetId: mapRef(slot.mapAssetId),
    ...(slot.normalAssetId !== undefined ? { normalAssetId: mapRef(slot.normalAssetId) } : {}),
    ...(slot.metallicRoughnessAssetId !== undefined ? { metallicRoughnessAssetId: mapRef(slot.metallicRoughnessAssetId) } : {}),
    ...(slot.roughnessAssetId !== undefined ? { roughnessAssetId: mapRef(slot.roughnessAssetId) } : {}),
    ...(slot.metalnessAssetId !== undefined ? { metalnessAssetId: mapRef(slot.metalnessAssetId) } : {}),
    ...(slot.emissiveAssetId !== undefined ? { emissiveAssetId: mapRef(slot.emissiveAssetId) } : {}),
    ...(slot.aoAssetId !== undefined ? { aoAssetId: mapRef(slot.aoAssetId) } : {}),
  }
}

function remapNodeRefs(node: SceneNode, idMap: ReadonlyMap<string, string>) {
  const mapRef = (id?: string | null) => (id && idMap.has(id) ? idMap.get(id)! : (id ?? null))
  if (node.assetId && idMap.has(node.assetId)) node.assetId = idMap.get(node.assetId)!
  if (node.prefabAssetId && idMap.has(node.prefabAssetId)) node.prefabAssetId = idMap.get(node.prefabAssetId)!
  if (node.nestedPrefabId && idMap.has(node.nestedPrefabId)) node.nestedPrefabId = idMap.get(node.nestedPrefabId)!
  if (node.clipAssetId && idMap.has(node.clipAssetId)) node.clipAssetId = idMap.get(node.clipAssetId)!
  if (node.overlayAssetId && idMap.has(node.overlayAssetId)) node.overlayAssetId = idMap.get(node.overlayAssetId)!
  if (node.materialAssetId && idMap.has(node.materialAssetId)) node.materialAssetId = idMap.get(node.materialAssetId)!
  node.mapAssetId = mapRef(node.mapAssetId)
  if (node.normalAssetId !== undefined) node.normalAssetId = mapRef(node.normalAssetId)
  if (node.metallicRoughnessAssetId !== undefined) node.metallicRoughnessAssetId = mapRef(node.metallicRoughnessAssetId)
  if (node.roughnessAssetId !== undefined) node.roughnessAssetId = mapRef(node.roughnessAssetId)
  if (node.metalnessAssetId !== undefined) node.metalnessAssetId = mapRef(node.metalnessAssetId)
  if (node.emissiveAssetId !== undefined) node.emissiveAssetId = mapRef(node.emissiveAssetId)
  if (node.aoAssetId !== undefined) node.aoAssetId = mapRef(node.aoAssetId)
  if (node.slots?.length) {
    node.slots = node.slots.map(slot => remapSlotRefs(slot, idMap))
  }
  if (node.animator?.states) {
    for (const st of node.animator.states) {
      if (st.clipAssetId && idMap.has(st.clipAssetId)) st.clipAssetId = idMap.get(st.clipAssetId)!
    }
  }
  if (node.effect) {
    if (node.effect.assetId && idMap.has(node.effect.assetId)) node.effect.assetId = idMap.get(node.effect.assetId)!
    if (node.effect.materialAssetId && idMap.has(node.effect.materialAssetId)) {
      node.effect.materialAssetId = idMap.get(node.effect.materialAssetId)!
    }
  }
  if (node.screen?.documentId && idMap.has(node.screen.documentId)) {
    node.screen.documentId = idMap.get(node.screen.documentId)!
  }
}

async function readSourceBytesForDuplicate(asset: FileAsset): Promise<ArrayBuffer | null> {
  const fromDisk = await readFileBytes(asset.id)
  if (fromDisk) return fromDisk
  if (asset.url) {
    try {
      const res = await fetch(asset.url)
      if (res.ok) return await res.arrayBuffer()
    } catch {
      // ignore
    }
  }
  return null
}

/**
 * 批量复制项目条目（支持普通资产、二进制文件资产、代码资产以及目录递归克隆）。
 * - `targetDir === undefined`：在各自当前目录原地创建副本（Ctrl+D / 右键创建副本）；
 * - `targetDir !== undefined`：粘贴副本到指定目标目录（Ctrl+C -> Ctrl+V）。
 */
export async function duplicateProjectItems(
  keys: readonly ProjectItemKey[],
  targetDir?: string,
): Promise<ProjectItemKey[]> {
  const norm = normalizeTopLevelSelection(keys)
  if (norm.dirs.length === 0 && norm.assetIds.length === 0 && norm.codes.length === 0) return []

  // 先对当前目录与资产做一次快照，防止将文件夹粘贴进自身子目录时发生无限递归
  const initialStore = useAssetStore.getState()
  const initialCodes = Object.values(useCodeAssetStore.getState().assets)
  const snapshotFolders = [...initialStore.folders.map(normalizeDir)]
  const snapshotAssetDirs = { ...initialStore.assetDirs }

  // 收集需要预加载的壳场景（含目录内的场景）
  const candidateAssets = Object.values(initialStore.assets).filter(asset => {
    if (norm.assetIds.includes(asset.id)) return true
    const dir = assetDirectory(asset.id, snapshotAssetDirs)
    return norm.dirs.some(root => isWithin(dir, root))
  })
  const unloadedSceneIds = candidateAssets
    .filter(a => a.kind === 'scene' && a.unloaded)
    .map(a => a.id)
  if (unloadedSceneIds.length > 0) {
    await ensureScenesLoaded(unloadedSceneIds)
  }

  const latestAssets = useAssetStore.getState().assets
  const copySuffix = translate('project.copySuffix')
  const explicitTarget = targetDir !== undefined ? normalizeDir(targetDir) : undefined

  const workingFolders = [...snapshotFolders]
  const workingAssetDirs = { ...snapshotAssetDirs }
  const createdFolders: string[] = []
  const createdTopKeys: ProjectItemKey[] = []

  // 1. 规划目录映射（支持空子目录与多层子树）
  const dirMappings: Array<{ from: string; to: string }> = []
  for (const sourceDir of norm.dirs) {
    const destParent = explicitTarget ?? (parentDir(sourceDir) ?? ASSETS_ROOT)
    const sameParent = destParent === (parentDir(sourceDir) ?? ASSETS_ROOT)
    const desiredName = sameParent ? `${dirName(sourceDir)} ${copySuffix}` : dirName(sourceDir)
    const folderName = uniqueFolderName(destParent, workingFolders, workingAssetDirs, desiredName)
    const destDir = joinDir(destParent, folderName)
    dirMappings.push({ from: sourceDir, to: destDir })
    workingFolders.push(destDir)
    createdFolders.push(destDir)
    createdTopKeys.push(dirItemKey(destDir))

    // 收集原目录子树下的所有显式/隐式子目录
    const subDirs = new Set<string>()
    for (const f of snapshotFolders) {
      if (f !== sourceDir && isWithin(f, sourceDir)) subDirs.add(f)
    }
    for (const d of Object.values(snapshotAssetDirs)) {
      const nd = normalizeDir(d)
      if (nd !== sourceDir && isWithin(nd, sourceDir)) subDirs.add(nd)
    }
    for (const sub of subDirs) {
      const mappedSub = relocateDir(sub, sourceDir, destDir)
      workingFolders.push(mappedSub)
      createdFolders.push(mappedSub)
    }
  }

  // 2. 汇总所有待克隆资产任务（目录子树内资产 + 顶层散落资产）
  interface AssetCloneJob {
    source: ProjectAsset
    destDir: string
    topLevel: boolean
    addCopySuffix: boolean
  }
  const assetJobs: AssetCloneJob[] = []

  for (const mapping of dirMappings) {
    for (const asset of Object.values(latestAssets)) {
      const dir = assetDirectory(asset.id, snapshotAssetDirs)
      if (!isWithin(dir, mapping.from)) continue
      assetJobs.push({
        source: asset,
        destDir: relocateDir(dir, mapping.from, mapping.to),
        topLevel: false,
        addCopySuffix: false,
      })
    }
  }
  for (const id of norm.assetIds) {
    const asset = latestAssets[id]
    if (!asset) continue
    const srcDir = assetDirectory(id, snapshotAssetDirs)
    const destDir = explicitTarget ?? srcDir
    assetJobs.push({
      source: asset,
      destDir,
      topLevel: true,
      addCopySuffix: explicitTarget === undefined || destDir === srcDir,
    })
  }

  // 为同批次资产预分配新 ID，便于目录成套克隆时保持内部材质/预制体互引独立
  const idMap = new Map<string, string>()
  for (const job of assetJobs) {
    idMap.set(job.source.id, crypto.randomUUID())
  }

  const takenNames = new Set(Object.values(latestAssets).map(a => a.name))
  const newAssets: ProjectAsset[] = []
  const newItemDirs: Record<string, string> = {}
  const pendingFileWrites: Array<{ record: CachedFile; oldId: string; isTexture: boolean }> = []

  for (const job of assetJobs) {
    const { source, destDir, topLevel, addCopySuffix } = job
    const newId = idMap.get(source.id)!
    const baseName = addCopySuffix ? `${source.name} ${copySuffix}` : source.name
    const newName = allocateNameFromSet(baseName, takenNames)

    if ('fileName' in source) {
      const bytes = await readSourceBytesForDuplicate(source)
      if (!bytes) {
        useEditorStore.getState().log('warn', `无法读取资源源文件，跳过复制：${source.name}`)
        continue
      }
      const dot = source.fileName.lastIndexOf('.')
      const ext = dot >= 0 ? source.fileName.slice(dot) : ''
      const newFileName = ext ? `${newName}${ext}` : newName
      const keepBlob = source.kind === 'audio' || source.kind === 'document' || source.url.startsWith('blob:')
      const nextUrl = keepBlob ? URL.createObjectURL(new Blob([bytes])) : ''
      const clonedFile: FileAsset = {
        ...structuredClone({
          ...source,
          url: '',
        }),
        id: newId,
        name: newName,
        fileName: newFileName,
        url: nextUrl,
      }
      newAssets.push(clonedFile)
      newItemDirs[newId] = destDir
      pendingFileWrites.push({
        record: {
          id: newId,
          name: newName,
          kind: source.kind,
          fileName: newFileName,
          hash: source.hash,
          thumb: source.thumb,
          bytes,
        },
        oldId: source.id,
        isTexture: source.kind === 'texture',
      })
      if (topLevel) createdTopKeys.push(assetItemKey(newId))
      continue
    }

    const copy = structuredClone(source)
    copy.id = newId
    copy.name = newName
    if (copy.kind === 'material') {
      copy.slot = remapSlotRefs(copy.slot, idMap)
    } else if (copy.kind === 'effect') {
      if (copy.materialAssetId && idMap.has(copy.materialAssetId)) {
        copy.materialAssetId = idMap.get(copy.materialAssetId)!
      }
    } else if (copy.kind === 'prefab') {
      for (const node of Object.values(copy.nodes)) remapNodeRefs(node, idMap)
    } else if (copy.kind === 'scene') {
      if (copy.picture.envAssetId && idMap.has(copy.picture.envAssetId)) {
        copy.picture.envAssetId = idMap.get(copy.picture.envAssetId)!
      }
      for (const node of Object.values(copy.nodes)) remapNodeRefs(node, idMap)
    } else if (copy.kind === 'cutscene') {
      copy.sequence.id = newId
      copy.sequence.name = newName
      for (const track of copy.sequence.tracks) {
        for (const clip of track.clips ?? []) {
          if (clip.clipAssetId && idMap.has(clip.clipAssetId)) clip.clipAssetId = idMap.get(clip.clipAssetId)!
        }
      }
      for (const ev of copy.sequence.eventTrack) {
        if (ev.assetId && idMap.has(ev.assetId)) ev.assetId = idMap.get(ev.assetId)!
      }
    }
    newAssets.push(copy)
    newItemDirs[newId] = destDir
    if (topLevel) createdTopKeys.push(assetItemKey(newId))
  }

  if (explicitTarget && explicitTarget !== ASSETS_ROOT) {
    createdFolders.push(explicitTarget)
  }

  // 一次性写入 Store 目录与资产，减少重绘与自动保存抖动
  if (Object.keys(newItemDirs).length > 0 || createdFolders.length > 0) {
    useAssetStore.getState().placeMany(newItemDirs, createdFolders)
  }
  if (newAssets.length > 0) {
    useAssetStore.getState().addMany(newAssets)
  }

  // 持久化二进制文件资产副本
  for (const item of pendingFileWrites) {
    try {
      await rememberFile(item.record)
      if (item.isTexture && await hasOriginalTextureBackup(item.oldId)) {
        const orig = await readOriginalTextureBackup(item.oldId)
        if (orig) await writeOriginalTextureBackup(item.record.id, orig.fileName, orig.bytes)
      }
    } catch (error) {
      console.warn('[batchOps] 复制文件写入失败', error)
    }
  }

  // 3. 复制代码资产（目录内 + 顶层选中）
  interface CodeCloneJob {
    source: CodeAssetRecord
    destDir: string
    topLevel: boolean
  }
  const codeJobs: CodeCloneJob[] = []
  for (const mapping of dirMappings) {
    for (const code of initialCodes) {
      const dir = assetDirectory(codeAssetDirKey(code.kind, code.id), snapshotAssetDirs)
      if (!isWithin(dir, mapping.from)) continue
      codeJobs.push({
        source: code,
        destDir: relocateDir(dir, mapping.from, mapping.to),
        topLevel: false,
      })
    }
  }
  for (const item of norm.codes) {
    const code = useCodeAssetStore.getState().assets[item.id]
    if (!code) continue
    const srcDir = assetDirectory(codeAssetDirKey(code.kind, code.id), snapshotAssetDirs)
    codeJobs.push({
      source: code,
      destDir: explicitTarget ?? srcDir,
      topLevel: true,
    })
  }

  const takenCodeIds = new Set(Object.keys(useCodeAssetStore.getState().assets))
  for (const job of codeJobs) {
    const newCodeId = allocateCodeIdFromSet(job.source.kind, `${job.source.id}_copy`, takenCodeIds)
    const saved = await saveAndCompileCodeAsset(job.source.kind, newCodeId, job.source.source, job.destDir)
    if (job.topLevel) createdTopKeys.push(codeItemKey(saved.kind, saved.id))
  }

  if (createdTopKeys.length > 0) {
    useProjectSelectionStore.getState().setSelectedKeys(createdTopKeys)
  }
  return createdTopKeys
}

export interface ReferencedDeleteItem {
  key: ProjectItemKey
  name: string
  kind: string
  users: string[]
}

export interface DeleteSelectionPlan {
  topKeys: ProjectItemKey[]
  dirs: string[]
  assets: ProjectAsset[]
  codes: CodeAssetRecord[]
  referencedItems: ReferencedDeleteItem[]
  safeAssetIds: Set<string>
  safeCodeIds: Set<string>
  keptLastSceneName: string | null
}

function countExternalCodeRefs(
  item: CodeAssetRecord,
  assets: Record<string, ProjectAsset>,
  nodes: Record<string, SceneNode>,
  activeSceneId: string,
  deletingAssetIds: ReadonlySet<string>,
  activeSceneDeleting: boolean,
): number {
  let count = 0
  if (item.kind === 'shader') {
    const target = `custom:${item.id}`
    if (!activeSceneDeleting) {
      for (const node of Object.values(nodes)) {
        if (node.shader === target || node.slots?.some(slot => slot.shader === target)) count += 1
      }
    }
    for (const asset of Object.values(assets)) {
      if (deletingAssetIds.has(asset.id)) continue
      if (asset.kind === 'material' && asset.slot.shader === target) {
        count += 1
      } else if (asset.kind === 'scene' && asset.unloaded) {
        count += asset.summary?.shaders[target] ?? 0
      } else if ((asset.kind === 'scene' && asset.id !== activeSceneId) || asset.kind === 'prefab') {
        for (const node of Object.values(asset.nodes)) {
          if (node.shader === target || node.slots?.some(slot => slot.shader === target)) count += 1
        }
      }
    }
    return count
  }

  if (!activeSceneDeleting) {
    for (const node of Object.values(nodes)) {
      const projectScripts = node.gameplay?.packs?.__project__ as Record<string, unknown> | undefined
      if (projectScripts?.[item.id] !== undefined) count += 1
    }
  }
  for (const asset of Object.values(assets)) {
    if (deletingAssetIds.has(asset.id)) continue
    if (asset.kind === 'scene' && asset.unloaded) {
      count += asset.summary?.scripts[item.id] ?? 0
    } else if ((asset.kind === 'scene' && asset.id !== activeSceneId) || asset.kind === 'prefab') {
      for (const node of Object.values(asset.nodes)) {
        const projectScripts = node.gameplay?.packs?.__project__ as Record<string, unknown> | undefined
        if (projectScripts?.[item.id] !== undefined) count += 1
      }
    }
  }
  return count
}

/**
 * 删除前预扫描：
 * - 展开所有被选中的文件夹及其内部所有子目录/资产/代码资产；
 * - 自动排除同批次一起被删除的内部互引（例如同文件夹内材质引用贴图不会互相卡死）；
 * - 若包含全部场景，自动保留至少 1 个场景。
 */
export function analyzeDeleteSelection(keys: readonly ProjectItemKey[]): DeleteSelectionPlan | null {
  const norm = normalizeTopLevelSelection(keys)
  if (norm.dirs.length === 0 && norm.assetIds.length === 0 && norm.codes.length === 0) return null

  const assetStore = useAssetStore.getState()
  const codeStore = useCodeAssetStore.getState()
  const editorStore = useEditorStore.getState()

  const inSelectedDirs = (dir: string) => norm.dirs.some(root => isWithin(dir, root))

  const dirSet = new Set<string>(norm.dirs)
  for (const folder of assetStore.folders) {
    const nf = normalizeDir(folder)
    if (nf !== ASSETS_ROOT && inSelectedDirs(nf)) dirSet.add(nf)
  }
  for (const d of Object.values(assetStore.assetDirs)) {
    const nd = normalizeDir(d)
    if (nd !== ASSETS_ROOT && inSelectedDirs(nd)) dirSet.add(nd)
  }

  const assetMap = new Map<string, ProjectAsset>()
  for (const id of norm.assetIds) {
    const a = assetStore.assets[id]
    if (a) assetMap.set(id, a)
  }
  for (const asset of Object.values(assetStore.assets)) {
    if (inSelectedDirs(assetDirectory(asset.id, assetStore.assetDirs))) {
      assetMap.set(asset.id, asset)
    }
  }

  // 保护规则：工程至少保留 1 个场景
  const allScenes = Object.values(assetStore.assets).filter(a => a.kind === 'scene')
  const selectedScenes = [...assetMap.values()].filter(a => a.kind === 'scene')
  let keptLastSceneName: string | null = null
  if (selectedScenes.length > 0 && selectedScenes.length >= allScenes.length) {
    const keep = selectedScenes.find(s => s.id === editorStore.activeSceneId) ?? selectedScenes[0]!
    assetMap.delete(keep.id)
    keptLastSceneName = keep.name
  }

  const codeMap = new Map<string, CodeAssetRecord>()
  for (const item of norm.codes) {
    const c = codeStore.assets[item.id]
    if (c) codeMap.set(c.id, c)
  }
  for (const c of Object.values(codeStore.assets)) {
    const dir = assetDirectory(codeAssetDirKey(c.kind, c.id), assetStore.assetDirs)
    if (inSelectedDirs(dir)) codeMap.set(c.id, c)
  }

  const assets = [...assetMap.values()]
  const codes = [...codeMap.values()]
  const deletingAssetIds = new Set(assets.map(a => a.id))
  const activeSceneDeleting = deletingAssetIds.has(editorStore.activeSceneId)

  const referencedItems: ReferencedDeleteItem[] = []
  const safeAssetIds = new Set<string>()
  const safeCodeIds = new Set<string>()

  for (const asset of assets) {
    if (asset.kind === 'scene') {
      safeAssetIds.add(asset.id)
      continue
    }
    const externalUsers = referencedBy(asset.id).filter(u => {
      if (u.assetId) return !deletingAssetIds.has(u.assetId)
      return !activeSceneDeleting
    })
    if (externalUsers.length > 0) {
      referencedItems.push({
        key: assetItemKey(asset.id),
        name: asset.name,
        kind: asset.kind,
        users: externalUsers.map(u => u.name),
      })
    } else {
      safeAssetIds.add(asset.id)
    }
  }

  for (const code of codes) {
    const refs = countExternalCodeRefs(
      code,
      assetStore.assets,
      editorStore.nodes,
      editorStore.activeSceneId,
      deletingAssetIds,
      activeSceneDeleting,
    )
    if (refs > 0) {
      referencedItems.push({
        key: codeItemKey(code.kind, code.id),
        name: code.name,
        kind: code.kind,
        users: [`${refs} 处引用`],
      })
    } else {
      safeCodeIds.add(code.id)
    }
  }

  const topKeys: ProjectItemKey[] = [
    ...norm.dirs.map(dirItemKey),
    ...norm.assetIds.map(assetItemKey),
    ...norm.codes.map(c => codeItemKey(c.kind, c.id)),
  ]

  return {
    topKeys,
    dirs: [...dirSet],
    assets,
    codes,
    referencedItems,
    safeAssetIds,
    safeCodeIds,
    keptLastSceneName,
  }
}

function scrubDeletedReferences(deletedAssetIds: ReadonlySet<string>, deletedShaderTargets: ReadonlySet<string>, deletedScriptIds: ReadonlySet<string>) {
  if (deletedAssetIds.size === 0 && deletedShaderTargets.size === 0 && deletedScriptIds.size === 0) return
  const clearId = (id?: string | null) => (id && deletedAssetIds.has(id) ? null : (id ?? null))

  const cleanSlot = (slot: PbrSlot): PbrSlot => {
    const nextShader = slot.shader && deletedShaderTargets.has(slot.shader) ? undefined : slot.shader
    return {
      ...slot,
      shader: nextShader,
      ...(slot.materialAssetId !== undefined ? { materialAssetId: clearId(slot.materialAssetId) } : {}),
      mapAssetId: clearId(slot.mapAssetId),
      ...(slot.normalAssetId !== undefined ? { normalAssetId: clearId(slot.normalAssetId) } : {}),
      ...(slot.metallicRoughnessAssetId !== undefined ? { metallicRoughnessAssetId: clearId(slot.metallicRoughnessAssetId) } : {}),
      ...(slot.roughnessAssetId !== undefined ? { roughnessAssetId: clearId(slot.roughnessAssetId) } : {}),
      ...(slot.metalnessAssetId !== undefined ? { metalnessAssetId: clearId(slot.metalnessAssetId) } : {}),
      ...(slot.emissiveAssetId !== undefined ? { emissiveAssetId: clearId(slot.emissiveAssetId) } : {}),
      ...(slot.aoAssetId !== undefined ? { aoAssetId: clearId(slot.aoAssetId) } : {}),
    }
  }

  // 清理当前活动场景节点与环境贴图
  const editor = useEditorStore.getState()
  if (editor.picture.envAssetId && deletedAssetIds.has(editor.picture.envAssetId)) {
    editor.setPicture({ envAssetId: null })
  }
  for (const node of Object.values(editor.nodes)) {
    let touched = false
    const patch: Partial<SceneNode> = {}
    if (node.clipAssetId && deletedAssetIds.has(node.clipAssetId)) { patch.clipAssetId = null; touched = true }
    if (node.overlayAssetId && deletedAssetIds.has(node.overlayAssetId)) { patch.overlayAssetId = null; touched = true }
    if (node.materialAssetId && deletedAssetIds.has(node.materialAssetId)) { patch.materialAssetId = null; touched = true }
    if (node.mapAssetId && deletedAssetIds.has(node.mapAssetId)) { patch.mapAssetId = null; touched = true }
    if (node.normalAssetId && deletedAssetIds.has(node.normalAssetId)) { patch.normalAssetId = null; touched = true }
    if (node.metallicRoughnessAssetId && deletedAssetIds.has(node.metallicRoughnessAssetId)) { patch.metallicRoughnessAssetId = null; touched = true }
    if (node.emissiveAssetId && deletedAssetIds.has(node.emissiveAssetId)) { patch.emissiveAssetId = null; touched = true }
    if (node.aoAssetId && deletedAssetIds.has(node.aoAssetId)) { patch.aoAssetId = null; touched = true }
    if (node.shader && deletedShaderTargets.has(node.shader)) { patch.shader = undefined; touched = true }
    if (node.slots?.some(s =>
      (s.materialAssetId && deletedAssetIds.has(s.materialAssetId))
      || (s.mapAssetId && deletedAssetIds.has(s.mapAssetId))
      || (s.normalAssetId && deletedAssetIds.has(s.normalAssetId))
      || (s.metallicRoughnessAssetId && deletedAssetIds.has(s.metallicRoughnessAssetId))
      || (s.emissiveAssetId && deletedAssetIds.has(s.emissiveAssetId))
      || (s.aoAssetId && deletedAssetIds.has(s.aoAssetId))
      || (s.shader && deletedShaderTargets.has(s.shader))
    )) {
      patch.slots = node.slots.map(cleanSlot)
      touched = true
    }
    if (deletedScriptIds.size > 0 && node.gameplay?.packs?.__project__) {
      const proj = node.gameplay.packs.__project__ as Record<string, unknown>
      if (Object.keys(proj).some(k => deletedScriptIds.has(k))) {
        const nextProj = { ...proj }
        for (const k of deletedScriptIds) delete nextProj[k]
        patch.gameplay = {
          ...node.gameplay,
          packs: { ...node.gameplay.packs, __project__: nextProj },
        }
        touched = true
      }
    }
    if (touched) editor.updateNode(node.id, patch)
  }

  // 清理保留材质球与特效中的引用
  const assetStore = useAssetStore.getState()
  for (const asset of Object.values(assetStore.assets)) {
    if (deletedAssetIds.has(asset.id)) continue
    if (asset.kind === 'material') {
      const cleaned = cleanSlot(asset.slot)
      assetStore.replaceMaterial(asset.id, cleaned)
    } else if (asset.kind === 'effect' && asset.materialAssetId && deletedAssetIds.has(asset.materialAssetId)) {
      assetStore.updateEffect(asset.id, { materialAssetId: null })
    }
  }
}

export async function executeDeleteSelection(
  plan: DeleteSelectionPlan,
  mode: 'safe-only' | 'force-all',
): Promise<void> {
  const editor = useEditorStore.getState()
  const assetsToDelete = mode === 'force-all'
    ? plan.assets
    : plan.assets.filter(a => plan.safeAssetIds.has(a.id))
  const codesToDelete = mode === 'force-all'
    ? plan.codes
    : plan.codes.filter(c => plan.safeCodeIds.has(c.id))

  const scenesToDelete = assetsToDelete.filter(a => a.kind === 'scene')
  if (scenesToDelete.length > 0 && editor.playState !== 'stopped') {
    editor.log('warn', translate('log.stopBeforeDelete'))
    return
  }

  if (mode === 'force-all') {
    const deletedAssetIds = new Set(assetsToDelete.map(a => a.id))
    const deletedShaders = new Set(codesToDelete.filter(c => c.kind === 'shader').map(c => `custom:${c.id}`))
    const deletedScripts = new Set(codesToDelete.filter(c => c.kind === 'script').map(c => c.id))
    scrubDeletedReferences(deletedAssetIds, deletedShaders, deletedScripts)
  }

  // 先删除场景（内部会处理切换当前活动场景）
  for (const scene of scenesToDelete) {
    useEditorStore.getState().deleteScene(scene.id)
  }

  // 批量释放并移除普通资产
  const nonScenes = assetsToDelete.filter(a => a.kind !== 'scene')
  const nonSceneIds: string[] = []
  for (const asset of nonScenes) {
    if ('url' in asset && asset.url) URL.revokeObjectURL(asset.url)
    releaseModel(asset.id, { dispose: true })
    releaseTexture(asset.id)
    nonSceneIds.push(asset.id)
  }
  if (nonSceneIds.length > 0) {
    useAssetStore.getState().removeMany(nonSceneIds)
    for (const id of nonSceneIds) {
      void forgetFile(id).catch(() => undefined)
    }
  }

  // 删除代码资产
  for (const code of codesToDelete) {
    await deleteCodeAsset(code.id)
  }

  // 清理所有已变空的选中目录
  if (plan.dirs.length > 0) {
    useAssetStore.getState().deleteFolders(plan.dirs)
  }

  if (plan.keptLastSceneName) {
    useEditorStore.getState().log('info', translate('log.keepScene'))
  }

  useProjectSelectionStore.getState().clearSelection()
}
