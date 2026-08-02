import { describe, expect, it, vi } from 'vitest'
import {
  getDefaultRuntimeSettings,
  normalizeWhisperBackendPreference,
  runtimeModelFromPoolEntry,
  runtimeSettingsFromEntries,
  type ModelPoolEntry,
} from '@/settings/model-pool'
import { capabilityFingerprint } from '@/settings/model-capabilities'
import { transcribeWithWhisper } from '@/pipeline/asr-runner'

const whisperModel: ModelPoolEntry = {
  id: 'whisper-medium',
  alias: 'Whisper medium',
  type: 'whisper-local',
  provider: 'local',
  modelName: 'medium',
  supportsVision: false,
}

const validPayload = [
  {
    id: 'sentence-1',
    text: 'GPU preferred with a CPU fallback.',
    start_time: 0,
    end_time: 1.5,
  },
]

describe('AC-LV-21 Whisper backend preference', () => {
  it('defaults missing or invalid persisted values to auto', () => {
    expect(getDefaultRuntimeSettings().whisperBackendPreference).toBe('auto')
    expect(normalizeWhisperBackendPreference(undefined)).toBe('auto')
    expect(normalizeWhisperBackendPreference('')).toBe('auto')
    expect(normalizeWhisperBackendPreference('unexpected')).toBe('auto')
    expect(normalizeWhisperBackendPreference('CUDA')).toBe('cuda')
    expect(normalizeWhisperBackendPreference('cpu')).toBe('cpu')
  })

  it('keeps the preference in every Runtime Settings snapshot', () => {
    const settings = runtimeSettingsFromEntries(
      [whisperModel],
      { asr: whisperModel.id, structuring: null, assistant: null },
      [],
      'cuda',
    )

    expect(settings.whisperBackendPreference).toBe('cuda')
  })

  it('makes the ASR capability fingerprint depend on the backend preference', () => {
    const automatic = runtimeModelFromPoolEntry(whisperModel, 'auto')
    const forcedCpu = runtimeModelFromPoolEntry(whisperModel, 'cpu')

    expect(capabilityFingerprint(automatic, 'asr'))
      .not.toBe(capabilityFingerprint(forcedCpu, 'asr'))
  })

  it('passes the import-start preference snapshot to the production ASR command', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['C:\\models\\ggml-medium.bin']
      if (command === 'start_asr') return validPayload
      throw new Error(`Unexpected command: ${command}`)
    })

    await transcribeWithWhisper({
      videoId: 'video-1',
      filePath: 'C:\\videos\\lesson.mp4',
      asrModel: {
        type: 'whisper-local',
        modelName: 'medium',
        language: 'en',
        backendPreference: 'cuda',
      },
      invoke,
    })

    expect(invoke).toHaveBeenNthCalledWith(2, 'start_asr', {
      videoId: 'video-1',
      filePath: 'C:\\videos\\lesson.mp4',
      tier: 'whisper',
      modelPath: 'C:\\models\\ggml-medium.bin',
      language: 'en',
      backendPreference: 'cuda',
    })
  })
})
