// src/pipeline/pipeline-orchestrator.ts
import type { Video, Node, Sentence, Stage2Output } from '@/models/types'
import type { LlmSettings } from '@/llm/types'
import { callStage2 } from '@/llm/client'
import { normalizeWhisperToSentences } from '@/pipeline/asr-normalize'
import { validateStage2Output } from '@/pipeline/stage2-validate'
import { shouldChunk, chunkSentences, buildChunkContext } from '@/pipeline/long-video'
import { isTauri, tauriInvoke } from '@/lib/tauri-env'
import {
  createDatabase,
  insertNodes,
  insertSentences,
  updateVideoStatus,
  getVideoById,
  type Database,
} from '@/models/database'

export interface PipelineCallbacks {
  onProgress: (stage: string, percent: number) => void
  onComplete: (video: Video, nodes: Node[], sentences: Sentence[]) => void
  onError: (error: Error) => void
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

export async function runPipeline(
  video: Video,
  llmSettings: LlmSettings,
  callbacks: PipelineCallbacks,
  db: Database,
): Promise<void> {
  try {
    callbacks.onProgress('asr', 0)

    // Step 1: ASR
    let rawSentences: Sentence[] = []

    if (isTauri() && video.filePath) {
      callbacks.onProgress('asr', 10)
      await updateVideoStatus(db, video.id, 'processing')

      try {
        const asrResult = await tauriInvoke<Array<{ id: string; text: string; start_time: number; end_time: number }>>(
          'start_asr',
          { videoId: video.id, filePath: video.filePath, tier: 'whisper', modelPath: null },
        )

        rawSentences = asrResult.map((s, i) => ({
          id: s.id,
          nodeId: '',
          text: s.text,
          startTime: s.start_time,
          endTime: s.end_time,
          sortOrder: i,
        }))
      } catch {
        // Whisper not available — use mock sentences for demo
        rawSentences = generateDemoSentences(video.duration)
      }
    } else {
      // Non-Tauri or no file path — generate demo sentences
      rawSentences = generateDemoSentences(video.duration)
    }

    callbacks.onProgress('asr', 100)

    // Step 2: Stage2 structuring via LLM
    callbacks.onProgress('stage2', 0)

    const sentencesText = rawSentences
      .map((s) => `[${s.id}] (${s.startTime.toFixed(1)}s-${s.endTime.toFixed(1)}s) ${s.text}`)
      .join('\n')

    let stage2Output: Stage2Output

    try {
      const result = await callStage2(STAGE2_SYSTEM_PROMPT, sentencesText, llmSettings)
      const errors = validateStage2Output(result)
      if (errors.length > 0) {
        console.warn('[Pipeline] Stage2 validation warnings:', errors)
      }
      stage2Output = result as unknown as Stage2Output
    } catch {
      // LLM not available — create a default structure
      stage2Output = buildDefaultStructure(rawSentences, video.duration)
    }

    callbacks.onProgress('stage2', 100)

    // Step 3: Convert Stage2Output to Node[] + Sentence[]
    const { nodes, sentences } = convertStage2ToEntities(stage2Output, video.id, rawSentences)

    // Step 4: Persist to database
    await insertNodes(db, nodes)
    await insertSentences(db, sentences)
    await updateVideoStatus(db, video.id, 'ready')

    const updatedVideo = await getVideoById(db, video.id)
    callbacks.onComplete(updatedVideo ?? { ...video, status: 'ready' }, nodes, sentences)
  } catch (err) {
    await updateVideoStatus(db, video.id, 'failed').catch(() => {})
    callbacks.onError(err instanceof Error ? err : new Error(String(err)))
  }
}

function generateDemoSentences(duration: number): Sentence[] {
  const count = Math.max(3, Math.floor(duration / 10))
  const segmentDuration = duration / count
  return Array.from({ length: count }, (_, i) => ({
    id: `demo_s_${i}`,
    nodeId: '',
    text: `This is sentence ${i + 1} of the video transcript.`,
    startTime: i * segmentDuration,
    endTime: (i + 1) * segmentDuration,
    sortOrder: i,
  }))
}

function buildDefaultStructure(sentences: Sentence[], duration: number): Stage2Output {
  return {
    chapters: [
      {
        title: 'Chapter 1',
        start: 0,
        end: duration,
        sections: [
          {
            title: 'Section 1',
            start: 0,
            end: duration,
            paragraphs: [
              {
                title: 'Content',
                type: 'concept',
                start: 0,
                end: duration,
                sentences: sentences.map((s) => ({
                  id: s.id,
                  text: s.text,
                  start: s.startTime,
                  end: s.endTime,
                })),
              },
            ],
          },
        ],
      },
    ],
  }
}

function convertStage2ToEntities(
  output: Stage2Output,
  videoId: string,
  rawSentences: Sentence[],
): { nodes: Node[]; sentences: Sentence[] } {
  const nodes: Node[] = []
  const sentences: Sentence[] = []
  let sortOrder = 0

  for (const chapter of output.chapters) {
    const chapterId = `ch_${sortOrder}`
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
      const sectionId = `sec_${sortOrder}`
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
        const paragraphId = `para_${sortOrder}`
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

        for (const s of paragraph.sentences) {
          const original = rawSentences.find((rs) => rs.id === s.id)
          sentences.push({
            id: s.id,
            nodeId: paragraphId,
            text: s.text,
            startTime: s.start,
            endTime: s.end,
            sortOrder: sentences.length,
          })
        }
      }
    }
  }

  return { nodes, sentences }
}
