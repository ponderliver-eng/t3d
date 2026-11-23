import { create } from 'zustand'
import { commandBus } from '../core/commands/bus'
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { createCheckpoint, formatDesignMarkdown, getDesignDoc, restoreCheckpoint } from '../core/project'
import { diagnoseProject, queryNodeInspect, queryProjectOverview } from '../core/query'
import { useAssetStore } from '../editor/assets/library'
import { electronBridge } from '../editor/project/electronBridge'
import { useEditorStore } from '../editor/scene/store'
import { clearInflightBackup, initAiHistorySync, saveAiHistory, saveInflightBackup } from './historyStorage'
import { formatRecipeIndexForPrompt } from './knowledge/recipes'
import {
  buildAiToolSpecs,
  executeAiTool,
  isConfirmRequiredTool,
  registerTaskPlanUpdater,
  type AiTaskPlanItem,
} from './tools'
import { finalizeAiTrace, recordAiTrace, summarizeAiTrace, type AiTraceDraft } from './trace'
import { PlaytestSession, summarizeRuntimeLogs } from '../playtest/session'

export interface AiActionPill {
  id: string
  toolName: string
  label: string
  ok: boolean
  pending?: boolean
  targetNodeId?: string
  targetAssetId?: string
  detail?: unknown
}

export interface AiRefItem {
  kind: 'node' | 'asset' | 'script' | 'shader'
  id: string
  label: string
  subKind?: string
}

export interface AiTurnItem {
  id: string
  role: 'user' | 'assistant'
  text: string
  imageDataUrl?: string
  refs?: AiRefItem[]
  actions?: AiActionPill[]
  checkpointId?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    /** 输入中命中提示缓存的 token 数 */
    cachedTokens?: number
    model?: string
    steps?: number
    durationMs?: number
  }
  error?: string
  stopReason?: 'completed' | 'max-steps' | 'paused-with-plan' | 'interrupted'
  pendingTasksCount?: number
  inProgress?: boolean
}

export interface PendingConfirmation {
  toolName: string
  label: string
  args: Record<string, unknown>
  resolve: (approved: boolean) => void
}

export interface SteerItem {
  text: string
  imageDataUrl?: string
  refs?: AiRefItem[]
}

export interface ProviderInfo {
  id: string
  providerType: 'openai-compatible' | 'openai' | 'anthropic' | 'gemini'
  label: string
  baseUrl: string
  model: string
  models?: string[]
  hasApiKey: boolean
}

interface AgentState {
  panelOpen: boolean
  panelScrollTop: number
  panelScrollEpoch: number
  quickPromptOpen: boolean
  pendingAttachmentImage: string | null
  pendingRefs: AiRefItem[]
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
  steerQueue: SteerItem[]
  taskPlan: AiTaskPlanItem[]

  setPanelOpen: (open: boolean) => void
  setPanelScrollTop: (scrollTop: number) => void
  restorePanelWorkspace: (open: boolean, scrollTop: number) => void
  setQuickPromptOpen: (open: boolean) => void
  setPendingAttachmentImage: (dataUrl: string | null) => void
  addPendingRef: (ref: AiRefItem) => void
  removePendingRef: (kind: AiRefItem['kind'], id: string) => void
  clearPendingRefs: () => void
  clearTaskPlan: () => void
  refreshProviders: () => Promise<void>
  saveProvider: (input: {
    id: string
    providerType?: ProviderInfo['providerType']
    label?: string
    baseUrl?: string
    model?: string
    models?: string[]
    apiKey?: string
    setActive?: boolean
  }) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
  setActiveProvider: (id: string, model?: string) => Promise<void>
  sendPrompt: (text: string) => Promise<void>
  abort: () => Promise<void>
  rollbackTurn: (checkpointId: string) => void
  clearTurns: () => void
  deleteTurn: (turnId: string) => void
  importTurns: (imported: AiTurnItem[], mode?: 'merge' | 'replace') => void
}

const MAX_TOOL_STEPS = 40

