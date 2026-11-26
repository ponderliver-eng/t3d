import { getSpawn } from '../scene/spawn'
import { useEditorStore } from '../scene/store'
import { normalizeSlot, resolveModelSlot, slotFromNode } from './materials'
import { applyModelMaterialBindings, clipNamesFor, getModelTemplate, loadModelTemplate, releaseModel, waitForModelArtifact, withFbxCompanions, type ModelMaterialHint } from './models'
import { importUnityMatText } from './unityMaterial'
import { bakeTextureArtifact, loadEnvironmentAsset, loadTextureAsset, releaseTexture, ensureAssetUrl } from './textures'
import { deleteModelArtifact, forgetFile, patchAssetMeta, readFileBytes, rememberFile, sha256, updateCachedThumb } from './cache'
import { bytesThumb, imageThumb, renderModelThumb } from './thumbs'
import { readPrefab } from './prefab'
import { translate } from '../i18n'
import { QUARKS_VERSION } from '../../capabilities/particles/defaults'
import { readQuarksDocument } from '../../capabilities/particles/readQuarks'
import { assetDirectory, assetName, useAssetStore, type FileAsset, type FileKind, type ProjectAsset } from './library'
import { selectTab } from '../layout/events'
import { createScoreDocument } from '../../runtime/ui/spec'
import { playSound } from '../../runtime/audio'
import { collectUiImageIds } from '../../runtime/ui/tree'
import { openUiEditor } from '../ui/session'
import { createEmptySequence } from '../../capabilities/cutscene/schema'
import { openCutsceneAsset } from '../panels/cutsceneWindowStore'
import type { PbrSlot, SceneNode, Vec3 } from '../scene/types'

export const ASSET_MIME = 'application/x-t3d-asset'
export const FOLDER_MIME = 'application/x-t3d-folder'
export const NODE_MIME = 'application/x-t3d-node'

export function isNodeDrag(data: DataTransfer): boolean {
  return [...data.types].includes(NODE_MIME)
}

let input: HTMLInputElement | null = null

export function bindImportInput(element: HTMLInputElement | null) {
  input = element
}

export function openImport() {
  input?.click()
}

export interface ImportOptions {
  /**
   * 批量模式：只把文件写进工程、出缩略图、烘好成品，不把资源留在内存和显存里；
   * 之后场景用到时再从成品加载。导入几百上千个文件时内存占用只取决于最大的那一个文件。
   */
  bulk?: boolean
  /** 资源包自带的预览图，直接当模型缩略图用，省掉一次离屏渲染。 */
  previewPng?: Uint8Array
}

/** 一次拖进来的文件数或总大小超过这两个值，就自动按批量模式导入。 */
const BULK_IMPORT_FILE_COUNT = 12
const BULK_IMPORT_BYTES = 256 * 1024 * 1024

/** 源文件没能写进工程的资源：内存里那份是唯一副本，不能释放。 */
const unsavedSources = new Set<string>()

async function persistSource(record: Parameters<typeof rememberFile>[0]): Promise<void> {
  try {
    await rememberFile(record)
    unsavedSources.delete(record.id)
  } catch (error) {
    unsavedSources.add(record.id)
    console.warn('[cache] 写入失败', error)
  }
}

/**
 * 批量导入的收尾：成品写完后，把这个资源在内存里的副本放掉。
 * 已经被场景或其他资源引用的（比如和已有文件内容相同）保持原样。
 */
async function settleBulkAsset(id: string) {
  const asset = useAssetStore.getState().assets[id]
  if (!asset || !('fileName' in asset)) return
  const isModel = asset.kind === 'model' || asset.kind === 'animation'
  if (isModel) await waitForModelArtifact(id)
  if (referencedBy(id).length > 0) return
  if (isModel) releaseModel(id, { dispose: true })
  if (asset.kind === 'texture' || asset.kind === 'environment') releaseTexture(id)
  // 音频和文档的播放/编辑直接用这个地址，保留；其余类型用到时会从工程文件重新读
  const current = useAssetStore.getState().assets[id]
  if (!current || !('fileName' in current) || unsavedSources.has(id)) return
  if (current.kind === 'audio' || current.kind === 'document' || !current.url.startsWith('blob:')) return
  URL.revokeObjectURL(current.url)
  useAssetStore.getState().patch(id, { url: '' })
}

