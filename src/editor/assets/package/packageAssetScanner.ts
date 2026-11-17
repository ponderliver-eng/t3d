export type PackageExtractableAssetKind = 'model' | 'texture' | 'animation' | 'material'

import type { PackageModelAssetRoleGuess } from './packageAssetRoleGuess'
import { applyPackageModelAssetRoleGuesses } from './packageAssetRoleGuess'

export interface PackageAssetScannerEntry {
  id: string
  kind: PackageExtractableAssetKind
  originalPath: string
  fileName: string
  extension: string
  outputExtension?: string
  conversionNote?: string
  packageRecordPath: string
  sizeBytes: number
  assetBytes: Uint8Array
  metaBytes?: Uint8Array
  previewBytes?: Uint8Array
  companionFiles: PackageAssetScannerCompanionFile[]
  warnings: string[]
  roleGuess?: PackageModelAssetRoleGuess
}

export interface PackageMaterialBindingSource {
  originalPath: string
  extension: 'prefab' | 'unity'
  packageRecordPath: string
  assetBytes: Uint8Array
  metaBytes?: Uint8Array
}

export interface PackageAssetScannerCompanionFile {
  originalPath: string
  fileName: string
  extension: string
  sizeBytes: number
  bytes: Uint8Array
  reason: 'obj-mtl' | 'same-folder-texture' | 'referenced-texture'
}

export interface PackageAssetScannerDirectory {
  name: string
  path: string
  children: PackageAssetScannerDirectory[]
  entries: PackageAssetScannerEntry[]
}

export interface PackageAssetScannerResult {
  entries: PackageAssetScannerEntry[]
  materialBindingSources: PackageMaterialBindingSource[]
  tree: PackageAssetScannerDirectory
  diagnostics: PackageAssetScannerDiagnostic[]
  stats: {
    packageRecords: number
    extractable: number
    hidden: number
    unsupported: number
    missingPathname: number
    missingAssetBytes: number
  }
}

export interface PackageAssetScannerDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  path?: string
  details?: unknown
}

interface PackageArchiveRecord {
  recordPath: string
  asset?: Uint8Array
  meta?: Uint8Array
  pathname?: string
  preview?: Uint8Array
  extraFiles: Map<string, Uint8Array>
}

interface TarEntry {
  path: string
  type: string
  data: Uint8Array
}

interface PackageAssetCandidate {
  originalPath: string
  extension: string
  assetBytes: Uint8Array
}

const MODEL_EXTENSIONS = new Set(['fbx', 'obj', 'dae', '3ds', 'stl', 'glb', 'gltf'])
const TEXTURE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'ktx2', 'tga'])
const HIDDEN_EXTENSIONS = new Set([
  'prefab',
  'unity',
  'controller',
  'overridecontroller',
  'cs',
  'asmdef',
  'shader',
  'meta',
  'anim',
  'asset',
  'txt',
  'md',
  'json',
  'xml',
])

export async function scanPackageAssets(input: Uint8Array | ArrayBuffer): Promise<PackageAssetScannerResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const tarBytes = await maybeGunzip(bytes)
  const tarEntries = await parseTarAsync(tarBytes)
  const records = collectPackageArchiveRecords(tarEntries)
  return buildScannerResult(records)
}

export function parseTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (isZeroBlock(header)) break
    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const path = normalizePackagePath(prefix ? `${prefix}/${name}` : name)
    const size = readTarOctal(header, 124, 12)
    const type = readTarString(header, 156, 1) || '0'
    offset += 512
    if (offset + size > bytes.length) {
      throw new Error(`Tar entry ${path} is truncated.`)
    }
    const data = bytes.subarray(offset, offset + size)
    if (path && type !== '5') entries.push({ path, type, data })
    offset += Math.ceil(size / 512) * 512
  }
  return entries
}

async function parseTarAsync(bytes: Uint8Array): Promise<TarEntry[]> {
  const entries: TarEntry[] = []
  let offset = 0
  let scanned = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (isZeroBlock(header)) break
    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const path = normalizePackagePath(prefix ? `${prefix}/${name}` : name)
    const size = readTarOctal(header, 124, 12)
    const type = readTarString(header, 156, 1) || '0'
    offset += 512
    if (offset + size > bytes.length) {
      throw new Error(`Tar entry ${path} is truncated.`)
    }
    const data = bytes.subarray(offset, offset + size)
    if (path && type !== '5') entries.push({ path, type, data })
    offset += Math.ceil(size / 512) * 512
    scanned += 1
    if (scanned % 256 === 0) await yieldToBrowser()
  }
  return entries
}