export const useAgentStore = create<AgentState>((set, get) => ({
  panelOpen: false,
  panelScrollTop: 0,
  panelScrollEpoch: 0,
  quickPromptOpen: false,
  pendingAttachmentImage: null,
  pendingRefs: [],
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
  steerQueue: [],
  taskPlan: [],

  setPanelOpen: (open) => set({ panelOpen: open }),
  setPanelScrollTop: (scrollTop) => {
    const safe = Number.isFinite(scrollTop) ? Math.max(0, Math.round(scrollTop)) : 0
    if (get().panelScrollTop !== safe) set({ panelScrollTop: safe })
  },
  restorePanelWorkspace: (open, scrollTop) => set((s) => ({
    panelOpen: open,
    panelScrollTop: Number.isFinite(scrollTop) ? Math.max(0, Math.round(scrollTop)) : 0,
    panelScrollEpoch: s.panelScrollEpoch + 1,
  })),
  setQuickPromptOpen: (open) => set({ quickPromptOpen: open }),
  setPendingAttachmentImage: (dataUrl) => set({ pendingAttachmentImage: dataUrl }),
  addPendingRef: (ref) =>
    set((s) => {
      if (s.pendingRefs.some((r) => r.kind === ref.kind && r.id === ref.id)) return s
      return { pendingRefs: [...s.pendingRefs, ref] }
    }),
  removePendingRef: (kind, id) =>
    set((s) => ({ pendingRefs: s.pendingRefs.filter((r) => !(r.kind === kind && r.id === id)) })),
  clearPendingRefs: () => set({ pendingRefs: [] }),
  clearTaskPlan: () => set({ taskPlan: [] }),

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

  deleteProvider: async (id) => {
    const ai = electronBridge()?.ai
    if (!ai?.deleteProvider) return
    const res = await ai.deleteProvider(id)
    set({
      activeProviderId: res.activeProviderId,
      providers: res.providers as ProviderInfo[],
    })
  },

  setActiveProvider: async (id, model) => {
    const ai = electronBridge()?.ai
    if (!ai) return
    const res = await ai.setActiveProvider(id, model)
    if (typeof res === 'string') {
      set({ activeProviderId: res })
    } else {
      set({
        activeProviderId: res.activeProviderId,
        providers: res.providers as ProviderInfo[],
      })
    }
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
    set({ status: 'idle', phaseText: '', startedAt: null, activeRequestId: null, activeNodeIds: [], steerQueue: [] })
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

  deleteTurn: (turnId) => {
    const next = get().turns.filter((t) => t.id !== turnId)
    set({ turns: next })
    void saveAiHistory(next)
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
    const attachedImage = get().pendingAttachmentImage ?? undefined
    const text = rawText.trim() || (attachedImage ? '请结合当前工程与场景分析这张截图。' : '')
    if (!text) return

    const manualRefs = get().pendingRefs
    const editorState = useEditorStore.getState()
    const selectedRefs: AiRefItem[] = editorState.selection
      .map((id) => editorState.nodes[id])
      .filter(Boolean)
      .map((n) => ({ kind: 'node' as const, id: n.id, label: n.name, subKind: n.kind }))

    const mergedRefs: AiRefItem[] = [...manualRefs]
    for (const r of selectedRefs) {
      if (!mergedRefs.some((m) => m.kind === r.kind && m.id === r.id)) {
        mergedRefs.push(r)
      }
    }

    // 运行中发送 -> 作为 Steer 插话入队，在当前工具步间隙注入上下文
    if (get().status !== 'idle') {
      if (manualRefs.length > 0) set({ pendingRefs: [] })
      if (attachedImage) set({ pendingAttachmentImage: null })
      const steerTurn: AiTurnItem = {
        id: `u_${Date.now()}`,
        role: 'user',
        text,
        imageDataUrl: attachedImage,
        refs: mergedRefs.length > 0 ? mergedRefs : undefined,
      }
      set((s) => ({
        steerQueue: [
          ...s.steerQueue,
          { text, imageDataUrl: attachedImage, refs: mergedRefs.length > 0 ? mergedRefs : undefined },
        ],
        turns: [...s.turns, steerTurn],
      }))
      return
    }

    const ai = electronBridge()?.ai
    if (!ai) {
      if (manualRefs.length > 0) set({ pendingRefs: [] })
      if (attachedImage) set({ pendingAttachmentImage: null })
      set((s) => ({
        turns: [
          ...s.turns,
          { id: `u_${Date.now()}`, role: 'user', text, imageDataUrl: attachedImage },
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

    if (manualRefs.length > 0) set({ pendingRefs: [] })
    if (attachedImage) set({ pendingAttachmentImage: null })

    const userTurn: AiTurnItem = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
      imageDataUrl: attachedImage,
      refs: mergedRefs.length > 0 ? mergedRefs : undefined,
    }

    const turnProviderId = get().activeProviderId
    const turnModel = get().providers.find((p) => p.id === turnProviderId)?.model

    const checkpoint = await createCheckpoint(`AI 轮次前：${text.slice(0, 24)}`)
    let currentAssistantId = `a_${Date.now() + 1}`

    set((s) => ({
      status: 'running',
      phaseText: '正在分析需求与工程上下文…',
      startedAt: Date.now(),
      streamingText: '',
      steerQueue: [],
      turns: [
        ...s.turns,
        userTurn,
        { id: currentAssistantId, role: 'assistant', text: '', actions: [], checkpointId: checkpoint.id, inProgress: true },
      ],
    }))
    saveInflightBackup(get().turns)
    void saveAiHistory(get().turns)

    const chatMessages: LoopMessage[] = buildHistoryMessages(get().turns, currentAssistantId)
    // 动态工程上下文只在本轮开头注入一次，追加在用户消息尾部：
    // 系统提示与工具定义保持逐字不变，才能让提示缓存覆盖「系统提示 + 工具 + 之前全部对话」
    const turnContext = buildTurnContext(mergedRefs)
    const lastHistoryMessage = chatMessages[chatMessages.length - 1]
    if (lastHistoryMessage && lastHistoryMessage.role === 'user') {
      lastHistoryMessage.text = `${lastHistoryMessage.text}\n\n${turnContext}`
    } else {
      chatMessages.push({ role: 'user', text: `${text}\n\n${turnContext}` })
    }
    const systemPrompt = buildSystemPrompt()
    const tools = buildAiToolSpecs()
    const baselineDiagnoseErrors = new Set(collectDiagnoseErrors())

    commandBus.beginTransaction(`AI：${text.slice(0, 32)}`)
    let actions: AiActionPill[] = []
    let finalText = ''
    let totalIn = 0
    let totalOut = 0
    let totalCached = 0
    let usedModel = ''
    let txCommitted = false
    let stopReason: AiTurnItem['stopReason'] = 'completed'
    let planNudges = 0
    let lengthNudges = 0
    let autoVerifyRounds = 0
    /** 自上次验收以来是否改过工程 / 是否改过会影响运行逻辑的内容 */
    let dirtySinceVerify = false
    let logicDirtySinceSmoke = false
    let completedNormally = false
    const trace: AiTraceDraft = {
      prompt: text.slice(0, 200),
      startedAt: Date.now(),
      steps: [],
      toolCalls: 0,
      toolFailures: 0,
      truncations: 0,
      autoVerifyRounds: 0,
      compactions: 0,
    }

    const consumeSteerQueue = () => {
      const queued = get().steerQueue
      if (queued.length === 0) return false
      set({ steerQueue: [] })
      for (const item of queued) {
        const refCtx = item.refs && item.refs.length > 0 ? `\n${formatRefsContext(item.refs)}` : ''
        chatMessages.push({
          role: 'user',
          text: `[用户运行中插话纠偏]\n${item.text}${refCtx}`,
          ...(item.imageDataUrl ? { images: [item.imageDataUrl] } : {}),
        })
      }
      const prevAssistantId = currentAssistantId
      currentAssistantId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      actions = []
      finalText = ''
      set((s) => ({
        turns: [
          ...s.turns.map((t) => (t.id === prevAssistantId ? { ...t, inProgress: false, stopReason: 'completed' as const } : t)),
          { id: currentAssistantId, role: 'assistant', text: '', actions: [], inProgress: true },
        ],
      }))
      saveInflightBackup(get().turns)
      void saveAiHistory(get().turns)
      return true
    }

    try {
      for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
        if (get().status === 'idle') break
        consumeSteerQueue()
        if (compactMessagesInPlace(chatMessages)) trace.compactions += 1
        const reqId = `req_${Date.now()}_${step}`
        set({
          activeRequestId: reqId,
          streamingText: '',
          phaseText: step === 0 ? '正在思考方案…' : `正在思考下一步（第 ${step + 1} 步）…`,
        })

        const unsub = ai.onDelta((delta) => {
          if (delta.requestId !== reqId) return
          if (delta.type === 'text' && delta.text) {
            set((s) => ({
              phaseText: '正在输出思路与说明…',
              streamingText: s.streamingText + delta.text,
            }))
          } else if (delta.type === 'reasoning') {
            if (get().phaseText !== '正在深入思考…' && !get().streamingText) set({ phaseText: '正在深入思考…' })
          } else if (delta.type === 'tool' && delta.toolName) {
            // 工具参数（如整段脚本源码）开始流式生成时就给出进度，而不是等整段写完
            set({ phaseText: toolPhaseLabel(delta.toolName) })
          }
        })

        const stepStartedAt = Date.now()
        let result: Awaited<ReturnType<typeof ai.chat>>
        try {
          result = await ai.chat(reqId, {
            providerId: turnProviderId,
            ...(turnModel ? { model: turnModel } : {}),
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
        totalCached += result.usage?.cachedTokens ?? 0
        trace.steps.push({
          ms: Date.now() - stepStartedAt,
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          cachedTokens: result.usage?.cachedTokens ?? 0,
          tools: result.toolCalls.map((tc) => tc.name),
          stopReason: result.stopReason ?? 'stop',
        })
        if (result.text) {
          finalText = finalText ? `${finalText}\n${result.text}` : result.text
          set((s) => ({
            turns: s.turns.map((t) =>
              t.id === currentAssistantId ? { ...t, text: finalText } : t,
            ),
          }))
        }

        if (result.toolCalls.length === 0) {
          // 纯文本回复被长度上限截断：让模型接着写，而不是把半截内容当成最终答复
          if (result.stopReason === 'length' && lengthNudges < 2 && step + 1 < MAX_TOOL_STEPS) {
            lengthNudges += 1
            trace.truncations += 1
            chatMessages.push({ role: 'assistant', text: result.text || '（输出被截断）', providerState: result.providerState })
            chatMessages.push({
              role: 'user',
              text: '[系统] 上一条回复因输出长度上限被截断。请从中断处继续，不要重复已输出的内容；如果是要写很长的脚本或 UI，请拆成多次工具调用（先 script__create 写骨架，再用 script__patch 分段补充）。',
            })
            continue
          }
          if (consumeSteerQueue()) {
            continue
          }
          const remainingPlan = get().taskPlan.filter((t) => t.status !== 'done')
          if (remainingPlan.length > 0 && planNudges < 1 && step + 1 < MAX_TOOL_STEPS) {
            planNudges += 1
            chatMessages.push({ role: 'assistant', text: result.text || '（正在继续推进任务）', providerState: result.providerState })
            chatMessages.push({
              role: 'user',
              text: `[系统自动续推] 任务清单仍有 ${remainingPlan.length} 项未完成（下一项：${remainingPlan[0].title}）。请继续调用工具推进，完成后用 plan__set_tasks 更新状态；只有全部完成或必须由用户做关键决策时才结束。`,
            })
            continue
          }
          // 确定性验收由循环自己执行（零模型开销），只有真的发现问题才回灌给模型修复
          if (dirtySinceVerify && autoVerifyRounds < 2 && step + 1 < MAX_TOOL_STEPS && get().status !== 'idle') {
            set({ phaseText: '正在自动验收（工程体检 + 试玩）…' })
            const feedback = runAutoVerify(baselineDiagnoseErrors, logicDirtySinceSmoke)
            dirtySinceVerify = false
            logicDirtySinceSmoke = false
            if (feedback) {
              autoVerifyRounds += 1
              trace.autoVerifyRounds += 1
              chatMessages.push({ role: 'assistant', text: result.text || '（准备收尾）', providerState: result.providerState })
              chatMessages.push({ role: 'user', text: feedback })
              continue
            }
          }
          stopReason = remainingPlan.length > 0 ? 'paused-with-plan' : 'completed'
          completedNormally = true
          break
        }

        chatMessages.push({
          role: 'assistant',
          text: result.text,
          toolCalls: result.toolCalls,
          providerState: result.providerState,
        })

        const stepCapturedImages: string[] = []
        for (const tc of result.toolCalls) {
          trace.toolCalls += 1
          // 参数 JSON 不完整（输出被截断）：绝不带着空参数去执行，明确告诉模型拆小重试
          if (tc.invalid) {
            trace.truncations += 1
            trace.toolFailures += 1
            actions.push({
              id: tc.id,
              toolName: tc.name,
              label: `${tc.name.replace(/__/g, '.')} 未执行：参数被截断`,
              ok: false,
              pending: false,
            })
            set((s) => ({
              turns: s.turns.map((t) => (t.id === currentAssistantId ? { ...t, actions: [...actions] } : t)),
            }))
            chatMessages.push({
              role: 'tool',
              toolCallId: tc.id,
              name: tc.name,
              content: JSON.stringify({
                ok: false,
                executed: false,
                message: `${tc.invalid}，本次调用没有执行。请把内容拆小后重试：脚本先用 script__create 写一个能编译的骨架，再用多次 script__patch 逐段补充；UI 先建骨架再用 ui__patchNode 的 appendChildren 分块追加。`,
              }),
            })
            continue
          }

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
              t.id === currentAssistantId ? { ...t, actions: [...actions, pendingPill] } : t,
            ),
          }))

          const execRes = await executeAiTool(tc.name, tc.arguments)
          if (!execRes.ok) trace.toolFailures += 1
          if (!isReadOnlyTool(tc.name)) {
            dirtySinceVerify = true
            if (affectsRuntimeLogic(tc.name)) logicDirtySinceSmoke = true
          } else if (
            tc.name === 'playtest__run_smoke' ||
            (tc.name === 'viewport__capture' && typeof tc.arguments.playSeconds === 'number' && tc.arguments.playSeconds > 0)
          ) {
            // 模型自己已经在最新状态上跑过试玩，收尾时不必再重复
            logicDirtySinceSmoke = false
          }
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
            targetAssetId: execRes.targetAssetId,
            // 只为失败的操作保留详情（面板用于展示报错）；成功结果可能是整段源码，不写进对话历史
            detail: execRes.ok ? undefined : stripImagePayload(execRes.data).payload,
          })
          set((s) => ({
            turns: s.turns.map((t) =>
              t.id === currentAssistantId ? { ...t, actions: [...actions] } : t,
            ),
          }))
          saveInflightBackup(get().turns)

          // 截图以图片消息形式单独附上；其余字段（运行时报错、断言结果等）照常返回给模型
          const stripped = stripImagePayload(execRes.data)
          if (stripped.image) stepCapturedImages.push(stripped.image)
          const serialized = JSON.stringify(stripped.payload)
          const limit = toolResultCharLimit(tc.name)
          chatMessages.push({
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: serialized.length > limit
              ? `${serialized.slice(0, limit)}...(结果过长已截断，请用更具体的查询获取细节)`
              : serialized,
          })
        }
        if (stepCapturedImages.length > 0 && get().status !== 'idle') {
          chatMessages.push({
            role: 'user',
            text: '这是刚截取的视口画面（含 3D 场景与叠加 UI），请直接检查相机构图、物体朝向与 UI 排版是否合理：',
            images: [stepCapturedImages[stepCapturedImages.length - 1]],
          })
        }
      }

      if (!completedNormally && get().status !== 'idle') {
        stopReason = 'max-steps'
      }
      const pendingTasksCount = get().taskPlan.filter((t) => t.status !== 'done').length
      commandBus.commitTransaction()
      txCommitted = true
      set((s) => ({
        status: 'idle',
        phaseText: '',
        startedAt: null,
        streamingText: '',
        activeNodeIds: [],
        steerQueue: [],
        turns: s.turns.map((t) =>
          t.id === currentAssistantId
            ? {
                ...t,
                text: finalText || (actions.length > 0 ? '已完成本轮操作。' : ''),
                actions,
                usage: {
                  inputTokens: totalIn,
                  outputTokens: totalOut,
                  cachedTokens: totalCached,
                  model: usedModel,
                  steps: trace.steps.length,
                  durationMs: Date.now() - trace.startedAt,
                },
                stopReason,
                pendingTasksCount,
                inProgress: undefined,
              }
            : t,
        ),
      }))
      clearInflightBackup()
      void saveAiHistory(get().turns)
      const traceRecord = finalizeAiTrace(trace, { model: usedModel, stopReason: stopReason ?? 'completed' })
      recordAiTrace(traceRecord)
      console.info(`[AI] 本轮：${summarizeAiTrace(traceRecord)}`)
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
        steerQueue: [],
        turns: s.turns.map((t) =>
          t.id === currentAssistantId ? { ...t, text: finalText, actions, error: msg, inProgress: undefined } : t,
        ),
      }))
      clearInflightBackup()
      void saveAiHistory(get().turns)
      recordAiTrace(finalizeAiTrace(trace, { model: usedModel, stopReason: 'error', error: msg }))
    }
  },
}))

