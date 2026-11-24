import { useEditorStore } from '../../../editor/scene/store'
import type { ScenePicture } from '../../../editor/scene/types'
import {
  createCheckpoint,
  getDesignMarkdown,
  loadDesignDocFromProject,
  restoreCheckpoint,
  updateDesignDoc,
  type ProjectDesignDoc,
  type ProjectDesignPatch,
} from '../../project'
import { commandBus } from '../bus'
import type { CommandDef } from '../types'

interface UpdatePictureParams {
  patch: Record<string, unknown>
}

const updatePictureCmd: CommandDef<UpdatePictureParams, { updated: string[] }> = {
  id: 'picture.update',
  title: '更新画面与后期参数',
  description: '修改当前场景的画面配置（曝光、雾效、泛光、SSR、SSGI、AO、音频音量等）',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      patch: { type: 'object', fields: {}, label: 'ScenePicture 补丁' },
    },
  },
  run(_ctx, p) {
    const state = useEditorStore.getState()
    const nextPicture: ScenePicture = {
      ...state.picture,
      ...(p.patch as Partial<ScenePicture>),
    }
    useEditorStore.setState({ picture: nextPicture })
    return {
      ok: true,
      value: { updated: Object.keys(p.patch) },
      changed: { pictureChanged: true, summary: `更新画面参数（${Object.keys(p.patch).join(', ')}）` },
    }
  },
}

const createSceneCmd: CommandDef<Record<string, never>, { sceneId: string }> = {
  id: 'project.createScene',
  title: '新建场景',
  risk: 'safe',
  params: { type: 'object', fields: {} },
  run() {
    useEditorStore.getState().createScene()
    return {
      ok: true,
      value: { sceneId: useEditorStore.getState().activeSceneId },
      changed: { projectChanged: true, summary: '新建场景' },
    }
  },
}

interface OpenSceneParams {
  sceneId: string
}

const openSceneCmd: CommandDef<OpenSceneParams, { sceneId: string }> = {
  id: 'project.openScene',
  title: '切换活动场景',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      sceneId: { type: 'ref', target: 'asset', kinds: ['scene'], required: true, label: '场景资产 ID' },
    },
  },
  run(_ctx, p) {
    useEditorStore.getState().openScene(p.sceneId)
    return {
      ok: true,
      value: { sceneId: useEditorStore.getState().activeSceneId },
      changed: { projectChanged: true, summary: `切换场景 ${p.sceneId}` },
    }
  },
}

const getDesignCmd: CommandDef<Record<string, never>, ProjectDesignDoc & { markdown: string }> = {
  id: 'project.design.get',
  title: '读取工程设计规范（design.md）',
  mutatesDocument: false,
  risk: 'safe',
  params: { type: 'object', fields: {} },
  async run() {
    // 先从磁盘读回：用户可能刚手改过 design.md
    const doc = await loadDesignDocFromProject()
    return { ok: true, value: { ...doc, markdown: getDesignMarkdown() }, changed: {} }
  },
}

interface UpdateDesignParams {
  patch: ProjectDesignPatch
}

const designText = (label: string, description?: string) =>
  ({ type: 'string', default: '', label, optional: true, ...(description ? { description } : {}) }) as const

const updateDesignCmd: CommandDef<UpdateDesignParams, ProjectDesignDoc> = {
  id: 'project.design.update',
  title: '更新工程设计规范（design.md）',
  description:
    '更新游戏设计概要与风格规范。只传需要修改的字段，未传的字段与 design.md 里用户手写的其它章节都会原样保留；追加自由说明用 appendNotes，不要用 notes 整段覆盖',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      patch: {
        type: 'object',
        label: '设计规范补丁',
        description: '只包含要修改的字段',
        fields: {
          title: designText('游戏标题'),
          genre: designText('类型'),
          perspective: designText('视角'),
          coreLoop: designText('核心循环'),
          winLose: designText('胜负条件'),
          artStyle: designText('美术风格'),
          colorPalette: {
            type: 'list',
            label: '色彩板',
            optional: true,
            item: { type: 'string', default: '', label: '颜色（十六进制或名称）' },
          },
          controls: designText('操作映射'),
          namingRules: designText('命名约定'),
          notes: designText('补充说明', '整段替换「补充说明」小节；一般应改用 appendNotes'),
          appendNotes: designText('追加补充说明', '追加到「补充说明」小节末尾，不覆盖已有内容'),
        },
      },
    },
  },
  async run(_ctx, p) {
    await loadDesignDocFromProject()
    const next = await updateDesignDoc(p.patch)
    return {
      ok: true,
      value: next,
      changed: { filesChanged: ['design.md'], projectChanged: true, summary: `更新设计规范 ${next.title}` },
    }
  },
}

interface CreateCheckpointParams {
  label: string
  starred?: boolean
}

const createCheckpointCmd: CommandDef<CreateCheckpointParams, { id: string; label: string }> = {
  id: 'project.checkpoint.create',
  title: '创建工程快照',
  mutatesDocument: false,
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      label: { type: 'string', default: '手动快照', label: '快照说明' },
      starred: { type: 'boolean', default: false, optional: true, label: '是否加星标' },
    },
  },
  async run(_ctx, p) {
    const summary = await createCheckpoint(p.label, Boolean(p.starred))
    return { ok: true, value: { id: summary.id, label: summary.label }, changed: {} }
  },
}

interface RestoreCheckpointParams {
  checkpointId: string
}

const restoreCheckpointCmd: CommandDef<RestoreCheckpointParams, { id: string; label: string }> = {
  id: 'project.checkpoint.restore',
  title: '恢复到指定工程快照',
  risk: 'confirm',
  params: {
    type: 'object',
    fields: {
      checkpointId: { type: 'string', minLength: 1, default: '', label: '快照 ID' },
    },
  },
  run(_ctx, p) {
    const res = restoreCheckpoint(p.checkpointId)
    if (!res.ok || !res.summary) {
      return {
        ok: false,
        code: 'checkpoint.restoreFailed',
        message: res.error ?? '恢复快照失败',
      }
    }
    return {
      ok: true,
      value: { id: res.summary.id, label: res.summary.label },
      changed: { projectChanged: true, summary: `恢复到快照「${res.summary.label}」` },
    }
  },
}

export function registerPictureAndProjectCommands(): () => void {
  const unsubs = [
    commandBus.register(updatePictureCmd),
    commandBus.register(createSceneCmd),
    commandBus.register(openSceneCmd),
    commandBus.register(getDesignCmd),
    commandBus.register(updateDesignCmd),
    commandBus.register(createCheckpointCmd),
    commandBus.register(restoreCheckpointCmd),
  ]
  return () => unsubs.forEach((fn) => fn())
}
