# T3D AI 模块开发与维护指南（AI Dev Guide）

> 本文档面向后续在不同设备或新会话中继续开发、调优 T3D 内置 AI 系统的开发者与 AI 助手。开始修改 AI 相关代码前，请先阅读本文档与 `.cursor/rules/t3d-core-architecture.mdc`。

---

## 1. 模块架构与文件地图

T3D 的 AI 系统横跨「主进程代理 → 渲染进程状态循环 → 核心指令与查询层 → 编辑器面板」四层：

| 层级 | 文件路径 | 核心职责 |
|---|---|---|
| **主进程（模型与密钥）** | `electron/services/modelProviders.ts` | 统一适配器（`openai-compatible` / `openai` / `anthropic` / `gemini`）：全通道流式、截断检测、思考内容回传、提示缓存断点、能力探测式降级 |
| | `electron/services/secretStore.ts` | 使用 Electron `safeStorage` 加密存储各 Provider 的 API Key，密钥永不进入渲染进程 |
| | `electron/services/pathGuard.ts` | 工程目录访问白名单校验（重启恢复工程时需先 `authorizeRoot`） |
| **AI 运行循环** | `src/ai/agentLoop.ts` | `useAgentStore`、多步工具推理循环（`MAX_TOOL_STEPS = 40`）、静态 System Prompt 与每轮工程上下文、收尾自动验收、历史裁剪与原地折叠、每轮 Checkpoint 自动备份与回退 |
| | `src/ai/tools.ts` | `buildAiToolSpecs()` 工具声明、`executeAiTool()` 执行分发、`resolveAiNodeArgs()` 节点 ID/名称容错解析 |
| | `src/ai/knowledge/recipes.ts` | 范例库：经运行时仿真验证的完整脚本 + 搭建步骤，AI 通过 `kb__read` 取用 |
| | `src/ai/trace.ts` | 每轮运行轨迹（步数 / 耗时 / token / 缓存命中 / 失败与截断），写入 `.t3d/ai-traces.jsonl` |
| | `src/ai/evals/` | 固定评测任务集与运行器（控制台 `__t3dAiEval.run()`） |
| | `src/ai/historyStorage.ts` | 对话记录持久化（磁盘工程存 `.t3d/ai-history.json`，草稿存 `localStorage`，另存工程时自动迁移）与 JSON 导入导出 |
| | `src/ai/AiWorkbenchPanel.tsx` | 右侧/悬浮 AI 指挥台 UI：实时阶段提示与计时、流式输出、动作胶囊、划词/一键复制、高风险确认、模型配置抽屉 |
| **核心底座（AI 读写边界）** | `src/core/commands/` | 所有修改工程状态的指令注册中心（`commandBus`），AI 严禁直接修改 `useEditorStore` |
| | `src/core/query/` | `queryProjectOverview`、`querySceneOutline`、`queryNodeInspect`、`diagnoseProject` 等只读查询 |
| | `src/core/schema/fieldSchema.ts` & `SchemaForm.tsx` | 统一字段 Schema（支持校验、JSON Schema 生成、`NodeRefControl` / `AssetRefControl` 拖放与弹窗选择） |
| | `src/core/codeAssets/` | 脚本（`scriptRuntime.ts`）与着色器（`shaderRuntime.ts`）的编译、热重载与运行时执行 |
| **视口指点交互** | `src/editor/viewport/ViewportPanel.tsx` | `Ctrl/Cmd + K` 就地指令框、视口画笔圈选批注截图（作为 `imageDataUrl` 发送给 AI） |

---

## 2. Agent 循环设计（`src/ai/agentLoop.ts`）

设计目标按优先级：**单步快（缓存命中）→ 步数少（工具信息充分、确定性检查不占模型步数）→ 结果可靠（看状态验收）→ 可度量（轨迹 + 评测）**。改动 AI 模块前先理解下面五条约束，它们互相支撑。

### 2.1 提示缓存：前缀必须逐字稳定
模型按「工具定义 → 系统提示 → 消息」的前缀计费与缓存。任何对前缀的改动都会让其后的全部内容按全价重算。因此：

