import { getInputActionMap } from '../core/input/actionMap'
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { diagnoseProject } from '../core/query/diagnose'
import { useAssetStore } from '../editor/assets/library'
import { assetRecord, directoryProjectName, readAssetBytes } from '../editor/project/disk'
import { electronBridge, joinProjectPath } from '../editor/project/electronBridge'
import { useEditorStore } from '../editor/scene/store'

export interface WebExportResult {
  ok: boolean
  outputDir: string
  files: string[]
  shellCopied: boolean
  message: string
}

export function buildExportedProjectPayload(assetUrlOverrides?: Record<string, string>) {
  const editor = useEditorStore.getState()
  const assets = useAssetStore.getState().assets
  const assetSummary: Record<string, unknown> = {}
  for (const [id, asset] of Object.entries(assets)) {
    const rawUrl = assetUrlOverrides?.[id] ?? ('url' in asset ? asset.url : undefined)
    assetSummary[id] = {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      url: rawUrl,
      clipCatalog: 'clipCatalog' in asset ? asset.clipCatalog : undefined,
      simulation: 'simulation' in asset ? asset.simulation : undefined,
      materialAssetId: 'materialAssetId' in asset ? asset.materialAssetId : undefined,
      quarksVersion: 'quarksVersion' in asset ? asset.quarksVersion : undefined,
    }
  }
  const codeAssets = Object.values(useCodeAssetStore.getState().assets)
  const scripts = codeAssets
    .filter((item) => item.kind === 'script')
    .map((item) => ({ id: item.id, relativePath: item.relativePath, source: item.source }))
  const shaders = codeAssets
    .filter((item) => item.kind === 'shader')
    .map((item) => ({ id: item.id, relativePath: item.relativePath, source: item.source }))

  return {
    version: 1,
    name: directoryProjectName() || 'T3D Game',
    activeSceneId: editor.activeSceneId,
    nodes: editor.nodes,
    picture: editor.picture,
    capabilities: editor.capabilities,
    gameplayPacks: editor.gameplayPacks,
    gameDatabase: editor.gameDatabase,
    assets: assetSummary,
    scripts,
    shaders,
    inputMap: getInputActionMap(),
  }
}

export async function exportWebPlayerBundle(targetDir: string): Promise<WebExportResult> {
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
      message: '当前环境不支持本地文件系统写入，请在 Electron 桌面端执行导出',
    }
  }

  await bridge.fs.authorizeRoot?.(cleanDir)
  await bridge.fs.mkdir(cleanDir)

  const files: string[] = []
  let shellCopied = false
  let shellNote = ''
  if (bridge.player?.copyShell) {
    const shellRes = await bridge.player.copyShell(cleanDir)
    shellCopied = shellRes.ok
    if (shellRes.ok) {
      files.push(...shellRes.copiedFiles)
    } else {
      shellNote = `（${shellRes.message}）`
    }
  }

  // 拷贝磁盘工程中的源资产到导出目录的 project-assets/，确保导出包自包含
  const assetUrlOverrides: Record<string, string> = {}
  const assets = useAssetStore.getState().assets
  for (const asset of Object.values(assets)) {
    const record = assetRecord(asset.id)
    if (!record?.relativePath) continue
    const bytes = await readAssetBytes(asset.id).catch(() => null)
    if (!bytes) continue
    const rel = record.relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
    const destPath = joinProjectPath(cleanDir, `project-assets/${rel}`)
    const parentDir = destPath.slice(0, destPath.lastIndexOf('/'))
    if (parentDir) await bridge.fs.mkdir(parentDir)
    await bridge.fs.writeBinaryFile(destPath, bytes)
    assetUrlOverrides[asset.id] = `./project-assets/${rel}`
    files.push(destPath)
  }

  const payload = buildExportedProjectPayload(assetUrlOverrides)
  const projectFile = joinProjectPath(cleanDir, 'project.t3d.json')
  const inputFile = joinProjectPath(cleanDir, 'input.json')
  const manifestFile = joinProjectPath(cleanDir, 'export-manifest.json')

  await bridge.fs.writeTextFile(projectFile, `${JSON.stringify(payload, null, 2)}\n`)
  await bridge.fs.writeTextFile(inputFile, `${JSON.stringify(payload.inputMap, null, 2)}\n`)
  await bridge.fs.writeTextFile(
    manifestFile,
    `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        projectName: payload.name,
        nodeCount: Object.keys(payload.nodes).length,
        capabilities: Object.keys(payload.capabilities).filter((k) => payload.capabilities[k]),
        shellCopied,
        playerEntry: shellCopied ? 'index.html' : 'player.html',
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
    message: shellCopied
      ? `已导出完整 Web 播放包至 ${cleanDir}（含 index.html 可直接静态托管运行）`
      : `已导出项目数据至 ${cleanDir}${shellNote}`,
  }
}

export async function exportWebPlayerInteractive(): Promise<WebExportResult | null> {
  const bridge = electronBridge()
  const store = useEditorStore.getState()
  if (!bridge?.dialog?.showOpenDirectoryDialog) {
    store.log('warn', '当前为纯浏览器模式，请在 Electron 桌面端导出 Web 播放包')
    return null
  }
  const report = diagnoseProject()
  if (report.errorCount > 0) {
    store.log('warn', `导出提示：项目存在 ${report.errorCount} 个错误（仍继续打包导出）`)
  }
  const targetDir = await bridge.dialog.showOpenDirectoryDialog()
  if (!targetDir) return null
  const res = await exportWebPlayerBundle(targetDir)
  store.log(res.ok ? 'info' : 'error', res.message)
  if (res.ok) {
    await bridge.shell?.openPath(res.outputDir).catch(() => undefined)
  }
  return res
}
