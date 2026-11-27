import { getInputActionMap } from '../core/input/actionMap'
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { normalizeCapabilities } from '../capabilities/registry'
import {
  useBuildSettingsStore,
  loadBuildSettingsFromProject,
  type BuildSettings,
} from '../core/project/buildSettings'
import { diagnoseProject } from '../core/query/diagnose'
import { readModelArtifact, readTextureArtifact } from '../editor/assets/cache'
import { ensureScenesLoaded, useAssetStore, type ProjectAsset, type SceneAsset } from '../editor/assets/library'
import { applyModelMaterialBindings, getModelTemplate, loadModelTemplate } from '../editor/assets/models'
import { bakeTextureArtifact, bakeUnityMrTextureArtifact } from '../editor/assets/textures'
import { trimBc7ArtifactToMaxSize } from '../runtime/engine/bc7'
import { readUnpremultipliedRgba } from '../runtime/engine/textures'
import { assetRecord, directoryProjectName, readAssetBytes } from '../editor/project/disk'
import { electronBridge, joinProjectPath } from '../editor/project/electronBridge'
import { useEditorStore } from '../editor/scene/store'
import type { PbrSlot, SceneNode, ScenePicture } from '../editor/scene/types'
import { collectUiImageIds } from '../runtime/ui/tree'

export interface WebExportResult {
  ok: boolean
  outputDir: string
  files: string[]
  shellCopied: boolean
  executablePath?: string
  message: string
}

export interface BuildProgressInfo {
  phase: 'prepare' | 'cook' | 'write' | 'package'
  current: number
  total: number
  label: string
}

export interface ExportedSceneData {
  id: string
  name: string
  nodes: Record<string, SceneNode>
  picture: ScenePicture
  requiredAssetIds: string[]
}

const SLOT_TEX_KEYS: Array<keyof PbrSlot> = [
  'mapAssetId',
  'normalAssetId',
  'metallicRoughnessAssetId',
  'roughnessAssetId',
  'metalnessAssetId',
  'emissiveAssetId',
  'aoAssetId',
  'clearcoatMapAssetId',
  'clearcoatRoughnessMapAssetId',
  'clearcoatNormalMapAssetId',
]

function scanUnknownRefs(val: unknown, assets: Record<string, ProjectAsset>, out: Set<string>, depth = 0): void {
  if (depth > 5 || val === null || val === undefined) return
  if (typeof val === 'string') {
    if (val in assets) out.add(val)
    return
  }
  if (Array.isArray(val)) {
    for (const item of val) scanUnknownRefs(item, assets, out, depth + 1)
    return
  }
  if (typeof val === 'object') {
    for (const v of Object.values(val as Record<string, unknown>)) {
      scanUnknownRefs(v, assets, out, depth + 1)
    }
  }
}

function collectSlotDeps(slot: PbrSlot | undefined, assets: Record<string, ProjectAsset>, out: Set<string>) {
  if (!slot) return
  for (const key of SLOT_TEX_KEYS) {
    const ref = slot[key]
    if (typeof ref === 'string' && ref in assets) out.add(ref)
  }
  if (slot.shaderParams) {
    scanUnknownRefs(slot.shaderParams, assets, out)
  }
}

function resolveEffectiveNodeSlots(node: SceneNode): PbrSlot[] | undefined {
  const tplSlots = node.kind === 'model' && node.assetId ? getModelTemplate(node.assetId)?.slots : undefined
  if (!Array.isArray(node.slots) || node.slots.length === 0) {
    return tplSlots
  }
  if (!tplSlots || tplSlots.length === 0) {
    return node.slots
  }
  const tplByName = new Map(tplSlots.map((s) => [s.name, s]))
  return node.slots.map((slot, idx) => {
    const fresh = tplByName.get(slot.name) ?? tplSlots[idx]
    if (!fresh) return slot
    const sameOrUnsetMat = !slot.materialAssetId || slot.materialAssetId === fresh.materialAssetId
    return {
      ...fresh,
      ...slot,
      materialAssetId: slot.materialAssetId ?? fresh.materialAssetId,
      shader: slot.shader ?? fresh.shader,
      mapAssetId: slot.mapAssetId ?? (sameOrUnsetMat ? fresh.mapAssetId : null),
      normalAssetId: slot.normalAssetId ?? (sameOrUnsetMat ? fresh.normalAssetId : null),
      metallicRoughnessAssetId: slot.metallicRoughnessAssetId ?? (sameOrUnsetMat ? fresh.metallicRoughnessAssetId : null),
      emissiveAssetId: slot.emissiveAssetId ?? (sameOrUnsetMat ? fresh.emissiveAssetId : null),
      aoAssetId: slot.aoAssetId ?? (sameOrUnsetMat ? fresh.aoAssetId : null),
    }
  })
}

