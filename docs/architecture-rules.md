# T3D 架构与开发规范（长期准则）

本文档用于约束 T3D 编辑器与游戏运行时的长期架构边界、性能铁律与模块扩展规范。新增功能、重构或接入能力包/领域包时必须遵守。

---

## 1. 渲染与图形管线约束

1. **单一渲染器原则**
   - 主视口唯一渲染器为 `three` 0.187 的 `three/webgpu` `WebGPURenderer`（当开启兼容回退时，使用同一 `WebGPURenderer` 的 `forceWebGL` WebGL2 后端）。
   - **严禁**在视口或运行时引入第二套 `WebGLRenderer`。
2. **后期管线（Post-Processing）**
   - 统一使用 `three/webgpu` 的 `RenderPipeline` + TSL（Three Shading Language）节点图（位于 `src/editor/viewport/picture.ts`），**严禁**使用旧版 `EffectComposer`。
   - 当开启屏幕空间效果（`SSR` / `SSGI` / `AO`）时，场景 Pass 挂有 MRT（`output`、`normal`、`metalrough`）。任何在场景内叠加的自定义半透明/全屏体积材质（如 `VolumeNodeMaterial`），必须对 `normal` 和 `metalrough` 附件配置保留目标缓冲（`CustomBlending: Zero -> One`），防止冲掉 G-Buffer 导致反射/间接光失效。
3. **图层（Layers）分配**
   - 用户渲染层使用 `0 ~ 30` 位（`Default` 固定为第 `0` 位）。
   - 第 `31` 位（`EDITOR_HELPER_LAYER`）专供编辑器辅助线、网格、Gizmo 与相机/灯光图标使用，相机射线拾取与渲染掩码需遵循此约定。
4. **统计与帧率测量**
   - 视口帧率（FPS）与帧耗时（ms）必须基于 `requestAnimationFrame` 未截断的真实帧间隔统计（排除后台挂起 `> 1s` 的异常帧），禁止使用物理/动画的 `0.05s` 截断步长计算 FPS。
   - 手动管理渲染循环时，需将 `renderer.info.autoReset` 设为 `false`，并在每帧主渲染入口前显式调用 `renderer.info.reset()`。

---

## 2. 场景状态、增量同步与试玩（Play）性能铁律

1. **编辑态与运行态（Play Mode）数据隔离**
   - `useEditorStore` 中的 `nodes` 是**编辑态文档数据（Document State）**。
   - 在 `playState === 'playing'` 期间，高频变化的运行时状态（刚体位姿、角色控制器位移、跟随相机、动画时间轴 `clipTime` 等）**必须直接驱动 Three.js 的 `Object3D` 或运行时组件内存**。
   - **严禁**在 Play 模式下以 60Hz 每帧批量改写全体 `useEditorStore.nodes`（如需在属性面板展示当前选中物体的实时数值，仅允许对**当前选中的节点**按 `>= 120ms` 的低频节流回写）。
2. **视口增量同步（Incremental Sync）**
   - `EditorViewport.sync()` 必须保持基于 `node` 引用、`parentId` 链变更与 `assetRevision` 的脏检查短路（$O(1)$ 单节点更新）。
   - 禁止在单节点属性修改时无差别遍历全场景重跑 `applyModelMaterials` 或重建未改动节点的视图对象。
3. **蒙皮网格包围盒（SkinnedMesh Bounds）**
   - 严禁在每帧渲染循环中将 `SkinnedMesh.boundingBox` 置为 `null`（这会触发 Three.js 在 CPU 上逐顶点执行 4 骨骼矩阵蒙皮，导致帧率暴跌）。
   - 蒙皮包围盒应在局部空间首次抽样计算后缓存，每帧跟随世界矩阵（`matrixWorld`）变换即可。

---

## 3. 资源加载、缓存与内存闭环

1. **双后端一致与内容寻址 Artifact**
   - 所有文件型资产以 `SHA-256` 哈希去重。
   - 外部模型与动画（如 `.fbx / .obj / .dae`）导入后统一转换为压缩后的二进制 GLB Artifact（`${hash}__${MODEL_IMPORTER_VERSION}`），存放于 `.cache/t3d/import-artifacts/`（目录工程）或 IndexedDB `artifacts` 表（草稿工程）。
2. **按需懒加载（On-Demand Lazy Load）**
   - 打开工程时，`warmAssets` **仅预热当前场景、预设体、材质、特效、UI 实际引用到的资产**（以及尚未生成 Artifact/缩略图的新资产）。
   - 未被引用的资产在启动时仅注册轻量 `AssetMeta`（名称、哈希、`clipCatalog`、模型/贴图缩略图），不读取源字节、不创建 `Blob URL`、不解压进内存；仅在被拖入场景、赋给节点或打开预览时按需异步加载。