- **系统提示完全静态**（`buildSystemPrompt()`，带进程内缓存）：只含工作方式、规范、脚本/着色器/UI API 速查、范例目录。**严禁**往里拼工程概览、节点索引、任务清单等任何会变的内容。
- **工具全集常驻**（`buildAiToolSpecs()`）：不再有“工具域”按需开关。中途增删工具会让整段缓存失效，还要多花一步去开域。
- **动态上下文只注入一次**（`buildTurnContext()`）：`design.md`、工程概览、节点索引、代码资产索引、`@` 引用、任务清单，在每轮开头追加到**用户消息尾部**的 `<工程上下文>` 块里。之后的变化由工具返回告知模型。
- **历史只追加不改写**（`compactMessagesInPlace()`）：不再每步滑动折叠。只有总量超过 `COMPACT_TRIGGER_CHARS` 时才一次性原地折叠早期的大块工具返回 / 源码入参 / 截图，之后恢复只追加。
- Anthropic 通道在系统提示与最后一条 user 消息上打 `cache_control` 断点；OpenAI 兼容与 Gemini 依赖各自的自动前缀缓存。

验证方式：每轮结束控制台会打印 `[AI] 本轮：… 缓存命中 xx% …`，对话卡片底部也会显示。多步任务的命中率应明显高于 50%，否则说明有人破坏了前缀稳定性。

### 2.2 模型适配层（`electron/services/modelProviders.ts`）
- 三个通道**全部流式**，并发出 `text` / `reasoning` / `tool` 三类增量（`tool` 在模型开始生成某个工具的参数时就发出，用于界面进度）。
- **截断必须可见**：返回 `stopReason`（`stop` / `tool` / `length` / `other`）；工具参数 JSON 解析失败时在该调用上标记 `invalid`，**绝不**静默变成 `{}`。循环遇到 `invalid` 不执行工具，而是告诉模型拆小重试。
- **思考内容原样回传**：`ChatResult.providerState` 由循环原封不动放回下一步的 assistant 消息（Anthropic 的 thinking 块含签名、OpenAI 兼容的 `reasoning_content`、Gemini 的 `thoughtSignature`）。
- **能力探测式降级**：Anthropic 依次尝试 `adaptive` 思考 → 固定预算思考 → 关闭，输出上限 32000 → 16000 → 8192 → 4096；OpenAI 兼容在 400 时去掉扩展字段重试。可用形态按「接口 + 模型」记忆，不会每次都先失败一轮。
- 主进程代码不在 `tsc --noEmit` 范围内，改动后必须跑 `npm run test:ai`（`tests/ai-providers.test.ts` 用模拟流式响应覆盖以上行为）。

### 2.3 确定性检查由循环执行，不占模型步数
- **写入即检查**：`script.create/update/patch` 的返回值自带编译诊断与 `lintScriptSource` 反模式检查。
- **收尾自动验收**（`runAutoVerify()`）：模型准备结束时，若本轮改过工程，循环自己跑 `diagnoseProject()`（只报相对本轮开始时**新增**的错误）；若改过脚本/玩法/输入，再跑 1 秒 `PlaytestSession.runSmoke`。全部通过则零开销结束；有问题才把报错回灌给模型修复（最多 2 轮）。
- 因此提示词里**不再**要求模型“每阶段体检 + 截图”，也没有“连续写 N 次强制验收”的门禁。