export function collectSceneDependencies(
  nodes: Record<string, SceneNode>,
  picture: ScenePicture | undefined,
  assets: Record<string, ProjectAsset>,
  extraAssetIds: Array<string | null | undefined> = [],
): string[] {
  const collected = new Set<string>()
  const visitedAssets = new Set<string>()

  const addAsset = (id: string | null | undefined) => {
    if (!id || !(id in assets)) return
    collected.add(id)
    if (visitedAssets.has(id)) return
    visitedAssets.add(id)
    const asset = assets[id]
    if (asset.kind === 'material') {
      collectSlotDeps(asset.slot, assets, collected)
      // 递归收集刚加入的贴图
      for (const dep of [...collected]) addAsset(dep)
    } else if (asset.kind === 'prefab') {
      for (const dep of collectSceneDependencies(asset.nodes, undefined, assets)) {
        addAsset(dep)
      }
    } else if (asset.kind === 'ui') {
      const uiImgs = new Set<string>()
      collectUiImageIds(asset.document.root, uiImgs)
      for (const imgId of uiImgs) {
        addAsset(imgId)
      }
    } else if (asset.kind === 'model') {
      if ('materialAssetId' in asset && typeof asset.materialAssetId === 'string') {
        addAsset(asset.materialAssetId)
      }
      if ('materialHint' in asset && asset.materialHint) {
        scanUnknownRefs(asset.materialHint, assets, collected)
      }
    } else if (asset.kind === 'effect') {
      if ('materialAssetId' in asset && typeof asset.materialAssetId === 'string') {
        addAsset(asset.materialAssetId)
      }
      if ('simulation' in asset && asset.simulation) {
        scanUnknownRefs(asset.simulation, assets, collected)
      }
    } else if (asset.kind === 'cutscene') {
      if ('sequence' in asset && asset.sequence) {
        scanUnknownRefs(asset.sequence, assets, collected)
      }
    }
  }

  for (const id of extraAssetIds) addAsset(id)

  if (picture) {
    if ('envAssetId' in picture && typeof picture.envAssetId === 'string') addAsset(picture.envAssetId)
    if ('environmentAssetId' in picture && typeof picture.environmentAssetId === 'string') addAsset(picture.environmentAssetId)
    if (picture.capabilities) scanUnknownRefs(picture.capabilities, assets, collected)
  }

  for (const node of Object.values(nodes)) {
    if (node.assetId) addAsset(node.assetId)
    if (node.materialAssetId) addAsset(node.materialAssetId)
    if (node.mapAssetId) addAsset(node.mapAssetId)
    if (node.normalAssetId) addAsset(node.normalAssetId)
    if (node.metallicRoughnessAssetId) addAsset(node.metallicRoughnessAssetId)
    if (node.roughnessAssetId) addAsset(node.roughnessAssetId)
    if (node.metalnessAssetId) addAsset(node.metalnessAssetId)
    if (node.emissiveAssetId) addAsset(node.emissiveAssetId)
    if (node.aoAssetId) addAsset(node.aoAssetId)
    if (node.clipAssetId) addAsset(node.clipAssetId)
    if (node.overlayAssetId) addAsset(node.overlayAssetId)
    if (node.screen?.documentId) addAsset(node.screen.documentId)
    if (node.effect) {
      if (node.effect.assetId) addAsset(node.effect.assetId)
      if (node.effect.materialAssetId) addAsset(node.effect.materialAssetId)
      if (node.effect.simulation) scanUnknownRefs(node.effect.simulation, assets, collected)
    }
    const effectiveSlots = resolveEffectiveNodeSlots(node)
    if (Array.isArray(effectiveSlots)) {
      for (const slot of effectiveSlots) {
        if (slot.materialAssetId) addAsset(slot.materialAssetId)
        collectSlotDeps(slot, assets, collected)
      }
    }
    if (node.partOverrides) {
      for (const ov of Object.values(node.partOverrides)) {
        if (ov.materialAssetId) addAsset(ov.materialAssetId)
      }
    }
    if (node.animator) scanUnknownRefs(node.animator, assets, collected)
    if (node.capabilities) scanUnknownRefs(node.capabilities, assets, collected)
    if (node.gameplay) scanUnknownRefs(node.gameplay, assets, collected)
    // 仅当节点实际挂有角色/运动/状态机/默认剪辑或脚本组件时，才兜底拉入工程内的独立 animation 资产（纯静态场景不再无差别预载全部动作文件）
    const hasNodeScripts = Boolean(node.gameplay?.packs && Object.keys(node.gameplay.packs).length > 0)
    const hasProjectScripts = hasNodeScripts && Object.values(useCodeAssetStore.getState().assets).some((a) => a.kind === 'script')
    if (
      node.gameplay?.character ||
      node.gameplay?.locomotion ||
      node.animator ||
      node.clip ||
      node.overlayClip ||
      hasProjectScripts
    ) {
      for (const a of Object.values(assets)) {
        if (a.kind === 'animation') addAsset(a.id)
      }
    }
  }

  // 再展开一遍新增间接引用
  for (const id of [...collected]) addAsset(id)

  return [...collected]
}

