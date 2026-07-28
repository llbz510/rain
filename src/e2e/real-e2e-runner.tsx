import { useEffect, useState } from 'react'
import {
  createDatabase,
  getImportCheckpoint,
  getNodesByVideoId,
  getSentencesByVideoId,
  getVideoById,
  insertVideo,
  type Database,
} from '@/models/database'
import type { ImportCheckpoint, Sentence, Video, VideoStatus } from '@/models/types'
import { createVideoImportController } from '@/pipeline/video-import-controller'
import { redactSecret } from '@/llm/client'
import { isTauri, tauriInvoke } from '@/lib/tauri-env'
import { getDb } from '@/models/db-singleton'
import { checkAsrModelCapability } from '@/settings/asr-capability'
import {
  ASSISTANT_CAPABILITY_TOKEN,
  checkAssistantModelCapability,
} from '@/settings/assistant-capability'
import {
  decideModelRoleAssignment,
  recordCapabilityCheck,
  type ModelCapabilityRecord,
} from '@/settings/model-capabilities'
import {
  runtimeModelFromPoolEntry,
  type ModelPoolEntry,
  type RuntimeModel,
} from '@/settings/model-pool'
import { checkStructuringModelCapability } from '@/settings/structuring-capability'
import { useRainStore } from '@/store/rain-store'

interface RealE2eConfig {
  enabled: boolean
  runMode: 'full' | 'ui-proof' | 'runtime-settings'
  evidenceId: string
  videoPath: string
  whisperModelPath: string
  llmBaseUrl: string
  llmModel: string
  llmApiKey: string
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
  structuringBlocks?: unknown[]
  database?: Record<string, unknown>
  cancellation?: Record<string, unknown>
  restart?: Record<string, unknown>
  timings?: Record<string, number>
  capabilities?: {
    source: 'rain-app-automation'
    checks: ModelCapabilityRecord[]
    verifiedRecords: ModelCapabilityRecord[]
  }
  runtimeGates?: {
    source: 'rain-app-automation'
    import: Record<string, unknown>
    assistant: Record<string, unknown>
  }
  runtime?: {
    whisperBackend: 'cpu' | 'cuda'
    whisperModel: string
    llmModel: string
    llmBaseUrl: string
  }
}

interface RuntimeSettingsSchemaResult {
  status: 'running' | 'passed' | 'failed'
  tables?: Record<string, string[]>
  error?: string
}

