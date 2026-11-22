import { net } from 'electron'
import type { ProviderConfigPublic } from './secretStore'

export interface ChatToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ChatToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  /** 参数 JSON 无法解析（通常是输出被长度上限截断）时给出原因，调用方不应执行该工具 */
  invalid?: string
}

export type ChatMessage =
  | { role: 'user'; text: string; images?: string[] }
  | {
      role: 'assistant'
      text: string
      toolCalls?: ChatToolCall[]
      /** 各厂商需要原样回传的思考内容（Anthropic thinking 块 / reasoning_content / Gemini thoughtSignature） */
      providerState?: unknown
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface ChatRequest {
  providerId?: string
  model?: string
  system: string
  messages: ChatMessage[]
  tools: ChatToolSpec[]
}

export interface ChatDelta {
  requestId: string
  type: 'text' | 'reasoning' | 'tool' | 'done' | 'error'
  text?: string
  /** type === 'tool' 时：模型开始生成该工具的参数 */
  toolName?: string
  error?: string
}

export type ChatStopReason = 'stop' | 'tool' | 'length' | 'other'

export interface ChatResult {
  text: string
  toolCalls: ChatToolCall[]
  usage?: {
    /** 输入 token 总数（已含缓存命中部分） */
    inputTokens?: number
    outputTokens?: number
    /** 其中命中提示缓存的输入 token 数 */
    cachedTokens?: number
  }
  model: string
  stopReason: ChatStopReason
  providerState?: unknown
}

const TRUNCATED_ARGS_REASON = '工具参数 JSON 不完整（模型输出被长度上限截断或格式损坏）'

async function fetchWithProxyAndRetry(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  const fetcher: typeof fetch = typeof net?.fetch === 'function' ? net.fetch.bind(net) : globalThis.fetch
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal.aborted) {
      throw new Error('请求已取消')
    }
    try {
      return await fetcher(url, { ...init, signal })
    } catch (error) {
      lastError = error
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 600))
      }
    }
  }
  throw new Error(formatNetworkError(url, lastError))
}

function formatNetworkError(url: string, error: unknown): string {
  const errObj = error as { message?: string; code?: string; cause?: { code?: string; message?: string } } | null
  const baseMsg = errObj?.message || String(error)
  const causeMsg = errObj?.cause?.message
  const code = errObj?.cause?.code || errObj?.code
  let host = url
  try {
    host = new URL(url).origin
  } catch {
    // keep raw url
  }
  const detail = [code, causeMsg && causeMsg !== baseMsg ? causeMsg : ''].filter(Boolean).join(' / ')
  return `连接模型服务失败（${host}）：${baseMsg}${detail ? ` [${detail}]` : ''}。请检查网络、系统代理或接口地址配置。`
}

export async function invokeModelChat(
  config: ProviderConfigPublic,
  apiKey: string,
  req: ChatRequest,
  onDelta: (delta: ChatDelta) => void,
  requestId: string,
  signal: AbortSignal,
): Promise<ChatResult> {
  const model = req.model?.trim() || config.model
  switch (config.providerType) {
    case 'anthropic':
      return callAnthropic(config.baseUrl, apiKey, model, req, onDelta, requestId, signal)
    case 'gemini':
      return callGemini(config.baseUrl, apiKey, model, req, onDelta, requestId, signal)
    case 'openai':
    case 'openai-compatible':
      return callOpenAiCompatible(config.baseUrl, apiKey, model, req, onDelta, requestId, signal)
  }
}

/** 解析流式拼出的工具参数；失败时标记 invalid，由调用方决定如何反馈给模型 */
function parseToolArguments(raw: string): { arguments: Record<string, unknown>; invalid?: string } {
  if (!raw.trim()) return { arguments: {} }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { arguments: parsed as Record<string, unknown> }
    }
    return { arguments: {}, invalid: '工具参数必须是 JSON 对象' }
  } catch {
    return { arguments: {}, invalid: TRUNCATED_ARGS_REASON }
  }
}

function parseDataUrlImage(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl)
  if (!match) return null
  return { mediaType: match[1], data: match[2] }
}

async function readSseLines(body: ReadableStream<Uint8Array>, onData: (data: string) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const flushLine = (rawLine: string) => {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (payload) onData(payload)
  }
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      flushLine(buffer.slice(0, nl))
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
    }
  }
  if (buffer.trim()) flushLine(buffer)
}

function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// OpenAI / OpenAI 兼容
// ---------------------------------------------------------------------------

