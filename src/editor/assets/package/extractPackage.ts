import { importExtractedBytes } from '../import'
import { useAssetStore } from '../library'
import { normalizeDir } from '../folders'
import { getModelTemplate, normalizeMaterialKey, retargetClipsOntoModel, type ModelMaterialHint } from '../models'
import { importUnityMatText, textureGuidRegex, UNITY_MAT_TEXTURE_PROPERTIES } from '../unityMaterial'
import { decodeTgaToRgba, encodeRgbaToPng } from '../ufbx/tgaTexture'
import type { PackageAssetScannerEntry, PackageMaterialBindingSource } from './packageAssetScanner'
import type { PackageModelAssetRole } from './packageAssetRoleGuess'

export interface PackageExtractionProgress {
  phase: 'textures' | 'models' | 'animations' | 'materials' | 'retarget'
  completed: number
  total: number
  fileName?: string
}

export function withReferencedTextures(
  selected: readonly PackageAssetScannerEntry[],
  all: readonly PackageAssetScannerEntry[],
  materialBindingSources?: readonly PackageMaterialBindingSource[],
): PackageAssetScannerEntry[] {
  const ids = new Set(selected.map(entry => entry.id))
  const textureByGuid = new Map<string, PackageAssetScannerEntry>()
  const materialByGuid = new Map<string, PackageAssetScannerEntry>()
  const materialByKey = new Map<string, PackageAssetScannerEntry>()
  for (const entry of all) {
    if (entry.kind === 'texture') {
      const guid = guidOf(entry.metaBytes)
      if (guid) textureByGuid.set(guid, entry)
    } else if (entry.kind === 'material') {
      const guid = guidOf(entry.metaBytes)
      if (guid) materialByGuid.set(guid, entry)
      const key = normalizeMaterialKey(entry.fileName.replace(/\.mat$/i, ''))
      if (key && !materialByKey.has(key)) materialByKey.set(key, entry)
    }
  }
  for (const entry of selected) {
    if (entry.kind !== 'model') continue
    if (entry.metaBytes) {
      const metaText = new TextDecoder().decode(entry.metaBytes)
      for (const alias of parseMetaExternalMaterialObjects(metaText)) {
        const mat = materialByGuid.get(alias.materialGuid)
        if (mat) ids.add(mat.id)
      }
    }
    const modelGuid = guidOf(entry.metaBytes)
    if (modelGuid && materialBindingSources?.length) {
      for (const source of materialBindingSources) {
        const text = new TextDecoder().decode(source.assetBytes)
        for (const renderer of parseRendererMaterials(text)) {
          if (renderer.meshGuid !== modelGuid) continue
          for (const matGuid of renderer.materialGuids) {
            const mat = materialByGuid.get(matGuid)
            if (mat) ids.add(mat.id)
          }
        }
      }
    }
    const dir = entry.originalPath.split('/').slice(0, -1).join('/').toLowerCase()
    for (const candidate of all) {
      if (candidate.kind !== 'material') continue
      const matDir = candidate.originalPath.split('/').slice(0, -1).join('/').toLowerCase()
      if (dir && (matDir === dir || matDir === `${dir}/materials` || matDir.startsWith(`${dir}/`))) {
        ids.add(candidate.id)
      }
    }
  }
  for (const entry of all) {
    if (entry.kind !== 'material' || !ids.has(entry.id)) continue
    const text = new TextDecoder().decode(entry.assetBytes)
    for (const property of UNITY_MAT_TEXTURE_PROPERTIES) {
      const guid = textureGuidRegex(text, property)
      const texture = guid ? textureByGuid.get(guid) : undefined
      if (texture) ids.add(texture.id)
    }
  }
  return all.filter(entry => ids.has(entry.id))
}

