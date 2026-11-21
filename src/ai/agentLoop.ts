import { create } from 'zustand'
import { commandBus } from '../core/commands/bus'
import { createCheckpoint, formatDesignMarkdown, getDesignDoc, restoreCheckpoint } from '../core/project'
import { queryProjectOverview } from '../core/query'
import { electronBridge } from '../editor/project/electronBridge'
import { useEditorStore } from '../editor/scene/store'
import { initAiHistorySync, saveAiHistory } from './historyStorage'
import { buildAiToolSpecs, executeAiTool, isConfirmRequiredTool } from './tools'

export interface AiActionPill {
  id: string
  toolName: string
  label: string
  ok: boolean
  pending?: boolean
  targetNodeId?: string
  detail?: unknown
}

export interface AiTurnItem {
  id: string
  role: 'user' | 'assistant'
  text: string
  imageDataUrl?: string
  refs?: Array<{ kind: 'node'; id: string; label: string }>
  actions?: AiActionPill[]
  checkpointId?: string
  usage?: { inputTokens?: number; outputTokens?: number; model?: string }
  error?: string
}

export interface PendingConfirmation {
  toolName: string
  label: string
  args: Record<string, unknown>
  resolve: (approved: boolean) => void
}

interface ProviderInfo {
  id: string
  providerType: 'openai-compatible' | 'openai' | 'anthropic' | 'gemini'
  label: string
  baseUrl: string
  model: string
  hasApiKey: boolean
}

interface AgentState {
  panelOpen: boolean
  quickPromptOpen: boolean
  pendingAttachmentImage: string | null
  status: 'idle' | 'running' | 'awaiting-confirm'
  phaseText: string
  startedAt: number | null
  activeRequestId: string | null
  streamingText: string
  turns: AiTurnItem[]
  providers: ProviderInfo[]
  activeProviderId: string
  pendingConfirm: PendingConfirmation | null
  activeNodeIds: string[]

  setPanelOpen: (open: boolean) => void
  setQuickPromptOpen: (open: boolean) => void
  setPendingAttachmentImage: (dataUrl: string | null) => void
  refreshProviders: () => Promise<void>
  saveProvider: (input: {
    id: string
    providerType?: ProviderInfo['providerType']
    label?: string
    baseUrl?: string
    model?: string
    apiKey?: string
    setActive?: boolean
  }) => Promise<void>
  setActiveProvider: (id: string) => Promise<void>
  sendPrompt: (text: string) => Promise<void>
  abort: () => Promise<void>
  rollbackTurn: (checkpointId: string) => void
  clearTurns: () => void
  importTurns: (imported: AiTurnItem[], mode?: 'merge' | 'replace') => void
}

const MAX_TOOL_STEPS = 16

