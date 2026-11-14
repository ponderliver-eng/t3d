import { childrenOf, makeNode } from '../scene/kinds'
import type { SceneNode, Vec3 } from '../scene/types'
import type { PrefabAsset } from './library'

const PLACEMENT = ['position', 'rotation', 'scale']
const SKIP = new Set([
  'id', 'parentId', 'order', 'prefabAssetId', 'prefabInstanceId', 'prefabTemplateId',
  'prefabHostTemplateId', 'prefabOverrides', 'prefabRemoved', 'nestedPrefabId',
])

export interface PrefabDocument {
  rootId: string
  nodes: Record<string, SceneNode>
}

type Lookup = (assetId: string) => PrefabDocument | null

export function readPrefab(asset: PrefabAsset | { nodes: SceneNode[] | Record<string, SceneNode>, rootId?: string }): PrefabDocument {
  if (!Array.isArray(asset.nodes)) {
    const nodes = asset.nodes
    const rootId = asset.rootId && nodes[asset.rootId] ? asset.rootId : Object.values(nodes).find(node => !node.parentId)?.id ?? ''
    return { rootId, nodes }
  }
  const nodes: Record<string, SceneNode> = {}
  for (const node of asset.nodes) nodes[node.id] = node
  const roots = Object.values(nodes).filter(node => !node.parentId || !nodes[node.parentId])
  if (roots.length === 1) return { rootId: roots[0].id, nodes }
  if (roots.length === 0) return { rootId: '', nodes }
  const rootId = crypto.randomUUID()
  nodes[rootId] = makeNode({ id: rootId, name: '预制体', kind: 'empty' })
  roots.forEach((node, order) => {
    node.parentId = rootId
    node.order = order
  })
  return { rootId, nodes }
}

export function isPrefabRoot(node: SceneNode | undefined): boolean {
  return !!node && !!node.prefabAssetId && node.prefabInstanceId === node.id
}

export function instanceDirty(nodes: Record<string, SceneNode>, rootId: string): boolean {
  const root = nodes[rootId]
  if (!isPrefabRoot(root)) return false
  if ((root.prefabRemoved ?? []).length > 0) return true
  return Object.values(nodes).some(node => {
    if (node.prefabInstanceId !== rootId) return false
    if (!node.prefabTemplateId) return true
    const overrides = (node.prefabOverrides ?? []).filter(key => !(node.id === rootId && PLACEMENT.includes(key)))
    return overrides.length > 0
  })
}

export function captureTemplate(scene: Record<string, SceneNode>, rootId: string): PrefabDocument {
  const nodes: Record<string, SceneNode> = {}
  const map = new Map<string, string>()
  const walk = (id: string, parentTemplate: string | null) => {
    const source = scene[id]
    if (!source) return
    if (isPrefabRoot(source) && id !== rootId) {
      const templateId = crypto.randomUUID()
      map.set(id, templateId)
      const copy = strip(source)
      copy.id = templateId
      copy.parentId = parentTemplate
      copy.nestedPrefabId = source.prefabAssetId
      nodes[templateId] = copy
      return
    }
    const templateId = crypto.randomUUID()
    map.set(id, templateId)
    const copy = strip(source)
    copy.id = templateId
    copy.parentId = parentTemplate
    nodes[templateId] = copy
    for (const child of childrenOf(scene, id)) walk(child.id, templateId)
  }
  walk(rootId, null)
  const root = nodes[map.get(rootId) ?? '']
  if (root) {
    root.position = [0, 0, 0]
    root.rotation = [0, 0, 0]
    root.scale = [1, 1, 1]
  }
  return { rootId: map.get(rootId) ?? '', nodes }
}

export function instantiatePrefab(
  scene: Record<string, SceneNode>,
  doc: PrefabDocument,
  assetId: string,
  parentId: string | null,
  position: Vec3 | null,
  lookup: Lookup,
  visiting = new Set<string>(),
): string | null {
  if (!doc.rootId || visiting.has(assetId)) return null
  visiting.add(assetId)
  const root = doc.nodes[doc.rootId]
  if (!root) return null
  const sceneRoot = crypto.randomUUID()
  const copy = strip(root)
  copy.id = sceneRoot
  copy.parentId = parentId
  copy.order = nextOrder(scene, parentId)
  copy.name = uniqueName(scene, copy.name)
  if (position) copy.position = [position[0], position[1], position[2]]
  copy.prefabAssetId = assetId
  copy.prefabInstanceId = sceneRoot
  copy.prefabTemplateId = root.id
  copy.prefabOverrides = position ? [...PLACEMENT] : []
  scene[sceneRoot] = copy
  expand(scene, doc, assetId, root.id, sceneRoot, sceneRoot, lookup, visiting)
  visiting.delete(assetId)
  return sceneRoot
}

