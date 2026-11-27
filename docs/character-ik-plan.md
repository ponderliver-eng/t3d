# 角色 IK 能力包设计方案 (`ik`)

本文档定义 T3D 引擎中面向射击类、动作类及通用 3D 游戏的**角色反向动力学（Inverse Kinematics, IK）**能力包设计方案。

---

## 1. 架构定位与红线约束

1. **标准能力包形态**
   - 在 `src/capabilities/registry.ts` 注册节点级能力包 `ik`（`category: 'animation'`，`defaultEnabled: true`），按需懒加载 `src/capabilities/ik/session.ts`。
   - 节点数据统一存放在 `node.capabilities.ik`，**禁止**向 `SceneNode` 顶层平铺新字段。
2. **无连线图与无重型工作台**
   - 不做独立 IK 状态机或连线图编辑器。
   - 在 `src/capabilities/ik/schema.ts` 定义 `FieldSchema`，通过轻量卡片 `src/capabilities/ik/IkCard.tsx`（内部直接渲染 `<SchemaForm>`）接入 `InspectorPanel.tsx` 与 `AddComponentPicker`；同时在 `src/capabilities/describe.ts` 登记 AI 工具元数据说明，并对过场时间轴（Cutscene）开放权重动画。
3. **统一运行时管线与蒙皮脏标记**
   - 求解器核心逻辑放在 `src/runtime/engine/ik.ts`，能力包会话 `src/capabilities/ik/session.ts` 仅做场景状态协调、覆写合并与系统注册，确保编辑器试玩与发布版 `Player` 共用同一套 IK 实现，且不引用 `src/editor/`。
   - **严禁 60Hz 刷 Store**：运行时覆写与临时目标写入内存覆写表，试玩结束自动清理，不修改 `useEditorStore.nodes`。
   - **WebGPU 蒙皮缓存同步**：凡本帧有任意 IK 通道实际生效（`effectiveWeight > 1e-4`）的角色，求解结束后必须调用 `root.updateMatrixWorld(true)` 与 `markSkeletonsDirty(root)`（`src/runtime/engine/materials.ts`），确保静止无动画播放的 NPC 开启 `LookAt` 时也能实时刷新 GPU 蒙皮矩阵。
4. **帧流水线执行阶段（消除 1 帧滞后）**
   - **动画前还原阶段（`RUNTIME_STAGE.POST_PHYSICS + 4`，`order = 59`）**：还原上一帧由 `footIk` 写入 `Hips.position` 的临时骨盆下沉偏移，防止当前播放无位移轨道动画时骨盆下沉逐帧无限累加。
   - **主求解阶段（`RUNTIME_STAGE.POST_ANIMATION + 8`，`order = 78`）**：严格排在 `AnimationMixer`（`60`）、`core.camera` 跟随镜头（`75`）与 `capability.cutscene.render`（`77`）**之后**执行，确保 `cameraAim` 读取到的是**本帧最新**的相机世界射线，消除甩鼠标瞄准时的 1 帧准星滞后。
   - **单角色内部拓扑与 `socketBone` 协同顺序**：
     1. `footIk`（骨盆下沉 + 双腿贴地）
     2. `lookAt`（脊椎 / 胸腔 / 颈 / 头瞄准旋转）
     3. 主手 `Two-Bone IK`（默认 `rightArm`）
     4. **即时重算挂在该角色骨骼上的 `socketBone` 子树世界位姿**（抽入 `src/runtime/engine/sceneNodes.ts` 供编辑器与 `Player` 共用）
     5. 副手 `Two-Bone IK`（默认 `leftArm`，此时读取武器前握把挂点拿到的是本帧精确位姿，彻底消除双手持枪转身/压枪时的左手脱手漂移）
5. **人形骨骼自动识别与 `WeakMap` 绑定缓存**
   - 复用 `src/runtime/animation/humanoidSlots.ts` 与 `humanoidAvatar.ts` 的标准 **PascalCase** 人形槽位（`Hips` / `Spine` / `Chest` / `UpperChest` / `Neck` / `Head` / `LeftUpperArm` / `LeftLowerArm` / `LeftHand` / `RightUpperArm` / `RightLowerArm` / `RightHand` / `LeftUpperLeg` / `LeftLowerLeg` / `LeftFoot` / `RightUpperLeg` / `RightLowerLeg` / `RightFoot`）。
   - 在 `RuntimeAssetSummary`（`src/runtime/world.ts`）中透传 `humanoidAvatar`，保留用户在 `HumanoidCard` 中手改的 `avatar.overrides`。
   - 运行时以 `WeakMap<Object3D, CachedCharacterIkRig>` 缓存骨骼 `Bone` 引用、绑定态（Bind Pose）世界旋转与标准骨长，严禁每帧遍历 `Object3D` 查找骨骼；同时支持 `boneNames` 手动覆盖非人形骨骼。

