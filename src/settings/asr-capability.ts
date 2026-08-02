import { redactSecret } from '@/llm/client'
import {
  transcribeWithWhisper,
  type PipelineInvoke,
} from '@/pipeline/asr-runner'
import {
  recordCapabilityCheck,
  type ModelCapabilityRecord,
} from '@/settings/model-capabilities'
import type { RuntimeModel } from '@/settings/model-pool'
import type { WhisperBackendPreference } from '@/settings/model-pool'

const ASR_PROBE_RESOURCE = 'asr-capability/sample.mp4'
const ASR_PROBE_VIDEO_ID = 'rain-asr-capability'

export interface CheckAsrModelCapabilityOptions {
  invoke?: PipelineInvoke
  resolveProbeFile?: () => Promise<string>
  checkedAt?: number
  signal?: AbortSignal
  backendPreference?: WhisperBackendPreference
}

async function resolveBundledProbeFile(): Promise<string> {
  const { resolveResource } = await import('@tauri-apps/api/path')
  return resolveResource(ASR_PROBE_RESOURCE)
}

export async function checkAsrModelCapability(
  model: RuntimeModel,
  options: CheckAsrModelCapabilityOptions = {},
): Promise<ModelCapabilityRecord> {
  try {
    const probeFile = await (options.resolveProbeFile ?? resolveBundledProbeFile)()
    const sentences = await transcribeWithWhisper({
      videoId: ASR_PROBE_VIDEO_ID,
      filePath: probeFile,
      asrModel: {
        type: model.type ?? '',
        modelName: model.model,
        language: 'en',
        backendPreference: options.backendPreference
          ?? model.whisperBackendPreference
          ?? 'auto',
      },
      invoke: options.invoke,
      signal: options.signal,
    })
    return recordCapabilityCheck({
      model,
      role: 'asr',
      ok: true,
      message: `ASR 能力检查通过：短语音样本产生 ${sentences.length} 条有效转写。`,
      checkedAt: options.checkedAt,
    })
  } catch (error) {
    const message = redactSecret(
      error instanceof Error ? error.message : String(error),
      [model.apiKey ?? ''],
    )
    return recordCapabilityCheck({
      model,
      role: 'asr',
      ok: false,
      message: `ASR 能力检查失败：${message || '未知错误'}`,
      checkedAt: options.checkedAt,
    })
  }
}
