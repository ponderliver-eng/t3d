import {
  cameraPresetForMode,
  defaultCameraFollow,
  defaultCharacter,
  defaultCheckpoint,
  defaultInteract,
  defaultLocomotion,
  defaultMover,
  defaultScore,
  defaultSoundSource,
  defaultTrigger,
  resolveCharacterCamera,
  type CameraFollowSpec,
  type CharacterSpec,
  type NodeGameplay,
} from '../runtime/sceneRuntime'

/**
 * 内置核心组件登记表：这些组件直接挂在 node.gameplay[componentId]，由引擎运行时驱动，无需脚本。
 * 供指令层（gameplay.setCoreComponent）与查询层（registry.describe / node.inspect）共用一份说明与默认值。
 */
export type CoreComponentId =
  | 'character'
  | 'cameraFollow'
  | 'interact'
  | 'trigger'
  | 'mover'
  | 'checkpoint'
  | 'score'
  | 'soundSource'
  | 'locomotion'

export interface CoreComponentManifest {
  id: CoreComponentId
  label: string
  description: string
  defaults: () => Record<string, unknown>
  /** 默认值里没有、但运行时同样识别的可选字段 */
  extraFields?: Record<string, string>
  /** 取值有限的字段（供 AI 填参时参考） */
  enums?: Record<string, string[]>
  notes?: string[]
}

const asRecord = (value: object): Record<string, unknown> => value as Record<string, unknown>

export const CORE_COMPONENTS: readonly CoreComponentManifest[] = [
  {
    id: 'character',
    label: '角色控制器',
    description:
      '引擎内置的角色移动：读取 Move/Jump/Sprint/Dash 输入动作，处理行走、冲刺、多段跳、闪避、游泳与贴地，并按运动状态自动切换 idle/walk/run/jump/air/land/dodge/swim 动画。挂上即可操控，无需自己写移动脚本。',
    defaults: () => asRecord(defaultCharacter()),
    enums: {
      driver: ['capsule', 'nav', 'hybrid'],
      mode: ['adventure', 'strafe', 'lockOn', 'pointAndClick', 'topDown', 'side25d', 'firstPerson'],
      clickButton: ['left', 'right'],
    },
    notes: [
      'xxxClip 填动画片段名，xxxClipAssetId 填片段所在的模型/动画资产 ID（片段就在节点自身模型里时留空）；片段名可用 query__asset_search 查看模型的 clips。',
      '留空的片段槽位不会播放动画；只填 idleClip/walkClip/runClip 三个就能得到基本的站立/走/跑。',
      '设置 character 时会自动按 mode 配好同节点的 cameraFollow；同一场景只应有一个启用的 character。',
      '角色已由内置控制器驱动时，不要再挂一个自己改 position 的移动脚本，两者会互相覆盖。',
      '挂载后即生效：重力、贴地、相对相机的移动方向、转身朝向、动画切换都由引擎完成。验收用 playtest__run_smoke 注入 Move 轴并断言 nodeMoved。',
    ],
  },
  {
    id: 'cameraFollow',
    label: '跟随相机',
    description: '引擎内置的跟随镜头：按 offset/pivot 跟随目标，支持鼠标环绕、滚轮缩放与防穿墙。挂在角色节点上表示跟随自己。',
    defaults: () => asRecord(defaultCameraFollow()),
    extraFields: {
      preset: '最近套用的机位（同 character.mode 取值）',
      orbitYaw: '开局水平环绕角（度）',
      orbitPitch: '开局俯仰角（度）',
    },
    enums: { orbit: ['none', 'rightDrag', 'mouse'] },
    notes: ['节点上已有 character 时，机位会被 character.mode 约束（如俯视角强制 orbit=none）。'],
  },
  {
    id: 'interact',
    label: '可交互物',
    description: '玩家进入 radius 范围并按下 key 时，向本节点发送 message 消息（脚本在 onMessage 里接收）。',
    defaults: () => asRecord(defaultInteract()),
  },
  {
    id: 'trigger',
    label: '触发区域',
    description: '玩家进入/离开 radius 范围时分别发送 enterMessage / exitMessage 消息。',
    defaults: () => asRecord(defaultTrigger()),
  },
  {
    id: 'mover',
    label: '移动平台',
    description: '让节点沿 offset 往返移动（duration 单程秒数，pause 端点停留），可搭载站在上面的角色。autoPlay=false 时收到 startMessage 才启动。',
    defaults: () => asRecord(defaultMover()),
  },
  {
    id: 'checkpoint',
    label: '存档点 / 出生点',
    description: '角色进入 radius 后记为重生点；角色掉到 abyssY 以下时在最近的存档点重生并发送 message。spawn=true 表示开局出生点。',
    defaults: () => asRecord(defaultCheckpoint()),
  },
  {
    id: 'score',
    label: '关卡计分',
    description: '内置的目标分数/限时关卡规则：达到 target 发送 victoryMessage，超过 timeLimit（秒，0 为不限时）发送 defeatMessage。',
    defaults: () => asRecord(defaultScore()),
  },
  {
    id: 'soundSource',
    label: '空间音源',
    description: '试玩开始后在节点位置播放 assetId 指向的音频，音量随距离衰减。',
    defaults: () => asRecord(defaultSoundSource()),
  },
  {
    id: 'locomotion',
    label: '运动动画',
    description:
      '按节点的实际移动速度自动切换动画：水平速度 ≥ walkSpeed 播 walkClip，≥ runSpeed 播 runClip，否则播 idleClip；离地时保持当前片段。它只看位移结果，不关心谁在移动节点，适合由脚本、导航或弹道驱动的敌人 / NPC / 自写控制器的角色——脚本只管移动，不用写动画切换。',
    defaults: () => asRecord(defaultLocomotion()),
    notes: [
      'xxxClip 填片段名，xxxClipAssetId 填片段所在的模型/动画资产 ID（片段就在节点自身模型里时留空）。',
      '节点上启用了 character 时本组件不生效（character 自带含跳跃、闪避的完整切换）。',
      '脚本里仍可用 self.anim.playUpper 叠加上半身动作（攻击、受击）；不要同时在脚本里对同一节点调 playBody 切走跑，会和本组件互相抢。',
    ],
  },
]