export const useAgentStore = create<AgentState>((set, get) => ({
  panelOpen: false,
  quickPromptOpen: false,
  pendingAttachmentImage: null,
  status: 'idle',
  phaseText: '',
  startedAt: null,
  activeRequestId: null,
  streamingText: '',
  turns: [],
  providers: [],
  activeProviderId: 'openai-compatible',
  pendingConfirm: null,
  activeNodeIds: [],

  setPanelOpen: (open) => set({ panelOpen: open }),
  setQuickPromptOpen: (open) => set({ quickPromptOpen: open }),
  setPendingAttachmentImage: (dataUrl) => set({ pendingAttachmentImage: dataUrl }),

  refreshProviders: async () => {
    const ai = electronBridge()?.ai
    if (!ai) return
    const res = await ai.listProviders()
    set({
      activeProviderId: res.activeProviderId,
      providers: res.providers,
    })
  },

  saveProvider: async (input) => {
    const ai = electronBridge()?.ai
    if (!ai) return
    const res = await ai.saveProvider(input)
    set({
      activeProviderId: res.activeProviderId,
      providers: res.providers as ProviderInfo[],
    })
  },

  setActiveProvider: async (id) => {
    const ai = electronBridge()?.ai
    if (!ai) return
    const active = await ai.setActiveProvider(id)
    set({ activeProviderId: active })
  },

  abort: async () => {
    const reqId = get().activeRequestId
    const pending = get().pendingConfirm
    if (pending) {
      pending.resolve(false)
      set({ pendingConfirm: null })
    }
    if (reqId) {
      await electronBridge()?.ai?.abort(reqId)
    }
    set({ status: 'idle', phaseText: '', startedAt: null, activeRequestId: null, activeNodeIds: [] })
  },

  rollbackTurn: (checkpointId) => {
    const res = restoreCheckpoint(checkpointId)
    if (!res.ok) {
      useEditorStore.getState().notify(res.error ?? '回退失败')
      return
    }
    useEditorStore.getState().notify(`已回退到「${res.summary?.label ?? checkpointId}」`)
  },

  clearTurns: () => {
    set({ turns: [], streamingText: '' })
    void saveAiHistory([])
  },

  importTurns: (imported, mode = 'merge') => {
    const next = mode === 'replace'
      ? imported
      : (() => {
          const existing = get().turns
          const seen = new Set(existing.map((t) => t.id))
          return [...existing, ...imported.filter((t) => !seen.has(t.id))]
        })()
    set({ turns: next })
    void saveAiHistory(next)
  },

  sendPrompt: async (rawText) => {
    const text = rawText.trim()
    if (!text || get().status !== 'idle') return

    const ai = electronBridge()?.ai
    if (!ai) {
      set((s) => ({
        turns: [
          ...s.turns,
          { id: `u_${Date.now()}`, role: 'user', text },
          {
            id: `a_${Date.now()}`,
            role: 'assistant',
            text: '',
            error: '当前运行在纯浏览器预览模式，模型请求需在 Electron 桌面端中从主进程发出。',
          },
        ],
      }))
      void saveAiHistory(get().turns)
      return
    }

    const editorState = useEditorStore.getState()
    const selectedRefs = editorState.selection
      .map((id) => editorState.nodes[id])
      .filter(Boolean)
      .map((n) => ({ kind: 'node' as const, id: n.id, label: n.name }))

    const attachedImage = get().pendingAttachmentImage ?? undefined
    if (attachedImage) set({ pendingAttachmentImage: null })

    const userTurn: AiTurnItem = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
      imageDataUrl: attachedImage,
      refs: selectedRefs.length > 0 ? selectedRefs : undefined,
    }

    const checkpoint = await createCheckpoint(`AI 轮次前：${text.slice(0, 24)}`)
    const assistantId = `a_${Date.now() + 1}`

    set((s) => ({
      status: 'running',
      phaseText: '正在分析需求与工程上下文…',
      startedAt: Date.now(),
      streamingText: '',
      turns: [
        ...s.turns,
        userTurn,
        { id: assistantId, role: 'assistant', text: '', actions: [], checkpointId: checkpoint.id },
      ],
    }))

    const systemPrompt = buildSystemPrompt(selectedRefs)
    const tools = buildAiToolSpecs()
    const chatMessages: Array<
      | { role: 'user'; text: string }
      | { role: 'assistant'; text: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
      | { role: 'tool'; toolCallId: string; name: string; content: string }
    > = [
      ...get().turns
        .filter((t) => t.id !== assistantId && !t.error && t.text)
        .slice(-8)
        .map((t) => ({ role: t.role, text: t.text })),
    ]

    commandBus.beginTransaction(`AI：${text.slice(0, 32)}`)
    const actions: AiActionPill[] = []
    let finalText = ''
    let totalIn = 0
    let totalOut = 0
    let usedModel = ''
    let txCommitted = false

    try {
      for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
        if (get().status === 'idle') break
        const reqId = `req_${Date.now()}_${step}`
        set({
          activeRequestId: reqId,
          streamingText: '',
          phaseText: step === 0 ? '正在思考方案…' : `正在思考下一步（第 ${step + 1} 轮）…`,
        })

        const unsub = ai.onDelta((delta) => {
          if (delta.requestId !== reqId) return
          if (delta.type === 'text' && delta.text) {
            set((s) => ({
              phaseText: '正在输出思路与说明…',
              streamingText: s.streamingText + delta.text,
            }))
          }
        })

        let result: Awaited<ReturnType<typeof ai.chat>>
        try {
          result = await ai.chat(reqId, {
            providerId: get().activeProviderId,
            system: systemPrompt,
            messages: chatMessages,
            tools,
          })
        } finally {
          unsub()
          set({ activeRequestId: null })
        }

        usedModel = result.model
        totalIn += result.usage?.inputTokens ?? 0
        totalOut += result.usage?.outputTokens ?? 0
        if (result.text) {
          finalText = finalText ? `${finalText}\n${result.text}` : result.text
          set((s) => ({
            turns: s.turns.map((t) =>
              t.id === assistantId ? { ...t, text: finalText } : t,
            ),
          }))
        }

        if (result.toolCalls.length === 0) {
          break
        }

        chatMessages.push({
          role: 'assistant',
          text: result.text,
          toolCalls: result.toolCalls,
        })

        for (const tc of result.toolCalls) {
          if (isConfirmRequiredTool(tc.name)) {
            const approved = await new Promise<boolean>((resolve) => {
              set({
                status: 'awaiting-confirm',
                phaseText: `等待确认：${tc.name.replace(/__/g, '.')}`,
                pendingConfirm: {
                  toolName: tc.name,
                  label: `允许执行高风险指令 ${tc.name.replace(/__/g, '.')}？`,
                  args: tc.arguments,
                  resolve,
                },
              })
            })
            set({ status: 'running', pendingConfirm: null })
            if (!approved) {
              chatMessages.push({
                role: 'tool',
                toolCallId: tc.id,
                name: tc.name,
                content: JSON.stringify({ ok: false, message: '用户取消了该高风险操作' }),
              })
              continue
            }
          }

          const phase = toolPhaseLabel(tc.name)
          set({ phaseText: phase })
          const pendingPill: AiActionPill = {
            id: tc.id,
            toolName: tc.name,
            label: phase,
            ok: true,
            pending: true,
          }
          set((s) => ({
            turns: s.turns.map((t) =>
              t.id === assistantId ? { ...t, actions: [...actions, pendingPill] } : t,
            ),
          }))

          const execRes = await executeAiTool(tc.name, tc.arguments)
          if (execRes.targetNodeId) {
            set({ activeNodeIds: [execRes.targetNodeId] })
          }
          actions.push({
            id: tc.id,
            toolName: tc.name,
            label: execRes.displayLabel,
            ok: execRes.ok,
            pending: false,
            targetNodeId: execRes.targetNodeId,
            detail: execRes.data,
          })
          set((s) => ({
            turns: s.turns.map((t) =>
              t.id === assistantId ? { ...t, actions: [...actions] } : t,
            ),
          }))

          const serialized = JSON.stringify(execRes.data)
          chatMessages.push({
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: serialized.length > 6000
              ? `${serialized.slice(0, 6000)}...(结果已截断，请使用具体查询工具获取细节)`
              : serialized,
          })
        }
      }

      commandBus.commitTransaction()
      txCommitted = true
      set((s) => ({
        status: 'idle',
        phaseText: '',
        startedAt: null,
        streamingText: '',
        activeNodeIds: [],
        turns: s.turns.map((t) =>
          t.id === assistantId
            ? {
                ...t,
                text: finalText || (actions.length > 0 ? '已完成本轮操作。' : ''),
                actions,
                usage: { inputTokens: totalIn, outputTokens: totalOut, model: usedModel },
              }
            : t,
        ),
      }))
      void saveAiHistory(get().turns)
    } catch (error) {
      if (!txCommitted && commandBus.hasActiveTransaction()) {
        await commandBus.rollbackTransaction()
      }
      const msg = error instanceof Error ? error.message : String(error)
      set((s) => ({
        status: 'idle',
        phaseText: '',
        startedAt: null,
        streamingText: '',
        activeNodeIds: [],
        turns: s.turns.map((t) =>
          t.id === assistantId ? { ...t, text: finalText, actions, error: msg } : t,
        ),
      }))
      void saveAiHistory(get().turns)
    }
  },
}))

