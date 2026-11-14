export const ASSETS_ROOT = 'Assets'

export interface DirNode {
  name: string
  path: string
  children: DirNode[]
}

export function normalizeDir(path: string): string {
  const parts = path.split(/[\\/]+/).map(part => part.trim()).filter(part => part && part !== '.' && part !== '..')
  if (parts[0] !== ASSETS_ROOT) parts.unshift(ASSETS_ROOT)
  return parts.join('/')
}

export function parentDir(path: string): string | null {
  const dir = normalizeDir(path)
  if (dir === ASSETS_ROOT) return null
  const index = dir.lastIndexOf('/')
  return index < 0 ? ASSETS_ROOT : dir.slice(0, index)
}

export function dirName(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? path : path.slice(index + 1)
}

export function joinDir(parent: string, name: string): string {
  return `${normalizeDir(parent)}/${name.trim()}`
}

export function isWithin(path: string, root: string): boolean {
  const dir = normalizeDir(path)
  const base = normalizeDir(root)
  return dir === base || dir.startsWith(`${base}/`)
}

export function relocateDir(path: string, from: string, to: string): string {
  const dir = normalizeDir(path)
  const source = normalizeDir(from)
  const target = normalizeDir(to)
  if (dir === source) return target
  if (dir.startsWith(`${source}/`)) return `${target}${dir.slice(source.length)}`
  return dir
}

export function directoryTree(folders: string[], assetDirs: Record<string, string>): DirNode {
  const root: DirNode = { name: ASSETS_ROOT, path: ASSETS_ROOT, children: [] }
  const nodes = new Map<string, DirNode>([[ASSETS_ROOT, root]])
  const paths = new Set<string>([ASSETS_ROOT])
  for (const folder of folders) paths.add(normalizeDir(folder))
  for (const dir of Object.values(assetDirs)) paths.add(normalizeDir(dir))
  for (const path of paths) {
    const parts = path.split('/')
    let current = parts[0] || ASSETS_ROOT
    for (let index = 1; index < parts.length; index += 1) {
      const parent = current
      current = `${current}/${parts[index]}`
      if (nodes.has(current)) continue
      const node: DirNode = { name: parts[index] ?? current, path: current, children: [] }
      nodes.set(current, node)
      nodes.get(parent)?.children.push(node)
    }
  }
  const sort = (node: DirNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    node.children.forEach(sort)
  }
  sort(root)
  return root
}

export function findDir(node: DirNode, path: string): DirNode | null {
  if (node.path === path) return node
  for (const child of node.children) {
    const found = findDir(child, path)
    if (found) return found
  }
  return null
}

export function directoryExists(path: string, folders: string[], assetDirs: Record<string, string>): boolean {
  const target = normalizeDir(path)
  if (target === ASSETS_ROOT) return true
  return [...folders.map(normalizeDir), ...Object.values(assetDirs).map(normalizeDir)].some(dir => dir === target || dir.startsWith(`${target}/`))
}

export function uniqueFolderName(parent: string, folders: string[], assetDirs: Record<string, string>): string {
  const node = findDir(directoryTree(folders, assetDirs), normalizeDir(parent))
  const names = new Set(node?.children.map(child => child.name) ?? [])
  let name = '新建文件夹'
  let index = 2
  while (names.has(name)) {
    name = `新建文件夹 ${index}`
    index += 1
  }
  return name
}
