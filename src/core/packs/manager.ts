import { create } from 'zustand'
import { registerDynamicCapability, unregisterDynamicCapability } from '../../capabilities/registry'
import { projectDirectoryPath } from '../../editor/project/disk'
import { electronBridge, joinProjectPath } from '../../editor/project/electronBridge'
import { useEditorStore } from '../../editor/scene/store'
import { registerGameplayPack, unregisterGameplayPack } from '../../gameplay/registry'
import { saveAndCompileCodeAsset, useCodeAssetStore } from '../codeAssets/workspace'
import type { InstalledPackRecord, PackBundle, PackCodeEntry, PackComponentDef, PackManifest, PackRecipe, PackTier } from './types'

export const BUILTIN_RECIPES: PackRecipe[] = [
  {
    id: 'official.platformer-starter',
    name: '平台跳跃最小闭环',
    description: '包含地面、主角控制器、跟拍相机、检查点、收集物与终点规则的最小可玩配方。',
    tier: 'gameplay',
    steps: [
      '创建地面 Plane 并开启 static Box 碰撞体',
      '创建主角节点并挂载 Character + CameraFollow',
      '放置 2 个平台、1 个 Checkpoint 检查点与 3 个收集物',
      '配置 Rules 规则：收集全部物品后达成通关',
    ],
    smoke: ['forward 1.5s', 'jump', 'forward 1.2s', 'assert distanceTo(checkpoint) < 3'],
  },
  {
    id: 'official.topdown-patrol',
    name: '俯视角巡逻与射击',
    description: '结合导航寻路、行为脚本（巡逻/扣血）与自定义命中闪光 Shader 的动作模板。',
    tier: 'gameplay',
    steps: [
      '开启 navigation 能力并烘焙基础地面网格',
      '挂载巡逻脚本（patrol）与可受击生命值组件',
      '绑定自定义命中高光 Shader 到敌人材质槽',
    ],
    smoke: ['wait 0.5s', 'action fire', 'wait 1.0s'],
  },
  {
    id: 'official.stylized-water-vfx',
    name: '风格化水体与环境氛围',
    description: '结合水体能力、天空大气与自定义流动波纹 Shader 的环境效果包配方。',
    tier: 'effect',
    steps: [
      '启用 sky 与 water 能力包',
      '应用流动波纹自定义 Shader 到水面材质',
      '在 picture 中开启适度泛光与雾效',
    ],
    smoke: ['wait 0.8s'],
  },
]

interface PackStoreState {
  installed: Record<string, InstalledPackRecord>
  upsertInstalled: (record: InstalledPackRecord) => void
  removeInstalled: (packId: string) => void
  setTrusted: (packId: string, trusted: boolean) => void
  clear: () => void
}

export const usePackStore = create<PackStoreState>((set) => ({
  installed: {},
  upsertInstalled: (record) =>
    set((state) => ({
      installed: { ...state.installed, [record.bundle.manifest.id]: record },
    })),
  removeInstalled: (packId) =>
    set((state) => {
      const next = { ...state.installed }
      delete next[packId]
      return { installed: next }
    }),
  setTrusted: (packId, trusted) =>
    set((state) => {
      const existing = state.installed[packId]
      if (!existing) return state
      return {
        installed: {
          ...state.installed,
          [packId]: { ...existing, trusted },
        },
      }
    }),
  clear: () => set({ installed: {} }),
}))

export interface SedimentOptions {
  id: string
  name: string
  version?: string
  description?: string
  tier?: PackTier
  nodeIds?: string[]
  scriptIds?: string[]
  shaderIds?: string[]
  includeAllCodeAssets?: boolean
  createdBy?: 'user' | 'ai'
  migrateProjectScripts?: boolean
}

