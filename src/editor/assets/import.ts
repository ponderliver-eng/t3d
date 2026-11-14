import { getSpawn } from '../scene/spawn'
import { useEditorStore } from '../scene/store'
import { normalizeSlot, resolveModelSlot, slotFromNode } from './materials'
import { clipNamesFor, getModelTemplate, loadModelTemplate, releaseModel, withFbxCompanions } from './models'
import { loadEnvironmentAsset, loadTextureAsset, releaseTexture } from './textures'
import { deleteModelArtifact, forgetFile, patchAssetMeta, readFileBytes, rememberFile, sha256, updateCachedThumb } from './cache'
import { imageThumb, labelThumb, renderModelThumb } from './thumbs'
import { readPrefab } from './prefab'
import { translate } from '../i18n'
import { assetDirectory, assetName, useAssetStore, type FileAsset, type FileKind, type ProjectAsset } from './library'
import type { PbrSlot, SceneNode, Vec3 } from '../scene/types'

export const ASSET_MIME = 'application/x-t3d-asset'

let input: HTMLInputElement | null = null

export function bindImportInput(element: HTMLInputElement | null) {
  input = element
}

export function openImport() {
  input?.click()
}

export async function importExtractedBytes(
  fileName: string,
  bytes: Uint8Array,
  dir: string,
  companions: ReadonlyArray<{ name: string; data: Uint8Array }> = [],
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
      if (companions.length > 0) await withFbxCompanions(existing.id, companions, () => loadModelTemplate(existing, true))
      else await loadModelTemplate(existing)
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
    await rememberFile({ ...asset, bytes: copy }).catch(error => {
      console.warn('[cache] 写入失败', error)
    })
    const ok = await withFbxCompanions(asset.id, companions, () => ingestModelAfterRegister(asset))
    return ok ? asset.id : null
  }
  const stored = await ingest(asset, copy, dir)
  return stored ? asset.id : null
}