export function reconcilePrefab(scene: Record<string, SceneNode>, assetId: string, doc: PrefabDocument, lookup: Lookup) {
  const roots = Object.values(scene).filter(node => node.prefabAssetId === assetId && node.prefabInstanceId === node.id)
  for (const root of roots) syncInstance(scene, root.id, doc, assetId, lookup)
}

export function applyInstance(scene: Record<string, SceneNode>, instanceId: string, doc: PrefabDocument): PrefabDocument {
  const next = structuredClone(doc) as PrefabDocument
  const removed = new Set(scene[instanceId]?.prefabRemoved ?? [])
  for (const id of removed) deleteTemplate(next.nodes, id)
  for (const node of Object.values(scene)) {
    if (node.prefabInstanceId !== instanceId || !node.prefabTemplateId) continue
    const template = next.nodes[node.prefabTemplateId]
    if (!template) continue
    for (const key of node.prefabOverrides ?? []) {
      if (SKIP.has(key) || (node.id === instanceId && PLACEMENT.includes(key))) continue
      copyKey(template, node, key)
    }
    node.prefabOverrides = node.id === instanceId ? [...PLACEMENT] : []
  }
  for (const node of [...Object.values(scene)]) {
    if (node.prefabInstanceId !== instanceId || node.prefabTemplateId) continue
    const parent = node.parentId ? scene[node.parentId] : undefined
    const parentTemplate = parent?.prefabTemplateId
    if (!parentTemplate || !next.nodes[parentTemplate]) continue
    if (isPrefabRoot(node)) {
      const templateId = crypto.randomUUID()
      const placeholder = strip(node)
      placeholder.id = templateId
      placeholder.parentId = parentTemplate
      placeholder.nestedPrefabId = node.prefabAssetId
      placeholder.order = nextOrder(next.nodes, parentTemplate)
      next.nodes[templateId] = placeholder
      node.prefabHostTemplateId = templateId
      continue
    }
    graftAdded(scene, next.nodes, node.id, parentTemplate)
  }
  if (scene[instanceId]) scene[instanceId].prefabRemoved = []
  return next
}

export function revertInstance(scene: Record<string, SceneNode>, instanceId: string, doc: PrefabDocument, assetId: string, lookup: Lookup) {
  const root = scene[instanceId]
  if (!root) return
  for (const node of Object.values(scene)) {
    if (node.prefabInstanceId !== instanceId) continue
    if (!node.prefabTemplateId && node.id !== instanceId) delete scene[node.id]
    else node.prefabOverrides = node.id === instanceId ? [...PLACEMENT] : []
  }
  root.prefabRemoved = []
  syncInstance(scene, instanceId, doc, assetId, lookup)
}

export function unpackInstance(scene: Record<string, SceneNode>, instanceId: string) {
  for (const node of Object.values(scene)) {
    if (node.prefabInstanceId !== instanceId) continue
    delete node.prefabAssetId
    delete node.prefabInstanceId
    delete node.prefabTemplateId
    delete node.prefabHostTemplateId
    delete node.prefabOverrides
    delete node.prefabRemoved
  }
}

export function rememberRemoval(scene: Record<string, SceneNode>, id: string) {
  const node = scene[id]
  if (!node?.prefabTemplateId || !node.prefabInstanceId || node.id === node.prefabInstanceId) return
  const root = scene[node.prefabInstanceId]
  if (!root) return
  root.prefabRemoved = [...new Set([...(root.prefabRemoved ?? []), node.prefabTemplateId])]
}

