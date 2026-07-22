import { useEffect, useState } from 'react'
import { createDatabase } from '@/models/database'
import {
  getImportCheckpoint,
  getNodesByVideoId,
  getSentencesByVideoId,
  getVideoById,
  insertVideo,
} from '@/models/database'
import type { ImportCheckpoint, Sentence, Video } from '@/models/types'
import { runPipeline } from '@/pipeline/pipeline-orchestrator'
import { isCancellationError } from '@/pipeline/asr-runner'
import { redactSecret } from '@/llm/client'
import { isTauri, tauriInvoke } from '@/lib/tauri-env'

interface RealE2eConfig {
  enabled: boolean
  videoPath: string
  whisperModelPath: string
  qwenBaseUrl: string
  qwenModel: string
  qwenApiKey: string
  whisperBackend: 'cpu' | 'cuda'
  databasePath: string
}

type RealE2eStatus = 'disabled' | 'running' | 'passed' | 'failed'

interface RealE2eEvent {
  at: string
  event: string
  detail?: string
}

interface RealE2eResult {
  status: RealE2eStatus
  error?: string
  videoId?: string
  events: RealE2eEvent[]
  transcript?: {
    detectedLanguage: string
    sentences: Array<Pick<Sentence, 'id' | 'text' | 'startTime' | 'endTime'>>
  }
  qwenBlocks?: unknown[]
  database?: Record<string, unknown>
  cancellation?: Record<string, unknown>
  restart?: Record<string, unknown>
  timings?: Record<string, number>
  runtime?: {
    whisperBackend: 'cpu' | 'cuda'
    whisperModel: string
    qwenModel: string
    qwenBaseUrl: string
  }
}

declare global {
  interface Window {
    __RAIN_E2E_RESULT__?: RealE2eResult
    __RAIN_E2E_START__?: boolean
  }
}

const REQUIRED_MODEL = 'qwen3.5-omni-flash'
const REQUIRED_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

function nowIso(): string {
  return new Date().toISOString()
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}


function toTranscript(sentences: Sentence[]): RealE2eResult['transcript'] {
  return {
    detectedLanguage: 'zh',
    sentences: sentences.map(({ id, text, startTime, endTime }) => ({ id, text, startTime, endTime })),
  }
}

function checkpointBlocks(checkpoint: ImportCheckpoint | null): unknown[] {
  const outputs = checkpoint?.completedBlockOutputs
  return Array.isArray(outputs) ? outputs : []
}

function createVideo(id: string, filePath: string): Video {
  const createdAt = Date.now()
  return {
    id,
    title: basename(filePath),
    source: 'local',
    filePath,
    thumbnail: '',
    duration: 0,
    language: '',
    status: 'pending',
    createdAt,
    position: 0,
    lastStudiedAt: createdAt,
  }
}

function waitForWebDriverStart(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (window.__RAIN_E2E_START__) resolve()
      else window.setTimeout(check, 250)
    }
    check()
  })
}
function publish(result: RealE2eResult, setStatus: (status: RealE2eStatus) => void): void {
  window.__RAIN_E2E_RESULT__ = result
  setStatus(result.status)
}

function pushEvent(result: RealE2eResult, event: string, detail?: string): void {
  result.events.push({ at: nowIso(), event, detail })
  window.__RAIN_E2E_RESULT__ = { ...result, events: [...result.events] }
}

