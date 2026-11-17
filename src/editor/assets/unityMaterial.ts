import { normalizeSlot, type SurfaceSlot } from './materials'
import { useAssetStore } from './library'
import type { AlphaMode, CullMode } from '../scene/types'

const ALBEDO_KEYS = ['_MainTex', '_BaseMap', '_BaseColorMap', '_BaseColorTexture', '_ColorMap'] as const
const NORMAL_KEYS = ['_BumpMap', '_NormalMap'] as const
const METALLIC_KEYS = ['_MetallicGlossMap', '_MaskMap', '_SpecGlossMap'] as const
const EMISSION_KEYS = ['_EmissionMap', '_EmissiveColorMap'] as const
const AO_KEYS = ['_OcclusionMap'] as const

export const UNITY_MAT_TEXTURE_PROPERTIES = [
  ...ALBEDO_KEYS,
  ...NORMAL_KEYS,
  ...METALLIC_KEYS,
  ...EMISSION_KEYS,
  ...AO_KEYS,
] as const

export function parseUnityMaterialSlot(
  text: string,
  fallbackName: string,
  resolveTextureGuid?: (guid: string) => string | null,
): SurfaceSlot {
  const name = matchMaterialName(text) || fallbackName.replace(/\.mat$/i, '')
  const colorInfo = unityColorWithAlpha(text, '_Color') ?? unityColorWithAlpha(text, '_BaseColor') ?? unityColorWithAlpha(text, '_MainColor')
  const color = colorInfo?.hex ?? '#ffffff'
  const emissionInfo = unityColorWithAlpha(text, '_EmissionColor') ?? unityColorWithAlpha(text, '_EmissiveColor')
  const emission = emissionInfo?.hex ?? '#000000'
  const metallic = clamp01(unityFloat(text, '_Metallic') ?? 0)
  const gloss = unityFloat(text, '_Glossiness') ?? unityFloat(text, '_Smoothness') ?? unityFloat(text, '_GlossMapScale')
  const roughness = gloss == null ? 0.5 : 1 - clamp01(gloss)
  const normalScale = unityFloat(text, '_BumpScale') ?? unityFloat(text, '_NormalScale') ?? 1
  const ao = clamp01(unityFloat(text, '_OcclusionStrength') ?? 1)
  const cutoff = clamp01(unityFloat(text, '_Cutoff') ?? unityFloat(text, '_AlphaCutoff') ?? unityFloat(text, '_AlphaClipThreshold') ?? 0.5)

  const mode = unityFloat(text, '_Mode') ?? unityFloat(text, '_Surface')
  const alphaClip = unityFloat(text, '_AlphaClip')
  let alphaMode: AlphaMode = 'opaque'
  let opacity = colorInfo?.alpha ?? 1
  let depthWrite = true
  if (mode === 1 || alphaClip === 1) {
    alphaMode = 'clip'
  } else if (mode === 2 || mode === 3) {
    alphaMode = 'blend'
    if (opacity >= 0.999) opacity = 0.75
    depthWrite = false
  }

  const cullRaw = unityFloat(text, '_Cull') ?? unityFloat(text, '_CullMode') ?? unityFloat(text, '_Culling')
  let cull: CullMode = 'back'
  if (cullRaw === 0) cull = 'off'
  else if (cullRaw === 1) cull = 'front'

  const texGuids = parseTextureGuids(text)
  const pickTex = (keys: readonly string[]): string | null => {
    for (const key of keys) {
      const guid = texGuids[key] ?? textureGuidRegex(text, key)
      if (!guid) continue
      const resolved = resolveTextureGuid?.(guid) ?? null
      if (resolved) return resolved
    }
    return null
  }

  const mapAssetId = pickTex(ALBEDO_KEYS)
  const normalAssetId = pickTex(NORMAL_KEYS)
  const metallicRoughnessAssetId = pickTex(METALLIC_KEYS)
  const emissiveAssetId = pickTex(EMISSION_KEYS)
  const aoAssetId = pickTex(AO_KEYS)

  const hasEmission = emission !== '#000000' || Boolean(emissiveAssetId)
  return normalizeSlot({
    name,
    shader: 'unity-standard',
    color,
    metalness: metallic,
    roughness,
    normalScale,
    emissive: hasEmission && emission === '#000000' ? '#ffffff' : emission,
    emissiveIntensity: hasEmission ? 1 : 0,
    opacity,
    ao,
    alphaMode,
    alphaCutoff: cutoff,
    cull,
    depthWrite,
    mapAssetId,
    normalAssetId,
    metallicRoughnessAssetId,
    emissiveAssetId,
    aoAssetId,
  })
}

export function importUnityMatText(
  text: string,
  fileName: string,
  dir: string,
  resolveTextureGuid?: (guid: string) => string | null,
): string {
  const slot = parseUnityMaterialSlot(text, fileName, resolveTextureGuid)
  const id = crypto.randomUUID()
  useAssetStore.getState().add({
    id,
    name: slot.name,
    kind: 'material',
    slot,
  })
  useAssetStore.getState().place(id, dir)
  return id
}

function matchMaterialName(text: string): string | null {
  const matBlock = text.match(/^Material:[\s\S]*?^\s*m_Name:\s*([^\r\n]+)/m)
  const direct = matBlock?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  if (direct) return direct
  const fallback = text.match(/^\s*m_Name:\s*([^\r\n]+)/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  return fallback || null
}

function parseTextureGuids(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let current = ''
  for (const line of text.split(/\r?\n/)) {
    const key = line.match(/^\s*-\s*(_[A-Za-z0-9_]+):\s*$/)?.[1]
    if (key) {
      current = key
      continue
    }
    if (!current) continue
    const guid = line.match(/^\s*m_Texture:\s*\{[^}]*guid:\s*([0-9a-fA-F]+)[^}]*\}/)?.[1]
    if (guid) out[current] = guid.toLowerCase()
  }
  return out
}

export function textureGuidRegex(text: string, property: string): string | null {
  const match = text.match(new RegExp(`${property}:[\\s\\S]{0,220}?guid:\\s*([0-9a-fA-F]+)`, 'i'))
  return match?.[1]?.toLowerCase() ?? null
}

function unityFloat(text: string, property: string): number | null {
  const match = text.match(new RegExp(`(?:^|\\s|-\\s*)${property}:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`, 'm'))
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function unityColorWithAlpha(text: string, property: string): { hex: string; alpha: number } | null {
  const match = text.match(
    new RegExp(`${property}:\\s*\\{[^}]*r:\\s*([-\\d.eE]+)[^}]*g:\\s*([-\\d.eE]+)[^}]*b:\\s*([-\\d.eE]+)(?:[^}]*a:\\s*([-\\d.eE]+))?`, 'i'),
  )
  if (!match) return null
  const channel = (raw: string) => Math.round(clamp01(Number(raw)) * 255).toString(16).padStart(2, '0')
  const hex = `#${channel(match[1] ?? '1')}${channel(match[2] ?? '1')}${channel(match[3] ?? '1')}`
  const alpha = match[4] != null && Number.isFinite(Number(match[4])) ? clamp01(Number(match[4])) : 1
  return { hex, alpha }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
