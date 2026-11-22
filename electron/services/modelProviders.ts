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
}

export type ChatMessage =
  | { role: 'user'; text: string; images?: string[] }
  | { role: 'assistant'; text: string; toolCalls?: ChatToolCall[] }
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
  type: 'text' | 'done' | 'error'
  text?: string
  error?: string
}

export interface ChatResult {
  text: string
  toolCalls: ChatToolCall[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  model: string
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
      messages.push({
        role: 'assistant',
        content: msg.text || null,
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

  const tools = req.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))

  const resp = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      stream: true,
    }),
  })

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => resp.statusText)
    throw new Error(`模型请求失败 (${resp.status}): ${errText}`)
  }

  let fullText = ''
  const toolAcc = new Map<number, { id: string; name: string; argsText: string }>()
  let usage: ChatResult['usage']

  await readSseLines(resp.body, (dataStr) => {
    if (dataStr === '[DONE]') return
    const chunk = JSON.parse(dataStr) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      choices?: Array<{
        delta?: {
          content?: string | null
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
    }
    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
      }
    }
    const delta = chunk.choices?.[0]?.delta
    if (!delta) return
    if (delta.content) {
      fullText += delta.content
      onDelta({ requestId, type: 'text', text: delta.content })
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0
        const prev = toolAcc.get(idx) ?? { id: tc.id || `call_${idx}`, name: '', argsText: '' }
        if (tc.id) prev.id = tc.id
        if (tc.function?.name) prev.name += tc.function.name
        if (tc.function?.arguments) prev.argsText += tc.function.arguments
        toolAcc.set(idx, prev)
      }
    }
  })

  const toolCalls: ChatToolCall[] = Array.from(toolAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, tc]) => ({
      id: tc.id,
      name: tc.name,
      arguments: safeJsonObject(tc.argsText),
    }))

  onDelta({ requestId, type: 'done' })
  return { text: fullText, toolCalls, usage, model }
}

function parseDataUrlImage(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl)
  if (!match) return null
  return { mediaType: match[1], data: match[2] }
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
  const messages: unknown[] = []

  for (const msg of req.messages) {
    if (msg.role === 'user') {
      if (msg.images && msg.images.length > 0) {
        const blocks: unknown[] = [{ type: 'text', text: msg.text || '请查看图片' }]
        for (const img of msg.images) {
          const parsed = parseDataUrlImage(img)
          if (parsed) {
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data },
            })
          }
        }
        messages.push({ role: 'user', content: blocks })
      } else {
        messages.push({ role: 'user', content: msg.text })
      }
    } else if (msg.role === 'assistant') {
      const blocks: unknown[] = []
      if (msg.text) blocks.push({ type: 'text', text: msg.text })
      for (const tc of msg.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })
      }
      messages.push({ role: 'assistant', content: blocks })
    } else if (msg.role === 'tool') {
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: msg.toolCallId, content: msg.content }],
      })
    }
  }

  const tools = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))

  const resp = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: req.system,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText)
    throw new Error(`Anthropic 请求失败 (${resp.status}): ${errText}`)
  }

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }

  let text = ''
  const toolCalls: ChatToolCall[] = []
  for (const block of data.content ?? []) {
    if (block.type === 'text' && block.text) {
      text += block.text
      onDelta({ requestId, type: 'text', text: block.text })
    } else if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input ?? {},
      })
    }
  }

  onDelta({ requestId, type: 'done' })
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    },
    model,
  }
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
  const url = `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const contents: unknown[] = []

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
      const parts: unknown[] = []
      if (msg.text) parts.push({ text: msg.text })
      for (const tc of msg.toolCalls ?? []) {
        parts.push({ functionCall: { name: tc.name, args: tc.arguments } })
      }
      contents.push({ role: 'model', parts })
    } else if (msg.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: msg.name,
            response: { result: msg.content },
          },
        }],
      })
    }
  }

  const tools = req.tools.length > 0
    ? [{
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }]
    : undefined

  const resp = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents,
      ...(tools ? { tools } : {}),
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText)
    throw new Error(`Gemini 请求失败 (${resp.status}): ${errText}`)
  }

  const data = (await resp.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string
          functionCall?: { name: string; args?: Record<string, unknown> }
        }>
      }
    }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }

  let text = ''
  const toolCalls: ChatToolCall[] = []
  const parts = data.candidates?.[0]?.content?.parts ?? []
  parts.forEach((part, idx) => {
    if (part.text) {
      text += part.text
      onDelta({ requestId, type: 'text', text: part.text })
    }
    if (part.functionCall) {
      toolCalls.push({
        id: `gemini_${Date.now()}_${idx}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      })
    }
  })

  onDelta({ requestId, type: 'done' })
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
    },
    model,
  }
}

async function readSseLines(body: ReadableStream<Uint8Array>, onData: (data: string) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim()
        if (payload) onData(payload)
      }
      nl = buffer.indexOf('\n')
    }
  }
}

function safeJsonObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== 'string') return {}
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
