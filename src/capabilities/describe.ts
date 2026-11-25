import { defaultBuoyancy } from './buoyancy/defaults'
import { defaultNodeNavigation, navSettingsOf } from './navigation/defaults'
import { defaultNodeEffect } from './particles/defaults'
import { defaultNodePhysics } from './physics/defaults'
import { CAPABILITIES, type CapabilityId, type CapabilityManifest } from './registry'
import { defaultSkySettings } from './sky/defaults'
import { defaultHeightFogSettings } from './fog/defaults'
import { defaultWater } from './water/defaults'

export interface CapabilityDescription {
  id: string
  label: string
  description: string
  defaultEnabled: boolean
  category: string
  dependencies: readonly string[]
  scope: 'node' | 'picture' | 'mixed' | 'runtime'
  dataPath: string | null
  writeWith: string | null
  defaults?: Record<string, unknown>
  fields?: Record<string, string>
  notes?: readonly string[]
}

interface CapabilityMetaEntry extends Omit<CapabilityDescription, 'id' | 'defaultEnabled' | 'category' | 'dependencies' | 'defaults'> {
  defaults?: () => Record<string, unknown>
}

const CAPABILITY_META: Record<CapabilityId | 'postEffects', CapabilityMetaEntry> = {
  physics: {
    label: '物理碰撞与刚体',
    description: '基于 Rapier 的刚体动力学、碰撞体、触发器与射线检测',
    scope: 'node',
    dataPath: 'node.physics',
    writeWith: 'capability__setNodeData (capabilityId="physics")',
    defaults: () => ({ ...defaultNodePhysics('box') }),
    fields: {
      body: 'static | dynamic | kinematic',
      shape: 'box | sphere | capsule | cylinder | cone | convex | trimesh',
      size: '[x, y, z] 碰撞体尺寸',
      trigger: 'boolean，是否为仅触发器（不产生物理阻挡）',
      mass: 'number，质量',
      friction: 'number，摩擦系数',
      restitution: 'number，弹性系数',
      gravityScale: 'number，重力倍率',
    },
  },
  buoyancy: {
    label: '水体浮力',
    description: '让带有物理刚体的节点在水面上产生浮力与阻尼',
    scope: 'node',
    dataPath: 'node.capabilities.buoyancy',
    writeWith: 'capability__setNodeData (capabilityId="buoyancy")',
    defaults: () => ({ ...defaultBuoyancy() }),
    fields: {
      enabled: 'boolean，是否启用浮力',
      buoyancyForce: 'number (0~10)，浮力倍率，>1 浮出水面',
      waterDrag: 'number (0~20)，水中线性阻力',
      angularDrag: 'number (0~20)，水中角阻力',
      sampleMode: 'box4 | box8 | center，浮力采样点模式',
      draftDepth: 'number (0~20)，有效吃水深度，0 为自动估算',
    },
  },
  navigation: {
    label: '导航网格与寻路',
    description: 'Recast 导航网格烘焙与路径查找（供 nav/locomotion 使用）',
    scope: 'mixed',
    dataPath: 'node.navigation / picture.navigation',
    writeWith: 'capability__setNodeData (capabilityId="navigation")',
    defaults: () => ({
      node: defaultNodeNavigation('box'),
      picture: navSettingsOf(undefined),
    }),
    fields: {
      'node.role': 'surface（可行走表面）| obstacle（动态障碍物）',
      'node.radius': 'number，障碍物半径',
      'node.height': 'number，障碍物高度',
      'picture.agentRadius': 'number，烘焙代理半径',
      'picture.agentHeight': 'number，烘焙代理高度',
      'picture.walkableSlopeAngle': 'number，最大可行走坡度（度）',
    },
    notes: ['导航寻路前需在编辑器内完成当前场景的导航网格烘焙。'],
  },
  spline: {
    label: 'Spline 样条路径',
    description: '支持路径节点与脚本 self.spline 沿曲线运动/采样',
    scope: 'node',
    dataPath: 'node.spline (kind="spline") 或脚本 self.spline',
    writeWith: 'scene__createNode(kind="spline") / 脚本 API self.spline',
    notes: ['主要通过 kind="spline" 节点或脚本 self.spline.create / follow 驱动。'],
  },
  tween: {
    label: 'Tween 补间动画',
    description: '脚本运行时补间动画能力（self.tween）',
    scope: 'runtime',
    dataPath: null,
    writeWith: '脚本 API self.tween.to / value / punchScale / shakePosition',
    notes: ['无需节点数据槽，启用后可在行为脚本中直接使用 self.tween。'],
  },
  crowd: {
    label: '群体避障（Crowd）',
    description: '多代理局部避障与群体移动（self.crowd）',
    scope: 'runtime',
    dataPath: null,
    writeWith: '脚本 API self.crowd.moveTo / stop',
    notes: ['需配合 navigation 能力使用。'],
  },
  projectile: {
    label: '投射物（Projectile）',
    description: '轻量弹道发射、命中检测与自动回收（self.projectile）',
    scope: 'runtime',
    dataPath: null,
    writeWith: '脚本 API self.projectile.launch',
    notes: ['命中时向目标与投射物节点派发 onProjectileHit 消息。'],
  },
  particles: {
    label: '粒子特效',
    description: '基于 three.quarks 的粒子系统节点（kind="effect"）',
    scope: 'node',
    dataPath: 'node.effect',
    writeWith: 'capability__setNodeData (capabilityId="particles")',
    defaults: () => ({ ...defaultNodeEffect() }),
    fields: {
      assetId: 'string | null，引用的特效资产 ID',
      materialAssetId: 'string | null，自定义粒子材质资产 ID',
      playing: 'boolean，是否自动播放',
    },
  },
  sky: {
    label: '物理天空与大气雾',
    description: '画面级太阳/月亮位置、大气散射、高度雾、星空与空气透视',
    scope: 'picture',
    dataPath: 'picture.capabilities.sky',
    writeWith: 'capability__setPictureData (capabilityId="sky")',
    defaults: () => ({ ...defaultSkySettings() }),
    fields: {
      timeOfDay: 'number (0~24)，一天中的时间（小时）',
      sunIntensity: 'number，太阳照度倍率',
      fog: 'boolean，是否开启高度雾',
      fogDensity: 'number，雾浓度',
      fogColor: 'string，雾颜色（关闭 fogSkyColor 时生效）',
      haze: 'boolean，是否开启空气透视',
      stars: 'boolean，是否显示星空',
      moon: 'boolean，是否显示月亮',
    },
  },
  fog: {
    label: '高度雾与远近雾',
    description: '独立双套参数控制高度雾与远近雾，支持高度标准线/过渡范围、远近起点/终点/过渡范围、双色融合与 3D 随机噪点',
    scope: 'picture',
    dataPath: 'picture.capabilities.fog',
    writeWith: 'capability__setPictureData (capabilityId="fog")',
    defaults: () => ({ ...defaultHeightFogSettings() }),
    fields: {
      enabled: 'boolean，总开关',
      opacity: 'number (0~1)，整体最大不透明度',
      affectSky: 'boolean，是否作用于天空/背景',
      heightEnabled: 'boolean，是否开启高度雾',
      heightGradient: 'boolean，是否开启高度雾三色垂直渐变',
      heightColor: 'string，高度雾底层颜色（关闭渐变时为单色）',
      heightMidColor: 'string，高度雾中层颜色',
      heightTopColor: 'string，高度雾顶层颜色',
      heightBase: 'number，高度标准线（米）',
      heightRange: 'number，高度过渡范围（米）',
      heightDensity: 'number (0~1)，高度雾浓度',
      heightFalloff: 'number (0.2~4)，高度衰减曲线',
      heightNoiseEnabled: 'boolean，高度雾随机噪点开关',
      heightNoiseScale: 'number，高度雾噪点空间尺度',
      heightNoiseIntensity: 'number (0~1)，高度雾噪点扰动强度',
      heightNoiseSpeed: 'number，高度雾噪点飘动速度',
      distanceEnabled: 'boolean，是否开启远近雾',
      distanceNearColor: 'string，远近雾近端颜色',
      distanceFarColor: 'string，远近雾远端颜色',
      distanceStart: 'number，远近雾起点（米）',
      distanceEnd: 'number，远近雾终点（米）',
      distanceTransition: 'number，远近雾过渡范围（米）',
      distanceDensity: 'number (0~1)，远近雾浓度',
      distanceNoiseEnabled: 'boolean，远近雾随机噪点开关',
      distanceNoiseScale: 'number，远近雾噪点空间尺度',
      distanceNoiseIntensity: 'number (0~1)，远近雾噪点扰动强度',
      distanceNoiseSpeed: 'number，远近雾噪点飘动速度',
    },
  },
  postEffects: {
    label: '自定义后期特效链',
    description: '挂载由 definePostEffect 编写的全屏后期着色器，按顺序叠加在色调映射之前',
    scope: 'picture',
    dataPath: 'picture.capabilities.postEffects',
    writeWith: 'capability__setPictureData (capabilityId="postEffects")',
    defaults: () => ({ items: [] }),
    fields: {
      items: 'Array<{ id: string, enabled?: boolean, params?: Record<string, unknown> }>，启用的自定义后期着色器列表',
    },
  },
  water: {
    label: '海洋与水体表面',
    description: 'Gerstner 波浪、反射折射、焦散与水下后处理效果（挂载在平面或网格节点上）',
    scope: 'node',
    dataPath: 'node.capabilities.water',
    writeWith: 'capability__setNodeData (capabilityId="water")',
    defaults: () => ({ ...defaultWater() }),
    fields: {
      enabled: 'boolean，是否开启水体',
      preset: 'tropical | ocean | lake | pool | stylized，风格预设',
      quality: 'fast | balanced | ultra，渲染质量档位',
      shallowColor: 'string，浅水颜色',
      deepColor: 'string，深水颜色',
      waveHeight: 'number，浪高',
      waveSpeed: 'number，浪速',
      planarReflection: 'boolean，是否开启平面反射',
      underwaterEffect: 'boolean，是否开启水下镜头后处理',
      underwaterColor: 'string，水下雾颜色',
      underwaterFogDensity: 'number，水下雾浓度',
    },
  },
}