interface OpenAiVariant {
  /** 请求流末尾附带 usage 统计 */
  streamUsage: boolean
  /** 把上一步的 reasoning_content 原样回传（部分思考模型在工具调用续写时要求） */
  echoReasoning: boolean
}

const OPENAI_VARIANTS: OpenAiVariant[] = [
  { streamUsage: true, echoReasoning: true },
  { streamUsage: true, echoReasoning: false },
  { streamUsage: false, echoReasoning: false },
]

/** 记住每个接口+模型实际可用的请求形态，避免每次都先失败一轮 */
const openAiVariantMemo = new Map<string, number>()

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  req: ChatRequest,
  onDelta: (delta: ChatDelta) => void,
  requestId: string,
  signal: AbortSignal,
): Promise<ChatResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const memoKey = `${url}::${model}`

  const buildMessages = (variant: OpenAiVariant): unknown[] => {
    const messages: unknown[] = [{ role: 'system', content: req.system }]
    for (const msg of req.messages) {
      if (msg.role === 'user') {
        if (msg.images && msg.images.length > 0) {
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: msg.text },
              ...msg.images.map((img) => ({ type: 'image_url', image_url: { url: img } })),
            ],
          })
        } else {
          messages.push({ role: 'user', content: msg.text })
        }
      } else if (msg.role === 'assistant') {
        const reasoning = (msg.providerState as { reasoningContent?: string } | undefined)?.reasoningContent
        messages.push({
          role: 'assistant',
          content: msg.text || null,
          ...(variant.echoReasoning && reasoning ? { reasoning_content: reasoning } : {}),
          ...(msg.toolCalls && msg.toolCalls.length > 0
            ? {
                tool_calls: msg.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function',
                  function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments),
                  },
                })),
              }
            : {}),
        })
      } else if (msg.role === 'tool') {
        messages.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        })
      }
    }
    return messages
  }

  const tools = req.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))

  let resp: Response | null = null
  let variantIndex = openAiVariantMemo.get(memoKey) ?? 0
  for (; variantIndex < OPENAI_VARIANTS.length; variantIndex += 1) {
    const variant = OPENAI_VARIANTS[variantIndex]
    resp = await fetchWithProxyAndRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(variant),
        ...(tools.length > 0 ? { tools } : {}),
        stream: true,
        ...(variant.streamUsage ? { stream_options: { include_usage: true } } : {}),
      }),
    }, signal)
    if (resp.ok && resp.body) break
    const canDegrade = (resp.status === 400 || resp.status === 422) && variantIndex + 1 < OPENAI_VARIANTS.length
    if (!canDegrade) {
      const errText = await resp.text().catch(() => resp?.statusText ?? '')
      throw new Error(`模型请求失败 (${resp.status}): ${errText}`)
    }
  }
  if (!resp || !resp.ok || !resp.body) {
    throw new Error('模型请求失败：未获得有效响应')
  }
  openAiVariantMemo.set(memoKey, Math.min(variantIndex, OPENAI_VARIANTS.length - 1))

  let fullText = ''
  let reasoningText = ''
  let finishReason = ''
  let streamError = ''
  const toolAcc = new Map<number, { id: string; name: string; argsText: string; announced: boolean }>()
  let usage: ChatResult['usage']

  await readSseLines(resp.body, (dataStr) => {
    if (dataStr === '[DONE]') return
    const chunk = tryParseJson<{
      error?: { message?: string } | string
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
        prompt_cache_hit_tokens?: number
      } | null
      choices?: Array<{
        finish_reason?: string | null
        delta?: {
          content?: string | null
          reasoning_content?: string | null
          reasoning?: string | null
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }>(dataStr)
    if (!chunk) return
    if (chunk.error) {
      streamError = typeof chunk.error === 'string' ? chunk.error : chunk.error.message || '未知流式错误'
      return
    }
    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
        cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? chunk.usage.prompt_cache_hit_tokens,
      }
    }
    const choice = chunk.choices?.[0]
    if (choice?.finish_reason) finishReason = choice.finish_reason
    const delta = choice?.delta
    if (!delta) return
    const reasoningDelta = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoningDelta === 'string' && reasoningDelta) {
      reasoningText += reasoningDelta
      onDelta({ requestId, type: 'reasoning', text: reasoningDelta })
    }
    if (delta.content) {
      fullText += delta.content
      onDelta({ requestId, type: 'text', text: delta.content })
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0
        const prev = toolAcc.get(idx) ?? { id: tc.id || `call_${idx}`, name: '', argsText: '', announced: false }
        if (tc.id) prev.id = tc.id
        if (tc.function?.name) prev.name += tc.function.name
        if (tc.function?.arguments) prev.argsText += tc.function.arguments
        if (!prev.announced && prev.name) {
          prev.announced = true
          onDelta({ requestId, type: 'tool', toolName: prev.name })
        }
        toolAcc.set(idx, prev)
      }
    }
  })

  if (streamError) {
    throw new Error(`模型流式响应出错：${streamError}`)
  }

  const toolCalls: ChatToolCall[] = Array.from(toolAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .filter(([, tc]) => tc.name)
    .map(([, tc]) => {
      const parsed = parseToolArguments(tc.argsText)
      return {
        id: tc.id,
        name: tc.name,
        arguments: parsed.arguments,
        ...(parsed.invalid ? { invalid: parsed.invalid } : {}),
      }
    })

  const stopReason: ChatStopReason =
    finishReason === 'length'
      ? 'length'
      : toolCalls.length > 0
        ? 'tool'
        : finishReason === 'stop' || !finishReason
          ? 'stop'
          : 'other'

  onDelta({ requestId, type: 'done' })
  return {
    text: fullText,
    toolCalls,
    usage,
    model,
    stopReason,
    ...(reasoningText ? { providerState: { reasoningContent: reasoningText } } : {}),
  }
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

type AnthropicThinkingMode = 'adaptive' | 'budget' | 'off'

interface AnthropicVariant {
  thinking: AnthropicThinkingMode
  maxTokens: number
}

const ANTHROPIC_THINKING_ORDER: AnthropicThinkingMode[] = ['adaptive', 'budget', 'off']
const ANTHROPIC_MAX_TOKENS_ORDER = [32000, 16000, 8192, 4096]

const anthropicVariantMemo = new Map<string, AnthropicVariant>()

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

function buildAnthropicMessages(req: ChatRequest): Array<{ role: 'user' | 'assistant'; content: Array<Record<string, unknown>> }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: Array<Record<string, unknown>> }> = []
  const pushUserBlocks = (blocks: Array<Record<string, unknown>>) => {
    const last = messages[messages.length - 1]
    // 同一轮的多个工具结果（及随后的截图）必须合并在同一条 user 消息里
    if (last && last.role === 'user') last.content.push(...blocks)
    else messages.push({ role: 'user', content: blocks })
  }

  for (const msg of req.messages) {
    if (msg.role === 'user') {
      const blocks: Array<Record<string, unknown>> = [{ type: 'text', text: msg.text || '请查看图片' }]
      for (const img of msg.images ?? []) {
        const parsed = parseDataUrlImage(img)
        if (parsed) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data },
          })
        }
      }
      pushUserBlocks(blocks)
    } else if (msg.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = []
      const saved = (msg.providerState as { anthropicBlocks?: AnthropicBlock[] } | undefined)?.anthropicBlocks
      const callsById = new Map((msg.toolCalls ?? []).map((tc) => [tc.id, tc]))
      if (saved && saved.length > 0) {
        // 按原始顺序回放：思考块必须原样（含签名）；工具入参取当前消息里的版本（可能已被折叠）
        for (const block of saved) {
          if (block.type === 'thinking' || block.type === 'redacted_thinking') {
            blocks.push(block)
          } else if (block.type === 'text') {
            if (block.text) blocks.push({ type: 'text', text: block.text })
          } else if (block.type === 'tool_use') {
            const current = callsById.get(block.id)
            if (current) {
              blocks.push({ type: 'tool_use', id: current.id, name: current.name, input: current.arguments })
            }
          }
        }
      } else {
        if (msg.text) blocks.push({ type: 'text', text: msg.text })
        for (const tc of msg.toolCalls ?? []) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })
        }
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: '（无输出）' })
      messages.push({ role: 'assistant', content: blocks })
    } else if (msg.role === 'tool') {
      pushUserBlocks([{ type: 'tool_result', tool_use_id: msg.toolCallId, content: msg.content }])
    }
  }

  // 移动缓存断点：标在最后一条 user 消息的末块，使「系统提示 + 工具 + 之前全部对话」整体命中缓存
  const last = messages[messages.length - 1]
  if (last && last.role === 'user' && last.content.length > 0) {
    const tail = last.content[last.content.length - 1]
    last.content[last.content.length - 1] = { ...tail, cache_control: { type: 'ephemeral' } }
  }
  return messages
}

