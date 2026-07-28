import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import {
  listModels,
  replaceModelPool,
  type ModelPoolEntry,
  type RuntimeSettings,
} from '@/settings/model-pool'
import { useRainStore } from '@/store/rain-store'

const emptySettings: RuntimeSettings = {
  models: [],
  roles: { asr: null, structuring: null, assistant: null },
  capabilities: [],
}

const persistence = vi.hoisted(() => ({
  load: vi.fn(async () => emptySettings),
  save: vi.fn(async (_settings: RuntimeSettings) => undefined),
}))

vi.mock('@/settings/model-pool', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/settings/model-pool')>(),
  loadRuntimeSettings: persistence.load,
  saveRuntimeSettings: persistence.save,
}))

const model: ModelPoolEntry = {
  id: 'llm-main',
  alias: 'Main LLM',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'dummy-key',
  modelName: 'model-a',
  supportsVision: false,
}

beforeEach(() => {
  persistence.save.mockReset()
  persistence.save.mockResolvedValue(undefined)
  replaceModelPool([])
  useRainStore.setState({
    modelPool: [],
    roleAssignment: { ...emptySettings.roles },
    capabilityRecords: [],
    settingsReady: true,
    settingsError: null,
  })
})

describe('AC-LV-14 Store runtime settings commit', () => {
  it('publishes an added model only after snapshot persistence resolves', async () => {
    let finishSave!: () => void
    persistence.save.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSave = resolve
    }))

    const pending = useRainStore.getState().addModel({
      type: 'llm',
      provider: 'custom',
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'dummy-key',
      modelName: 'model-a',
      alias: 'Main LLM',
      supportsVision: false,
    })

    expect(useRainStore.getState().modelPool).toEqual([])
    expect(listModels()).toEqual([])

    finishSave()
    await expect(pending).resolves.toEqual({ ok: true })
    expect(useRainStore.getState().modelPool).toMatchObject([{ alias: 'Main LLM' }])
    expect(listModels()).toMatchObject([{ alias: 'Main LLM' }])
  })

  it('does not publish an added model when snapshot persistence fails', async () => {
    persistence.save.mockRejectedValueOnce(new Error('disk full'))

    const result = await useRainStore.getState().addModel({
      type: 'llm',
      provider: 'custom',
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'dummy-key',
      modelName: 'model-a',
      alias: 'Main LLM',
      supportsVision: false,
    })

    expect(result).toEqual({ ok: false, error: '保存模型设置失败：disk full' })
    expect(useRainStore.getState().modelPool).toEqual([])
    expect(listModels()).toEqual([])
  })

  it('does not publish a removal when snapshot persistence fails', async () => {
    replaceModelPool([model])
    const capability = recordCapabilityCheck({
      model: { ...model, model: model.modelName },
      role: 'structuring',
      ok: true,
      message: 'compatible',
      checkedAt: 100,
    })
    useRainStore.setState({
      modelPool: [model],
      roleAssignment: { asr: null, structuring: model.id, assistant: null },
      capabilityRecords: [capability],
    })
    persistence.save.mockRejectedValueOnce(new Error('database locked'))

    const result = await useRainStore.getState().removeModel(model.id)

    expect(result).toEqual({ ok: false, error: '删除模型失败：database locked' })
    expect(useRainStore.getState()).toMatchObject({
      modelPool: [model],
      roleAssignment: { asr: null, structuring: model.id, assistant: null },
      capabilityRecords: [capability],
    })
    expect(listModels()).toEqual([model])
  })

  it('does not publish a role assignment when snapshot persistence fails', async () => {
    replaceModelPool([model])
    const capability = recordCapabilityCheck({
      model: { ...model, model: model.modelName },
      role: 'structuring',
      ok: true,
      message: 'compatible',
      checkedAt: 100,
    })
    useRainStore.setState({ modelPool: [model], capabilityRecords: [capability] })
    persistence.save.mockRejectedValueOnce(new Error('read only'))

    const result = await useRainStore.getState().setRoleModel('structuring', model.id)

    expect(result).toEqual({ ok: false, error: '保存角色选择失败：read only' })
    expect(useRainStore.getState().roleAssignment.structuring).toBeNull()
  })
})
