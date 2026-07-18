import type { Video, Node, Sentence } from '@/models/types'
import type { LlmSettings } from '@/llm/types'
import { callStage2 } from '@/llm/client'
import { assertTransition, type ImportStage } from '@/pipeline/import-state'
import { runStage2Stage } from '@/pipeline/stage2-runner'
import {
  isCancellationError,
  runAsrStage,
  type AsrModelConfig,
  type PipelineInvoke,
} from '@/pipeline/asr-runner'
import {
  getVideoById,
  mergeImportAtomically,
  saveAsrAtomically,
  transitionVideoImportState,
  type Database,
} from '@/models/database'

export interface PipelineCallbacks {
  onProgress: (stage: string, percent: number) => void
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
    callbacks.onProgress('asr', 0)
    const rawSentences = await runAsrStage({
      video,
      asrModel,
      db,
      invoke: dependencies.invoke,
      saveAsr: dependencies.saveAsr,
      transition,
    })
    callbacks.onProgress('asr', 100)

    currentStage = 'stage2'
    callbacks.onProgress('stage2', 0)
    const stage2Result = await runStage2Stage({
      video,
      sentences: rawSentences,
      settings: llmSettings,
      db,
      callStage2: dependencies.callStage2,
      signal: dependencies.signal,
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