3. **贴图色彩空间隔离**
   - 同一张贴图若同时用于颜色槽（`SRGBColorSpace`）和线性数据槽（法线/粗糙度/金属度/AO，`NoColorSpace`），必须通过共享底层 `source` 的克隆纹理隔离 `colorSpace`，禁止原地直接修改共享 `Texture` 实例的 `colorSpace`。
4. **缩略图与工程 JSON 体积控制**
   - 仅 `model` 与非 KTX2 的 `texture` 允许在元数据中持久化小尺寸缩略图；`animation`、`audio`、`environment` 统一使用前端矢量图标，禁止向 `project.t3d` 写入重复的固定文字 Base64 PNG。
5. **资源释放（Release & GC）**
   - 删除或重新导入资产时，必须同步清理：Three.js 几何/材质/纹理显存、`Blob URL`、人形骨骼登记表（`forgetHumanoidSkeletons`）、人形重定向动画缓存（`releaseHumanoidPlayback`），以及磁盘上的孤儿 Artifact（`pruneArtifacts`）。

---

## 4. 动画系统规范

1. **绑定时重定向（Bind-Time Retargeting）**
   - 跨骨架人形动画重定向（骨骼映射、Rest Pose 补偿、腿长比例缩放、脚步防穿地）统一在绑定动作时由 `clipsForSkeleton` 完成并缓存，运行时 `AnimationMixer` 只播放已转换好的目标骨架 `AnimationClip`。
2. **双通道分层与显式权重过渡**
   - 动画播放分为**身体层（`body`）**与**上半身覆盖层（`overlay`）**。当上半身覆盖激活时，身体层若为 `full` 会自动降级为 `lower`（仅下半身），保证边跑边挥砍不滑步。
   - 全身动画之间的切换（如走 <-> 跑）必须保持步幅相位对齐（Phase Sync），并由显式的权重插值（`ActionBlend`）控制过渡；过渡结束时必须将淡出的旧 `AnimationAction` 彻底 `stop()`，防止多套全身骨骼动作在 Mixer 中残留叠加。
3. **不建重型连线图**
   - 坚持基于纯 API（`director.ts`：`playBody`、`playUpper`、`stopUpper`）驱动动画，不构建类似 Unity Animator 的复杂可视化状态机连线编辑器。
   - **不再新建重型手配工作台或节点连线图编辑器**（包括脚本连线图、动画状态机、着色器节点连线编辑器）。新增能力一律只提供 `FieldSchema`（自动生成参数面板）+ 指令/API + 运行时逻辑。

---

## 5. 能力包、核心包与领域包边界

1. **节点种类互斥与无积木化**
   - `NodeKind` 保持互斥，**不做** GM3D 式的原子“积木（BlockRegistry）”拼装系统，**不做**以逻辑连线图为主界面的脚本系统。
2. **第三方重型库严格隔离**
   - **物理（`physics`）**：仅 `src/capabilities/physics/rapierWorld.ts` 允许 import `@dimforge/rapier3d-compat`。
   - **导航（`navigation`）**：仅 `src/capabilities/navigation/recastNav.ts` 与 `bake.worker.ts` 允许 import `recast-navigation`。
   - **粒子（`particles`）**：默认关闭；仅 `src/capabilities/particles/quarksRuntime.ts` 与 `tslBatch.ts` 允许 import `three.quarks`；保持 CPU 模拟 + TSL 实例化绘制，不安装 `quarks.nodes`。
   - **天空（`sky`）**：仅 `src/capabilities/sky/runtime.ts` 允许 import `@pmndrs/sky`。数据在 `picture.capabilities.sky`。
