# 基于 Godot Runtime 重构编辑器的架构调研与设计方案

> **备注**：本文档仅为独立新产品的技术路线调研与架构思考备忘，**与当前 T3D（Three.js）工程代码及开发计划无关**。

---

## 1. 整体可行性与核心定位

**完全可行。** T3D 沉淀出的核心设计哲学与底层渲染引擎无关，可以完整迁移到 Godot 4.4+ 之上，形成 **「T3D 级现代响应式 Web UI 壳 + 满血原生 C++ 3D 内核（Vulkan / Metal + Jolt 物理）」** 的新一代轻量 AI 原生 3D 编辑器：

- **直接继承的 T3D 核心基因**：
  - **`CommandBus` + `FieldSchema` + AI 工程管理器**：所有场景/资产编辑操作收口到统一指令总线，属性与能力卡片由 Schema 自动驱动渲染，天然对 AI Agent 工具调用确定性开放；
  - **无连线图 / 无重型手配工作台**：坚持「内置高内聚组件 + 独立代码脚本（GDScript / C#）+ 表面着色器（`.gdshader`）」；
  - **高频运行时与低频文档彻底解耦**：试玩、过场时间轴（Cutscene）、IK、物理等 60Hz/120Hz 逻辑全部留在 Godot 原生内存闭环运行，严禁每帧反向刷前端 Store。
- **解决的核心上限痛点**：
  - 彻底摆脱浏览器 V8 内存墙与 JS GC 抖动；
  - 原生多线程流式加载、GPU 硬件压缩纹理（BPTC/BC7、ASTC，显存直降 4~6 倍）、原生遮挡剔除（Occlusion Culling）、HLOD/MeshLOD、SDFGI/VoxelGI 全局光照与 Jolt 多线程物理。

---

## 2. 宿主架构与「透明 WebView 叠层」深水区解法

由于 Godot 原生 `Control` UI 难以低成本做出媲美现代 Web IDE 的细腻排版与动效，而传统 Electron 多进程拼窗口又会导致包体臃肿、分栏缩放黑边撕裂与窗口遮挡（Airspace）问题，推荐采用 **「同进程原生宿主 + 底层 Godot 主视口 + 顶层无句柄透明系统 WebView 视觉叠层」**。

### 2.1 为什么优先用「Godot 宿主 + 轻量 C++ GDExtension（或 `LibGodot`）」而非双进程拼装？
- 若将 Tauri 与 Godot 拆成两个独立 OS 进程，拖动分栏（Splitter）调整 3D 视口尺寸时，两个进程的 `WM_SIZE` 与交换链重建无法同帧对齐，视口边缘会出现肉眼可见的黑边抖动。
- **最优宿主形态**：直接以定制编译的 Godot 可执行文件作为唯一主进程（或通过 Godot 4.4+ `LibGodot` 静态/动态嵌入轻量 C++/Rust 宿主），通过不到千行的原生桥接模块直接挂载系统 WebView（Windows `WebView2` / macOS `WKWebView`）：
  - **包体更小**：省去额外套壳框架开销；
  - **同帧同步**：窗口缩放、DPI 切换、原生输入循环与 3D 视口裁剪 `100%` 同帧原子执行；
  - **内存直通**：前端与 Godot 通过进程内 `PostWebMessageAsJson` / 共享内存通信，无 Socket 序列化延迟。