function collectPackageArchiveRecords(entries: TarEntry[]): PackageArchiveRecord[] {
  const byRoot = new Map<string, PackageArchiveRecord>()
  const directRecords: PackageArchiveRecord[] = []
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean)
    if (parts.length >= 2 && isPackageArchiveRecordLeaf(parts.slice(1).join('/'))) {
      const root = parts[0]!
      const leaf = parts.slice(1).join('/')
      const record = byRoot.get(root) ?? {
        recordPath: root,
        extraFiles: new Map<string, Uint8Array>(),
      }
      byRoot.set(root, record)
      if (leaf === 'asset') record.asset = entry.data
      else if (leaf === 'asset.meta') record.meta = entry.data
      else if (leaf === 'pathname') record.pathname = decodePackagePathname(entry.data)
      else if (leaf === 'preview.png') record.preview = entry.data
      else record.extraFiles.set(leaf, entry.data)
      continue
    }

    const path = normalizePackagePath(entry.path)
    directRecords.push({
      recordPath: path,
      pathname: path,
      asset: entry.data,
      extraFiles: new Map<string, Uint8Array>(),
    })
  }
  return [...byRoot.values(), ...directRecords]
}

function buildScannerResult(records: PackageArchiveRecord[]): PackageAssetScannerResult {
  const diagnostics: PackageAssetScannerDiagnostic[] = []
  const entries: PackageAssetScannerEntry[] = []
  const materialBindingSources: PackageMaterialBindingSource[] = []
  const candidates = collectAssetCandidates(records)
  let hidden = 0
  let unsupported = 0
  let missingPathname = 0
  let missingAssetBytes = 0

  for (const record of records) {
    if (!record.pathname) {
      missingPathname += 1
      diagnostics.push({
        code: 'missing-pathname',
        severity: 'info',
        message: 'Package record has no pathname and was hidden.',
        path: record.recordPath,
      })
      continue
    }
    if (!record.asset || record.asset.byteLength === 0) {
      missingAssetBytes += 1
      diagnostics.push({
        code: 'missing-asset-bytes',
        severity: 'info',
        message: 'Package record has no extractable asset bytes and was hidden.',
        path: record.pathname,
      })
      continue
    }

    const originalPath = normalizePackagePath(record.pathname)
    const extension = extensionOf(originalPath)
    if ((extension === 'prefab' || extension === 'unity') && record.asset.byteLength > 0) {
      materialBindingSources.push({
        originalPath,
        extension,
        packageRecordPath: record.recordPath,
        assetBytes: record.asset,
        metaBytes: record.meta,
      })
    }
    const classified = classifyExtractableAsset(originalPath, extension)
    if (!classified) {
      if (HIDDEN_EXTENSIONS.has(extension)) hidden += 1
      else unsupported += 1
      continue
    }

    entries.push({
      id: stableEntryId(record.recordPath, originalPath),
      kind: classified.kind,
      originalPath,
      fileName: fileNameOf(originalPath),
      extension,
      outputExtension: classified.outputExtension,
      conversionNote: classified.conversionNote,
      packageRecordPath: record.recordPath,
      sizeBytes: record.asset.byteLength,
      assetBytes: record.asset,
      metaBytes: record.meta,
      previewBytes: record.preview,
      companionFiles: companionFilesForAsset(originalPath, extension, candidates),
      warnings: classified.warnings,
    })
  }

  entries.sort((a, b) => a.originalPath.localeCompare(b.originalPath))
  const entriesWithRoles = applyPackageModelAssetRoleGuesses(entries)
  return {
    entries: entriesWithRoles,
    materialBindingSources,
    tree: buildTree(entriesWithRoles),
    diagnostics,
    stats: {
      packageRecords: records.length,
      extractable: entries.length,
      hidden,
      unsupported,
      missingPathname,
      missingAssetBytes,
    },
  }
}

function collectAssetCandidates(records: PackageArchiveRecord[]): PackageAssetCandidate[] {
  const candidates: PackageAssetCandidate[] = []
  for (const record of records) {
    if (!record.pathname || !record.asset || record.asset.byteLength === 0) continue
    const originalPath = normalizePackagePath(record.pathname)
    candidates.push({
      originalPath,
      extension: extensionOf(originalPath),
      assetBytes: record.asset,
    })
  }
  return candidates
}