export async function importFiles(files: File[], dir = useAssetStore.getState().browseDir): Promise<string[]> {
  const created: string[] = []
  const modelsToLoad: FileAsset[] = []
  for (const file of files) {
    const kind = fileKindFor(file.name)
    if (!kind) {
      useEditorStore.getState().log('warn', translate('log.unknownFile', { name: file.name }))
      continue
    }
    try {
      const bytes = await file.arrayBuffer()
      const hash = await sha256(bytes)
      const existing = findByHash(hash)
      if (existing) {
        useEditorStore.getState().log('info', translate('log.already', { name: existing.name }))
        created.push(existing.id)
        continue
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
        await rememberFile({ ...asset, bytes }).catch(error => {
          console.warn('[cache] 写入失败', error)
        })
        modelsToLoad.push(asset)
        created.push(asset.id)
        continue
      }
      const stored = await ingest(asset, bytes, dir)
      if (stored) created.push(asset.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useEditorStore.getState().log('error', translate('log.importFail', { name: file.name, message }))
    }
  }
  for (const modelAsset of modelsToLoad) {
    const ok = await ingestModelAfterRegister(modelAsset)
    if (!ok) {
      const idx = created.indexOf(modelAsset.id)
      if (idx >= 0) created.splice(idx, 1)
    }
  }
  return created
}

async function ingestModelAfterRegister(asset: FileAsset): Promise<boolean> {
  try {
    const template = await loadModelTemplate(asset, true)
    if (!hasMesh(template.scene) && template.clips.length > 0) {
      useAssetStore.getState().patch(asset.id, { kind: 'animation' })
      void patchAssetMeta(asset.id, { kind: 'animation' })
      useEditorStore.getState().log('info', translate('log.importedAnim', { name: asset.name }))
    } else {
      useEditorStore.getState().log('info', translate('log.importedModel', { name: asset.name, count: template.clips.length }))
    }
    void attachThumb(asset.id, true)
    return true
  } catch (error) {
    useAssetStore.getState().remove(asset.id)
    URL.revokeObjectURL(asset.url)
    releaseModel(asset.id)
    void forgetFile(asset.id).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    useEditorStore.getState().log('error', translate('log.importFail', { name: asset.fileName, message }))
    return false
  }
}

async function ingest(asset: FileAsset, bytes: ArrayBuffer, dir?: string): Promise<boolean> {
  try {
    useAssetStore.getState().add(asset)
    if (dir) useAssetStore.getState().place(asset.id, dir)
    if (asset.kind === 'model') {
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
    } else {
      useEditorStore.getState().log('info', translate('log.importedAudio', { name: asset.name }))
    }
    await rememberFile({ ...asset, bytes }).catch(error => {
      console.warn('[cache] 写入失败', error)
    })
    void attachThumb(asset.id)
    return true
  } catch (error) {
    useAssetStore.getState().remove(asset.id)
    URL.revokeObjectURL(asset.url)
    releaseModel(asset.id)
    releaseTexture(asset.id)
    const message = error instanceof Error ? error.message : String(error)
    useEditorStore.getState().log('error', translate('log.importFail', { name: asset.fileName, message }))
    return false
  }
}

export async function warmCachedAsset(asset: FileAsset): Promise<boolean> {
  try {
    useAssetStore.getState().add(asset)
    if (asset.kind === 'model' || asset.kind === 'animation') await loadModelTemplate(asset)
    if (asset.kind === 'texture') await loadTextureAsset(asset)
    if (asset.kind === 'environment') await loadEnvironmentAsset(asset)
    if (!asset.thumb) void attachThumb(asset.id)
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
        return {
          ...fresh,
          ...(prev.materialAssetId ? { materialAssetId: prev.materialAssetId } : {}),
          mapAssetId: prev.mapAssetId ?? fresh.mapAssetId,
          normalAssetId: prev.normalAssetId ?? fresh.normalAssetId,
          metallicRoughnessAssetId: prev.metallicRoughnessAssetId ?? fresh.metallicRoughnessAssetId,
          emissiveAssetId: prev.emissiveAssetId ?? fresh.emissiveAssetId,
          aoAssetId: prev.aoAssetId ?? fresh.aoAssetId,
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
  if (asset.kind === 'texture' && !asset.fileName.toLowerCase().endsWith('.ktx2')) thumb = await imageThumb(asset.url)
  if (asset.kind === 'model') {
    const template = getModelTemplate(id)
    if (template) thumb = renderModelThumb(template.scene)
  }
  if (asset.kind === 'environment') thumb = labelThumb('HDR')
  if (asset.kind === 'audio') thumb = labelThumb('音频')
  if (asset.kind === 'animation') thumb = labelThumb('动画')
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
    useEditorStore.getState().log('warn', translate('log.referenced', { names: used.join('、') }))
    return
  }
  if (asset && 'url' in asset) URL.revokeObjectURL(asset.url)
  releaseModel(id)
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
      editor.log('warn', translate('log.modelLoading'))
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
    void new Audio(asset.url).play()
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
    assignClip(node.id, assetId, clipNamesFor(assetId)[0] ?? '')
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
  if (!asset || (asset.kind !== 'material' && asset.kind !== 'scene' && asset.kind !== 'prefab')) return
  const copy = structuredClone(asset)
  copy.id = crypto.randomUUID()
  copy.name = uniqueAssetName(`${asset.name} ${translate('project.copySuffix')}`)
  const dir = assetDirectory(id, useAssetStore.getState().assetDirs)
  useAssetStore.getState().add(copy)
  useAssetStore.getState().place(copy.id, dir)
  useEditorStore.getState().inspectAsset(copy.id)
}

export function reportAssetUsers(id: string) {
  const names = referencedBy(id)
  const editor = useEditorStore.getState()
  if (names.length === 0) editor.log('info', translate('project.noRefs'))
  else editor.log('info', translate('project.refs', { names: names.join('、') }))
}

export function previewAudio(asset: ProjectAsset) {
  if (asset.kind !== 'audio') return
  void new Audio(asset.url).play()
}

export function fileKindFor(fileName: string): FileKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (['glb', 'gltf', 'obj', 'fbx', 'dae', '3ds', 'stl'].includes(ext)) return 'model'
  if (['hdr', 'exr', 'env'].includes(ext)) return 'environment'
  if (['png', 'jpg', 'jpeg', 'webp', 'ktx2', 'svg'].includes(ext)) return 'texture'
  if (['mp3', 'wav', 'ogg'].includes(ext)) return 'audio'
  return null
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

function referencedBy(assetId: string): string[] {
  const names: string[] = []
  for (const node of Object.values(useEditorStore.getState().nodes)) {
    if (usesAsset(node, assetId)) names.push(node.name)
  }
  for (const asset of Object.values(useAssetStore.getState().assets)) {
    if (asset.kind === 'prefab' && Object.values(readPrefab(asset).nodes).some(node => usesAsset(node, assetId) || node.nestedPrefabId === assetId)) names.push(asset.name)
    if (asset.kind === 'scene') {
      for (const node of Object.values(asset.nodes)) {
        if (usesAsset(node, assetId)) {
          names.push(asset.name)
          break
        }
      }
    }
    if (asset.kind === 'material' && slotUses(asset.slot, assetId)) names.push(asset.name)
  }
  return names
}

function usesAsset(node: SceneNode, assetId: string): boolean {
  if (node.assetId === assetId || node.clipAssetId === assetId || node.materialAssetId === assetId) return true
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
  if (asset.kind === 'audio') {
    previewAudio(asset)
    return
  }
  if (asset.kind === 'model' || asset.kind === 'animation') await loadModelTemplate(asset)
  if (asset.kind === 'environment') await loadEnvironmentAsset(asset)
  if (asset.kind === 'texture') await loadTextureAsset(asset)
  const spawn = getSpawn()
  const hit = useEditorStore.getState().selection.at(-1) ?? null
  if (asset.kind === 'model' || asset.kind === 'prefab' || asset.kind === 'environment') placeAsset(assetId, [spawn[0], 0, spawn[2]], null)
  else placeAsset(assetId, [spawn[0], 0, spawn[2]], hit)
}
