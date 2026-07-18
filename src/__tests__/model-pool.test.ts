import { afterEach, describe, expect, it } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import { getSetting } from '@/models/database'
import { loadRuntimeSettings, saveRuntimeSettings } from '@/settings/model-pool'

afterEach(() => {
  resetDb()
})

describe('runtime model settings', () => {
  it('keeps the saved model ID after restart', async () => {
    await saveRuntimeSettings({
      models: [{
        id: 'qwen-main',
        alias: 'Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3.5-omni-flash',
        apiKey: 'dummy-model-key',
      }],
      roles: { asr: 'whisper-large-v3', structuring: 'qwen-main', assistant: 'qwen-main' },
    })

    expect((await loadRuntimeSettings()).roles.structuring).toBe('qwen-main')
    expect((await loadRuntimeSettings()).models[0].id).toBe('qwen-main')
  })

  it('stores the API key separately from the model JSON', async () => {
    await saveRuntimeSettings({
      models: [{
        id: 'qwen-main',
        alias: 'Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3.5-omni-flash',
        apiKey: 'dummy-model-key',
      }],
      roles: { asr: 'whisper-large-v3', structuring: 'qwen-main', assistant: 'qwen-main' },
    })

    const db = await getDb()
    expect(await getSetting(db, 'api_key.qwen-main')).toBe('dummy-model-key')
    expect(await getSetting(db, 'model_pool')).not.toContain('dummy-model-key')
  })
})