function collectTextureChannelRoles(
  builtScenes: readonly ExportedSceneData[],
  allAssets: Record<string, ProjectAsset>,
  settings: BuildSettings,
): { unityMrTexIds: Set<string>; standardTexIds: Set<string> } {
  const unityMrTexIds = new Set<string>()
  const standardTexIds = new Set<string>()

  const markStandard = (id: string | null | undefined) => {
    if (id && allAssets[id]?.kind === 'texture') standardTexIds.add(id)
  }
  const markUnityMr = (id: string | null | undefined) => {
    if (id && allAssets[id]?.kind === 'texture') unityMrTexIds.add(id)
  }
  const scanUnknownAsStandard = (val: unknown, depth = 0): void => {
    if (depth > 5 || val === null || val === undefined) return
    if (typeof val === 'string') {
      markStandard(val)
      return
    }
    if (Array.isArray(val)) {
      for (const item of val) scanUnknownAsStandard(item, depth + 1)
      return
    }
    if (typeof val === 'object') {
      for (const v of Object.values(val as Record<string, unknown>)) scanUnknownAsStandard(v, depth + 1)
    }
  }
  const visitSlot = (slot: Partial<PbrSlot> | undefined) => {
    if (!slot) return
    const linkedMat = slot.materialAssetId ? allAssets[slot.materialAssetId] : undefined
    const effectiveShader = (linkedMat && linkedMat.kind === 'material' ? linkedMat.slot.shader : undefined) ?? slot.shader ?? 'lit'
    const isUnity = effectiveShader === 'unity-standard'
    const normalId = slot.normalAssetId ?? null
    markStandard(slot.mapAssetId)
    markStandard(normalId)
    markStandard(slot.emissiveAssetId)
    markStandard(slot.aoAssetId)
    markStandard(slot.clearcoatMapAssetId)
    markStandard(slot.clearcoatRoughnessMapAssetId)
    markStandard(slot.clearcoatNormalMapAssetId)
    const mrId = slot.metallicRoughnessAssetId ?? slot.metalnessAssetId ?? slot.roughnessAssetId ?? null
    if (mrId && mrId !== normalId) {
      if (isUnity) markUnityMr(mrId)
      else markStandard(mrId)
    }
    if (!isUnity) {
      markStandard(slot.roughnessAssetId)
      markStandard(slot.metalnessAssetId)
    }
    if (slot.shaderParams) scanUnknownAsStandard(slot.shaderParams)
  }

  markStandard(settings.loading.logoAssetId)
  markStandard(settings.loading.backgroundAssetId)
  markStandard(settings.electron.iconAssetId)

  for (const asset of Object.values(allAssets)) {
    if (asset.kind === 'material') {
      visitSlot(asset.slot)
    } else if (asset.kind === 'model') {
      for (const slot of getModelTemplate(asset.id)?.slots ?? []) visitSlot(slot)
    } else if (asset.kind === 'ui') {
      const uiImgs = new Set<string>()
      collectUiImageIds(asset.document.root, uiImgs)
      for (const id of uiImgs) markStandard(id)
    } else if (asset.kind === 'effect') {
      if ('simulation' in asset && asset.simulation) scanUnknownAsStandard(asset.simulation)
    }
  }

  const visitNodes = (nodes: Record<string, SceneNode>, picture?: ScenePicture) => {
    if (picture?.capabilities) scanUnknownAsStandard(picture.capabilities)
    for (const node of Object.values(nodes)) {
      visitSlot(node)
      for (const slot of resolveEffectiveNodeSlots(node) ?? []) visitSlot(slot)
      if (node.effect?.simulation) scanUnknownAsStandard(node.effect.simulation)
      if (node.capabilities) scanUnknownAsStandard(node.capabilities)
      if (node.gameplay) scanUnknownAsStandard(node.gameplay)
    }
  }
  for (const sc of builtScenes) visitNodes(sc.nodes, sc.picture)
  for (const asset of Object.values(allAssets)) {
    if (asset.kind === 'prefab') visitNodes(asset.nodes)
  }

  return { unityMrTexIds, standardTexIds }
}

function isPackedOrDataTexture(fileName: string): boolean {
  const stem = fileName.replace(/\.[^.]+$/, '').trim()
  return /(?:[_-\s]+)(?:normal|norm|nrm|nor|bump|n|metallicgloss|metallicsmoothness|maskmap|mask|ms|metallicroughness|metalrough|orm|arm|metallic|metalness|metal|roughness|rough|gloss|m|occlusion|ambientocclusion|ao|occ)$/i.test(stem)
}

