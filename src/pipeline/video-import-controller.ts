import {
  attachDownloadedMedia,
  getVideoById,
  insertVideo,
  publishDownloadedMedia,
  transitionVideoImportState,
  updateUrlVideoMetadata,
  type Database,
  type VideoImportState,
} from '@/models/database'
import type { Video } from '@/models/types'
import type { ProgressPayload } from '@/architecture/events'
import {
  normalizeWhisperBackendPreference,
  runtimeModelFromPoolEntry,
  type ModelPoolEntry,
  type ModelRole,
} from '@/settings/model-pool'
import {
  decideModelRoleAssignment,
  type ModelCapabilityRecord,
} from '@/settings/model-capabilities'
import { redactSecret } from '@/llm/client'
import { isTauri, tauriInvoke } from '@/lib/tauri-env'
import { runPipeline } from '@/pipeline/pipeline-orchestrator'

export interface ImportProgress {
  stage: 'download' | 'asr' | 'stage2' | 'merging'
  percent: number
  detailStage?: ProgressPayload['stage']
  blockCurrent?: number
  blockTotal?: number
  retrying?: boolean
  backend?: 'cuda' | 'cpu'
  fallbackReason?: string
}

export interface ImportRuntimeSettings {
  ready: boolean
  error: string | null
  models: ModelPoolEntry[]
  roles: Record<ModelRole, string | null>
  /**
   * Optional only while the locked pre-capability Harness contract is migrated.
   * Production callers must include this field, including an empty array.
   */
  capabilities?: ModelCapabilityRecord[]
  whisperBackendPreference?: 'auto' | 'cuda' | 'cpu'
}

export interface VideoImportController {
  importLocal: (filePath: string) => Promise<Video>
  importUrl: (sourceUrl: string) => Promise<Video>
  start: (videoId: string) => void
  cancel: (videoId: string) => void
  cancelAndWait: (videoId: string) => Promise<void>
  acceptProgress: (payload: ProgressPayload) => void
}

interface VideoImportControllerOptions {
  db: Database
  loadRuntimeSettings: () => Promise<ImportRuntimeSettings>
  onChanged: () => void | Promise<void>
  onProgress: (videoId: string, progress: ImportProgress | null) => void
  onError?: (context: 'local-import' | 'url-import' | 'pipeline', error: unknown) => void
  onWarning?: (message: string, error: unknown) => void
  now?: () => number
  createVideoId?: () => string
}

