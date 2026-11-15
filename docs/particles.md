# 特效

特效是能力包 `particles`，目录 `src/capabilities/particles/`。默认关闭。关掉之后，资源和物体上的数据留着，检查器收起，不再加载 `three.quarks`。重新打开后照原样播放。

它不进入阶段 1 到 9 的实施顺序。材质资产（阶段 3）可用之后再做。视口、试玩和导出仍是同一个 `WebGPURenderer`。

模拟和特效 JSON 用 `three.quarks` **0.17.1**。绘制用我们自己的 TSL。不安装 `quarks.nodes`。

## 资源和物体

两种创建方式，存的是同一份模拟。

**资源。** 工程目录里的一种文件，种类是 `effect`。内容是：

- `quarksVersion`：写成这份模拟时的 `three.quarks` 版本
- `simulation`：Quarks JSON 里的模拟。贴图和混合方式不放在这里
- `materialAssetId`：一张粒子材质

**物体。** 场景节点种类 `effect`。变换就是发射器变换。节点上的 `effect` 字段是：

- `assetId`：引用一份特效资源。空着表示模拟写在节点自己身上
- `simulation` 和 `quarksVersion`：只有没引用资源时才有
- `materialAssetId`：空着则用资源上的材质；写了就是这个物体自己的材质
- `playing`：是否播放

从菜单创建特效物体时，先放一份内嵌模拟，不强制先有资源。之后可以存成资源，节点改为引用；物体上改过的播放开关和材质保留。把资源拖进视口时，新建物体并只记资源 id。资源改了，引用它的物体跟着改。

删资源前指出哪些物体还在引用。能力包关闭时，这些物体标成缺失，不静默播放。

## 材质

不另建特效材质资产，也不另建着色器资源。材质仍是现在的材质列表。

`shader` 增加 `particle-unlit`。这是引擎里的一段 TSL，用户不写着色器。这张材质使用：底图、染色、混合（透明、预乘、叠加、相乘）、软粒子距离。金属度、粗糙度、法线、遮挡不参与。

模型的 `lit` 和两种无光材质继续走 `MeshStandardMaterial` / `MeshBasicMaterial`。粒子不走 `applySlot`。把 `lit` 赋给特效物体时不播放外观；把粒子材质赋给模型时不走公告板。

导入 Quarks JSON 时，把它自带的贴图和混合收成一张 `particle-unlit` 材质，模拟里去掉这份外观。贴图进现有贴图资源，用 `textureFor` 取用。

特效物体在场景里，色调映射和泛光走 `ScenePicturePipeline`。不放进第 31 层。

## 和 quarks 的边界

编辑器其余部分只调用包内接口，不引用 `three.quarks` 的类型。场景文档、检查器和视口里没有 `ParticleSystem`、`BatchedRenderer` 或 `ShaderMaterial`。

包内分成三块：

| 文件 | 职责 |
| --- | --- |
| `session.ts` | 能力开关、动态 `import()`、在视口 `render` 之前 `update(dt)` |
| `runtime.ts` | 接口：加载一份模拟、设置变换和材质、播放、步进、销毁 |
| `quarksRuntime.ts` | 解析 JSON、驱动上游模拟、把粒子交给 TSL 批次。和 `tslBatch.ts` 是仅有的两个引用 `three.quarks` 的文件 |
| `tslBatch.ts` | 继承 `SpriteBatch` 和 `TrailBatch`，只覆盖 `rebuildMaterial()`。另有一个批次渲染器，把上游写死的 `new SpriteBatch` 换成这两个子类 |

`runtime.ts` 对上面是普通数据：模拟 JSON、材质参数、世界矩阵。`quarksRuntime.ts` 对下面是库。换 `three.quarks` 的版本只改这个文件和 `tslBatch.ts`。

实例属性仍由上游 `update()` 写入：`offset`、`color`、`size`、`rotation`、`uvTile`，拉伸公告板另有 `velocity`。TSL 只读这些属性。属性名集中在 `tslBatch.ts` 一处。

模拟留在 CPU。WebGPU 和 `forceWebGL` 用同一段 TSL、同一条 `update()`。编辑态也步进，视口里能看见。停止试玩不恢复粒子，粒子是算出来的。

`package.json` 把 `three.quarks` 钉死在 `0.17.1`，不使用 `^`。

## 升级版本

1. 改 `package.json` 里的版本号，只改这一处依赖。
2. 跑能力包里的固定样例：普通公告板、拉伸公告板、序列帧、拖尾。WebGPU 和 `forceWebGL` 各一次。
3. JSON 形状有变时，在 `quarksRuntime.ts` 里按资产上的 `quarksVersion` 做转换，再把版本写成新版本。转换失败时，检查器和视口指出这份特效是哪个版本写下的。
4. 上游若改了实例属性或 `rebuildMaterial()` 的调用方式，只改 `tslBatch.ts`。资源和场景节点不动。
5. 上游若不再适合继承，就在 `quarksRuntime.ts` 里换掉批次的构造。接口 `runtime.ts` 不变。

不把 quarks 的类拷进仓库。不改 `node_modules`。`quarks.core` 的行为、发射器和 `QuarksLoader` 继续用上游。

## 绘制顺序

先做普通公告板：透明、叠加、底图、粒子颜色。一份 JSON 在两个后端都能看见，再往下做。

然后是拉伸、水平、垂直公告板和序列帧，然后是拖尾。网格粒子的无光版本放在这四项之后。受光网格粒子和软粒子再往后；软粒子要从 `WebGPURenderer` 读场景深度，不沿用 quarks 现在的 WebGL 深度贴图。

## 接入编辑器的位置

- `src/capabilities/registry.ts` 登记 `particles`，默认关
- `EditorViewport.tick` 在 `renderer.render` 之前调用 `session.ts`
- 资源种类 `effect`，节点种类 `effect`
- 检查器卡片只在能力打开时出现
- 菜单创建特效物体；资源面板可以导入 JSON，也可以把特效存成资源

第一版不在编辑器里画曲线。特效在外部做好，再导入 JSON。

## 这一版不做

- `quarks.nodes`，以及任何自己向 `navigator.gpu` 要画布的渲染器
- 把模拟改成 compute
- 用户编写的着色器、着色器图
- 在编辑器里从零做粒子曲线
- 受光的网格粒子、软粒子，直到公告板和拖尾已经在两个后端通过