async function callAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  req: ChatRequest,
  onDelta: (delta: ChatDelta) => void,
  requestId: string,
  signal: AbortSignal,
): Promise<ChatResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/messages`
  const memoKey = `${url}::${model}`
  const messages = buildAnthropicMessages(req)
  const tools = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))

  let variant: AnthropicVariant = anthropicVariantMemo.get(memoKey) ?? {
    thinking: ANTHROPIC_THINKING_ORDER[0],
    maxTokens: ANTHROPIC_MAX_TOKENS_ORDER[0],
  }
  let resp: Response | null = null

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const thinkingBudget = Math.min(10000, variant.maxTokens - 4096)
    const thinking =
      variant.thinking === 'adaptive'
        ? { type: 'adaptive' }
        : variant.thinking === 'budget' && thinkingBudget >= 1024
          ? { type: 'enabled', budget_tokens: thinkingBudget }
          : null
    resp = await fetchWithProxyAndRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: variant.maxTokens,
        // 系统提示保持静态并打缓存断点（工具定义位于其前，一并命中）
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages,
        ...(tools.length > 0 ? { tools } : {}),
        ...(thinking ? { thinking } : {}),
        stream: true,
      }),
    }, signal)
    if (resp.ok && resp.body) break

    const errText = await resp.text().catch(() => resp?.statusText ?? '')
    if (resp.status === 400) {
      // 不同模型支持的思考形态与输出上限不同：按报错内容逐级降级后重试
      const lower = errText.toLowerCase()
      const thinkingIdx = ANTHROPIC_THINKING_ORDER.indexOf(variant.thinking)
      const tokensIdx = ANTHROPIC_MAX_TOKENS_ORDER.indexOf(variant.maxTokens)
      if (/thinking|budget_tokens|adaptive/.test(lower) && thinkingIdx + 1 < ANTHROPIC_THINKING_ORDER.length) {
        variant = { ...variant, thinking: ANTHROPIC_THINKING_ORDER[thinkingIdx + 1] }
        continue
      }
      if (/max_tokens/.test(lower) && tokensIdx + 1 < ANTHROPIC_MAX_TOKENS_ORDER.length) {
        variant = { ...variant, maxTokens: ANTHROPIC_MAX_TOKENS_ORDER[tokensIdx + 1] }
        continue
      }
    }
    throw new Error(`Anthropic 请求失败 (${resp.status}): ${errText}`)
  }
  if (!resp || !resp.ok || !resp.body) {
    throw new Error('Anthropic 请求失败：未获得有效响应')
  }
  anthropicVariantMemo.set(memoKey, variant)

  const blocks = new Map<number, AnthropicBlock & { jsonText?: string }>()
  let stopReasonRaw = ''
  let inputTokens = 0
  let cacheRead = 0
  let cacheWrite = 0
  let outputTokens = 0
  let streamError = ''

  await readSseLines(resp.body, (dataStr) => {
    const evt = tryParseJson<{
      type?: string
      index?: number
      message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } }
      content_block?: { type?: string; id?: string; name?: string; text?: string; thinking?: string; signature?: string; data?: string }
      delta?: { type?: string; text?: string; partial_json?: string; thinking?: string; signature?: string; stop_reason?: string }
      usage?: { output_tokens?: number }
      error?: { message?: string }
    }>(dataStr)
    if (!evt?.type) return
    if (evt.type === 'error') {
      streamError = evt.error?.message || '未知流式错误'
      return
    }
    if (evt.type === 'message_start') {
      const u = evt.message?.usage
      inputTokens = u?.input_tokens ?? 0
      cacheRead = u?.cache_read_input_tokens ?? 0
      cacheWrite = u?.cache_creation_input_tokens ?? 0
      outputTokens = u?.output_tokens ?? 0
      return
    }
    if (evt.type === 'content_block_start' && typeof evt.index === 'number' && evt.content_block) {
      const cb = evt.content_block
      if (cb.type === 'text') {
        blocks.set(evt.index, { type: 'text', text: cb.text ?? '' })
      } else if (cb.type === 'thinking') {
        blocks.set(evt.index, { type: 'thinking', thinking: cb.thinking ?? '', signature: cb.signature ?? '' })
      } else if (cb.type === 'redacted_thinking') {
        blocks.set(evt.index, { type: 'redacted_thinking', data: cb.data ?? '' })
      } else if (cb.type === 'tool_use' && cb.id && cb.name) {
        blocks.set(evt.index, { type: 'tool_use', id: cb.id, name: cb.name, input: {}, jsonText: '' })
        onDelta({ requestId, type: 'tool', toolName: cb.name })
      }
      return
    }
    if (evt.type === 'content_block_delta' && typeof evt.index === 'number' && evt.delta) {
      const block = blocks.get(evt.index)
      if (!block) return
      const d = evt.delta
      if (d.type === 'text_delta' && block.type === 'text' && d.text) {
        block.text += d.text
        onDelta({ requestId, type: 'text', text: d.text })
      } else if (d.type === 'thinking_delta' && block.type === 'thinking' && d.thinking) {
        block.thinking += d.thinking
        onDelta({ requestId, type: 'reasoning', text: d.thinking })
      } else if (d.type === 'signature_delta' && block.type === 'thinking' && d.signature) {
        block.signature += d.signature
      } else if (d.type === 'input_json_delta' && block.type === 'tool_use' && d.partial_json) {
        block.jsonText = (block.jsonText ?? '') + d.partial_json
      }
      return
    }
    if (evt.type === 'message_delta') {
      if (evt.delta?.stop_reason) stopReasonRaw = evt.delta.stop_reason
      if (typeof evt.usage?.output_tokens === 'number') outputTokens = evt.usage.output_tokens
    }
  })

  if (streamError) {
    throw new Error(`Anthropic 流式响应出错：${streamError}`)
  }

  let text = ''
  const toolCalls: ChatToolCall[] = []
  const savedBlocks: AnthropicBlock[] = []
  for (const [, block] of Array.from(blocks.entries()).sort((a, b) => a[0] - b[0])) {
    if (block.type === 'text') {
      text += block.text
      savedBlocks.push({ type: 'text', text: block.text })
    } else if (block.type === 'thinking') {
      // 没有签名的思考块（流被截断）不能回传
      if (block.signature) savedBlocks.push({ type: 'thinking', thinking: block.thinking, signature: block.signature })
    } else if (block.type === 'redacted_thinking') {
      savedBlocks.push({ type: 'redacted_thinking', data: block.data })
    } else if (block.type === 'tool_use') {
      const parsed = parseToolArguments(block.jsonText ?? '')
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: parsed.arguments,
        ...(parsed.invalid ? { invalid: parsed.invalid } : {}),
      })
      savedBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input: parsed.arguments })
    }
  }

  const stopReason: ChatStopReason =
    stopReasonRaw === 'max_tokens'
      ? 'length'
      : stopReasonRaw === 'tool_use' || toolCalls.length > 0
        ? 'tool'
        : stopReasonRaw === 'end_turn' || stopReasonRaw === 'stop_sequence' || !stopReasonRaw
          ? 'stop'
          : 'other'

  onDelta({ requestId, type: 'done' })
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: inputTokens + cacheRead + cacheWrite,
      outputTokens,
      cachedTokens: cacheRead,
    },
    model,
    stopReason,
    providerState: { anthropicBlocks: savedBlocks },
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

type GeminiPart = {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  [key: string]: unknown
}

/** Gemini 的函数声明只接受 JSON Schema 子集：去掉 additionalProperties，联合类型改写为 nullable */
function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'additionalProperties' || key === '$schema') continue
    if (key === 'type' && Array.isArray(value)) {
      const concrete = value.filter((t) => t !== 'null')
      out.type = concrete[0] ?? 'string'
      if (value.includes('null')) out.nullable = true
      continue
    }
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {}
      for (const [propKey, propSchema] of Object.entries(value as Record<string, unknown>)) {
        props[propKey] = sanitizeSchemaForGemini(propSchema)
      }
      out.properties = props
      continue
    }
    out[key] = sanitizeSchemaForGemini(value)
  }
  return out
}

async function callGemini(
  baseUrl: string,
  apiKey: string,
  model: string,
  req: ChatRequest,
  onDelta: (delta: ChatDelta) => void,
  requestId: string,
  signal: AbortSignal,
): Promise<ChatResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`
  const contents: Array<{ role: 'user' | 'model'; parts: unknown[] }> = []

  for (const msg of req.messages) {
    if (msg.role === 'user') {
      const parts: unknown[] = [{ text: msg.text || '请查看图片' }]
      for (const img of msg.images ?? []) {
        const parsed = parseDataUrlImage(img)
        if (parsed) {
          parts.push({ inlineData: { mimeType: parsed.mediaType, data: parsed.data } })
        }
      }
      contents.push({ role: 'user', parts })
    } else if (msg.role === 'assistant') {
      const saved = (msg.providerState as { geminiParts?: GeminiPart[] } | undefined)?.geminiParts
      let parts: unknown[] = []
      if (saved && saved.length > 0) {
        // 原样回放（保留 thoughtSignature）；函数调用入参按顺序取当前消息里的版本
        const calls = [...(msg.toolCalls ?? [])]
        parts = saved
          .map((part) => {
            if (!part.functionCall) return part
            const current = calls.shift()
            if (!current) return null
            return { ...part, functionCall: { name: current.name, args: current.arguments } }
          })
          .filter(Boolean)
      } else {
        if (msg.text) parts.push({ text: msg.text })
        for (const tc of msg.toolCalls ?? []) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments } })
        }
      }
      if (parts.length === 0) parts.push({ text: '（无输出）' })
      contents.push({ role: 'model', parts })
    } else if (msg.role === 'tool') {
      const part = {
        functionResponse: {
          name: msg.name,
          response: { result: msg.content },
        },
      }
      const last = contents[contents.length - 1]
      const lastIsToolResponses =
        last?.role === 'user' &&
        last.parts.length > 0 &&
        last.parts.every((p) => Boolean((p as { functionResponse?: unknown }).functionResponse))
      // 并行函数调用的结果必须放在同一条消息里
      if (lastIsToolResponses) last.parts.push(part)
      else contents.push({ role: 'user', parts: [part] })
    }
  }

  const tools = req.tools.length > 0
    ? [{
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: sanitizeSchemaForGemini(t.parameters),
        })),
      }]
    : undefined

  const resp = await fetchWithProxyAndRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents,
      ...(tools ? { tools } : {}),
    }),
  }, signal)

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => resp.statusText)
    throw new Error(`Gemini 请求失败 (${resp.status}): ${errText}`)
  }

  let text = ''
  let finishReason = ''
  let streamError = ''
  let usage: ChatResult['usage']
  const savedParts: GeminiPart[] = []
  const toolCalls: ChatToolCall[] = []

  await readSseLines(resp.body, (dataStr) => {
    const chunk = tryParseJson<{
      error?: { message?: string }
      candidates?: Array<{ finishReason?: string; content?: { parts?: GeminiPart[] } }>
      usageMetadata?: {
        promptTokenCount?: number
        candidatesTokenCount?: number
        thoughtsTokenCount?: number
        cachedContentTokenCount?: number
      }
    }>(dataStr)
    if (!chunk) return
    if (chunk.error) {
      streamError = chunk.error.message || '未知流式错误'
      return
    }
    if (chunk.usageMetadata) {
      usage = {
        inputTokens: chunk.usageMetadata.promptTokenCount,
        outputTokens: (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0),
        cachedTokens: chunk.usageMetadata.cachedContentTokenCount,
      }
    }
    const candidate = chunk.candidates?.[0]
    if (candidate?.finishReason) finishReason = candidate.finishReason
    for (const part of candidate?.content?.parts ?? []) {
      if (part.functionCall) {
        savedParts.push(part)
        toolCalls.push({
          id: `gemini_${Date.now()}_${toolCalls.length}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        })
        onDelta({ requestId, type: 'tool', toolName: part.functionCall.name })
        continue
      }
      if (typeof part.text === 'string' && part.text) {
        if (part.thought) {
          onDelta({ requestId, type: 'reasoning', text: part.text })
        } else {
          text += part.text
          onDelta({ requestId, type: 'text', text: part.text })
        }
        // 相邻且不带签名的同类文本片段合并，减少回放体积
        const prev = savedParts[savedParts.length - 1]
        if (
          prev &&
          typeof prev.text === 'string' &&
          !prev.functionCall &&
          !prev.thoughtSignature &&
          !part.thoughtSignature &&
          Boolean(prev.thought) === Boolean(part.thought)
        ) {
          prev.text += part.text
        } else {
          savedParts.push({ ...part })
        }
        continue
      }
      if (part.thoughtSignature) savedParts.push({ ...part })
    }
  })

  if (streamError) {
    throw new Error(`Gemini 流式响应出错：${streamError}`)
  }

  const stopReason: ChatStopReason =
    finishReason === 'MAX_TOKENS'
      ? 'length'
      : toolCalls.length > 0
        ? 'tool'
        : finishReason === 'STOP' || !finishReason
          ? 'stop'
          : 'other'

  onDelta({ requestId, type: 'done' })
  return {
    text,
    toolCalls,
    usage,
    model,
    stopReason,
    providerState: { geminiParts: savedParts },
  }
}