### 2.4 让模型拿得到信息
- `script__read` / `shader__read`：返回完整当前源码。`script__patch` 的 `find` 必须与它逐字一致，所以这两个工具的返回不截断（上限 60000 字符）。
- 试玩类工具（`playtest__run_smoke`、`viewport__capture({ playSeconds })`、`playtest__control`）统一返回**去重计数后的运行时报错**，并可用 `watchNodes` 回报节点实时位置。模型不需要写探测脚本。
- 试玩类工具同时返回 `logs`（脚本 `self.log` 的输出，按首次出现顺序去重计数，见 `summarizeInfoLogs`）。`watchNodes` 回报位置、朝向（度）、可见性与各脚本的 `self.state` 只读快照（`readScriptStateSnapshot`，深度与长度有上限）；`playtest__run_smoke` 加 `sampleEvery` 返回 `trajectory` 轨迹（最多 60 个采样点）。试玩/暂停期间 `query__node_inspect` 附带同样的 `runtime` 字段。**不提供任意表达式求值**：`self.log` + `self.state` 快照已覆盖读值需求，且不需要新增执行入口。
- 「数据是否生效」可查：`query__node_inspect` 的 `drivers` 逐项标明每个数据槽在试玩中是否被运行时驱动（内置组件 / 脚本编译状态 / 未启用的包 / 写错位置的数据）；`query__registry_describe({ category: "coreComponents" })` 返回内置组件的字段、默认值、枚举与说明（登记表在 `src/gameplay/coreComponents.ts`，与 `gameplay.setCoreComponent` 指令共用）。
- `query__code_assets` 反查脚本挂载（`attachedTo` / `orphan`）；`query__ui_inspect` 在界面已渲染时返回 `layout`（量 DOM 得到的实际矩形与溢出问题，`src/ai/uiLayout.ts`），`viewport__capture` 试玩截图时自动附带 `uiLayoutIssues`；`query__project_diagnose` 附带 `renderBreakdown`（按节点的三角面与网格批次前 8 名，`src/ai/renderBreakdown.ts`）。
- `kb__read`：范例库，见第 4.3 节。
- 日志游标：`store.logs` 是 300 条的环形窗口，取“某时刻之后的日志”必须用 `captureLogCursor()` / `readLogsSince()`（按日志 id），不能用数组下标。

### 2.5 流程控制
- `MAX_TOOL_STEPS = 40`。
- 任务规模自适应写在系统提示里：小改动直接做、不规划；大任务才 `plan__set_tasks`。任务清单有未完成项时循环会自动续推一次。
- 纯文本回复被截断（`stopReason === 'length'`）时自动让模型续写（最多 2 次）。
- 跨轮历史（`buildHistoryMessages`）：最多 24 条 / 18,000 字符，assistant 轮附带动作摘要。

---

## 3. 工具执行与防幻觉机制（`src/ai/tools.ts`）

1. **只读查询工具（`QUERY_TOOLS`）**：不走 `commandBus`，不触发撤回事务，直接读取当前状态或运行冒烟测试（`playtest__run_smoke`、`viewport__capture`）。新增只读工具时要同步加进 `agentLoop.ts` 的 `isReadOnlyTool()`，否则会被当成写操作触发收尾验收。
2. **写操作工具**：自动映射 `commandBus.list()` 中的所有指令（`domain.action` → `domain__action`），参数由 `fieldSchemaToJsonSchema` 自动生成。
   - 若指令 `risk === 'confirm'`，在 `agentLoop` 中挂起 `status: 'awaiting-confirm'` 等待用户点击「确认执行」或「取消」。
   - 整轮工具执行包裹在 `commandBus.beginTransaction` / `commitTransaction` 中，并提前调用 `createCheckpoint`，支持对话卡片底部「回退本轮」。
3. **UUID 幻觉容错（`resolveAiNodeArgs` / `resolveNodeIdFuzzy`）**：
   - 大模型经常抄错 36 位 UUID 的中间几位或直接传节点中文名。
   - 执行前自动对 `nodeId` / `parentId` / `targetNodeId` / `nodeIds` 及 `script__attach` 中声明为 `ref(node)` 的参数做三段解析：**精确 ID → 唯一节点名称 → 6 位以上唯一 ID 前缀**。
   - 若仍返回 `NOT_FOUND`，自动在工具返回值中附带 `availableNodes`（当前场景节点清单），让 AI 下一轮直接纠偏。

---

## 4. 代码资产、节点引用与属性面板契约

1. **脚本规范与安全校验（`src/core/codeAssets/scriptRuntime.ts`）**：
   - 编译后严格校验默认导出必须经过 `defineBehavior` 或 `defineSystem` 标记（防止普通函数靠 `.name` 绕过）。
   - 支持属性卡片左上角复选框开关控制，状态存在 `node.gameplay.packs.__project__[scriptId].__enabled`；为 `false` 时运行时跳过 `onStart` / `onUpdate` / `onMessage`。
2. **对象引用槽位（`src/core/schema/SchemaForm.tsx`）**：
   - `FieldSchema` 中 `type: 'ref'`（`target: 'node' | 'asset'`）与 `type: 'texture'` 统一渲染为可视化槽位。
   - 支持从层级树/资源面板**拖放赋值**、点击放大镜**弹窗搜索选择（`RefPickerModal`）**、点击名称在视口/属性面板定位、一键清空。
   - 运行时 `scriptRuntime.ts` 会自动将 `target: 'node'` 的参数 ID 解析为 `NodeHandle | null` 注入 `self.params`。

