import { describe, expect, it } from 'vitest'
import { callStage2, redactSecret } from '@/llm/client'
import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from '@/settings/default-runtime'

declare const process: { env: Record<string, string | undefined> }

const env = typeof process === 'undefined' ? {} : process.env
const required = env.RAIN_LIVE_LLM_REQUIRED === '1' || env.RAIN_LIVE_QWEN_REQUIRED === '1'
const apiKey = env.RAIN_LIVE_LLM_API_KEY ?? env.RAIN_QWEN_API_KEY ?? ''
const baseUrl = env.RAIN_LIVE_LLM_BASE_URL ?? env.RAIN_E2E_LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL
const model = env.RAIN_LIVE_LLM_MODEL ?? env.RAIN_E2E_LLM_MODEL ?? DEFAULT_LLM_MODEL
const maybeDescribe = required || apiKey ? describe : describe.skip

maybeDescribe('live OpenAI-compatible connection', () => {
  it('returns JSON through the selected runtime configuration without exposing the key', async () => {
    if (!apiKey.trim()) throw new Error('RAIN_LIVE_LLM_API_KEY is required')
    const settings = {
      baseUrl,
      apiKey,
      model,
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