export async function extractPackageEntries(
  entries: readonly PackageAssetScannerEntry[],
  options: {
    targetDirectory: string
    directoryMode: 'flat' | 'preserve'
    mergeAnimations: boolean
    roles: Record<string, PackageModelAssetRole>
    carrierBodies: Record<string, string>
    materialBindingSources?: readonly PackageMaterialBindingSource[]
    onProgress?: (progress: PackageExtractionProgress) => void
  },
): Promise<{ imported: string[]; failed: Array<{ name: string; error: string }> }> {
  const imported: string[] = []
  const failed: Array<{ name: string; error: string }> = []
  const importedIds = new Map<string, string>()
  const guidToTexture = new Map<string, string>()
  const guidToMaterial = new Map<string, string>()
  const nameToMaterial = new Map<string, string>()
  const total = entries.length
  let completed = 0
  const report = (phase: PackageExtractionProgress['phase'], fileName?: string) => {
    options.onProgress?.({ phase, completed, total, fileName })
  }
  const textures = entries.filter(entry => entry.kind === 'texture')
  const materials = entries.filter(entry => entry.kind === 'material')
  const models = entries.filter(entry => entry.kind !== 'texture' && entry.kind !== 'material')

  // 1. 先导贴图（记录 GUID -> 贴图 AssetId）
  for (const entry of textures) {
    report('textures', entry.fileName)
    try {
      const id = await importOne(entry, options.targetDirectory, options.directoryMode)
      if (id) {
        imported.push(id)
        importedIds.set(entry.id, id)
        const guid = guidOf(entry.metaBytes)
        if (guid) guidToTexture.set(guid, id)
      }
    } catch (error) {
      failed.push({ name: entry.fileName, error: error instanceof Error ? error.message : String(error) })
    }
    completed += 1
  }

  // 2. 再导材质（这样后面模型导入时，工程里已经有完整的 MaterialAsset 可供绑定）
  for (const entry of materials) {
    report('materials', entry.fileName)
    try {
      const dir = destinationDir(entry, options.targetDirectory, options.directoryMode)
      ensureFolder(dir)
      const text = new TextDecoder().decode(entry.assetBytes)
      const id = importUnityMatText(text, entry.fileName, dir, guid => guidToTexture.get(guid.toLowerCase()) ?? null)
      if (id) {
        imported.push(id)
        importedIds.set(entry.id, id)
        const guid = guidOf(entry.metaBytes)
        if (guid) guidToMaterial.set(guid, id)
        const matAsset = useAssetStore.getState().assets[id]
        for (const candidate of [matAsset?.name, entry.fileName.replace(/\.mat$/i, '')]) {
          if (!candidate) continue
          const key = normalizeMaterialKey(candidate)
          if (key) nameToMaterial.set(key, id)
        }
      }
    } catch (error) {
      failed.push({ name: entry.fileName, error: error instanceof Error ? error.message : String(error) })
    }
    completed += 1
  }

  // 3. 导入模型与动画，并传入从 .meta / .prefab / .unity 解析出的材质绑定提示
  for (const entry of models) {
    const role = options.roles[entry.id] ?? entry.roleGuess?.role
    report(role === 'animationCarrier' || entry.kind === 'animation' ? 'animations' : 'models', entry.fileName)
    try {
      const hint = buildModelMaterialHint(entry, guidToMaterial, nameToMaterial, options.materialBindingSources)
      const id = await importOne(entry, options.targetDirectory, options.directoryMode, hint)
      if (id) {
        imported.push(id)
        importedIds.set(entry.id, id)
      }
    } catch (error) {
      failed.push({ name: entry.fileName, error: error instanceof Error ? error.message : String(error) })
    }
    completed += 1
  }

  // 4. 已导入的人形片段都可以重定向到其他人形本体，不要求文件名带 @。
  if (options.mergeAnimations) {
    const ready = models.flatMap(entry => {
      const id = importedIds.get(entry.id)
      const template = id ? getModelTemplate(id) : undefined
      if (!id || !template?.clips.length || !template.humanoid.profile) return []
      return [{ entry, id }]
    })
    const bodies = ready.filter(item => useAssetStore.getState().assets[item.id]?.kind !== 'animation')
    for (const source of ready) {
      const role = options.roles[source.entry.id] ?? source.entry.roleGuess?.role
      const linkedId = options.carrierBodies[source.entry.id] ?? source.entry.roleGuess?.relatedBodyEntryIds?.[0]
      const linked = linkedId ? importedIds.get(linkedId) : undefined
      const asset = useAssetStore.getState().assets[source.id]
      const standalone = asset?.kind === 'animation' || role === 'animationCarrier'
      const targets = linked
        ? ready.filter(item => item.id === linked)
        : (standalone ? bodies : bodies.filter(item => item.id !== source.id))
      for (const body of targets) {
        if (body.id === source.id) continue
        report('retarget', source.entry.fileName)
        const added = retargetClipsOntoModel(
          body.id,
          source.id,
          source.entry.kind === 'animation' ? clipNameOf(source.entry) : undefined,
        )
        if (added === 0) failed.push({ name: source.entry.fileName, error: '没有可重定向到本体的动画' })
      }
    }
  }

  options.onProgress?.({ phase: 'materials', completed: total, total })
  return { imported, failed }
}

