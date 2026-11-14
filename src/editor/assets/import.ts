import { getSpawn } from '../scene/spawn'
import { useEditorStore } from '../scene/store'
import { slotFromNode } from './materials'
import { clipNamesFor, getModelTemplate, loadModelTemplate, releaseModel } from './models'
import { loadEnvironmentAsset, loadTextureAsset, releaseTexture } from './textures'
import { forgetFile, rememberFile, sha256, updateCachedThumb } from './cache'
import { imageThumb, labelThumb, renderModelThumb } from './thumbs'
import { assetName, useAssetStore, type FileAsset, type FileKind, type ProjectAsset } from './library'
import type { PbrSlot, SceneNode, Vec3 } from '../scene/types'

export const ASSET_MIME = 'application/x-t3d-asset'

let input: HTMLInputElement | null = null

export function bindImportInput(element: HTMLInputElement | null) {
  input = element
}

export function openImport() {
  input?.click()
}

export async function importFiles(files: File[]): Promise<string[]> {
  const created: string[] = []
  for (const file of files) {
    const kind = kindFor(file.name)
    if (!kind) {
      useEditorStore.getState().log('warn', `不认识的文件：${file.name}`)
      continue
    }
    try {
      const bytes = await file.arrayBuffer()
      const hash = await sha256(bytes)
      const existing = findByHash(hash)
      if (existing) {
        useEditorStore.getState().log('info', `资源已在库中：${existing.name}`)
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
      const stored = await ingest(asset, bytes)
      if (stored) created.push(asset.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useEditorStore.getState().log('error', `${file.name} 导入失败：${message}`)
    }
  }
  return created
}

async function ingest(asset: FileAsset, bytes: ArrayBuffer): Promise<boolean> {
  try {
    useAssetStore.getState().add(asset)
    if (asset.kind === 'model') {
      const template = await loadModelTemplate(asset)
      if (!hasMesh(template.scene) && template.clips.length > 0) {
        asset = { ...asset, kind: 'animation' }
        useAssetStore.getState().remove(asset.id)
        useAssetStore.getState().add(asset)
        useEditorStore.getState().log('info', `已导入动画 ${asset.name}`)
      } else {
        useEditorStore.getState().log('info', `已导入模型 ${asset.name}，${template.clips.length} 个片段`)
      }
    } else if (asset.kind === 'texture') {
      await loadTextureAsset(asset)
      useEditorStore.getState().log('info', `已导入贴图 ${asset.name}`)
    } else if (asset.kind === 'environment') {
      await loadEnvironmentAsset(asset)
      useEditorStore.getState().log('info', `已导入环境贴图 ${asset.name}`)
    } else {
      useEditorStore.getState().log('info', `已导入音频 ${asset.name}`)
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
    useEditorStore.getState().log('error', `${asset.fileName} 导入失败：${message}`)
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
    useEditorStore.getState().log('warn', `缓存资源 ${asset.name} 没能恢复：${message}`)
    return false
  }
}

async function attachThumb(id: string) {
  const asset = useAssetStore.getState().assets[id]
  if (!asset || !('url' in asset) || asset.thumb) return
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
    useEditorStore.getState().log('warn', `还被这些物体引用：${used.join('、')}`)
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
  if (!asset) return
  if (asset.kind === 'model') {
    const template = getModelTemplate(assetId)
    if (!template) {
      editor.log('warn', '模型还在读取')
      return
    }
    editor.spawnModel(assetId, asset.name, template.slots, point)
    return
  }
  if (asset.kind === 'prefab') {
    editor.spawnPrefab(asset.name, asset.nodes, point)
    return
  }
  if (asset.kind === 'environment') {
    editor.beginGesture('设置环境')
    editor.setPicture({ envAssetId: asset.id })
    editor.endGesture()
    editor.log('info', `已用 ${asset.name} 作为环境`)
    return
  }
  if (asset.kind === 'audio') {
    void new Audio(asset.url).play()
    return
  }
  const node = hitId ? editor.nodes[hitId] : undefined
  if (!node) {
    editor.log('warn', asset.kind === 'animation' ? '把动画拖到模型上' : '把资源拖到物体上')
    return
  }
  if (asset.kind === 'texture') editor.assignMap(node.id, assetId)
  if (asset.kind === 'material') editor.assignMaterial(node.id, asset.slot)
  if (asset.kind === 'animation') {
    if (node.kind !== 'model') {
      editor.log('warn', '动画要拖到模型上')
      return
    }
    const clips = clipNamesFor(assetId)
    editor.beginGesture('指定动画')
    editor.updateNode(node.id, { clipAssetId: assetId, clip: clips[0] ?? '', clipTime: 0, clipPlaying: true })
    editor.endGesture()
  }
}

export function saveMaterialFromSelection() {
  const editor = useEditorStore.getState()
  const id = editor.selection[editor.selection.length - 1]
  const node = id ? editor.nodes[id] : undefined
  if (!node || (node.kind !== 'model' && !isPaintable(node))) {
    editor.log('warn', '先选中一个网格或模型')
    return
  }
  const slot = node.slots[0] ? structuredClone(node.slots[0]) : slotFromNode(node)
  const name = uniqueAssetName(`${node.name} 材质`)
  useAssetStore.getState().add({ id: crypto.randomUUID(), name, kind: 'material', slot })
  editor.log('info', `已保存材质 ${name}`)
}

export function savePrefabFromSelection() {
  const editor = useEditorStore.getState()
  if (editor.selection.length === 0) {
    editor.log('warn', '先选中要保存的物体')
    return
  }
  const nodes = collectPrefabNodes(editor.nodes, editor.selection)
  if (nodes.length === 0) return
  const name = uniqueAssetName(`${nodes[0].name} 预制`)
  useAssetStore.getState().add({ id: crypto.randomUUID(), name, kind: 'prefab', nodes })
  editor.log('info', `已保存预制体 ${name}`)
}

export function previewAudio(asset: ProjectAsset) {
  if (asset.kind !== 'audio') return
  void new Audio(asset.url).play()
}

function kindFor(fileName: string): FileKind | null {
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
  return node.kind === 'box' || node.kind === 'sphere' || node.kind === 'plane' || node.kind === 'cylinder' || node.kind === 'capsule' || node.kind === 'model'
}

function referencedBy(assetId: string): string[] {
  const names: string[] = []
  for (const node of Object.values(useEditorStore.getState().nodes)) {
    if (usesAsset(node, assetId)) names.push(node.name)
  }
  for (const asset of Object.values(useAssetStore.getState().assets)) {
    if (asset.kind === 'prefab' && asset.nodes.some(node => usesAsset(node, assetId))) names.push(asset.name)
    if (asset.kind === 'material' && slotUses(asset.slot, assetId)) names.push(asset.name)
  }
  return names
}

function usesAsset(node: SceneNode, assetId: string): boolean {
  if (node.assetId === assetId || node.clipAssetId === assetId) return true
  if (slotUses(slotFromNode(node), assetId)) return true
  return node.slots.some(slot => slotUses(slot, assetId))
}

function slotUses(slot: PbrSlot, assetId: string): boolean {
  return [slot.mapAssetId, slot.normalAssetId, slot.roughnessAssetId, slot.metalnessAssetId, slot.emissiveAssetId, slot.aoAssetId].includes(assetId)
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