### 4.1 如何给 AI 扩展新的脚本运行时能力（标准 5 步清单）

当遇到「AI 想写某个功能但运行时缺少对应 API」（例如刚补齐的鼠标增量、滚轮、右键检测，或未来的射线检测/物理施力/动画事件）时，按以下 5 步同步扩展，避免“代码实现了但 AI 不知道、或外部编辑器报错”：

1. **视口 / 宿主采集（如涉及底层输入或渲染状态）**：在 `src/runtime/sceneRuntime.ts` 的 `SceneRuntimeHost` 声明接口，并在 `src/editor/viewport/EditorViewport.ts`（以及独立播放器宿主）实现采样。注意若多脚本同帧读取，提供无副作用的 `peek*` 接口并在帧末清零，避免抢占消费。
2. **脚本运行时实现**：在 `src/core/codeAssets/scriptRuntime.ts` 的 `buildScriptContext` 中将能力挂载到 `self.*`（如 `self.input`、`self.physics`、`self.audio`）。
3. **公共契约同步**：更新 `contracts/t3d/runtime.d.ts` 与 `src/core/codeAssets/workspace.ts` 中的 `RUNTIME_DTS_SUMMARY`（生成工程 `.t3d/runtime.d.ts` 给外部 Cursor / VS Code 类型提示）。
4. **告知 AI（System Prompt）**：在 `src/ai/agentLoop.ts` 的 `buildSystemPrompt` 中用简洁明确的一行示例说明该 API 的签名与返回值，确保模型直接使用而不再自行编造。
5. **契约与依赖校验**：运行 `npm run check:contracts` 与 `npm run check:player-deps`，确保 `src/core/` 与 `src/runtime/` 不反向引入 `src/editor/`。

### 4.2 如何给 AI 扩展新的编辑器操作工具（CommandBus）

若需要让 AI 操作新的编辑器能力（如导入资产、批量修改材质、打包导出等）：
1. 在 `src/core/commands/domains/` 对应域注册 `CommandDef`（参数使用 `FieldSchema` 描述）。
2. `src/ai/tools.ts` 的 `buildAiToolSpecs()` 会自动将其映射为 `domain__action` 工具暴露给大模型；仅需在 `toolPhaseLabel()`（`src/ai/agentLoop.ts`）补充一句中文状态提示即可。
3. 若属于只读查询或独立工作流（无需撤销栈），直接加在 `src/ai/tools.ts` 的 `QUERY_TOOLS` 与 `executeAiTool` `switch` 分支中。

### 4.3 范例库（`src/ai/knowledge/recipes.ts`）

Demo 质量的主要杠杆不是更长的提示词，而是**让 AI 从验证过的实现出发**。范例库每条包含：完整脚本源码、场景搭建与挂载步骤、验收用的冒烟步骤、常见坑。系统提示里只放一行目录，正文由 AI 用 `kb__read({ id })` 按需读取。

- 这**不是**积木/拼装系统：范例只是参考源码，AI 读取后用 `script__create` 落成工程里的普通 `.ts` 脚本并按需求改写。
- 新增或修改范例必须同时在 `tests/ai-knowledge.test.ts` 里补用例。该测试会真实编译每份脚本、跑 `lintScriptSource`，并在无头运行时里做行为仿真（移动、射击击杀加分、受击死亡）。**没有通过测试的范例不得入库**——错误的范例比没有范例更糟。
- 发现 AI 反复在某类玩法上摸索时，优先考虑补一条范例，而不是往系统提示里加禁令。

### 4.4 评测与轨迹（`src/ai/evals/`、`src/ai/trace.ts`）

调优必须有数据。任何对系统提示、工具、适配层的改动，都应前后各跑一次评测再下结论。

