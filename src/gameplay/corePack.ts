import { registerGameplayPack } from './registry'
import { CORE_GAMEPLAY_PACK_ID, type GameDatabaseRow } from './types'

const tags: GameDatabaseRow[] = [
  { id: 'Team.Player', name: '玩家阵营', category: 'Team', description: '主角与友军', fields: { color: '#3b82f6', defaultDurationSec: 0, blockPrefix: '' } },
  { id: 'Team.Enemy', name: '敌人阵营', category: 'Team', description: '敌方单位', fields: { color: '#ef4444', defaultDurationSec: 0, blockPrefix: '' } },
  { id: 'State.Dead', name: '死亡', category: 'State', description: '生命归零后的终态', fields: { color: '#6b7280', defaultDurationSec: 0, blockPrefix: 'Action' } },
  { id: 'State.CrowdControl.Stunned', name: '眩晕硬直', category: 'State/Control', description: '清掉并禁止 Action 下的动作', fields: { color: '#f59e0b', defaultDurationSec: 1.5, blockPrefix: 'Action' } },
  { id: 'State.Invincible', name: '无敌', category: 'State', description: '闪避或受击后的免疫', fields: { color: '#fbbf24', defaultDurationSec: 0.4, blockPrefix: '' } },
  { id: 'Action.Attacking', name: '攻击中', category: 'Action', description: '正在挥砍或出手', fields: { color: '#ec4899', defaultDurationSec: 0.8, blockPrefix: '' } },
  { id: 'Interactive.Chest', name: '可开启', category: 'Interactive', description: '箱子或机关', fields: { color: '#10b981', defaultDurationSec: 0, blockPrefix: '' } },
]

const juice: GameDatabaseRow[] = [
  { id: 'juice_light_hit', name: '轻击', category: 'Combat', description: '短顿帧、轻震和短击退', fields: { hitStopSec: 0.04, cameraShake: 0.2, rimFlashColor: '#ffffff', knockbackMeters: 0.45 } },
  { id: 'juice_heavy_hit', name: '重击', category: 'Combat', description: '更长的顿帧、震屏和击退', fields: { hitStopSec: 0.09, cameraShake: 0.65, rimFlashColor: '#fde047', knockbackMeters: 0.9 } },
  { id: 'juice_pickup', name: '拾取', category: 'Interact', description: '打开或拾取时的轻反馈', fields: { hitStopSec: 0.02, cameraShake: 0.1, rimFlashColor: '#34d399', knockbackMeters: 0 } },
]

registerGameplayPack({
  id: CORE_GAMEPLAY_PACK_ID,
  name: '核心包',
  description: '角色、律令、玩法标签和打击感。始终开启。领域包以后只往这里追加表和动作。',
  builtIn: true,
  core: true,
  tables: [
    {
      tableId: 'tags',
      title: '玩法标签',
      packId: CORE_GAMEPLAY_PACK_ID,
      description: '点分名字，如 State.CrowdControl.Stunned。查询前缀会命中它下面的标签。阻断前缀会清掉并禁止这一支。',
      columns: [
        { key: 'color', label: '颜色', type: 'color', defaultValue: '#3b82f6' },
        { key: 'defaultDurationSec', label: '默认持续秒数，0 为常驻', type: 'number', defaultValue: 0 },
        { key: 'blockPrefix', label: '阻断前缀', type: 'string', defaultValue: '' },
      ],
      defaultRows: tags,
    },
    {
      tableId: 'juice',
      title: '打击感',
      packId: CORE_GAMEPLAY_PACK_ID,
      description: '律令只引用预设名。顿帧、镜头震动、受击闪光和击退写在这一行。',
      columns: [
        { key: 'hitStopSec', label: '顿帧秒数', type: 'number', defaultValue: 0.05 },
        { key: 'cameraShake', label: '镜头震动', type: 'number', defaultValue: 0.3 },
        { key: 'rimFlashColor', label: '受击闪光', type: 'color', defaultValue: '#ffffff' },
        { key: 'knockbackMeters', label: '击退米数', type: 'number', defaultValue: 0.45 },
        { key: 'sound', label: '音效', type: 'string', defaultValue: '' },
        { key: 'soundVolume', label: '音量', type: 'number', defaultValue: 1 },
      ],
      defaultRows: juice,
    },
  ],
})
