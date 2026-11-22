import assert from 'node:assert/strict'
import test from 'node:test'
import { invokeModelChat, type ChatDelta, type ChatRequest } from '../electron/services/modelProviders'
import type { ProviderConfigPublic } from '../electron/services/secretStore'

type CapturedRequest = { url: string; body: Record<string, any> }

function sseResponse(events: unknown[], status = 200): Response {
  const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
  // 故意切成小块，验证跨分片的行缓冲
  const bytes = new TextEncoder().encode(text)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

function mockFetch(responder: (req: CapturedRequest, callIndex: number) => Response): CapturedRequest[] {
  const captured: CapturedRequest[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req: CapturedRequest = { url: String(input), body: JSON.parse(String(init?.body ?? '{}')) }
    captured.push(req)
    return responder(req, captured.length - 1)
  }) as typeof fetch
  return captured
}

function config(providerType: ProviderConfigPublic['providerType'], baseUrl: string): ProviderConfigPublic {
  return { id: providerType, providerType, label: providerType, baseUrl, model: 'test-model', hasApiKey: true } as ProviderConfigPublic
}

const TOOLS: ChatRequest['tools'] = [
  {
    name: 'script__create',
    description: '新建脚本',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, parentId: { type: ['string', 'null'] } },
      additionalProperties: false,
    },
  },
]

async function chat(cfg: ProviderConfigPublic, req: Partial<ChatRequest>) {
  const deltas: ChatDelta[] = []
  const result = await invokeModelChat(
    cfg,
    'key',
    { system: 'SYSTEM', messages: [{ role: 'user', text: '你好' }], tools: TOOLS, ...req },
    (d) => deltas.push(d),
    'req-1',
    new AbortController().signal,
  )
  return { result, deltas }
}

test('OpenAI 兼容：流式文本 + 工具调用 + 缓存用量', async () => {
  const captured = mockFetch(() =>
    sseResponse([
      { choices: [{ delta: { reasoning_content: '先想一下' } }] },
      { choices: [{ delta: { content: '好的' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'script__create', arguments: '{"id":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Mover"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } } },
      '[DONE]',
    ]),
  )
  const { result, deltas } = await chat(config('openai-compatible', 'https://a.example/v1'), {})
  assert.equal(captured[0].body.stream, true)
  assert.deepEqual(captured[0].body.stream_options, { include_usage: true })
  assert.equal(result.text, '好的')
  assert.equal(result.stopReason, 'tool')
  assert.deepEqual(result.toolCalls, [{ id: 'call_1', name: 'script__create', arguments: { id: 'Mover' } }])
  assert.deepEqual(result.usage, { inputTokens: 1000, outputTokens: 50, cachedTokens: 800 })
  assert.deepEqual(result.providerState, { reasoningContent: '先想一下' })
  assert.ok(deltas.some((d) => d.type === 'reasoning'))
  assert.ok(deltas.some((d) => d.type === 'tool' && d.toolName === 'script__create'))
})

test('OpenAI 兼容：输出被截断时标记 invalid，而不是静默变成空参数', async () => {
  mockFetch(() =>
    sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'script__create', arguments: '{"id":"Mover","source":"import' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
      '[DONE]',
    ]),
  )
  const { result } = await chat(config('openai-compatible', 'https://b.example/v1'), {})
  assert.equal(result.stopReason, 'length')
  assert.equal(result.toolCalls.length, 1)
  assert.ok(result.toolCalls[0].invalid, '截断的参数必须被标记')
  assert.deepEqual(result.toolCalls[0].arguments, {})
})

test('OpenAI 兼容：接口不认识扩展参数时自动降级重试，并回传 reasoning_content', async () => {
  const captured = mockFetch((_req, i) =>
    i === 0
      ? new Response('{"error":"unknown field reasoning_content"}', { status: 400 })
      : sseResponse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, '[DONE]']),
  )
  const { result } = await chat(config('openai-compatible', 'https://c.example/v1'), {
    messages: [
      { role: 'user', text: '做个脚本' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 'call_1', name: 'script__create', arguments: { id: 'A' } }],
        providerState: { reasoningContent: '思考过程' },
      },
      { role: 'tool', toolCallId: 'call_1', name: 'script__create', content: '{"ok":true}' },
    ],
  })
  assert.equal(captured.length, 2)
  assert.equal(captured[0].body.messages[2].reasoning_content, '思考过程')
  assert.equal(captured[1].body.messages[2].reasoning_content, undefined)
  assert.equal(result.text, 'ok')
  assert.equal(result.stopReason, 'stop')
})