function createUniqueVideoId(): string {
  const randomId = globalThis.crypto?.randomUUID?.()
  return randomId
    ? `v_${randomId}`
    : `v_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

const allocatedLocalVideoIds = new Set<string>()

function normalizeProgressStage(stage: string): ImportProgress['stage'] {
  if (stage === 'download') return 'download'
  if (stage === 'asr' || stage === 'stage2' || stage === 'merging') return stage
  if (stage.startsWith('asr')) return 'asr'
  if (stage.startsWith('merge')) return 'merging'
  return 'stage2'
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function throwIfDownloadCancelled(controller: AbortController): void {
  if (!controller.signal.aborted) return
  const error = new Error('Online video download cancelled')
  error.name = 'AbortError'
  throw error
}

function sourceUrlSecrets(sourceUrl: string): string[] {
  const secrets = new Set<string>([sourceUrl])
  try {
    const parsed = new URL(sourceUrl)
    if (parsed.username) secrets.add(decodeURIComponent(parsed.username))
    if (parsed.password) secrets.add(decodeURIComponent(parsed.password))
    for (const value of parsed.searchParams.values()) {
      if (value) secrets.add(value)
    }
  } catch {
    // URL validation reports the primary error.
  }
  return [...secrets]
}

function assertRoleCapability(
  model: ModelPoolEntry,
  role: 'asr' | 'structuring',
  capabilities: ModelCapabilityRecord[],
  whisperBackendPreference: 'auto' | 'cuda' | 'cpu' = 'auto',
): void {
  const decision = decideModelRoleAssignment(
    runtimeModelFromPoolEntry(model, whisperBackendPreference),
    role,
    capabilities,
  )
  if (decision.allowed) return

  const roleLabel = role === 'asr' ? 'ASR 模型' : '结构化模型'
  const reason = redactSecret(
    decision.capability.message,
    [model.apiKey ?? ''],
  )
  throw new Error(
    `${roleLabel}“${model.alias}”不可用：${reason}`,
  )
}

export function createVideoImportController(
  options: VideoImportControllerOptions,
): VideoImportController {
  const active = new Map<string, AbortController>()
  const activeTasks = new Map<string, Set<Promise<unknown>>>()
  const stopping = new Set<string>()
  const now = options.now ?? Date.now
  const createVideoId = options.createVideoId ?? createUniqueVideoId

  const allocateLocalVideoId = async (timestamp: number): Promise<string> => {
    let candidate = options.createVideoId ? createVideoId() : `v_${timestamp}`
    while (true) {
      if (!allocatedLocalVideoIds.has(candidate) && !(await getVideoById(options.db, candidate))) {
        if (!allocatedLocalVideoIds.has(candidate)) {
          allocatedLocalVideoIds.add(candidate)
          return candidate
        }
      }
      candidate = createVideoId()
    }
  }

  const trackTask = <T>(videoId: string, task: Promise<T>): Promise<T> => {
    const tasks = activeTasks.get(videoId) ?? new Set<Promise<unknown>>()
    tasks.add(task)
    activeTasks.set(videoId, tasks)
    const releaseTask = () => {
      tasks.delete(task)
      if (tasks.size === 0 && activeTasks.get(videoId) === tasks) {
        activeTasks.delete(videoId)
      }
    }
    void task.then(
      releaseTask,
      releaseTask,
    )
    return task
  }

  const processVideo = async (
    videoId: string,
    claimedController?: AbortController,
  ): Promise<void> => {
    const currentController = active.get(videoId)
    if (currentController && currentController !== claimedController) return

    const controller = claimedController ?? new AbortController()
    active.set(videoId, controller)
    let attemptedVideo: Video | null = null

    try {
      const video = await getVideoById(options.db, videoId)
      if (!video) return
      attemptedVideo = video

      if (controller.signal.aborted) {
        const error = new Error('Import cancelled')
        error.name = 'AbortError'
        if (video.status === 'pending' && !video.stage) {
          await transitionVideoImportState(
            options.db,
            video.id,
            { status: 'pending', stage: null },
            { status: 'processing', stage: 'asr' },
          )
        }
        throw error
      }

      const settings = await options.loadRuntimeSettings()
      if (!settings.ready) {
        throw new Error(settings.error ?? 'Runtime settings are unavailable')
      }

      const asrModel = settings.models.find((entry) => entry.id === settings.roles.asr)
      const structuringModel = settings.models.find((entry) => entry.id === settings.roles.structuring)
      if (!asrModel || !structuringModel) {
        throw new Error('Select saved ASR and structuring models before importing')
      }

      if (settings.capabilities) {
        const whisperBackendPreference = normalizeWhisperBackendPreference(
          settings.whisperBackendPreference,
        )
        assertRoleCapability(
          asrModel,
          'asr',
          settings.capabilities,
          whisperBackendPreference,
        )
        assertRoleCapability(
          structuringModel,
          'structuring',
          settings.capabilities,
          whisperBackendPreference,
        )
      }

      options.onProgress(videoId, { stage: video.stage ?? 'asr', percent: 0 })
      await runPipeline(
        video,
        {
          baseUrl: structuringModel.baseUrl ?? '',
          apiKey: structuringModel.apiKey ?? '',
          model: structuringModel.modelName,
        },
        {
          onProgress: (stage, percent, details) => {
            if (stage === 'asr' || stage === 'stage2' || stage === 'merging') {
              options.onProgress(videoId, details
                ? {
                    stage,
                    percent,
                    detailStage: stage,
                    blockCurrent: details.blockCurrent,
                    blockTotal: details.blockTotal,
                    retrying: details.retrying,
                  }
                : { stage, percent })
            }
          },
          onComplete: () => undefined,
          onError: () => undefined,
        },
        options.db,
        {
          type: asrModel.type,
          modelName: asrModel.modelName,
          backendPreference: normalizeWhisperBackendPreference(
            settings.whisperBackendPreference,
          ),
        },
        { signal: controller.signal },
      )
    } catch (cause) {
      const error = asError(cause)
      const cancelled = controller.signal.aborted || error.name === 'AbortError'
      if (attemptedVideo) {
        try {
          const persisted = await getVideoById(options.db, attemptedVideo.id)
          const attemptedWasTerminal = (
            attemptedVideo.status === 'failed'
            || attemptedVideo.status === 'cancelled'
          )
          const persistedChangedToTerminal = persisted && (
            persisted.status === 'failed'
            || persisted.status === 'cancelled'
          ) && (
            !attemptedWasTerminal
            || persisted.status !== attemptedVideo.status
            || (persisted.stage ?? null) !== (attemptedVideo.stage ?? null)
            || persisted.errorMessage !== attemptedVideo.errorMessage
          )
          if (persisted && persisted.status !== 'ready' && !persistedChangedToTerminal) {
            await transitionVideoImportState(
              options.db,
              persisted.id,
              { status: persisted.status, stage: persisted.stage ?? null },
              {
                status: cancelled ? 'cancelled' : 'failed',
                stage: persisted.stage ?? 'asr',
                errorMessage: error.message,
              },
            )
          }
        } catch {
          // Keep the pipeline error as the primary failure.
        }
      }
      options.onError?.('pipeline', error)
    } finally {
      if (active.get(videoId) === controller) active.delete(videoId)
      options.onProgress(videoId, null)
      await options.onChanged()
    }
  }

  const startTrackedProcess = (
    videoId: string,
    claimedController?: AbortController,
  ): Promise<void> => stopping.has(videoId)
    ? Promise.resolve()
    : trackTask(videoId, processVideo(videoId, claimedController))

  const requestCancellation = async (videoId: string): Promise<void> => {
    const controller = active.get(videoId)
    controller?.abort()
    if (isTauri()) await tauriInvoke<void>('cancel_import', { videoId })
    if (controller) return

    const persisted = await getVideoById(options.db, videoId)
    if (persisted?.status !== 'processing') return
    await transitionVideoImportState(
      options.db,
      videoId,
      { status: 'processing', stage: persisted.stage ?? null },
      {
        status: 'cancelled',
        stage: persisted.stage ?? null,
        errorMessage: 'Import cancelled',
      },
    )
    options.onProgress(videoId, null)
    await options.onChanged()
  }

  const closeTrackedDownload = async (
    video: Video,
    downloadController: AbortController,
    cause: unknown,
  ): Promise<Error> => {
    const sourceUrl = video.sourceUrl
    if (!sourceUrl) throw new Error(`URL video "${video.id}" has no source URL`)
    const causeError = asError(cause)
    const cleanupFailed = causeError.message.startsWith('Download cleanup error:')
    const cancelled = !cleanupFailed && (
      downloadController.signal.aborted
      || causeError.message === 'Online video download cancelled'
    )
    const error = new Error(cancelled
      ? 'Online video download cancelled'
      : redactSecret(causeError.message, sourceUrlSecrets(sourceUrl)))
    if (cancelled) error.name = 'AbortError'
    try {
      const persisted = await getVideoById(options.db, video.id)
      const closableState: VideoImportState | null = persisted?.status === 'processing'
        && persisted.stage === 'download'
        ? { status: 'processing', stage: 'download' }
        : persisted?.status === 'pending' && persisted.stage == null
          ? { status: 'pending', stage: null }
          : null
      if (closableState) {
        await transitionVideoImportState(
          options.db,
          video.id,
          closableState,
          {
            status: cancelled ? 'cancelled' : 'failed',
            stage: 'download',
            errorMessage: error.message,
          },
        )
        await options.onChanged()
      }
    } catch {
      // Keep the download error as the primary failure.
    }
    options.onProgress(video.id, null)
    if (!cancelled) options.onError?.('url-import', error)
    return error
  }

  const handoffTrackedVideo = async (
    video: Video,
    downloadController: AbortController,
    prepare: () => Promise<void>,
  ): Promise<Video> => {
    if (!video.filePath) throw new Error(`URL video "${video.id}" has no attached media`)

    active.set(video.id, downloadController)
    let pipelineOwnsController = false
    try {
      await prepare()
      throwIfDownloadCancelled(downloadController)
      const published = await publishDownloadedMedia(options.db, video.id, video.filePath)
      throwIfDownloadCancelled(downloadController)
      pipelineOwnsController = true
      void startTrackedProcess(video.id, downloadController)
      return published
    } catch (cause) {
      throw await closeTrackedDownload(video, downloadController, cause)
    } finally {
      if (!pipelineOwnsController && active.get(video.id) === downloadController) {
        active.delete(video.id)
      }
    }
  }

  const downloadTrackedVideo = async (
    video: Video,
    downloadController: AbortController,
    prepare: () => Promise<void>,
  ): Promise<Video> => {
    const sourceUrl = video.sourceUrl
    if (!sourceUrl) throw new Error(`URL video "${video.id}" has no source URL`)

    active.set(video.id, downloadController)
    let pipelineOwnsController = false
    try {
      await prepare()
      throwIfDownloadCancelled(downloadController)
      const result = await tauriInvoke<{
        title: string
        duration: number
        thumbnail: string
        filePath: string
      }>(
        'import_online_video',
        { videoId: video.id, sourceUrl },
      )
      throwIfDownloadCancelled(downloadController)
      await updateUrlVideoMetadata(options.db, video.id, {
        title: result.title,
        duration: result.duration,
        thumbnail: result.thumbnail,
      })
      throwIfDownloadCancelled(downloadController)
      await attachDownloadedMedia(options.db, video.id, result.filePath)
      throwIfDownloadCancelled(downloadController)
      await options.onChanged()
      throwIfDownloadCancelled(downloadController)
      const published = await publishDownloadedMedia(options.db, video.id, result.filePath)
      throwIfDownloadCancelled(downloadController)

      // The same AbortController owns the task while the DB atomically publishes
      // pending and while Pipeline starts, leaving no ownerless cancellation gap.
      pipelineOwnsController = true
      void startTrackedProcess(video.id, downloadController)
      return published
    } catch (cause) {
      throw await closeTrackedDownload(video, downloadController, cause)
    } finally {
      if (!pipelineOwnsController && active.get(video.id) === downloadController) {
        active.delete(video.id)
      }
    }
  }

  const startVideo = async (videoId: string): Promise<void> => {
    if (stopping.has(videoId)) return
    const video = await getVideoById(options.db, videoId)
    if (stopping.has(videoId)) return
    if (active.has(videoId)) return
    if (
      video?.source === 'url'
      && video.stage === 'download'
      && (video.status === 'failed' || video.status === 'cancelled')
    ) {
      const downloadController = new AbortController()
      const processingVideo: Video = {
        ...video,
        status: 'processing',
        errorMessage: undefined,
      }
      const prepareRetry = async () => {
        await transitionVideoImportState(
          options.db,
          video.id,
          { status: video.status, stage: 'download' },
          { status: 'processing', stage: 'download' },
        )
        await options.onChanged()
      }
      if (video.filePath) {
        await handoffTrackedVideo(processingVideo, downloadController, prepareRetry)
        return
      }
      await downloadTrackedVideo(processingVideo, downloadController, prepareRetry)
      return
    }
    await startTrackedProcess(videoId)
  }

  return {
    async importLocal(filePath) {
      try {
        const timestamp = now()
        const videoId = await allocateLocalVideoId(timestamp)
        const info = await tauriInvoke<{ title: string; duration: number; thumbnail: string }>(
          'probe_video_info',
          { filePath, sourceUrl: null },
        )

        let thumbnailPath = ''
        try {
          thumbnailPath = await tauriInvoke<string>(
            'generate_thumbnail',
            { filePath, videoId, timestamp: 1.0 },
          )
        } catch (error) {
          options.onWarning?.('缩略图生成失败，继续导入', error)
        }

        const video: Video = {
          id: videoId,
          title: info.title,
          source: 'local',
          filePath,
          thumbnail: thumbnailPath || info.thumbnail,
          duration: info.duration,
          language: '',
          status: 'pending',
          createdAt: timestamp,
          position: 0,
          lastStudiedAt: timestamp,
        }

        await insertVideo(options.db, video)
        await options.onChanged()
        void startTrackedProcess(video.id)
        return video
      } catch (error) {
        options.onError?.('local-import', error)
        throw error
      }
    },

    async importUrl(sourceUrl) {
      const normalizedUrl = sourceUrl.trim()
      let parsedUrl: URL
      try {
        parsedUrl = new URL(normalizedUrl)
      } catch {
        throw new Error('Enter an absolute HTTP(S) video URL')
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Enter an absolute HTTP(S) video URL')
      }

      const timestamp = now()
      const video: Video = {
        id: createVideoId(),
        title: parsedUrl.hostname,
        source: 'url',
        sourceUrl: normalizedUrl,
        thumbnail: '',
        duration: 0,
        language: '',
        status: 'processing',
        stage: 'download',
        createdAt: timestamp,
        position: 0,
        lastStudiedAt: timestamp,
      }
      const downloadController = new AbortController()
      return trackTask(video.id, downloadTrackedVideo(video, downloadController, async () => {
        await insertVideo(options.db, video)
        await options.onChanged()
      }))
    },

    start(videoId) {
      if (stopping.has(videoId)) return
      void trackTask(videoId, startVideo(videoId)).catch(() => undefined)
    },

    cancel(videoId) {
      void requestCancellation(videoId).catch(() => undefined)
    },

    async cancelAndWait(videoId) {
      stopping.add(videoId)
      try {
        await requestCancellation(videoId)
        while (true) {
          const tasks = activeTasks.get(videoId)
          if (!tasks || tasks.size === 0) break
          await Promise.allSettled([...tasks])
        }
      } finally {
        stopping.delete(videoId)
      }
    },

    acceptProgress(payload) {
      if (!active.has(payload.videoId)) return
      options.onProgress(payload.videoId, {
        stage: normalizeProgressStage(payload.stage),
        percent: payload.percent,
        detailStage: payload.stage,
        blockCurrent: payload.blockCurrent,
        blockTotal: payload.blockTotal,
        retrying: payload.retrying,
        backend: payload.backend,
        fallbackReason: payload.fallbackReason,
      })
    },
  }
}
