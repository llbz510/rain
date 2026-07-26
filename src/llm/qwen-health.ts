import type { LlmSettings } from '@/llm/types'
import { redactSecret } from '@/llm/client'

const HEALTH_PROMPT = 'Return JSON only. Return {"ok":true}.'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface QwenConnectionResult {
  ok: boolean
  latencyMs?: number
  message: string
}

function assertConfiguredModel(settings: LlmSettings): string {
  let endpoint: URL
  try {
    endpoint = new URL(settings.baseUrl)
  } catch {
    throw new Error('模型服务地址必须是有效的 HTTP(S) URL')
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('模型服务地址必须使用 HTTP(S)')
  }
  if (!settings.model.trim()) throw new Error('模型名称不能为空')
  if (!settings.apiKey.trim()) throw new Error('模型 API 密钥不能为空')
  return settings.baseUrl.replace(/\/+$/, '')
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
  const baseUrl = assertConfiguredModel(settings)
  const startedAt = now()
  try {
    const response = await fetcher(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
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