export async function sedimentProjectToPack(options: SedimentOptions): Promise<{ ok: boolean; bundle?: PackBundle; packDir?: string; error?: string }> {
  const rawId = options.id.trim()
  if (!rawId) return { ok: false, error: '包 ID 不能为空' }
  const packId = rawId.includes('.') ? rawId : `user.${rawId}`
  const version = options.version?.trim() || '1.0.0'
  const editor = useEditorStore.getState()
  const codeAssets = useCodeAssetStore.getState().assets

  const targetNodes = options.nodeIds?.length
    ? options.nodeIds.map(id => editor.nodes[id]).filter(Boolean)
    : Object.values(editor.nodes)

  const scriptSet = new Set<string>(options.scriptIds ?? [])
  const shaderSet = new Set<string>(options.shaderIds ?? [])

  if (options.includeAllCodeAssets !== false && !options.scriptIds?.length && !options.shaderIds?.length) {
    for (const asset of Object.values(codeAssets)) {
      if (asset.kind === 'script') scriptSet.add(asset.id)
      else if (asset.kind === 'shader') shaderSet.add(asset.id)
    }
  }

  for (const node of targetNodes) {
    if (node.shader?.startsWith('custom:')) {
      shaderSet.add(node.shader.slice('custom:'.length))
    }
    for (const slot of node.slots ?? []) {
      if (slot.shader?.startsWith('custom:')) {
        shaderSet.add(slot.shader.slice('custom:'.length))
      }
    }
    const projectScripts = node.gameplay?.packs?.__project__ as Record<string, unknown> | undefined
    if (projectScripts) {
      for (const sid of Object.keys(projectScripts)) scriptSet.add(sid)
    }
  }

  const scripts: PackCodeEntry[] = []
  const shaders: PackCodeEntry[] = []
  const components: PackComponentDef[] = []

  for (const sid of scriptSet) {
    const asset = codeAssets[sid]
    if (!asset || asset.kind !== 'script') continue
    scripts.push({
      id: asset.id,
      name: asset.name,
      relativePath: asset.relativePath,
      source: asset.source,
    })
    const behavior = asset.compiledScript?.behavior
    if (behavior) {
      const defaults: Record<string, unknown> = {}
      for (const [k, schema] of Object.entries(behavior.params ?? {})) {
        defaults[k] = 'default' in schema ? schema.default : undefined
      }
      components.push({
        id: asset.id,
        name: behavior.name || asset.name,
        description: behavior.description,
        scriptId: asset.id,
        fields: behavior.params ?? {},
        defaults,
      })
    }
  }

  for (const shid of shaderSet) {
    const asset = codeAssets[shid]
    if (!asset || asset.kind !== 'shader') continue
    shaders.push({
      id: asset.id,
      name: asset.name,
      relativePath: asset.relativePath,
      source: asset.source,
    })
  }

  const tier: PackTier = options.tier ?? (scripts.length > 0 ? 'gameplay' : shaders.length > 0 ? 'effect' : 'content')

  const recipe: PackRecipe = {
    id: `${packId}.starter`,
    name: `${options.name} 快速示例`,
    description: options.description || `由工程沉淀生成的 ${options.name} 能力包配方`,
    tier,
    steps: [
      `安装能力包 ${packId}@${version}`,
      ...(components.length > 0 ? [`为目标节点添加组件：${components.map(c => c.name).join('、')}`] : []),
      ...(shaders.length > 0 ? [`在材质球中选择自定义着色器：${shaders.map(s => s.name).join('、')}`] : []),
    ],
  }

  const manifest: PackManifest = {
    id: packId,
    version,
    name: options.name.trim() || packId,
    description: options.description?.trim() || `${options.name} 沉淀能力包`,
    tier,
    engine: '>=0.1.0',
    dependencies: [],
    provides: {
      components: components.map(c => c.id),
      scripts: scripts.map(s => s.id),
      shaders: shaders.map(s => s.id),
      recipes: [recipe.id],
    },
    provenance: {
      sourceProject: projectDirectoryPath() ?? 'memory-project',
      createdBy: options.createdBy ?? 'user',
      createdAt: new Date().toISOString(),
      licenses: [],
    },
    trust: 'local',
  }

  const readme = [
    `# ${manifest.name} (${manifest.id}@${manifest.version})`,
    '',
    manifest.description,
    '',
    `- 层级: ${manifest.tier}`,
    `- 包含脚本: ${scripts.length} 个`,
    `- 包含着色器: ${shaders.length} 个`,
    `- 包含组件: ${components.length} 个`,
    '',
    '## 使用步骤',
    ...recipe.steps.map((s, i) => `${i + 1}. ${s}`),
  ].join('\n')

  const bundle: PackBundle = {
    manifest,
    scripts,
    shaders,
    tables: [],
    defaultRows: {},
    components,
    recipes: [recipe],
    readme,
  }

  // 若开启规整，将当前节点上 __project__ 中的对应脚本迁移到新 packId 下
  if (options.migrateProjectScripts) {
    const nextNodes = { ...editor.nodes }
    let migrated = false
    for (const [nid, node] of Object.entries(nextNodes)) {
      const proj = node.gameplay?.packs?.__project__ as Record<string, Record<string, unknown>> | undefined
      if (!proj) continue
      const moved: Record<string, Record<string, unknown>> = {}
      const remaining: Record<string, Record<string, unknown>> = { ...proj }
      let nodeMoved = false
      for (const sid of scriptSet) {
        if (sid in remaining) {
          moved[sid] = remaining[sid]
          delete remaining[sid]
          nodeMoved = true
        }
      }
      if (nodeMoved) {
        migrated = true
        const nextPacks = { ...(node.gameplay?.packs ?? {}), __project__: remaining, [packId]: moved }
        nextNodes[nid] = {
          ...node,
          gameplay: { ...(node.gameplay ?? { tags: [] }), packs: nextPacks },
        }
      }
    }
    if (migrated) {
      useEditorStore.setState({ nodes: nextNodes })
    }
  }

  let packDir: string | undefined
  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge) {
    packDir = joinProjectPath(dir, `packs/${packId}@${version}`)
    await bridge.fs.writeTextFile(joinProjectPath(packDir, 'pack.json'), JSON.stringify(bundle, null, 2))
    await bridge.fs.writeTextFile(joinProjectPath(packDir, 'README.md'), readme)
  }

  await installPackBundle(bundle, { trusted: true, sourceDir: packDir })
  return { ok: true, bundle, packDir }
}

