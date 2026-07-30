import type { Video, Node, Sentence } from '@/models/types'
import type { LlmSettings } from '@/llm/types'
import { callStage2 } from '@/llm/client'
import { assertTransition, type ImportStage } from '@/pipeline/import-state'
import {
  runStage2Stage,
  type Stage2Progress,
} from '@/pipeline/stage2-runner'
import {
  isCancellationError,
  runAsrStage,
  type AsrModelConfig,
  type PipelineInvoke,
} from '@/pipeline/asr-runner'
import {
  getSentencesByVideoId,
  getVideoById,
  mergeImportAtomically,
  saveAsrAtomically,
  transitionVideoImportState,
  type Database,
} from '@/models/database'

export interface PipelineCallbacks {
  onProgress: (stage: string, percent: number, details?: Stage2Progress) => void
  onComplete: (video: Video, nodes: Node[], sentences: Sentence[]) => void
  onError: (error: Error) => void
}

export interface PipelineDependencies {
  invoke?: PipelineInvoke
  callStage2?: typeof callStage2
  saveAsr?: typeof saveAsrAtomically
  transition?: typeof transitionVideoImportState
  merge?: typeof mergeImportAtomically
  signal?: AbortSignal
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

async function resumePersistedImport(
  video: Video,
  db: Database,
  transition: typeof transitionVideoImportState,
): Promise<Video> {
  if (video.status === 'pending' || video.status === 'processing') return video
  if ((video.status !== 'failed' && video.status !== 'cancelled') || !video.stage) {
    throw new Error(`Video "${video.id}" cannot be retried from its persisted state`)
  }
  const resumeStage = video.stage === 'merging' ? 'stage2' : video.stage
  await transition(
    db,
    video.id,
    { status: video.status, stage: video.stage },
    { status: 'processing', stage: resumeStage },
  )
  return { ...video, status: 'processing', stage: resumeStage, errorMessage: undefined }
}

export async function runPipeline(
  video: Video,
  llmSettings: LlmSettings,
  callbacks: PipelineCallbacks,
  db: Database,
  asrModel: AsrModelConfig,
  dependencies: PipelineDependencies = {},
): Promise<void> {
  let currentStage: Extract<ImportStage, 'asr' | 'stage2' | 'merging'> = 'asr'
  let completed: { video: Video; nodes: Node[]; sentences: Sentence[] } | null = null
  const transition = dependencies.transition ?? transitionVideoImportState
  const merge = dependencies.merge ?? mergeImportAtomically

  try {
    const workingVideo = await resumePersistedImport(video, db, transition)
    if (workingVideo.stage === 'download') {
      throw new Error(`Video "${workingVideo.id}" cannot enter Pipeline before local media is attached`)
    }
    currentStage = workingVideo.stage ?? 'asr'
    let rawSentences: Sentence[]
    if (currentStage === 'asr') {
      callbacks.onProgress('asr', 0)
      rawSentences = await runAsrStage({
        video: workingVideo,
        asrModel,
        db,
        invoke: dependencies.invoke,
        saveAsr: dependencies.saveAsr,
        transition,
        signal: dependencies.signal,
      })
      callbacks.onProgress('asr', 100)
      currentStage = 'stage2'
    } else if (currentStage === 'stage2') {
      rawSentences = await getSentencesByVideoId(db, workingVideo.id)
      if (rawSentences.length === 0) {
        throw new Error(`Cannot resume Stage2 for video "${workingVideo.id}" without persisted ASR sentences`)
      }
    } else {
      throw new Error(`Video "${workingVideo.id}" cannot resume from merging without a validated Stage2 result`)
    }

    callbacks.onProgress('stage2', 0)
    const stage2Result = await runStage2Stage({
      video: workingVideo,
      sentences: rawSentences,
      settings: llmSettings,
      db,
      callStage2: dependencies.callStage2,
      signal: dependencies.signal,
      onProgress: (progress) => callbacks.onProgress('stage2', progress.percent, progress),
    })
    callbacks.onProgress('stage2', 100)

    assertTransition('stage2', 'merging')
    await transition(
      db,
      video.id,
      { status: 'processing', stage: 'stage2' },
      { status: 'processing', stage: 'merging' },
    )
    currentStage = 'merging'
    callbacks.onProgress('merging', 0)
    const { nodes, sentences } = stage2Result
    await merge(db, video.id, nodes, sentences)
    callbacks.onProgress('merging', 100)

    assertTransition('merging', 'ready')
    const updatedVideo = await getVideoById(db, video.id)
    if (!updatedVideo) throw new Error(`Video not found after pipeline completion: ${video.id}`)
    completed = { video: updatedVideo, nodes, sentences }
  } catch (cause) {
    const error = asError(cause)
    const terminal = isCancellationError(error) ? 'cancelled' : 'failed'
    try {
      assertTransition(currentStage, terminal)
      await transition(
        db,
        video.id,
        { status: 'processing', stage: currentStage },
        { status: terminal, stage: currentStage, errorMessage: error.message },
      )
    } catch {
      // Persistence failure must not replace the primary pipeline error.
    }
    try {
      callbacks.onError(error)
    } catch {
      // Callback failure must not replace the primary pipeline error.
    }
    throw error
  }

  callbacks.onComplete(completed.video, completed.nodes, completed.sentences)
}