async function cookTextureToWebp(
  bytes: Uint8Array,
  fileName: string,
  maxSize: number,
  convertToWebp: boolean,
): Promise<{ bytes: Uint8Array; extOverride?: string } | null> {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.ktx2') || lower.endsWith('.svg') || lower.endsWith('.tga')) return null
  // 法线贴图与 Unity MetallicGloss / ORM 通道贴图绝不能经 2D Canvas 有损 WebP 压缩（2D Canvas 预乘 Alpha 会把 A=0 粗糙区域的 RGB 清零，有损 WebP 也会破坏切线法线向量）
  if (isPackedOrDataTexture(fileName)) return null
  if (!convertToWebp && maxSize <= 0) return null
  if (typeof createImageBitmap !== 'function') return null

  const mime = lower.endsWith('.png')
    ? 'image/png'
    : lower.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg'
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = new Blob([copy.buffer], { type: mime })
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: 'none',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  }).catch(() => null)
  if (!bitmap) return null

  try {
    // 若贴图含有透明像素（A < 250），跳过 2D Canvas 重编码，防止 2D Canvas 预乘 Alpha 把 A=0 区域的 RGB 清零变成全黑
    if (!lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) {
      try {
        const rgba = readUnpremultipliedRgba(bitmap, bitmap.width, bitmap.height)
        for (let i = 3; i < rgba.length; i += 16) {
          if ((rgba[i] ?? 255) < 250) return null
        }
      } catch {
        return null
      }
    }
    let targetW = bitmap.width
    let targetH = bitmap.height
    const longest = Math.max(targetW, targetH)
    const needsResize = maxSize > 0 && longest > maxSize
    if (needsResize) {
      const scale = maxSize / longest
      targetW = Math.max(1, Math.round(targetW * scale))
      targetH = Math.max(1, Math.round(targetH * scale))
    }
    if (!convertToWebp && !needsResize) return null

    const outMime = convertToWebp ? 'image/webp' : mime
    let outBlob: Blob | null = null
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(targetW, targetH)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0, targetW, targetH)
      outBlob = await canvas.convertToBlob({ type: outMime, quality: 0.88 })
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0, targetW, targetH)
      outBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outMime, 0.88))
    }
    if (!outBlob) return null
    const buf = await outBlob.arrayBuffer()
    if (!convertToWebp && buf.byteLength >= bytes.byteLength && !needsResize) return null
    return {
      bytes: new Uint8Array(buf),
      extOverride: convertToWebp ? '.webp' : undefined,
    }
  } finally {
    bitmap.close()
  }
}

export function resolveScenesForBuild(settings: BuildSettings): ExportedSceneData[] {
  useEditorStore.getState().flushActiveScene()
  const editor = useEditorStore.getState()
  const assets = useAssetStore.getState().assets
  const sceneAssets: Record<string, SceneAsset> = {}
  for (const a of Object.values(assets)) {
    if (a.kind === 'scene') sceneAssets[a.id] = a
  }

  const enabledIds = settings.scenes.filter((s) => s.enabled && sceneAssets[s.sceneId]).map((s) => s.sceneId)
  if (enabledIds.length === 0 && editor.activeSceneId) {
    enabledIds.push(editor.activeSceneId)
  }

  const extra = [settings.loading.logoAssetId, settings.loading.backgroundAssetId]
  const result: ExportedSceneData[] = []

  for (const sceneId of enabledIds) {
    const isActive = sceneId === editor.activeSceneId
    const sc = sceneAssets[sceneId]
    const nodes = isActive ? editor.nodes : (sc?.nodes ?? {})
    const picture = isActive ? editor.picture : (sc?.picture ?? editor.picture)
    const name = sc?.name ?? (isActive ? '主场景' : sceneId)
    const requiredAssetIds = collectSceneDependencies(nodes, picture, assets, extra)
    result.push({ id: sceneId, name, nodes, picture, requiredAssetIds })
  }

  return result
}

