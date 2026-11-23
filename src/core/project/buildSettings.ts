import { create } from 'zustand'
import { directoryProjectName, projectDirectoryPath } from '../../editor/project/disk'
import { electronBridge, joinProjectPath } from '../../editor/project/electronBridge'

export type BuildTarget = 'web' | 'electron'
export type PreloadMode = 'entry-scene' | 'all-scenes' | 'minimal'
export type TextureBuildMode = 'webp' | 'original'
export type TextureMaxSize = 0 | 2048 | 1024 | 512

export interface BuildSceneEntry {
  sceneId: string
  enabled: boolean
}

export interface BuildLoadingConfig {
  enabled: boolean
  title: string
  subtitle: string
  logoAssetId: string | null
  backgroundAssetId: string | null
  backgroundColor: string
  accentColor: string
  showProgressBar: boolean
  minDisplayMs: number
  showOnSceneSwitch: boolean
}

export interface BuildElectronConfig {
  appName: string
  width: number
  height: number
  fullscreen: boolean
  resizable: boolean
  iconAssetId: string | null
}

export interface BuildSettings {
  version: 1
  target: BuildTarget
  entrySceneId: string
  scenes: BuildSceneEntry[]
  stripUnusedAssets: boolean
  bakeModelsToGlb: boolean
  textureMode: TextureBuildMode
  textureMaxSize: TextureMaxSize
  preloadMode: PreloadMode
  loading: BuildLoadingConfig
  electron: BuildElectronConfig
}

export function createDefaultBuildSettings(projectName = 'Tact3D Game'): BuildSettings {
  return {
    version: 1,
    target: 'web',
    entrySceneId: '',
    scenes: [],
    stripUnusedAssets: true,
    bakeModelsToGlb: true,
    textureMode: 'webp',
    textureMaxSize: 0,
    preloadMode: 'entry-scene',
    loading: {
      enabled: true,
      title: projectName,
      subtitle: '正在加载资源…',
      logoAssetId: null,
      backgroundAssetId: null,
      backgroundColor: '#141820',
      accentColor: '#4a9eff',
      showProgressBar: true,
      minDisplayMs: 350,
      showOnSceneSwitch: true,
    },
    electron: {
      appName: projectName,
      width: 1280,
      height: 720,
      fullscreen: false,
      resizable: true,
      iconAssetId: null,
    },
  }
}

export function normalizeBuildSettings(
  raw: Partial<BuildSettings> | null | undefined,
  availableSceneIds: string[],
  activeSceneId: string,
  projectName = 'Tact3D Game',
): BuildSettings {
  const base = createDefaultBuildSettings(projectName)
  if (!raw || typeof raw !== 'object') {
    const scenes = availableSceneIds.map((sceneId) => ({ sceneId, enabled: true }))
    const entry = availableSceneIds.includes(activeSceneId) ? activeSceneId : (availableSceneIds[0] ?? '')
    return { ...base, entrySceneId: entry, scenes }
  }

  const availableSet = new Set(availableSceneIds)
  const seen = new Set<string>()
  const scenes: BuildSceneEntry[] = []

  if (Array.isArray(raw.scenes)) {
    for (const item of raw.scenes) {
      if (!item || typeof item.sceneId !== 'string') continue
      if (!availableSet.has(item.sceneId) || seen.has(item.sceneId)) continue
      seen.add(item.sceneId)
      scenes.push({ sceneId: item.sceneId, enabled: item.enabled !== false })
    }
  }
  for (const id of availableSceneIds) {
    if (!seen.has(id)) {
      seen.add(id)
      scenes.push({ sceneId: id, enabled: true })
    }
  }

  let entrySceneId = typeof raw.entrySceneId === 'string' && availableSet.has(raw.entrySceneId)
    ? raw.entrySceneId
    : ''
  const enabledList = scenes.filter((s) => s.enabled)
  if (!entrySceneId || !enabledList.some((s) => s.sceneId === entrySceneId)) {
    entrySceneId = enabledList.find((s) => s.sceneId === activeSceneId)?.sceneId
      ?? enabledList[0]?.sceneId
      ?? (availableSceneIds.includes(activeSceneId) ? activeSceneId : (availableSceneIds[0] ?? ''))
  }

  const rawLoading: Partial<BuildLoadingConfig> = raw.loading && typeof raw.loading === 'object' ? raw.loading : {}
  const rawElectron: Partial<BuildElectronConfig> = raw.electron && typeof raw.electron === 'object' ? raw.electron : {}

  return {
    version: 1,
    target: raw.target === 'electron' ? 'electron' : 'web',
    entrySceneId,
    scenes,
    stripUnusedAssets: raw.stripUnusedAssets !== false,
    bakeModelsToGlb: raw.bakeModelsToGlb !== false,
    textureMode: raw.textureMode === 'original' ? 'original' : 'webp',
    textureMaxSize: raw.textureMaxSize === 2048 || raw.textureMaxSize === 1024 || raw.textureMaxSize === 512 ? raw.textureMaxSize : 0,
    preloadMode: raw.preloadMode === 'all-scenes' || raw.preloadMode === 'minimal' ? raw.preloadMode : 'entry-scene',
    loading: {
      enabled: rawLoading.enabled !== false,
      title: typeof rawLoading.title === 'string' ? rawLoading.title : base.loading.title,
      subtitle: typeof rawLoading.subtitle === 'string' ? rawLoading.subtitle : base.loading.subtitle,
      logoAssetId: typeof rawLoading.logoAssetId === 'string' ? rawLoading.logoAssetId : null,
      backgroundAssetId: typeof rawLoading.backgroundAssetId === 'string' ? rawLoading.backgroundAssetId : null,
      backgroundColor: typeof rawLoading.backgroundColor === 'string' && rawLoading.backgroundColor ? rawLoading.backgroundColor : base.loading.backgroundColor,
      accentColor: typeof rawLoading.accentColor === 'string' && rawLoading.accentColor ? rawLoading.accentColor : base.loading.accentColor,
      showProgressBar: rawLoading.showProgressBar !== false,
      minDisplayMs: typeof rawLoading.minDisplayMs === 'number' && Number.isFinite(rawLoading.minDisplayMs)
        ? Math.max(0, Math.min(5000, Math.round(rawLoading.minDisplayMs)))
        : base.loading.minDisplayMs,
      showOnSceneSwitch: rawLoading.showOnSceneSwitch !== false,
    },
    electron: {
      appName: typeof rawElectron.appName === 'string' && rawElectron.appName.trim() ? rawElectron.appName : base.electron.appName,
      width: typeof rawElectron.width === 'number' && rawElectron.width >= 320 ? Math.round(rawElectron.width) : base.electron.width,
      height: typeof rawElectron.height === 'number' && rawElectron.height >= 240 ? Math.round(rawElectron.height) : base.electron.height,
      fullscreen: Boolean(rawElectron.fullscreen),
      resizable: rawElectron.resizable !== false,
      iconAssetId: typeof rawElectron.iconAssetId === 'string' && rawElectron.iconAssetId ? rawElectron.iconAssetId : null,
    },
  }
}