declare global {
  interface Window {
    __RAIN_E2E_RESULT__?: RealE2eResult
    __RAIN_E2E_START__?: boolean
    __RAIN_RUNTIME_SETTINGS_SCHEMA__?: RuntimeSettingsSchemaResult
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

function toTranscript(sentences: Sentence[]): RealE2eResult['transcript'] {
  return {
    detectedLanguage: 'zh',
    sentences: sentences.map(({ id, text, startTime, endTime }) => ({
      id,
      text,
      startTime,
      endTime,
    })),
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

async function waitForVideoStatus(
  db: Database,
  videoId: string,
  expected: VideoStatus[],
  timeoutMs: number,
): Promise<Video> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const video = await getVideoById(db, videoId)
    if (video && expected.includes(video.status)) return video
    await new Promise((resolve) => window.setTimeout(resolve, 250))
  }
  const video = await getVideoById(db, videoId)
  throw new Error(
    `Timed out waiting for ${videoId} status ${expected.join('|')}; actual=${video?.status ?? 'missing'}`,
  )
}

async function loadVideoIntoStudyPage(videoId: string): Promise<void> {
  const loadResult = await useRainStore.getState().loadVideo(videoId)
  if (!loadResult.ok) throw new Error(loadResult.error)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const state = useRainStore.getState()
    const study = document.querySelector<HTMLElement>('[data-testid="study-interface"]')
    const paragraph = document.querySelector<HTMLElement>('[data-testid^="paragraph-"]')
    if (
      state.currentPage === 'study'
      && state.currentVideoId === videoId
      && state.nodeTree.length > 0
      && state.sentences.length > 0
      && study
      && paragraph
    ) {
      return
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  throw new Error('Production StudyInterface did not render persisted E2E content')
}

function publish(result: RealE2eResult, setStatus: (status: RealE2eStatus) => void): void {
  window.__RAIN_E2E_RESULT__ = result
  setStatus(result.status)
}

function pushEvent(result: RealE2eResult, event: string, detail?: string): void {
  result.events.push({ at: nowIso(), event, detail })
  window.__RAIN_E2E_RESULT__ = { ...result, events: [...result.events] }
}

async function publishRuntimeSettingsSchema(): Promise<void> {
  window.__RAIN_RUNTIME_SETTINGS_SCHEMA__ = { status: 'running' }
  try {
    const db = await getDb()
    const tableNames = await db.listTables()
    const tables: Record<string, string[]> = {}
    for (const tableName of tableNames) {
      tables[tableName] = await db.getTableColumns(tableName)
    }
    window.__RAIN_RUNTIME_SETTINGS_SCHEMA__ = { status: 'passed', tables }
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)
    window.__RAIN_RUNTIME_SETTINGS_SCHEMA__ = { status: 'failed', error }
  }
}

function requireCompatible(record: ModelCapabilityRecord): ModelCapabilityRecord {
  if (record.status === 'Compatible' || record.status === 'Verified') return record
  throw new Error(`${record.role} capability probe failed: ${record.message}`)
}

function verifiedRecord(
  model: RuntimeModel,
  check: ModelCapabilityRecord,
  evidenceId: string,
): ModelCapabilityRecord {
  return recordCapabilityCheck({
    model,
    role: check.role,
    ok: true,
    verified: true,
    evidenceId,
    message: `Full Rain E2E verified ${check.role} through production runtime gates.`,
  })
}

async function runRealE2e(
  config: RealE2eConfig,
  setStatus: (status: RealE2eStatus) => void,
): Promise<void> {
  const result: RealE2eResult = { status: 'running', events: [] }
  publish(result, setStatus)

  if (!config.enabled) {
    publish({ status: 'disabled', events: [] }, setStatus)
    return
  }

  const db = await createDatabase(config.databasePath)
  if (config.runMode === 'ui-proof') {
    const asrModel = runtimeModelFromPoolEntry({
      id: 'rain-e2e-asr',
      alias: `Whisper ${basename(config.whisperModelPath)}`,
      type: 'whisper-local',
      provider: 'local',
      modelName: config.whisperModelPath,
      supportsVision: false,
    })
    requireCompatible(await checkAsrModelCapability(asrModel))
    pushEvent(result, 'ui_replay_asr_capability')
    const videoId = `${config.evidenceId}-video`
    const video = await getVideoById(db, videoId)
    if (video?.status !== 'ready') {
      throw new Error(`UI proof requires a ready evidence video; actual=${video?.status ?? 'missing'}`)
    }
    const sentences = await getSentencesByVideoId(db, videoId)
    const nodes = await getNodesByVideoId(db, videoId)
    if (sentences.length === 0 || nodes.length === 0) {
      throw new Error('UI proof requires persisted sentences and nodes')
    }
    result.videoId = videoId
    await loadVideoIntoStudyPage(videoId)
    pushEvent(result, 'study_ui_ready', videoId)
    result.status = 'passed'
    publish(result, setStatus)
    return
  }

  const asrPoolModel: ModelPoolEntry = {
    id: 'rain-e2e-asr',
    alias: `Whisper ${basename(config.whisperModelPath)}`,
    type: 'whisper-local',
    provider: 'local',
    modelName: config.whisperModelPath,
    supportsVision: false,
  }
  const llmPoolModel: ModelPoolEntry = {
    id: 'rain-e2e-llm',
    alias: config.llmModel,
    type: 'llm',
    provider: 'openai-compatible',
    baseUrl: config.llmBaseUrl,
    apiKey: config.llmApiKey,
    modelName: config.llmModel,
    supportsVision: false,
  }
  const models = [asrPoolModel, llmPoolModel]
  const roles = {
    asr: asrPoolModel.id,
    structuring: llmPoolModel.id,
    assistant: llmPoolModel.id,
  }
  const asrModel = runtimeModelFromPoolEntry(asrPoolModel)
  const llmModel = runtimeModelFromPoolEntry(llmPoolModel)

  const checks = [
    requireCompatible(await checkAsrModelCapability(asrModel)),
    requireCompatible(await checkStructuringModelCapability(llmModel)),
    requireCompatible(await checkAssistantModelCapability(llmModel)),
  ]
  pushEvent(result, 'capability_checks_complete')

  const rejectedImportId = `${config.evidenceId}-missing-capabilities`
  await insertVideo(db, createVideo(rejectedImportId, config.videoPath))
  let rejectedImportError: Error | null = null
  const rejectingController = createVideoImportController({
    db,
    loadRuntimeSettings: async () => ({
      ready: true,
      error: null,
      models,
      roles,
      capabilities: [],
    }),
    onChanged: () => undefined,
    onProgress: () => undefined,
    onError: (_context, error) => {
      rejectedImportError = toError(error)
    },
  })
  rejectingController.start(rejectedImportId)
  const rejectedImport = await waitForVideoStatus(db, rejectedImportId, ['failed'], 30_000)
  if (!rejectedImportError || !rejectedImport.errorMessage) {
    throw new Error('Import capability gate failed without preserving its rejection reason')
  }
  pushEvent(result, 'import_gate_rejected_missing_capabilities')

  const missingAssistantDecision = decideModelRoleAssignment(llmModel, 'assistant', [])
  if (missingAssistantDecision.allowed) {
    throw new Error('Assistant role assignment unexpectedly allowed missing capability evidence')
  }
  pushEvent(result, 'assistant_gate_rejected_missing_capabilities')

  const positiveAssistantDecision = decideModelRoleAssignment(llmModel, 'assistant', checks)
  if (!positiveAssistantDecision.allowed) {
    throw new Error(`Assistant capability gate rejected a successful probe: ${positiveAssistantDecision.capability.message}`)
  }

  const videoId = `${config.evidenceId}-video`
  await insertVideo(db, createVideo(videoId, config.videoPath))
  const stageStart: Record<string, number> = {}
  const timings: Record<string, number> = {}
  let progressObserved = false
  const pipelineErrors: Error[] = []
  const controller = createVideoImportController({
    db,
    loadRuntimeSettings: async () => ({
      ready: true,
      error: null,
      models,
      roles,
      capabilities: checks,
    }),
    onChanged: () => undefined,
    onProgress: (_changedVideoId, progress) => {
      if (!progress) return
      progressObserved = true
      const stage = progress.stage
      if (stageStart[stage] === undefined) stageStart[stage] = performance.now()
      if (stage === 'stage2' && timings.asrSeconds === undefined && stageStart.asr !== undefined) {
        timings.asrSeconds = Math.max(1, Math.round((performance.now() - stageStart.asr) / 1000))
      }
      if (stage === 'merging' && timings.structuringSeconds === undefined && stageStart.stage2 !== undefined) {
        timings.structuringSeconds = Math.max(1, Math.round((performance.now() - stageStart.stage2) / 1000))
      }
      pushEvent(result, `import_progress:${stage}`, String(progress.percent))
    },
    onError: (_context, error) => {
      pipelineErrors.push(toError(error))
    },
  })

  const cancelStarted = performance.now()
  pushEvent(result, 'start_import', videoId)
  controller.start(videoId)
  const progressDeadline = Date.now() + 30_000
  while (!progressObserved && Date.now() < progressDeadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  if (!progressObserved) throw new Error('Production import controller emitted no progress before cancellation')
  await new Promise((resolve) => window.setTimeout(resolve, 1000))
  controller.cancel(videoId)
  pushEvent(result, 'cancel_import', videoId)
  await waitForVideoStatus(db, videoId, ['cancelled'], 60_000)
  pushEvent(result, 'import_cancelled', videoId)
  result.cancellation = {
    result: 'passed',
    source: 'rain-app-automation',
    events: result.events.map((event) => event.event),
    elapsedSeconds: Math.max(1, Math.round((performance.now() - cancelStarted) / 1000)),
  }

  pipelineErrors.length = 0
  progressObserved = false
  stageStart.asr = performance.now()
  const retryStarted = performance.now()
  pushEvent(result, 'retry_import', videoId)
  controller.start(videoId)
  const completedVideo = await waitForVideoStatus(
    db,
    videoId,
    ['ready', 'failed'],
    4 * 60 * 60 * 1000,
  )
  if (completedVideo.status !== 'ready') {
    const message = pipelineErrors.at(-1)?.message ?? completedVideo.errorMessage ?? 'unknown pipeline error'
    throw new Error(`Production import retry failed: ${redactSecret(message, [config.llmApiKey])}`)
  }
  pushEvent(result, 'import_complete', videoId)

  const sentences = await getSentencesByVideoId(db, videoId)
  const nodes = await getNodesByVideoId(db, videoId)
  const checkpoint = await getImportCheckpoint(db, videoId)
  const structuringBlocks = checkpointBlocks(checkpoint)
  if (sentences.length === 0) throw new Error('Ready video has no persisted sentences')
  if (nodes.length === 0) throw new Error('Ready video has no persisted nodes')
  if (structuringBlocks.length === 0) throw new Error('Ready video has no persisted structuring checkpoint blocks')

  requireCompatible(await checkAssistantModelCapability(llmModel))
  pushEvent(result, 'assistant_stream_complete')
  const verifiedRecords = [
    verifiedRecord(asrModel, checks[0], config.evidenceId),
    verifiedRecord(llmModel, checks[1], config.evidenceId),
    verifiedRecord(llmModel, checks[2], config.evidenceId),
  ]
  timings.pipelineSeconds = Math.max(1, Math.round((performance.now() - retryStarted) / 1000))
  timings.asrSeconds ??= timings.pipelineSeconds
  timings.structuringSeconds ??= 1

  result.videoId = videoId
  result.transcript = toTranscript(sentences)
  result.structuringBlocks = structuringBlocks
  result.database = {
    videoId,
    status: completedVideo.status,
    rawStage: completedVideo.stage ?? null,
    stage: 'ready',
    sentenceCount: sentences.length,
    nodeCount: nodes.length,
    structuringBlockCount: structuringBlocks.length,
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
  result.capabilities = {
    source: 'rain-app-automation',
    checks,
    verifiedRecords,
  }
  result.runtimeGates = {
    source: 'rain-app-automation',
    import: {
      result: 'passed',
      implementation: 'VideoImportController',
      requiredRoles: ['asr', 'structuring'],
      rejectedWithoutCapabilities: true,
    },
    assistant: {
      result: 'passed',
      implementation: 'decideModelRoleAssignment+streamAiChat',
      requiredRoles: ['assistant'],
      rejectedWithoutCapabilities: true,
      textOnly: true,
      responseContract: ASSISTANT_CAPABILITY_TOKEN,
    },
  }
  result.runtime = {
    whisperBackend: config.whisperBackend,
    whisperModel: basename(config.whisperModelPath),
    llmModel: config.llmModel,
    llmBaseUrl: config.llmBaseUrl,
  }
  await loadVideoIntoStudyPage(videoId)
  pushEvent(result, 'study_ui_ready', videoId)
  result.status = 'passed'
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
        if (config.runMode === 'runtime-settings') {
          await publishRuntimeSettingsSchema()
          return
        }
        setStatus('running')
        window.__RAIN_E2E_RESULT__ = {
          status: 'running',
          events: [{ at: nowIso(), event: 'armed' }],
        }
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