async function importOne(
  entry: PackageAssetScannerEntry,
  target: string,
  mode: 'flat' | 'preserve',
  materialHint?: ModelMaterialHint,
): Promise<string | null> {
  const dir = destinationDir(entry, target, mode)
  ensureFolder(dir)
  if (entry.extension === 'tga') {
    const png = encodeRgbaToPng(decodeTgaToRgba(entry.assetBytes))
    const name = entry.fileName.replace(/\.tga$/i, '.png')
    return importExtractedBytes(name, png, dir)
  }
  return importExtractedBytes(entry.fileName, entry.assetBytes, dir, companionTextures(entry), materialHint)
}

function companionTextures(entry: PackageAssetScannerEntry): Array<{ name: string; data: Uint8Array }> {
  const files: Array<{ name: string; data: Uint8Array }> = []
  for (const file of entry.companionFiles) {
    if (file.extension === 'tga') {
      try {
        files.push({
          name: file.fileName.replace(/\.tga$/i, '.png'),
          data: encodeRgbaToPng(decodeTgaToRgba(file.bytes)),
        })
      } catch {
        continue
      }
      continue
    }
    if (['png', 'jpg', 'jpeg', 'webp'].includes(file.extension)) files.push({ name: file.fileName, data: file.bytes })
  }
  return files
}

function destinationDir(entry: PackageAssetScannerEntry, target: string, mode: 'flat' | 'preserve'): string {
  const root = normalizeDir(target)
  if (mode === 'preserve') {
    const folder = entry.originalPath.split('/').slice(0, -1).join('/')
    return folder ? normalizeDir(`${root}/${folder}`) : root
  }
  if (entry.kind === 'texture') return normalizeDir(`${root}/Textures`)
  if (entry.kind === 'material') return normalizeDir(`${root}/Materials`)
  if (entry.kind === 'animation') return normalizeDir(`${root}/Animations`)
  return root
}

function ensureFolder(path: string) {
  const normalized = normalizeDir(path)
  const parts = normalized.split('/')
  const folders = new Set(useAssetStore.getState().folders)
  let current = parts[0] ?? 'Assets'
  for (let index = 1; index < parts.length; index += 1) {
    current = `${current}/${parts[index]}`
    folders.add(current)
  }
  useAssetStore.setState(state => ({
    folders: [...new Set([...state.folders, ...folders])],
  }))
}

function guidOf(meta: Uint8Array | undefined): string | null {
  if (!meta) return null
  return new TextDecoder().decode(meta).match(/^guid:\s*([0-9a-f]+)/im)?.[1]?.toLowerCase() ?? null
}

