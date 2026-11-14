import { openProjectDb, RECENT_HANDLE_STORE, storedDirectoryHandle } from './disk'

/**
 * 最近工程。列表在 localStorage，目录句柄在 IndexedDB。
 * 浏览器没有绝对路径，句柄就是 GM Electron 里的工程路径。
 */

const RECENT_KEY = 't3d_recent_projects'
const MAX_RECENTS = 10

export interface RecentProject {
  id: string
  name: string
  openedAt: number
  /** Electron 下的工程目录绝对路径。浏览器里没有路径，只保存目录句柄。 */
  path?: string
}

interface RecentRow extends RecentProject {
  handle: FileSystemDirectoryHandle
}

export const RecentProjectService = {
  getAll(): RecentProject[] {
    try {
      const raw = localStorage.getItem(RECENT_KEY)
      const parsed = raw ? JSON.parse(raw) as unknown : []
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isRecent).sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_RECENTS)
    } catch {
      return []
    }
  },

  addPath(absPath: string, name: string): RecentProject {
    const path = absPath.replace(/[\\/]+$/, '')
    const id = path.replace(/\\/g, '/').toLowerCase()
    const next: RecentProject = { id, name: name.trim() || path, openedAt: Date.now(), path }
    const list = [next, ...this.getAll().filter(item => item.id !== id)].slice(0, MAX_RECENTS)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
    return next
  },

  async add(handle: FileSystemDirectoryHandle, name: string): Promise<RecentProject> {
    const rows = await readRows()
    let id = ''
    for (const row of rows) {
      if (await sameDirectory(row.handle, handle)) {
        id = row.id
        break
      }
    }
    if (!id) id = crypto.randomUUID()
    const next: RecentRow = { id, name: name.trim() || handle.name || 'Project', openedAt: Date.now(), handle }
    const kept = [next, ...rows.filter(row => row.id !== id)].slice(0, MAX_RECENTS)
    await writeRows(kept)
    return { id: next.id, name: next.name, openedAt: next.openedAt }
  },

  remove(id: string) {
    const list = this.getAll().filter(item => item.id !== id)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
    void openProjectDb().then(db => {
      const tx = db.transaction(RECENT_HANDLE_STORE, 'readwrite')
      tx.objectStore(RECENT_HANDLE_STORE).delete(id)
    }).catch(() => undefined)
  },

  async handleOf(id: string): Promise<FileSystemDirectoryHandle | null> {
    const db = await openProjectDb()
    return new Promise((resolve, reject) => {
      const query = db.transaction(RECENT_HANDLE_STORE, 'readonly').objectStore(RECENT_HANDLE_STORE).get(id)
      query.onsuccess = () => {
        const row = query.result as RecentRow | undefined
        resolve(row?.handle ?? null)
      }
      query.onerror = () => reject(query.error)
    })
  },

  /** 把旧的「当前目录」句柄补进最近列表，刷新后菜单里能看到上次工程。 */
  async seedFromLegacy(): Promise<void> {
    const handle = await storedDirectoryHandle()
    if (!handle) return
    await this.add(handle, handle.name)
  },
}

function isRecent(value: unknown): value is RecentProject {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<RecentProject>
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.openedAt !== 'number') return false
  return row.path === undefined || typeof row.path === 'string'
}

async function readRows(): Promise<RecentRow[]> {
  const db = await openProjectDb()
  return new Promise((resolve, reject) => {
    const query = db.transaction(RECENT_HANDLE_STORE, 'readonly').objectStore(RECENT_HANDLE_STORE).getAll()
    query.onsuccess = () => resolve((query.result as RecentRow[] | undefined) ?? [])
    query.onerror = () => reject(query.error)
  })
}

async function writeRows(rows: RecentRow[]): Promise<void> {
  const db = await openProjectDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(RECENT_HANDLE_STORE, 'readwrite')
    const store = tx.objectStore(RECENT_HANDLE_STORE)
    store.clear()
    for (const row of rows) store.put(row, row.id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  localStorage.setItem(RECENT_KEY, JSON.stringify(rows.map(({ id, name, openedAt }) => ({ id, name, openedAt }))))
}

async function sameDirectory(a: FileSystemDirectoryHandle, b: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return await a.isSameEntry(b)
  } catch {
    return false
  }
}
