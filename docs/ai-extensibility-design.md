# AI 能力扩展层设计（规则 / 技能 / 知识 / 文档约束）

状态：**第一版已实现**（加载器、注入、`design.md` 保留原文、知识面板、需求自动验收）。已实现与未实现的范围见第 8、9 节。

## 1. 目标

让内置 AI 的能力**可见、可组合、可扩展**：

- 能提前定好的稳定规则留在代码里，扩展层无法覆盖。
- 知识、工作方法、项目约束以工程目录下的 Markdown 文件存在，用户能看、能改、能加。
- 每轮对话能看到 AI 实际用了哪些规则与技能。

不做：流程图式编排、多角色协作、向量检索、AI 未经确认自动写入知识库。

## 2. 现状（已核对代码）

已具备、保持不动：

- 工具面由指令层自动生成（`buildAiToolSpecs` ← `commandBus.list()` + `FieldSchema`）。
- `query__registry_describe` 暴露能力包、玩法包、内置组件字段。
- 收尾自动验收 `runAutoVerify`（工程体检 + 1 秒试玩）。
- 系统提示静态可缓存，工程状态走 `buildTurnContext`。
- 范例有真实编译与无头运行测试（`tests/ai-knowledge.test.ts`）。

问题：

1. 系统提示内约 60 行手写 API 手册，与 `contracts/t3d/*.d.ts` 是两份事实来源。
2. 知识库只有 6 条范例，写死在 `src/ai/knowledge/recipes.ts`；`kb__read` 只能按 ID 读。
3. `design.md` 是 9 个固定字段；`parseDesignMarkdown` 只保留这些字段与「补充说明」之后的内容，其余手写内容在下次更新时丢失。
4. **`loadDesignDocFromProject` 没有任何调用方**。磁盘上的 `design.md` 打开工程时不会被读回，手改无效；重启后首次更新会用默认值加补丁覆盖磁盘文件。
5. `project.design.update` 的 `patch` 参数 `FieldSchema` 为空对象，模型只能从描述文字猜字段名。
6. 没有工程级规则、需求文档、技能的加载入口。

第 4、5 条是独立缺陷，在第 1 步一并修复。

## 3. 构件

| 构件 | 何时进入上下文 | 载体 | 本文范围 |
| --- | --- | --- | --- |
| 规则 | 每轮始终注入 | `ai/rules.md`、`design.md` | 第 1 步 |
| 技能 | 目录常驻，正文按需读取 | `ai/skills/<id>/SKILL.md` + 附带文件 | 第 1 步 |
| 知识 | 目录常驻，正文按需读取 | `ai/knowledge/*.md` | 第 1 步 |
| 检查 | 收尾时由代码执行 | `requirements.md` 内的验收断言 | 第 3 步 |
| 命令 | 用户点击触发 | 技能的入口声明 | 第 4 步 |

技能与知识的区别：技能是“怎么做某类事”（步骤 + 参考源码 + 验收方式）；知识是“事实与约定”（术语、数值规范、踩坑记录）。两者加载机制相同，分开只为方便用户组织。

技能是可读可改的参考文本与源码，AI 读取后落成工程里的普通脚本。**不是积木或拼装系统**，与红线一致。

## 4. 来源与目录

三级来源，同 ID 时后者覆盖前者：

1. **内置**：随引擎发布，保留在源码中（见 5.4）。只读，面板提供“复制到工程”。
2. **用户全局**：`<userData>/T3D/ai/`，跨工程复用。该根目录已在主进程 `PathGuard` 白名单内；主进程只新增一个返回该路径的接口 `app:userLibraryRoot`。
3. **工程**：`<工程目录>/ai/`，随工程走。

```
<工程目录>/
  design.md              设计概要（已有，改为自由格式）
  requirements.md        需求与验收条目（第 3 步启用，第 1 步只注入不执行）
  ai/
    rules.md             工程规则，每轮注入
    skills/
      <skill-id>/
        SKILL.md
        *.ts             附带的参考源码
    knowledge/
      <topic>.md
  .t3d/                  机器生成内容（类型定义、快照、对话记录），不放用户编写的内容
```