initAiHistorySync(
  () => useAgentStore.getState().turns,
  (turns) => useAgentStore.setState({ turns }),
)

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const state = useAgentStore.getState()
    if (state.status === 'idle') return
    const snapshot = state.turns.map((t, idx) => {
      const isLastAssistant = idx === state.turns.length - 1 && t.role === 'assistant'
      if (!isLastAssistant) return t
      return {
        ...t,
        inProgress: true,
        text: t.text || state.streamingText || '',
      }
    })
    saveInflightBackup(snapshot)
  })
}

registerTaskPlanUpdater((tasks) => {
  useAgentStore.setState({ taskPlan: tasks })
})

function toolPhaseLabel(toolName: string): string {
  if (toolName === 'plan__set_tasks') return '正在规划 / 更新任务进度…'
  if (toolName === 'script__patch') return '正在局部修改并热重载脚本…'
  if (toolName === 'script__read' || toolName === 'shader__read') return '正在读取源码…'
  if (toolName === 'kb__read') return '正在查阅范例库…'
  if (toolName === 'script__attach') return '正在挂载脚本…'
  if (toolName.startsWith('script__')) return '正在生成 / 编译脚本…'
  if (toolName.startsWith('shader__')) return '正在生成 / 编译着色器…'
  if (toolName.startsWith('scene__')) return '正在搭建 / 修改场景节点…'
  if (toolName.startsWith('asset__')) return '正在处理材质与资产…'
  if (toolName.startsWith('gameplay__') || toolName.startsWith('capability__')) return '正在配置玩法与能力包…'
  if (toolName === 'ui__createDocument' || toolName === 'ui__createFromTemplate') return '正在生成 UI 界面资产…'
  if (toolName === 'ui__patchNode') return '正在局部修改 UI 节点…'
  if (toolName === 'ui__updateDocument') return '正在更新 UI 界面结构…'
  if (toolName === 'ui__mountScreen') return '正在挂载 UI 屏幕到场景…'
  if (toolName === 'query__ui_inspect') return '正在读取 UI 界面结构…'
  if (toolName === 'viewport__capture' || toolName === 'playtest__capture') return '正在截取视口画面…'
  if (toolName === 'playtest__control') return '正在切换试玩状态…'
  if (toolName.startsWith('query__project_diagnose')) return '正在执行工程体检与性能预算检查…'
  if (toolName.startsWith('query__')) return '正在读取工程信息…'
  if (toolName.startsWith('playtest__')) return '正在执行试玩冒烟验证…'
  if (toolName.startsWith('pack__')) return '正在处理能力包…'
  if (toolName.startsWith('branch__')) return '正在切换 / 管理实验分支…'
  if (toolName.startsWith('project__')) return '正在更新工程配置…'
  return `正在执行 ${toolName.replace(/__/g, '.')}…`
}

