import { getInputActionMap } from '../core/input/actionMap'
import { useAssetStore } from '../editor/assets/library'
import { directoryProjectName } from '../editor/project/disk'
import { electronBridge } from '../editor/project/electronBridge'
import { useEditorStore } from '../editor/scene/store'

export interface WebExportResult {
  ok: boolean
  outputDir: string
  files: string[]
  message: string
}

export function buildExportedProjectPayload() {
  const editor = useEditorStore.getState()
  const assets = useAssetStore.getState().assets
  const assetSummary: Record<string, unknown> = {}
  for (const [id, asset] of Object.entries(assets)) {
    assetSummary[id] = {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      url: 'url' in asset ? asset.url : undefined,
      clipCatalog: 'clipCatalog' in asset ? asset.clipCatalog : undefined,
      simulation: 'simulation' in asset ? asset.simulation : undefined,
      materialAssetId: 'materialAssetId' in asset ? asset.materialAssetId : undefined,
      quarksVersion: 'quarksVersion' in asset ? asset.quarksVersion : undefined,
    }
  }
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
    inputMap: getInputActionMap(),
  }
}

export async function exportWebPlayerBundle(targetDir: string): Promise<WebExportResult> {
  const cleanDir = targetDir.trim().replace(/[\\/]+$/, '')
  if (!cleanDir) {
    return { ok: false, outputDir: '', files: [], message: '导出目录不能为空' }
  }
  const bridge = electronBridge()
  if (!bridge?.fs?.writeTextFile || !bridge?.fs?.mkdir) {
    return {
      ok: false,
      outputDir: cleanDir,
      files: [],
      message: '当前环境不支持本地文件系统写入，请在 Electron 桌面端执行导出',
    }
  }

  await bridge.fs.mkdir(cleanDir)
  const payload = buildExportedProjectPayload()
  const projectFile = `${cleanDir}/project.t3d.json`
  const inputFile = `${cleanDir}/input.json`
  const manifestFile = `${cleanDir}/export-manifest.json`

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
        playerEntry: 'player.html',
      },
      null,
      2,
    )}\n`,
  )

  return {
    ok: true,
    outputDir: cleanDir,
    files: [projectFile, inputFile, manifestFile],
    message: `已导出 Web 播放包数据至 ${cleanDir}（可配合 npm run build:player 产出的 dist-player 静态部署）`,
  }
}
