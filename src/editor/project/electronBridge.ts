export interface ElectronListEntry {
  name: string
  kind: 'file' | 'directory'
}

export interface ElectronBridge {
  fs: {
    authorizeRoot?: (dirPath: string) => Promise<string>
    readTextFile: (filePath: string) => Promise<string>
    writeTextFile: (filePath: string, content: string) => Promise<void>
    exists: (filePath: string) => Promise<boolean>
    mkdir: (dirPath: string) => Promise<void>
    readBinaryFile: (filePath: string) => Promise<ArrayBuffer | null>
    writeBinaryFile: (filePath: string, data: ArrayBuffer) => Promise<void>
    movePath: (src: string, dest: string) => Promise<void>
    unlinkFile: (filePath: string) => Promise<void>
    removeDir: (dirPath: string) => Promise<void>
    list: (dirPath: string) => Promise<ElectronListEntry[]>
  }
  shell: {
    showItemInFolder: (filePath: string) => Promise<void>
    openPath: (targetPath: string) => Promise<void>
  }
  dialog: {
    showOpenDirectoryDialog: () => Promise<string | null>
  }
  player?: {
    copyShell: (targetDir: string) => Promise<{ ok: boolean; copiedFiles: string[]; message: string }>
  }
  codeAssets?: {
    watchProject: (projectDir: string) => Promise<boolean>
    openInEditor: (filePath: string, preferred?: 'cursor' | 'code') => Promise<{ ok: boolean; launcher: string }>
    onChanged: (handler: (payload: { relativePath: string }) => void) => () => void
  }
  ai?: {
    listProviders: () => Promise<{
      activeProviderId: string
      providers: Array<{
        id: string
        providerType: 'openai-compatible' | 'openai' | 'anthropic' | 'gemini'
        label: string
        baseUrl: string
        model: string
        hasApiKey: boolean
      }>
    }>
    saveProvider: (input: {
      id: string
      providerType?: 'openai-compatible' | 'openai' | 'anthropic' | 'gemini'
      label?: string
      baseUrl?: string
      model?: string
      apiKey?: string
      setActive?: boolean
    }) => Promise<{ activeProviderId: string; providers: unknown[] }>
    setActiveProvider: (id: string) => Promise<string>
    chat: (requestId: string, request: unknown) => Promise<{
      text: string
      toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      usage?: { inputTokens?: number; outputTokens?: number }
      model: string
    }>
    abort: (requestId: string) => Promise<void>
    onDelta: (handler: (delta: {
      requestId: string
      type: 'text' | 'done' | 'error'
      text?: string
      error?: string
    }) => void) => () => void
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
