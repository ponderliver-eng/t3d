export interface TagDefinition {
  id: string
  name: string
}

export interface LayerDefinition {
  id: string
  name: string
  bitIndex: number
  builtIn?: boolean
}

export const TAG_ID_MAIN_CAMERA = 'tag_main_camera'
export const TAG_NAME_MAIN_CAMERA = 'MainCamera'
export const TAG_FILTER_UNTAGGED = '__untagged__'
export const LAYER_ID_DEFAULT = 'layer_default'
export const ALL_LAYERS_VISIBLE_MASK = 0xffff_ffff >>> 0
/** 编辑器手柄和网格占用这一位，不分配给项目层。 */
export const EDITOR_HELPER_LAYER = 31

const DEFAULT_LAYERS: LayerDefinition[] = [
  { id: LAYER_ID_DEFAULT, name: 'Default', bitIndex: 0, builtIn: true },
]

export function defaultTags(): TagDefinition[] {
  return [{ id: TAG_ID_MAIN_CAMERA, name: TAG_NAME_MAIN_CAMERA }]
}

export function defaultLayers(): LayerDefinition[] {
  return DEFAULT_LAYERS.map(layer => ({ ...layer }))
}

export function ensureTags(tags: TagDefinition[] | undefined): TagDefinition[] {
  const list = (tags ?? []).map(tag => ({ id: tag.id, name: tag.name }))
  if (list.some(tag => tag.id === TAG_ID_MAIN_CAMERA || tag.name === TAG_NAME_MAIN_CAMERA)) return list
  return [{ id: TAG_ID_MAIN_CAMERA, name: TAG_NAME_MAIN_CAMERA }, ...list]
}

export function sortedTags(tags: TagDefinition[]): TagDefinition[] {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export function ensureLayers(layers: LayerDefinition[] | undefined): LayerDefinition[] {
  const list = layers && layers.length > 0 ? layers.map(layer => ({ ...layer })) : defaultLayers()
  if (!list.some(layer => layer.id === LAYER_ID_DEFAULT)) {
    list.unshift({ id: LAYER_ID_DEFAULT, name: 'Default', bitIndex: 0, builtIn: true })
  }
  return list
}

export function sortedLayers(layers: LayerDefinition[]): LayerDefinition[] {
  return [...layers].sort((a, b) => a.bitIndex - b.bitIndex)
}

export function bitIndexToMask(bitIndex: number): number {
  if (bitIndex < 0 || bitIndex > 30) return 0
  return (1 << bitIndex) >>> 0
}

export function layerBitIndex(renderLayerId: string | undefined, layers: LayerDefinition[]): number {
  const id = renderLayerId || LAYER_ID_DEFAULT
  const hit = layers.find(layer => layer.id === id) ?? layers.find(layer => layer.id === LAYER_ID_DEFAULT) ?? layers[0]
  return hit?.bitIndex ?? 0
}

export function findNextFreeBitIndex(layers: LayerDefinition[]): number | null {
  const used = new Set(layers.map(layer => layer.bitIndex))
  for (let bit = 0; bit < EDITOR_HELPER_LAYER; bit += 1) {
    if (!used.has(bit)) return bit
  }
  return null
}

export function reshapeCollisionRows(
  previous: Record<string, number> | undefined,
  layers: LayerDefinition[],
): Record<string, number> {
  let valid = 0
  for (const layer of layers) valid = (valid | bitIndexToMask(layer.bitIndex)) >>> 0
  const rows: Record<string, number> = {}
  for (const layer of layers) {
    const own = bitIndexToMask(layer.bitIndex)
    const stored = previous?.[layer.id]
    const row = typeof stored === 'number' && Number.isFinite(stored) ? (stored & valid) >>> 0 : valid
    rows[layer.id] = (row | own) >>> 0
  }
  return rows
}

export function toggleCollisionPair(
  rows: Record<string, number>,
  a: LayerDefinition,
  b: LayerDefinition,
  checked: boolean,
): Record<string, number> {
  const next = { ...rows }
  const bitA = bitIndexToMask(a.bitIndex)
  const bitB = bitIndexToMask(b.bitIndex)
  const rowA = (next[a.id] ?? 0) >>> 0
  const rowB = (next[b.id] ?? 0) >>> 0
  if (checked) {
    next[a.id] = (rowA | bitB) >>> 0
    next[b.id] = (rowB | bitA) >>> 0
  } else {
    next[a.id] = (rowA & ~bitB) >>> 0
    next[b.id] = (rowB & ~bitA) >>> 0
  }
  return next
}

/** Rapier 只有 16 位分组。更高的层位不写入碰撞组，保持与所有层相撞。 */
export function rapierCollisionGroups(
  renderLayerId: string | undefined,
  layers: LayerDefinition[],
  enabled: boolean,
  rows: Record<string, number>,
): number | undefined {
  if (!enabled) return undefined
  const bit = layerBitIndex(renderLayerId, layers)
  if (bit > 15) return undefined
  const id = layers.find(layer => layer.bitIndex === bit)?.id ?? LAYER_ID_DEFAULT
  const membership = (1 << bit) & 0xffff
  const filter = (rows[id] ?? 0xffff) & 0xffff
  return ((membership << 16) | filter) >>> 0
}