export async function importExtractedBytes(
  fileName: string,
  bytes: Uint8Array,
  dir: string,
  companions: ReadonlyArray<{ name: string; data: Uint8Array }> = [],
  materialHint?: ModelMaterialHint,
  options: ImportOptions = {},
): Promise<string | null> {
    const kind = fileKindFor(fileName)
  if (!kind) return null
  const copy = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer
  const hash = await sha256(copy)
  const existing = findByHash(hash)
  if (existing) {
    useAssetStore.getState().place(existing.id, dir)
    if (existing.kind === 'model' || existing.kind === 'animation') {
      if (companions.length > 0) await withFbxCompanions(existing.id, companions, () => loadModelTemplate(existing, true), materialHint)
      else await loadModelTemplate(existing)
      if (existing.kind === 'model') {
        const nextSlots = applyModelMaterialBindings(existing.id, materialHint)
        if (nextSlots) syncReimportedModelNodes(existing.id, nextSlots, clipNamesFor(existing.id))
      }
      if (options.bulk) await settleBulkAsset(existing.id)
    }
    return existing.id
  }
  const asset: FileAsset = {
    id: crypto.randomUUID(),
    name: assetName(fileName),
    kind,
    url: URL.createObjectURL(new Blob([copy])),
    fileName,
    hash,
    thumb: null,
  }
  if (kind === 'model') {
    useAssetStore.getState().add(asset)
    useAssetStore.getState().place(asset.id, dir)
    await persistSource({ ...asset, bytes: copy })
    const ok = await withFbxCompanions(asset.id, companions, () => ingestModelAfterRegister(asset, options), materialHint)
    return ok ? asset.id : null
  }
  const stored = await ingest(asset, copy, dir, options)
  return stored ? asset.id : null
}

