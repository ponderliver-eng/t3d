# T3D 大型项目、显存治理与超大资源包（5GB+）架构方案

本文档汇总了 T3D 在面对**大型游戏工程（数千个资产、多关卡）**、**超大型地图**以及**5GB+ 超大 `.unitypackage` 资源包导入**时的内存/显存瓶颈分析与完整技术实施方案。

---

## 一、现状诊断与核心瓶颈分析

### 1.1 贴图压缩策略：BC7 vs KTX2
- **编辑器本地已有优势（GPU 直通 BC7）**：
  - `src/editor/assets/bc7Compress.ts` 与 `textures.ts` 已实现 WebGPU Compute Shader 的 **BC7（`RGBA_BPTC_Format`）** 硬件压缩管线，导入贴图后会将包含完整 Mipmap 链的 BC7 成品落盘至 `.cache/t3d/import-artifacts/`。
  - 相比传统 KTX2（BasisU UASTC 需要 WASM 二次转码），本地直读 BC7 二进制块直接上传 GPU 是 **0 CPU 解码开销**，且显存固定降低 **75%**（例如 4K 贴图从 ~85MB 降至 ~21MB）。
- **当前短板（发布端回退未压缩 RGBA）**：
  - `src/player/exporter.ts` 目前导出的是 `.png` / `.webp`。虽然磁盘文件体积小，但在独立游戏（Electron / Web Player）启动加载进显卡时，仍会解压为 **100% 原始 RGBA 显存**。
  - **结论**：本地编辑器保持 GPU BC7 缓存为主、支持外部 `.ktx2` 直接导入；而在**构建发布（Exporter & Player）**阶段，需打通直接导出并加载预烘焙的 **BC7 成品（桌面端）或 KTX2（跨平台 Web 端）**，让发布包显存同样直降 75%。

### 1.2 Electron 内存与显存上限（为什么大工程会崩？）
1. **渲染进程 V8 堆默认 4GB 硬上限**：
   - 64 位 Chromium 默认限制单个渲染进程 V8 堆内存约为 `4GB`。在大批量资源导入、大数组拷贝或巨型 JSON 序列化时，超过 4GB 会直接触发 `Renderer process crashed - Out of Memory`。
2. **CPU + GPU「双份内存驻留」**：
   - 当创建 `DataTexture(rgba)` 或 `Texture(imageBitmap)` 上传 GPU 后，底层 `Uint8Array` 或 `ImageBitmap` 若仍挂在 JS 对象上，会导致同一张 4K 贴图同时占用 `64MB RAM + 64MB VRAM = 128MB`。
3. **只进不出的缓存池**：
   - `textures.ts`（`images` / `linearImages` / `unityMrImages`）、`models.ts`（`templates`）与 `player/main.ts`（`PlayerAssetManager`）目前仅在彻底删除资产文件时才调用 `dispose()`。切换场景、关闭预览或删除场景节点后，显存依然永久驻留。

### 1.3 5GB+ `.unitypackage` 导入的三大崩溃点
1. **扫描阶段爆 ArrayBuffer 上限**：`PackageExtractDialog.tsx` 直接调用 `file.arrayBuffer()` 并在渲染进程执行 `maybeGunzip(bytes)`，一次性在内存中解压出数 GB 的 tar 字节流，超过 Chromium 单 `ArrayBuffer`（2GB~4GB）上限直接崩溃。
2. **索引阶段全量字节驻留**：`packageAssetScanner.ts` 将所有条目的 `assetBytes: Uint8Array` 全部保存在 JS 内存中。
3. **入库阶段无节制加载进显存**：`import.ts` 的 `ingest()` 每导入一个贴图或模型，立即调用 `loadTextureAsset()` / `loadModelTemplate()` 塞进 GPU 显存且不释放，导入几百个文件后显存即刻耗尽。

---

## 二、模块 A：Electron 内存扩容与显存/内存自动回收闭环（防 OOM）

### 2.1 拓宽 Electron 进程内存配额（`electron/main.ts`）
- 在主进程启动时追加 V8 与 GPU 内存参数：
  ```ts
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192')
  ```
- 将渲染进程可用 JS 堆上限提升至 `8GB`（可根据机器物理内存动态调整为 `8192` 或 `12288`）。

### 2.2 资产引用追踪与 LRU 显存预算池（`AssetMemoryManager`）
1. **活跃引用集合（`activeAssetIds`）计算**：
   - 汇总当前激活场景引用的全部资产（`referencedAssetIds`）+ 当前打开的资产预览窗口（`previewStore`）+ 正在执行的构建任务。