export function detachIfReparented(scene: Record<string, SceneNode>, id: string) {
  const node = scene[id]
  if (!node?.prefabInstanceId || node.id === node.prefabInstanceId || !node.prefabTemplateId) return
  const rootId = node.prefabInstanceId
  if (contains(scene, rootId, id)) {
    rememberRemoval(scene, id)
    delete node.prefabTemplateId
    delete node.prefabOverrides
    return
  }
  const templateIds = [node.prefabTemplateId]
  const walk = (current: string) => {
    for (const child of childrenOf(scene, current)) {
      if (child.prefabInstanceId === rootId && child.prefabTemplateId) templateIds.push(child.prefabTemplateId)
      if (child.prefabInstanceId === rootId) walk(child.id)
    }
  }
  walk(id)
  const root = scene[rootId]
  if (root) root.prefabRemoved = [...new Set([...(root.prefabRemoved ?? []), ...templateIds])]
  const clear = (current: string) => {
    const item = scene[current]
    if (!item || item.prefabInstanceId !== rootId) return
    delete item.prefabAssetId
    delete item.prefabInstanceId
    delete item.prefabTemplateId
    delete item.prefabHostTemplateId
    delete item.prefabOverrides
    delete item.prefabRemoved
    for (const child of childrenOf(scene, current)) clear(child.id)
  }
  clear(id)
}

export function tagAddedChild(scene: Record<string, SceneNode>, id: string) {
  const node = scene[id]
  const parent = node?.parentId ? scene[node.parentId] : undefined
  if (!node || !parent?.prefabInstanceId || node.prefabAssetId) return
  node.prefabAssetId = parent.prefabAssetId
  node.prefabInstanceId = parent.prefabInstanceId
}

export function retargetInstance(scene: Record<string, SceneNode>, oldRoot: string, newRoot: string) {
  const walk = (id: string) => {
    const node = scene[id]
    if (!node) return
    if (node.prefabInstanceId === oldRoot) node.prefabInstanceId = newRoot
    for (const child of childrenOf(scene, id)) walk(child.id)
  }
  walk(newRoot)
}

export function markOverrides(node: SceneNode, patch: Partial<SceneNode>) {
  if (!node.prefabAssetId) return
  const keys = Object.keys(patch).filter(key => !SKIP.has(key) && key !== 'clipTime' && key !== 'clipPlaying')
  if (keys.length === 0) return
  node.prefabOverrides = [...new Set([...(node.prefabOverrides ?? []), ...keys])]
}

function syncInstance(scene: Record<string, SceneNode>, instanceId: string, doc: PrefabDocument, assetId: string, lookup: Lookup) {
  const root = scene[instanceId]
  const templateRoot = doc.nodes[doc.rootId]
  if (!root || !templateRoot) return
  const removed = new Set(root.prefabRemoved ?? [])
  const byTemplate = new Map<string, SceneNode>()
  for (const node of Object.values(scene)) {
    if (node.prefabInstanceId === instanceId && node.prefabTemplateId) byTemplate.set(node.prefabTemplateId, node)
    if (node.prefabHostTemplateId) byTemplate.set(node.prefabHostTemplateId, node)
  }
  const keep = new Set<string>([instanceId])
  const visit = (templateId: string, parentSceneId: string | null) => {
    if (removed.has(templateId)) return
    const template = doc.nodes[templateId]
    if (!template) return
    if (template.nestedPrefabId) {
      let nested = byTemplate.get(templateId)
      if (!nested || !isPrefabRoot(nested)) {
        const nestedDoc = lookup(template.nestedPrefabId)
        const created = nestedDoc ? instantiatePrefab(scene, nestedDoc, template.nestedPrefabId, parentSceneId, null, lookup) : null
        nested = created ? scene[created] : undefined
        if (nested) {
          nested.prefabHostTemplateId = templateId
          nested.position = [...template.position]
          nested.rotation = [...template.rotation]
          nested.scale = [...template.scale]
          nested.prefabOverrides = (nested.prefabOverrides ?? []).filter(key => !PLACEMENT.includes(key))
        }
      } else if (nested.parentId !== parentSceneId) nested.parentId = parentSceneId
      if (nested) {
        applyProps(nested, template, new Set(nested.prefabOverrides ?? []))
        keep.add(nested.id)
      }
      return
    }
    let node = templateId === doc.rootId ? root : byTemplate.get(templateId)
    if (!node) {
      const id = crypto.randomUUID()
      node = strip(template)
      node.id = id
      node.parentId = parentSceneId
      node.order = template.order
      node.prefabAssetId = assetId
      node.prefabInstanceId = instanceId
      node.prefabTemplateId = templateId
      node.prefabOverrides = []
      scene[id] = node
    } else if (node.id !== instanceId) node.parentId = parentSceneId
    const overrides = new Set(node.prefabOverrides ?? [])
    if (node.id === instanceId) PLACEMENT.forEach(key => overrides.add(key))
    applyProps(node, template, overrides)
    keep.add(node.id)
    for (const child of childrenOf(doc.nodes, templateId)) visit(child.id, node.id)
  }
  visit(doc.rootId, root.parentId)
  for (const node of Object.values(scene)) {
    if (node.prefabInstanceId !== instanceId || !node.prefabTemplateId) continue
    if (!keep.has(node.id)) deleteSubtree(scene, node.id)
  }
}

