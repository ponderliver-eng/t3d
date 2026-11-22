# T3D AI 模块开发与维护指南（AI Dev Guide）

> 本文档面向后续在不同设备或新会话中继续开发、调优 T3D 内置 AI 系统的开发者与 AI 助手。开始修改 AI 相关代码前，请先阅读本文档与 `.cursor/rules/t3d-core-architecture.mdc`。

---

## 1. 模块架构与文件地图

T3D 的 AI 系统横跨「主进程代理 → 渲染进程状态循环 → 核心指令与查询层 → 编辑器面板」四层：

| 层级 | 文件路径 | 核心职责 |
|---|---|---|
| **主进程（模型与密钥）** | `electron/services/modelProviders.ts` | 统一适配器（`openai-compatible` / `openai` / `anthropic` / `gemini`），流式增量推送（`delta`）与工具调用解析 |
| | `electron/services/secretStore.ts` | 使用 Electron `safeStorage` 加密存储各 Provider 的 API Key，密钥永不进入渲染进程 |
| | `electron/services/pathGuard.ts` | 工程目录访问白名单校验（重启恢复工程时需先 `authorizeRoot`） |
| **AI 运行循环** | `src/ai/agentLoop.ts` | `useAgentStore`、多步工具推理循环（`MAX_TOOL_STEPS = 16`）、System Prompt 构建、历史消息裁剪、每轮 Checkpoint 自动备份与回退 |
| | `src/ai/tools.ts` | `buildAiToolSpecs()` 工具声明、`executeAiTool()` 执行分发、`resolveAiNodeArgs()` 节点 ID/名称容错解析 |
| | `src/ai/historyStorage.ts` | 对话记录持久化（磁盘工程存 `.t3d/ai-history.json`，草稿存 `localStorage`，另存工程时自动迁移）与 JSON 导入导出 |
| | `src/ai/AiWorkbenchPanel.tsx` | 右侧/悬浮 AI 指挥台 UI：实时阶段提示与计时、流式输出、动作胶囊、划词/一键复制、高风险确认、模型配置抽屉 |
| **核心底座（AI 读写边界）** | `src/core/commands/` | 所有修改工程状态的指令注册中心（`commandBus`），AI 严禁直接修改 `useEditorStore` |
| | `src/core/query/` | `queryProjectOverview`、`querySceneOutline`、`queryNodeInspect`、`diagnoseProject` 等只读查询 |
| | `src/core/schema/fieldSchema.ts` & `SchemaForm.tsx` | 统一字段 Schema（支持校验、JSON Schema 生成、`NodeRefControl` / `AssetRefControl` 拖放与弹窗选择） |
| | `src/core/codeAssets/` | 脚本（`scriptRuntime.ts`）与着色器（`shaderRuntime.ts`）的编译、热重载与运行时执行 |
| **视口指点交互** | `src/editor/viewport/ViewportPanel.tsx` | `Ctrl/Cmd + K` 就地指令框、视口画笔圈选批注截图（作为 `imageDataUrl` 发送给 AI） |

---

## 2. 上下文工程与 Token 控制（`src/ai/agentLoop.ts`）

大模型本身无状态，每次调用 `ai.chat` 的上下文质量与成本由以下 4 项机制共同决定：

### 2.1 System Prompt 注入（`buildSystemPrompt`）
每轮推理动态拼装：
1. **核心原则**：严禁编造 ID、改完场景必调 `query__project_diagnose`、优先 `snapToGround: true`、查询登记清单优先按具体 `category` 而不是全量 `all`。
2. **脚本 API 强约束**（防止模型自行编造全局变量）：
   - 必须从 `"t3d/runtime"` 导入 `defineBehavior`。
   - 位置/旋转/缩放必须**整体赋值**（`self.position = { x, y, z }`），禁止 `self.position.x = ...`。
   - 输入通过 `self.input.axis2D("Move")`、`self.input.isPressed(...)`、`self.input.isKeyPressed("KeyW")` 读取。
   - 节点/资产引用参数必须声明为 `{ type: "ref", target: "node" | "asset", label, default: null }`。
3. **持久化记忆**：`design.md` 全文（`getDesignDoc()`）+ `queryProjectOverview()`。
4. **场景节点索引**：直接附上当前场景前 30 个节点的 `name (kind): id`，减少 `query__scene_outline` 往返。
5. **选中节点快照**：用户 `@` 或在视口选中的节点，直接内嵌 `id / name / kind / parentId / position / assetId / packs / capabilities`，跳过一次 `query__node_inspect`。

