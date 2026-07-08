// src/llm/client.ts
// ========================================
// OpenAI 兼容 HTTP client（fetch + SSE 解析，决策92）
// 不引入 openai SDK —— 纯原生 fetch + ReadableStream 即可（YAGNI）。
// 导出 LLM_FUNCTIONS 列出的三个函数：callStage2 / callMerge / streamAiChat。
// ========================================

import type { LlmSettings, ChatMessage, StreamCallbacks, Stage2Result } from './types'

// ===== 辅助函数 =====

// 构造 OpenAI 兼容请求头（Authorization: Bearer <key> + Content-Type）
export function buildOpenAiHeaders(settings: LlmSettings): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${settings.apiKey}`,
  }
}

// 拼接 endpoint，兼容 baseUrl 末尾带或不带斜杠
function buildEndpoint(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path
}

// 构造 chat/completions 请求体；temperature 仅在显式设置时才发送（默认不传）
function buildRequestBody(
  settings: LlmSettings,
  messages: ChatMessage[],
  opts: { jsonMode?: boolean; stream?: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
  }
  if (settings.temperature !== undefined) {
    body.temperature = settings.temperature
  }
  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' }
  }
  if (opts.stream) {
    body.stream = true
  }
  return body
}

// 解析 SSE 流（内部函数）
// 逐行读取：以 "data: " 开头的行是 payload，"data: [DONE]" 结束流。
async function readSseStream(response: Response, callbacks: StreamCallbacks): Promise<void> {
  const body = response.body
  if (!body) {
    throw new Error('SSE response body is null; no stream to read')
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let completed = false

  // 统一的完成回调：保证 onDone 只触发一次，且 abort 时不触发
  const complete = (): void => {
    if (completed) return
    completed = true
    if (!callbacks.signal?.aborted) {
      callbacks.onDone(fullText)
    }
  }

  // 处理一行 SSE，返回 true 表示流应当结束（收到 [DONE] 或被取消）
  const handleLine = (rawLine: string): boolean => {
    const line = rawLine.replace(/\r$/, '') // 兼容 CRLF
    if (!line.startsWith('data:')) return false // 忽略 event:/id:/空行/注释等
    const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5)
    if (payload === '[DONE]') {
      complete()
      return true
    }
    if (payload === '') return false
    try {
      const parsed = JSON.parse(payload)
      const token = parsed?.choices?.[0]?.delta?.content
      if (typeof token === 'string' && token.length > 0) {
        if (callbacks.signal?.aborted) return true
        fullText += token
        callbacks.onToken(token)
      }
    } catch {
      // 跳过无法解析的行（如 keepalive 注释、半行残包）
    }
    return false
  }

  try {
    while (true) {
      if (callbacks.signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) {
        // 流自然结束：冲刷残留 buffer，再触发完成
        if (buffer.length > 0) handleLine(buffer)
        complete()
        return
      }
      buffer += decoder.decode(value, { stream: true })
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (handleLine(line)) return
        if (callbacks.signal?.aborted) return
        nl = buffer.indexOf('\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ===== 三个核心导出函数（LLM_FUNCTIONS，决策92）=====

// callStage2：非流式 Stage2 结构化调用，返回 JSON 对象（Stage2Result）
// messages 构造：system 放 prompt（结构化指令），user 放 sentences 文本。
export async function callStage2(
  prompt: string,
  sentences: string,
  settings: LlmSettings,
): Promise<Stage2Result> {
  const messages: ChatMessage[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: sentences },
  ]

  const response = await fetch(buildEndpoint(settings.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: buildOpenAiHeaders(settings),
    body: JSON.stringify(buildRequestBody(settings, messages, { jsonMode: true })),
  })

  if (!response.ok) {
    throw new Error(`Stage2 call failed: HTTP ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Stage2 call failed: missing choices[0].message.content')
  }

  try {
    return JSON.parse(content) as Stage2Result
  } catch {
    throw new Error('Stage2 call failed: response content is not valid JSON')
  }
}

// callMerge：非流式合并调用，messages 只放元数据（决策28：不重读全文）
// 返回合并方案 JSON。
export async function callMerge(
  metadataContext: string,
  settings: LlmSettings,
): Promise<any> {
  const messages: ChatMessage[] = [
    { role: 'user', content: metadataContext },
  ]

  const response = await fetch(buildEndpoint(settings.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: buildOpenAiHeaders(settings),
    body: JSON.stringify(buildRequestBody(settings, messages, { jsonMode: true })),
  })

  if (!response.ok) {
    throw new Error(`Merge call failed: HTTP ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Merge call failed: missing choices[0].message.content')
  }

  try {
    return JSON.parse(content)
  } catch {
    throw new Error('Merge call failed: response content is not valid JSON')
  }
}

// streamAiChat：流式 SSE 对话，返回 cleanup 函数用于 abort（决策83）
//
// 取消机制：内部创建 AbortController。
// - 调用方通过 callbacks.signal 传入的 AbortSignal 会被桥接到内部 controller；
// - 返回的 cleanup 函数直接 abort 内部 controller；
// - signal 透传给 fetch，controller.abort() 同时中断 HTTP 请求与 SSE 读取循环；
// - abort 后不再回调 onToken/onDone（主动取消不触发 onError）。
export function streamAiChat(
  messages: ChatMessage[],
  settings: LlmSettings,
  callbacks: StreamCallbacks,
): () => void {
  const controller = new AbortController()

  // 桥接调用方 signal → 内部 controller
  const onCallerAbort = (): void => controller.abort()
  const callerSignal = callbacks.signal
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort()
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }
  }

  const signal = controller.signal
  const innerCallbacks: StreamCallbacks = { ...callbacks, signal }

  void (async () => {
    try {
      if (signal.aborted) return
      const response = await fetch(buildEndpoint(settings.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: buildOpenAiHeaders(settings),
        body: JSON.stringify(buildRequestBody(settings, messages, { stream: true })),
        signal,
      })
      if (!response.ok) {
        throw new Error(`AI chat failed: HTTP ${response.status} ${response.statusText}`)
      }
      await readSseStream(response, innerCallbacks)
    } catch (err) {
      // 主动取消（abort）不触发 onError
      if (signal.aborted) return
      callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      // 流结束或出错后，解除对调用方 signal 的监听，避免泄漏
      if (callerSignal && !callerSignal.aborted) {
        callerSignal.removeEventListener('abort', onCallerAbort)
      }
    }
  })()

  // cleanup：组件 unmount 时调用，中断 fetch 与 SSE 读取
  return () => controller.abort()
}