2. **显存估算与时间戳登记**：
   - 为每个已加载的 `Texture`（含 `images`、`linearImages`、`unityMrImages`、`environments`）和 `ModelTemplate` 记录 `lastUsedAt` 与 `estimatedVramBytes`（BC7 按 `w * h * 1.33` 字节计算，未压缩 RGBA 按 `w * h * 4 * 1.33` 字节计算，模型按顶点属性 Buffer 字节数累加）。
3. **自动淘汰与场景切换 GC**：
   - **切换场景时**：自动扫描上一场景已不再被引用的资产，立即卸载或移入冷队列。
   - **LRU 预算水位线**（例如默认 `2.0 GB` 显存上限）：当已加载显存超过阈值时，按 `lastUsedAt` 从旧到新自动回收非活跃资产：
     - 调用 `texture.dispose()` 并从 Map 移除；
     - 调用 `releaseModel(id)` 并递归 `dispose()` 模型模板 `scene` 上的 `BufferGeometry` 与 `Material`；
     - 调用 `URL.revokeObjectURL(asset.url)` 并置空 `asset.url = ''`（保留 `AssetMeta`，下次拖入场景时从磁盘 `.cache/t3d/import-artifacts/` 毫秒级重读）。

### 2.3 释放 CPU 端冗余像素副本
- 贴图完成 GPU 上传及磁盘缓存写入后，释放不再需要 CPU 访问的临时 `Uint8Array` 缓冲，避免 RAM 与 VRAM 双倍占用。

### 2.4 发布构建（Player）复用 BC7 压缩贴图
- 在 `src/player/exporter.ts` 与 `src/player/main.ts` 中新增压缩纹理通道：
  - 若工程 `.cache/t3d/import-artifacts/` 中已存在该贴图的 `bc7` / `unity-mr-bc7` 成品，打包时直接将其输出为 `.bc7` 资产文件；
  - `PlayerAssetManager` 在支持 BC7 的桌面显卡上直接用 `CompressedTexture`（`RGBA_BPTC_Format`）加载，使独立导出游戏的显存占用同样降低 **75%**。

---

## 三、模块 B：5GB+ 超大 `.unitypackage` 流式解包与「导入前置设置」

### 3.1 Electron 主进程流式解包（0 内存峰值扫描）
1. **彻底移除渲染进程 `file.arrayBuffer()`**：
   - 通过 `webUtils.getPathForFile(file)` 获取 `.unitypackage` 的本地磁盘绝对路径，通过 IPC 交由 **Electron 主进程** 处理。
2. **Node.js 流式 Gunzip + 流式 Tar 解析**：
   - 主进程使用 `fs.createReadStream(pkgPath).pipe(zlib.createGunzip())` 配合流式 Tar Header 状态机解析（或解压至 `.cache/t3d/pkg-staging/<sessionId>.tar` 临时文件）：
     - 遇到小元数据文件（`pathname`、`asset.meta`、`preview.png`）时，直接提取到内存；
     - 遇到大体积 `asset` 本体（几十 MB 的 FBX / TGA / PNG / WAV）时，**绝不读入内存**，仅在索引条目中记录 `{ tarOffset, sizeBytes }`。
   - 扫描完成后，仅将轻量目录树、GUID 映射表与 `preview.png` 缩略图返回给渲染进程弹窗。**无论包体是 500MB 还是 20GB，扫描阶段内存占用恒定 `< 50MB`。**
3. **按需切片读取入库**：
   - 当用户点击「开始导入」时，按勾选列表逐条（或小并发池 `concurrency = 2`）根据 `{ tarOffset, sizeBytes }` 从临时文件流式切片写出到工程 `assets/` 目录。

### 3.2 `PackageExtractDialog` 导入前置设置（Import Pre-Settings）
在扫描完成后、执行提取前，在导入面板顶部提供**前置处理设置**（当包体积 `> 500MB` 或条目 `> 200` 时自动启用安全默认值）：

| 前置设置项 | 可选值与默认策略 | 作用与收益 |
| --- | --- | --- |
| **1. 导入加载策略** | - **仅入库登记，按需懒加载（默认推荐）**<br>- **入库并后台流式烘焙（即用即释放）** | - **仅入库登记**：只写磁盘文件与 `AssetMeta`，不塞入当前视口 WebGPU 显存，导入速度极快且 0 显存增长。<br>- **流式烘焙**：后台以并发=2 转换 GLB/BC7 缓存，每完成 1 个立刻 `releaseModel` / `releaseTexture`，内存水位保持平线。 |
| **2. 贴图最大尺寸限制** | `不限制` / `4096` / **`2048（推荐）`** / `1024` / `512` | 导入时若原图（TGA/PNG）超出上限，自动无损降采样（保留未预乘 Alpha 通道），从源头将 4K/8K 贴图体积削减 75%~93%。 |
| **3. 复用包内预览图** | **默认开启（直接使用 `preview.png`）** | Unity 导出包自带每个模型/材质的 `preview.png`，直接转为资产缩略图，省去在编辑器里挨个加载几百个 FBX 离屏渲染缩略图的巨大开销。 |
| **4. TGA 贴图转存格式** | **法线/通道图转无损 PNG，漫反射转 WebP/PNG** | 避免原始未压缩 TGA 占用海量磁盘空间，同时严格保护法线与 Unity `MetallicGloss` 的 Alpha 通道不被预乘清零。 |
| **5. 资产类型与冗余过滤** | 勾选：`模型` / `贴图` / `材质` / `动画`；可选「仅导入被选中模型/Prefab 引用的贴图与材质」 | 一键剔除大型资源包中未用到的废图、展示场景杂物与冗余变体。 |