export async function installPackBundle(
  bundle: PackBundle,
  options?: { trusted?: boolean; sourceDir?: string },
): Promise<{ ok: boolean; needsTrustConfirmation?: boolean }> {
  const { manifest } = bundle
  const hasCode = bundle.scripts.length > 0 || bundle.shaders.length > 0
  const trusted = options?.trusted ?? (manifest.trust === 'local' || !hasCode)

  usePackStore.getState().upsertInstalled({
    bundle,
    trusted,
    installedAt: Date.now(),
    sourceDir: options?.sourceDir,
  })

  if (!trusted) {
    return { ok: true, needsTrustConfirmation: true }
  }

  await activateTrustedPack(bundle)
  return { ok: true, needsTrustConfirmation: false }
}

export async function trustAndActivatePack(packId: string): Promise<boolean> {
  const record = usePackStore.getState().installed[packId]
  if (!record) return false
  usePackStore.getState().setTrusted(packId, true)
  await activateTrustedPack(record.bundle)
  return true
}

async function activateTrustedPack(bundle: PackBundle) {
  const { manifest } = bundle
  for (const sh of bundle.shaders) {
    await saveAndCompileCodeAsset('shader', sh.id, sh.source)
  }
  for (const sc of bundle.scripts) {
    await saveAndCompileCodeAsset('script', sc.id, sc.source)
  }

  registerGameplayPack({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    dependencies: manifest.dependencies.map(d => d.id),
    tables: bundle.tables.map(t => ({
      ...t,
      defaultRows: bundle.defaultRows[t.tableId] ?? t.defaultRows ?? [],
    })),
    components: bundle.components.map(c => ({
      componentId: c.id,
      label: c.name,
      color: '#a855f7',
      group: 'pack',
      defaultData: () => structuredClone(c.defaults),
      Card: () => null,
    })),
  })

  if (manifest.tier === 'effect') {
    registerDynamicCapability({
      id: manifest.id,
      defaultEnabled: true,
      category: 'environment',
    })
  }

  const editor = useEditorStore.getState()
  if (!editor.gameplayPacks.includes(manifest.id)) {
    useEditorStore.setState({
      gameplayPacks: [...editor.gameplayPacks, manifest.id],
    })
  }
}

export function uninstallPack(packId: string): boolean {
  const record = usePackStore.getState().installed[packId]
  if (!record) return false
  unregisterGameplayPack(packId)
  if (record.bundle.manifest.tier === 'effect') {
    unregisterDynamicCapability(packId)
  }
  usePackStore.getState().removeInstalled(packId)
  const editor = useEditorStore.getState()
  useEditorStore.setState({
    gameplayPacks: editor.gameplayPacks.filter(id => id !== packId),
  })
  return true
}

export function listAllRecipes(): PackRecipe[] {
  const userRecipes: PackRecipe[] = []
  for (const rec of Object.values(usePackStore.getState().installed)) {
    userRecipes.push(...rec.bundle.recipes)
  }
  return [...BUILTIN_RECIPES, ...userRecipes]
}