用户全局目录结构相同（没有 `design.md` 与 `requirements.md`）。

用户编写的内容放可见的 `ai/` 而不是 `.t3d/`，因为 `.t3d/` 现有内容全部是机器生成的。

## 5. 文件格式

### 5.1 `SKILL.md`

```markdown
---
name: 波次刷怪与追击敌人
description: 从隐藏模板节点池化生成敌人，敌人追击并攻击玩家，可被 hit 消息击杀
files:
  - path: ChaseEnemy.ts
    attachTo: 敌人模板节点（隐藏）
  - path: WaveSpawner.ts
    attachTo: 战场中心的空节点
---

## 搭建步骤
1. ...

## 验收
playtest__run_smoke：...

## 常见坑
- ...
```

- 技能 ID 即目录名，限小写字母、数字、连字符。
- `name`、`description` 必填。`description` 进入目录，限 120 字，要写清“什么时候该用”。
- `files` 可选。正文为自由 Markdown，章节名是建议不是强制。
- `command` 可选：知识面板里「使用」按钮填入对话框时显示的名称。
- 头部只支持上述四个键的简单 YAML 子集，自行解析（`src/ai/knowledge/frontmatter.ts`），不引入 YAML 依赖。

### 5.2 `ai/knowledge/*.md`

自由 Markdown。ID 为文件名。目录描述取头部 `description`；没有头部时取第一个标题。

### 5.3 `ai/rules.md`

自由 Markdown，全文每轮注入。上限 4000 字符，超出部分截断并在面板提示。规则应当短，长内容应拆成知识文件。

第 1 步不做作用范围（如“仅写着色器时生效”）。等规则多到需要时再加。

### 5.4 内置技能

内置技能保留为 TS 模块（现有 `recipes.ts` 的形式），在内存中转换为与文件技能相同的结构。

原因：现有测试直接导入范例源码做真实编译与无头运行，Node 测试环境不支持打包器的原始文件导入。保留 TS 形式可让测试不变。

### 5.5 `design.md`

- 内存中保存**原始 Markdown 全文**，注入时原样给模型（上限 8000 字符）。
- 现有 9 个字段行（`- **类型**：…`）继续识别，供工程管理面板显示与编辑。
- `project.design.update` 只替换对应字段行，其他内容逐字保留；新增 `appendNotes` 用于追加自由内容。
- 每轮 AI 对话开始前、打开工程管理的设计页时、执行设计读取与更新指令前，都调用 `loadDesignDocFromProject` 从磁盘读回（修复第 2 节第 4 条）。
- `patch` 参数补全 `FieldSchema` 字段（修复第 5 条）。

### 5.6 `requirements.md`

存在则全文注入（上限 8000 字符），系统提示要求中大型任务收尾时逐条对照。

可机检的验收项写成 `t3d-check` 代码块，内容是 JSON，`steps` 与 AI 工具 `playtest__run_smoke` 的步骤同构：

````markdown
```t3d-check
{
  "name": "向前移动",
  "steps": [
    { "action": "input", "events": [{ "type": "axis", "action": "Move", "x": 0, "y": 1 }] },
    { "action": "step", "seconds": 1 },
    { "action": "assert", "condition": { "kind": "nodeMoved", "nodeIdOrName": "主角", "from": [0, 0, 0], "minDistance": 1 } }
  ]
}
```
````

- AI 改过工程后，收尾自动验收（`runAutoVerify`）逐条执行这些块；断言失败或出现运行时报错即视为未通过，结果回灌给 AI 返修，最多两轮。
- 最多执行前 8 个块。写错的块（非法 JSON、缺 `steps`）不执行，在知识面板里提示。
- 系统提示明确禁止 AI 通过修改 `requirements.md` 让验收通过；AI 也没有写该文件的工具。

## 6. 加载与注入

- **内置技能目录**：留在系统提示（静态，保持提示缓存命中）。
- **用户与工程的规则、技能目录、知识目录、`design.md`、`requirements.md`**：走 `buildTurnContext`，与现有 `design.md` 注入方式一致。
- 目录每条一行：`- <id>：<description>（来源）`。用户与工程条目合计上限 60 条。
- 扫描时机：打开工程时、每轮开始时。每轮重新扫描保证用户改完文件立即生效。
- 草稿工程（无目录）：只有内置与用户全局两级。