### 2.2 攻克 OS 级鼠标穿透（Hit-Testing）盲区
- **核心误区提醒**：CSS 的 `pointer-events: none` 仅在浏览器 DOM 内部生效，**无法穿透操作系统级的子窗口句柄（HWND）**。若直接盖一层普通透明 `WebView2` 子窗口，鼠标在 3D 视口区的点击与右键漫游会被 WebView 吞掉。
- **标准工程解法：`DirectComposition`（Win）/ `CoreAnimation`（Mac）+ 可交互区域遮罩表（Interactive Hit Regions）**
  1. **Windows 端**使用 `ICoreWebView2Environment3::CreateCoreWebView2CompositionController`（无独立子 HWND 的视觉树合成模式），将 WebView 纹理层直接合成在 Godot Vulkan/DX12 交换链之上；**macOS 端**使用透明 `WKWebView` `CALayer` 叠层并重写 `hitTest:`。
  2. **前端维护轻量 `HitRegions`**：React 侧通过 `ResizeObserver` 维护当前画面上的「镂空视口矩形（Viewport Hole）」以及浮在视口之上的「临时浮层矩形（下拉菜单、右键菜单、Modal 弹窗、视口悬浮 HUD 工具条）」。
  3. **0 延迟输入分流**：宿主收到 OS 鼠标/滚轮/键盘事件时先查 `HitRegions`——落在 UI 区域则注入 `CompositionController::SendMouseInput` 交给 React 处理；落在镂空 3D 视口区则**直接走 Godot 原生 `Input` 管线**（相机漫游、Gizmo 拖拽、框选拾取完全 0 延迟）。
  4. **视觉收益**：下拉菜单、右键菜单、命令面板（`Ctrl+K`）、拖拽胶囊（Drag Ghost）可以**丝滑跨过分栏边界自然悬浮在 3D 视口画面之上**，彻底告别传统多窗口嵌入的边缘裁切感。

### 2.3 剥离官方编辑器后的「静默资产导入管线（`.import`）」
- **核心误区提醒**：Godot 源码中 FBX/GLTF 场景拆分（`ResourceImporterScene`）与 BPTC/ASTC 纹理解码压缩（`ResourceImporterTexture`）默认位于 `TOOLS_ENABLED` 宏下，纯运行态导出模板（Export Template）不含重资产导入器。
- **解决方案**：
  - 编译一个**裁掉全部官方 `editor/gui` 与无用插件、仅保留 `editor/import` 管线的 Headless Import Worker**（或复用已有 `ufbx` + `BC7` 离线烘焙流水线生成标准 `.ctex` / `.scn`）；
  - 当用户在 React 资源面板拖入 `.fbx / .glb / .png / .hdr` 时，后台 Worker 多线程静默生成 Godot 原生 `.import` 描述与 `.godot/imported/` 二进制缓存，完成后通知主视口 `ResourceLoader.load_threaded_request()` 热加载，全程无阻塞、完全兼容官方 Godot 格式。

---

## 3. 如何 1:1 复刻当前 T3D 级别的 UI 质感？

可直接复用当前 T3D **85% 以上的前端代码与设计系统**：

1. **原样保留紧凑型暗色设计语言与 `flexlayout-react` 停靠系统**
   - 完整沿用 `variables.css` 的视觉 Token（`28px` 面板栏高、`11~12px` 高密度字号、克制的 `#1a1a1a / #222222` 层级对比与 `#4a9eff` 焦点强调色）；
   - `HierarchyPanel`、`ProjectPanel`（含刚落地的框选/多选/批量操作）、`InspectorPanel`、`CutscenePanel` 时间轴、`ConsolePanel` 全部保持纯正 React 渲染；
   - 中间的 `ViewportPanel` 渲染为 `background: transparent` 的定位锚点容器，仅把 `(x, y, width, height, dpr)` 实时同步给底层 Godot 的主 `SubViewport` 视口矩形；视口顶部的 Gizmo 模式栏、坐标系切换、画面比例切换、性能耗时胶囊用 React + 毛玻璃（`backdrop-filter`）直接浮绘在视口上方。
2. **高帧率缩略图与实时材质球（`MaterialBall`）**
   - 在 Godot 后台挂载一个专用的离屏小 `SubViewport`（如 `128×128`，带标准 Studio HDR 环境光），为材质与模型异步渲染高清缩略图落盘至 `.godot/thumbs/<uid>.webp`；
   - 前端通过自定义本地协议（如 `app-cache://thumbs/<uid>.webp`）直读展示在 `<img>` 中，千级资源网格滚动稳定 120fps；
   - 双击打开独立模型/材质预览弹窗时，支持动态开启第二个次级镂空视口或高刷共享纹理预览。