### 2.2 跨轮历史裁剪（`buildHistoryMessages`）
- **动态预算**：从最新往回取，最多保留 **24 条**、总字符上限 **18,000**（至少保底 4 条）。
- **跨轮动作记忆**：过滤掉纯报错轮次，并将每轮 `assistant` 的 `actions` 压缩成一行摘要（如 `[本轮已执行操作: ✓ 新建脚本 ...]`）附在消息末尾，避免下一轮 AI 忘记刚创建的脚本路径或节点 ID。

### 2.3 单轮多步工具折叠（`compactMessagesForStep`）
- 在 `for (step = 0..MAX_TOOL_STEPS)` 循环中，若历史消息不断累积，`query__registry_describe(all)` 等大段 JSON 会在每一步被重复计费。
- `compactMessagesForStep` 只保留**最近 2 轮工具调用**的完整返回，更早步骤中超过 800 字符的 `tool` 消息自动折叠为占位提示。

### 2.4 工具域按需分类与自动激活（`src/ai/tools.ts` + `src/ai/agentLoop.ts`）
为避免每轮请求把 ~56 个工具的 JSON Schema 全量塞入上下文导致高 Token 消耗，工具集划分为 `core`（常驻）+ 5 个按需专业域：
- `core`（常驻）：基础查询（`query__*`）、节点/场景增删改、资源、脚本挂载、`tools__enable_domain`。
- `script`：脚本创建/读写/校验。
- `shader`：着色器与材质、资产目录整理。
- `ui`：UI 屏幕、HUD 绑定与输入动作配置。
- `capability`：工程级与节点级能力包（`physics` / `navigation` / `spline` / `tween` / `crowd` / `projectile` / `water` / `sky` / `particles` / `buoyancy`）、玩法包、数据表、环境参数。
- `playtest`：自动试玩、冒烟测试、视口截图、实验分支、多场景与导出。

**激活方式是「自动预开 + 运行中按需自开」双重机制（无需用户手动开关）**：
1. **自动预开（`inferInitialToolDomains`）**：发送消息时根据用户提示词关键字与 `@` 引用类型自动识别并预开相关域（如提到“做个游戏”会预开全部核心域；提到“样条/弹道/群体”自动预开 `capability` 域）。
2. **AI 自助按需开启（`tools__enable_domain`）**：对于未预开的域，System Prompt 会附带一份简短索引；AI 若判断需要某个域，会在推理第一步主动调用 `tools__enable_domain({ domains: [...] })`，下一轮循环立即解锁该域工具与对应的 API 速查。

> 注意：这里的「工具域」控制的是**AI 能不能看到工具**；而工程里的**能力包本身（`capabilities`）**，默认常用的（`physics` / `navigation` / `spline` / `tween` / `crowd` / `projectile` / `buoyancy`）已开启，重型环境能力（`water` / `sky` / `particles`）默认关闭，用户可在 **项目设置（ProjectSettingsDialog）** 手动开关，AI 也可在开启 `capability` 域后通过 `capability__setEnabled` 自动开关。

---

## 3. 工具执行与防幻觉机制（`src/ai/tools.ts`）

1. **只读查询工具（`QUERY_TOOLS`）**：不走 `commandBus`，不触发撤回事务，直接读取当前状态或运行冒烟测试（`playtest__run_smoke`、`playtest__capture`）。
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
- **Shell 命令规范**：Windows PowerShell 环境下多命令用 `;` 分隔，不要用 `&&`。

---

## 7. 后续演进路线与优化方向

### 7.1 立即可做的 AI 体验打磨
- **按需注入 Shader API 规范**：当前 `buildSystemPrompt` 重点约束了脚本 API；若后续高频让 AI 写复杂 TSL Shader，可在 `shader__create` / `buildSystemPrompt` 补充 `t3d/shader` 的常用节点示例与白名单说明。
- **单步工具结果摘要化**：针对 `query__registry_describe` 等大数据查询，除截断外，可按类别返回精简索引，进一步压低多轮对话的 Token 消耗。
- **Markdown 富文本渲染**：目前对话气泡使用 `whiteSpace: 'pre-wrap'` 纯文本渲染，后续可接入轻量 Markdown 渲染（支持代码块高亮与独立复制按钮）。

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
```
