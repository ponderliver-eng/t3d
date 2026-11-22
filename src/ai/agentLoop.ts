import { create } from 'zustand'
import { commandBus } from '../core/commands/bus'
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { createCheckpoint, formatDesignMarkdown, getDesignDoc, restoreCheckpoint } from '../core/project'
import { queryNodeInspect, queryProjectOverview } from '../core/query'
import { useAssetStore } from '../editor/assets/library'
import { electronBridge } from '../editor/project/electronBridge'
import { useEditorStore } from '../editor/scene/store'
import { initAiHistorySync, saveAiHistory } from './historyStorage'
import {
  buildAiToolSpecs,
  executeAiTool,
  isConfirmRequiredTool,
  registerTaskPlanUpdater,
  type AiTaskPlanItem,
} from './tools'

export interface AiActionPill {
  id: string
  toolName: string
  label: string
  ok: boolean
  pending?: boolean
  targetNodeId?: string
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
  usage?: { inputTokens?: number; outputTokens?: number; model?: string }
  error?: string
  stopReason?: 'completed' | 'max-steps' | 'paused-with-plan'
  pendingTasksCount?: number
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

const MAX_TOOL_STEPS = 32

export const useAgentStore = create<AgentState>((set, get) => ({
  panelOpen: false,
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
        { id: currentAssistantId, role: 'assistant', text: '', actions: [], checkpointId: checkpoint.id },
      ],
    }))

    const systemPrompt = buildSystemPrompt(mergedRefs)
    const tools = buildAiToolSpecs()
    const chatMessages: Array<
      | { role: 'user'; text: string; images?: string[] }
      | { role: 'assistant'; text: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
      | { role: 'tool'; toolCallId: string; name: string; content: string }
    > = buildHistoryMessages(get().turns, currentAssistantId)

    commandBus.beginTransaction(`AI：${text.slice(0, 32)}`)
    let actions: AiActionPill[] = []
    let finalText = ''
    let totalIn = 0
    let totalOut = 0
    let usedModel = ''
    let txCommitted = false
    let stopReason: AiTurnItem['stopReason'] = 'completed'
    let autoNudges = 0
    let completedNormally = false

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
      currentAssistantId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      actions = []
      finalText = ''
      set((s) => ({
        turns: [
          ...s.turns,
          { id: currentAssistantId, role: 'assistant', text: '', actions: [] },
        ],
      }))
      return true
    }

    try {
      for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
        if (get().status === 'idle') break
        consumeSteerQueue()
        const reqId = `req_${Date.now()}_${step}`
        set({
          activeRequestId: reqId,
          streamingText: '',
          phaseText: step === 0 ? '正在思考方案…' : `正在思考下一步（第 ${step + 1}/${MAX_TOOL_STEPS} 步）…`,
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
            messages: compactMessagesForStep(chatMessages),
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
              t.id === currentAssistantId ? { ...t, text: finalText } : t,
            ),
          }))
        }

        if (result.toolCalls.length === 0) {
          if (consumeSteerQueue()) {
            continue
          }
          const remainingPlan = get().taskPlan.filter((t) => t.status !== 'done')
          if (remainingPlan.length > 0 && autoNudges < 1 && step + 1 < MAX_TOOL_STEPS) {
            autoNudges += 1
            chatMessages.push({ role: 'assistant', text: result.text || '（正在继续推进任务）' })
            chatMessages.push({
              role: 'user',
              text: `[系统自动续推] 当前任务清单仍有 ${remainingPlan.length} 项未完成（下一项：${remainingPlan[0].title}）。请勿提前停下等待，继续调用工具推进执行，完成阶段后同步更新 plan__set_tasks；仅在全部完成或必须由用户做关键决策时再结束。`,
            })
            continue
          }
          stopReason = remainingPlan.length > 0 ? 'paused-with-plan' : 'completed'
          completedNormally = true
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
              t.id === currentAssistantId ? { ...t, actions: [...actions, pendingPill] } : t,
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
              t.id === currentAssistantId ? { ...t, actions: [...actions] } : t,
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
                usage: { inputTokens: totalIn, outputTokens: totalOut, model: usedModel },
                stopReason,
                pendingTasksCount,
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
        steerQueue: [],
        turns: s.turns.map((t) =>
          t.id === currentAssistantId ? { ...t, text: finalText, actions, error: msg } : t,
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

registerTaskPlanUpdater((tasks) => {
  useAgentStore.setState({ taskPlan: tasks })
})

function toolPhaseLabel(toolName: string): string {
  if (toolName === 'plan__set_tasks') return '正在规划 / 更新任务进度…'
  if (toolName.startsWith('script__')) return '正在生成 / 编译脚本…'
  if (toolName.startsWith('shader__')) return '正在生成 / 编译着色器…'
  if (toolName.startsWith('scene__')) return '正在搭建 / 修改场景节点…'
  if (toolName.startsWith('asset__')) return '正在处理材质与资产…'
  if (toolName.startsWith('gameplay__') || toolName.startsWith('capability__')) return '正在配置玩法与能力包…'
  if (toolName === 'ui__createDocument') return '正在生成 UI 界面资产…'
  if (toolName === 'ui__updateDocument') return '正在更新 UI 界面结构…'
  if (toolName === 'ui__mountScreen') return '正在挂载 UI 屏幕到场景…'
  if (toolName === 'query__ui_inspect') return '正在读取 UI 界面结构…'
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
): Array<{ role: 'user' | 'assistant'; text: string; images?: string[] }> {
  const MAX_TURNS = 24
  const MAX_CHARS = 18000
  const MIN_KEEP = 4
  const MAX_IMAGES = 2

  const candidates = turns.filter(
    (t) => t.id !== excludeId && !t.error && (t.text.trim() || t.imageDataUrl || (t.actions && t.actions.length > 0)),
  )

  const picked: Array<{ role: 'user' | 'assistant'; text: string; images?: string[] }> = []
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

function compactMessagesForStep<
  T extends
    | { role: 'user'; text: string; images?: string[] }
    | { role: 'assistant'; text: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
    | { role: 'tool'; toolCallId: string; name: string; content: string },
>(messages: T[]): T[] {
  // 保留最近两轮助手工具调用的完整返回，更早步骤的超长工具 JSON 做折叠以控制 Token 消耗
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
  if (cutoffIndex === 0) return messages

  return messages.map((m, idx) => {
    if (idx < cutoffIndex && m.role === 'tool' && m.content.length > 800) {
      return {
        ...m,
        content: `[早先工具 ${m.name} 返回已折叠（原长 ${m.content.length} 字符），如需细节可重新查询]`,
      }
    }
    return m
  })
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

function buildSystemPrompt(attachedRefs: AiRefItem[]): string {
  const designMd = formatDesignMarkdown(getDesignDoc())
  const overview = JSON.stringify(queryProjectOverview())
  const sceneNodes = Object.values(useEditorStore.getState().nodes)
  const nodeIndexText = sceneNodes.length > 0
    ? `\n当前场景节点索引（名称 -> ID，共 ${sceneNodes.length} 个）：\n${sceneNodes
        .slice(0, 30)
        .map((n) => `- ${n.name} (${n.kind}): ${n.id}`)
        .join('\n')}${sceneNodes.length > 30 ? '\n- ...（更多节点请调用 query__scene_outline）' : ''}`
    : ''

  const refsContext = formatRefsContext(attachedRefs)
  const activePlan = useAgentStore.getState().taskPlan
  const planText = activePlan.length > 0
    ? `\n当前进行中的任务计划清单：\n${activePlan
        .map((t) => `- [${t.status}] (${t.id}) ${t.title}`)
        .join('\n')}`
    : ''

  return [
    '你是 T3D 游戏工程管理器的内置 AI 创作助手。',
    '核心原则：',
    '1. 长任务规划与连续执行：接到“做一个游戏”或包含多个模块/步骤的复杂任务时，第一步先调用 plan__set_tasks 拆解 3~7 个阶段性子任务，然后连续调用工具一气呵成推进，每完成一阶段顺便更新对应任务为 done，全部完成后务必调用 query__project_diagnose 做工程体检。不要刚建完几个节点或目录就提前停下汇报“已完成第一步”，除非需要用户做关键方向决策。',
    '2. 只能通过提供的工具读取或修改工程数据，严格使用工具返回的准确节点 ID 或资产 ID（节点名称唯一时也可直接传节点名称），切勿凭记忆猜测或删改 UUID；如需查询登记清单，优先按具体 category 查询（避免不必要的全量 all）。',
    '3. 工程规划与资源目录规范（中大型项目必做）：',
    '   - 遇到新建游戏、多模块/多关卡或资源较多（>5 个资产/物体）的需求时，先用 project__design__update 在 design.md 中规划目录与命名规范，再用 asset__createFolder 预先建立清晰的目录树：',
    '     · 推荐分类：Assets/Materials/<模块>（如 Characters / Environment / FX）、Assets/UI/<模块>（HUD / Menus）、Assets/Prefabs/<模块>、Assets/Models/<模块>、Assets/Textures/<模块>、Assets/Audio/<模块>、Assets/Scenes。',
    '   - 创建材质（asset__createMaterial）或 UI（ui__createDocument）时主动传入 folder；已有杂乱散落在 Assets 根目录的资产，可用 asset__moveToFolder 归类。',
    '   - 场景层级规范：用空节点（kind: "empty"）做模块分组（如 Environment、Characters、Lighting、UI、Systems），避免几十个节点平铺在场景根节点。',
    '   - 脚本与着色器命名规范：采用模块前缀（如 player_move、enemy_ai、ui_hud、fx_rim），保持语义清晰、职责单一。',
    '4. 放置模型或物体到地面时，优先开启 snapToGround: true。',
    '5. 编写节点行为脚本（script__create / script__update）时，必须从 "t3d/runtime" 导入 defineBehavior，并严格使用：',
    '   export default defineBehavior({ name: "简短中文标题", description: "一句话介绍脚本作用（将展示在组件卡片下方）", params: { ... }, state: () => ({ ... }), onStart(self) {}, onUpdate(self, dt) { ... }, onMessage(self, msg) {}, onDestroy(self) {}, onDrawGizmos(self, gizmos) {} })',
    '   脚本完整可用 API（严禁编造 window.__t3dKeys 等全局变量）：',
    '   - 变换与状态：self.position / self.rotation（弧度）/ self.scale（必须整体赋值，如 self.position = { x, y, z }，不要写 self.position.x = ...）、self.visible、self.elapsedTime、self.state、self.node。',
    '   - 移动与节点：self.moveToward(target, maxDist)、self.lookAt(target)、self.findNodeById(id)、self.findNodesByTag(tag)、self.findNodesInRadius(center, radius, tag?)、self.spawnPrefab(prefabId, opts?)、self.destroyNode(node)、self.sendMessage(name, payload?)、self.broadcast(name, payload?)、self.getBehavior(behavior)。',
    '   - 物理与导航：self.physics.raycast(origin, dir, maxDist)（返回 { node, point, normal, distance } | null）、self.nav.moveTo(target)。',
    '   - 动画与音效：self.anim.playBody(clipName, { loop?, fade?, speed? }) / playUpper(clipName, opts?) / stopUpper(fade?)；self.audio.playSfx(assetId, { volume?, pitch? }) / playBgm(assetId, { volume?, loop? }) / stopBgm()。',
    '   - 键盘/鼠标/滚轮输入：self.input.axis2D("Move")（{ x, y }）、self.input.axis1D(action)、self.input.isPressed(actionOrKey) / justPressed(...) / isKeyPressed("KeyW")、self.input.pointerDelta()、self.input.pointerPosition()（[-1, 1]）、self.input.wheelDelta()、self.input.isMouseButtonPressed(0|1|2) / justPressedMouseButton(0|1|2) / justReleasedMouseButton(0|1|2)。',
    '   - UI 与屏幕控制：self.ui.getVar(key) / setVar(key, val)、self.ui.onEvent(eventName, (payload) => {})、self.ui.showScreen(nameOrId) / hideScreen(nameOrId) / toggleScreen(nameOrId) / isScreenVisible(nameOrId)。',
    '   - 全局存储与策划表：self.global.get/set/remove、self.storage.get/set/remove、self.tables.getRow(tableId, rowId)、self.scene.currentId()、self.log(...)、self.warn(...)。',
    '   - 参数（params）类型：number / boolean / string / color / vec2 / vec3 / vec4 / enum / texture / ref：',
    '     · 场景节点：{ type: "ref", target: "node", label: "目标", default: null }（运行时自动解析为 NodeHandle | null）',
    '     · 资源资产：{ type: "ref", target: "asset", kinds: ["audio" | "prefab" | "material" | "texture" | "effect" | "animation" | "model" | "ui" | "scene"], label: "...", default: null }',
    '     · 动画片段：{ type: "ref", target: "clip", label: "动画", default: null }；策划表条目：{ type: "ref", target: "tableRow", tableId: "tags" | "juice", label: "...", default: null }',
    '   - 编辑器专用 Gizmo（试玩自动隐藏）：onDrawGizmos(self, gizmos) 支持 gizmos.isSelected、line(from, to)、arrow(from, dir, len)、wireSphere(center, radius)、wireBox(center, size)、disc(center, radius, { normal? })、radiusHandle(paramKey)、positionHandle(paramKey)。',
    '6. 编写自定义着色器（shader__create / shader__update）时，必须从 "t3d/shader" 导入 defineShader 与 TSL 节点函数，并严格使用：',
    '   export default defineShader({ name: "中文名称", mode: "lit" | "unlit", transparent?: true, doubleSided?: false, params: { ... }, surface(p) { return { baseColor, emissive, roughness, metalness, opacity, normal, vertexOffset } } })',
    '   - 严格规则：返回键名必须是 baseColor（不是 color）；params 中声明的所有参数必须在 surface(p) 中实际参与计算；使用 opacity 时需设置 transparent: true。',
    '   - 完整可用节点（从 "t3d/shader" 导入）：uv(index?)、time、deltaTime、normalView、normalWorld、normalLocal、positionWorld、positionLocal、viewDirection、cameraPosition、screenUV、vertexColor()；构造：float、vec2、vec3、vec4、color；函数：mix、clamp、smoothstep、step、saturate、sin、cos、tan、abs、sign、floor、ceil、fract、pow、sqrt、exp、log、min、max、dot、cross、normalize、length、distance、reflect、fwidth、fresnel(normal, viewDir, power?)（节点支持 .add/.sub/.mul/.div/.pow/.min/.max/.clamp/.abs/.floor/.ceil/.fract/.saturate/.oneMinus/.negate 链式调用）。',
    '   - 编写完成后，可用 shader__bind 绑定到指定材质或节点。',
    '7. 创建/修改 UI 界面（ui__createDocument / ui__updateDocument / query__ui_inspect）：',
    '   - document 格式：{ schemaVersion: 1, root: UiNode }；可用节点 type 为 "panel" | "stack" | "text" | "image" | "button" | "progress"。',
    '   - layout 支持 mode: "anchor"（anchorMin/anchorMax/pivot 取 0~1，x/y/width/height 像素）或 mode: "flex"（flexDirection: "row"|"column", gap, align, justify, padding）。',
    '   - 数据绑定：bindings: [{ id: "b1", target: "text"|"visible"|"enabled"|"progress.value"|"opacity", source: { kind: "variable", varId: "hp" } }]；按钮事件：click: { kind: "sendMessage", message: "start_game" } 或 { kind: "setVariable", varId: "...", value: "..." }。',
    '',
    '当前工程设计规范（design.md）：',
    designMd,
    '',
    `当前工程概览：${overview}${nodeIndexText}${refsContext}${planText}`,
  ].join('\n')
}
