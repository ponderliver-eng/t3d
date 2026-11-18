# 资源缓存与打开场景速度（优化记录与后续规划）

本文记录 2026-11-17 梳理的缓存与加载优化项。高性价比的核心项已在代码中落地，其余重型项保留作为后续按需演进依据。

长期约束仍以 `docs/architecture-rules.md` 第 3 节为准：内容寻址、按需预热、色彩空间隔离、删除时释放显存。

---

## 0. 已落地实施项（2026-11-17）

1. **分阶段计时与状态栏预热进度（原 3.6 / 3.7）**
   - `warmAssets` 已拆分统计 `场景 / 模型累计 / 贴图累计` 耗时并输出到 `log.openedDetail`。
   - 状态栏实时显示 `正在加载资源 x/y`，预热完成后自动收起。
2. **模型 GLB 成品剔除重复内嵌的工程贴图（原 3.1）**
   - `loadFbxWithUfbx` 不再把工程已有独立贴图打包进 `.cache/t3d/import-artifacts/` 的 GLB 成品，消除打开工程时同一张贴图的二次解码，成品版本已升至 `t3d-glb-artifact-8-ufbx-light`。
3. **模板阶段一次性预计算切线 & 预热后管线预编译（原 3.4 / 3.5）**
   - `templateFromObject` 在模型模板加载时计算一次 `computeTangents()`，所有克隆实例共享几何体；预热完成后触发 `t3d:warm-complete` 调用 `renderer.compileAsync(scene, camera)`。
4. **贴图后台 `createImageBitmap` 解码、2048 最大尺寸限制与按 `hash` 自动失效（原 2.1 / 2.2 / 2.6）**
   - `loadBitmapTexture` 优先走 `createImageBitmap` 异步解码并将超限大图等比降采样至 `2048px`。
   - `imageHashes` 记录贴图内容哈希，贴图内容变更时自动释放旧 GPU 纹理与衍生副本。
5. **Unity 金属光滑图重排不再预先上传原图（原 2.5）**
   - `unityMetallicRoughnessTextureFor` 在 Worker 重排完成前返回 `null`，避免未重排原图上传 GPU 造成闪烁与双倍显存。

相关代码：

- 贴图运行时缓存：`src/editor/assets/textures.ts`
- 打开工程与预热：`src/editor/assets/project.ts`（`warmAssets`）
- 模型成品：`src/editor/assets/models.ts`、`src/editor/assets/ufbx/ufbxToGlb.ts`
- 成品版本键：`src/editor/assets/cache.ts`（`${hash}__${MODEL_IMPORTER_VERSION}`）

---

## 1. 现状

做得对的部分：

- 源文件按 SHA-256 去重，重复导入不存两份。
- 源文件落在 IndexedDB 或目录工程里，重开工程不用重新转换。
- `warmAssets` 只预热当前场景、预设体、材质实际引用到的资源，并发 3，场景引用排在前面。其余资源只登记元数据，拖入场景或打开预览时再加载。
- FBX 转出的 GLB 成品会缓存。二次打开命中成品，不再跑 ufbx。
- 同一张贴图的线性空间副本共享底层 `source`，不重复保存解码像素。
- Unity MaskMap 的通道重排在 Worker 里做，结果有缓存。

缺口分两类：贴图解码后的内存没有上限，以及打开场景时同一张图会被解码两次、并卡在主线程上。

---

## 2. 贴图内存

`textures.ts` 的 `images` 只在删除资源时清理。没有按内存上限淘汰，也没有释放当前场景未引用的贴图。

一张 4K RGBA 贴图，CPU 侧约 64MB，GPU 侧带 mipmap 约 85MB。Mia 这类角色有十几张 2K/4K 贴图，一个角色就可能到 1GB 量级。场景里多个角色时线性增长。

导入不会降采样，也不会转成 GPU 压缩格式。项目里已有 `KTX2Loader`，但只用于读取已经是 `.ktx2` 的文件，导入 PNG/TGA 时不会生成 KTX2。4K 原图按屏幕上几十像素的模型原样上传。