interface BuildSettingsState {
  settings: BuildSettings
  setSettings: (next: BuildSettings) => void
  patchSettings: (patch: Partial<BuildSettings>) => void
  patchLoading: (patch: Partial<BuildLoadingConfig>) => void
  patchElectron: (patch: Partial<BuildElectronConfig>) => void
  reset: (projectName?: string) => void
}

export const useBuildSettingsStore = create<BuildSettingsState>((set) => ({
  settings: createDefaultBuildSettings(),
  setSettings: (settings) => set({ settings }),
  patchSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  patchLoading: (patch) => set((s) => ({ settings: { ...s.settings, loading: { ...s.settings.loading, ...patch } } })),
  patchElectron: (patch) => set((s) => ({ settings: { ...s.settings, electron: { ...s.settings.electron, ...patch } } })),
  reset: (projectName) => set({ settings: createDefaultBuildSettings(projectName) }),
}))

const BUILD_SETTINGS_FILE = 'build.json'
const BUILD_DRAFT_KEY = 't3d:build-settings-draft'

export async function loadBuildSettingsFromProject(
  availableSceneIds: string[],
  activeSceneId: string,
): Promise<BuildSettings> {
  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  const projName = directoryProjectName() || 'Tact3D Game'
  let raw: Partial<BuildSettings> | null = null
  if (dir && bridge?.fs) {
    const file = joinProjectPath(dir, BUILD_SETTINGS_FILE)
    if (await bridge.fs.exists(file)) {
      try {
        raw = JSON.parse(await bridge.fs.readTextFile(file)) as Partial<BuildSettings>
      } catch {
        raw = null
      }
    }
  } else if (typeof localStorage !== 'undefined') {
    try {
      const cached = localStorage.getItem(BUILD_DRAFT_KEY)
      if (cached) raw = JSON.parse(cached) as Partial<BuildSettings>
    } catch {
      raw = null
    }
  }
  const normalized = normalizeBuildSettings(raw, availableSceneIds, activeSceneId, projName)
  useBuildSettingsStore.getState().setSettings(normalized)
  return normalized
}

export async function saveBuildSettingsToProject(settings?: BuildSettings): Promise<void> {
  const target = settings ?? useBuildSettingsStore.getState().settings
  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge?.fs) {
    await bridge.fs.writeTextFile(joinProjectPath(dir, BUILD_SETTINGS_FILE), `${JSON.stringify(target, null, 2)}\n`)
  } else if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(BUILD_DRAFT_KEY, JSON.stringify(target))
    } catch {
      // ignore
    }
  }
}
