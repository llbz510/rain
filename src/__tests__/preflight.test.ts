import { describe, expect, it, vi } from 'vitest'
import {
  capabilityFingerprint,
  recordCapabilityCheck,
  type ModelCapabilityRecord,
} from '@/settings/model-capabilities'
import {
  getDefaultRuntimeSettings,
  type RuntimeModel,
  type RuntimeSettings,
} from '@/settings/model-pool'
import { runPreflightCheck } from '@/settings/preflight'
import { checkStructuringModelCapability } from '@/settings/structuring-capability'

function withGenericStructuringModel(
  settings: RuntimeSettings,
  apiKey = 'sk-test-secret',
): RuntimeSettings {
  const structuringId = settings.roles.structuring
  return {
    models: settings.models.map((model) =>
      model.id === structuringId
        ? {
            ...model,
            provider: 'custom',
            baseUrl: 'https://models.example.test/v1',
            model: 'generic-structuring-model',
            apiKey,
          }
        : model),
    roles: { ...settings.roles },
    capabilities: settings.capabilities?.map((record) => ({ ...record })),
  }
}

function successfulStructuringCheck() {
  return vi.fn(async (model: RuntimeModel) =>
    recordCapabilityCheck({
      model,
      role: 'structuring',
      ok: true,
      message: '结构化能力检查通过。',
      checkedAt: 100,
    }))
}

function desktopInvoke(options: { whisperModels?: string[]; ytdlp?: boolean } = {}) {
  return vi.fn(async (command: string) => {
    if (command === 'get_runtime_capability') {
      return { whisperBackend: 'cuda', cpuFallbackAvailable: false }
    }
    if (command === 'list_whisper_models') {
      return options.whisperModels ?? ['D:\\models\\ggml-large-v3.bin']
    }
    if (command === 'check_ytdlp_command') {
      return {
        available: options.ytdlp ?? true,
        version: options.ytdlp === false ? null : '2026.01.01',
      }
    }
    throw new Error(`unexpected command ${command}`)
  })
}

describe('Rain preflight check', () => {
  it('fails closed when the structuring key is missing and never reports a secret value', async () => {
    const settings = withGenericStructuringModel(getDefaultRuntimeSettings(), '')
    const callStage2 = vi.fn()

    const report = await runPreflightCheck({
      runtimeSettings: settings,
      isTauri: () => true,
      invoke: desktopInvoke(),
      checkDatabaseWrite: vi.fn().mockResolvedValue(undefined),
      checkStructuring: (model) => checkStructuringModelCapability(model, { callStage2 }),
    })

    expect(report.ready).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'structuring',
        label: '结构化模型',
        status: 'error',
        message: expect.stringContaining('API Key'),
      }),
    ]))
    expect(callStage2).not.toHaveBeenCalled()
    expect(JSON.stringify(report)).not.toContain('sk-test-secret')
  })

  it('accepts a generic OpenAI-compatible model only after its Stage2 contract check passes', async () => {
    const settings = withGenericStructuringModel(getDefaultRuntimeSettings())
    const invoke = desktopInvoke({ ytdlp: false })
    const checkStructuring = successfulStructuringCheck()

    const report = await runPreflightCheck({
      runtimeSettings: settings,
      isTauri: () => true,
      invoke,
      checkDatabaseWrite: vi.fn().mockResolvedValue(undefined),
      checkStructuring,
    })

    expect(report.ready).toBe(true)
    expect(report.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'asr',
        status: 'Unavailable',
        message: expect.stringContaining('真实转写能力检查'),
      }),
      expect.objectContaining({
        role: 'structuring',
        status: 'Compatible',
        message: '结构化能力检查通过。',
      }),
      expect.objectContaining({
        role: 'assistant',
        status: 'Unavailable',
        message: expect.stringContaining('停止或取消能力检查'),
      }),
    ]))
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime', status: 'ok', message: expect.stringContaining('cuda') }),
      expect.objectContaining({ id: 'whisper', status: 'ok', message: expect.stringContaining('ggml-large-v3.bin') }),
      expect.objectContaining({ id: 'structuring', status: 'ok' }),
      expect.objectContaining({ id: 'database', status: 'ok' }),
      expect.objectContaining({ id: 'ytdlp', status: 'warning' }),
    ]))
    expect(checkStructuring).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'custom',
      baseUrl: 'https://models.example.test/v1',
      model: 'generic-structuring-model',
    }))
    expect(invoke).toHaveBeenCalledWith('list_whisper_models')
    expect(JSON.stringify(report)).not.toContain('sk-test-secret')
  })

  it('does not downgrade current Verified evidence after a successful ordinary probe', async () => {
    const settings = withGenericStructuringModel(getDefaultRuntimeSettings())
    const model = settings.models.find((candidate) => candidate.id === settings.roles.structuring)!
    const verified: ModelCapabilityRecord = {
      modelId: model.id,
      modelAlias: model.alias,
      role: 'structuring',
      status: 'Verified',
      message: '完整真实 E2E 已验证。',
      checkedAt: 50,
      fingerprint: capabilityFingerprint(model, 'structuring'),
      evidenceId: 'evidence/run-1',
    }

    const report = await runPreflightCheck({
      runtimeSettings: { ...settings, capabilities: [verified] },
      isTauri: () => true,
      invoke: desktopInvoke(),
      checkDatabaseWrite: vi.fn().mockResolvedValue(undefined),
      checkStructuring: successfulStructuringCheck(),
    })

    expect(report.capabilities).toContainEqual(verified)
  })

  it('does not pass a stale absolute Whisper path unless the runtime reports it installed', async () => {
    const settings = withGenericStructuringModel(getDefaultRuntimeSettings())
    const stalePathSettings: RuntimeSettings = {
      ...settings,
      models: settings.models.map((model) =>
        model.id === 'whisper-large-v3'
          ? { ...model, model: 'D:\\old\\ggml-large-v3.bin' }
          : model),
    }

    const report = await runPreflightCheck({
      runtimeSettings: stalePathSettings,
      isTauri: () => true,
      invoke: desktopInvoke({ whisperModels: ['D:\\models\\ggml-small.bin'] }),
      checkDatabaseWrite: vi.fn().mockResolvedValue(undefined),
      checkStructuring: successfulStructuringCheck(),
    })

    expect(report.ready).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'whisper',
        status: 'error',
        message: expect.stringContaining('ggml-large-v3.bin'),
      }),
    ]))
  })

  it('warns about a missing assistant without blocking local video processing', async () => {
    const settings = withGenericStructuringModel(getDefaultRuntimeSettings())
    const report = await runPreflightCheck({
      runtimeSettings: {
        ...settings,
        roles: { ...settings.roles, assistant: null },
      },
      isTauri: () => true,
      invoke: desktopInvoke(),
      checkDatabaseWrite: vi.fn().mockResolvedValue(undefined),
      checkStructuring: successfulStructuringCheck(),
    })

    expect(report.ready).toBe(true)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'assistant', status: 'warning' }),
    ]))
  })
})