一张 Unity 金属/光滑度贴图会同时占四份：原图的 CPU 和 GPU，加上重排结果的 CPU 和 GPU。重排完成前，原图会先被当作临时贴图上传，这次上传用完即废。

`TextureLoader` 走 `HTMLImageElement`，解码和上传都在渲染帧里。缩略图（`imageThumb`）还会把原图再解码一次。

运行时缓存以资源 ID 为键。贴图内容被改写（例如预览里翻转后保存）后，必须手动 `releaseTexture` 才能看到新图，没有按内容自动失效。

建议：

1. 解码改用 `createImageBitmap`，放进 Worker。上传完成后丢掉 CPU 侧像素，只留 GPU 纹理。
2. 增加「贴图最大尺寸」，默认 2048。超出的图在 Worker 里降采样，把结果写入磁盘缓存，下次打开直接读。
3. 导入时离线转成 KTX2/Basis，打开场景时只做上传，不再解码 PNG、不再现场生成 mipmap。这项对加载时间和显存的收益最大，也最大。
4. `images` 加按内存上限的 LRU。只淘汰当前场景没有引用的贴图。
5. Unity 重排完成前不要上传原图。重排完成后释放原图的 CPU 副本。
6. 运行时缓存键改为 `hash + 处理参数`（最大尺寸、色彩空间、是否重排）。内容或参数变了自动失效。

---

## 3. 打开场景的速度

二次打开已经跳过 FBX 转换，剩下的时间主要花在读成品、解码贴图和第一次创建渲染管线上。

模型成品里仍然内嵌整张贴图。`ufbxToGlb` 把工程里的 PNG 写进 GLB，`compressMeshopt` 只压几何体，不压这些 PNG。打开时 `GLTFLoader` 先把内嵌的 4K 图解码一遍，随后 `applyModelMaterials` 再用工程贴图资源替换材质，同一张图被解码两次，内嵌的那次是白做的。成品体积也因此偏大，读盘更慢。

`applyModelMaterials` 在网格没有切线时现场调用 `geometry.computeTangents()`。大网格的这部分耗在主线程，而且每次从成品重建场景都会重算。

WebGPU 管线在第一次用到某种材质组合时才创建。场景预热结束后没有 `renderer.compileAsync`，卡顿出现在模型第一次进入画面时，而不是加载过程里。

打开完成的日志只有总耗时、场景文档耗时、成品命中数和失败数（`log.openedDetail`）。看不出时间花在读盘、解析 GLB、解码贴图还是上传。

建议：

1. 成品只保留几何、骨骼、动画和材质参数。贴图统一走工程资源。仅当没有对应工程贴图时才把贴图内嵌进成品。改这一项要升 `MODEL_IMPORTER_VERSION`，让旧成品失效重建。
2. 贴图按第 2 节转成限尺寸的 KTX2，打开时直接上传。
3. 解码、降采样、通道重排放进 Worker，主线程只上传。
4. 预热结束后对当前场景调用 `renderer.compileAsync(scene, camera)`，把管线创建放进加载阶段。
5. 导入时把切线算好写进成品，运行时不再 `computeTangents()`。
6. 把打开耗时拆成：读成品、解析 GLB、贴图解码、GPU 上传、首帧。先有这组数字，再排后面几项的顺序。
7. 场景先出来、模型还在后台加载时，给出占位或进度。用户感受到的快慢，很大一部分取决于能不能先看到东西。

---

## 4. 建议的实施顺序

1. 分阶段计时（第 3 节第 6 项）。改动小，用来验证后面每一项到底快了多少。
2. 成品去掉可替代的内嵌贴图（第 3 节第 1 项）。纯代码改动，直接去掉一次整图解码。
3. 切线写入成品、预热后 `compileAsync`（第 3 节第 4、5 项）。
4. Worker 解码、最大尺寸、丢弃 CPU 副本（第 2 节第 1、2 项）。
5. KTX2 离线转码与 LRU（第 2 节第 3、4 项）。
6. Unity 重排的重复上传、缓存键改为内容哈希（第 2 节第 5、6 项）。

第 1、2 项做完后再决定要不要上 KTX2。如果计时显示时间不在贴图解码上，第 5 项可以后移。
