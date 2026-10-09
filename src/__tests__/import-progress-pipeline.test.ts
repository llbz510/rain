import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, getVideoById, insertVideo } from '@/models/database'
import { runPipeline } from '@/pipeline/pipeline-orchestrator'
import { isImportProgress, type ImportProgress } from '@/pipeline/import-progress'
import type { Video } from '@/models/types'

afterEach(() => vi.restoreAllMocks())

describe('AC-AR-06 actual Pipeline producer', () => {
  it('emits valid ASR, block/retry, merge and persisted ready domain payloads', async () => {
    const db = await createDatabase()
    const video: Video = { id: 'pipeline-task', title: 'Pipeline', source: 'local', filePath: 'D:\\course.mp4', thumbnail: '', duration: 2, language: '', status: 'pending', createdAt: 1, position: 0, lastStudiedAt: 1 }
    await insertVideo(db, video)
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['D:\\models\\ggml-large-v3.bin']
      if (command === 'start_asr') return [{ id: 's1', text: 'Original sentence.', start_time: 0, end_time: 1 }]
      throw new Error(`Unexpected command: ${command}`)
    })
    const model = vi.fn().mockResolvedValueOnce({}).mockImplementation(async (_prompt, rawInput: string) => {
      const input = JSON.parse(rawInput)
      return {
        blockId: input.blockId,
        nodes: [
          { id: 'ch', parentId: null, kind: 'chapter', title: 'Chapter', startSentenceId: 's1', endSentenceId: 's1' },
          { id: 'sec', parentId: 'ch', kind: 'section', title: 'Section', startSentenceId: 's1', endSentenceId: 's1' },
          { id: 'p', parentId: 'sec', kind: 'paragraph', title: 'Paragraph', type: 'concept', startSentenceId: 's1', endSentenceId: 's1' },
        ], coveredSentenceIds: ['s1'],
      }
    })
    const progress: ImportProgress[] = []
    await runPipeline(video, { baseUrl: 'https://example.test/v1', apiKey: 'fixture', model: 'fixture' }, {
      onProgress: () => undefined,
      onImportProgress: (next: ImportProgress) => progress.push(next),
      onComplete: () => undefined, onError: () => undefined,
    }, db, { type: 'whisper-local', modelName: 'large-v3' }, { invoke, callStage2: model })
    expect(progress).toEqual([
      { videoId: 'pipeline-task', stage: 'asr', substage: 'extraction', percent: 0 },
      { videoId: 'pipeline-task', stage: 'asr', substage: 'finalization', percent: 100 },
      { videoId: 'pipeline-task', stage: 'stage2', percent: 0, blockCurrent: 1, blockTotal: 1, retrying: false },
      { videoId: 'pipeline-task', stage: 'stage2', percent: 0, blockCurrent: 1, blockTotal: 1, retrying: true },
      { videoId: 'pipeline-task', stage: 'stage2', percent: 0, blockCurrent: 1, blockTotal: 1, retrying: false },
      { videoId: 'pipeline-task', stage: 'stage2', percent: 100, blockCurrent: 1, blockTotal: 1, retrying: false },
      { videoId: 'pipeline-task', stage: 'merging', percent: 0 },
      { videoId: 'pipeline-task', stage: 'merging', percent: 100 },
      { videoId: 'pipeline-task', stage: 'terminal', status: 'ready' },
    ])
    expect(progress.every(isImportProgress)).toBe(true)
    expect(await getVideoById(db, video.id)).toMatchObject({ status: 'ready' })
  })
})
