import { useAssetStore } from '../../../editor/assets/library'
import { projectDirectoryPath } from '../../../editor/project/disk'
import { electronBridge, joinProjectPath } from '../../../editor/project/electronBridge'
import { useEditorStore } from '../../../editor/scene/store'
import {
  codeAssetRelativePath,
  compileCodeAsset,
  defaultTemplateFor,
  normalizeCodeAssetId,
  saveAndCompileCodeAsset,
  useCodeAssetStore,
} from '../../codeAssets/workspace'
import { commandBus } from '../bus'
import type { CommandDef } from '../types'

interface CodeSourceParams {
  id: string
  source?: string
}

interface AttachScriptParams {
  nodeId: string
  scriptId: string
  params?: Record<string, unknown>
}

interface BindShaderParams {
  shaderId: string
  materialId?: string
  nodeId?: string
}

interface OpenExternalParams {
  kind: 'script' | 'shader'
  id: string
  editor?: 'cursor' | 'code'
}

export function registerCodeAssetCommands(): () => void {
  const shaderCreateCmd: CommandDef<CodeSourceParams> = {
    id: 'shader.create',
    title: '新建着色器资产',
    description: '创建一个 TSL 表面着色器文件（shaders/<id>.shader.ts）并立即编译检查',
    params: {
      type: 'object',
      fields: {
        id: { type: 'string', default: '', label: '着色器 ID 或名称' },
        source: { type: 'string', default: '', label: 'TSL 着色器源码（留空则生成模板）', optional: true },
      },
    },
    risk: 'safe',
    async run(_ctx, params) {
      const rawId = String(params.id || '').trim()
      if (!rawId) return { ok: false, code: 'INVALID_ARGS', message: '着色器 ID 不能为空' }
      const id = normalizeCodeAssetId('shader', rawId)
      const source = typeof params.source === 'string' && params.source.trim()
        ? params.source
        : defaultTemplateFor('shader', id)
      const record = await saveAndCompileCodeAsset('shader', id, source)
      return {
        ok: true,
        value: {
          id: record.id,
          relativePath: record.relativePath,
          ok: record.ok,
          diagnostics: record.diagnostics,
        },
        changed: {
          projectChanged: true,
          summary: `新建着色器资产 ${record.relativePath}`,
        },
      }
    },
  }

  const shaderUpdateCmd: CommandDef<CodeSourceParams> = {
    id: 'shader.update',
    title: '更新着色器资产',
    description: '更新着色器源码、重新编译并热重载',
    params: {
      type: 'object',
      fields: {
        id: { type: 'string', default: '', label: '着色器 ID' },
        source: { type: 'string', default: '', label: '新源码' },
      },
    },
    risk: 'safe',
    async run(_ctx, params) {
      const id = normalizeCodeAssetId('shader', String(params.id || ''))
      const record = await saveAndCompileCodeAsset('shader', id, String(params.source ?? ''))
      return {
        ok: true,
        value: {
          id: record.id,
          relativePath: record.relativePath,
          ok: record.ok,
          diagnostics: record.diagnostics,
        },
        changed: {
          projectChanged: true,
          summary: `更新着色器 ${record.relativePath}`,
        },
      }
    },
  }

  const shaderCheckCmd: CommandDef<CodeSourceParams> = {
    id: 'shader.check',
    title: '检查着色器源码',
    description: '对着色器 TS 源码执行语法检查与 TSL 构建试编译，不写入磁盘',
    params: {
      type: 'object',
      fields: {
        id: { type: 'string', default: 'check', label: '着色器 ID' },
        source: { type: 'string', default: '', label: '源码' },
      },
    },
    risk: 'safe',
    run(_ctx, params) {
      const id = normalizeCodeAssetId('shader', String(params.id || 'check'))
      const rel = codeAssetRelativePath('shader', id)
      const record = compileCodeAsset('shader', id, rel, String(params.source ?? ''))
      return {
        ok: true,
        value: { ok: record.ok, diagnostics: record.diagnostics },
        changed: {
          summary: record.ok ? '着色器检查通过' : `发现 ${record.diagnostics.length} 条诊断`,
        },
      }
    },
  }

  const scriptCreateCmd: CommandDef<CodeSourceParams> = {
    id: 'script.create',
    title: '新建脚本资产',
    description: '创建一个 t3d/runtime TypeScript 脚本（scripts/<id>.ts）并立即编译注册',
    params: {
      type: 'object',
      fields: {
        id: { type: 'string', default: '', label: '脚本 ID 或名称' },
        source: { type: 'string', default: '', label: '脚本源码（留空则生成行为模板）', optional: true },
      },
    },
    risk: 'safe',
    async run(_ctx, params) {
      const rawId = String(params.id || '').trim()
      if (!rawId) return { ok: false, code: 'INVALID_ARGS', message: '脚本 ID 不能为空' }
      const id = normalizeCodeAssetId('script', rawId)
      const source = typeof params.source === 'string' && params.source.trim()
        ? params.source
        : defaultTemplateFor('script', id)
      const record = await saveAndCompileCodeAsset('script', id, source)
      return {
        ok: true,
        value: {
          id: record.id,
          relativePath: record.relativePath,
          ok: record.ok,
          diagnostics: record.diagnostics,
        },
        changed: {
          projectChanged: true,
          summary: `新建脚本资产 ${record.relativePath}`,
        },
      }
    },
  }

  const scriptUpdateCmd: CommandDef<CodeSourceParams> = {
    id: 'script.update',
    title: '更新脚本资产',
    description: '更新脚本源码、重新编译并保留 self.state 热重载',
    params: {
      type: 'object',
      fields: {
        id: { type: 'string', default: '', label: '脚本 ID' },
        source: { type: 'string', default: '', label: '新源码' },
      },
    },
    risk: 'safe',
    async run(_ctx, params) {
      const id = normalizeCodeAssetId('script', String(params.id || ''))
      const record = await saveAndCompileCodeAsset('script', id, String(params.source ?? ''))
      return {
        ok: true,
        value: {
          id: record.id,
          relativePath: record.relativePath,
          ok: record.ok,
          diagnostics: record.diagnostics,
        },
        changed: {
          projectChanged: true,
          summary: `更新并热重载脚本 ${record.relativePath}`,
        },
      }
    },
  }

  const scriptCheckCmd: CommandDef<CodeSourceParams> = {
    id: 'script.check',
    title: '检查脚本源码',
    description: '对脚本 TS 源码执行语法检查与模块加载测试',
    params: {
      type: 'object',
      fields: {
        id: { type: 'string', default: 'check', label: '脚本 ID' },
        source: { type: 'string', default: '', label: '源码' },
      },
    },
    risk: 'safe',
    run(_ctx, params) {
      const id = normalizeCodeAssetId('script', String(params.id || 'check'))
      const rel = codeAssetRelativePath('script', id)
      const record = compileCodeAsset('script', id, rel, String(params.source ?? ''))
      return {
        ok: true,
        value: { ok: record.ok, diagnostics: record.diagnostics },
        changed: {
          summary: record.ok ? '脚本检查通过' : `发现 ${record.diagnostics.length} 条诊断`,
        },
      }
    },
  }

  const scriptAttachCmd: CommandDef<AttachScriptParams> = {
    id: 'script.attach',
    title: '挂载脚本到节点',
    description: '将工程脚本挂载到节点 node.gameplay.packs.__project__[scriptId] 并设置参数',
    params: {
      type: 'object',
      fields: {
        nodeId: { type: 'string', default: '', label: '目标节点 ID' },
        scriptId: { type: 'string', default: '', label: '脚本 ID' },
        params: { type: 'object', fields: {}, label: '脚本参数', optional: true },
      },
    },
    risk: 'safe',
    run(_ctx, params) {
      const nodeId = String(params.nodeId || '')
      const scriptId = normalizeCodeAssetId('script', String(params.scriptId || ''))
      const store = useEditorStore.getState()
      const node = store.nodes[nodeId]
      if (!node) return { ok: false, code: 'NOT_FOUND', message: `节点 "${nodeId}" 不存在` }

      const prevGameplay = node.gameplay
      const prevPacks = node.gameplay?.packs ?? {}
      const prevProject = (prevPacks.__project__ ?? {}) as Record<string, unknown>
      const scriptParams = params.params && typeof params.params === 'object' ? params.params : {}

      store.updateNode(nodeId, {
        gameplay: {
          ...prevGameplay,
          packs: {
            ...prevPacks,
            __project__: {
              ...prevProject,
              [scriptId]: scriptParams,
            },
          },
        },
      })
      return {
        ok: true,
        value: { nodeId, scriptId, params: scriptParams },
        changed: {
          nodeIds: [nodeId],
          summary: `为节点 "${node.name}" 挂载脚本 ${scriptId}`,
        },
      }
    },
  }

  const openExternalCmd: CommandDef<OpenExternalParams> = {
    id: 'codeAsset.openExternal',
    title: '用外部编辑器打开代码资产',
    description: '一键调起 Cursor / VS Code 打开脚本或着色器文件',
    params: {
      type: 'object',
      fields: {
        kind: {
          type: 'enum',
          options: [
            { value: 'script', label: '脚本' },
            { value: 'shader', label: '着色器' },
          ],
          default: 'script',
          label: '资产类型',
        },
        id: { type: 'string', default: '', label: '代码资产 ID' },
        editor: {
          type: 'enum',
          options: [
            { value: 'cursor', label: 'Cursor' },
            { value: 'code', label: 'VS Code' },
          ],
          default: 'cursor',
          label: '首选编辑器',
          optional: true,
        },
      },
    },
    risk: 'safe',
    async run(_ctx, params) {
      const dir = projectDirectoryPath()
      if (!dir) return { ok: false, code: 'NO_PROJECT_DIR', message: '当前工程未保存到磁盘目录，无法用外部编辑器打开' }
      const kind = params.kind === 'shader' ? 'shader' : 'script'
      const id = normalizeCodeAssetId(kind, String(params.id || ''))
      const absPath = joinProjectPath(dir, codeAssetRelativePath(kind, id))
      const bridge = electronBridge()
      if (!bridge?.codeAssets?.openInEditor) {
        return { ok: false, code: 'UNAVAILABLE', message: '当前环境不支持调起外部编辑器' }
      }
      const res = await bridge.codeAssets.openInEditor(
        absPath,
        params.editor === 'code' ? 'code' : 'cursor',
      )
      return {
        ok: true,
        value: { path: absPath, launcher: res.launcher },
        changed: {
          summary: `已在 ${res.launcher} 中打开 ${codeAssetRelativePath(kind, id)}`,
        },
      }
    },
  }

  const shaderBindCmd: CommandDef<BindShaderParams> = {
    id: 'shader.bind',
    title: '将着色器绑定到材质或节点',
    description: '将已创建的工程着色器（shaders/<id>.shader.ts）绑定到指定材质资产或场景节点',
    params: {
      type: 'object',
      fields: {
        shaderId: { type: 'string', default: '', label: '着色器 ID' },
        materialId: { type: 'ref', target: 'asset', kinds: ['material'], label: '材质资产 ID（可选）', optional: true },
        nodeId: { type: 'ref', target: 'node', label: '节点 ID（可选）', optional: true },
      },
    },
    risk: 'safe',
    async run(_ctx, params) {
      const shaderId = normalizeCodeAssetId('shader', String(params.shaderId || ''))
      if (!shaderId) return { ok: false, code: 'INVALID_ARGS', message: '着色器 ID 不能为空' }
      const codeRecord = useCodeAssetStore.getState().assets[shaderId]
      if (!codeRecord || codeRecord.kind !== 'shader') {
        return { ok: false, code: 'NOT_FOUND', message: `着色器 "${shaderId}" 不存在` }
      }
      const shaderRef = `custom:${shaderId}` as const
      const updatedTargets: string[] = []

      if (params.materialId) {
        const asset = useAssetStore.getState().assets[params.materialId]
        if (!asset || asset.kind !== 'material') {
          return { ok: false, code: 'NOT_FOUND', message: `材质资产 "${params.materialId}" 不存在` }
        }
        useAssetStore.getState().updateMaterial(params.materialId, {
          ...asset.slot,
          shader: shaderRef,
        })
        updatedTargets.push(`材质 ${asset.name}`)
      }

      if (params.nodeId) {
        const node = useEditorStore.getState().nodes[params.nodeId]
        if (!node) {
          return { ok: false, code: 'NOT_FOUND', message: `节点 "${params.nodeId}" 不存在` }
        }
        useEditorStore.getState().updateNode(params.nodeId, { shader: shaderRef })
        updatedTargets.push(`节点 ${node.name}`)
      }

      if (updatedTargets.length === 0) {
        return { ok: false, code: 'INVALID_ARGS', message: '请至少指定 materialId 或 nodeId 其中之一' }
      }

      return {
        ok: true,
        value: { shaderId, shader: shaderRef, targets: updatedTargets },
        changed: {
          summary: `已将着色器 ${shaderId} 绑定到 ${updatedTargets.join('、')}`,
        },
      }
    },
  }

  const unsubs = [
    commandBus.register(shaderCreateCmd),
    commandBus.register(shaderUpdateCmd),
    commandBus.register(shaderCheckCmd),
    commandBus.register(shaderBindCmd),
    commandBus.register(scriptCreateCmd),
    commandBus.register(scriptUpdateCmd),
    commandBus.register(scriptCheckCmd),
    commandBus.register(scriptAttachCmd),
    commandBus.register(openExternalCmd),
  ]
  return () => unsubs.forEach((fn) => fn())
}

void useCodeAssetStore
