import { listAllRecipes, sedimentProjectToPack, trustAndActivatePack, uninstallPack, usePackStore } from '../../packs/manager'
import type { PackTier } from '../../packs/types'
import { commandBus } from '../bus'
import type { CommandDef } from '../types'

interface SedimentParams {
  id: string
  name: string
  version?: string
  description?: string
  tier?: PackTier
  migrateProjectScripts?: boolean
}

interface PackIdParams {
  packId: string
}

export function registerPackCommands(): () => void {
  const sedimentCmd: CommandDef<SedimentParams> = {
    id: 'pack.sediment',
    title: '沉淀工程为能力包',
    description: '将当前工程的脚本、着色器、组件与配方收集依赖并沉淀为标准能力包（支持 content / gameplay / effect 三层级）',
    params: {
      type: 'object',
      fields: {
        id: { type: 'string', default: '', label: '包 ID（如 user.my-rts）' },
        name: { type: 'string', default: '', label: '包显示名称' },
        version: { type: 'string', default: '1.0.0', label: '版本号', optional: true },
        description: { type: 'string', default: '', label: '包说明', optional: true },
        tier: {
          type: 'enum',
          default: 'gameplay',
          options: [
            { value: 'content', label: '内容包 (content)' },
            { value: 'gameplay', label: '玩法包 (gameplay)' },
            { value: 'effect', label: '效果包 (effect)' },
          ],
          label: '包层级',
          optional: true,
        },
        migrateProjectScripts: { type: 'boolean', default: true, label: '规整 __project__ 脚本到包命名空间', optional: true },
      },
    },
    risk: 'safe',
    async run(_ctx, params) {
      const res = await sedimentProjectToPack({
        id: String(params.id || ''),
        name: String(params.name || params.id || ''),
        version: params.version,
        description: params.description,
        tier: params.tier,
        migrateProjectScripts: params.migrateProjectScripts ?? true,
        createdBy: 'ai',
      })
      if (!res.ok || !res.bundle) {
        return { ok: false, code: 'PACK_SEDIMENT_FAILED', message: res.error ?? '沉淀失败' }
      }
      return {
        ok: true,
        value: {
          id: res.bundle.manifest.id,
          version: res.bundle.manifest.version,
          tier: res.bundle.manifest.tier,
          packDir: res.packDir ?? null,
          scripts: res.bundle.scripts.length,
          shaders: res.bundle.shaders.length,
          components: res.bundle.components.length,
        },
        changed: {
          summary: `沉淀能力包 ${res.bundle.manifest.id}@${res.bundle.manifest.version}`,
        },
      }
    },
  }

  const uninstallCmd: CommandDef<PackIdParams> = {
    id: 'pack.uninstall',
    title: '卸载能力包',
    description: '从当前工程卸载已安装的能力包并注销其运行期组件和能力',
    params: {
      type: 'object',
      fields: {
        packId: { type: 'string', default: '', label: '包 ID' },
      },
    },
    risk: 'confirm',
    async run(_ctx, params) {
      const ok = uninstallPack(String(params.packId || '').trim())
      if (!ok) return { ok: false, code: 'NOT_FOUND', message: `未找到已安装的能力包 ${params.packId}` }
      return {
        ok: true,
        value: { packId: params.packId },
        changed: { summary: `卸载能力包 ${params.packId}` },
      }
    },
  }

  const trustCmd: CommandDef<PackIdParams> = {
    id: 'pack.trust',
    title: '信任并启用导入包脚本',
    description: '确认信任外部导入的能力包，编译并激活其包含的脚本与着色器',
    params: {
      type: 'object',
      fields: {
        packId: { type: 'string', default: '', label: '包 ID' },
      },
    },
    risk: 'confirm',
    async run(_ctx, params) {
      const ok = await trustAndActivatePack(String(params.packId || '').trim())
      if (!ok) return { ok: false, code: 'NOT_FOUND', message: `未找到待信任的能力包 ${params.packId}` }
      return {
        ok: true,
        value: { packId: params.packId, trusted: true },
        changed: { summary: `信任并启用能力包 ${params.packId}` },
      }
    },
  }

  const listCmd: CommandDef<Record<string, never>> = {
    id: 'pack.list',
    title: '列出已安装能力包与配方',
    description: '查询当前工程已安装的能力包与所有可用官方/用户配方',
    params: { type: 'object', fields: {} },
    risk: 'safe',
    async run() {
      const installed = Object.values(usePackStore.getState().installed).map(rec => ({
        id: rec.bundle.manifest.id,
        version: rec.bundle.manifest.version,
        name: rec.bundle.manifest.name,
        tier: rec.bundle.manifest.tier,
        trusted: rec.trusted,
        scripts: rec.bundle.scripts.length,
        shaders: rec.bundle.shaders.length,
        components: rec.bundle.components.length,
      }))
      return {
        ok: true,
        value: {
          installed,
          recipes: listAllRecipes(),
        },
        changed: { summary: '查询已安装能力包与配方' },
      }
    },
  }

  const unsubs = [
    commandBus.register(sedimentCmd),
    commandBus.register(uninstallCmd),
    commandBus.register(trustCmd),
    commandBus.register(listCmd),
  ]
  return () => unsubs.forEach(fn => fn())
}
