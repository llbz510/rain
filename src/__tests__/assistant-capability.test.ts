import { describe, expect, it, vi } from 'vitest'
import {
  ASSISTANT_CAPABILITY_TOKEN,
  checkAssistantModelCapability,
} from '@/settings/assistant-capability'
import type { RuntimeModel } from '@/settings/model-pool'

const model: RuntimeModel = {
  id: 'assistant-model',
  alias: 'Assistant Model',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'sk-assistant-secret',
  model: 'assistant-a',
  supportsVision: false,
}

describe('AC-LV-12 text assistant capability', () => {
  it('records Compatible only after the production stream returns the exact contract token', async () => {
    const cleanup = vi.fn()
    const stream = vi.fn((_messages, settings, callbacks) => {
      expect(settings).toEqual({
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        model: model.model,
      })
      callbacks.onToken('RAIN_')
      callbacks.onToken('ASSISTANT_OK')
      callbacks.onDone(ASSISTANT_CAPABILITY_TOKEN)
      return cleanup
    })

    const record = await checkAssistantModelCapability(model, {
      stream,
      checkedAt: 100,
    })

    expect(record).toMatchObject({
      modelId: model.id,
      role: 'assistant',
      status: 'Compatible',
      checkedAt: 100,
      message: expect.stringContaining('不包含 vision 能力'),
    })
    expect(stream).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('records Unavailable for a non-conforming streamed response', async () => {
    const record = await checkAssistantModelCapability(model, {
      stream: (_messages, _settings, callbacks) => {
        callbacks.onDone('Almost right')
        return vi.fn()
      },
      checkedAt: 100,
    })

    expect(record).toMatchObject({
      role: 'assistant',
      status: 'Unavailable',
      message: expect.stringContaining('精确响应'),
    })
  })

  it('redacts credentials from stream failures', async () => {
    const record = await checkAssistantModelCapability(model, {
      stream: (_messages, _settings, callbacks) => {
        callbacks.onError(new Error(`Bearer ${model.apiKey} was rejected`))
        return vi.fn()
      },
      checkedAt: 100,
    })

    expect(record.status).toBe('Unavailable')
    expect(record.message).toContain('[REDACTED]')
    expect(JSON.stringify(record)).not.toContain(model.apiKey)
  })

  it('times out and cleans up a stream that never completes', async () => {
    const cleanup = vi.fn()
    const record = await checkAssistantModelCapability(model, {
      stream: () => cleanup,
      timeoutMs: 1,
      checkedAt: 100,
    })

    expect(record).toMatchObject({
      status: 'Unavailable',
      message: expect.stringContaining('超时'),
    })
    expect(cleanup).toHaveBeenCalledOnce()
  })
})