- **轨迹**：每轮对话结束自动记录到 `<工程>/.t3d/ai-traces.jsonl`，并在控制台打印一行摘要。字段包括每步耗时与 token、缓存命中率、工具调用/失败次数、截断次数、自动返修轮数。
- **评测**：在 Electron 桌面端打开一个**空白测试工程**，开发者工具控制台执行 `await __t3dAiEval.run()`（可传 `{ ids: [...] }` 或 `{ sizes: ['small'] }`）。任务集见 `src/ai/evals/tasks.ts`，覆盖小改动（建节点、改参数、修运行时报错）、单功能（移动、跟随相机、HUD、收集金币）和完整 Demo（俯视角射击）。每个任务有步数预算、静态检查和试玩断言，结果写入 `.t3d/ai-eval-<时间戳>.json`。
- 评测会真实调用当前模型并产生费用；快照回滚不会删除磁盘上的脚本文件，所以只在测试工程里跑。
- 新增能力时同步加一个评测任务；修复一类失败时把它固化成任务，防止回退。

---
## 5. UI 状态反馈与对话持久化

1. **实时执行状态（`agentLoop.ts` + `AiWorkbenchPanel.tsx`）**：
   - `useAgentStore` 维护 `phaseText`、`startedAt` 与 `toolPhaseLabel(toolName)`。
   - 工具调用前先插入 `pending: true` 占位胶囊，执行完毕原地更新为 `✓` / `✕`；当前助手卡片顶部显示旋转指示器 + 实时阶段文案 + `0.1s` 计时器。
   - 全局 CSS 禁用了文本选择，因此对话正文、流式文本与报错信息显式开启了 `userSelect: 'text'`，并提供底栏「复制」按钮。
2. **历史记录存储（`src/ai/historyStorage.ts`）**：
   - 磁盘工程：自动保存至 `<工程根目录>/.t3d/ai-history.json`（不存大体积 `imageDataUrl` 或在导入导出时兼容）。
   - 未保存草稿：存 `localStorage`，一旦用户「另存为」磁盘工程，自动将草稿记录迁移写入新工程目录。
   - 面板右上角提供 `.json` 导入（合并/覆盖）与导出按钮，方便跨设备手动迁移对话。

---

## 6. 已知踩坑与红线清单

- **密钥与请求边界**：API Key 绝不可传入渲染进程或前端 store；所有 LLM / 生成服务请求只能从 `electron/` 主进程发出。
- **单一渲染器**：主视口与材质预览统一使用 `three/webgpu` `WebGPURenderer`（WebGL2 通过 `forceWebGL` 回退），严禁引入第二套 `WebGLRenderer` 或旧版 `EffectComposer`。
- **试玩期性能**：`playState === 'playing'` 期间严禁每帧批量写 `useEditorStore.getState().nodes`；文档修改指令在试玩期必须被拒绝。
- **渲染指标**：`EditorViewport.getRenderMetrics` 统计的是单帧 `drawCalls`，切勿误读 Three.js 累计 `info.render.calls`。
- **路径授权**：重启应用自动恢复最近工程时，读取文件前必须先调用 `electronBridge.fs.authorizeRoot()`。
- **相机 `lookAt` 坐标系陷阱**：Three.js 中普通 `Object3D` 的 `lookAt` 让 `+Z` 朝向目标，而 `PerspectiveCamera` 观察方向是 `-Z`。在 `scriptRuntime.ts` 中对 `node.kind === 'camera'` 调用 `self.lookAt` 时必须反向瞄准镜像点，且 `lookAt` / `moveToward` 需通过 `resolveVec3Input` 同时兼容 `{ x, y, z }` 与 `NodeHandle`。
- **AI 故障排查顺序（遇到“AI 写的脚本跑不通”）**：
  1. 先查 `src/core/codeAssets/scriptRuntime.ts` 与 `src/editor/viewport/EditorViewport.ts` 的宿主适配层（是不是引擎没提供 API、坐标系/单位不一致、或缺少防呆兼容）。
  2. 再查 `contracts/t3d/runtime.d.ts` 与 `src/core/codeAssets/workspace.ts`（类型契约是否同步）。
  3. 最后查 `src/ai/agentLoop.ts` 的 `buildSystemPrompt`（提示词是否明确告知了真实 API 和单位）。
  4. **每次修复完底层坑，务必回写更新本节避坑清单，保持跨设备记忆一致。**
