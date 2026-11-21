import path from 'node:path'

/**
 * Electron 主进程文件访问路径守卫：
 * 所有 fs:* 与 shell 路径操作必须落在已授权根目录（工程目录或用户库目录）之内，
 * 防止 AI 或渲染进程通过相对路径穿越或绝对路径读写系统敏感文件。
 */
export class PathGuard {
  private readonly roots = new Set<string>()

  constructor(initialRoots: string[] = []) {
    for (const root of initialRoots) {
      this.authorizeRoot(root)
    }
  }

  authorizeRoot(dirPath: string): string {
    const resolved = path.resolve(dirPath)
    this.roots.add(normalizeForCompare(resolved))
    return resolved
  }

  listRoots(): string[] {
    return Array.from(this.roots)
  }

  isAllowed(targetPath: string): boolean {
    if (!targetPath || typeof targetPath !== 'string') return false
    const resolved = path.resolve(targetPath)
    const normalized = normalizeForCompare(resolved)
    for (const root of this.roots) {
      if (normalized === root) return true
      const rel = path.relative(root, normalized)
      if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return true
      }
    }
    return false
  }

  assertAllowed(targetPath: string, action = '访问文件'): string {
    if (!this.isAllowed(targetPath)) {
      throw new Error(`拒绝${action}：路径 "${targetPath}" 不在已授权的工程或用户库目录内`)
    }
    return path.resolve(targetPath)
  }
}

function normalizeForCompare(p: string): string {
  const cleaned = path.resolve(p)
  return process.platform === 'win32' ? cleaned.toLowerCase() : cleaned
}