function expand(
  scene: Record<string, SceneNode>,
  doc: PrefabDocument,
  assetId: string,
  templateParent: string,
  sceneParent: string,
  instanceId: string,
  lookup: Lookup,
  visiting: Set<string>,
) {
  for (const template of childrenOf(doc.nodes, templateParent)) {
    if (template.nestedPrefabId) {
      const nestedDoc = lookup(template.nestedPrefabId)
      const nestedId = nestedDoc ? instantiatePrefab(scene, nestedDoc, template.nestedPrefabId, sceneParent, null, lookup, visiting) : null
      const nested = nestedId ? scene[nestedId] : undefined
      if (!nested) continue
      nested.prefabHostTemplateId = template.id
      nested.position = [...template.position]
      nested.rotation = [...template.rotation]
      nested.scale = [...template.scale]
      nested.order = template.order
      nested.prefabOverrides = []
      continue
    }
    const id = crypto.randomUUID()
    const node = strip(template)
    node.id = id
    node.parentId = sceneParent
    node.order = template.order
    node.prefabAssetId = assetId
    node.prefabInstanceId = instanceId
    node.prefabTemplateId = template.id
    node.prefabOverrides = []
    scene[id] = node
    expand(scene, doc, assetId, template.id, id, instanceId, lookup, visiting)
  }
}

function graftAdded(scene: Record<string, SceneNode>, templateNodes: Record<string, SceneNode>, id: string, parentTemplate: string) {
  const map = new Map<string, string>()
  const walk = (current: string, parent: string) => {
    const source = scene[current]
    if (!source || isPrefabRoot(source)) return
    const templateId = crypto.randomUUID()
    map.set(current, templateId)
    const copy = strip(source)
    copy.id = templateId
    copy.parentId = parent
    copy.order = source.order
    templateNodes[templateId] = copy
    source.prefabTemplateId = templateId
    source.prefabOverrides = []
    for (const child of childrenOf(scene, current)) walk(child.id, templateId)
  }
  walk(id, parentTemplate)
}

function deleteTemplate(nodes: Record<string, SceneNode>, id: string) {
  for (const child of childrenOf(nodes, id)) deleteTemplate(nodes, child.id)
  delete nodes[id]
}

function deleteSubtree(nodes: Record<string, SceneNode>, id: string) {
  for (const child of childrenOf(nodes, id)) deleteSubtree(nodes, child.id)
  delete nodes[id]
}

function applyProps(target: SceneNode, source: SceneNode, overrides: Set<string>) {
  for (const key of Object.keys(source) as (keyof SceneNode)[]) {
    if (SKIP.has(key) || overrides.has(key)) continue
    copyKey(target, source, key)
  }
}

function copyKey(target: SceneNode, source: SceneNode, key: string) {
  const value = source[key as keyof SceneNode]
  ;(target as unknown as Record<string, unknown>)[key] = structuredClone(value)
}

function strip(node: SceneNode): SceneNode {
  const copy = structuredClone(node)
  delete copy.prefabAssetId
  delete copy.prefabInstanceId
  delete copy.prefabTemplateId
  delete copy.prefabHostTemplateId
  delete copy.prefabOverrides
  delete copy.prefabRemoved
  return copy
}

function contains(nodes: Record<string, SceneNode>, ancestor: string, id: string): boolean {
  let current = nodes[id]?.parentId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    if (current === ancestor) return true
    seen.add(current)
    current = nodes[current]?.parentId ?? null
  }
  return false
}

function nextOrder(nodes: Record<string, SceneNode>, parentId: string | null): number {
  let max = -1
  for (const node of Object.values(nodes)) if (node.parentId === parentId) max = Math.max(max, node.order)
  return max + 1
}

function uniqueName(nodes: Record<string, SceneNode>, base: string): string {
  const names = new Set(Object.values(nodes).map(node => node.name))
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}
