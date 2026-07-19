import { describe, expect, it } from 'vitest'
import { callStage2, redactSecret } from '@/llm/client'

declare const process: { env: Record<string, string | undefined> }

const env = typeof process === 'undefined' ? {} : process.env
const required = env.RAIN_LIVE_QWEN_REQUIRED === '1'
const apiKey = env.RAIN_QWEN_API_KEY ?? ''
const maybeDescribe = required || apiKey ? describe : describe.skip

maybeDescribe('live Qwen connection', () => {
  it('returns JSON through the exact DashScope Qwen configuration without exposing the key', async () => {
    if (!apiKey.trim()) throw new Error('RAIN_QWEN_API_KEY is required')
    const settings = {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey,
      model: 'qwen3.5-omni-flash',
    }

    try {
      const result = await callStage2('Return JSON only. Return {"ok":true}.', 'Return {"ok":true}.', settings)
      expect(result).toMatchObject({ ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(redactSecret(message, [apiKey]))
    }
  })
})