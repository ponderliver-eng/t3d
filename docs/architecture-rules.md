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

---

## 5. 能力包、核心包与领域包边界

1. **节点种类互斥与无积木化**
   - `NodeKind` 保持互斥，**不做** GM3D 式的原子“积木（BlockRegistry）”拼装系统，**不做**以逻辑连线图为主界面的脚本系统。
2. **第三方重型库严格隔离**
   - **物理（`physics`）**：仅 `src/capabilities/physics/rapierWorld.ts` 允许 import `@dimforge/rapier3d-compat`。
   - **导航（`navigation`）**：仅 `src/capabilities/navigation/recastNav.ts` 与 `bake.worker.ts` 允许 import `recast-navigation`。
   - **粒子（`particles`）**：默认关闭；仅 `src/capabilities/particles/quarksRuntime.ts` 与 `tslBatch.ts` 允许 import `three.quarks`；保持 CPU 模拟 + TSL 实例化绘制，不安装 `quarks.nodes`。
3. **核心玩法包与领域包（Gameplay Packs）**
   - **统一运行时调度（`src/runtime/sceneRuntime.ts`）**：物理、导航、粒子、骨骼动画以及核心包/领域包系统的每帧步进统一由 `stepSceneRuntime(dt, host)` 调度，`EditorViewport` 只作为宿主提供渲染与对象查询，确保编辑器试玩与未来独立导出运行 100% 共用同一循环。
   - **统一节点玩法挂载槽（`node.gameplay`）**：核心包与领域包数据统一挂在 `SceneNode.gameplay`（`NodeGameplay`）下，禁止继续向 `SceneNode` 顶层散落玩法字段。
   - **核心包（Core Pack）**常驻开启，提供成品级组件（角色移动 `character`、跟随相机 `cameraFollow`、触发器 `trigger`、互动点、移动机关、复活点、计分、标签与同一种“当……就……”律令表 `rules`）。
   - **领域包（Domain Packs：属性、战斗、感知、背包、对话）**按需开启，数据存放在 `node.gameplay.packs[packId]`，只向同一套律令与配置表追加触发词、动作词与数据表；关闭领域包时不清除节点上已填写的配置数据。