---

## 2. 核心功能模块与算法细节

### 2.1 头部 / 脊椎瞄准注视（LookAt / Aim IK）
适用场景：TPS/FPS 持枪瞄准、角色视角跟随、NPC 注视玩家或兴趣点。
- **绑定态世界前向自动校准（替代易拧麻花的手填 `aimAxis`）**：
  - T3D 角色根节点标准前向为 `+Z`、上向为 `+Y`（见 `src/runtime/character.ts`）。初始化缓存时直接记录绑定姿势下各躯干/头颈骨骼与角色根空间的旋转关系。
  - 运行时在角色根/世界空间求取当前朝向到目标方向的有限旋转增量 $\Delta Q_{\text{world}}$，再按权重折算回各节骨骼父空间，**零配置兼容 Mixamo、UE Mannequin（`+X` 主轴）、VRM、3dsMax Biped 等任意骨骼局部轴向**。
- **自适应多节权重归一化**：自动收集角色实际存在的躯干链 `[Spine, Chest, UpperChest, Neck, Head]`，将 `bodyWeight`、`neckWeight`、`headWeight` 按实际存在槽位自动归一化分摊，缺失中间槽位时不损失总旋转角。
- **瞄准偏置角（`aimOffset: [yawDeg, pitchDeg]`）**：适配双手持步枪侧身站姿时胸口相对正前方的固有夹角微调。
- **椭圆锥角度限位（Clamp）与平滑阻尼**：支持 `maxYaw` 与 `maxPitch` 平滑钳制防止颈椎/腰部反转；通过 `smoothSpeed` 对目标方向做球面插值（Slerp）。
- **目标模式（`targetMode`）**：
  - `node`：注视指定场景节点 `targetNodeId`（加可选 `targetOffset`）；
  - `point`：注视固定或脚本更新的世界坐标 `targetPoint`；
  - `cameraAim`：通过 `SceneRuntimeHost.cameraRay()` 获取当前激活相机屏幕中心射线，求取场景/物理交点（过滤角色自身碰撞体，未命中时取默认远点如 `50m`）。

### 2.2 双骨解析解（Two-Bone IK）
适用场景：双手持枪（左手托护木/前握把）、攀爬抓握、拉门/拾取交互。
- **两步增量解析求解（防跳变、保固有 Twist）**：
  1. 在当前帧关键帧动画采样后的 FK 骨骼姿态基础上，绕当前弯曲平面法线（共线退化时回退极平面法线）用余弦定理调整中段关节屈伸角，使首末关节距离匹配目标距离；
  2. 用最短弧 Swing 将当前 `首->末` 向量对齐到 `首->目标` 向量，再绕 `首->目标` 轴旋转对齐极向量平面。当目标等于当前动画手腕位置时旋转增量严格恒等为 `0`，且完整保留前臂固有扭转。
- **Soft-IK 软拉伸阻尼**：当目标距离接近或超过总骨长 $L_1 + L_2$ 时，在 $[0.96(L_1+L_2),\, L_1+L_2]$ 区间做指数软极限过渡，消除手臂/腿伸直边缘的关节高频弹跳（Elbow/Knee Pop）。
- **明确角色根空间极向量（Pole Vector）**：`poleOffset` 明确定义为**角色根局部空间（Character Root Space）**偏移（例如左肘默认 `[-0.3, -0.1, -0.35]`，右肘 `[0.3, -0.1, -0.35]`，膝盖 `[0, 0, 0.5]`），角色任意转身时肘/膝朝向始终稳定；同时支持可选 `poleTargetNodeId`。
- **目标局部偏移与末端旋转对齐**：支持 `targetOffset` / `targetRotationOffset`（无需专门为枪械新建空子节点即可微调握持位姿）以及 `matchRotation` 贴合握把旋转。