function buildHistoryMessages(
  turns: AiTurnItem[],
  excludeId: string,
): LoopMessage[] {
  const MAX_TURNS = 24
  const MAX_CHARS = 18000
  const MIN_KEEP = 4
  const MAX_IMAGES = 2

  const candidates = turns.filter(
    (t) =>
      t.id !== excludeId &&
      !t.error &&
      (t.text.trim() || t.imageDataUrl || (t.actions && t.actions.length > 0) || t.stopReason === 'interrupted'),
  )

  const picked: LoopMessage[] = []
  let totalChars = 0
  let imagesUsed = 0

  for (let i = candidates.length - 1; i >= 0 && picked.length < MAX_TURNS; i -= 1) {
    const t = candidates[i]
    let content = t.text.trim()
    if (t.role === 'user' && t.refs && t.refs.length > 0) {
      const refNote = t.refs
        .map((r) => `${r.kind === 'node' ? '@' : '#'}${r.label}(${r.kind}:${r.id})`)
        .join(', ')
      content = `${content}\n[本轮附加引用: ${refNote}]`.trim()
    }
    if (t.role === 'assistant' && t.actions && t.actions.length > 0) {
      const actionSummary = t.actions
        .map((a) => `${a.ok ? '✓' : '✕'} ${a.label}${a.targetNodeId ? ` [${a.targetNodeId}]` : ''}`)
        .join('；')
      content = `${content}\n[本轮已执行操作: ${actionSummary}]`.trim()
    }
    if (t.role === 'assistant' && t.stopReason === 'interrupted') {
      content = `${content}\n[本轮执行因页面刷新或异常而中断]`.trim()
    }
    const includeImage = t.role === 'user' && Boolean(t.imageDataUrl) && imagesUsed < MAX_IMAGES
    if (includeImage) imagesUsed += 1
    if (!content && includeImage) content = '请结合当前场景分析这张截图。'
    if (!content) continue

    if (picked.length >= MIN_KEEP && totalChars + content.length > MAX_CHARS) {
      break
    }
    totalChars += content.length
    picked.push({
      role: t.role,
      text: content,
      ...(includeImage && t.imageDataUrl ? { images: [t.imageDataUrl] } : {}),
    })
  }

  return picked.reverse()
}

type LoopToolCall = { id: string; name: string; arguments: Record<string, unknown>; invalid?: string }

type LoopMessage =
  | { role: 'user'; text: string; images?: string[] }
  | { role: 'assistant'; text: string; toolCalls?: LoopToolCall[]; providerState?: unknown }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

/** 只读工具：不改工程，不触发收尾验收 */
function isReadOnlyTool(toolName: string): boolean {
  return (
    toolName.startsWith('query__') ||
    toolName.startsWith('kb__') ||
    toolName.startsWith('plan__') ||
    toolName.startsWith('viewport__') ||
    toolName.startsWith('playtest__') ||
    toolName === 'script__read' ||
    toolName === 'shader__read' ||
    toolName === 'script__check' ||
    toolName === 'shader__check' ||
    toolName === 'input__get_map' ||
    toolName === 'branch__list' ||
    toolName === 'project__design__get'
  )
}

/** 会改变试玩行为的写操作：收尾时需要实际跑一下确认没有运行时报错 */
function affectsRuntimeLogic(toolName: string): boolean {
  return (
    toolName.startsWith('script__') ||
    toolName.startsWith('gameplay__') ||
    toolName.startsWith('capability__') ||
    toolName.startsWith('input__') ||
    toolName === 'scene__deleteNodes' ||
    toolName === 'ui__mountScreen' ||
    toolName === 'ui__createFromTemplate'
  )
}

function toolResultCharLimit(toolName: string): number {
  // 源码与范例必须完整返回，否则 script__patch 的 find 片段无法逐字匹配
  if (toolName === 'script__read' || toolName === 'shader__read' || toolName === 'kb__read') return 60000
  return 16000
}

/** 把工具返回里的截图 DataURL 拆出来，其余字段原样保留 */
function stripImagePayload(data: unknown): { payload: unknown; image: string | null } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { payload: data, image: null }
  const record = data as Record<string, unknown>
  const url = record.dataUrl
  if (typeof url !== 'string' || !url.startsWith('data:image/')) return { payload: data, image: null }
  const { dataUrl: _omit, ...rest } = record
  void _omit
  return {
    payload: { ...rest, captured: true, note: '截图已附在随后的图片消息中，请直接观察画面。' },
    image: url,
  }
}

function collectDiagnoseErrors(): string[] {
  try {
    return diagnoseProject()
      .issues.filter((issue) => issue.severity === 'error')
      .map((issue) => `[${issue.category}] ${issue.target ? `${issue.target}：` : ''}${issue.message}${issue.hint ? `（${issue.hint}）` : ''}`)
  } catch {
    return []
  }
}

