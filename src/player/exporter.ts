import { getInputActionMap } from '../core/input/actionMap'
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { normalizeCapabilities } from '../capabilities/registry'
import {
  useBuildSettingsStore,
  loadBuildSettingsFromProject,
  type BuildSettings,
} from '../core/project/buildSettings'
import { diagnoseProject } from '../core/query/diagnose'
import { readModelArtifact } from '../editor/assets/cache'
import { useAssetStore, type ProjectAsset, type SceneAsset } from '../editor/assets/library'
import { loadModelTemplate } from '../editor/assets/models'
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
    if (Array.isArray(node.slots)) {
      for (const slot of node.slots) {
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
  }

  // 再展开一遍新增间接引用
  for (const id of [...collected]) addAsset(id)

  return [...collected]
}

async function cookTextureToWebp(
  bytes: Uint8Array,
  fileName: string,
  maxSize: number,
  convertToWebp: boolean,
): Promise<{ bytes: Uint8Array; extOverride?: string } | null> {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.ktx2') || lower.endsWith('.svg') || lower.endsWith('.tga')) return null
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
  const bitmap = await createImageBitmap(blob).catch(() => null)
  if (!bitmap) return null

  try {
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
) {
  const editor = useEditorStore.getState()
  const settings = settingsOverride ?? useBuildSettingsStore.getState().settings
  const builtScenes = resolveScenesForBuild(settings)
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
    assetSummary[id] = {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      url: rawUrl,
      fileName: nextFileName,
      clipCatalog: 'clipCatalog' in asset ? asset.clipCatalog : undefined,
      importScale: 'importScale' in asset ? asset.importScale : undefined,
      simulation: 'simulation' in asset ? asset.simulation : undefined,
      materialAssetId: 'materialAssetId' in asset ? asset.materialAssetId : undefined,
      quarksVersion: 'quarksVersion' in asset ? asset.quarksVersion : undefined,
      slot: asset.kind === 'material' ? asset.slot : undefined,
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

  const scenesMap: Record<string, ExportedSceneData> = {}
  for (const sc of builtScenes) scenesMap[sc.id] = sc

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

  // 拷贝 & 烘焙资产到 contentDir/project-assets/
  const assetUrlOverrides: Record<string, string> = {}
  const assetExtOverrides: Record<string, string> = {}
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

    if (!outBytes) {
      const raw = await readAssetBytes(asset.id).catch(() => null)
      if (!raw) continue
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
  }

  reportProgress?.({ phase: 'write', current: 1, total: 1, label: '正在写入工程配置与清单…' })
  const includedIds = settings.stripUnusedAssets ? requiredSet : undefined
  const payload = buildExportedProjectPayload(assetUrlOverrides, assetExtOverrides, settings, includedIds)
  const projectFile = joinProjectPath(contentDir, 'project.t3d.json')
  const inputFile = joinProjectPath(contentDir, 'input.json')
  const manifestFile = joinProjectPath(contentDir, 'export-manifest.json')

  await bridge.fs.writeTextFile(projectFile, `${JSON.stringify(payload, null, 2)}\n`)
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