export function buildExportedProjectPayload(
  assetUrlOverrides?: Record<string, string>,
  assetExtOverrides?: Record<string, string>,
  settingsOverride?: BuildSettings,
  includedAssetIds?: Set<string>,
  assetBc7Overrides?: Record<string, { bc7Url?: string; unityMrBc7Url?: string; onlyUnityMr?: boolean }>,
  sceneUrlOverrides?: Record<string, string>,
  builtScenesOverride?: ExportedSceneData[],
) {
  const editor = useEditorStore.getState()
  const settings = settingsOverride ?? useBuildSettingsStore.getState().settings
  const builtScenes = builtScenesOverride ?? resolveScenesForBuild(settings)
  const entryId = builtScenes.some((s) => s.id === settings.entrySceneId)
    ? settings.entrySceneId
    : (builtScenes[0]?.id ?? editor.activeSceneId)
  const entryScene = builtScenes.find((s) => s.id === entryId) ?? builtScenes[0]

  const assets = useAssetStore.getState().assets
  const assetSummary: Record<string, unknown> = {}
  for (const [id, asset] of Object.entries(assets)) {
    if (includedAssetIds && !includedAssetIds.has(id)) continue
    const rawUrl = assetUrlOverrides?.[id] ?? ('url' in asset ? asset.url : undefined)
    const origFileName = 'fileName' in asset ? asset.fileName : undefined
    const nextFileName = origFileName && assetExtOverrides?.[id]
      ? origFileName.replace(/\.[^.]+$/, '') + assetExtOverrides[id]
      : origFileName
    const bc7Info = assetBc7Overrides?.[id]
    assetSummary[id] = {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      url: rawUrl,
      ...(bc7Info?.bc7Url ? { bc7Url: bc7Info.bc7Url } : {}),
      ...(bc7Info?.unityMrBc7Url ? { unityMrBc7Url: bc7Info.unityMrBc7Url } : {}),
      ...(bc7Info?.onlyUnityMr ? { onlyUnityMr: true } : {}),
      fileName: nextFileName,
      clipCatalog: 'clipCatalog' in asset ? asset.clipCatalog : undefined,
      importScale: 'importScale' in asset ? asset.importScale : undefined,
      humanoidAvatar: 'humanoidAvatar' in asset ? asset.humanoidAvatar : undefined,
      humanoidRetarget: 'humanoidRetarget' in asset ? asset.humanoidRetarget : undefined,
      simulation: 'simulation' in asset ? asset.simulation : undefined,
      materialAssetId: 'materialAssetId' in asset ? asset.materialAssetId : undefined,
      quarksVersion: 'quarksVersion' in asset ? asset.quarksVersion : undefined,
      slot: asset.kind === 'material' ? asset.slot : undefined,
      slots: asset.kind === 'model' ? getModelTemplate(id)?.slots : undefined,
      document: asset.kind === 'ui' ? asset.document : undefined,
      nodes: asset.kind === 'prefab' ? asset.nodes : undefined,
    }
  }

  const codeAssets = Object.values(useCodeAssetStore.getState().assets)
  const scripts = codeAssets
    .filter((item) => item.kind === 'script')
    .map((item) => ({ id: item.id, relativePath: item.relativePath, source: item.source }))
  const shaders = codeAssets
    .filter((item) => item.kind === 'shader')
    .map((item) => ({ id: item.id, relativePath: item.relativePath, source: item.source }))

  const scenesMap: Record<string, unknown> = {}
  for (const sc of builtScenes) {
    const extUrl = sceneUrlOverrides?.[sc.id]
    if (extUrl) {
      // 入口场景已内联在顶层 payload.nodes / payload.picture，其余场景拆分到独立 JSON 按需加载，避免大工程启动时解析几十 MB 的重复 JSON
      scenesMap[sc.id] = {
        id: sc.id,
        name: sc.name,
        requiredAssetIds: sc.requiredAssetIds,
        sceneUrl: extUrl,
      }
    } else {
      scenesMap[sc.id] = sc
    }
  }

  return {
    version: 2,
    name: directoryProjectName() || settings.electron.appName || 'Tact3D Game',
    activeSceneId: entryId,
    entrySceneId: entryId,
    nodes: entryScene?.nodes ?? editor.nodes,
    picture: entryScene?.picture ?? editor.picture,
    scenes: scenesMap,
    sceneOrder: builtScenes.map((s) => s.id),
    buildSettings: settings,
    capabilities: normalizeCapabilities(editor.capabilities),
    gameplayPacks: editor.gameplayPacks,
    gameDatabase: editor.gameDatabase,
    assets: assetSummary,
    scripts,
    shaders,
    inputMap: getInputActionMap(),
  }
}

async function renderIconAssetToPngBytes(assetId: string | null | undefined): Promise<number[] | undefined> {
  if (!assetId) return undefined
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset || asset.kind !== 'texture') return undefined
  const raw = await readAssetBytes(assetId).catch(() => null)
  if (!raw || raw.byteLength === 0) return undefined
  if (typeof createImageBitmap !== 'function') return undefined

  const lower = ('fileName' in asset && asset.fileName ? asset.fileName : '').toLowerCase()
  const mime = lower.endsWith('.png')
    ? 'image/png'
    : lower.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg'
  const copy = new Uint8Array(raw.byteLength)
  copy.set(new Uint8Array(raw))
  const bitmap = await createImageBitmap(new Blob([copy.buffer], { type: mime })).catch(() => null)
  if (!bitmap) return undefined

  try {
    const size = 512
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = Math.floor((bitmap.width - side) / 2)
    const sy = Math.floor((bitmap.height - side) / 2)

    let outBlob: Blob | null = null
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(size, size)
      const ctx = canvas.getContext('2d')
      if (!ctx) return undefined
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
      outBlob = await canvas.convertToBlob({ type: 'image/png' })
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return undefined
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
      outBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    }
    if (!outBlob) return undefined
    const buf = await outBlob.arrayBuffer()
    return Array.from(new Uint8Array(buf))
  } finally {
    bitmap.close()
  }
}

