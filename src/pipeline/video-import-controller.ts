import {
  getVideoById,
  insertVideo,
  transitionVideoImportState,
  type Database,
} from '@/models/database'
import type { Video } from '@/models/types'
import type { ProgressPayload } from '@/architecture/events'
import {
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
  stage: 'asr' | 'stage2' | 'merging'
  percent: number
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
}

export interface VideoImportController {
  importLocal: (filePath: string) => Promise<Video>
  start: (videoId: string) => void
  cancel: (videoId: string) => void
  acceptProgress: (payload: ProgressPayload) => void
}

interface VideoImportControllerOptions {
  db: Database
  loadRuntimeSettings: () => Promise<ImportRuntimeSettings>
  onChanged: () => void | Promise<void>
  onProgress: (videoId: string, progress: ImportProgress | null) => void
  onError?: (context: 'local-import' | 'pipeline', error: unknown) => void
  onWarning?: (message: string, error: unknown) => void
  now?: () => number
}

function normalizeProgressStage(stage: string): ImportProgress['stage'] {
  if (stage === 'asr' || stage === 'stage2' || stage === 'merging') return stage
  if (stage.startsWith('asr')) return 'asr'
  if (stage.startsWith('merge')) return 'merging'
  return 'stage2'
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function assertRoleCapability(
  model: ModelPoolEntry,
  role: 'asr' | 'structuring',
  capabilities: ModelCapabilityRecord[],
): void {
  const decision = decideModelRoleAssignment(
    runtimeModelFromPoolEntry(model),
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
  const now = options.now ?? Date.now

  const processVideo = async (videoId: string): Promise<void> => {
    if (active.has(videoId)) return

    const controller = new AbortController()
    active.set(videoId, controller)
    let attemptedVideo: Video | null = null

    try {
      const video = await getVideoById(options.db, videoId)
      if (!video) return
      attemptedVideo = video

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
        assertRoleCapability(asrModel, 'asr', settings.capabilities)
        assertRoleCapability(structuringModel, 'structuring', settings.capabilities)
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
          onProgress: (stage, percent) => {
            if (stage === 'asr' || stage === 'stage2' || stage === 'merging') {
              options.onProgress(videoId, { stage, percent })
            }
          },
          onComplete: () => undefined,
          onError: () => undefined,
        },
        options.db,
        { type: asrModel.type, modelName: asrModel.modelName },
        { signal: controller.signal },
      )
    } catch (cause) {
      const error = asError(cause)
      if (attemptedVideo) {
        try {
          const persisted = await getVideoById(options.db, attemptedVideo.id)
          if (
            persisted
            && persisted.status !== 'ready'
            && persisted.status !== 'failed'
            && persisted.status !== 'cancelled'
          ) {
            await transitionVideoImportState(
              options.db,
              persisted.id,
              { status: persisted.status, stage: persisted.stage ?? null },
              {
                status: 'failed',
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
      active.delete(videoId)
      options.onProgress(videoId, null)
      await options.onChanged()
    }
  }

  return {
    async importLocal(filePath) {
      try {
        const info = await tauriInvoke<{ title: string; duration: number; thumbnail: string }>(
          'probe_video_info',
          { filePath, sourceUrl: null },
        )

        let thumbnailPath = ''
        try {
          const outputPath = filePath.replace(/\.[^.]+$/, '_thumb.jpg')
          thumbnailPath = await tauriInvoke<string>(
            'generate_thumbnail',
            { filePath, outputPath, timestamp: 1.0 },
          )
        } catch (error) {
          options.onWarning?.('缩略图生成失败，继续导入', error)
        }

        const timestamp = now()
        const video: Video = {
          id: `v_${timestamp}`,
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
        void processVideo(video.id)
        return video
      } catch (error) {
        options.onError?.('local-import', error)
        throw error
      }
    },

    start(videoId) {
      void processVideo(videoId)
    },

    cancel(videoId) {
      const controller = active.get(videoId)
      if (!controller) return
      controller.abort()
      if (isTauri()) {
        void tauriInvoke<void>('cancel_import', { videoId }).catch(() => undefined)
      }
    },

    acceptProgress(payload) {
      if (!active.has(payload.videoId)) return
      options.onProgress(payload.videoId, {
        stage: normalizeProgressStage(payload.stage),
        percent: payload.percent,
      })
    },
  }
}