function buildModelMaterialHint(
  entry: PackageAssetScannerEntry,
  guidToMaterial: ReadonlyMap<string, string>,
  nameToMaterial: ReadonlyMap<string, string>,
  sources?: readonly PackageMaterialBindingSource[],
): ModelMaterialHint | undefined {
  const byName: Record<string, string> = Object.fromEntries(nameToMaterial)
  const bySlotIndex: Record<number, string> = {}
  const sourceBindings: NonNullable<ModelMaterialHint['sourceBindings']> = []

  // 1. 解析模型自身 .meta 中的 externalObjects（UnityEngine:Material 名称 -> 材质 GUID）
  if (entry.metaBytes) {
    const metaText = new TextDecoder().decode(entry.metaBytes)
    for (const alias of parseMetaExternalMaterialObjects(metaText)) {
      const matId = guidToMaterial.get(alias.materialGuid.toLowerCase())
      if (matId) {
        const key = normalizeMaterialKey(alias.name)
        if (key) byName[key] = matId
      }
    }
  }

  // 2. 对齐 GM3D：解析模型 .meta 的 fileIDToRecycleName / internalIDToNameTable，
  //    并结合包内 .prefab / .unity 的 Renderer.m_Mesh(fileID) + m_Materials 建立部位级与槽位级材质映射
  const modelGuid = guidOf(entry.metaBytes)
  const meshNameByFileId = parseModelMeshNamesByFileId(entry.metaBytes)
  if (modelGuid && sources?.length) {
    const candidates: Array<{
      score: number
      bindings: Array<{ slotIndex: number; materialId: string; sourceMeshFileId?: string; sourceMeshName?: string }>
    }> = []
    for (const source of sources) {
      const text = new TextDecoder().decode(source.assetBytes)
      const renderers = parseRendererMaterials(text)
      const bindings: Array<{ slotIndex: number; materialId: string; sourceMeshFileId?: string; sourceMeshName?: string }> = []
      for (const renderer of renderers) {
        if (renderer.meshGuid && renderer.meshGuid !== modelGuid) continue
        if (renderer.goName && renderer.materialGuids.length === 1) {
          const matId = guidToMaterial.get(renderer.materialGuids[0]!.toLowerCase())
          const goKey = normalizeMaterialKey(renderer.goName)
          if (matId && goKey && !byName[goKey]) byName[goKey] = matId
        }
        renderer.materialGuids.forEach((guid, slotIndex) => {
          const matId = guidToMaterial.get(guid.toLowerCase())
          if (!matId) return
          const sourceMeshName = (renderer.meshFileId ? meshNameByFileId.get(renderer.meshFileId) : undefined) ?? renderer.goName
          bindings.push({
            slotIndex,
            materialId: matId,
            ...(renderer.meshFileId ? { sourceMeshFileId: renderer.meshFileId } : {}),
            ...(sourceMeshName ? { sourceMeshName } : {}),
          })
        })
      }
      if (bindings.length > 0) {
        candidates.push({
          score: bindingScore(entry.originalPath, source.originalPath),
          bindings,
        })
      }
    }
    candidates.sort((a, b) => b.score - a.score || b.bindings.length - a.bindings.length)
    const best = candidates[0]?.bindings ?? []
    sourceBindings.push(...best)
    for (const item of best) {
      if (item.sourceMeshName) {
        const key = normalizeMaterialKey(item.sourceMeshName)
        if (key && !byName[key]) byName[key] = item.materialId
      }
    }
    // 只有当某个 slotIndex 在所有部位中唯一对应同一个材质时才写入全局 bySlotIndex（与 GM3D uniqueMaterialGuidBySlot 一致）
    const bySlotSet = new Map<number, Set<string>>()
    for (const item of best) {
      const set = bySlotSet.get(item.slotIndex) ?? new Set<string>()
      set.add(item.materialId)
      bySlotSet.set(item.slotIndex, set)
    }
    for (const [slotIndex, set] of bySlotSet) {
      if (set.size === 1) bySlotIndex[slotIndex] = [...set][0]!
    }
  }

  if (Object.keys(byName).length === 0 && Object.keys(bySlotIndex).length === 0 && sourceBindings.length === 0) return undefined
  return { byName, bySlotIndex, ...(sourceBindings.length ? { sourceBindings } : {}) }
}

function parseMetaExternalMaterialObjects(text: string): Array<{ name: string; materialGuid: string }> {
  const out: Array<{ name: string; materialGuid: string }> = []
  const marker = /^\s*-\s+first:\s*$/gm
  const starts = [...text.matchAll(marker)].map(match => match.index ?? 0)
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]!
    const end = starts[i + 1] ?? text.length
    const block = text.slice(start, end)
    if (!/^\s*type:\s*UnityEngine:Material\s*$/m.test(block)) continue
    const rawName = /^\s*name:\s*(.+?)\s*$/m.exec(block)?.[1]?.trim()
    const name = rawName?.replace(/^['"]|['"]$/g, '')
    const materialGuid = /\bsecond:\s*\{[^}]*\bguid:\s*([0-9a-fA-F]{8,32})\b[^}]*\}/m.exec(block)?.[1]
    if (name && materialGuid) out.push({ name, materialGuid: materialGuid.toLowerCase() })
  }
  return out
}

