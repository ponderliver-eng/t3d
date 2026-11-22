if(typeof globalThis.localStorage==="undefined"){const m=new Map();globalThis.localStorage={get length(){return m.size},clear:()=>m.clear(),getItem:k=>m.get(k)??null,key:i=>[...m.keys()][i]??null,removeItem:k=>{m.delete(k)},setItem:(k,v)=>{m.set(k,String(v))}};}if(typeof globalThis.document==="undefined"){globalThis.document={documentElement:{style:{}}};}

// tests/ai-providers.test.ts
import assert from "node:assert/strict";
import test from "node:test";

// tests/stubs/electron.ts
var net = {};

// electron/services/modelProviders.ts
var TRUNCATED_ARGS_REASON = "\u5DE5\u5177\u53C2\u6570 JSON \u4E0D\u5B8C\u6574\uFF08\u6A21\u578B\u8F93\u51FA\u88AB\u957F\u5EA6\u4E0A\u9650\u622A\u65AD\u6216\u683C\u5F0F\u635F\u574F\uFF09";
async function fetchWithProxyAndRetry(url, init, signal) {
  const fetcher = typeof net?.fetch === "function" ? net.fetch.bind(net) : globalThis.fetch;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal.aborted) {
      throw new Error("\u8BF7\u6C42\u5DF2\u53D6\u6D88");
    }
    try {
      return await fetcher(url, { ...init, signal });
    } catch (error) {
      lastError = error;
      if (signal.aborted || error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  }
  throw new Error(formatNetworkError(url, lastError));
}
function formatNetworkError(url, error) {
  const errObj = error;
  const baseMsg = errObj?.message || String(error);
  const causeMsg = errObj?.cause?.message;
  const code = errObj?.cause?.code || errObj?.code;
  let host = url;
  try {
    host = new URL(url).origin;
  } catch {
  }
  const detail = [code, causeMsg && causeMsg !== baseMsg ? causeMsg : ""].filter(Boolean).join(" / ");
  return `\u8FDE\u63A5\u6A21\u578B\u670D\u52A1\u5931\u8D25\uFF08${host}\uFF09\uFF1A${baseMsg}${detail ? ` [${detail}]` : ""}\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u3001\u7CFB\u7EDF\u4EE3\u7406\u6216\u63A5\u53E3\u5730\u5740\u914D\u7F6E\u3002`;
}
async function invokeModelChat(config2, apiKey, req, onDelta, requestId, signal) {
  const model = req.model?.trim() || config2.model;
  switch (config2.providerType) {
    case "anthropic":
      return callAnthropic(config2.baseUrl, apiKey, model, req, onDelta, requestId, signal);
    case "gemini":
      return callGemini(config2.baseUrl, apiKey, model, req, onDelta, requestId, signal);
    case "openai":
    case "openai-compatible":
      return callOpenAiCompatible(config2.baseUrl, apiKey, model, req, onDelta, requestId, signal);
  }
}
function parseToolArguments(raw) {
  if (!raw.trim()) return { arguments: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { arguments: parsed };
    }
    return { arguments: {}, invalid: "\u5DE5\u5177\u53C2\u6570\u5FC5\u987B\u662F JSON \u5BF9\u8C61" };
  } catch {
    return { arguments: {}, invalid: TRUNCATED_ARGS_REASON };
  }
}
function parseDataUrlImage(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}
async function readSseLines(body, onData) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flushLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload) onData(payload);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      flushLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) flushLine(buffer);
}
function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
var OPENAI_VARIANTS = [
  { streamUsage: true, echoReasoning: true },
  { streamUsage: true, echoReasoning: false },
  { streamUsage: false, echoReasoning: false }
];
var openAiVariantMemo = /* @__PURE__ */ new Map();
async function callOpenAiCompatible(baseUrl, apiKey, model, req, onDelta, requestId, signal) {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const memoKey = `${url}::${model}`;
  const buildMessages = (variant) => {
    const messages = [{ role: "system", content: req.system }];
    for (const msg of req.messages) {
      if (msg.role === "user") {
        if (msg.images && msg.images.length > 0) {
          messages.push({
            role: "user",
            content: [
              { type: "text", text: msg.text },
              ...msg.images.map((img) => ({ type: "image_url", image_url: { url: img } }))
            ]
          });
        } else {
          messages.push({ role: "user", content: msg.text });
        }
      } else if (msg.role === "assistant") {
        const reasoning = msg.providerState?.reasoningContent;
        messages.push({
          role: "assistant",
          content: msg.text || null,
          ...variant.echoReasoning && reasoning ? { reasoning_content: reasoning } : {},
          ...msg.toolCalls && msg.toolCalls.length > 0 ? {
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments)
              }
            }))
          } : {}
        });
      } else if (msg.role === "tool") {
        messages.push({
          role: "tool",
          tool_call_id: msg.toolCallId,
          content: msg.content
        });
      }
    }
    return messages;
  };
  const tools = req.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
  let resp = null;
  let variantIndex = openAiVariantMemo.get(memoKey) ?? 0;
  for (; variantIndex < OPENAI_VARIANTS.length; variantIndex += 1) {
    const variant = OPENAI_VARIANTS[variantIndex];
    resp = await fetchWithProxyAndRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(variant),
        ...tools.length > 0 ? { tools } : {},
        stream: true,
        ...variant.streamUsage ? { stream_options: { include_usage: true } } : {}
      })
    }, signal);
    if (resp.ok && resp.body) break;
    const canDegrade = (resp.status === 400 || resp.status === 422) && variantIndex + 1 < OPENAI_VARIANTS.length;
    if (!canDegrade) {
      const errText = await resp.text().catch(() => resp?.statusText ?? "");
      throw new Error(`\u6A21\u578B\u8BF7\u6C42\u5931\u8D25 (${resp.status}): ${errText}`);
    }
  }
  if (!resp || !resp.ok || !resp.body) {
    throw new Error("\u6A21\u578B\u8BF7\u6C42\u5931\u8D25\uFF1A\u672A\u83B7\u5F97\u6709\u6548\u54CD\u5E94");
  }
  openAiVariantMemo.set(memoKey, Math.min(variantIndex, OPENAI_VARIANTS.length - 1));
  let fullText = "";
  let reasoningText = "";
  let finishReason = "";
  let streamError = "";
  const toolAcc = /* @__PURE__ */ new Map();
  let usage;
  await readSseLines(resp.body, (dataStr) => {
    if (dataStr === "[DONE]") return;
    const chunk = tryParseJson(dataStr);
    if (!chunk) return;
    if (chunk.error) {
      streamError = typeof chunk.error === "string" ? chunk.error : chunk.error.message || "\u672A\u77E5\u6D41\u5F0F\u9519\u8BEF";
      return;
    }
    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens,
        cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? chunk.usage.prompt_cache_hit_tokens
      };
    }
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta;
    if (!delta) return;
    const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoningDelta === "string" && reasoningDelta) {
      reasoningText += reasoningDelta;
      onDelta({ requestId, type: "reasoning", text: reasoningDelta });
    }
    if (delta.content) {
      fullText += delta.content;
      onDelta({ requestId, type: "text", text: delta.content });
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const prev = toolAcc.get(idx) ?? { id: tc.id || `call_${idx}`, name: "", argsText: "", announced: false };
        if (tc.id) prev.id = tc.id;
        if (tc.function?.name) prev.name += tc.function.name;
        if (tc.function?.arguments) prev.argsText += tc.function.arguments;
        if (!prev.announced && prev.name) {
          prev.announced = true;
          onDelta({ requestId, type: "tool", toolName: prev.name });
        }
        toolAcc.set(idx, prev);
      }
    }
  });
  if (streamError) {
    throw new Error(`\u6A21\u578B\u6D41\u5F0F\u54CD\u5E94\u51FA\u9519\uFF1A${streamError}`);
  }
  const toolCalls = Array.from(toolAcc.entries()).sort((a, b) => a[0] - b[0]).filter(([, tc]) => tc.name).map(([, tc]) => {
    const parsed = parseToolArguments(tc.argsText);
    return {
      id: tc.id,
      name: tc.name,
      arguments: parsed.arguments,
      ...parsed.invalid ? { invalid: parsed.invalid } : {}
    };
  });
  const stopReason = finishReason === "length" ? "length" : toolCalls.length > 0 ? "tool" : finishReason === "stop" || !finishReason ? "stop" : "other";
  onDelta({ requestId, type: "done" });
  return {
    text: fullText,
    toolCalls,
    usage,
    model,
    stopReason,
    ...reasoningText ? { providerState: { reasoningContent: reasoningText } } : {}
  };
}
var ANTHROPIC_THINKING_ORDER = ["adaptive", "budget", "off"];
var ANTHROPIC_MAX_TOKENS_ORDER = [32e3, 16e3, 8192, 4096];
var anthropicVariantMemo = /* @__PURE__ */ new Map();
function buildAnthropicMessages(req) {
  const messages = [];
  const pushUserBlocks = (blocks) => {
    const last2 = messages[messages.length - 1];
    if (last2 && last2.role === "user") last2.content.push(...blocks);
    else messages.push({ role: "user", content: blocks });
  };
  for (const msg of req.messages) {
    if (msg.role === "user") {
      const blocks = [{ type: "text", text: msg.text || "\u8BF7\u67E5\u770B\u56FE\u7247" }];
      for (const img of msg.images ?? []) {
        const parsed = parseDataUrlImage(img);
        if (parsed) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: parsed.mediaType, data: parsed.data }
          });
        }
      }
      pushUserBlocks(blocks);
    } else if (msg.role === "assistant") {
      const blocks = [];
      const saved = msg.providerState?.anthropicBlocks;
      const callsById = new Map((msg.toolCalls ?? []).map((tc) => [tc.id, tc]));
      if (saved && saved.length > 0) {
        for (const block of saved) {
          if (block.type === "thinking" || block.type === "redacted_thinking") {
            blocks.push(block);
          } else if (block.type === "text") {
            if (block.text) blocks.push({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            const current = callsById.get(block.id);
            if (current) {
              blocks.push({ type: "tool_use", id: current.id, name: current.name, input: current.arguments });
            }
          }
        }
      } else {
        if (msg.text) blocks.push({ type: "text", text: msg.text });
        for (const tc of msg.toolCalls ?? []) {
          blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        }
      }
      if (blocks.length === 0) blocks.push({ type: "text", text: "\uFF08\u65E0\u8F93\u51FA\uFF09" });
      messages.push({ role: "assistant", content: blocks });
    } else if (msg.role === "tool") {
      pushUserBlocks([{ type: "tool_result", tool_use_id: msg.toolCallId, content: msg.content }]);
    }
  }
  const last = messages[messages.length - 1];
  if (last && last.role === "user" && last.content.length > 0) {
    const tail = last.content[last.content.length - 1];
    last.content[last.content.length - 1] = { ...tail, cache_control: { type: "ephemeral" } };
  }
  return messages;
}
async function callAnthropic(baseUrl, apiKey, model, req, onDelta, requestId, signal) {
  const url = `${baseUrl.replace(/\/+$/, "")}/messages`;
  const memoKey = `${url}::${model}`;
  const messages = buildAnthropicMessages(req);
  const tools = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters
  }));
  let variant = anthropicVariantMemo.get(memoKey) ?? {
    thinking: ANTHROPIC_THINKING_ORDER[0],
    maxTokens: ANTHROPIC_MAX_TOKENS_ORDER[0]
  };
  let resp = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const thinkingBudget = Math.min(1e4, variant.maxTokens - 4096);
    const thinking = variant.thinking === "adaptive" ? { type: "adaptive" } : variant.thinking === "budget" && thinkingBudget >= 1024 ? { type: "enabled", budget_tokens: thinkingBudget } : null;
    resp = await fetchWithProxyAndRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: variant.maxTokens,
        // 系统提示保持静态并打缓存断点（工具定义位于其前，一并命中）
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages,
        ...tools.length > 0 ? { tools } : {},
        ...thinking ? { thinking } : {},
        stream: true
      })
    }, signal);
    if (resp.ok && resp.body) break;
    const errText = await resp.text().catch(() => resp?.statusText ?? "");
    if (resp.status === 400) {
      const lower = errText.toLowerCase();
      const thinkingIdx = ANTHROPIC_THINKING_ORDER.indexOf(variant.thinking);
      const tokensIdx = ANTHROPIC_MAX_TOKENS_ORDER.indexOf(variant.maxTokens);
      if (/thinking|budget_tokens|adaptive/.test(lower) && thinkingIdx + 1 < ANTHROPIC_THINKING_ORDER.length) {
        variant = { ...variant, thinking: ANTHROPIC_THINKING_ORDER[thinkingIdx + 1] };
        continue;
      }
      if (/max_tokens/.test(lower) && tokensIdx + 1 < ANTHROPIC_MAX_TOKENS_ORDER.length) {
        variant = { ...variant, maxTokens: ANTHROPIC_MAX_TOKENS_ORDER[tokensIdx + 1] };
        continue;
      }
    }
    throw new Error(`Anthropic \u8BF7\u6C42\u5931\u8D25 (${resp.status}): ${errText}`);
  }
  if (!resp || !resp.ok || !resp.body) {
    throw new Error("Anthropic \u8BF7\u6C42\u5931\u8D25\uFF1A\u672A\u83B7\u5F97\u6709\u6548\u54CD\u5E94");
  }
  anthropicVariantMemo.set(memoKey, variant);
  const blocks = /* @__PURE__ */ new Map();
  let stopReasonRaw = "";
  let inputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let outputTokens = 0;
  let streamError = "";
  await readSseLines(resp.body, (dataStr) => {
    const evt = tryParseJson(dataStr);
    if (!evt?.type) return;
    if (evt.type === "error") {
      streamError = evt.error?.message || "\u672A\u77E5\u6D41\u5F0F\u9519\u8BEF";
      return;
    }
    if (evt.type === "message_start") {
      const u = evt.message?.usage;
      inputTokens = u?.input_tokens ?? 0;
      cacheRead = u?.cache_read_input_tokens ?? 0;
      cacheWrite = u?.cache_creation_input_tokens ?? 0;
      outputTokens = u?.output_tokens ?? 0;
      return;
    }
    if (evt.type === "content_block_start" && typeof evt.index === "number" && evt.content_block) {
      const cb = evt.content_block;
      if (cb.type === "text") {
        blocks.set(evt.index, { type: "text", text: cb.text ?? "" });
      } else if (cb.type === "thinking") {
        blocks.set(evt.index, { type: "thinking", thinking: cb.thinking ?? "", signature: cb.signature ?? "" });
      } else if (cb.type === "redacted_thinking") {
        blocks.set(evt.index, { type: "redacted_thinking", data: cb.data ?? "" });
      } else if (cb.type === "tool_use" && cb.id && cb.name) {
        blocks.set(evt.index, { type: "tool_use", id: cb.id, name: cb.name, input: {}, jsonText: "" });
        onDelta({ requestId, type: "tool", toolName: cb.name });
      }
      return;
    }
    if (evt.type === "content_block_delta" && typeof evt.index === "number" && evt.delta) {
      const block = blocks.get(evt.index);
      if (!block) return;
      const d = evt.delta;
      if (d.type === "text_delta" && block.type === "text" && d.text) {
        block.text += d.text;
        onDelta({ requestId, type: "text", text: d.text });
      } else if (d.type === "thinking_delta" && block.type === "thinking" && d.thinking) {
        block.thinking += d.thinking;
        onDelta({ requestId, type: "reasoning", text: d.thinking });
      } else if (d.type === "signature_delta" && block.type === "thinking" && d.signature) {
        block.signature += d.signature;
      } else if (d.type === "input_json_delta" && block.type === "tool_use" && d.partial_json) {
        block.jsonText = (block.jsonText ?? "") + d.partial_json;
      }
      return;
    }
    if (evt.type === "message_delta") {
      if (evt.delta?.stop_reason) stopReasonRaw = evt.delta.stop_reason;
      if (typeof evt.usage?.output_tokens === "number") outputTokens = evt.usage.output_tokens;
    }
  });
  if (streamError) {
    throw new Error(`Anthropic \u6D41\u5F0F\u54CD\u5E94\u51FA\u9519\uFF1A${streamError}`);
  }
  let text = "";
  const toolCalls = [];
  const savedBlocks = [];
  for (const [, block] of Array.from(blocks.entries()).sort((a, b) => a[0] - b[0])) {
    if (block.type === "text") {
      text += block.text;
      savedBlocks.push({ type: "text", text: block.text });
    } else if (block.type === "thinking") {
      if (block.signature) savedBlocks.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
    } else if (block.type === "redacted_thinking") {
      savedBlocks.push({ type: "redacted_thinking", data: block.data });
    } else if (block.type === "tool_use") {
      const parsed = parseToolArguments(block.jsonText ?? "");
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: parsed.arguments,
        ...parsed.invalid ? { invalid: parsed.invalid } : {}
      });
      savedBlocks.push({ type: "tool_use", id: block.id, name: block.name, input: parsed.arguments });
    }
  }
  const stopReason = stopReasonRaw === "max_tokens" ? "length" : stopReasonRaw === "tool_use" || toolCalls.length > 0 ? "tool" : stopReasonRaw === "end_turn" || stopReasonRaw === "stop_sequence" || !stopReasonRaw ? "stop" : "other";
  onDelta({ requestId, type: "done" });
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: inputTokens + cacheRead + cacheWrite,
      outputTokens,
      cachedTokens: cacheRead
    },
    model,
    stopReason,
    providerState: { anthropicBlocks: savedBlocks }
  };
}
function sanitizeSchemaForGemini(schema) {
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties" || key === "$schema") continue;
    if (key === "type" && Array.isArray(value)) {
      const concrete = value.filter((t) => t !== "null");
      out.type = concrete[0] ?? "string";
      if (value.includes("null")) out.nullable = true;
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      const props = {};
      for (const [propKey, propSchema] of Object.entries(value)) {
        props[propKey] = sanitizeSchemaForGemini(propSchema);
      }
      out.properties = props;
      continue;
    }
    out[key] = sanitizeSchemaForGemini(value);
  }
  return out;
}
async function callGemini(baseUrl, apiKey, model, req, onDelta, requestId, signal) {
  const url = `${baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const contents = [];
  for (const msg of req.messages) {
    if (msg.role === "user") {
      const parts = [{ text: msg.text || "\u8BF7\u67E5\u770B\u56FE\u7247" }];
      for (const img of msg.images ?? []) {
        const parsed = parseDataUrlImage(img);
        if (parsed) {
          parts.push({ inlineData: { mimeType: parsed.mediaType, data: parsed.data } });
        }
      }
      contents.push({ role: "user", parts });
    } else if (msg.role === "assistant") {
      const saved = msg.providerState?.geminiParts;
      let parts = [];
      if (saved && saved.length > 0) {
        const calls = [...msg.toolCalls ?? []];
        parts = saved.map((part) => {
          if (!part.functionCall) return part;
          const current = calls.shift();
          if (!current) return null;
          return { ...part, functionCall: { name: current.name, args: current.arguments } };
        }).filter(Boolean);
      } else {
        if (msg.text) parts.push({ text: msg.text });
        for (const tc of msg.toolCalls ?? []) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
        }
      }
      if (parts.length === 0) parts.push({ text: "\uFF08\u65E0\u8F93\u51FA\uFF09" });
      contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      const part = {
        functionResponse: {
          name: msg.name,
          response: { result: msg.content }
        }
      };
      const last = contents[contents.length - 1];
      const lastIsToolResponses = last?.role === "user" && last.parts.length > 0 && last.parts.every((p) => Boolean(p.functionResponse));
      if (lastIsToolResponses) last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    }
  }
  const tools = req.tools.length > 0 ? [{
    functionDeclarations: req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeSchemaForGemini(t.parameters)
    }))
  }] : void 0;
  const resp = await fetchWithProxyAndRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents,
      ...tools ? { tools } : {}
    })
  }, signal);
  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Gemini \u8BF7\u6C42\u5931\u8D25 (${resp.status}): ${errText}`);
  }
  let text = "";
  let finishReason = "";
  let streamError = "";
  let usage;
  const savedParts = [];
  const toolCalls = [];
  await readSseLines(resp.body, (dataStr) => {
    const chunk = tryParseJson(dataStr);
    if (!chunk) return;
    if (chunk.error) {
      streamError = chunk.error.message || "\u672A\u77E5\u6D41\u5F0F\u9519\u8BEF";
      return;
    }
    if (chunk.usageMetadata) {
      usage = {
        inputTokens: chunk.usageMetadata.promptTokenCount,
        outputTokens: (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0),
        cachedTokens: chunk.usageMetadata.cachedContentTokenCount
      };
    }
    const candidate = chunk.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    for (const part of candidate?.content?.parts ?? []) {
      if (part.functionCall) {
        savedParts.push(part);
        toolCalls.push({
          id: `gemini_${Date.now()}_${toolCalls.length}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {}
        });
        onDelta({ requestId, type: "tool", toolName: part.functionCall.name });
        continue;
      }
      if (typeof part.text === "string" && part.text) {
        if (part.thought) {
          onDelta({ requestId, type: "reasoning", text: part.text });
        } else {
          text += part.text;
          onDelta({ requestId, type: "text", text: part.text });
        }
        const prev = savedParts[savedParts.length - 1];
        if (prev && typeof prev.text === "string" && !prev.functionCall && !prev.thoughtSignature && !part.thoughtSignature && Boolean(prev.thought) === Boolean(part.thought)) {
          prev.text += part.text;
        } else {
          savedParts.push({ ...part });
        }
        continue;
      }
      if (part.thoughtSignature) savedParts.push({ ...part });
    }
  });
  if (streamError) {
    throw new Error(`Gemini \u6D41\u5F0F\u54CD\u5E94\u51FA\u9519\uFF1A${streamError}`);
  }
  const stopReason = finishReason === "MAX_TOKENS" ? "length" : toolCalls.length > 0 ? "tool" : finishReason === "STOP" || !finishReason ? "stop" : "other";
  onDelta({ requestId, type: "done" });
  return {
    text,
    toolCalls,
    usage,
    model,
    stopReason,
    providerState: { geminiParts: savedParts }
  };
}

// tests/ai-providers.test.ts
function sseResponse(events, status = 200) {
  const text = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}

`).join("");
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37));
      controller.close();
    }
  });
  return new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } });
}
function mockFetch(responder) {
  const captured = [];
  globalThis.fetch = (async (input, init) => {
    const req = { url: String(input), body: JSON.parse(String(init?.body ?? "{}")) };
    captured.push(req);
    return responder(req, captured.length - 1);
  });
  return captured;
}
function config(providerType, baseUrl) {
  return { id: providerType, providerType, label: providerType, baseUrl, model: "test-model", hasApiKey: true };
}
var TOOLS = [
  {
    name: "script__create",
    description: "\u65B0\u5EFA\u811A\u672C",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, parentId: { type: ["string", "null"] } },
      additionalProperties: false
    }
  }
];
async function chat(cfg, req) {
  const deltas = [];
  const result = await invokeModelChat(
    cfg,
    "key",
    { system: "SYSTEM", messages: [{ role: "user", text: "\u4F60\u597D" }], tools: TOOLS, ...req },
    (d) => deltas.push(d),
    "req-1",
    new AbortController().signal
  );
  return { result, deltas };
}
test("OpenAI \u517C\u5BB9\uFF1A\u6D41\u5F0F\u6587\u672C + \u5DE5\u5177\u8C03\u7528 + \u7F13\u5B58\u7528\u91CF", async () => {
  const captured = mockFetch(
    () => sseResponse([
      { choices: [{ delta: { reasoning_content: "\u5148\u60F3\u4E00\u4E0B" } }] },
      { choices: [{ delta: { content: "\u597D\u7684" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "script__create", arguments: '{"id":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Mover"}' } }] }, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 1e3, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } } },
      "[DONE]"
    ])
  );
  const { result, deltas } = await chat(config("openai-compatible", "https://a.example/v1"), {});
  assert.equal(captured[0].body.stream, true);
  assert.deepEqual(captured[0].body.stream_options, { include_usage: true });
  assert.equal(result.text, "\u597D\u7684");
  assert.equal(result.stopReason, "tool");
  assert.deepEqual(result.toolCalls, [{ id: "call_1", name: "script__create", arguments: { id: "Mover" } }]);
  assert.deepEqual(result.usage, { inputTokens: 1e3, outputTokens: 50, cachedTokens: 800 });
  assert.deepEqual(result.providerState, { reasoningContent: "\u5148\u60F3\u4E00\u4E0B" });
  assert.ok(deltas.some((d) => d.type === "reasoning"));
  assert.ok(deltas.some((d) => d.type === "tool" && d.toolName === "script__create"));
});
test("OpenAI \u517C\u5BB9\uFF1A\u8F93\u51FA\u88AB\u622A\u65AD\u65F6\u6807\u8BB0 invalid\uFF0C\u800C\u4E0D\u662F\u9759\u9ED8\u53D8\u6210\u7A7A\u53C2\u6570", async () => {
  mockFetch(
    () => sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "script__create", arguments: '{"id":"Mover","source":"import' } }] } }] },
      { choices: [{ delta: {}, finish_reason: "length" }] },
      "[DONE]"
    ])
  );
  const { result } = await chat(config("openai-compatible", "https://b.example/v1"), {});
  assert.equal(result.stopReason, "length");
  assert.equal(result.toolCalls.length, 1);
  assert.ok(result.toolCalls[0].invalid, "\u622A\u65AD\u7684\u53C2\u6570\u5FC5\u987B\u88AB\u6807\u8BB0");
  assert.deepEqual(result.toolCalls[0].arguments, {});
});
test("OpenAI \u517C\u5BB9\uFF1A\u63A5\u53E3\u4E0D\u8BA4\u8BC6\u6269\u5C55\u53C2\u6570\u65F6\u81EA\u52A8\u964D\u7EA7\u91CD\u8BD5\uFF0C\u5E76\u56DE\u4F20 reasoning_content", async () => {
  const captured = mockFetch(
    (_req, i) => i === 0 ? new Response('{"error":"unknown field reasoning_content"}', { status: 400 }) : sseResponse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }, "[DONE]"])
  );
  const { result } = await chat(config("openai-compatible", "https://c.example/v1"), {
    messages: [
      { role: "user", text: "\u505A\u4E2A\u811A\u672C" },
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "call_1", name: "script__create", arguments: { id: "A" } }],
        providerState: { reasoningContent: "\u601D\u8003\u8FC7\u7A0B" }
      },
      { role: "tool", toolCallId: "call_1", name: "script__create", content: '{"ok":true}' }
    ]
  });
  assert.equal(captured.length, 2);
  assert.equal(captured[0].body.messages[2].reasoning_content, "\u601D\u8003\u8FC7\u7A0B");
  assert.equal(captured[1].body.messages[2].reasoning_content, void 0);
  assert.equal(result.text, "ok");
  assert.equal(result.stopReason, "stop");
});
test("Anthropic\uFF1A\u6D41\u5F0F\u601D\u8003 + \u5DE5\u5177\u8C03\u7528\uFF0C\u7F13\u5B58\u65AD\u70B9\u4E0E\u601D\u8003\u5757\u539F\u6837\u56DE\u4F20", async () => {
  const captured = mockFetch(
    () => sseResponse([
      { type: "message_start", message: { usage: { input_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 80, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "\u9700\u8981\u5148\u5EFA\u811A\u672C" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "SIG" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "\u5F00\u59CB" } },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "script__create", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"id":"Mo' } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: 'ver"}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 120 } },
      { type: "message_stop" }
    ])
  );
  const cfg = config("anthropic", "https://d.example/v1");
  const first = await chat(cfg, {});
  const body = captured[0].body;
  assert.equal(body.stream, true);
  assert.ok(body.max_tokens > 4096, "\u8F93\u51FA\u4E0A\u9650\u4E0D\u5E94\u518D\u662F 4096");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(body.messages.at(-1).content.at(-1).cache_control, { type: "ephemeral" });
  assert.equal(first.result.text, "\u5F00\u59CB");
  assert.equal(first.result.stopReason, "tool");
  assert.deepEqual(first.result.toolCalls, [{ id: "toolu_1", name: "script__create", arguments: { id: "Mover" } }]);
  assert.deepEqual(first.result.usage, { inputTokens: 1e3, outputTokens: 120, cachedTokens: 900 });
  assert.ok(first.deltas.some((d) => d.type === "reasoning"));
  await chat(cfg, {
    messages: [
      { role: "user", text: "\u505A\u4E2A\u811A\u672C" },
      { role: "assistant", text: first.result.text, toolCalls: first.result.toolCalls, providerState: first.result.providerState },
      { role: "tool", toolCallId: "toolu_1", name: "script__create", content: '{"ok":true}' },
      { role: "user", text: "\u8FD9\u662F\u622A\u56FE", images: ["data:image/png;base64,AAAA"] }
    ]
  });
  const second = captured[1].body.messages;
  assert.equal(second.length, 3, "\u5DE5\u5177\u7ED3\u679C\u4E0E\u968F\u540E\u7684\u622A\u56FE\u5E94\u5408\u5E76\u4E3A\u540C\u4E00\u6761 user \u6D88\u606F");
  assert.deepEqual(second[1].content[0], { type: "thinking", thinking: "\u9700\u8981\u5148\u5EFA\u811A\u672C", signature: "SIG" });
  assert.equal(second[1].content[1].type, "text");
  assert.equal(second[1].content[2].type, "tool_use");
  assert.equal(second[2].content[0].type, "tool_result");
  assert.equal(second[2].content.at(-1).type, "image");
  assert.deepEqual(second[2].content.at(-1).cache_control, { type: "ephemeral" });
});
test("Anthropic\uFF1A\u6A21\u578B\u4E0D\u652F\u6301\u7684\u601D\u8003\u5F62\u6001 / \u8F93\u51FA\u4E0A\u9650\u6309\u62A5\u9519\u9010\u7EA7\u964D\u7EA7", async () => {
  const captured = mockFetch((req) => {
    if (req.body.thinking?.type === "adaptive") {
      return new Response('{"error":{"message":"thinking.type: adaptive is not supported"}}', { status: 400 });
    }
    if (req.body.max_tokens > 8192) {
      return new Response('{"error":{"message":"max_tokens: 32000 > 8192, which is the maximum allowed"}}', { status: 400 });
    }
    return sseResponse([
      { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "script__create", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"id":"Mover","source":"imp' } },
      { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 8192 } }
    ]);
  });
  const cfg = config("anthropic", "https://e.example/v1");
  const { result } = await chat(cfg, {});
  assert.ok(captured.length >= 3);
  assert.equal(captured.at(-1).body.max_tokens, 8192);
  assert.equal(captured.at(-1).body.thinking?.type, "enabled");
  assert.equal(result.stopReason, "length");
  assert.ok(result.toolCalls[0].invalid);
  const before = captured.length;
  await chat(cfg, {});
  assert.equal(captured.length, before + 1);
});
test("Gemini\uFF1A\u6D41\u5F0F\u3001\u601D\u8003\u7B7E\u540D\u56DE\u4F20\u3001Schema \u6E05\u6D17\u3001\u5E76\u884C\u5DE5\u5177\u7ED3\u679C\u5408\u5E76", async () => {
  const captured = mockFetch(
    () => sseResponse([
      { candidates: [{ content: { parts: [{ text: "\u6211\u6765" }] } }] },
      { candidates: [{ content: { parts: [{ text: "\u5904\u7406" }] } }] },
      {
        candidates: [{
          content: { parts: [{ functionCall: { name: "script__create", args: { id: "Mover" } }, thoughtSignature: "TS1" }] },
          finishReason: "STOP"
        }],
        usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 30, thoughtsTokenCount: 20, cachedContentTokenCount: 400 }
      }
    ])
  );
  const cfg = config("gemini", "https://f.example/v1beta");
  const first = await chat(cfg, {});
  assert.ok(captured[0].url.includes(":streamGenerateContent?alt=sse"));
  const declared = captured[0].body.tools[0].functionDeclarations[0].parameters;
  assert.equal(declared.additionalProperties, void 0);
  assert.equal(declared.properties.parentId.type, "string");
  assert.equal(declared.properties.parentId.nullable, true);
  assert.equal(first.result.text, "\u6211\u6765\u5904\u7406");
  assert.equal(first.result.stopReason, "tool");
  assert.deepEqual(first.result.usage, { inputTokens: 500, outputTokens: 50, cachedTokens: 400 });
  await chat(cfg, {
    messages: [
      { role: "user", text: "\u505A\u4E24\u4E2A\u811A\u672C" },
      {
        role: "assistant",
        text: first.result.text,
        toolCalls: [...first.result.toolCalls, { id: "x2", name: "script__create", arguments: { id: "B" } }],
        providerState: first.result.providerState
      },
      { role: "tool", toolCallId: first.result.toolCalls[0].id, name: "script__create", content: '{"ok":true}' },
      { role: "tool", toolCallId: "x2", name: "script__create", content: '{"ok":true}' }
    ]
  });
  const contents = captured[1].body.contents;
  assert.equal(contents[1].role, "model");
  assert.deepEqual(contents[1].parts[0], { text: "\u6211\u6765\u5904\u7406" });
  assert.equal(contents[1].parts[1].thoughtSignature, "TS1");
  assert.equal(contents.length, 3);
  assert.equal(contents[2].parts.length, 2, "\u5E76\u884C\u5DE5\u5177\u7ED3\u679C\u5E94\u5728\u540C\u4E00\u6761\u6D88\u606F\u91CC");
});
