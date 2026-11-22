import { create } from 'zustand'
import { commandBus } from '../core/commands/bus'
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { createCheckpoint, formatDesignMarkdown, getDesignDoc, restoreCheckpoint } from '../core/project'
import { queryNodeInspect, queryProjectOverview } from '../core/query'
import { useAssetStore } from '../editor/assets/library'
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

  setPanelOpen: (open: boolean) => void
  setQuickPromptOpen: (open: boolean) => void
  setPendingAttachmentImage: (dataUrl: string | null) => void
  addPendingRef: (ref: AiRefItem) => void
  removePendingRef: (kind: AiRefItem['kind'], id: string) => void
  clearPendingRefs: () => void
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

function toolPhaseLabel(toolName: string): string {
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

  return [
    '你是 T3D 游戏工程管理器的内置 AI 创作助手。',
    '核心原则：',
    '1. 只能通过提供的工具读取或修改工程数据，严格使用工具返回的准确节点 ID 或资产 ID（节点名称唯一时也可直接传节点名称），切勿凭记忆猜测或删改 UUID；如需查询登记清单，优先按具体 category 查询（避免不必要的全量 all）。',
    '2. 搭完或修改完场景后，务必调用 query__project_diagnose 做一次工程体检并修正错误。',
    '3. 若是新建游戏项目或需求发生方向变化，先用 project__design__update 维护 design.md 全局规范。',
    '4. 放置模型或物体到地面时，优先开启 snapToGround: true。',
    '5. 编写节点行为脚本（script__create / script__update）时，必须从 "t3d/runtime" 导入 defineBehavior，并严格使用：',
    '   export default defineBehavior({ name: "简短中文标题", description: "一句话介绍脚本作用（将展示在组件卡片下方）", params: { ... }, onUpdate(self, dt) { ... } })',
    '   脚本内置 API（严禁自己编造 window.__t3dKeys 等全局变量）：',
    '   - 移动/旋转/缩放：必须整体赋值（如 self.position = { x, y, z }，self.rotation = { x, y, z }），不要写 self.position.x = ...。',
    '   - 输入（WASD/方向键/手柄/触控）：用 const move = self.input.axis2D("Move")（返回 { x, y }，W/↑ 为 y=+1，D/→ 为 x=+1）；也可用 self.input.isPressed("Jump" | "KeyW" | "Space") / self.input.justPressed(...) / self.input.isKeyPressed("KeyW")。',
    '   - 鼠标与滚轮输入：用 self.input.pointerDelta() 获取本帧鼠标移动增量 { x, y }，self.input.pointerPosition() 获取视口归一化坐标 { x, y }（[-1, 1]），self.input.wheelDelta() 获取滚轮增量（正值拉远/向下，负值拉近/向上），self.input.isMouseButtonPressed(0 | 1 | 2) / justPressedMouseButton(0 | 1 | 2) 检测左/中/右键（0=左键, 1=中键, 2=右键）。',
    '   - 节点/资产引用参数：若脚本参数需要引用场景物体、资源或动画/表数据，请使用 { type: "ref", target: ..., label: "...", default: null }（面板会自动生成拖放与弹窗选择槽位，禁止用 type: "string" 存 ID）：',
    '     · 场景节点：{ type: "ref", target: "node", label: "目标", default: null }（运行时自动解析为 NodeHandle | null）',
    '     · 资源资产：{ type: "ref", target: "asset", kinds: ["audio" | "prefab" | "material" | "texture" | "effect" | "animation" | "model" | "ui" | "scene"], label: "...", default: null }（也可用 type: "texture"）',
    '     · 动画片段：{ type: "ref", target: "clip", label: "动画", default: null }；策划表条目：{ type: "ref", target: "tableRow", tableId: "tags" | "juice", label: "...", default: null }',
    '   - 节点查找与跟随：self.findNodeById(id)、self.findNodesByTag(tag)、self.moveToward(target, maxDist)、self.lookAt(target)。',
    '   - 编辑器专用 Gizmo（试玩时自动完全隐藏/不执行）：可定义 onDrawGizmos(self, gizmos) 绘制辅助线与交互手柄，例如 gizmos.wireSphere(self.position, self.params.radius, { color: "#38bdf8" })、gizmos.wireBox(center, size)、gizmos.disc(center, radius)、gizmos.line(from, to)、gizmos.arrow(from, dir, len)；选中节点时可用 gizmos.isSelected 判断，并用 gizmos.radiusHandle("radius") 或 gizmos.positionHandle("targetPos") 绑定可拖拽参数手柄。',
    '   - UI 与屏幕控制：self.ui.getVar(key) / self.ui.setVar(key, val) 读写界面变量；self.ui.onEvent(eventName, (payload) => { ... }) 监听按钮点击发送的 sendMessage 事件；self.ui.showScreen(nameOrId) / hideScreen(nameOrId) / toggleScreen(nameOrId) / isScreenVisible(nameOrId) 控制场景中 screen 屏幕显隐。',
    '6. 编写自定义着色器后，可用 shader__bind 绑定到指定材质或节点。',
    '7. 创建/修改 UI 界面（ui__createDocument / ui__updateDocument / query__ui_inspect）：',
    '   - document 格式：{ schemaVersion: 1, root: UiNode }；可用节点 type 为 "panel" | "stack" | "text" | "image" | "button" | "progress"。',
    '   - layout 支持 mode: "anchor"（anchorMin/anchorMax/pivot 取 0~1，x/y/width/height 像素）或 mode: "flex"（flexDirection: "row"|"column", gap, align, justify, padding）。',
    '   - 数据绑定：bindings: [{ id: "b1", target: "text"|"visible"|"enabled"|"progress.value"|"opacity", source: { kind: "variable", varId: "hp" } }]；按钮事件：click: { kind: "sendMessage", message: "start_game" } 或 { kind: "setVariable", varId: "...", value: "..." }。',
    '',
    '当前工程设计规范（design.md）：',
    designMd,
    '',
    `当前工程概览：${overview}${nodeIndexText}${refsContext}`,
  ].join('\n')
}