initAiHistorySync(
  () => useAgentStore.getState().turns,
  (turns) => useAgentStore.setState({ turns }),
)

function toolPhaseLabel(toolName: string): string {
  if (toolName.startsWith('script__')) return '正在生成 / 编译脚本…'
  if (toolName.startsWith('shader__')) return '正在生成 / 编译着色器…'
  if (toolName.startsWith('scene__')) return '正在搭建 / 修改场景节点…'
  if (toolName.startsWith('asset__')) return '正在处理材质与资产…'
  if (toolName.startsWith('gameplay__') || toolName.startsWith('capability__')) return '正在配置玩法与能力包…'
  if (toolName === 'query__project_diagnose') return '正在执行工程体检与性能预算检查…'
  if (toolName.startsWith('query__')) return '正在读取工程信息…'
  if (toolName.startsWith('playtest__')) return '正在执行试玩冒烟验证…'
  if (toolName.startsWith('pack__')) return '正在处理能力包…'
  if (toolName.startsWith('branch__')) return '正在切换 / 管理实验分支…'
  if (toolName.startsWith('project__')) return '正在更新工程配置…'
  return `正在执行 ${toolName.replace(/__/g, '.')}…`
}

function buildSystemPrompt(selectedRefs: Array<{ id: string; label: string }>): string {
  const designMd = formatDesignMarkdown(getDesignDoc())
  const overview = JSON.stringify(queryProjectOverview())
  const selectedText = selectedRefs.length > 0
    ? `\n当前用户在视口中选中的节点：\n${selectedRefs.map((r) => `- ${r.label} (id: ${r.id})`).join('\n')}`
    : ''

  return [
    '你是 T3D 游戏工程管理器的内置 AI 创作助手。',
    '核心原则：',
    '1. 只能通过提供的工具读取或修改工程数据，不要编造不存在的节点 ID 或资产 ID。',
    '2. 搭完或修改完场景后，务必调用 query__project_diagnose 做一次工程体检并修正错误。',
    '3. 若是新建游戏项目或需求发生方向变化，先用 project__design__update 维护 design.md 全局规范。',
    '4. 放置模型或物体到地面时，优先开启 snapToGround: true。',
    '5. 编写节点行为脚本（script__create / script__update）时，必须从 "t3d/runtime" 导入 defineBehavior，并严格使用：',
    '   export default defineBehavior({ name: "简短中文标题", description: "一句话介绍脚本作用（将展示在组件卡片下方）", params: { ... }, onUpdate(self, dt) { ... } })',
    '   脚本内置 API（严禁自己编造 window.__t3dKeys 等全局变量）：',
    '   - 移动/旋转/缩放：必须整体赋值（如 self.position = { x, y, z }，self.rotation = { x, y, z }），不要写 self.position.x = ...。',
    '   - 输入（WASD/方向键/手柄/触控）：用 const move = self.input.axis2D("Move")（返回 { x, y }，W/↑ 为 y=+1，D/→ 为 x=+1）；也可用 self.input.isPressed("Jump" | "KeyW" | "Space") / self.input.justPressed(...) / self.input.isKeyPressed("KeyW")。',
    '   - 节点查找与跟随：self.findNodeById(id)、self.findNodesByTag(tag)、self.moveToward(target, maxDist)、self.lookAt(target)。',
    '6. 编写自定义着色器后，可用 shader__bind 绑定到指定材质或节点。',
    '',
    '当前工程设计规范（design.md）：',
    designMd,
    '',
    `当前工程概览：${overview}${selectedText}`,
  ].join('\n')
}
