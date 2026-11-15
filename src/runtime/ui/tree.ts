import type { UiNode } from './spec'

export interface FlatUiNode {
  node: UiNode
  depth: number
}

export function findUiNode(root: UiNode, id: string): UiNode | null {
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const found = findUiNode(child, id)
    if (found) return found
  }
  return null
}

export function parentOf(root: UiNode, id: string, parent: UiNode | null = null): UiNode | null {
  if (root.id === id) return parent
  for (const child of root.children ?? []) {
    const found = parentOf(child, id, root)
    if (found) return found
  }
  return null
}

export function flattenUi(root: UiNode, depth = 0, out: FlatUiNode[] = []): FlatUiNode[] {
  out.push({ node: root, depth })
  for (const child of root.children ?? []) flattenUi(child, depth + 1, out)
  return out
}

export function mapUiNode(root: UiNode, id: string, map: (node: UiNode) => UiNode): UiNode {
  if (root.id === id) return map(root)
  if (!root.children?.length) return root
  let changed = false
  const children = root.children.map(child => {
    const next = mapUiNode(child, id, map)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...root, children } : root
}

export function insertUiChild(root: UiNode, parentId: string, child: UiNode): UiNode {
  return mapUiNode(root, parentId, parent => ({ ...parent, children: [...(parent.children ?? []), child] }))
}

export function removeUiNode(root: UiNode, id: string): UiNode {
  if (root.id === id) return root
  if (!root.children?.length) return root
  let changed = false
  const children = root.children.flatMap(child => {
    if (child.id === id) {
      changed = true
      return []
    }
    const next = removeUiNode(child, id)
    if (next !== child) changed = true
    return [next]
  })
  return changed ? { ...root, children } : root
}

export function shiftUiNode(root: UiNode, id: string, delta: -1 | 1): UiNode {
  const parent = parentOf(root, id)
  if (!parent?.children) return root
  const index = parent.children.findIndex(child => child.id === id)
  const next = index + delta
  if (index < 0 || next < 0 || next >= parent.children.length) return root
  const children = [...parent.children]
  const [item] = children.splice(index, 1)
  children.splice(next, 0, item)
  return mapUiNode(root, parent.id, node => ({ ...node, children }))
}

export function collectUiImageIds(root: UiNode, ids: Set<string>): void {
  if (root.imageId) ids.add(root.imageId)
  for (const child of root.children ?? []) collectUiImageIds(child, ids)
}

export function collectUiBindings(root: UiNode, out: Array<{ node: UiNode; binding: NonNullable<UiNode['bindings']>[number] }> = []) {
  for (const binding of root.bindings ?? []) out.push({ node: root, binding })
  for (const child of root.children ?? []) collectUiBindings(child, out)
  return out
}

export function containerIdFor(root: UiNode, selectedId: string): string {
  const selected = findUiNode(root, selectedId)
  if (selected && (selected.type === 'panel' || selected.type === 'stack')) return selected.id
  return parentOf(root, selectedId)?.id ?? root.id
}