3. **核心玩法包与领域包（Gameplay Packs）**
   - **统一运行时调度（`src/runtime/sceneRuntime.ts`）**：物理、导航、粒子、骨骼动画以及核心包/领域包系统的每帧步进统一由 `stepSceneRuntime(dt, host)` 调度，`EditorViewport` 只作为宿主提供渲染与对象查询，确保编辑器试玩与未来独立导出运行 100% 共用同一循环。
   - **统一节点玩法挂载槽（`node.gameplay`）**：核心包与领域包数据统一挂在 `SceneNode.gameplay`（`NodeGameplay`）下，禁止继续向 `SceneNode` 顶层散落玩法字段。
   - **核心包（Core Pack）**常驻开启，提供成品级组件（角色移动 `character`、跟随相机 `cameraFollow`、触发器 `trigger`、互动点、移动机关、复活点、计分、标签与同一种“当……就……”律令表 `rules`）。
   - **领域包（Domain Packs：属性、战斗、感知、背包、对话）与品类专包（如策略/RTS、塔防、载具竞速等）**按需开启，数据存放在 `node.gameplay.packs[packId][componentId]`；通过 `src/gameplay/registry.ts` 的 `GameplayPackManifest` 统一声明数据表（`tables`）、节点组件（`components`）与律令词条（`triggers / conditions / actions`），**严禁**将新玩法包的组件卡片硬编码进 `InspectorPanel.tsx` 或将词条硬编码进核心 `rules.ts`。关闭玩法包时不清除节点上已填写的配置数据，律令编辑器自动标出缺失并安全跳过。
   - 需要试玩态视口交互（如边缘滚屏、点选区分单位/空地、拉框选人、群体编队）时，统一通过 `SceneRuntimeHost`（`pointerNormalized`、`consumeNodeClick`、`setPlayMarqueeEnabled`、`consumePlayMarquee`）与导航包的 `computeFormationTargets` 接入。
   - **系统功能不进扩展包栏。** 界面、音效这类始终开启的系统，检查器放在场景属性的**系统**栏，不放**扩展包**栏，也不登记进 `src/capabilities`。场景级系统数据写在 `ScenePicture` 自己的字段上（音效是 `picture.audio`：总音量、音乐、音效）。`picture.capabilities` 只给可关闭的场景能力包，例如天空。
   - **官方库与游戏数据分开。** 库窗口（工具栏「官方库」、菜单 **文件 → 官方库**）只做货架和工程开关，四栏是：能力（`src/capabilities`，含水体与天气）、玩法（核心包以外的领域包）、专项（RTS、RPG 等专属包；模板单独标明，不是包）、素材（现成模型、动画、粒子预设，用到时再导入，不是运行时开关）。核心包始终开启，不进库。游戏数据窗口只编辑表，不再放玩法包开关。关掉的包从数据表目录消失，已写的行留在工程里。用户包与官方包走同一套登记，支持本机用户库安装与能力沉淀，不做在线商店；用户包数据同样只进既有挂载槽（`node.gameplay.packs[packId]` / `node.capabilities[id]` / `picture.capabilities[id]`），未归属包的工程脚本挂在保留包名 `node.gameplay.packs.__project__[scriptId]`。

---

## 7. AI 工程管理器、指令层与代码类资产边界（AI 模式主线准则）

详细规划见 `docs/ai-mode-plan.md`，接口契约见 `contracts/t3d/shader.d.ts` 与 `contracts/t3d/runtime.d.ts`。

1. **工具总定位**
   - 生产过程以 AI 为核心；T3D 定位为「AI 驱动的游戏工程管理器」（立项与设计中枢、资源/数据与包管理、多端试玩台、调试/体检与性能守门、版本快照与实验对比、验证发布与能力沉淀），手动编辑退居为局部微调辅助。
   - 不做积木式的简化模式；AI 生产与手动辅助操作同一套工程文件，能力不分叉。
2. **指令层与运行时隔离**
   - 工程数据的修改必须经过指令层（`dispatch`）；卡片组件不直接拼数据写 store。试玩期间（`playState === 'playing'`）拒绝文档修改指令。
   - 运行时代码（`src/runtime`、`src/capabilities/*/session.ts`、`src/gameplay/*/runtime.ts`）不得引用 `src/editor/`。
3. **工程文件树与参数自描述**
   - 工程统一为按职责拆分的磁盘文件夹结构（`project.json`、`design.md`、`input.json`、`scenes/`、`prefabs/`、`ui/`、`materials/`、`tables/`、`scripts/`、`shaders/`、`assets/`、`packs/`、`.t3d/`）。
   - 各类资源（能力包、玩法组件、指令、着色器、脚本、特效预设）的参数说明统一只用 `FieldSchema` 一套。
4. **着色器与脚本资产边界**
   - **着色器资产（`shaders/*.shader.ts`）**：AI 与用户编写的着色器走 `defineShader` 表面输出模式（`lit` / `unlit`），只用白名单 TSL（`t3d/shader`），不允许任意 GLSL/WGSL 字符串；`NodeMaterial` 创建、MRT G-Buffer 保护、混合/深度/阴影/雾由 T3D 统一负责。水体等完整效果仍为能力包。
   - **脚本资产（`scripts/*.ts`）**：AI 写游戏逻辑统一用「已有玩法包组件 + TypeScript 脚本」，律令只留作手动辅助；脚本支持 `defineBehavior`（行为组件）与 `defineSystem`（运行时系统）两种形状，限定只能调用 `t3d/runtime` 公开的 `ScriptApi`（禁止访问 DOM、网络、文件、编辑器 store 或私自开启 `requestAnimationFrame`），状态放在 `self.state`。
   - **安全与主进程隔离**：模型与第三方生成服务的密钥只存 Electron 主进程，网络请求只从主进程发出；导入他人含脚本或着色器的包需经过信任确认。