3. **超越 Web 原生的「跨层实时落点拖拽（Ghost Placement）」**
   - 从 `ProjectPanel` 拖拽模型/预制体进入 3D 视口时，不走浏览器原生 HTML5 `dragstart`（避免跨原生层时光标闪烁或变禁入符号），改用 **Pointer Capture 自定义拖拽状态机**；
   - 当鼠标进入视口镂空区，前端每帧将 `(clientX, clientY, assetUids)` 发给 Godot，Godot 即时在物理/网格射线落点生成半透明预览实例（自动贴合地面高度与法线，支持多模型网格排布预览），松手瞬间通过 `CommandBus` 正式写入场景树。

---

## 4. 如何与 Godot 原生生态完美契合（零私有孤岛）？

要做到**既有 T3D 极简清爽的「单节点 + 多能力卡片」心智，底层又是 100% 标准可导出的纯血 Godot 工程**，核心遵守以下四条映射契约：

### 4.1 以原生 `.tscn` / `.tres` + `uid://` 为唯一事实源（Single Source of Truth）
- **严禁发明私有场景 JSON 双写**。磁盘工程目录就是标准 `project.godot` + `.tscn`（场景/预制体）+ `.tres`（材质/环境/配置）+ `uid://`（Godot 4 原生全局唯一资源 ID，移动/重命名文件天然不丢引用）。
- **T3D「实体 + 能力卡片」到 Godot 节点树的无损映射（组合子节点约定）**：
  - 场景中的可见业务对象（如 `CharacterBody3D`、`RigidBody3D`、`MeshInstance3D`、`DirectionalLight3D`）作为**实体主节点**展示在左侧 `HierarchyPanel`；
  - 挂载在实体上的能力包与行为脚本（如 `IkCapability`、`ProjectileCapability`、`InteractionDevice`、用户自定义行为脚本）在 Godot 底层作为该实体下的**组件子节点**（带元数据标记 `metadata/_component = true`）；
  - 左侧层级树默认隐藏 `_component` 内部子节点以保持像 T3D 一样清爽的层级视图，而右侧 `InspectorPanel` 自动聚合该实体主节点属性与所有 `_component` 子节点，渲染成与当前 T3D 完全一致的可折叠能力卡片！
  - **最大优势**：工程随时可以用官方 Godot 打开调试，打包导出 PC / iOS / Android 时**零格式转换**，所有组件脚本作为原生 Godot `Node` 全速运行。

### 4.2 GDScript / C# `@export` 与 `.gdshader` `uniform` 自动反射为 `FieldSchema`
- 无需维护双端重复的 Schema 定义，在桥接层利用 Godot 原生反射接口 `Object.get_Property_list()` 与 `Shader.get_shader_uniform_list()` 实时转换：
  - `@export_range(min, max, step)` -> `FieldSchema` 的 `number` 滑条字段；
  - `@export_enum(...)` -> `select` 下拉字段；
  - `@export_color_no_alpha` -> `color` 拾色器字段；
  - `@export var target: Node3D` / `@export var mat: Material` -> 场景节点拾取器 / 资源槽拖拽器；
  - `.gdshader` 中的 `uniform vec4 albedo : source_color;`、`uniform sampler2D normal_map : hint_normal;` -> 自动生成像 T3D 自定义 Shader 一样的可视化材质参数面板。
- 用户或 AI 在外部 Cursor / VS Code 修改保存 `.gd` 或 `.gdshader` 后，Godot 毫秒级热重载并推送最新 `FieldSchema` JSON 给前端 `<SchemaForm>`，同时自动刷新 AI 工具可读写参数列表。