/**
 * 收尾自动验收：由循环直接执行确定性检查（工程体检 + 1 秒试玩），不消耗模型步数。
 * 只把「本轮新引入」的体检错误与运行时报错回灌给模型；全部通过时返回 null。
 */
function runAutoVerify(baselineErrors: ReadonlySet<string>, runSmoke: boolean): string | null {
  const sections: string[] = []
  const newErrors = collectDiagnoseErrors().filter((line) => !baselineErrors.has(line))
  if (newErrors.length > 0) {
    sections.push(`工程体检发现本轮新增的 ${newErrors.length} 个错误：\n${newErrors.slice(0, 8).map((line) => `- ${line}`).join('\n')}`)
  }
  if (runSmoke && useEditorStore.getState().playState === 'stopped') {
    try {
      const report = new PlaytestSession().runSmoke([{ action: 'step', seconds: 1 }])
      const summary = summarizeRuntimeLogs(report.errors.map((message) => ({ level: 'error', message })))
      if (summary.errorCount > 0) {
        sections.push(`自动试玩 1 秒出现 ${summary.errorCount} 条运行时报错：\n${summary.errors.map((line) => `- ${line}`).join('\n')}`)
      }
    } catch (error) {
      console.warn('[AI] 自动试玩验收跳过：', error)
    }
  }
  if (sections.length === 0) return null
  return [
    '[自动验收未通过]',
    ...sections,
    '请直接修复以上问题：先用 script__read 查看相关脚本的当前源码，再用 script__patch 修改；不要新建测试或探测脚本。若某条报错确实与本轮改动无关，在总结里说明即可。修复后给出简短总结。',
  ].join('\n')
}

const COMPACT_TRIGGER_CHARS = 180_000
const IMAGE_CHAR_COST = 6000

function estimateMessageChars(m: LoopMessage): number {
  if (m.role === 'tool') return m.content.length
  if (m.role === 'user') return m.text.length + (m.images?.length ?? 0) * IMAGE_CHAR_COST
  let size = m.text.length
  for (const tc of m.toolCalls ?? []) size += JSON.stringify(tc.arguments).length
  return size
}

/**
 * 上下文折叠（原地、仅在超出预算时触发一次）。
 *
 * 不再每一步都滑动折叠窗口：那样会逐步改写历史消息，使提示缓存前缀每步失效。
 * 现在历史只追加不改写，直到总量超过预算才一次性折叠早期的大块内容，之后又恢复为只追加。
 */
function compactMessagesInPlace(messages: LoopMessage[]): boolean {
  let total = 0
  for (const m of messages) total += estimateMessageChars(m)
  if (total < COMPACT_TRIGGER_CHARS) return false

  // 保留最近两组工具调用及其结果的完整内容
  let assistantWithToolsSeen = 0
  let cutoffIndex = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      assistantWithToolsSeen += 1
      if (assistantWithToolsSeen >= 2) {
        cutoffIndex = i
        break
      }
    }
  }
  if (cutoffIndex === 0) return false

  let changed = false
  for (let idx = 0; idx < cutoffIndex; idx += 1) {
    const m = messages[idx]
    if (m.role === 'tool') {
      if (m.content.length > 800) {
        const readHint =
          m.name === 'script__read' || m.name === 'shader__read' || m.name === 'kb__read'
            ? '需要时请重新调用该工具读取最新内容'
            : '如需细节可重新查询'
        messages[idx] = { ...m, content: `[早先工具 ${m.name} 的返回已折叠（原长 ${m.content.length} 字符），${readHint}]` }
        changed = true
      }
    } else if (m.role === 'user') {
      if (m.images && m.images.length > 0) {
        messages[idx] = { role: 'user', text: `${m.text}\n（早先的截图已省略）` }
        changed = true
      }
    } else if (m.toolCalls && m.toolCalls.length > 0) {
      let callChanged = false
      const nextToolCalls = m.toolCalls.map((tc) => {
        const nextArgs: Record<string, unknown> = { ...tc.arguments }
        let argChanged = false
        for (const largeKey of ['source', 'document', 'patches', 'appendChildren']) {
          const val = nextArgs[largeKey]
          const strLen = typeof val === 'string' ? val.length : val && typeof val === 'object' ? JSON.stringify(val).length : 0
          if (strLen > 1200) {
            nextArgs[largeKey] = `[已折叠 ${largeKey}（原长 ${strLen} 字符）；当前内容请用 script__read / shader__read / query__ui_inspect 读取]`
            argChanged = true
          }
        }
        if (argChanged) callChanged = true
        return argChanged ? { ...tc, arguments: nextArgs } : tc
      })
      if (callChanged) {
        messages[idx] = { ...m, toolCalls: nextToolCalls }
        changed = true
      }
    }
  }
  return changed
}