`kb__read` 扩展：

- `kb__read({ id })`：返回 `{ id, kind, source, title, summary, guide, files }`。`guide` 是正文 Markdown；附带源码在 40000 字符预算内直接内联在 `files[].source`，超出的只列路径。
- `kb__read({ id, file })`：返回某个附带文件的源码。
- ID 不存在或已停用时返回全部可用条目。

工具名不变，只新增可选参数 `file`。注意内置范例的返回结构从原来的 `setup / verify / pitfalls` 数组变成了统一的 `guide` 正文。

停用：用户与工程条目可在知识面板里停用（记录在本机 `localStorage`）。内置条目不可停用，因为其目录在静态系统提示里；要替换内置条目，在工程里放一个同 ID 的技能即可。

## 7. 优先级与安全

- 优先级：内核（代码）> 工程规则 > 用户全局规则 > 技能 > 知识。系统提示中明确写出。
- 扩展层只能增加知识，不能扩权。高风险指令确认、试玩期拒绝修改、指令参数校验都在代码中强制，不受提示内容影响。
- 路径安全：读取限定在 `ai/` 目录内，附带文件路径不得包含 `..` 或绝对路径。
- 将来技能随第三方包分发时，属于提示注入入口，安装时需展示内容并由用户确认。

## 8. 已实现

代码位置：

- `src/ai/knowledge/types.ts`：统一结构与长度上限。
- `src/ai/knowledge/frontmatter.ts`：头部解析。
- `src/ai/knowledge/loader.ts`：三级来源扫描、合并覆盖、路径安全、上下文文本生成。不依赖 Electron，文件系统可注入。
- `src/ai/knowledge/store.ts`：接到当前工程目录与用户目录，保存最近一次扫描结果与停用列表。
- `src/ai/knowledge/recipes.ts`：内置范例转换为统一结构，范例内容未改。
- `src/ai/KnowledgeDrawer.tsx`：知识面板与每轮注入提示行。
- `src/ai/tools.ts`：`kb__read` 走加载器，新增 `file` 参数。
- `src/ai/agentLoop.ts`：每轮开始前重读 `design.md` 与扩展层并注入；系统提示新增【扩展层】段；`runAutoVerify` 执行 `t3d-check`；轮次记录 `context` 与 `checks`。
- `src/ai/trace.ts`：轨迹新增 `knowledge`（注入了什么）与 `knowledgeReads`（实际读了哪些条目）。
- `src/core/project/designMemory.ts`：保留原文，按行替换字段，新增 `appendNotes`。
- `src/core/commands/domains/pictureAndProject.ts`：`project.design.update` 补全字段说明；读取与更新前先从磁盘读回。
- `electron/main.ts`、`electron/preload.ts`：新增 `app:userLibraryRoot`，让渲染进程知道用户全局目录位置。
- `tests/ai-knowledge-loader.test.ts`：解析、覆盖顺序、路径安全、截断、验收块解析、`design.md` 原文保留。

界面：

- AI 面板标题栏的书本按钮打开知识面板：列出四份常驻文档的状态（可创建、可打开）、三级来源的技能与知识（可停用、可打开、可复制到工程、可填入对话框）、上一轮实际注入的内容。
- 每条助手回复上方有一行蓝色提示，显示本轮注入的规则、需求文档、目录条数和需求验收通过数。AI 读取某个技能时，操作列表里会出现「查阅技能：…」。

## 9. 未实现

- **规则的作用范围**（如只在写着色器时生效）。
- **技能并入包格式**：技能、范例、评测随包分发与安装确认。
- **系统提示瘦身**：把手写 API 段改为由 `contracts/t3d/*.d.ts` 生成或拆成按需技能。需要先扩充大任务评测并做前后对比。
- **技能附带源码的加载期编译检查**：内置范例有编译与运行测试，用户技能目前只检查头部与文件是否存在。
- **检索**：条目多了以后的关键词搜索。目前靠目录描述。
- **独立验收子代理**。