test('Anthropic：流式思考 + 工具调用，缓存断点与思考块原样回传', async () => {
  const captured = mockFetch(() =>
    sseResponse([
      { type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 80, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '需要先建脚本' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '开始' } },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'script__create', input: {} } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"id":"Mo' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'ver"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 120 } },
      { type: 'message_stop' },
    ]),
  )
  const cfg = config('anthropic', 'https://d.example/v1')
  const first = await chat(cfg, {})
  const body = captured[0].body
  assert.equal(body.stream, true)
  assert.ok(body.max_tokens > 4096, '输出上限不应再是 4096')
  assert.deepEqual(body.thinking, { type: 'adaptive' })
  assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' })
  assert.deepEqual(body.messages.at(-1).content.at(-1).cache_control, { type: 'ephemeral' })

  assert.equal(first.result.text, '开始')
  assert.equal(first.result.stopReason, 'tool')
  assert.deepEqual(first.result.toolCalls, [{ id: 'toolu_1', name: 'script__create', arguments: { id: 'Mover' } }])
  assert.deepEqual(first.result.usage, { inputTokens: 1000, outputTokens: 120, cachedTokens: 900 })
  assert.ok(first.deltas.some((d) => d.type === 'reasoning'))

  // 第二步：带上上一步的 providerState 与两条工具结果
  await chat(cfg, {
    messages: [
      { role: 'user', text: '做个脚本' },
      { role: 'assistant', text: first.result.text, toolCalls: first.result.toolCalls, providerState: first.result.providerState },
      { role: 'tool', toolCallId: 'toolu_1', name: 'script__create', content: '{"ok":true}' },
      { role: 'user', text: '这是截图', images: ['data:image/png;base64,AAAA'] },
    ],
  })
  const second = captured[1].body.messages
  assert.equal(second.length, 3, '工具结果与随后的截图应合并为同一条 user 消息')
  assert.deepEqual(second[1].content[0], { type: 'thinking', thinking: '需要先建脚本', signature: 'SIG' })
  assert.equal(second[1].content[1].type, 'text')
  assert.equal(second[1].content[2].type, 'tool_use')
  assert.equal(second[2].content[0].type, 'tool_result')
  assert.equal(second[2].content.at(-1).type, 'image')
  assert.deepEqual(second[2].content.at(-1).cache_control, { type: 'ephemeral' })
})

test('Anthropic：模型不支持的思考形态 / 输出上限按报错逐级降级', async () => {
  const captured = mockFetch((req) => {
    if (req.body.thinking?.type === 'adaptive') {
      return new Response('{"error":{"message":"thinking.type: adaptive is not supported"}}', { status: 400 })
    }
    if (req.body.max_tokens > 8192) {
      return new Response('{"error":{"message":"max_tokens: 32000 > 8192, which is the maximum allowed"}}', { status: 400 })
    }
    return sseResponse([
      { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'script__create', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"id":"Mover","source":"imp' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 8192 } },
    ])
  })
  const cfg = config('anthropic', 'https://e.example/v1')
  const { result } = await chat(cfg, {})
  assert.ok(captured.length >= 3)
  assert.equal(captured.at(-1)!.body.max_tokens, 8192)
  assert.equal(captured.at(-1)!.body.thinking?.type, 'enabled')
  assert.equal(result.stopReason, 'length')
  assert.ok(result.toolCalls[0].invalid)

  // 降级结果被记住：下一次请求不再重复失败
  const before = captured.length
  await chat(cfg, {})
  assert.equal(captured.length, before + 1)
})

test('Gemini：流式、思考签名回传、Schema 清洗、并行工具结果合并', async () => {
  const captured = mockFetch(() =>
    sseResponse([
      { candidates: [{ content: { parts: [{ text: '我来' }] } }] },
      { candidates: [{ content: { parts: [{ text: '处理' }] } }] },
      {
        candidates: [{
          content: { parts: [{ functionCall: { name: 'script__create', args: { id: 'Mover' } }, thoughtSignature: 'TS1' }] },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 30, thoughtsTokenCount: 20, cachedContentTokenCount: 400 },
      },
    ]),
  )
  const cfg = config('gemini', 'https://f.example/v1beta')
  const first = await chat(cfg, {})
  assert.ok(captured[0].url.includes(':streamGenerateContent?alt=sse'))
  const declared = captured[0].body.tools[0].functionDeclarations[0].parameters
  assert.equal(declared.additionalProperties, undefined)
  assert.equal(declared.properties.parentId.type, 'string')
  assert.equal(declared.properties.parentId.nullable, true)
  assert.equal(first.result.text, '我来处理')
  assert.equal(first.result.stopReason, 'tool')
  assert.deepEqual(first.result.usage, { inputTokens: 500, outputTokens: 50, cachedTokens: 400 })

  await chat(cfg, {
    messages: [
      { role: 'user', text: '做两个脚本' },
      {
        role: 'assistant',
        text: first.result.text,
        toolCalls: [...first.result.toolCalls, { id: 'x2', name: 'script__create', arguments: { id: 'B' } }],
        providerState: first.result.providerState,
      },
      { role: 'tool', toolCallId: first.result.toolCalls[0].id, name: 'script__create', content: '{"ok":true}' },
      { role: 'tool', toolCallId: 'x2', name: 'script__create', content: '{"ok":true}' },
    ],
  })
  const contents = captured[1].body.contents
  assert.equal(contents[1].role, 'model')
  assert.deepEqual(contents[1].parts[0], { text: '我来处理' })
  assert.equal(contents[1].parts[1].thoughtSignature, 'TS1')
  assert.equal(contents.length, 3)
  assert.equal(contents[2].parts.length, 2, '并行工具结果应在同一条消息里')
})
