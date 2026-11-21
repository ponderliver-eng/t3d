import { getRuntimeWorld } from '../runtime/world'
import type { SceneNode } from '../editor/scene/types'
import { findRow } from './registry'

const bags = new Map<string, Map<string, number>>()

export function matchesTag(actual: string | undefined | null, query: string): boolean {
  if (!actual || !query) return false
  const have = actual.trim()
  let want = query.trim()
  if (!have || !want) return false
  if (want.endsWith('.*')) want = want.slice(0, -2)
  if (have === want) return true
  return have.startsWith(`${want}.`)
}

export interface RuntimeTagView {
  tag: string
  /** 剩余秒数。空表示常驻。 */
  remaining: number | null
}

export function listRuntimeTags(nodeId: string, now = performance.now() / 1000): RuntimeTagView[] {
  const bag = bags.get(nodeId)
  if (!bag) return []
  return [...bag.entries()].map(([tag, until]) => ({
    tag,
    remaining: until > 0 ? Math.max(0, until - now) : null,
  }))
}

export function clearRuntimeTags() {
  bags.clear()
}

export function tickRuntimeTags(now: number) {
  for (const [nodeId, bag] of bags) {
    for (const [tag, until] of bag) {
      if (until > 0 && now >= until) bag.delete(tag)
    }
    if (bag.size === 0) bags.delete(nodeId)
  }
}

export function nodeHasTag(node: SceneNode, query: string): boolean {
  if (!query.trim()) return false
  if (matchesTag(node.tagId, query)) return true
  for (const tag of node.tagIds ?? []) {
    if (matchesTag(tag, query)) return true
  }
  const bag = bags.get(node.id)
  if (!bag) return false
  for (const tag of bag.keys()) {
    if (matchesTag(tag, query)) return true
  }
  return false
}

export function addRuntimeTag(nodeId: string, tag: string, seconds: number, now: number): boolean {
  const id = tag.trim()
  if (!id || blocked(nodeId, id)) return false
  const bag = bags.get(nodeId) ?? new Map<string, number>()
  const previous = bag.get(id)
  if (previous === 0 || seconds <= 0) bag.set(id, 0)
  else bag.set(id, Math.max(previous ?? 0, now + seconds))
  bags.set(nodeId, bag)
  enforceBlocks(nodeId)
  return bags.get(nodeId)?.has(id) ?? false
}

export function removeRuntimeTag(nodeId: string, tag: string) {
  const id = tag.trim()
  if (!id) return
  const bag = bags.get(nodeId)
  if (!bag) return
  for (const key of [...bag.keys()]) {
    if (matchesTag(key, id)) bag.delete(key)
  }
  if (bag.size === 0) bags.delete(nodeId)
}

function blockPrefix(tag: string): string {
  const row = findRow(getRuntimeWorld().getGameDatabase(), 'tags', tag)
  const prefix = row?.fields?.blockPrefix
  return typeof prefix === 'string' ? prefix.trim() : ''
}

function blocked(nodeId: string, tag: string): boolean {
  const bag = bags.get(nodeId)
  if (!bag) return false
  for (const held of bag.keys()) {
    const prefix = blockPrefix(held)
    if (prefix && matchesTag(tag, prefix)) return true
  }
  return false
}

function enforceBlocks(nodeId: string) {
  const bag = bags.get(nodeId)
  if (!bag) return
  const prefixes = [...bag.keys()].map(blockPrefix).filter(Boolean)
  if (prefixes.length === 0) return
  for (const key of [...bag.keys()]) {
    if (prefixes.some(prefix => matchesTag(key, prefix))) bag.delete(key)
  }
}