export async function importFiles(files: File[], dir = useAssetStore.getState().browseDir): Promise<string[]> {
  const created: string[] = []
  const modelsToLoad: FileAsset[] = []
  const matFiles = files.filter(file => file.name.toLowerCase().endsWith('.mat'))
  const otherFiles = files.filter(file => !file.name.toLowerCase().endsWith('.mat'))
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  const bulk = files.length > BULK_IMPORT_FILE_COUNT || totalBytes > BULK_IMPORT_BYTES
  const options: ImportOptions = { bulk }
  if (bulk) useEditorStore.getState().log('info', translate('memory.bulkImport', { count: files.length }))
  const isModelFile = (file: File) => fileKindFor(file.name) === 'model'
  // 批量时模型排到材质之后逐个处理（绑定材质需要材质先入库），而且不提前把所有模型字节读进内存
  const firstPass = bulk ? otherFiles.filter(file => !isModelFile(file)) : otherFiles
  const laterModels = bulk ? otherFiles.filter(isModelFile) : []
  let handled = 0
  const importOne = async (file: File) => {
    // 批量时隔几个文件让一次界面，窗口不至于长时间没响应
    handled += 1
    if (bulk && handled % 4 === 0) await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    if (file.name.toLowerCase().endsWith('.json')) {
      const effectId = await importEffectJson(file, dir)
      if (effectId) {
        created.push(effectId)
        return
      }
      // 非 Quarks 粒子特效的 JSON 作为普通文本文档导入
    }
    const kind = fileKindFor(file.name)
    if (!kind) {
      useEditorStore.getState().log('warn', translate('log.unknownFile', { name: file.name }))
      return
    }
    try {
      const bytes = await file.arrayBuffer()
      const hash = await sha256(bytes)
      const existing = findByHash(hash)
      if (existing) {
        useEditorStore.getState().log('info', translate('log.already', { name: existing.name }))
        created.push(existing.id)
        return
      }
      const asset: FileAsset = {
        id: crypto.randomUUID(),
        name: assetName(file.name),
        kind,
        url: URL.createObjectURL(new Blob([bytes], { type: file.type })),
        fileName: file.name,
        hash,
        thumb: null,
      }
      if (kind === 'model') {
        useAssetStore.getState().add(asset)
        useAssetStore.getState().place(asset.id, dir)
        await persistSource({ ...asset, bytes })
        if (bulk) {
          if (await ingestModelAfterRegister(asset, options)) created.push(asset.id)
          return
        }
        modelsToLoad.push(asset)
        created.push(asset.id)
        return
      }
      const stored = await ingest(asset, bytes, dir, options)
      if (stored) created.push(asset.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useEditorStore.getState().log('error', translate('log.importFail', { name: file.name, message }))
    }
  }
  for (const file of firstPass) await importOne(file)
  for (const matFile of matFiles) {
    try {
      const text = await matFile.text()
      const matId = importUnityMatText(text, matFile.name, dir)
      if (matId) created.push(matId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useEditorStore.getState().log('error', translate('log.importFail', { name: matFile.name, message }))
    }
  }
  for (const file of laterModels) await importOne(file)
  for (const modelAsset of modelsToLoad) {
    const ok = await ingestModelAfterRegister(modelAsset)
    if (!ok) {
      const idx = created.indexOf(modelAsset.id)
      if (idx >= 0) created.splice(idx, 1)
    }
  }
  const id = created.at(-1)
  if (id) revealImported(id)
  return created
}

function revealImported(id: string) {
  const library = useAssetStore.getState()
  library.setBrowseDir(assetDirectory(id, library.assetDirs))
  useEditorStore.getState().inspectAsset(id)
  selectTab('tab-project')
}

async function ingestModelAfterRegister(asset: FileAsset, options: ImportOptions = {}): Promise<boolean> {
  try {
    const template = await loadModelTemplate(asset, true)
    const animationOnly = !hasMesh(template.scene) && template.clips.length > 0
    if (animationOnly) {
      useAssetStore.getState().patch(asset.id, { kind: 'animation' })
      void patchAssetMeta(asset.id, { kind: 'animation' })
      if (!options.bulk) useEditorStore.getState().log('info', translate('log.importedAnim', { name: asset.name }))
    } else if (!options.bulk) {
      useEditorStore.getState().log('info', translate('log.importedModel', { name: asset.name, count: template.clips.length }))
    }
    const packaged = !animationOnly && options.previewPng ? await bytesThumb(options.previewPng) : null
    if (packaged) {
      useAssetStore.getState().patch(asset.id, { thumb: packaged })
      await updateCachedThumb(asset.id, packaged).catch(() => undefined)
    } else if (options.bulk) {
      // 批量时要等缩略图出完才能放掉模板
      await attachThumb(asset.id, true)
    } else {
      void attachThumb(asset.id, true)
    }
    if (options.bulk) await settleBulkAsset(asset.id)
    return true
  } catch (error) {
    useAssetStore.getState().remove(asset.id)
    URL.revokeObjectURL(asset.url)
    releaseModel(asset.id, { dispose: true })
    void forgetFile(asset.id).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    useEditorStore.getState().log('error', translate('log.importFail', { name: asset.fileName, message }))
    return false
  }
}

async function ingest(asset: FileAsset, bytes: ArrayBuffer, dir?: string, options: ImportOptions = {}): Promise<boolean> {
  try {
    useAssetStore.getState().add(asset)
    if (dir) useAssetStore.getState().place(asset.id, dir)
    if (options.bulk && (asset.kind === 'texture' || asset.kind === 'environment')) {
      // 批量：贴图只解码一次烘成压缩成品就放掉，不留在内存和显存里；解码失败说明文件是坏的，按导入失败处理
      if (asset.kind === 'texture') await bakeTextureArtifact(asset, new Blob([bytes]))
    } else if (asset.kind === 'model') {
      const template = await loadModelTemplate(asset)
      if (!hasMesh(template.scene) && template.clips.length > 0) {
        asset = { ...asset, kind: 'animation' }
        useAssetStore.getState().remove(asset.id)
        useAssetStore.getState().add(asset)
        useEditorStore.getState().log('info', translate('log.importedAnim', { name: asset.name }))
      } else {
        useEditorStore.getState().log('info', translate('log.importedModel', { name: asset.name, count: template.clips.length }))
      }
    } else if (asset.kind === 'texture') {
      await loadTextureAsset(asset)
      useEditorStore.getState().log('info', translate('log.importedTexture', { name: asset.name }))
    } else if (asset.kind === 'environment') {
      await loadEnvironmentAsset(asset)
      useEditorStore.getState().log('info', translate('log.importedEnv', { name: asset.name }))
    } else if (asset.kind === 'document') {
      useEditorStore.getState().log('info', translate('log.importedDocument', { name: asset.name }))
    } else {
      useEditorStore.getState().log('info', translate('log.importedAudio', { name: asset.name }))
    }
    await persistSource({ ...asset, bytes })
    if (asset.kind === 'texture') await attachThumb(asset.id)
    else void attachThumb(asset.id)
    if (options.bulk) await settleBulkAsset(asset.id)
    return true
  } catch (error) {
    useAssetStore.getState().remove(asset.id)
    URL.revokeObjectURL(asset.url)
    releaseModel(asset.id, { dispose: true })
    releaseTexture(asset.id)
    const message = error instanceof Error ? error.message : String(error)
    useEditorStore.getState().log('error', translate('log.importFail', { name: asset.fileName, message }))
    return false
  }
}

export async function warmCachedAsset(asset: FileAsset): Promise<boolean> {
  try {
    if (!useAssetStore.getState().assets[asset.id]) {
      useAssetStore.getState().add(asset)
    }
    if (asset.kind === 'model' || asset.kind === 'animation') {
      const template = await loadModelTemplate(asset)
      // 直接拷进工程目录的纯动画文件一开始按模型登记，这里改回动画，之后打开工程就不再为它出缩略图
      if (asset.kind === 'model' && !hasMesh(template.scene) && template.clips.length > 0) {
        useAssetStore.getState().patch(asset.id, { kind: 'animation' })
        void patchAssetMeta(asset.id, { kind: 'animation' })
        return true
      }
    }
    if (asset.kind === 'texture') await loadTextureAsset(asset)
    if (asset.kind === 'environment') await loadEnvironmentAsset(asset)
    if (asset.thumb == null) await attachThumb(asset.id)
    return true
  } catch (error) {
    useAssetStore.getState().remove(asset.id)
    URL.revokeObjectURL(asset.url)
    const message = error instanceof Error ? error.message : String(error)
    useEditorStore.getState().log('warn', translate('log.cacheFail', { name: asset.name, message }))
    return false
  }
}

export async function reimportModel(assetId: string) {
  const editor = useEditorStore.getState()
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset || (asset.kind !== 'model' && asset.kind !== 'animation') || !('fileName' in asset)) {
    editor.log('warn', translate('preview.reimportUnavailable'))
    return
  }
  const bytes = await readFileBytes(assetId)
  if (!bytes) {
    editor.log('error', translate('preview.reimportFailed'))
    return
  }
  if (asset.url) URL.revokeObjectURL(asset.url)
  const url = URL.createObjectURL(new Blob([bytes]))
  releaseModel(assetId)
  if (asset.hash) await deleteModelArtifact(asset.hash).catch(() => undefined)
  await patchAssetMeta(assetId, { artifactReady: false }).catch(() => undefined)
  useAssetStore.getState().patch(assetId, { url })
  try {
    const template = await loadModelTemplate({ ...asset, url }, true)
    const nextKind: FileKind = !hasMesh(template.scene) && template.clips.length > 0 ? 'animation' : 'model'
    if (nextKind !== asset.kind) {
      useAssetStore.getState().patch(assetId, { kind: nextKind })
      void patchAssetMeta(assetId, { kind: nextKind })
    }
    syncReimportedModelNodes(assetId, template.slots, template.clips.map(clip => clip.name))
    void attachThumb(assetId, true)
    editor.log('info', translate('preview.reimportDone', { name: asset.name }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    editor.log('error', translate('preview.reimportFailedDetail', { message }))
  }
}

function syncReimportedModelNodes(assetId: string, templateSlots: PbrSlot[], clipNames: string[]) {
  const editor = useEditorStore.getState()
  for (const node of Object.values(editor.nodes)) {
    if (node.kind !== 'model') continue
    const patch: Partial<SceneNode> = {}
    if (node.assetId === assetId && templateSlots.length > 0) {
      const existingByName = new Map(node.slots.map(slot => [slot.name, slot]))
      patch.slots = templateSlots.map(fresh => {
        const prev = existingByName.get(fresh.name)
        if (!prev) return fresh
        const materialAssetId = fresh.materialAssetId ?? prev.materialAssetId
        return {
          ...fresh,
          ...(materialAssetId ? { materialAssetId } : {}),
          mapAssetId: fresh.mapAssetId ?? prev.mapAssetId,
          normalAssetId: fresh.normalAssetId ?? prev.normalAssetId,
          metallicRoughnessAssetId: fresh.metallicRoughnessAssetId ?? prev.metallicRoughnessAssetId,
          emissiveAssetId: fresh.emissiveAssetId ?? prev.emissiveAssetId,
          aoAssetId: fresh.aoAssetId ?? prev.aoAssetId,
        }
      })
    }
    const usesClips = (node.clipAssetId ? node.clipAssetId === assetId : node.assetId === assetId)
    if (usesClips && clipNames.length > 0 && node.clip && !clipNames.includes(node.clip)) {
      patch.clip = clipNames[0]
    }
    if (Object.keys(patch).length > 0) {
      editor.updateNode(node.id, patch)
    }
  }
}

export function setModelImportScale(assetId: string, scale: number) {
  const clean = Math.max(0.001, Number(scale.toFixed(4)) || 1)
  useAssetStore.getState().patch(assetId, { importScale: clean })
  void patchAssetMeta(assetId, { importScale: clean })
}

export function setModelSockets(assetId: string, sockets: import('./library').ModelSocket[]) {
  useAssetStore.getState().patch(assetId, { sockets })
  void patchAssetMeta(assetId, { sockets })
}

async function attachThumb(id: string, force = false) {
  const asset = useAssetStore.getState().assets[id]
  if (!asset || !('url' in asset) || (asset.thumb && !force)) return
  let thumb: string | null = null
  if (asset.kind === 'texture' && !asset.fileName.toLowerCase().endsWith('.ktx2')) {
    const url = asset.url || await ensureAssetUrl(id).catch(() => '')
    if (url) thumb = await imageThumb(url)
  }
  if (asset.kind === 'model') {
    const template = getModelTemplate(id)
    if (template) {
      thumb = renderModelThumb(template.scene)
      // 出图失败记成空串，表示试过了：打开工程时不再为了补缩略图反复加载这个模型
      if (!thumb && asset.thumb == null) {
        useAssetStore.getState().patch(id, { thumb: '' })
        await updateCachedThumb(id, '').catch(() => undefined)
      }
    }
  }
  if (!thumb) return
  useAssetStore.getState().patch(id, { thumb })
  await updateCachedThumb(id, thumb).catch(() => undefined)
}

function findByHash(hash: string): FileAsset | undefined {
  return Object.values(useAssetStore.getState().assets).find((asset): asset is FileAsset => 'hash' in asset && asset.hash === hash)
}

export function deleteAsset(id: string) {
  const asset = useAssetStore.getState().assets[id]
  if (asset?.kind === 'scene') {
    useEditorStore.getState().deleteScene(id)
    return
  }
  const used = referencedBy(id)
  if (used.length > 0) {
    logNamed('warn', translate('log.referenced'), used)
    return
  }
  if (asset && 'url' in asset) URL.revokeObjectURL(asset.url)
  releaseModel(id, { dispose: true })
  releaseTexture(id)
  useAssetStore.getState().remove(id)
  void forgetFile(id).catch(() => undefined)
}

export function placeAsset(assetId: string, point: Vec3, hitId: string | null) {
  const asset = useAssetStore.getState().assets[assetId]
  const editor = useEditorStore.getState()
  if (!asset || asset.kind === 'scene') return
  if (asset.kind === 'model') {
    const template = getModelTemplate(assetId)
    if (!template) {
      void loadModelTemplate(asset).then(loaded => {
        useEditorStore.getState().spawnModel(assetId, asset.name, loaded.slots, point)
      }).catch(() => undefined)
      return
    }
    editor.spawnModel(assetId, asset.name, template.slots, point)
    return
  }
  if (asset.kind === 'prefab') {
    editor.spawnPrefab(asset.id, point)
    return
  }
  if (asset.kind === 'environment') {
    editor.beginGesture('设置环境')
    editor.setPicture({ envAssetId: asset.id })
    editor.endGesture()
    editor.log('info', translate('log.envSet', { name: asset.name }))
    return
  }
  if (asset.kind === 'audio') {
    playSound({ assetId: asset.id, bus: 'sfx', volume: 1 })
    return
  }
  if (asset.kind === 'effect') {
    editor.spawnEffect(asset.id, point)
    return
  }
  if (asset.kind === 'ui') {
    editor.mountScreen(asset.id, point)
    return
  }
  const node = hitId ? editor.nodes[hitId] : undefined
  if (!node) {
    editor.log('warn', asset.kind === 'animation' ? translate('log.dragAnim') : translate('log.dragAsset'))
    return
  }
  if (asset.kind === 'texture') editor.assignMap(node.id, assetId)
  if (asset.kind === 'material') editor.assignMaterial(node.id, asset.id)
  if (asset.kind === 'animation') {
    if (node.kind !== 'model') {
      editor.log('warn', translate('log.animOnModel'))
      return
    }
    const existingClips = clipNamesFor(assetId)
    if (existingClips.length > 0) {
      assignClip(node.id, assetId, existingClips[0] ?? '')
    } else {
      void loadModelTemplate(asset).then(loaded => {
        assignClip(node.id, assetId, loaded.clips[0]?.name ?? '')
      }).catch(() => undefined)
    }
  }
}

export function assignClip(nodeId: string, assetId: string, clip: string) {
  const editor = useEditorStore.getState()
  const node = editor.nodes[nodeId]
  if (!node || node.kind !== 'model') {
    editor.log('warn', translate('log.animOnModel'))
    return
  }
  const own = !assetId || node.assetId === assetId
  editor.beginGesture('指定动画')
  editor.updateNode(node.id, {
    clipAssetId: own ? null : assetId,
    clip,
    clipTime: 0,
    clipPlaying: Boolean(clip),
  })
  editor.endGesture()
}

export function saveMaterialFromSelection() {
  const editor = useEditorStore.getState()
  const id = editor.selection[editor.selection.length - 1]
  const node = id ? editor.nodes[id] : undefined
  if (!node || (node.kind !== 'model' && !isPaintable(node))) {
    editor.log('warn', translate('log.needMesh'))
    return
  }
  saveMaterialFromNode(node.id, node.kind === 'model' && node.slots.length > 0 ? 0 : null)
}

export function saveMaterialFromNode(nodeId: string, slotIndex: number | null) {
  const editor = useEditorStore.getState()
  const node = editor.nodes[nodeId]
  if (!node || (node.kind !== 'model' && !isPaintable(node))) {
    editor.log('warn', translate('log.needMesh'))
    return
  }
  const source = slotIndex != null && node.slots[slotIndex] ? resolveModelSlot(node.slots[slotIndex]) : slotFromNode(node)
  const name = uniqueAssetName(`${source.name || node.name} 材质`)
  const materialId = crypto.randomUUID()
  useAssetStore.getState().add({ id: materialId, name, kind: 'material', slot: { ...source, materialAssetId: null } })
  useAssetStore.getState().place(materialId)
  if (slotIndex != null) {
    editor.updateNode(node.id, {
      slots: node.slots.map((item, index) => index === slotIndex ? { ...item, materialAssetId: materialId } : item),
    })
  } else {
    editor.updateNode(node.id, { materialAssetId: materialId })
  }
  editor.log('info', translate('log.savedMaterial', { name }))
}

export function savePrefabFromSelection() {
  const editor = useEditorStore.getState()
  if (editor.selection.length === 0) {
    editor.log('warn', translate('log.needSelection'))
    return
  }
  editor.createPrefabFromSelection()
}

export function createDefaultUi(dir?: string) {
  const name = uniqueAssetName(translate('project.newUiName'))
  const id = crypto.randomUUID()
  useAssetStore.getState().add({ id, name, kind: 'ui', document: createScoreDocument() })
  useAssetStore.getState().place(id, dir)
  useEditorStore.getState().inspectAsset(id)
  useEditorStore.getState().log('info', translate('log.createdUi', { name }))
  openUiEditor(id)
}

export function createDefaultCutscene(dir?: string) {
  const name = uniqueAssetName('过场序列')
  const id = crypto.randomUUID()
  const seq = createEmptySequence(name, id)
  useAssetStore.getState().add({ id, name, kind: 'cutscene', sequence: seq })
  useAssetStore.getState().place(id, dir)
  useEditorStore.getState().inspectAsset(id)
  openCutsceneAsset(id)
  return id
}

export function createDefaultMaterial(dir?: string) {
  const name = uniqueAssetName(translate('project.newMaterialName'))
  const id = crypto.randomUUID()
  useAssetStore.getState().add({
    id,
    name,
    kind: 'material',
    slot: normalizeSlot({
      name,
      color: '#cccccc',
      metalness: 0,
      roughness: 0.5,
      emissive: '#000000',
      emissiveIntensity: 0,
      opacity: 1,
      ao: 1,
      mapAssetId: null,
      normalAssetId: null,
      metallicRoughnessAssetId: null,
      emissiveAssetId: null,
      aoAssetId: null,
    }),
  })
  useAssetStore.getState().place(id, dir)
  useEditorStore.getState().inspectAsset(id)
  useEditorStore.getState().log('info', translate('log.savedMaterial', { name }))
}

export function duplicateAsset(id: string) {
  const asset = useAssetStore.getState().assets[id]
  if (!asset || (asset.kind !== 'material' && asset.kind !== 'scene' && asset.kind !== 'prefab' && asset.kind !== 'effect' && asset.kind !== 'ui' && asset.kind !== 'cutscene')) return
  const copy = structuredClone(asset)
  copy.id = crypto.randomUUID()
  copy.name = uniqueAssetName(`${asset.name} ${translate('project.copySuffix')}`)
  const dir = assetDirectory(id, useAssetStore.getState().assetDirs)
  useAssetStore.getState().add(copy)
  useAssetStore.getState().place(copy.id, dir)
  useEditorStore.getState().inspectAsset(copy.id)
}

export function reportAssetUsers(id: string) {
  const names = referencedBy(id).map(item => item.name)
  const editor = useEditorStore.getState()
  if (names.length === 0) editor.log('info', translate('project.noRefs'))
  else editor.log('info', translate('project.refs', { names: names.join('、') }))
}

export function previewAudio(asset: ProjectAsset) {
  if (asset.kind !== 'audio') return
  playSound({ assetId: asset.id, bus: 'sfx', volume: 1 })
}

async function importEffectJson(file: File, dir: string): Promise<string | null> {
  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch {
    return null
  }
  const document = readQuarksDocument(json)
  if (!document) return null
  const base = file.name.replace(/\.json$/i, '')
  let mapAssetId: string | null = null
  if (document.appearance.image) {
    try {
      const response = await fetch(document.appearance.image)
      const bytes = new Uint8Array(await response.arrayBuffer())
      mapAssetId = await importExtractedBytes(`${base}.png`, bytes, dir)
    } catch (error) {
      console.warn('[particles] 贴图没有收进工程', error)
    }
  }
  const materialId = crypto.randomUUID()
  const materialName = uniqueAssetName(`${base} 材质`)
  useAssetStore.getState().add({
    id: materialId,
    name: materialName,
    kind: 'material',
    slot: normalizeSlot({
      name: materialName,
      color: document.appearance.color,
      metalness: 0,
      roughness: 1,
      emissive: '#000000',
      emissiveIntensity: 0,
      opacity: document.appearance.opacity,
      ao: 1,
      mapAssetId,
      normalAssetId: null,
      metallicRoughnessAssetId: null,
      emissiveAssetId: null,
      aoAssetId: null,
      shader: 'particle-unlit',
      particleBlend: document.appearance.blend,
      alphaMode: 'blend',
      depthWrite: document.appearance.depthWrite,
      cull: 'off',
    }),
  })
  useAssetStore.getState().place(materialId, dir)
  const effectId = crypto.randomUUID()
  const name = uniqueAssetName(base)
  useAssetStore.getState().add({
    id: effectId,
    name,
    kind: 'effect',
    quarksVersion: QUARKS_VERSION,
    simulation: document.simulation,
    materialAssetId: materialId,
  })
  useAssetStore.getState().place(effectId, dir)
  useEditorStore.getState().log('info', translate('particles.imported', { name }))
  return effectId
}

const DOCUMENT_EXTS = ['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv', 'tsv', 'xml', 'ini', 'cfg', 'conf', 'toml', 'log']

export function fileKindFor(fileName: string): FileKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (['glb', 'gltf', 'obj', 'fbx', 'dae', '3ds', 'stl'].includes(ext)) return 'model'
  if (['hdr', 'exr', 'env'].includes(ext)) return 'environment'
  if (['png', 'jpg', 'jpeg', 'webp', 'ktx2', 'svg'].includes(ext)) return 'texture'
  if (['mp3', 'wav', 'ogg'].includes(ext)) return 'audio'
  if (DOCUMENT_EXTS.includes(ext)) return 'document'
  return null
}

export async function readDocumentText(assetId: string): Promise<string> {
  const bytes = await readFileBytes(assetId)
  if (bytes) return new TextDecoder('utf-8').decode(bytes)
  const asset = useAssetStore.getState().assets[assetId]
  if (asset && 'url' in asset && asset.url) {
    const response = await fetch(asset.url)
    if (response.ok) return await response.text()
  }
  throw new Error('文档源文件不存在')
}

export async function saveDocumentText(assetId: string, text: string): Promise<boolean> {
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset || asset.kind !== 'document') return false
  const encoded = new TextEncoder().encode(text)
  const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
  const hash = await sha256(bytes)
  const nextUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=utf-8' }))
  if (asset.url && asset.url.startsWith('blob:')) URL.revokeObjectURL(asset.url)
  useAssetStore.getState().patch(assetId, { url: nextUrl, hash })
  await rememberFile({
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    fileName: asset.fileName,
    hash,
    thumb: asset.thumb,
    bytes,
  })
  return true
}

export async function createDocumentAsset(options: { fileName: string; content: string; dir?: string }): Promise<FileAsset | null> {
  const rawName = options.fileName.trim() || '新文档.md'
  const ext = rawName.toLowerCase().split('.').pop() ?? ''
  const fileName = rawName.includes('.') && DOCUMENT_EXTS.includes(ext) ? rawName : `${rawName}.md`
  const baseName = assetName(fileName) || '新文档'
  const dir = options.dir?.trim() || useAssetStore.getState().browseDir
  const encoded = new TextEncoder().encode(options.content)
  const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
  const hash = await sha256(bytes)
  const asset: FileAsset = {
    id: crypto.randomUUID(),
    name: baseName,
    kind: 'document',
    url: URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=utf-8' })),
    fileName,
    hash,
    thumb: null,
  }
  const ok = await ingest(asset, bytes, dir)
  return ok ? asset : null
}

export async function createDefaultDocument(dir = useAssetStore.getState().browseDir, ext: 'md' | 'txt' = 'md'): Promise<string | null> {
  const baseName = uniqueAssetName(ext === 'md' ? '新文档' : '新文本')
  const asset = await createDocumentAsset({
    fileName: `${baseName}.${ext}`,
    content: ext === 'md' ? `# ${baseName}\n\n` : '',
    dir,
  })
  if (!asset) return null
  useEditorStore.getState().inspectAsset(asset.id)
  return asset.id
}

function hasMesh(root: { traverse: (fn: (child: { type?: string }) => void) => void }): boolean {
  let found = false
  root.traverse(child => {
    if ((child as { isMesh?: boolean }).isMesh) found = true
  })
  return found
}

function isPaintable(node: SceneNode): boolean {
  return node.kind === 'box' || node.kind === 'sphere' || node.kind === 'plane' || node.kind === 'cylinder' || node.kind === 'capsule' || node.kind === 'cone' || node.kind === 'model'
}

function referencedBy(assetId: string): { name: string, assetId?: string }[] {
  const users: { name: string, assetId?: string }[] = []
  for (const node of Object.values(useEditorStore.getState().nodes)) {
    if (usesAsset(node, assetId)) users.push({ name: node.name })
  }
  for (const asset of Object.values(useAssetStore.getState().assets)) {
    if (asset.kind === 'prefab' && Object.values(readPrefab(asset).nodes).some(node => usesAsset(node, assetId) || node.nestedPrefabId === assetId)) users.push({ name: asset.name, assetId: asset.id })
    if (asset.kind === 'scene') {
      for (const node of Object.values(asset.nodes)) {
        if (usesAsset(node, assetId)) {
          users.push({ name: asset.name, assetId: asset.id })
          break
        }
      }
    }
    if (asset.kind === 'material' && slotUses(asset.slot, assetId)) users.push({ name: asset.name, assetId: asset.id })
    if (asset.kind === 'effect' && asset.materialAssetId === assetId) users.push({ name: asset.name, assetId: asset.id })
    if (asset.kind === 'ui') {
      const images = new Set<string>()
      collectUiImageIds(asset.document.root, images)
      if (images.has(assetId)) users.push({ name: asset.name, assetId: asset.id })
    }
    if (asset.kind === 'cutscene') {
      const seq = asset.sequence
      const used = seq.tracks.some(t => t.clips?.some(c => c.clipAssetId === assetId))
        || seq.eventTrack.some(e => e.assetId === assetId)
      if (used) users.push({ name: asset.name, assetId: asset.id })
    }
  }
  return users
}

export function logNamed(level: 'info' | 'warn' | 'error', prefix: string, items: { name: string, assetId?: string }[]) {
  const shown = items.slice(0, 10)
  const parts: { text: string, assetId?: string }[] = [{ text: prefix }]
  shown.forEach((item, index) => {
    if (index > 0) parts.push({ text: '、' })
    parts.push(item.assetId ? { text: item.name, assetId: item.assetId } : { text: item.name })
  })
  if (items.length > 10) parts.push({ text: '…' })
  useEditorStore.getState().log(level, parts.map(part => part.text).join(''), parts)
}

function usesAsset(node: SceneNode, assetId: string): boolean {
  if (node.assetId === assetId || node.clipAssetId === assetId || node.overlayAssetId === assetId || node.materialAssetId === assetId) return true
  if (node.animator?.states.some(state => state.clipAssetId === assetId)) return true
  if (node.effect?.assetId === assetId || node.effect?.materialAssetId === assetId) return true
  if (node.screen?.documentId === assetId) return true
  if (slotUses(slotFromNode(node), assetId)) return true
  return node.slots.some(slot => slot.materialAssetId === assetId || slotUses(slot, assetId))
}

function slotUses(slot: PbrSlot, assetId: string): boolean {
  return [slot.mapAssetId, slot.normalAssetId, slot.metallicRoughnessAssetId, slot.roughnessAssetId, slot.metalnessAssetId, slot.emissiveAssetId, slot.aoAssetId].includes(assetId)
}

function uniqueAssetName(base: string): string {
  const names = new Set(Object.values(useAssetStore.getState().assets).map(asset => asset.name))
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

export function collectPrefabNodes(nodes: Record<string, SceneNode>, selection: string[]): SceneNode[] {
  const selected = new Set(selection)
  const roots = selection.filter(id => {
    let parent = nodes[id]?.parentId
    while (parent) {
      if (selected.has(parent)) return false
      parent = nodes[parent]?.parentId ?? null
    }
    return Boolean(nodes[id])
  })
  const out: SceneNode[] = []
  const walk = (id: string, asRoot: boolean) => {
    const source = nodes[id]
    if (!source) return
    const copy = structuredClone(source)
    if (asRoot) copy.parentId = null
    out.push(copy)
    for (const child of Object.values(nodes)) {
      if (child.parentId === id) walk(child.id, false)
    }
  }
  for (const id of roots) walk(id, true)
  return out
}

export async function openAsset(assetId: string) {
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset) return
  if (asset.kind === 'ui') {
    openUiEditor(asset.id)
    return
  }
  if (asset.kind === 'cutscene') {
    openCutsceneAsset(asset.id)
    return
  }
  if (asset.kind === 'audio') {
    previewAudio(asset)
    return
  }
  if (asset.kind === 'model' || asset.kind === 'animation') await loadModelTemplate(asset)
  if (asset.kind === 'environment') await loadEnvironmentAsset(asset)
  if (asset.kind === 'texture') await loadTextureAsset(asset)
  const spawn = getSpawn()
  const hit = useEditorStore.getState().selection.at(-1) ?? null
  if (asset.kind === 'model' || asset.kind === 'prefab' || asset.kind === 'environment' || asset.kind === 'effect') placeAsset(assetId, [spawn[0], 0, spawn[2]], null)
  else placeAsset(assetId, [spawn[0], 0, spawn[2]], hit)
}