---

## 四、模块 C：海量资产（1,000 ~ 10,000+）管理面板与大地图演进

### 4.1 海量资产浏览与工程管理能力
1. **Project 面板虚拟滚动（Virtual Grid / Virtual List）**：
   - 改造 `src/editor/panels/ProjectPanel.tsx`，仅挂载当前可视区域内的 40~60 个资产卡片 DOM，支持万级资产目录 60fps 滚动与秒级搜索过滤。
2. **缩略图外置存储与可视区懒加载**：
   - 将缩略图从 `project.t3d` 内联 Base64 迁移至 `.cache/t3d/thumbs/<hash>.webp`，避免几千个资产导致工程 JSON 膨胀至数十 MB。
3. **显存监控与资产体检面板（Memory & Asset Profiler）**：
   - 在编辑器底部状态栏展示实时 `VRAM（贴图 / 网格）` 与 `JS Heap`；
   - 点击可打开**显存排行榜（Top 20 贴图/模型）**，支持一键定位、一键批量限制最大尺寸、**「一键释放未引用显存」** 以及 **「查找全工程 0 引用孤儿资产」**。
4. **安全删除与引用查询（Reference Viewer）**：
   - 右键资产可查看「被哪些场景 / 节点 / 材质 / 预制体引用」；删除被引用资产时弹窗预警并支持「替换为另一资产」。

### 4.2 超大型地图（Large World）后续演进储备
1. **场景文件分片存储（`scenes/<sceneId>.json`）**：
   - 将非激活场景的节点树从主文档拆出按需读写，避免自动保存时序列化全工程所有大地图。
2. **子场景分块流式加载（World Partition / Chunk Streaming）**：
   - 支持按相机距离动态加载/卸载子场景区块，配合模块 A 的 LRU 显存池实现无缝大地图漫游。
3. **自动 LOD（基于 `meshoptimizer`）与距离剔除（Cull Distance）**：
   - 在生成模型 GLB Artifact 时自动生成 `LOD0 / LOD1 / LOD2` 多级简化网格，并为中小装饰物提供最大可见距离裁剪。
4. **同类静态网格自动实例化（Auto-Instancing）**：
   - 对大地图中重复摆放的树、石头、建筑构件自动合并为 `InstancedMesh` 绘制，大幅降低 Draw Call 与节点内存开销。

---

## 五、分阶段实施路线图（Checklist）

- [ ] **阶段一：突破内存上限 + 5GB 大包流式导入与前置设置（最优先）**
  - [ ] `electron/main.ts` 配置 `--max-old-space-size=8192`；
  - [ ] 实现主进程流式 `.unitypackage` 索引器（只传元数据与文件偏移，不把 GB 级二进制读入渲染进程）；
  - [ ] `PackageExtractDialog.tsx` 增加「导入前置设置」（仅入库懒加载 / 流式烘焙即用即释放、贴图最大尺寸限制、直接复用 `preview.png` 缩略图）；
  - [ ] `import.ts` 增加 `lazyIngest` 模式（入库时不强制把所有贴图/模型塞进 GPU 显存）。
- [ ] **阶段二：显存自动回收闭环（`AssetMemoryManager`）+ 发布端 BC7 支持**
  - [ ] 在 `textures.ts` 与 `models.ts` 中接入显存字节统计、活跃引用计数、场景切换卸载与超水位 LRU 自动 `dispose()`；
  - [ ] 状态栏增加实时显存显示与「一键清理未引用显存 / 显存排行」弹窗；
  - [ ] `exporter.ts` 与 `player/main.ts` 支持导出并加载预烘焙的 BC7 压缩贴图。
- [ ] **阶段三：海量资产面板优化与引用工具**
  - [ ] `ProjectPanel.tsx` 接入虚拟滚动列表/网格；
  - [ ] 增加资产引用关系查看（Reference Viewer）与未引用孤儿资产批量清理工具。
