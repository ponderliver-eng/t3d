import { create } from 'zustand'
import { commandBus } from '../core/commands/bus'
import { createCheckpoint, formatDesignMarkdown, getDesignDoc, restoreCheckpoint } from '../core/project'
import { queryProjectOverview } from '../core/query'
import { electronBridge } from '../editor/project/electronBridge'
import { useEditorStore } from '../editor/scene/store'
import { buildAiToolSpecs, executeAiTool, isConfirmRequiredTool } from './tools'

export interface AiActionPill {
  id: string
  toolName: string
  label: string
  ok: boolean
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
}

const MAX_TOOL_STEPS = 16

export const useAgentStore = create<AgentState>((set, get) => ({
  panelOpen: false,
  quickPromptOpen: false,
  pendingAttachmentImage: null,
  status: 'idle',
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
    set({ status: 'idle', activeRequestId: null, activeNodeIds: [] })
  },

  rollbackTurn: (checkpointId) => {
    const res = restoreCheckpoint(checkpointId)
    if (!res.ok) {
      useEditorStore.getState().notify(res.error ?? '回退失败')
      return
    }
    useEditorStore.getState().notify(`已回退到「${res.summary?.label ?? checkpointId}」`)
  },

  clearTurns: () => set({ turns: [], streamingText: '' }),

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
        set({ activeRequestId: reqId, streamingText: '' })

        const unsub = ai.onDelta((delta) => {
          if (delta.requestId !== reqId) return
          if (delta.type === 'text' && delta.text) {
            set((s) => ({ streamingText: s.streamingText + delta.text }))
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

          const execRes = await executeAiTool(tc.name, tc.arguments)
          if (execRes.targetNodeId) {
            set({ activeNodeIds: [execRes.targetNodeId] })
          }
          actions.push({
            id: tc.id,
            toolName: tc.name,
            label: execRes.displayLabel,
            ok: execRes.ok,
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
    } catch (error) {
      if (!txCommitted && commandBus.hasActiveTransaction()) {
        await commandBus.rollbackTransaction()
      }
      const msg = error instanceof Error ? error.message : String(error)
      set((s) => ({
        status: 'idle',
        streamingText: '',
        activeNodeIds: [],
        turns: s.turns.map((t) =>
          t.id === assistantId ? { ...t, text: finalText, actions, error: msg } : t,
        ),
      }))
    }
  },
}))

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
    '',
    '当前工程设计规范（design.md）：',
    designMd,
    '',
    `当前工程概览：${overview}${selectedText}`,
  ].join('\n')
}