### 2.3 脚步贴地 IK（Foot Grounding / Pelvis Offset）
适用场景：角色站在斜坡、楼梯、崎岖地形上防止悬空或穿地。
- **与角色运动态及迈步高度自动联动（防“磁铁粘脚”）**：
  - 当角色处于跳跃、腾空下落、游泳状态时，自动将 `footIk` 有效权重平滑衰减至 `0`；
  - 对比当前动画帧脚踝在角色局部空间的 `Y` 高度与静止站立高度，动画抬腿迈步时自动降低贴地锁定权重，仅在支撑相（Stance Phase）锁紧地面。
- **安全地形射线检测**：优先走物理射线查询并**显式排除角色自身胶囊体/刚体与 `trigger` 触发器**（无物理时回退场景探测），同时受 `maxStepHeight`（默认 `0.45m`）约束防止跨悬崖劈叉。
- **骨盆自动下沉与还原**：取双脚所需下沉量下压 `Hips`（经 `pelvisSmooth` 平滑），记录本帧写入量并在下一帧动画采样前还原，再用双腿 Two-Bone IK 踩实接触点。
- **脚掌法线贴合与倾角限位**：开启 `alignFootNormal` 时依据地面法线调整脚踝俯仰与翻滚角，并通过 `maxFootAngle`（默认 `35°`）限制陡坡折脚。

### 2.4 多骨链迭代求解（FABRIK，可选扩展）
适用场景：长尾、机械臂、触手、多节软体结构等超过 2 节的骨骼链。
- 采用轻量前向-后向迭代（FABRIK，4~6 次迭代 + 每节锥角约束），仅在显式配置多骨链时按需运行。

---

## 3. 数据结构定义 (`src/capabilities/ik/schema.ts`)

存储在 `node.capabilities.ik`：

```ts
export const IK_CAPABILITY_ID = 'ik'

export interface TwoBoneIkConfig {
  enabled: boolean
  weight: number
  targetMode: 'node' | 'point'
  targetNodeId?: string
  targetPoint?: [number, number, number]
  /** 目标局部位置偏移（米） */
  targetOffset?: [number, number, number]
  /** 目标局部欧拉角偏移（度） */
  targetRotationOffset?: [number, number, number]
  /** 角色根局部空间下的极向量偏移（控制肘部/膝盖朝向） */
  poleOffset?: [number, number, number]
  /** 可选极向量目标节点 ID */
  poleTargetNodeId?: string
  /** 是否让末端骨骼匹配目标旋转 */
  matchRotation?: boolean
  /** 权重动态过渡速度（1/秒） */
  blendSpeed?: number
  /** 可选自定义三节骨骼名覆盖 [upper, lower, effector] */
  boneNames?: [string, string, string]
}

export interface LookAtIkConfig {
  enabled: boolean
  weight: number
  targetMode: 'node' | 'point' | 'cameraAim'
  targetNodeId?: string
  targetPoint?: [number, number, number]
  targetOffset?: [number, number, number]
  /** 脊椎与胸腔总权重（自动分摊到实际存在的 Spine / Chest / UpperChest） */
  bodyWeight?: number
  neckWeight?: number
  headWeight?: number
  /** 瞄准偏置角 [yawDeg, pitchDeg]（适配侧身持枪站姿） */
  aimOffset?: [number, number]
  maxYaw?: number
  maxPitch?: number
  smoothSpeed?: number
}

export interface FootIkConfig {
  enabled: boolean
  weight: number
  rayUp?: number
  rayDown?: number
  footOffset?: number
  /** 允许适应的最大台阶高度差（米），超出时不强拉骨盆 */
  maxStepHeight?: number
  /** 脚踝贴合斜坡的最大倾角（度） */
  maxFootAngle?: number
  pelvisSmooth?: number
  alignFootNormal?: boolean
}

export interface IkCapabilityData {
  enabled: boolean
  /** 全局总权重 0~1 */
  weight?: number
  /** 播放上半身动作（playUpper，如换弹/挥砍）时是否自动平滑淡出双手 IK */
  muteArmsOnUpperClip?: boolean
  /** 双手求解先后顺序：右手持枪左手扶护木选 'rightFirst'，反之选 'leftFirst' */
  handOrder?: 'rightFirst' | 'leftFirst'
  lookAt?: LookAtIkConfig
  leftArm?: TwoBoneIkConfig
  rightArm?: TwoBoneIkConfig
  footIk?: FootIkConfig
}
```

---

## 4. 运行时接口与系统联动