function parseRendererMaterials(text: string): Array<{ goName?: string; meshGuid?: string; meshFileId?: string; materialGuids: string[] }> {
  const blocks = text.split(/\n---\s*!u!/)
  const meshGuidByGo = new Map<string, string>()
  const meshFileIdByGo = new Map<string, string>()
  const nameByGo = new Map<string, string>()
  const parsed: Array<{ className: string; goId?: string; meshGuid?: string; meshFileId?: string; materialGuids: string[] }> = []

  for (const block of blocks) {
    const goIdMatch = /^\s*(?:\d+\s+)?&(-?\d+)\s*\r?\n\s*GameObject:\s*$/m.exec(block)
    if (goIdMatch?.[1]) {
      const goName = /^\s*m_Name:\s*(.+?)\s*$/m.exec(block)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
      if (goName) nameByGo.set(goIdMatch[1], goName)
      continue
    }
    const className = /^\s*(?:\d+\s+&?\d+\s*)?\r?\n?\s*([A-Za-z_][\w]*):\s*$/m.exec(block)?.[1]
    if (!className) continue
    const goId = /^\s*m_GameObject:\s*\{[^}]*\bfileID:\s*(-?\d+)\b[^}]*\}/m.exec(block)?.[1]
    const meshGuid = /^\s*m_Mesh:\s*\{[^}]*\bguid:\s*([0-9a-fA-F]{8,32})\b[^}]*\}/m.exec(block)?.[1]?.toLowerCase()
    const meshFileId = /^\s*m_Mesh:\s*\{[^}]*\bfileID:\s*(-?\d+)\b[^}]*\}/m.exec(block)?.[1]
    if (className === 'MeshFilter' && goId) {
      if (meshGuid) meshGuidByGo.set(goId, meshGuid)
      if (meshFileId) meshFileIdByGo.set(goId, meshFileId)
    }
    if (className === 'MeshRenderer' || className === 'SkinnedMeshRenderer') {
      const materialGuids = parseMaterialGuidList(block)
      parsed.push({ className, goId, meshGuid, meshFileId, materialGuids })
    }
  }

  return parsed.map(item => ({
    goName: item.goId ? nameByGo.get(item.goId) : undefined,
    meshGuid: item.meshGuid ?? (item.goId ? meshGuidByGo.get(item.goId) : undefined),
    meshFileId: item.meshFileId ?? (item.goId ? meshFileIdByGo.get(item.goId) : undefined),
    materialGuids: item.materialGuids,
  }))
}

function parseModelMeshNamesByFileId(metaBytes: Uint8Array | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!metaBytes) return out
  const text = new TextDecoder().decode(metaBytes)
  const recycleStart = text.search(/^\s*fileIDToRecycleName:\s*$/m)
  if (recycleStart >= 0) {
    const lines = text.slice(recycleStart).split(/\r?\n/)
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i] ?? ''
      if (/^\S/.test(line)) break
      const match = /^\s*([+-]?\d+):\s*(.+?)\s*$/.exec(line)
      if (match?.[1] && match[2]?.trim()) out.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''))
    }
  }
  const tableStart = text.search(/^\s*internalIDToNameTable:\s*$/m)
  if (tableStart >= 0) {
    const lines = text.slice(tableStart).split(/\r?\n/)
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i] ?? ''
      if (/^\S/.test(line)) break
      const id = /^\s*-?\s*first:\s*([+-]?\d+)\s*$/.exec(line)?.[1]
      if (!id) continue
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
        const name = /^\s*second:\s*(.+?)\s*$/.exec(lines[j] ?? '')?.[1]?.trim().replace(/^['"]|['"]$/g, '')
        if (name) {
          out.set(id, name)
          break
        }
      }
    }
  }
  return out
}

function parseMaterialGuidList(block: string): string[] {
  const start = block.search(/^\s*m_Materials:\s*$/m)
  if (start < 0) return []
  const lines = block.slice(start).split(/\r?\n/)
  const guids: string[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^\s*[A-Za-z_][\w]*:\s*/.test(line) && !/^\s+-\s+/.test(line)) break
    const match = /\bguid:\s*([0-9a-fA-F]{8,32})\b/.exec(line)
    if (match?.[1]) guids.push(match[1].toLowerCase())
  }
  return guids
}

function bindingScore(modelPath: string, sourcePath: string): number {
  const mParts = modelPath.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean)
  const sParts = sourcePath.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean)
  const mBase = (mParts.at(-1) ?? '').replace(/\.[^.]+$/, '')
  const sBase = (sParts.at(-1) ?? '').replace(/\.[^.]+$/, '')
  let score = 0
  if (mBase && mBase === sBase) score += 100
  if (sParts.includes(mBase)) score += 30
  let shared = 0
  while (shared < mParts.length && shared < sParts.length && mParts[shared] === sParts[shared]) shared += 1
  score += shared * 4
  if (sourcePath.toLowerCase().endsWith('.prefab')) score += 10
  return score
}

function clipNameOf(entry: PackageAssetScannerEntry): string {
  const base = entry.fileName.replace(/\.[^.]+$/, '')
  const marker = base.lastIndexOf('@')
  return (marker >= 0 ? base.slice(marker + 1) : base).trim() || base
}