export async function exportWebPlayerBundle(
  targetDir: string,
  options?: { settings?: BuildSettings; onProgress?: (info: BuildProgressInfo) => void },
): Promise<WebExportResult> {
  const cleanDir = targetDir.trim().replace(/[\\/]+$/, '')
  if (!cleanDir) {
    return { ok: false, outputDir: '', files: [], shellCopied: false, message: '导出目录不能为空' }
  }
  const bridge = electronBridge()
  if (!bridge?.fs?.writeTextFile || !bridge?.fs?.mkdir) {
    return {
      ok: false,
      outputDir: cleanDir,
      files: [],
      shellCopied: false,
      message: '当前环境不支持本地文件系统写入，请在 Electron 桌面端执行构建',
    }
  }

  const reportProgress = options?.onProgress
  // 没打开的场景只有文件头在内存里，打包前把节点全部读进来。
  await ensureScenesLoaded()
  useEditorStore.getState().flushActiveScene()
  const editor = useEditorStore.getState()
  const allAssets = useAssetStore.getState().assets
  const sceneIds = Object.values(allAssets).filter((a) => a.kind === 'scene').map((a) => a.id)
  const settings = options?.settings ?? (await loadBuildSettingsFromProject(sceneIds, editor.activeSceneId))

  reportProgress?.({ phase: 'prepare', current: 0, total: 1, label: '正在准备输出目录…' })
  await bridge.fs.authorizeRoot?.(cleanDir)
  await bridge.fs.mkdir(cleanDir)

  const files: string[] = []
  let shellCopied = false
  let shellNote = ''
  let contentDir = cleanDir
  let executablePath: string | undefined

  if (settings.target === 'electron') {
    if (!bridge.player?.buildElectron) {
      return {
        ok: false,
        outputDir: cleanDir,
        files: [],
        shellCopied: false,
        message: '当前 Electron 主进程版本不支持 buildElectron 接口',
      }
    }
    reportProgress?.({ phase: 'package', current: 0, total: 1, label: '正在初始化 Electron 桌面端外壳…' })
    const iconPngBytes = await renderIconAssetToPngBytes(settings.electron.iconAssetId)
    const elecRes = await bridge.player.buildElectron(cleanDir, {
      ...settings.electron,
      iconPngBytes,
    })
    if (!elecRes.ok) {
      return { ok: false, outputDir: cleanDir, files: [], shellCopied: false, message: elecRes.message }
    }
    contentDir = elecRes.appDir
    executablePath = elecRes.executablePath || undefined
    shellCopied = elecRes.runtimeCopied
    if (!elecRes.runtimeCopied) shellNote = `（${elecRes.message}）`
  } else if (bridge.player?.copyShell) {
    const shellRes = await bridge.player.copyShell(cleanDir)
    shellCopied = shellRes.ok
    if (shellRes.ok) {
      files.push(...shellRes.copiedFiles)
    } else {
      shellNote = `（${shellRes.message}）`
    }
  }

  const builtScenes = resolveScenesForBuild(settings)
  // 预加载模型模板以提取自动推断的材质槽位与重定向剪辑，并重新汇总依赖
  for (const sc of builtScenes) {
    for (const node of Object.values(sc.nodes)) {
      if (node.kind === 'model' && node.assetId) {
        const modelAsset = allAssets[node.assetId]
        if (modelAsset && modelAsset.kind === 'model') {
          await loadModelTemplate(modelAsset).catch(() => null)
          applyModelMaterialBindings(node.assetId)
        }
      }
    }
    const extra = [settings.loading.logoAssetId, settings.loading.backgroundAssetId]
    sc.requiredAssetIds = collectSceneDependencies(sc.nodes, sc.picture, allAssets, extra)
  }
  const requiredSet = new Set<string>()
  if (settings.stripUnusedAssets) {
    for (const sc of builtScenes) {
      for (const id of sc.requiredAssetIds) requiredSet.add(id)
    }
    if (settings.loading.logoAssetId) requiredSet.add(settings.loading.logoAssetId)
    if (settings.loading.backgroundAssetId) requiredSet.add(settings.loading.backgroundAssetId)
  }

  const targetAssets = Object.values(allAssets).filter((a) => {
    if (a.kind === 'scene') return false
    if (!settings.stripUnusedAssets) return true
    return requiredSet.has(a.id)
  })

  const { unityMrTexIds, standardTexIds } = collectTextureChannelRoles(builtScenes, allAssets, settings)

  // 拷贝 & 烘焙资产到 contentDir/project-assets/
  const assetUrlOverrides: Record<string, string> = {}
  const assetExtOverrides: Record<string, string> = {}
  const assetBc7Overrides: Record<string, { bc7Url?: string; unityMrBc7Url?: string; onlyUnityMr?: boolean }> = {}
  const totalCount = Math.max(1, targetAssets.length)

  for (let i = 0; i < targetAssets.length; i += 1) {
    const asset = targetAssets[i]
    reportProgress?.({
      phase: 'cook',
      current: i + 1,
      total: totalCount,
      label: `正在处理资源 (${i + 1}/${targetAssets.length})：${asset.name}`,
    })

    const record = assetRecord(asset.id)
    const fallbackRel = 'fileName' in asset && asset.fileName ? `assets/${asset.id}-${asset.fileName}` : ''
    let rel = (record?.relativePath || fallbackRel).replace(/\\/g, '/').replace(/^\/+/, '')
    if (!rel) continue

    let outBytes: Uint8Array | null = null
    if ((asset.kind === 'model' || asset.kind === 'animation') && settings.bakeModelsToGlb && 'hash' in asset) {
      let baked = asset.hash ? await readModelArtifact(asset.hash).catch(() => null) : null
      if (!baked) {
        const tpl = await loadModelTemplate(asset).catch(() => null)
        if (asset.hash) baked = await readModelArtifact(asset.hash).catch(() => null)
        if (!baked && tpl) {
          const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
          const exporter = new GLTFExporter()
          const glbData = await exporter.parseAsync(tpl.scene, {
            binary: true,
            animations: tpl.clips,
            onlyVisible: false,
          }).catch(() => null)
          if (glbData instanceof ArrayBuffer) baked = glbData
          else if (ArrayBuffer.isView(glbData)) {
            baked = glbData.buffer.slice(glbData.byteOffset, glbData.byteOffset + glbData.byteLength) as ArrayBuffer
          }
        }
      }
      if (baked && baked.byteLength > 0) {
        outBytes = new Uint8Array(baked)
        rel = rel.replace(/\.[^.]+$/, '') + '.glb'
        assetExtOverrides[asset.id] = '.glb'
      }
    }

    let rawSourceBuf: ArrayBuffer | null = null
    if (!outBytes) {
      const raw = await readAssetBytes(asset.id).catch(() => null)
      if (!raw) continue
      rawSourceBuf = raw
      const rawBytes = new Uint8Array(raw)
      outBytes = rawBytes
      if (asset.kind === 'texture' && 'fileName' in asset) {
        const cookedTex = await cookTextureToWebp(
          rawBytes,
          asset.fileName,
          settings.textureMaxSize,
          settings.textureMode === 'webp',
        ).catch(() => null)
        if (cookedTex) {
          outBytes = cookedTex.bytes
          if (cookedTex.extOverride) {
            rel = rel.replace(/\.[^.]+$/, '') + cookedTex.extOverride
            assetExtOverrides[asset.id] = cookedTex.extOverride
          }
        }
      }
    }

    const destPath = joinProjectPath(contentDir, `project-assets/${rel}`)
    const parentDir = destPath.slice(0, destPath.lastIndexOf('/'))
    if (parentDir) await bridge.fs.mkdir(parentDir)
    const writeBuf = outBytes.buffer instanceof ArrayBuffer && outBytes.byteOffset === 0 && outBytes.byteLength === outBytes.buffer.byteLength
      ? outBytes.buffer
      : outBytes.slice().buffer
    await bridge.fs.writeBinaryFile(destPath, writeBuf)
    assetUrlOverrides[asset.id] = `./project-assets/${rel}`
    files.push(destPath)

    // 桌面端额外带上 BC7 压缩成品（原图仍保留作回退：用于启动封面/图标，以及不支持 BC7 的显卡）
    if (
      settings.target === 'electron'
      && settings.desktopBc7Textures
      && asset.kind === 'texture'
      && 'hash' in asset && asset.hash
      && 'fileName' in asset
    ) {
      const needsUnityMr = unityMrTexIds.has(asset.id)
      const exclusivelyUnityMr = needsUnityMr && !standardTexIds.has(asset.id)
      let wroteUnityMrBc7 = false

      if (needsUnityMr) {
        let mrBc7Buf = await readTextureArtifact(asset.hash, 'unity-mr-bc7').catch(() => null)
        if (!mrBc7Buf) {
          const source = rawSourceBuf ?? (await readAssetBytes(asset.id).catch(() => null))
          if (source) {
            rawSourceBuf = source
            await bakeUnityMrTextureArtifact(asset, new Blob([source])).catch(() => false)
            mrBc7Buf = await readTextureArtifact(asset.hash, 'unity-mr-bc7').catch(() => null)
          }
        }
        const trimmedMrBc7 = mrBc7Buf ? trimBc7ArtifactToMaxSize(mrBc7Buf, settings.textureMaxSize) : null
        if (trimmedMrBc7 && trimmedMrBc7.byteLength > 0) {
          const mrRel = `${rel}.unity-mr.bc7`
          const mrDest = joinProjectPath(contentDir, `project-assets/${mrRel}`)
          await bridge.fs.writeBinaryFile(mrDest, trimmedMrBc7)
          assetBc7Overrides[asset.id] = {
            ...(assetBc7Overrides[asset.id] ?? {}),
            unityMrBc7Url: `./project-assets/${mrRel}`,
            ...(exclusivelyUnityMr ? { onlyUnityMr: true } : {}),
          }
          files.push(mrDest)
          wroteUnityMrBc7 = true
        }
      }

      // 仅用作 Unity 金属光滑图的贴图已有重排好的 unity-mr.bc7，无需再重复写出一份未重排的 .bc7
      if (!exclusivelyUnityMr || !wroteUnityMrBc7) {
        let bc7Buf = await readTextureArtifact(asset.hash, 'bc7').catch(() => null)
        if (!bc7Buf) {
          const source = rawSourceBuf ?? (await readAssetBytes(asset.id).catch(() => null))
          if (source) {
            rawSourceBuf = source
            await bakeTextureArtifact(asset, new Blob([source])).catch(() => false)
            bc7Buf = await readTextureArtifact(asset.hash, 'bc7').catch(() => null)
          }
        }
        const trimmedBc7 = bc7Buf ? trimBc7ArtifactToMaxSize(bc7Buf, settings.textureMaxSize) : null
        if (trimmedBc7 && trimmedBc7.byteLength > 0) {
          const bc7Rel = `${rel}.bc7`
          const bc7Dest = joinProjectPath(contentDir, `project-assets/${bc7Rel}`)
          await bridge.fs.writeBinaryFile(bc7Dest, trimmedBc7)
          assetBc7Overrides[asset.id] = { ...(assetBc7Overrides[asset.id] ?? {}), bc7Url: `./project-assets/${bc7Rel}` }
          files.push(bc7Dest)
        }
      }
    }
  }

  reportProgress?.({ phase: 'write', current: 1, total: 1, label: '正在写入工程配置与清单…' })
  const scenesDir = joinProjectPath(contentDir, 'scenes')
  await bridge.fs.mkdir(scenesDir)
  const sceneUrlOverrides: Record<string, string> = {}
  for (const sc of builtScenes) {
    const safeSceneFile = `${sc.id.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`
    const sceneDest = joinProjectPath(scenesDir, safeSceneFile)
    await bridge.fs.writeTextFile(sceneDest, JSON.stringify({ id: sc.id, name: sc.name, nodes: sc.nodes, picture: sc.picture }))
    sceneUrlOverrides[sc.id] = `./scenes/${safeSceneFile}`
    files.push(sceneDest)
  }

  const includedIds = settings.stripUnusedAssets ? requiredSet : undefined
  const payload = buildExportedProjectPayload(
    assetUrlOverrides,
    assetExtOverrides,
    settings,
    includedIds,
    assetBc7Overrides,
    sceneUrlOverrides,
    builtScenes,
  )
  const projectFile = joinProjectPath(contentDir, 'project.t3d.json')
  const inputFile = joinProjectPath(contentDir, 'input.json')
  const manifestFile = joinProjectPath(contentDir, 'export-manifest.json')

  await bridge.fs.writeTextFile(projectFile, JSON.stringify(payload))
  await bridge.fs.writeTextFile(inputFile, `${JSON.stringify(payload.inputMap, null, 2)}\n`)
  await bridge.fs.writeTextFile(
    manifestFile,
    `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        target: settings.target,
        projectName: payload.name,
        entrySceneId: payload.entrySceneId,
        sceneCount: builtScenes.length,
        assetCount: Object.keys(payload.assets).length,
        nodeCount: Object.keys(payload.nodes).length,
        capabilities: Object.keys(payload.capabilities).filter((k) => (payload.capabilities as Record<string, boolean>)[k]),
        shellCopied,
        executablePath,
        playerEntry: settings.target === 'electron' ? 'main.cjs' : shellCopied ? 'index.html' : 'player.html',
      },
      null,
      2,
    )}\n`,
  )
  files.push(projectFile, inputFile, manifestFile)

  return {
    ok: true,
    outputDir: cleanDir,
    files,
    shellCopied,
    executablePath,
    message:
      settings.target === 'electron'
        ? shellCopied
          ? `已构建 Electron 桌面端至 ${cleanDir}（可执行文件：${executablePath}）`
          : `已导出 Electron 资源包至 ${contentDir}${shellNote}`
        : shellCopied
          ? `已构建 Web 播放包至 ${cleanDir}（含 ${builtScenes.length} 个场景、${Object.keys(payload.assets).length} 个资源）`
          : `已导出项目数据至 ${cleanDir}${shellNote}`,
  }
}

export async function exportWebPlayerInteractive(
  settings?: BuildSettings,
  onProgress?: (info: BuildProgressInfo) => void,
): Promise<WebExportResult | null> {
  const bridge = electronBridge()
  const store = useEditorStore.getState()
  if (!bridge?.dialog?.showOpenDirectoryDialog) {
    store.log('warn', '当前为纯浏览器模式，请在 Electron 桌面端构建发布包')
    return null
  }
  const report = diagnoseProject()
  if (report.errorCount > 0) {
    store.log('warn', `构建提示：项目存在 ${report.errorCount} 个错误（仍继续构建）`)
  }
  const targetDir = await bridge.dialog.showOpenDirectoryDialog()
  if (!targetDir) return null
  const res = await exportWebPlayerBundle(targetDir, { settings, onProgress })
  store.log(res.ok ? 'info' : 'error', res.message)
  if (res.ok) {
    await bridge.shell?.openPath(res.outputDir).catch(() => undefined)
  }
  return res
}