### 4.1 `t3d/runtime` 脚本 API (`self.ik`)
在 `src/core/codeAssets/scriptRuntime.ts`、`src/core/codeAssets/typeDefs.ts`（`RUNTIME_DTS_SUMMARY`）以及 `contracts/t3d/runtime.d.ts` 中同步提供运行期覆写接口（写入内存覆写表，不刷 Store）：

```ts
export interface ScriptIkApi {
  setWeight(weight: number, fadeSeconds?: number): void
  setLookTarget(target: string | [number, number, number] | null): void
  setLookWeight(weight: number, fadeSeconds?: number): void
  setHandTarget(
    side: 'left' | 'right',
    target: string | [number, number, number] | null,
    weight?: number,
    fadeSeconds?: number,
  ): void
  setFootIkEnabled(enabled: boolean, fadeSeconds?: number): void
  clearOverrides(): void
}
```

- **平滑松手保护**：调用 `self.ik.setHandTarget('left', null, 0, 0.15)` 时，在权重向 `0` 衰减的 `0.15s` 内自动保留上一个有效目标位姿继续插值，归零后再释放目标，避免换弹瞬间手臂 1 帧弹回的生硬跳变。
- **上半身动作自动避让**：当 `muteArmsOnUpperClip !== false` 且角色正在执行 `playUpper` 一次性动作（且脚本未强制接管）时，自动平滑淡出双手 IK，动作结束自动恢复持枪护木抓握。

### 4.2 与过场时间轴（Cutscene）联动
- 在过场属性列表中识别 `capabilities.ik.*` 数值字段（如 `capabilities.ik.weight`、`capabilities.ik.lookAt.weight`、`capabilities.ik.leftArm.weight`、`capabilities.ik.rightArm.weight`、`capabilities.ik.footIk.weight`）。
- 在 `ik/session.ts` 合并节点配置时，读取 `getCutsceneNodeCapOverride(nodeId, 'ik')` 中的点号路径覆写键值（如 `'lookAt.weight'`），实现剧情演出与实时 IK 之间的无缝权重过渡。

### 4.3 统一 `socketBone` 同步下沉到 `src/runtime/engine/sceneNodes.ts`
- 将 `EditorViewport.poseSockets` 与 `player/main.ts` 的 `posePlayerSockets` 收敛至 `src/runtime/engine/sceneNodes.ts`，并提供按单个宿主角色即时刷新挂点子树的函数，供 `ik` 在主手与副手求解之间调用。

---

## 5. 分期实施计划

### 第一期：射击与交互核心闭环（Aim LookAt + 双手 Two-Bone IK）
1. **`src/runtime/engine/sceneNodes.ts` & `world.ts` & `sceneRuntime.ts`**：统一 `socketBone` 更新函数，补充 `SceneRuntimeHost.cameraRay()` 与 `RuntimeAssetSummary.humanoidAvatar` 透传。
2. **`src/runtime/engine/ik.ts`**：实现 `WeakMap` 人形骨骼缓存、绑定态自动轴校准 `solveLookAtChain`、两步增量 + Soft-IK `solveTwoBoneIk`，并在有效求解后触发 `markSkeletonsDirty`。
3. **`src/capabilities/ik/schema.ts`、`session.ts`、`IkCard.tsx`**：定义配置 Schema、平滑内存覆写表与属性面板卡片，注册到 `POST_ANIMATION + 8`（`order = 78`）。
4. **`registry.ts`、`describe.ts`、`InspectorPanel.tsx`**：注册 `ik` 能力包、AI 描述元数据与组件添加入口。
5. **脚本与过场联动**：同步更新 `scriptRuntime.ts`、`typeDefs.ts`、`contracts/t3d/runtime.d.ts` 与 `cutscene`，执行 `npx tsc --noEmit -p .`、`npm run check:player-deps` 与 `npm run build:player`。

### 第二期：地形贴地适配与编辑器可视化辅助
1. **脚步贴地 IK（`footIk`）**：实现 `POST_PHYSICS + 4` 骨盆还原、排除自身碰撞体的双脚射线检测、迈步高度自适应锁脚权重、骨盆平滑下沉与脚掌法线贴合。
2. **视口辅助线（`EDITOR_HELPER_LAYER = 31`）**：在编辑器选中开启 IK 的角色时，绘制手/脚目标点、视线锥与极向量朝向辅助标记。
3. **可选 FABRIK**：按需扩展多节长骨链求解器。