export function describeCapabilities(id?: string): CapabilityDescription[] {
  const entries: CapabilityDescription[] = (CAPABILITIES as readonly CapabilityManifest[])
    .filter((item) => !id || item.id === id)
    .map((item) => {
      const capId = item.id as CapabilityId
      const meta = CAPABILITY_META[capId]
      return {
        id: capId,
        label: meta.label,
        description: meta.description,
        defaultEnabled: item.defaultEnabled,
        category: item.category ?? 'general',
        dependencies: item.dependencies ?? [],
        scope: meta.scope,
        dataPath: meta.dataPath,
        writeWith: meta.writeWith,
        ...(meta.defaults ? { defaults: meta.defaults() } : {}),
        ...(meta.fields ? { fields: meta.fields } : {}),
        ...(meta.notes ? { notes: meta.notes } : {}),
      }
    })
  if (!id || id === 'postEffects') {
    const meta = CAPABILITY_META.postEffects
    entries.push({
      id: 'postEffects',
      label: meta.label,
      description: meta.description,
      defaultEnabled: true,
      category: 'visual',
      dependencies: [],
      scope: meta.scope,
      dataPath: meta.dataPath,
      writeWith: meta.writeWith,
      ...(meta.defaults ? { defaults: meta.defaults() } : {}),
      ...(meta.fields ? { fields: meta.fields } : {}),
    })
  }
  return entries
}
