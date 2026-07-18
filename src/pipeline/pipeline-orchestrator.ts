import type { Video, Node, Sentence, Stage2Output } from '@/models/types'
import type { LlmSettings } from '@/llm/types'
import { callStage2 } from '@/llm/client'
import { validateStage2Output } from '@/pipeline/stage2-validate'
import { assertTransition, type ImportStage } from '@/pipeline/import-state'
import {
  isCancellationError,
  runAsrStage,
  type AsrModelConfig,
  type PipelineInvoke,
} from '@/pipeline/asr-runner'
import {
  assignAsrSentencesToNodes,
  getVideoById,
  insertNodes,
  updateVideoImportState,
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
}

const STAGE2_SYSTEM_PROMPT = `You are a video lecture structuring assistant. Given a transcript (list of sentences with timestamps), you must output a JSON object that organizes the content into a hierarchical structure.

Output format (JSON):
{
  "chapters": [
    {
      "title": "Chapter title",
      "start": <start_time_seconds>,
      "end": <end_time_seconds>,
      "sections": [
        {
          "title": "Section title",
          "start": <start_time>,
          "end": <end_time>,
          "paragraphs": [
            {
              "title": "Paragraph title",
              "type": "concept" | "example" | "analogy" | "transition",
              "start": <start_time>,
              "end": <end_time>,
              "translation": "Chinese translation of the paragraph title (if source is non-Chinese)",
              "sentences": [
                {"id": "original_sentence_id", "text": "sentence text", "start": <start>, "end": <end>}
              ]
            }
          ]
        }
      ]
    }
  ]
}

Rules:
- Use the original sentence IDs from the input
- Paragraph types: concept (conceptual description), example (concrete example), analogy (analogy/metaphor), transition (transitional content)
- Time ranges must not overlap within the same level
- Every sentence must be assigned to exactly one paragraph
- Keep original text unchanged
- Default to 3 levels: chapter > section > paragraph`

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

  try {
    callbacks.onProgress('asr', 0)
    const rawSentences = await runAsrStage({
      video,
      asrModel,
      db,
      invoke: dependencies.invoke,
    })
    callbacks.onProgress('asr', 100)

    currentStage = 'stage2'
    callbacks.onProgress('stage2', 0)
    const sentencesText = rawSentences
      .map((sentence) => `[${sentence.id}] (${sentence.startTime.toFixed(1)}s-${sentence.endTime.toFixed(1)}s) ${sentence.text}`)
      .join('\n')
    const stage2Caller = dependencies.callStage2 ?? callStage2
    const result = await stage2Caller(STAGE2_SYSTEM_PROMPT, sentencesText, llmSettings)
    const validationErrors = validateStage2Output(result)
    if (validationErrors.length > 0) {
      throw new Error(`Stage2 validation failed: ${validationErrors.join('; ')}`)
    }
    const stage2Output = result as unknown as Stage2Output
    callbacks.onProgress('stage2', 100)

    assertTransition('stage2', 'merging')
    currentStage = 'merging'
    await updateVideoImportState(db, video.id, 'processing', 'merging')
    callbacks.onProgress('merging', 0)
    const { nodes, sentences } = convertStage2ToEntities(stage2Output, video.id, rawSentences)
    await insertNodes(db, nodes)
    await assignAsrSentencesToNodes(db, video.id, sentences)
    callbacks.onProgress('merging', 100)

    assertTransition('merging', 'ready')
    await updateVideoImportState(db, video.id, 'ready', null)
    const updatedVideo = await getVideoById(db, video.id)
    if (!updatedVideo) throw new Error(`Video not found after pipeline completion: ${video.id}`)
    completed = { video: updatedVideo, nodes, sentences }
  } catch (cause) {
    const error = asError(cause)
    const currentVideo = await getVideoById(db, video.id)
    if (currentVideo?.status === 'processing') {
      const terminal = isCancellationError(error) ? 'cancelled' : 'failed'
      assertTransition(currentStage, terminal)
      await updateVideoImportState(db, video.id, terminal, currentStage, error.message)
    }
    callbacks.onError(error)
    throw error
  }

  callbacks.onComplete(completed.video, completed.nodes, completed.sentences)
}

function nodeId(videoId: string, kind: Node['kind'], index: number): string {
  return `video:${encodeURIComponent(videoId)}:${kind}:${index}`
}
function convertStage2ToEntities(
  output: Stage2Output,
  videoId: string,
  rawSentences: Sentence[],
): { nodes: Node[]; sentences: Sentence[] } {
  const nodes: Node[] = []
  const sentences: Sentence[] = []
  const originalById = new Map(rawSentences.map((sentence) => [sentence.id, sentence]))
  const assignedIds = new Set<string>()
  let sortOrder = 0

  for (const chapter of output.chapters) {
    const chapterId = nodeId(videoId, 'chapter', sortOrder)
    nodes.push({
      id: chapterId,
      videoId,
      parentId: null,
      kind: 'chapter',
      title: chapter.title,
      type: null,
      startTime: chapter.start,
      endTime: chapter.end,
      text: null,
      sortOrder: sortOrder++,
    })

    for (const section of chapter.sections) {
      const sectionId = nodeId(videoId, 'section', sortOrder)
      nodes.push({
        id: sectionId,
        videoId,
        parentId: chapterId,
        kind: 'section',
        title: section.title,
        type: null,
        startTime: section.start,
        endTime: section.end,
        text: null,
        sortOrder: sortOrder++,
      })

      for (const paragraph of section.paragraphs) {
        const paragraphId = nodeId(videoId, 'paragraph', sortOrder)
        nodes.push({
          id: paragraphId,
          videoId,
          parentId: sectionId,
          kind: 'paragraph',
          title: paragraph.title,
          type: paragraph.type,
          startTime: paragraph.start,
          endTime: paragraph.end,
          text: null,
          sortOrder: sortOrder++,
          translation: paragraph.translation,
        })

        for (const sentence of paragraph.sentences) {
          const original = originalById.get(sentence.id)
          if (!original) {
            throw new Error(`Stage2 validation failed: unknown sentence ID "${sentence.id}"`)
          }
          if (assignedIds.has(sentence.id)) {
            throw new Error(`Stage2 validation failed: sentence "${sentence.id}" was assigned more than once`)
          }
          assignedIds.add(sentence.id)
          sentences.push({
            ...original,
            nodeId: paragraphId,
            sortOrder: sentences.length,
          })
        }
      }
    }
  }

  if (assignedIds.size !== rawSentences.length) {
    const missingIds = rawSentences
      .filter((sentence) => !assignedIds.has(sentence.id))
      .map((sentence) => sentence.id)
    throw new Error(`Stage2 validation failed: unassigned sentence IDs: ${missingIds.join(', ')}`)
  }

  return { nodes, sentences }
}