- **不要用提示词禁令修工具缺陷**：AI 反复做某件蠢事（建探测脚本、反复截图、试字段名）时，先问它是不是拿不到该拿的信息。优先让工具把信息返回出来（报错、日志、状态快照、字段清单），而不是在提示词里加一条「严禁」。
- **不要破坏缓存前缀**：系统提示必须完全静态，工具全集常驻；每轮变化的内容只能追加在用户消息尾部的 `<工程上下文>` 里，历史只追加、超预算才原地折叠。往系统提示里插入时间、选中节点等动态内容会让整段缓存失效。
- **契约与运行时不一致**：行为脚本的真实约定是 `state: () => ({})` 与 `onUpdate(self, dt)`，`contracts/t3d/runtime.d.ts` 里的 `createState` / `onStep` 与实现不符；提示词与范例一律以运行时为准，对齐前不要据契约文件写脚本。
- **`physics.raycast` 的 `hit.node` 不可靠**：目前返回的是调用者自身，只有 `distance` 与 `point` 可用。
- **内置组件不在 `packs` 里**：`character` / `cameraFollow` / `interact` / `trigger` / `mover` / `checkpoint` / `score` / `soundSource` 的数据在 `node.gameplay.<组件>`，由 `gameplay.setCoreComponent` 写入；`gameplay.setComponentData` 写到 `packs.core.<同名>` 会被拒绝，因为运行时不读那里。无头测试要驱动内置角色，需显式 `import '../src/runtime/character'`（它以副作用方式注册）。
- **试玩锁包含暂停**：`play.locked` 在 `playState !== 'stopped'` 时都生效，暂停中也不能改工程。调参循环是「`script__patch` → `playtest__run_smoke`」，后者自带启动与退出。
- **相机方位角只能从视线方向算**：`SceneRuntimeHost.yaw()` 必须用相机世界视线的水平投影（`atan2(-fx, -fz)`），不能读 `camera.rotation.y`——欧拉角在有俯仰时会偏，镜头水平转过 90° 后整个翻面。编辑器视口一直是对的，导出播放器（`src/player/main.ts`）曾直接读欧拉角，已修。脚本侧相对相机的移动统一用 `self.input.moveDirection()`（`viewRelativeMove`，与内置 `character` 共用同一个方位角），范例 `third-person-controller` 已改用它。
- **命令行**：Windows PowerShell 环境下多命令用 `;` 分隔，不要用 `&&`。

---

## 7. 后续演进路线与优化方向

### 7.1 下一步（按收益排序）
- **先跑评测建立基线**：当前的循环改造尚未用真实模型跑过 `__t3dAiEval.run()`。先拿到各任务的通过率、步数与缓存命中率，再决定后续投入。
- **扩充范例库**：按评测与真实使用中暴露的短板补充（如物理刚体角色、导航寻路 AI、对话/任务、存档、菜单流程与重开），每条都要有仿真测试。
- **对齐类型契约**：统一 `contracts/t3d/runtime.d.ts`、`RUNTIME_DTS_SUMMARY` 与运行时实现，之后可以让应用内编译器做真正的类型检查，把“调用了不存在的 API”拦在写入时。
- **修 `physics.raycast` 的命中节点**：宿主 `probe` 返回命中节点 ID 后，射击/交互类范例可以改用射线。
- **子代理 / 多 agent 编排**：评测显示单 agent 在大任务上的瓶颈确实是上下文而非信息或工具时再考虑。
### 7.2 阶段 5 规划衔接（参见 `docs/ai-mode-plan.md`）
阶段 4（工作台视图、视口指点、实验分支、全层级能力沉淀）已基本就绪，下一步 **阶段 5** 的核心切入点：
1. **第三方生成能力模块**：在主进程新增生成任务队列与适配器（图片 / 3D 模型 / 动画 / UI），自动附带 `design.md` 风格词，在 `src/ai/tools.ts` 暴露异步生成工具。
2. **资产入库自动规整管线**：生成或导入的模型/贴图入库时，自动执行居中底部原点、米制尺寸归一、超标减面与贴图压缩、生成基础碰撞体。
3. **发布验证闭环**：Web 导出前强制串联「工程体检 + 性能预算守门 + `playtest__run_smoke` 冒烟 + 验证报告生成」。

---

## 8. 开发与验证命令

每次修改 AI、指令层或运行时代码后，建议依次执行以下校验（PowerShell）：

```powershell
npx tsc --noEmit
npm run check:contracts
npm run check:player-deps
npm run test:core
npm run test:phase2
npm run test:phase3
npm run test:phase4
npm run test:ai
```
