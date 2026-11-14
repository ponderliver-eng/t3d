export interface ElectronListEntry {
  name: string
  kind: 'file' | 'directory'
}

export interface ElectronBridge {
  fs: {
    readTextFile: (filePath: string) => Promise<string>
    writeTextFile: (filePath: string, content: string) => Promise<void>
    exists: (filePath: string) => Promise<boolean>
    mkdir: (dirPath: string) => Promise<void>
    readBinaryFile: (filePath: string) => Promise<ArrayBuffer>
    writeBinaryFile: (filePath: string, data: ArrayBuffer) => Promise<void>
    movePath: (src: string, dest: string) => Promise<void>
    unlinkFile: (filePath: string) => Promise<void>
    removeDir: (dirPath: string) => Promise<void>
    list: (dirPath: string) => Promise<ElectronListEntry[]>
  }
  dialog: {
    showOpenDirectoryDialog: () => Promise<string | null>
  }
}

export function electronBridge(): ElectronBridge | null {
  if (typeof window === 'undefined') return null
  return (window as Window & { __electron?: ElectronBridge }).__electron ?? null
}

export function joinProjectPath(root: string, relative: string): string {
  const rel = relative.replace(/\\/g, '/').replace(/^\/+/, '')
  const base = root.replace(/[\\/]+$/, '')
  return rel ? `${base}/${rel}` : base
}

export function directoryBaseName(absPath: string): string {
  const parts = absPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || absPath
}

export function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}
