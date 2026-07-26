import { describe, expect, it, vi } from 'vitest'
import { checkAsrModelCapability } from '@/settings/asr-capability'
import type { RuntimeModel } from '@/settings/model-pool'

const model: RuntimeModel = {
  id: 'whisper-medium',
  alias: 'Whisper medium',
  type: 'whisper-local',
  provider: 'local',
  model: 'medium',
  supportsVision: false,
}

const validPayload = [
  {
    id: 'probe-s1',
    text: 'Rain checks this speech model.',
    start_time: 0,
    end_time: 1.5,
  },
]

describe('AC-LV-12 ASR capability check', () => {
  it('records Compatible only after the production Whisper path returns valid sentences', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['C:\\models\\ggml-medium.bin']
      if (command === 'start_asr') return validPayload
      throw new Error(`Unexpected command: ${command}`)
    })

    const record = await checkAsrModelCapability(model, {
      invoke,
      resolveProbeFile: vi.fn().mockResolvedValue('C:\\resources\\asr-capability\\sample.mp4'),
      checkedAt: 100,
    })

    expect(record).toMatchObject({
      modelId: model.id,
      role: 'asr',
      status: 'Compatible',
      checkedAt: 100,
    })
    expect(invoke).toHaveBeenNthCalledWith(1, 'list_whisper_models')
    expect(invoke).toHaveBeenNthCalledWith(2, 'start_asr', {
      videoId: 'rain-asr-capability',
      filePath: 'C:\\resources\\asr-capability\\sample.mp4',
      tier: 'whisper',
      modelPath: 'C:\\models\\ggml-medium.bin',
      language: 'en',
    })
  })

  it('records Unavailable when Whisper returns an invalid transcript', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['C:\\models\\ggml-medium.bin']
      if (command === 'start_asr') return []
      throw new Error(`Unexpected command: ${command}`)
    })

    const record = await checkAsrModelCapability(model, {
      invoke,
      resolveProbeFile: vi.fn().mockResolvedValue('C:\\resources\\asr-capability\\sample.mp4'),
      checkedAt: 100,
    })

    expect(record).toMatchObject({
      role: 'asr',
      status: 'Unavailable',
    })
    expect(record.message).toContain('non-empty sentence array')
  })

  it('rejects unsupported ASR model types without invoking a desktop command', async () => {
    const invoke = vi.fn()

    const record = await checkAsrModelCapability(
      { ...model, type: 'asr-api' },
      {
        invoke,
        resolveProbeFile: vi.fn().mockResolvedValue('C:\\resources\\asr-capability\\sample.mp4'),
      },
    )

    expect(record.status).toBe('Unavailable')
    expect(record.message).toContain('whisper-local')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('redacts a configured secret from ASR capability failures', async () => {
    const secret = 'asr-secret-value'
    const record = await checkAsrModelCapability(
      { ...model, apiKey: secret },
      {
        invoke: vi.fn().mockRejectedValue(new Error(`runtime failed: ${secret}`)),
        resolveProbeFile: vi.fn().mockResolvedValue('C:\\resources\\asr-capability\\sample.mp4'),
      },
    )

    expect(record.status).toBe('Unavailable')
    expect(JSON.stringify(record)).not.toContain(secret)
  })
})
