import type { PackageAssetScannerEntry } from './packageAssetScanner'

export type PackageModelAssetRole =
  | 'modelBody'
  | 'animationCarrier'
  | 'ordinaryModel'
  | 'unknownModel'

export interface PackageModelAssetRoleGuess {
  role: PackageModelAssetRole
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
  relatedBodyEntryIds?: string[]
  clipNames?: string[]
  source: 'filename' | 'meta' | 'prefab' | 'controller' | 'manual'
}

export function applyPackageModelAssetRoleGuesses<T extends PackageAssetScannerEntry>(entries: T[]): T[] {
  const bodyCandidates = entries.filter(entry => isModelLike(entry) && !clipSuffix(entry.fileName))
  return entries.map(entry => {
    if (!isModelLike(entry)) return entry
    const guess = guessRole(entry, bodyCandidates)
    return {
      ...entry,
      roleGuess: guess,
    }
  })
}

function guessRole(
  entry: PackageAssetScannerEntry,
  bodyCandidates: readonly PackageAssetScannerEntry[],
): PackageModelAssetRoleGuess {
  const suffix = clipSuffix(entry.fileName)
  if (suffix) {
    const related = relatedBodiesForPrefix(suffix.body, bodyCandidates)
    return {
      role: 'animationCarrier',
      confidence: 'high',
      source: 'filename',
      reasons: ['filename-at-clip'],
      clipNames: [suffix.clip],
      ...(related.length ? { relatedBodyEntryIds: related.map(item => item.id) } : {}),
    }
  }
  if (entry.kind === 'animation' || isAnimationFolder(entry.originalPath)) {
    const bodies = bodyCandidates.filter(item => item.id !== entry.id && item.kind !== 'animation')
    return {
      role: 'animationCarrier',
      confidence: 'medium',
      source: 'filename',
      reasons: ['imported-clips'],
      clipNames: [clipNameFromFile(entry.fileName)],
      ...(bodies.length ? { relatedBodyEntryIds: bodies.map(item => item.id) } : {}),
    }
  }
  const pathScore = bodyPathScore(entry.originalPath)
  if (pathScore > 0) {
    return {
      role: 'modelBody',
      confidence: pathScore >= 2 ? 'medium' : 'low',
      source: 'filename',
      reasons: ['model-like-path'],
    }
  }
  return {
    role: 'ordinaryModel',
    confidence: 'low',
    source: 'filename',
    reasons: ['model-file'],
  }
}

function isModelLike(entry: PackageAssetScannerEntry): boolean {
  return entry.kind === 'model' || entry.kind === 'animation'
}

function clipSuffix(fileName: string): { body: string; clip: string } | null {
  const base = stripExtension(fileName)
  const at = base.lastIndexOf('@')
  if (at <= 0 || at >= base.length - 1) return null
  const body = base.slice(0, at).trim()
  const clip = base.slice(at + 1).trim()
  return body && clip ? { body, clip } : null
}

function relatedBodiesForPrefix(
  bodyPrefix: string,
  bodyCandidates: readonly PackageAssetScannerEntry[],
): PackageAssetScannerEntry[] {
  const target = normalizeName(bodyPrefix)
  if (!target) return []
  return bodyCandidates.filter(entry => {
    const base = normalizeName(stripExtension(entry.fileName))
    return base === target || base.endsWith(target) || target.endsWith(base)
  })
}

function bodyPathScore(path: string): number {
  const normalized = path.toLowerCase().replace(/\\/g, '/')
  let score = 0
  if (/(^|\/)(models?|meshes?|characters?|fbx)(\/|$)/i.test(normalized)) score += 1
  if (!/(^|\/)(animations?|anim|motions?)(\/|$)/i.test(normalized)) score += 1
  return score
}

function isAnimationFolder(path: string): boolean {
  return /(^|\/)(animations?|anims?|motions?)(\/|$)/i.test(path.replace(/\\/g, '/'))
}

function clipNameFromFile(fileName: string): string {
  return stripExtension(fileName).trim()
}

function stripExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.')
  return index > 0 ? fileName.slice(0, index) : fileName
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s._-]+/g, '')
}