function formatRefsContext(attachedRefs: AiRefItem[]): string {
  const nodeRefs = attachedRefs.filter((r) => r.kind === 'node')
  const codeRefs = attachedRefs.filter((r) => r.kind === 'script' || r.kind === 'shader')
  const assetRefs = attachedRefs.filter((r) => r.kind === 'asset')

  const selectedText = nodeRefs.length > 0
    ? `\n当前引用/选中的场景节点（精简快照）：\n${nodeRefs
        .map((r) => {
          const info = queryNodeInspect(r.id)
          if (!info) return `- ${r.label} (id: ${r.id})`
          const compact = {
            id: info.id,
            name: info.name,
            kind: info.kind,
            parentId: info.parentId,
            position: info.transform.position,
            assetId: info.assetId,
            packs: Object.keys(info.gameplay.packs ?? {}),
            capabilities: Object.keys(info.capabilities ?? {}),
            hasPhysics: Boolean(info.physics),
            hasCameraFollow: Boolean(info.gameplay.cameraFollow),
          }
          return `- ${JSON.stringify(compact)}`
        })
        .join('\n')}`
    : ''

  const codeAssets = useCodeAssetStore.getState().assets
  const codeText = codeRefs.length > 0
    ? `\n用户附加分析的代码资产（脚本/着色器）：\n${codeRefs
        .map((r) => {
          const rec = codeAssets[r.id]
          if (!rec) return `- ${r.kind}:${r.id} (${r.label}) [未找到]`
          const src = rec.source.length > 4000 ? `${rec.source.slice(0, 4000)}\n// ...(已截断)` : rec.source
          return [
            `--- ${rec.kind} "${rec.name}" (id: ${rec.id}, path: ${rec.relativePath}, ok: ${rec.ok}) ---`,
            ...(rec.diagnostics.length > 0 ? [`诊断: ${JSON.stringify(rec.diagnostics)}`] : []),
            src,
          ].join('\n')
        })
        .join('\n')}`
    : ''

  const allAssets = useAssetStore.getState().assets
  const assetText = assetRefs.length > 0
    ? `\n用户附加分析的工程资产：\n${assetRefs
        .map((r) => {
          const asset = allAssets[r.id]
          if (!asset) return `- asset:${r.id} (${r.label}) [未找到]`
          const detail: Record<string, unknown> = { id: asset.id, name: asset.name, kind: asset.kind }
          if (asset.kind === 'material') detail.slot = asset.slot
          else if (asset.kind === 'ui') detail.document = asset.document
          else if (asset.kind === 'prefab') detail.nodeCount = Object.keys(asset.nodes).length
          else if (asset.kind === 'model' || asset.kind === 'animation') {
            detail.clips = asset.clipCatalog?.map((c) => c.name) ?? []
          }
          const json = JSON.stringify(detail)
          return `- ${json.length > 3500 ? `${json.slice(0, 3500)}...(已截断，可用专用查询工具读取)` : json}`
        })
        .join('\n')}`
    : ''

  return `${selectedText}${codeText}${assetText}`
}

/** 本轮开始时的工程快照。追加在用户消息尾部，而不是放进系统提示，以保持系统提示逐字稳定 */
function buildTurnContext(attachedRefs: AiRefItem[]): string {
  const designMd = formatDesignMarkdown(getDesignDoc())
  const overview = JSON.stringify(queryProjectOverview())
  const sceneNodes = Object.values(useEditorStore.getState().nodes)
  const NODE_INDEX_LIMIT = 60
  const nodeIndexText = sceneNodes.length > 0
    ? `场景节点索引（名称 -> ID，共 ${sceneNodes.length} 个）：\n${sceneNodes
        .slice(0, NODE_INDEX_LIMIT)
        .map((n) => {
          const extra = n.kind === 'screen' && n.screen?.documentId ? `, uiAssetId=${n.screen.documentId}` : ''
          return `- ${n.name} (${n.kind}${extra}): ${n.id}`
        })
        .join('\n')}${sceneNodes.length > NODE_INDEX_LIMIT ? '\n- ...（更多节点请调用 query__scene_outline）' : ''}`
    : '场景节点索引：当前场景为空。'

  const codeAssets = Object.values(useCodeAssetStore.getState().assets)
  const codeIndexText = codeAssets.length > 0
    ? `代码资产索引：${codeAssets
        .slice(0, 40)
        .map((a) => `${a.kind}:${a.id}${a.ok ? '' : '(编译失败)'}`)
        .join('、')}`
    : ''

  const refsContext = formatRefsContext(attachedRefs).trim()
  const activePlan = useAgentStore.getState().taskPlan
  const planText = activePlan.length > 0
    ? `进行中的任务清单：\n${activePlan.map((t) => `- [${t.status}] (${t.id}) ${t.title}`).join('\n')}`
    : ''

  return [
    '<工程上下文>',
    '（以下是本轮开始时的快照；之后发生的变化以工具返回为准）',
    `设计规范（design.md）：\n${designMd}`,
    `工程概览：${overview}`,
    nodeIndexText,
    codeIndexText,
    refsContext,
    planText,
    '</工程上下文>',
  ]
    .filter(Boolean)
    .join('\n')
}

let cachedSystemPrompt: string | null = null

/**
 * 系统提示：完全静态（不含任何工程状态），整段可被提示缓存命中。
 * 需要告诉模型的工程现状一律走 buildTurnContext 或工具返回。
 */
function buildSystemPrompt(): string {
  if (cachedSystemPrompt) return cachedSystemPrompt
  const lines: string[] = [
    '你是 T3D 游戏工程管理器的内置 AI 创作助手，通过工具直接读取和修改用户的工程。始终用简体中文回复。',
    '',
    '【工作方式】',
    '1. 按任务规模行事：',
    '   - 小改动（调参数、修一个脚本问题、改一个节点、回答问题）：直接动手，改完用一两句话说明。不要调用 plan__set_tasks，不要做与改动无关的体检或截图。',
    '   - 中等任务（一个完整功能，例如“加一个会追玩家的敌人”）：连续调用工具做完，最后做一次与该功能对应的验收。',
    '   - 大任务（完整游戏 / Demo / 多个模块）：先用 plan__set_tasks 拆成 3~6 个阶段，然后连续推进到全部完成，每完成一个阶段更新一次状态。不要中途停下来汇报进度，除非需要用户做方向性决策。',
    '2. 先看再改：修改已有脚本前先 script__read，修改已有着色器前先 shader__read，修改已有 UI 前先 query__ui_inspect。不要凭记忆改写。',
    '3. 先查范例：实现下方「范例库」覆盖的玩法时，先用 kb__read 读取范例，在它的基础上按需求改写。范例已在真实运行时里验证过，从它出发比从零写更快也更可靠。',
    '4. 一步多调用：互不依赖的查询或创建（例如同时创建地面、灯光、相机，或同时读取两个脚本），在同一步里一次发出多个工具调用。',
    '5. 局部修改优先：改已有脚本用 script__patch（find 片段必须与 script__read 返回的源码逐字一致），改已有 UI 用 ui__patchNode。单个脚本超过约 150 行时，先 script__create 写出能编译的骨架，再用 script__patch 分段补充，避免一次输出过长被截断。',
    '6. 验收看状态：',
    '   - 玩法逻辑用 playtest__run_smoke 验收（注入输入，再断言节点位置 / 界面变量 / 日志），它是确定性的，比截图可靠。',
    '   - 相机构图、物体朝向、UI 排版才用 viewport__capture；需要看试玩中的画面时传 playSeconds。',
    '   - 试玩类工具的返回里已经带有运行时报错。出现报错时直接 script__read 定位并修复，不要新建测试或探测脚本去试。',
    '   - 需要看过程或内部变量时：playtest__run_smoke 的 logs 会回传脚本 self.log 的输出；watchNodes 回报节点的实时位置、朝向和各脚本的 self.state 快照；再加 sampleEvery 可拿到运动轨迹。在现有脚本里临时加一行 self.log 就能读回任何值，查清后删掉即可。',
    '   - 不确定某个数据槽是否真的生效时，看 query__node_inspect 的 drivers 字段；内置组件的字段用 query__registry_describe({ category: "coreComponents" }) 查，不要靠试。',
    '   - 你结束时系统会自动做一次工程体检；改过脚本或玩法时还会自动试玩 1 秒。有问题会反馈给你，所以不必为了保险重复体检。',
    '7. ID 一律使用工具返回或工程上下文里的准确值；节点名称唯一时可以直接传名称。不要凭记忆拼写 UUID。',
    '8. 修改工程前必须处于非试玩状态（暂停也算试玩中）。viewport__capture({ playSeconds }) 与 playtest__run_smoke 会自动退出试玩；只有手动 playtest__control({ action: "play" }) 之后才需要先 stop。调手感的标准做法是「script__patch → playtest__run_smoke」两步一轮，不需要手动 play/stop。',
    '9. 用完即清：调试中临时建的脚本或节点，结束前用 script__detach / script__delete / scene__deleteNodes 清理掉；query__code_assets 里标了 orphan 的是没有任何节点挂载的脚本。',
    '',
    '【Demo 质量底线】做完整玩法或 Demo 时，交付前逐条确认：',
    '   - 有明确目标和反馈闭环：玩家知道要做什么，做了有得分 / 血量 / 胜负变化。',
    '   - 玩家输入有即时可见的响应（移动、攻击、拾取）。',
    '   - 舞台完整：地面、主光源、能看清主角与活动区域的相机。',
    '   - HUD 显示关键数值，结束时有结算界面。',
    '   - 不同对象用不同颜色的材质区分（asset__createMaterial + asset__assignMaterial），不要满屏默认灰白几何体。',
    '   - 总结里写明操作方式（按键）和玩法规则。',
    '',
    '【场景与工程规范】',
    '   - 场景节点的 rotation 单位是角度（度）；脚本内 self.rotation 是弧度。',
    '   - 摆放相机、方向光、聚光灯时直接传 lookAt: [x, y, z]，让引擎计算朝向（例如 position: [0, 8, 12], lookAt: [0, 1, 0]），不要手算欧拉角。',
    '   - 把物体放到地面上时传 snapToGround: true。',
    '   - 资产较多（超过 5 个）或多模块时，按 Assets/Scripts/<模块>、Assets/Materials/<模块>、Assets/UI/<模块>、Assets/Prefabs/<模块> 分目录（script__create / shader__create 可传 folder）；用空节点（kind: "empty"）给场景对象分组。',
    '   - 需要大量同类对象（子弹、敌人、特效）时，建 1 个隐藏模板节点或预制体，用 self.pool 复用；不要手建几十个节点充当对象池。',
    '   - 引擎内置组件（挂在 node.gameplay.<组件>，用 gameplay__setCoreComponent 设置，无需脚本）：character 角色控制器（移动/跳跃/冲刺/闪避，并按运动状态自动切 idleClip/walkClip/runClip 等动画，同时配好跟随相机）、cameraFollow、interact、trigger、mover、checkpoint、score、soundSource。带骨骼动画的人形主角优先用 character；它已经驱动角色位置时，不要再挂自己改 position 的移动脚本。',
    '   - 模型节点上的 clip / clipPlaying 只是「开局默认动画」，不会随运动切换；要按状态切动画，用 character 的片段槽位，或在脚本里调 self.anim.playBody。',
    '',
    '【范例库】（用 kb__read({ id }) 读取完整源码与搭建步骤）',
    formatRecipeIndexForPrompt(),
    '',
  ]

  lines.push(
      '【脚本】编写节点行为脚本（script__create / script__update）时，必须从 "t3d/runtime" 导入 defineBehavior，并严格使用：',
      '   export default defineBehavior({ name: "简短中文标题", description: "一句话介绍脚本作用", params: { ... }, state: () => ({ ... }), onStart(self) {}, onSpawn(self, payload) {}, onUpdate(self, dt) { ... }, onMessage(self, msg) {}, onDestroy(self) {}, onDrawGizmos(self, gizmos) {} })',
      '   脚本完整可用 API（严禁编造 window.__t3dKeys 等全局变量）：',
      '   - 变换与状态：self.position / self.rotation（弧度）/ self.scale（必须整体赋值，如 self.position = { x, y, z }，不要写 self.position.x = ...）、self.visible、self.elapsedTime、self.state、self.node。',
      '   - 动态生成与对象池（子弹/敌人/特效标准范式：建1个隐藏模板节点或Prefab，用 pool 复用，严禁手建几十个空物体充当对象池）：',
      '     · self.pool.preload(templateOrPrefab, count) / self.pool.acquire(templateOrPrefab, { position?, rotation?, scale?, payload? }) -> NodeHandle | null（自动重置状态并触发脚本 onSpawn(self, payload)）',
      '     · self.pool.release(node)（或调用 node.destroy() 对池化对象自动回池） / self.pool.stats(templateOrPrefab?)',
      '     · self.cloneNode(templateOrName, { position?, rotation?, scale?, parent?, visible?, name?, initMessage?, initPayload? }) -> NodeHandle | null',
      '     · self.spawnPrefab(prefabIdOrName, { position?, rotation?, scale?, name? }) -> NodeHandle | null / self.destroyNode(node)',
      '   - 托管定时器（随节点销毁/回池自动清理）：self.after(seconds, fn) -> id、self.every(seconds, fn) -> id、self.cancelTimer(id)。',
      '   - 移动与空间：self.distanceTo(target)、self.directionTo(target, { planeXZ? })、self.translate(delta, "local"|"world")、self.rotateY(rad)、self.forward、self.right、self.moveToward(target, maxDist, { faceTarget?, planeXZ? })、self.lookAt(target, { yOnly? })。',
      '   - 节点与标签：self.addTag/removeTag/hasTag（或 self.node.addTag/...）、self.node.parent、self.node.getChildren()、self.findNodeById(id)、self.findNodesByTag(tag)、self.findNodesInRadius(center, radius, tag?)、self.sendMessage(name, payload?)、self.broadcast(name, payload?)、self.getBehavior(behavior)。注意：pool.acquire / cloneNode / spawnPrefab / findNodeById / findNodesByTag 返回的直接是 NodeHandle（或 null/undefined），给生成出的对象加标签直接写 if (unit) unit.addTag("...")，严禁写 unit.node.addTag！',
      '   - 物理与导航：self.physics.raycast(origin, dir, maxDist)、sphereCast(center, radius, opts?)、getVelocity()、setVelocity(v)、applyImpulse(v)、applyForce(v)；self.nav.moveTo(target, speed?) / stop() / isMoving。',
      '   - Spline 路径运动：可在场景创建 kind="spline" 的曲线节点（3D 视口可直接拖动控制点编辑），然后传给 Spline 组件的 pathNodeId 或脚本：self.spline.create(splineNode, { closed?, tension? }) -> { length, pointAt(t), tangentAt(t), pointAtDistance(d) }；self.spline.follow(splineNode, { speed?, loop?, pingPong?, closed?, faceDirection?, planeXZ?, startProgress?, onArrive? })、self.spline.stop()、self.spline.isFollowing、self.spline.progress。',
      '   - 群体避让与编队（Crowd）：可挂 capabilities.crowd 组件，并在脚本用 self.crowd.moveTo(target, opts) / self.crowd.stop() / self.crowd.formation(units, center, { formation: "line"|"grid"|"wedge"|"circle", spacing? })（defineSystem 中用 world.crowd）。',
      '   - 通用弹道（Projectile）：可挂 capabilities.projectile 组件（mode: "linear"|"homing"|"ballistic"），并在脚本用 self.projectile.launch({ direction?, target?, mode?, speed?, damage?, targetTag?, onHit? })（命中自动触发 onProjectileHit 消息并按配置回池/销毁；defineSystem 中用 world.projectile）。',
      '   - Tween 动效与动画曲线：',
      '     · self.tween.to(targetNode, { position?, rotation?, scale? }, duration, { ease?: "outQuad"|"outBack"|"outBounce"|"inOutCubic"|..., delay?, repeat?, yoyo?, onUpdate?, onComplete? })',
      '     · self.tween.value(from, to, duration, (v) => {}, opts?)、self.tween.punchScale(strength?, dur?)、self.tween.shakePosition(intensity?, dur?)、self.tween.cancel(id) / cancelAll()',
      '     · self.curve.create([[0,0],[0.5,1],[1,0]], { wrap? }) / self.curve.eval(keys, t) / self.curve.ease(name, t) / self.curve.parabola(t, height?) / self.curve.pulse(t)',
      '   - 动画、音效与特效：self.anim.playBody(clipName, { loop?, fade?, speed? }) / playUpper(clipName, opts?) / stopUpper(fade?)（T3D 引擎已内置蒙皮骨骼自动重定向，直接传 `ref(target: "clip")` 参数或剪辑名即可自动匹配外部动画资产并播放，严禁新建测试/probe 脚本探测兼容性，也不要再额外建同名 string 剪辑名参数）；self.audio.playSfx(assetId, opts?) / playBgm(assetId, opts?) / stopBgm()；self.fx.spawn(effectId, pos, { scale? })。',
      '   - 键盘/鼠标/滚轮输入：self.input.moveDirection("Move")（相对当前相机的世界水平移动方向 { x, 0, z }，长度为输入强度 0~1；做相对相机的移动直接用它乘速度即可）、axis2D("Move")（原始二维轴）、axis1D(action)、isPressed / justPressed / isKeyPressed("KeyW")、pointerDelta()、pointerPosition()、wheelDelta()、isMouseButtonPressed / justPressedMouseButton / justReleasedMouseButton(0|1|2)。',
      '   - UI 与屏幕控制：self.ui.getVar(key) / setVar(key, val)、self.ui.onEvent(eventName, (payload) => {})、self.ui.showScreen/hideScreen/toggleScreen/isScreenVisible(nameOrId)、self.ui.worldToScreen(posOrNode) -> { x, y, ndcX, ndcY, visible } | null（3D 坐标转屏幕坐标，用于头顶血条/飘字）。',
      '   - 全局系统（无需挂节点，适合波次/经济/胜负状态机）：也可使用 defineSystem({ name, stage?: "prePhysics"|"postPhysics"|"postAnimation"|"preRender", state: () => ({...}), onMount(world, state) {}, onUpdate(world, state, dt) {}, onDispose(world, state) {} })，world 提供 pool/cloneNode/spawnPrefab/findNodesByTag/after/every/ui/input/global 等完整全局 API。',
      '   - 存储与策划表：self.global / self.storage (get/set/remove)、self.tables.getRow(tableId, rowId)、self.scene.currentId() / load(id)、self.log(...)、self.warn(...)。',
      '   - 参数（params）类型与引用规范：number / boolean / string / color / vec2 / vec3 / vec4 / enum / texture / ref（target: "node" | "asset" | "clip" | "tableRow"，asset 可带 kinds: ["prefab"|"model"|"audio"|"effect"|"material"|"ui"|"scene"]）。**铁律**：凡是引用场景节点、预制体、模型、动画片段(clip)、音效、特效、材质、贴图或数据表行的参数，一律必须声明为 `{ type: "ref", target: ..., kinds?: [...], label, default: null }`（或 `type: "texture"`），严禁用 `type: "string"` 让用户手填字符串 ID，这样属性面板才会显示弹窗选择器和拖放槽位！vec2/vec3/vec4 必须提供数组形式 default（如 [0,0,0]）。',
      '   - 运行时约定（容易踩坑）：',
      '     · 方向：相对相机移动用 self.input.moveDirection()，不要读相机节点的 rotation 自己算方位角（欧拉角在相机有俯仰时会算偏，这是方向 bug 的常见来源）。yaw=0 时 self.forward 指向 +Z；self.input.axis2D("Move") 的 y 向前（W）为正、x 向右（D）为正。默认已注册的输入动作：Move / Jump / Sprint / Dash / Interact / Attack，其它动作先用 input__set_action 注册。',
      '     · 消息：self.broadcast(name, payload) 会送达所有脚本的 onMessage；node.sendMessage 只送达该节点；UI 按钮的 sendMessage 点击同样以广播形式送达 onMessage（也可用 self.ui.onEvent 监听）。',
      '     · 对象池：隐藏的模板节点自身也会执行脚本，池化实体的脚本要在 onUpdate 开头写 if (!self.visible) return，并且只在可见实例上打标签；pool.acquire 会依次触发实例的 onStart 与 onSpawn(self, payload)，state 会重置。',
      '     · self.physics.raycast 目前只可靠返回 distance 与 point（命中的是哪个节点不可靠）；需要知道：onDrawGizmos(self, gizmos) 支持 gizmos.isSelected、line、arrow、wireSphere、wireBox、disc、radiusHandle、positionHandle。',
    )

  lines.push(
      '',
      '【着色器】编写自定义着色器（shader__create / shader__update）时，必须从 "t3d/shader" 导入 defineShader 与 TSL 节点函数，并严格使用：',
      '   export default defineShader({ name: "中文名称", mode: "lit" | "unlit", transparent?: true, doubleSided?: false, params: { ... }, surface(p) { return { baseColor, emissive, roughness, metalness, opacity, normal, vertexOffset } } })',
      '   - 严格规则：返回键名必须是 baseColor（不是 color）；params 中声明的所有参数必须在 surface(p) 中实际参与计算；使用 opacity 时需设置 transparent: true。',
      '   - 可用节点（从 "t3d/shader" 导入）：uv(index?)、time、deltaTime、normalView、normalWorld、normalLocal、positionWorld、positionLocal、viewDirection、cameraPosition、screenUV、vertexColor()；构造：float、vec2、vec3、vec4、color；函数：mix、clamp、smoothstep、step、saturate、sin、cos、tan、abs、sign、floor、ceil、fract、pow、sqrt、exp、log、min、max、dot、cross、normalize、length、distance、reflect、fwidth、fresnel(normal, viewDir, power?)（支持 .add/.sub/.mul/.div/.pow/.min/.max/.clamp/.abs/.floor/.ceil/.fract/.saturate/.oneMinus/.negate）。',
      '   - 编写完成后，可用 shader__bind 绑定到指定材质或节点。',
    )

  lines.push(
      '',
      '【UI】创建/修改 UI 界面（推荐优先 ui__createFromTemplate，再按需 ui__updateDocument / query__ui_inspect）：',
      '   - 优先使用 ui__createFromTemplate({ template: "hud"|"menu"|"dialog"|"result", title, subtitle, primaryText, secondaryText, varKey, scoreVarKey, accentColor, mountToScene: true }) 生成规范版式骨架，避免从零手算坐标出错。',
      '   - 手写或修改 UiDocument（{ schemaVersion: 1, root: UiNode }）排版铁律：',
      '     · 根节点 root 必须全屏铺满（mode: "anchor", anchorMin: {x:0,y:0}, anchorMax: {x:1,y:1}, pivot: {x:0,y:0}）。',
      '     · 四角停靠 HUD 只在顶层放容器并用 anchor 停靠（边距统一 24px，如左上 x:24,y:24 / 右上 anchorMin:{x:1,y:0},x:-24,y:24,pivot:{x:1,y:0} / 居中 anchor:{x:0.5,y:0.5},pivot:{x:0.5,y:0.5}），容器内部一律用 type: "stack" + mode: "flex"（flexDirection, gap: 8~14, padding, align, justify）自动流式排版，严禁在同容器内手算多个 anchor 像素坐标。',
      '     · 视觉规范：卡片深色半透明（rgba(15,23,42,0.82)）+ borderRadius: 8~12 + borderWidth: 1；正文 ≥14px、标题 20~28px、按钮高 36~44px。',
      '   - 数据绑定：bindings: [{ id: "b1", target: "text"|"visible"|"enabled"|"progress.value"|"opacity", source: { kind: "variable", varId: "hp" } }]；按钮事件：click: { kind: "sendMessage", message: "start_game" } 或 { kind: "setVariable", varId: "...", value: "..." }。',
    )

  lines.push(
      '',
      '【能力包】能力包与玩法包：挂载物理、粒子、水面、天空、导航等能力前，建议先调用 query__registry_describe（指定 category）确认能力 ID 与参数 Schema。',
    )

  cachedSystemPrompt = lines.join('\n')
  return cachedSystemPrompt
}