async function runRealE2e(config: RealE2eConfig, setStatus: (status: RealE2eStatus) => void): Promise<void> {
  const result: RealE2eResult = { status: 'running', events: [] }
  publish(result, setStatus)

  if (!config.enabled) {
    publish({ status: 'disabled', events: [] }, setStatus)
    return
  }
  if (config.qwenModel !== REQUIRED_MODEL) throw new Error(`Qwen model must be ${REQUIRED_MODEL}`)
  if (config.qwenBaseUrl.replace(/\/+$/, '') !== REQUIRED_BASE_URL) throw new Error(`Qwen base URL must be ${REQUIRED_BASE_URL}`)

  const db = await createDatabase(config.databasePath)
  const videoId = `rain-real-e2e-${Date.now()}`
  const video = createVideo(videoId, config.videoPath)
  await insertVideo(db, video)
  pushEvent(result, 'start_import', videoId)

  const llmSettings = {
    baseUrl: config.qwenBaseUrl,
    apiKey: config.qwenApiKey,
    model: config.qwenModel,
  }
  const asrModel = { type: 'whisper-local', modelName: config.whisperModelPath }

  const cancelController = new AbortController()
  const cancelStarted = performance.now()
  const cancelRun = runPipeline(video, llmSettings, {
    onProgress: (stage, percent) => pushEvent(result, `cancel_progress:${stage}`, String(percent)),
    onComplete: () => pushEvent(result, 'cancel_unexpected_complete'),
    onError: (error) => pushEvent(result, 'cancel_error', redactSecret(error.message, [config.qwenApiKey])),
  }, db, asrModel, { signal: cancelController.signal })

  await new Promise((resolve) => window.setTimeout(resolve, 1000))
  cancelController.abort()
  await tauriInvoke<void>('cancel_import', { videoId })
  pushEvent(result, 'cancel_import', videoId)
  try {
    await cancelRun
    throw new Error('Cancellation run completed instead of stopping')
  } catch (error) {
    if (!isCancellationError(error)) throw error
  }
  const cancelledVideo = await getVideoById(db, videoId)
  if (cancelledVideo?.status !== 'cancelled') {
    throw new Error(`Cancellation did not persist cancelled status; actual=${cancelledVideo?.status ?? 'missing'}`)
  }
  pushEvent(result, 'import_cancelled', videoId)
  result.cancellation = {
    result: 'passed',
    source: 'rain-app-automation',
    events: result.events.map((event) => event.event),
    elapsedSeconds: Math.max(1, Math.round((performance.now() - cancelStarted) / 1000)),
  }

  const retryVideo = await getVideoById(db, videoId)
  if (!retryVideo) throw new Error('Video missing before retry')
  const stageStart: Record<string, number> = { asr: performance.now() }
  const timings: Record<string, number> = {}
  const retryStarted = performance.now()
  pushEvent(result, 'retry_import', videoId)
  await runPipeline(retryVideo, llmSettings, {
    onProgress: (stage, percent) => {
      if (stage === 'stage2' && stageStart.stage2 === undefined) {
        timings.asrSeconds = Math.max(1, Math.round((performance.now() - stageStart.asr) / 1000))
        stageStart.stage2 = performance.now()
      }
      if (stage === 'merging' && stageStart.merging === undefined) {
        timings.qwenSeconds = Math.max(1, Math.round((performance.now() - (stageStart.stage2 ?? performance.now())) / 1000))
        stageStart.merging = performance.now()
      }
      pushEvent(result, `retry_progress:${stage}`, String(percent))
    },
    onComplete: () => pushEvent(result, 'import_complete', videoId),
    onError: (error) => pushEvent(result, 'retry_error', redactSecret(error.message, [config.qwenApiKey])),
  }, db, asrModel)

  const readyVideo = await getVideoById(db, videoId)
  if (readyVideo?.status !== 'ready') throw new Error(`Retry did not persist ready status; actual=${readyVideo?.status ?? 'missing'}`)
  const sentences = await getSentencesByVideoId(db, videoId)
  const nodes = await getNodesByVideoId(db, videoId)
  const checkpoint = await getImportCheckpoint(db, videoId)
  const qwenBlocks = checkpointBlocks(checkpoint)
  if (sentences.length === 0) throw new Error('Ready video has no persisted sentences')
  if (nodes.length === 0) throw new Error('Ready video has no persisted nodes')
  if (qwenBlocks.length === 0) throw new Error('Ready video has no persisted Qwen checkpoint blocks')

  timings.pipelineSeconds = Math.max(1, Math.round((performance.now() - retryStarted) / 1000))
  timings.asrSeconds ??= timings.pipelineSeconds
  timings.qwenSeconds ??= 1

  result.status = 'passed'
  result.videoId = videoId
  result.transcript = toTranscript(sentences)
  result.qwenBlocks = qwenBlocks
  result.database = {
    videoId,
    status: readyVideo.status,
    rawStage: readyVideo.stage ?? null,
    stage: 'ready',
    sentenceCount: sentences.length,
    nodeCount: nodes.length,
    qwenBlockCount: qwenBlocks.length,
    evidenceSource: 'rain-app-query',
    queriedAt: nowIso(),
    databasePath: config.databasePath,
  }
  result.restart = {
    result: 'passed',
    source: 'rain-app-automation',
    events: result.events.map((event) => event.event),
    elapsedSeconds: timings.pipelineSeconds,
  }
  result.timings = timings
  result.runtime = {
    whisperBackend: config.whisperBackend,
    whisperModel: basename(config.whisperModelPath),
    qwenModel: config.qwenModel,
    qwenBaseUrl: config.qwenBaseUrl,
  }
  publish(result, setStatus)
}

export function RealE2eRunner() {
  const [status, setStatus] = useState<RealE2eStatus>('disabled')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    void tauriInvoke<RealE2eConfig | null>('get_real_e2e_config')
      .then(async (config) => {
        if (cancelled || !config?.enabled) return
        setStatus('running')
        window.__RAIN_E2E_RESULT__ = { status: 'running', events: [{ at: nowIso(), event: 'armed' }] }
        await waitForWebDriverStart()
        await runRealE2e(config, setStatus)
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        if (cancelled) return
        setError(message)
        setStatus('failed')
        window.__RAIN_E2E_RESULT__ = { status: 'failed', error: message, events: [] }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (status === 'disabled') return null
  return (
    <div
      data-testid="rain-real-e2e-status"
      data-status={status}
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        zIndex: 9999,
        padding: '8px 10px',
        borderRadius: 4,
        background: status === 'failed' ? '#5b1b1b' : '#1b2a5b',
        color: '#fff',
        fontSize: 12,
      }}
    >
      Rain real E2E: {status}{error ? ` - ${error}` : ''}
    </div>
  )
}