### 4.3 `CommandBus` 直连 Godot 原生 `UndoRedo`
- 前端面板修改参数、视口 Gizmo 结束拖拽、以及 AI Agent 批量调用工具（`scene.createNode`、`capability.setData`、`material.setParam` 等），全部以标准 JSON-RPC Action 发往 Godot 侧的 `CommandServer`；
- `CommandServer` 统一包裹进 Godot `UndoRedo` 事务（`create_action` -> `add_do_property / add_undo_property` -> `commit_action`），完成后向前端推送增量节点 Diff；
- 手动编辑、Gizmo 操作与 AI 批处理共享**唯一权威撤销/重做栈**，彻底杜绝前后端状态不一致。

### 4.4 视口内 0.1 秒原地试玩（Play-in-Viewport）与「保留试玩改动」
- 官方 Godot 默认点运行会拉起独立外部进程窗口，打断心流；
- 在定制编辑器中，点击顶部 `Play` 时：
  - **快速沙盒模式（默认）**：直接将当前编辑场景树的内存 PackedScene 快照在主视口切换到运行态 `SceneTree` / 独立物理空间中驱动，实现与当前 T3D 完全一致的 **0.1 秒原地进入试玩、随时点暂停在右侧 Inspector 实时改参看效果、支持一键「保留试玩改动（Keep Play Changes）」回写编辑态场景**；
  - **独立进程隔离模式（可选）**：利用 Godot 4.4+ 原生窗口嵌入句柄机制，将独立子进程画面无缝内嵌回同一个视口镂空区，兼顾重度 C++/GDExtension 调试时的崩溃隔离。

---

## 5. 商用授权、裁剪包体与边界说明

- **商用许可（MIT License）**：Godot 引擎与运行时采用 MIT 协议，**可 100% 闭源商用、零版税、零分成**；仅需在软件「关于/第三方许可」中保留 MIT 版权声明，并使用独立品牌名称与图标。
- **包体控制（通过 `SCons` `custom.py` 模块化裁剪）**：
  - **桌面编辑器安装包**（定制 Godot 内核 + Headless 导入器 + React 静态资源，复用系统 WebView）：约 **50 – 80 MB**（各平台导出模板按需云端下载）；
  - **PC 独立游戏导出包**（纯 Godot Runtime，不含任何 WebView 或导入器）：约 **25 – 45 MB**；
  - **Android / iOS 导出包**：纯原生 Vulkan / Metal 运行，裁剪未用模块后约 **15 – 28 MB**；
  - **赛道边界**：不适合首包严格限制 `< 4MB` 的微信/抖音即点即玩 H5 微端小游戏（超轻量 Web 微端赛道仍由 Three.js 路线覆盖，两条产品线定位清晰互补）。

---

## 6. 独立原型验证路线图（3 周 MVP）

若后续单开仓库验证该路线，建议按以下最小闭环推进：

1. **第 1 周（同进程视口挖洞 + 穿透输入验证）**：
   基于 Godot 4.4 + C++ `GDExtension` 挂载 `WebView2 CompositionController`（Win）/ `WKWebView`（Mac），加载现有 T3D 的 `IDELayout` 外壳；跑通 `ResizeObserver` 视口对齐、`HitRegions` 鼠标精准分流（验证下拉菜单覆盖 3D 视口 + 视口内 120Hz 右键飞行漫游零延迟）。
2. **第 2 周（`CommandBus` + `.tscn` 组合组件 + `@export` 自动面板）**：
   打通进程内 JSON 消息桥，将 Godot 场景树与 `_component` 子节点映射至 `HierarchyPanel` 与 `<SchemaForm>`，接入原生 3D Gizmo 与 `UndoRedo` 撤销栈，跑通视口内原地 `Play / Pause / Stop`。
3. **第 3 周（静默导入 Worker + AI 工程管理器迁移）**：
   接入后台 `.fbx / .glb / .png` 自动导入与 BPTC 纹理解码，并将 T3D 的 AI 场景搭建/脚本生成工具集对接到新 `CommandBus`，实测百万面次世代光照场景的一句话搭建与流畅编辑。