function companionFilesForAsset(
  originalPath: string,
  extension: string,
  candidates: readonly PackageAssetCandidate[],
): PackageAssetScannerCompanionFile[] {
  if (!MODEL_EXTENSIONS.has(extension)) return []
  const companions: PackageAssetScannerCompanionFile[] = []
  const dir = directoryOf(originalPath)
  const base = stripExtension(fileNameOf(originalPath)).toLowerCase()
  const seen = new Set<string>()

  if (extension === 'obj') {
    const mtlCandidates: PackageAssetCandidate[] = []
    for (const candidate of candidates) {
      if (candidate.originalPath === originalPath) continue
      if (candidate.extension !== 'mtl') continue
      if (directoryOf(candidate.originalPath) !== dir) continue
      if (stripExtension(fileNameOf(candidate.originalPath)).toLowerCase() !== base) continue
      companions.push(companionFile(candidate, 'obj-mtl'))
      mtlCandidates.push(candidate)
      seen.add(candidate.originalPath)
    }
    for (const mtl of mtlCandidates) {
      for (const texturePath of referencedTexturePathsFromMtl(mtl.assetBytes)) {
        const matched = findCandidateByTextureReference(texturePath, directoryOf(mtl.originalPath), candidates)
        if (!matched || matched.originalPath === originalPath || seen.has(matched.originalPath)) continue
        companions.push(companionFile(matched, 'referenced-texture'))
        seen.add(matched.originalPath)
      }
    }
  }

  for (const candidate of candidates) {
    if (candidate.originalPath === originalPath || seen.has(candidate.originalPath)) continue
    if (!TEXTURE_EXTENSIONS.has(candidate.extension)) continue
    if (directoryOf(candidate.originalPath) !== dir) continue
    companions.push(companionFile(candidate, 'same-folder-texture'))
    seen.add(candidate.originalPath)
  }

  companions.sort((a, b) => {
    const ar = a.reason === 'obj-mtl' ? 0 : 1
    const br = b.reason === 'obj-mtl' ? 0 : 1
    return ar - br || a.originalPath.localeCompare(b.originalPath)
  })
  return companions
}

function companionFile(
  candidate: PackageAssetCandidate,
  reason: PackageAssetScannerCompanionFile['reason'],
): PackageAssetScannerCompanionFile {
  return {
    originalPath: candidate.originalPath,
    fileName: fileNameOf(candidate.originalPath),
    extension: candidate.extension,
    sizeBytes: candidate.assetBytes.byteLength,
    bytes: candidate.assetBytes,
    reason,
  }
}

function referencedTexturePathsFromMtl(bytes: Uint8Array): string[] {
  const text = decodeText(bytes)
  const paths: string[] = []
  const textureKeys = new Set([
    'map_kd',
    'map_ka',
    'map_ks',
    'map_ke',
    'map_bump',
    'bump',
    'norm',
    'map_d',
    'map_opacity',
    'disp',
    'decal',
    'map_ns',
    'map_pr',
    'map_pm',
    'map_orm',
  ])
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim()
    if (!line) continue
    const [rawKey, ...rest] = line.split(/\s+/)
    const key = rawKey?.toLowerCase()
    if (!key || !textureKeys.has(key) || rest.length === 0) continue
    const path = lastTexturePathToken(rest)
    if (path) paths.push(path)
  }
  return paths
}

function lastTexturePathToken(tokens: string[]): string | null {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i]!
    if (!token || token.startsWith('-')) continue
    const normalized = normalizePackagePath(token.replace(/^"|"$/g, ''))
    if (TEXTURE_EXTENSIONS.has(extensionOf(normalized))) return normalized
  }
  return null
}

function findCandidateByTextureReference(
  texturePath: string,
  baseDirectory: string,
  candidates: readonly PackageAssetCandidate[],
): PackageAssetCandidate | null {
  const normalizedRef = normalizePackagePath(texturePath)
  const directPath = normalizePackagePath(baseDirectory ? `${baseDirectory}/${normalizedRef}` : normalizedRef)
  const direct = candidates.find(candidate => candidate.originalPath === directPath && TEXTURE_EXTENSIONS.has(candidate.extension))
  if (direct) return direct
  const refName = fileNameOf(normalizedRef).toLowerCase()
  const sameDir = candidates.find(candidate =>
    directoryOf(candidate.originalPath) === baseDirectory
    && fileNameOf(candidate.originalPath).toLowerCase() === refName
    && TEXTURE_EXTENSIONS.has(candidate.extension),
  )
  if (sameDir) return sameDir
  return candidates.find(candidate =>
    fileNameOf(candidate.originalPath).toLowerCase() === refName
    && TEXTURE_EXTENSIONS.has(candidate.extension),
  ) ?? null
}

