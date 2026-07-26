import type { Database } from '@/models/database'
import { saveAsrAtomically, transitionVideoImportState } from '@/models/database'
import type { Sentence, Video } from '@/models/types'
import { detectLanguageFromSentences } from '@/pipeline/language-detection'
import { assertTransition, type ImportStage } from '@/pipeline/import-state'
import { tauriInvoke } from '@/lib/tauri-env'

export interface AsrModelConfig {
  type: string
  modelName: string
  language?: string
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

function hasMojibakeMarkers(text: string): boolean {
  return /(?:\u951f\u65a4\u62f7|\uFFFD)/u.test(text)
}

export interface RunAsrStageInput {
  video: Video
  asrModel: AsrModelConfig
  db: Database
  invoke?: PipelineInvoke
  saveAsr?: typeof saveAsrAtomically
  transition?: typeof transitionVideoImportState
  signal?: AbortSignal
}

export interface TranscribeWithWhisperInput {
  videoId: string
  filePath: string
  asrModel: AsrModelConfig
  invoke?: PipelineInvoke
  signal?: AbortSignal
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const normalized = new Error(String((error as { message: unknown }).message))
    if ('name' in error && typeof (error as { name?: unknown }).name === 'string') normalized.name = (error as { name: string }).name
    return normalized
  }
  return new Error(String(error))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('ASR cancelled', 'AbortError')
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
  if (savedLooksLikePath && /^ggml-.+\.bin$/i.test(basename(saved))) return saved

  const expectedFilename = /^ggml-.+\.bin$/i.test(saved)
    ? saved
    : `ggml-${saved}.bin`
  const installedPath = installedModels.find((entry) => basename(entry) === expectedFilename)

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
    if (hasMojibakeMarkers(text)) {
      throw new Error(`Invalid Whisper ASR result: sentence "${id}" contains mojibake text`)
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

export async function transcribeWithWhisper(
  input: TranscribeWithWhisperInput,
): Promise<Sentence[]> {
  const invoke = input.invoke ?? (tauriInvoke as PipelineInvoke)
  const { videoId, filePath, asrModel, signal } = input

  throwIfAborted(signal)
  if (!filePath.trim()) {
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
  throwIfAborted(signal)
  const result = await invoke('start_asr', {
    videoId,
    filePath,
    tier: 'whisper',
    modelPath,
    language: asrModel.language ?? 'zh',
  })
  throwIfAborted(signal)
  return validateWhisperResult(result)
}

export async function runAsrStage(input: RunAsrStageInput): Promise<Sentence[]> {
  const { video, asrModel, db, signal } = input
  const saveAsr = input.saveAsr ?? saveAsrAtomically
  const transition = input.transition ?? transitionVideoImportState

  const stage = currentImportStage(video)
  if (stage === 'pending') {
    assertTransition(stage, 'asr')
    await transition(
      db,
      video.id,
      { status: 'pending', stage: null },
      { status: 'processing', stage: 'asr' },
    )
  } else if (stage !== 'asr') {
    throw new Error(`Invalid import transition: ${stage} -> asr`)
  }

  try {
    throwIfAborted(signal)
    if (video.source !== 'local' || !video.filePath?.trim()) {
      throw new Error('Whisper ASR requires a real local file path')
    }

    const sentences = await transcribeWithWhisper({
      videoId: video.id,
      filePath: video.filePath,
      asrModel,
      invoke: input.invoke,
      signal,
    })
    const language = detectLanguageFromSentences(sentences)
    await saveAsr(video.id, language, sentences, db)
    assertTransition('asr', 'stage2')
    return sentences
  } catch (cause) {
    const error = asError(cause)
    const terminal = isCancellationError(error) ? 'cancelled' : 'failed'
    assertTransition('asr', terminal)
    try {
      await transition(
        db,
        video.id,
        { status: 'processing', stage: 'asr' },
        { status: terminal, stage: 'asr', errorMessage: error.message },
      )
    } catch {
      // Persistence failure must not replace the primary ASR error.
    }
    throw error
  }
}