export function findCoreComponent(id: string): CoreComponentManifest | null {
  return CORE_COMPONENTS.find((item) => item.id === id) ?? null
}

export function isCoreComponentId(id: string): id is CoreComponentId {
  return CORE_COMPONENTS.some((item) => item.id === id)
}

export function coreComponentFieldNames(manifest: CoreComponentManifest): string[] {
  return [...Object.keys(manifest.defaults()), ...Object.keys(manifest.extraFields ?? {})]
}

/** 供查询层输出：字段清单即默认值本身，附带枚举与说明 */
export function describeCoreComponents(id?: string) {
  return CORE_COMPONENTS.filter((item) => !id || item.id === id).map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    dataPath: `node.gameplay.${item.id}`,
    writeWith: 'gameplay__setCoreComponent',
    defaults: item.defaults(),
    ...(item.extraFields ? { extraFields: item.extraFields } : {}),
    ...(item.enums ? { enums: item.enums } : {}),
    ...(item.notes ? { notes: item.notes } : {}),
  }))
}

export type ApplyCoreComponentResult =
  | { ok: true; gameplay: NodeGameplay | null; data: Record<string, unknown> | null }
  | { ok: false; message: string; hint: string }

/**
 * 计算写入一个内置核心组件后的 node.gameplay（纯函数，不碰 store）。
 * patch 为 null 表示移除组件；未知字段直接拒绝并列出可用字段，避免写入运行时不认识的数据。
 */
export function applyCoreComponentPatch(
  prev: NodeGameplay | null | undefined,
  componentId: string,
  patch: Record<string, unknown> | null,
): ApplyCoreComponentResult {
  const manifest = findCoreComponent(componentId)
  if (!manifest) {
    return {
      ok: false,
      message: `未知的内置组件 "${componentId}"`,
      hint: `可用的内置组件：${CORE_COMPONENTS.map((item) => item.id).join(', ')}`,
    }
  }
  const gameplay: Record<string, unknown> = { ...(prev ?? {}) }
  if (patch === null) {
    delete gameplay[manifest.id]
    // 角色与其配套镜头成对移除，与属性面板行为一致
    if (manifest.id === 'character') delete gameplay.cameraFollow
    return { ok: true, gameplay: Object.keys(gameplay).length > 0 ? (gameplay as NodeGameplay) : null, data: null }
  }
  const allowed = coreComponentFieldNames(manifest)
  const unknown = Object.keys(patch).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `内置组件 ${manifest.id} 不认识字段：${unknown.join(', ')}`,
      hint: `可用字段：${allowed.join(', ')}`,
    }
  }
  for (const [key, options] of Object.entries(manifest.enums ?? {})) {
    if (key in patch && !options.includes(String(patch[key]))) {
      return {
        ok: false,
        message: `内置组件 ${manifest.id}.${key} 的取值 "${String(patch[key])}" 无效`,
        hint: `可选值：${options.join(', ')}`,
      }
    }
  }
  const current = (gameplay[manifest.id] as Record<string, unknown> | null | undefined) ?? manifest.defaults()
  const next = { ...manifest.defaults(), ...current, ...patch }
  gameplay[manifest.id] = next
  if (manifest.id === 'character') {
    const character = next as unknown as CharacterSpec
    const baseCam = (gameplay.cameraFollow as NodeGameplay['cameraFollow']) ?? defaultCameraFollow()
    // 换了操控模式就套用该模式的机位；否则保留用户已调的镜头参数
    gameplay.cameraFollow = 'mode' in patch
      ? resolveCharacterCamera(character, { ...baseCam, ...cameraPresetForMode(character.mode) })
      : resolveCharacterCamera(character, baseCam)
  } else if (manifest.id === 'cameraFollow' && gameplay.character) {
    const character = { ...defaultCharacter(), ...(gameplay.character as CharacterSpec) }
    if (character.enabled) {
      gameplay.cameraFollow = resolveCharacterCamera(character, next as Partial<CameraFollowSpec>)
    }
  }
  return { ok: true, gameplay: gameplay as NodeGameplay, data: gameplay[manifest.id] as Record<string, unknown> }
}