function classifyExtractableAsset(
  originalPath: string,
  extension: string,
): Pick<PackageAssetScannerEntry, 'kind' | 'outputExtension' | 'conversionNote' | 'warnings'> | null {
  if (TEXTURE_EXTENSIONS.has(extension)) {
    if (extension === 'tga') {
      return {
        kind: 'texture',
        outputExtension: 'png',
        conversionNote: 'TGA -> PNG',
        warnings: [],
      }
    }
    return { kind: 'texture', outputExtension: extension, warnings: [] }
  }
  if (MODEL_EXTENSIONS.has(extension)) {
    const base = stripExtension(fileNameOf(originalPath))
    if (extension === 'fbx' && (hasAtClipName(base) || isAnimationFolder(originalPath))) {
      return {
        kind: 'animation',
        outputExtension: 'clip',
        conversionNote: 'FBX animation carrier',
        warnings: ['Animation clip usability depends on a compatible skeleton.'],
      }
    }
    return {
      kind: 'model',
      outputExtension: extension === 'glb' || extension === 'gltf' ? extension : 'glb',
      conversionNote: extension === 'glb' || extension === 'gltf' ? undefined : `${extension.toUpperCase()} -> GLB artifact`,
      warnings: [],
    }
  }
  if (extension === 'mat') {
    return {
      kind: 'material',
      outputExtension: 'gm3dmat',
      conversionNote: 'Unity .mat -> 材质',
      warnings: [],
    }
  }
  return null
}

function buildTree(entries: PackageAssetScannerEntry[]): PackageAssetScannerDirectory {
  const root: PackageAssetScannerDirectory = { name: '', path: '', children: [], entries: [] }
  const directories = new Map<string, PackageAssetScannerDirectory>([['', root]])
  for (const entry of entries) {
    const parts = entry.originalPath.split('/').filter(Boolean)
    const dirs = parts.slice(0, -1)
    let current = root
    let currentPath = ''
    for (const dir of dirs) {
      currentPath = currentPath ? `${currentPath}/${dir}` : dir
      let next = directories.get(currentPath)
      if (!next) {
        next = { name: dir, path: currentPath, children: [], entries: [] }
        directories.set(currentPath, next)
        current.children.push(next)
        current.children.sort((a, b) => a.name.localeCompare(b.name))
      }
      current = next
    }
    current.entries.push(entry)
  }
  sortTree(root)
  return root
}

function sortTree(node: PackageAssetScannerDirectory): void {
  node.children.sort((a, b) => a.name.localeCompare(b.name))
  node.entries.sort((a, b) => a.fileName.localeCompare(b.fileName))
  for (const child of node.children) sortTree(child)
}

async function maybeGunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes
  const streamCtor = globalThis.DecompressionStream
  if (typeof streamCtor !== 'function') {
    throw new Error('Gzip package extraction is not supported in this runtime.')
  }
  const source = new Response(arrayBufferView(bytes)).body
  if (!source) throw new Error('Gzip package extraction is not supported in this runtime.')
  const buffer = await new Response(source.pipeThrough(new streamCtor('gzip'))).arrayBuffer()
  return new Uint8Array(buffer)
}

function arrayBufferView(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer
  }
  return bytes.slice().buffer
}

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function isPackageArchiveRecordLeaf(path: string): boolean {
  return path === 'asset'
    || path === 'asset.meta'
    || path === 'pathname'
    || path === 'preview.png'
}

function stableEntryId(recordPath: string, originalPath: string): string {
  return `pkg_${hashString(`${recordPath}:${originalPath}`).toString(36)}`
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function isZeroBlock(bytes: Uint8Array): boolean {
  for (const byte of bytes) if (byte !== 0) return false
  return true
}

function readTarString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset
  const max = offset + length
  while (end < max && bytes[end] !== 0) end += 1
  return decodeText(bytes.subarray(offset, end)).trim()
}

function readTarOctal(bytes: Uint8Array, offset: number, length: number): number {
  const raw = readTarString(bytes, offset, length).replace(/\0/g, '').trim()
  if (!raw) return 0
  const value = Number.parseInt(raw, 8)
  return Number.isFinite(value) ? value : 0
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function decodePackagePathname(bytes: Uint8Array): string {
  return decodeText(bytes)
    .replace(/\0+$/g, '')
    .replace(/\r?\n00$/g, '')
    .trim()
    .replace(/\\/g, '/')
}

function normalizePackagePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

function extensionOf(path: string): string {
  const name = fileNameOf(path)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
}

function fileNameOf(path: string): string {
  return normalizePackagePath(path).split('/').filter(Boolean).pop() ?? path
}

function directoryOf(path: string): string {
  const normalized = normalizePackagePath(path)
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function stripExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

function hasAtClipName(base: string): boolean {
  const at = base.lastIndexOf('@')
  return at > 0 && at < base.length - 1
}

function isAnimationFolder(path: string): boolean {
  return /(^|\/)(animations?|anims?|motions?)(\/|$)/i.test(normalizePackagePath(path))
}
