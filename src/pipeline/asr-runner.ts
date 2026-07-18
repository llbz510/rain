import type { Database } from '@/models/database'
import { saveAsrAtomically, updateVideoImportState } from '@/models/database'
import type { Sentence, Video } from '@/models/types'
import { detectLanguageFromSentences } from '@/pipeline/asr-normalize'
import { assertTransition, type ImportStage } from '@/pipeline/import-state'
import { tauriInvoke } from '@/lib/tauri-env'

export interface AsrModelConfig {
  type: string
  modelName: string
}

export type PipelineInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>

interface WhisperSentencePayload {
  id: unknown
  text: unknown
  start_time: unknown
  end_time: unknown
}

export interface RunAsrStageInput {
  video: Video
  asrModel: AsrModelConfig
  db: Database
  invoke?: PipelineInvoke
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function isCancellationError(error: unknown): boolean {
  const normalized = asError(error)
  return normalized.name === 'AbortError' || /\bcancel(?:led|ed)\b/i.test(normalized.message)
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function resolveInstalledModelPath(savedModelName: string, installedModels: string[]): string {
  const saved = savedModelName.trim()
  if (!saved) {
    throw new Error('The saved Whisper model name is empty; select a downloaded Whisper model in Settings')
  }

  const exactPath = installedModels.find((entry) => entry === saved)
  if (exactPath) return exactPath

  const savedLooksLikePath = saved.includes('/') || saved.includes('\\')
  const expectedFilename = /^ggml-.+\.bin$/i.test(saved)
    ? saved
    : `ggml-${saved}.bin`
  const installedPath = savedLooksLikePath
    ? undefined
    : installedModels.find((entry) => basename(entry) === expectedFilename)

  if (!installedPath) {
    throw new Error(
      `Whisper model "${saved}" is not installed. Download ${basename(expectedFilename)} in Settings and retry.`,
    )
  }
  return installedPath
}

function validateWhisperResult(result: unknown): Sentence[] {
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error('Invalid Whisper ASR result: expected a non-empty sentence array')
  }

  const seenIds = new Set<string>()
  let previousEnd = 0
  return result.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new Error(`Invalid Whisper ASR result: sentence ${index} must be an object`)
    }
    const payload = value as WhisperSentencePayload
    const id = typeof payload.id === 'string' ? payload.id.trim() : ''
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    const startTime = payload.start_time
    const endTime = payload.end_time

    if (!id) {
      throw new Error(`Invalid Whisper ASR result: sentence ${index} has an empty ID`)
    }
    if (seenIds.has(id)) {
      throw new Error(`Invalid Whisper ASR result: duplicate sentence ID "${id}"`)
    }
    if (!text) {
      throw new Error(`Invalid Whisper ASR result: sentence "${id}" has blank text`)
    }
    if (typeof startTime !== 'number' || typeof endTime !== 'number'
      || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      throw new Error(`Invalid Whisper ASR result: sentence "${id}" has non-finite timestamps`)
    }
    if (startTime < 0 || startTime >= endTime) {
      throw new Error(`Invalid Whisper ASR result: sentence "${id}" has an invalid time range`)
    }
    if (index > 0 && startTime < previousEnd) {
      throw new Error(`Invalid Whisper ASR result: sentence "${id}" overlaps the previous sentence`)
    }

    seenIds.add(id)
    previousEnd = endTime
    return {
      id,
      nodeId: '',
      text,
      startTime,
      endTime,
      sortOrder: index,
    }
  })
}

function currentImportStage(video: Video): ImportStage {
  if (video.status === 'processing') {
    if (video.stage) return video.stage
    throw new Error(`Video "${video.id}" is processing without an import stage`)
  }
  return video.status
}

export async function runAsrStage(input: RunAsrStageInput): Promise<Sentence[]> {
  const { video, asrModel, db } = input
  const invoke = input.invoke ?? (tauriInvoke as PipelineInvoke)

  assertTransition(currentImportStage(video), 'asr')
  await updateVideoImportState(db, video.id, 'processing', 'asr')

  try {
    if (video.source !== 'local' || !video.filePath?.trim()) {
      throw new Error('Whisper ASR requires a real local file path')
    }
    if (asrModel.type !== 'whisper-local') {
      throw new Error('Only a saved whisper-local ASR model is supported for local imports')
    }

    const listed = await invoke('list_whisper_models')
    if (!Array.isArray(listed) || listed.some((entry) => typeof entry !== 'string' || !entry.trim())) {
      throw new Error('Cannot resolve installed Whisper models: list_whisper_models returned invalid data')
    }
    const modelPath = resolveInstalledModelPath(asrModel.modelName, listed as string[])
    const result = await invoke('start_asr', {
      videoId: video.id,
      filePath: video.filePath,
      tier: 'whisper',
      modelPath,
    })
    const sentences = validateWhisperResult(result)
    const language = detectLanguageFromSentences(sentences)
    await saveAsrAtomically(video.id, language, sentences)
    assertTransition('asr', 'stage2')
    return sentences
  } catch (cause) {
    const error = asError(cause)
    const terminal = isCancellationError(error) ? 'cancelled' : 'failed'
    assertTransition('asr', terminal)
    await updateVideoImportState(db, video.id, terminal, 'asr', error.message)
    throw error
  }
}
