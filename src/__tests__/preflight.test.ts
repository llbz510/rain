import { describe, expect, it, vi } from 'vitest'
import { getDefaultRuntimeSettings, type RuntimeSettings } from '@/settings/model-pool'
import { runPreflightCheck } from '@/settings/preflight'

function withQwenKey(settings: RuntimeSettings): RuntimeSettings {
  return {
    models: settings.models.map((model) =>
      model.id === 'qwen-main' ? { ...model, baseUrl: `${model.baseUrl}/`, apiKey: 'sk-test-secret' } : model,
    ),
    roles: { ...settings.roles },
  }
}

describe('Rain preflight check', () => {
  it('fails closed when Qwen key is missing and never reports the secret value', async () => {
    const report = await runPreflightCheck({
      runtimeSettings: getDefaultRuntimeSettings(),
      isTauri: () => true,
      invoke: vi.fn(async (command) => {
        if (command === 'get_runtime_capability') return { whisperBackend: 'cuda', cpuFallbackAvailable: false }
        if (command === 'list_whisper_models') return ['D:\\models\\ggml-large-v3.bin']
        if (command === 'check_ytdlp_command') return { available: true, version: '2026.01.01' }
        throw new Error(`unexpected command ${command}`)
      }),
      checkDatabaseWrite: vi.fn().mockResolvedValue(undefined),
      testQwen: vi.fn(),
    })

    expect(report.ready).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'qwen', status: 'error' }),
    ]))
    expect(JSON.stringify(report)).not.toContain('sk-test-secret')
  })

  it('reports a ready local-video workflow with CUDA Whisper and optional yt-dlp warning', async () => {
    const invoke = vi.fn(async (command) => {
      if (command === 'get_runtime_capability') return { whisperBackend: 'cuda', cpuFallbackAvailable: false }
      if (command === 'list_whisper_models') return ['D:\\models\\ggml-large-v3.bin']
      if (command === 'check_ytdlp_command') return { available: false, version: null }
      throw new Error(`unexpected command ${command}`)
    })

    const report = await runPreflightCheck({
      runtimeSettings: withQwenKey(getDefaultRuntimeSettings()),
      isTauri: () => true,
      invoke,
      checkDatabaseWrite: vi.fn().mockResolvedValue(undefined),
      testQwen: vi.fn().mockResolvedValue({ ok: true, latencyMs: 42, message: '连接成功（42 ms）' }),
    })

    expect(report.ready).toBe(true)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime', status: 'ok', message: expect.stringContaining('cuda') }),
      expect.objectContaining({ id: 'whisper', status: 'ok', message: expect.stringContaining('ggml-large-v3.bin') }),
      expect.objectContaining({ id: 'qwen', status: 'ok' }),
      expect.objectContaining({ id: 'database', status: 'ok' }),
      expect.objectContaining({ id: 'ytdlp', status: 'warning' }),
    ]))
    expect(invoke).toHaveBeenCalledWith('list_whisper_models')
    expect(JSON.stringify(report)).not.toContain('sk-test-secret')
  })

  it('does not pass a stale absolute Whisper path unless list_whisper_models reports the same installed model', async () => {
    const settings = getDefaultRuntimeSettings()
    const stalePathSettings: RuntimeSettings = {
      models: settings.models.map((model) =>
        model.id === 'whisper-large-v3' ? { ...model, model: 'D:\\old\\ggml-large-v3.bin' } : model,
      ),
      roles: { ...settings.roles },
    }

    const report = await runPreflightCheck({
      runtimeSettings: stalePathSettings,
      isTauri: () => true,
      invoke: vi.fn(async (command) => {
        if (command === 'get_runtime_capability') return { whisperBackend: 'cuda', cpuFallbackAvailable: false }
        if (command === 'list_whisper_models') return ['D:\\models\\ggml-small.bin']
        if (command === 'check_ytdlp_command') return { available: true, version: '2026.01.01' }
        throw new Error(`unexpected command ${command}`)
      }),
      checkDatabaseWrite: vi.fn().mockResolvedValue(undefined),
      testQwen: vi.fn(),
    })

    expect(report.ready).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'whisper', status: 'error', message: expect.stringContaining('ggml-large-v3.bin') }),
    ]))
  })

  it('warns about a missing assistant without blocking local video processing', async () => {
    const settings = withQwenKey(getDefaultRuntimeSettings())
    const report = await runPreflightCheck({
      runtimeSettings: { ...settings, roles: { ...settings.roles, assistant: null } },
      isTauri: () => true,
      invoke: vi.fn(async (command) => {
        if (command === 'get_runtime_capability') return { whisperBackend: 'cuda', cpuFallbackAvailable: false }
        if (command === 'list_whisper_models') return ['D:\\models\\ggml-large-v3.bin']
        if (command === 'check_ytdlp_command') return { available: true, version: '2026.01.01' }
        throw new Error(`unexpected command ${command}`)
      }),
      checkDatabaseWrite: vi.fn().mockResolvedValue(undefined),
      testQwen: vi.fn().mockResolvedValue({ ok: true, latencyMs: 42, message: '连接成功（42 ms）' }),
    })

    expect(report.ready).toBe(true)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'assistant', status: 'warning' }),
    ]))
  })
})
