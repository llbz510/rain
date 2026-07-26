import { afterEach, describe, expect, it } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import { getSetting, setSetting } from '@/models/database'
import {
  createRuntimeSettingsInitializer,
  executeRuntimeSettingsMigration,
  loadRuntimeSettings,
  saveRuntimeSettings,
} from '@/settings/model-pool'
import { recordCapabilityCheck } from '@/settings/model-capabilities'

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

  it('persists capability records without storing API keys in them', async () => {
    const capability = recordCapabilityCheck({
      model: qwenModel,
      role: 'structuring',
      ok: true,
      message: '结构化检查通过',
      checkedAt: 100,
    })

    await saveRuntimeSettings({ models: [qwenModel], roles, capabilities: [capability] })

    const db = await getDb()
    const stored = await getSetting(db, 'model_capabilities')
    expect(stored).not.toContain('dummy-model-key')
    expect((await loadRuntimeSettings()).capabilities).toEqual([capability])
  })

  it('ignores malformed persisted capability records', async () => {
    const db = await getDb()
    await setSetting(db, 'model_capabilities', JSON.stringify([
      { modelId: 'qwen-main', role: 'structuring', status: 'probably' },
    ]))

    expect((await loadRuntimeSettings()).capabilities).toEqual([])
  })

  it('migrates a legacy model record without retaining secret copies', async () => {
    const db = await getDb()
    await setSetting(db, 'model_pool', JSON.stringify([{
      id: 'legacy-qwen', alias: 'Legacy Qwen', modelName: 'qwen-legacy', apiKey: 'dummy-embedded-key',
    }]))
    await setSetting(db, 'api_key.Legacy Qwen', 'dummy-alias-key')
    await setSetting(db, 'role_structuring', 'legacy-qwen')

    const settings = await loadRuntimeSettings()

    expect(settings.models).toMatchObject([{ id: 'legacy-qwen', model: 'qwen-legacy', apiKey: 'dummy-embedded-key' }])
    expect(settings.roles.structuring).toBe('legacy-qwen')
    expect(await getSetting(db, 'api_key.legacy-qwen')).toBe('dummy-embedded-key')
    expect(await getSetting(db, 'api_key.Legacy Qwen')).toBeNull()
    expect(await getSetting(db, 'model_pool')).toBe(JSON.stringify([{ id: 'legacy-qwen', alias: 'Legacy Qwen', model: 'qwen-legacy' }]))
  })
  it('does not sanitize or delete aliases when canonical key migration fails', async () => {
    const writes: string[] = []
    await expect(executeRuntimeSettingsMigration({
      canonicalKeys: [{ id: 'legacy-qwen', key: 'dummy-key' }],
      sanitizedModels: [{ id: 'legacy-qwen', alias: 'Legacy Qwen', model: 'qwen-legacy' }],
      aliasesToDelete: ['Legacy Qwen'],
    }, {
      set: async (key) => { writes.push(`set:${key}`); throw new Error('disk full') },
      delete: async (key) => { writes.push(`delete:${key}`) },
    })).rejects.toThrow('disk full')
    expect(writes).toEqual(['set:api_key.legacy-qwen'])
  })

  it('keeps canonical keys when a legacy alias equals another model ID', async () => {
    const db = await getDb()
    await setSetting(db, 'model_pool', JSON.stringify([
      { id: 'model-a', alias: 'model-b', modelName: 'a-legacy', apiKey: 'dummy-a' },
      { id: 'model-b', alias: 'B', modelName: 'b-legacy', apiKey: 'dummy-b' },
    ]))

    await loadRuntimeSettings()

    expect(await getSetting(db, 'api_key.model-a')).toBe('dummy-a')
    expect(await getSetting(db, 'api_key.model-b')).toBe('dummy-b')
  })
  it('cleans a leftover legacy alias key after a prior migration write succeeded', async () => {
    const db = await getDb()
    await setSetting(db, 'model_pool', JSON.stringify([
      { id: 'qwen-main', alias: 'Legacy Qwen', model: 'qwen-current' },
    ]))
    await setSetting(db, 'api_key.qwen-main', 'dummy-canonical-key')
    await setSetting(db, 'api_key.Legacy Qwen', 'dummy-leftover-alias-key')

    const settings = await loadRuntimeSettings()

    expect(settings.models[0].apiKey).toBe('dummy-canonical-key')
    expect(await getSetting(db, 'api_key.qwen-main')).toBe('dummy-canonical-key')
    expect(await getSetting(db, 'api_key.Legacy Qwen')).toBeNull()
    expect(await getSetting(db, 'model_pool')).toBe(JSON.stringify([
      { id: 'qwen-main', alias: 'Legacy Qwen', model: 'qwen-current' },
    ]))
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