---

## 6. 社区与新效果能力包扩展规范（水体、载具、体积云、程序化动画等）

当需要将 Three.js 社区效果、官方 `three/addons` 或新算法封装为 T3D 能力包（`src/capabilities/<id>/`）时，必须遵守以下 5 条架构准则：

1. **统一数据挂载槽与零顶层污染**
   - 新增的节点级能力包（如水体 `water`、车辆 `vehicle`、弹簧骨骼 `springBone`、脚部 `footIk`）的数据统一存放在 **`node.capabilities[capabilityId]`**。
   - 新增的场景/环境级能力包（如体积云 `clouds`、动态天象）的数据统一存放在 **`picture.capabilities[capabilityId]`**。
   - **严禁**再为单个新能力包向 `SceneNode` 或 `ScenePicture` 顶层直接追加平铺字段。关闭能力包时保留已存数据，仅卸载运行时与隐藏属性面板卡片。

2. **动态懒加载与依赖声明（`CapabilityManifest`）**
   - 在 `src/capabilities/registry.ts` 中登记能力包时，凡包含重型算法或外部库的包，必须通过 `loadRuntime: () => import(...)` 动态按需加载，并由 `syncCapabilityRuntimes` 根据工程开关驱动 `mount / dispose`。
   - 依赖其它能力的包（如 `vehicle` 依赖 `['physics']`）必须显式声明 `dependencies`，确保未开启时不占用首屏包体积与运行内存。
   - 任何第三方 npm 库只允许在该能力包内部的单一适配文件中 `import`，严禁泄漏到 `EditorViewport` 或公共 store。

3. **五阶段帧流水线对号入座（`RUNTIME_STAGE`）**
   - 所有能力包的每帧逻辑必须通过 `registerRuntimeSystem(id, order, step)` 对齐到 `src/runtime/sceneRuntime.ts` 的五阶段流水线，严禁私自开启 `requestAnimationFrame`：
     - **`PRE_PHYSICS` (`0 ~ 49`)**：玩家输入、角色控制器、载具油门/转向意图、机关与律令。
     - **`PHYSICS_NAV` (`50`)**：物理世界步进（Rapier）与导航网格同步。依赖刚体/射线模拟的载具、浮力、关节等通过 `registerPhysicsExtension` 挂入此阶段。
     - **`ANIMATION` (`60`)**：`AnimationMixer.update(dt)` 关键帧骨骼动画推进。
     - **`POST_ANIMATION` (`70`)**：**特殊/程序化动画包专属阶段**（如 LookAt 头部注视、Foot IK 地形貼合、SpringBone 头发裙摆物理、布娃娃混合）。必须在关键帧动画算完之后、渲染之前修正 `Bone` 局部或世界矩阵，严禁在 `AnimationMixer` 中伪造虚拟 Clip 抢权重。
     - **`PRE_RENDER` (`80`)**：粒子系统模拟、水体波浪时间与材质 Uniform 更新。

4. **视口渲染钩子与 TSL + MRT 铁律**
   - 需要离屏预渲染的效果（如水体平面反射、折射相机 Pass）统一通过 `src/editor/viewport/renderHooks.ts` 的 `registerBeforeRenderHook` 接入，**禁止**直接修改 `EditorViewport.ts` 主循环。
   - 社区中的传统 GLSL `ShaderMaterial` / `RawShaderMaterial` 迁入时，必须改写为 `three/webgpu` 的 `NodeMaterial` + **TSL（`three/tsl`）**，以保证同时兼容 WebGPU 与 WebGL2 回退后端。
   - 半透明或全屏体积效果若在主场景 Pass 绘制，必须遵守第 1.2 节的 **MRT G-Buffer 保护规则**（保留 `normal` 与 `metalrough` 缓冲），防止破坏 SSR / SSGI / AO。

5. **标准能力包目录结构**
   - 每个新增能力包在 `src/capabilities/<id>/` 下保持清晰职责拆分：
     - `defaults.ts` / `types.ts`：纯序列化数据结构与默认值（零 Three.js / 第三方库依赖）。
     - `session.ts` / `runtime.ts`：对接 `registerRuntimeSystem`、`registerPhysicsExtension` 或 `registerBeforeRenderHook` 的运行时生命周期。
     - `<Name>Card.tsx`：遵循 `iv2-card` 布局规范的属性面板卡片，内部自行判断 `capabilityEnabled` 决定是否渲染。
