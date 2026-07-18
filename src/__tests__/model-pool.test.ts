import { afterEach, describe, expect, it } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import { getSetting } from '@/models/database'
import {
  createRuntimeSettingsInitializer,
  loadRuntimeSettings,
  saveRuntimeSettings,
} from '@/settings/model-pool'

afterEach(() => {
  resetDb()
})

const roles = { asr: 'whisper-large-v3', structuring: 'qwen-main', assistant: 'qwen-main' }
const qwenModel = {
  id: 'qwen-main', alias: 'Qwen',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.5-omni-flash', apiKey: 'dummy-model-key',
}

describe('runtime model settings', () => {
  it('keeps the saved model ID after restart', async () => {
    await saveRuntimeSettings({ models: [qwenModel], roles })

    expect((await loadRuntimeSettings()).roles.structuring).toBe('qwen-main')
    expect((await loadRuntimeSettings()).models[0].id).toBe('qwen-main')
  })

  it('stores the API key separately from the model JSON', async () => {
    await saveRuntimeSettings({ models: [qwenModel], roles })

    const db = await getDb()
    expect(await getSetting(db, 'api_key.qwen-main')).toBe('dummy-model-key')
    expect(await getSetting(db, 'model_pool')).not.toContain('dummy-model-key')
  })

  it('prunes an API key when its model is removed', async () => {
    await saveRuntimeSettings({
      models: [{ id: 'model-a', alias: 'A', model: 'model-a', apiKey: 'dummy-removed-key' }],
      roles,
    })

    await saveRuntimeSettings({ models: [], roles })

    expect(await getSetting(await getDb(), 'api_key.model-a')).toBeNull()
  })

  it('keeps settings unready after a handled hydration failure', async () => {
    const initializer = createRuntimeSettingsInitializer(async () => {
      throw new Error('settings unavailable')
    })

    await expect(initializer.initialize()).resolves.toMatchObject({ ok: false, ready: false })
    expect(initializer.state()).toMatchObject({ ok: false, ready: false, error: 'settings unavailable' })
  })

  it('shares one successful initialization result', async () => {
    let calls = 0
    const initializer = createRuntimeSettingsInitializer(async () => {
      calls++
      return { models: [], roles: { asr: null, structuring: null, assistant: null } }
    })

    const [first, second] = await Promise.all([initializer.initialize(), initializer.initialize()])
    expect(first).toMatchObject({ ok: true, ready: true })
    expect(second).toMatchObject({ ok: true, ready: true })
    expect(calls).toBe(1)
  })
})