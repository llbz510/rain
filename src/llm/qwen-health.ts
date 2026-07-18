import type { LlmSettings } from '@/llm/types'
import { redactSecret } from '@/llm/client'

const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const QWEN_MODEL = 'qwen3.5-omni-flash'
const HEALTH_PROMPT = 'Return JSON only. Return {"ok":true}.'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface QwenConnectionResult {
  ok: boolean
  latencyMs?: number
  message: string
}

function assertConfiguredQwen(settings: LlmSettings): void {
  if (settings.baseUrl.replace(/\/+$/, '') !== QWEN_BASE_URL || settings.model !== QWEN_MODEL) {
    throw new Error('只能测试配置的 Qwen 连接')
  }
  if (!settings.apiKey.trim()) throw new Error('Qwen API 密钥不能为空')
}

function safeFailure(error: unknown, apiKey: string): QwenConnectionResult {
  const detail = redactSecret(error instanceof Error ? error.message : String(error), [apiKey])
  return { ok: false, message: detail ? `连接测试失败：${detail}` : '连接测试失败。' }
}

export async function testQwenConnection(
  settings: LlmSettings,
  fetcher: Fetcher = fetch,
  now: () => number = Date.now,
): Promise<QwenConnectionResult> {
  assertConfiguredQwen(settings)
  const startedAt = now()
  try {
    const response = await fetcher(`${QWEN_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: HEALTH_PROMPT }],
      }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('响应缺少 JSON 内容')
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.keys(parsed).length !== 1 || (parsed as { ok?: unknown }).ok !== true) {
      throw new Error('响应不是严格的 {"ok":true} JSON')
    }
    const latencyMs = Math.max(0, Math.round(now() - startedAt))
    return { ok: true, latencyMs, message: `连接成功（${latencyMs} ms）` }
  } catch (error) {
    return safeFailure(error, settings.apiKey)
  }
}