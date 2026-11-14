import { normalizeSlot } from '../materials'
import { importExtractedBytes } from '../import'
import { useAssetStore } from '../library'
import { normalizeDir } from '../folders'
import { retargetClipsOntoModel } from '../models'
import { decodeTgaToRgba, encodeRgbaToPng } from '../ufbx/tgaTexture'
import type { PackageAssetScannerEntry } from './packageAssetScanner'
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
): PackageAssetScannerEntry[] {
  const ids = new Set(selected.map(entry => entry.id))
  const textureByGuid = new Map<string, PackageAssetScannerEntry>()
  for (const entry of all) {
    if (entry.kind !== 'texture') continue
    const guid = guidOf(entry.metaBytes)
    if (guid) textureByGuid.set(guid, entry)
  }
  for (const entry of selected) {
    if (entry.kind !== 'material') continue
    const text = new TextDecoder().decode(entry.assetBytes)
    for (const property of ['_MainTex', '_BaseMap', '_BumpMap', '_EmissionMap', '_OcclusionMap', '_MetallicGlossMap']) {
      const guid = textureGuid(text, property)
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
    onProgress?: (progress: PackageExtractionProgress) => void
  },
): Promise<{ imported: string[]; failed: Array<{ name: string; error: string }> }> {
  const imported: string[] = []
  const failed: Array<{ name: string; error: string }> = []
  const importedIds = new Map<string, string>()
  const guidToAsset = new Map<string, string>()
  const total = entries.length
  let completed = 0
  const report = (phase: PackageExtractionProgress['phase'], fileName?: string) => {
    options.onProgress?.({ phase, completed, total, fileName })
  }
  const textures = entries.filter(entry => entry.kind === 'texture')
  const materials = entries.filter(entry => entry.kind === 'material')
  const models = entries.filter(entry => entry.kind !== 'texture' && entry.kind !== 'material')
  for (const entry of textures) {
    report('textures', entry.fileName)
    try {
      const id = await importOne(entry, options.targetDirectory, options.directoryMode)
      if (id) {
        imported.push(id)
        importedIds.set(entry.id, id)
        const guid = guidOf(entry.metaBytes)
        if (guid) guidToAsset.set(guid, id)
      }
    } catch (error) {
      failed.push({ name: entry.fileName, error: error instanceof Error ? error.message : String(error) })
    }
    completed += 1
  }
  for (const entry of models) {
    const role = options.roles[entry.id] ?? entry.roleGuess?.role
    report(role === 'animationCarrier' || entry.kind === 'animation' ? 'animations' : 'models', entry.fileName)
    try {
      const id = await importOne(entry, options.targetDirectory, options.directoryMode)
      if (id) {
        imported.push(id)
        importedIds.set(entry.id, id)
      }
    } catch (error) {
      failed.push({ name: entry.fileName, error: error instanceof Error ? error.message : String(error) })
    }
    completed += 1
  }
  if (options.mergeAnimations) {
    for (const entry of models) {
      const role = options.roles[entry.id] ?? entry.roleGuess?.role
      if (role !== 'animationCarrier') continue
      const carrierId = importedIds.get(entry.id)
      const bodyEntryId = options.carrierBodies[entry.id] ?? entry.roleGuess?.relatedBodyEntryIds?.[0]
      const bodyId = bodyEntryId ? importedIds.get(bodyEntryId) : undefined
      if (!carrierId || !bodyId) continue
      report('retarget', entry.fileName)
      const added = retargetClipsOntoModel(bodyId, carrierId, clipNameOf(entry))
      if (added === 0) failed.push({ name: entry.fileName, error: '没有可重定向到本体的动画' })
    }
  }
  for (const entry of materials) {
    report('materials', entry.fileName)
    try {
      const id = importMaterial(entry, guidToAsset, destinationDir(entry, options.targetDirectory, options.directoryMode))
      if (id) imported.push(id)
    } catch (error) {
      failed.push({ name: entry.fileName, error: error instanceof Error ? error.message : String(error) })
    }
    completed += 1
  }
  options.onProgress?.({ phase: 'materials', completed: total, total })
  return { imported, failed }
}

async function importOne(entry: PackageAssetScannerEntry, target: string, mode: 'flat' | 'preserve'): Promise<string | null> {
  const dir = destinationDir(entry, target, mode)
  ensureFolder(dir)
  if (entry.extension === 'tga') {
    const png = encodeRgbaToPng(decodeTgaToRgba(entry.assetBytes))
    const name = entry.fileName.replace(/\.tga$/i, '.png')
    return importExtractedBytes(name, png, dir)
  }
  return importExtractedBytes(entry.fileName, entry.assetBytes, dir, companionTextures(entry))
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
  return new TextDecoder().decode(meta).match(/^guid:\s*([0-9a-f]+)/im)?.[1] ?? null
}

function importMaterial(entry: PackageAssetScannerEntry, guids: Map<string, string>, dir: string): string | null {
  const text = new TextDecoder().decode(entry.assetBytes)
  const name = text.match(/m_Name:\s*(.+)/)?.[1]?.trim() || entry.fileName.replace(/\.mat$/i, '')
  const color = unityColor(text, '_Color') ?? unityColor(text, '_BaseColor') ?? '#ffffff'
  const emission = unityColor(text, '_EmissionColor') ?? '#000000'
  const metallic = unityFloat(text, '_Metallic') ?? 0
  const gloss = unityFloat(text, '_Glossiness') ?? unityFloat(text, '_Smoothness')
  const mainGuid = textureGuid(text, '_MainTex') ?? textureGuid(text, '_BaseMap')
  const normalGuid = textureGuid(text, '_BumpMap')
  const id = crypto.randomUUID()
  ensureFolder(dir)
  useAssetStore.getState().add({
    id,
    name,
    kind: 'material',
    slot: normalizeSlot({
      name,
      color,
      metalness: metallic,
      roughness: gloss == null ? 0.5 : 1 - Math.min(1, Math.max(0, gloss)),
      emissive: emission,
      emissiveIntensity: emission === '#000000' ? 0 : 1,
      opacity: 1,
      ao: 1,
      mapAssetId: mainGuid ? guids.get(mainGuid) ?? null : null,
      normalAssetId: normalGuid ? guids.get(normalGuid) ?? null : null,
      metallicRoughnessAssetId: null,
      emissiveAssetId: null,
      aoAssetId: null,
    }),
  })
  useAssetStore.getState().place(id, dir)
  return id
}

function textureGuid(text: string, property: string): string | null {
  const match = text.match(new RegExp(`${property}:[\\s\\S]{0,180}?guid:\\s*([0-9a-f]+)`, 'i'))
  return match?.[1] ?? null
}

function unityFloat(text: string, property: string): number | null {
  const match = text.match(new RegExp(`${property}:\\s*(-?\\d+(?:\\.\\d+)?)`))
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function unityColor(text: string, property: string): string | null {
  const match = text.match(new RegExp(`${property}:\\s*\\{[^}]*r:\\s*([\\d.]+)[^}]*g:\\s*([\\d.]+)[^}]*b:\\s*([\\d.]+)`, 'i'))
  if (!match) return null
  const channel = (raw: string) => Math.round(Math.min(1, Math.max(0, Number(raw))) * 255).toString(16).padStart(2, '0')
  return `#${channel(match[1] ?? '1')}${channel(match[2] ?? '1')}${channel(match[3] ?? '1')}`
}

function clipNameOf(entry: PackageAssetScannerEntry): string {
  const base = entry.fileName.replace(/\.[^.]+$/, '')
  const marker = base.lastIndexOf('@')
  return (marker >= 0 ? base.slice(marker + 1) : base).trim() || base
}
