import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import {
  getSentencesByVideoId,
  getVideoById,
  insertVideo,
  saveAsrAtomically,
} from '@/models/database'
import type { Node, Video } from '@/models/types'
import { assertTransition } from '@/pipeline/import-state'
import { runAsrStage } from '@/pipeline/asr-runner'
import { runPipeline } from '@/pipeline/pipeline-orchestrator'
import { buildStage2Blocks } from '@/pipeline/stage2-runner'

const video: Video = {
  id: 'video-asr',
  title: 'Local video',
  source: 'local',
  filePath: 'C:\\videos\\lecture.mp4',
  thumbnail: '',
  duration: 12,
  language: '',
  status: 'pending',
  createdAt: 1,
  position: 0,
  lastStudiedAt: 1,
}

const asrModel = {
  type: 'whisper-local' as const,
  modelName: 'large-v3',
}

const llmSettings = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'test-key',
  model: 'qwen3.5-omni-flash',
}

const asrPayload = [
  { id: 'real_s_1', text: 'First sentence.', start_time: 0, end_time: 1.5 },
  { id: 'real_s_2', text: 'Second sentence.', start_time: 1.5, end_time: 3 },
]

function validStage2For(videoId: string, payload: typeof asrPayload) {
  const normalized = payload.map((sentence, sortOrder) => ({
    id: sentence.id,
    nodeId: videoId,
    text: sentence.text,
    startTime: sentence.start_time,
    endTime: sentence.end_time,
    sortOrder,
  }))
  const block = buildStage2Blocks(videoId, normalized)[0]
  const chapterId = `${block.blockId}:node:chapter`
  const sectionId = `${block.blockId}:node:section`
  return {
    blockId: block.blockId,
    nodes: [
      { id: chapterId, parentId: null, kind: 'chapter' as const, title: 'Chapter', startSentenceId: normalized[0].id, endSentenceId: normalized.at(-1)!.id },
      { id: sectionId, parentId: chapterId, kind: 'section' as const, title: 'Section', startSentenceId: normalized[0].id, endSentenceId: normalized.at(-1)!.id },
      { id: `${block.blockId}:node:paragraph`, parentId: sectionId, kind: 'paragraph' as const, title: 'Paragraph', type: 'concept' as const, startSentenceId: normalized[0].id, endSentenceId: normalized.at(-1)!.id },
    ],
    coveredSentenceIds: normalized.map((sentence) => sentence.id),
  }
}

const validStage2 = validStage2For(video.id, asrPayload)
function callbacks() {
  return {
    onProgress: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
  }
}

function successfulInvoke() {
  return vi.fn(async (command: string) => {
    if (command === 'list_whisper_models') return ['C:\\models\\ggml-large-v3.bin']
    if (command === 'start_asr') return asrPayload
    throw new Error(`Unexpected command: ${command}`)
  })
}

describe('strict import transitions', () => {
  it('allows only the ordered success path and active-stage terminal exits', () => {
    expect(() => assertTransition('pending', 'asr')).not.toThrow()
    expect(() => assertTransition('asr', 'stage2')).not.toThrow()
    expect(() => assertTransition('stage2', 'merging')).not.toThrow()
    expect(() => assertTransition('merging', 'ready')).not.toThrow()

    for (const stage of ['asr', 'stage2', 'merging'] as const) {
      expect(() => assertTransition(stage, 'failed')).not.toThrow()
      expect(() => assertTransition(stage, 'cancelled')).not.toThrow()
    }
  })

  it.each([
    ['pending', 'ready'],
    ['pending', 'failed'],
    ['asr', 'ready'],
    ['stage2', 'asr'],
    ['merging', 'stage2'],
    ['ready', 'failed'],
    ['failed', 'asr'],
    ['cancelled', 'asr'],
  ] as const)('rejects invalid transition %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(`Invalid import transition: ${from} -> ${to}`)
  })
})

describe('fail-closed ASR pipeline', () => {
  beforeEach(async () => {
    resetDb()
    await insertVideo(await getDb(), video)
  })

  afterEach(() => {
    resetDb()
    vi.restoreAllMocks()
  })
  it('rejects a stale direct MemoryDatabase ASR commit and preserves ready state', async () => {
    resetDb()
    const db = await getDb()
    await insertVideo(db, { ...video, language: 'en', status: 'ready', stage: undefined })

    await expect(saveAsrAtomically(video.id, 'zh', [{
      id: 'stale-memory-sentence',
      nodeId: '',
      text: 'Must not be committed.',
      startTime: 0,
      endTime: 1,
      sortOrder: 0,
    }], db)).rejects.toThrow('Persisted import state changed')

    expect(await getSentencesByVideoId(db, video.id)).toEqual([])
    expect(await getVideoById(db, video.id)).toMatchObject({
      language: 'en',
      status: 'ready',
      stage: undefined,
    })
  })

  it('rejects a stale pending snapshot after the persisted row became ready', async () => {
    const db = await getDb()
    const persistedReady = { ...video, id: 'stale-ready', status: 'ready' as const }
    const stalePending = { ...persistedReady, status: 'pending' as const }
    await insertVideo(db, persistedReady)
    const invoke = successfulInvoke()

    await expect(runAsrStage({ video: stalePending, asrModel, db, invoke })).rejects.toThrow(
      'Persisted import state changed',
    )
    expect(invoke).not.toHaveBeenCalled()
    expect(await getVideoById(db, persistedReady.id)).toMatchObject({ status: 'ready' })
  })
  it('refuses to re-enter ASR from a terminal video state', async () => {
    const db = await getDb()
    const terminalVideo = { ...video, id: 'ready-video', status: 'ready' as const }
    await insertVideo(db, terminalVideo)
    const invoke = successfulInvoke()

    await expect(runAsrStage({ video: terminalVideo, asrModel, db, invoke })).rejects.toThrow(
      'Invalid import transition: ready -> asr',
    )
    expect(invoke).not.toHaveBeenCalled()
  })
  it('resolves the saved model to an installed path and atomically saves validated ASR', async () => {
    const db = await getDb()
    const invoke = successfulInvoke()

    const sentences = await runAsrStage({ video, asrModel, db, invoke })

    expect(invoke).toHaveBeenNthCalledWith(1, 'list_whisper_models')
    expect(invoke).toHaveBeenNthCalledWith(2, 'start_asr', {
      videoId: video.id,
      filePath: video.filePath,
      tier: 'whisper',
      modelPath: 'C:\\models\\ggml-large-v3.bin',
      language: 'zh',
    })
    expect(sentences).toEqual([
      { id: 'real_s_1', nodeId: '', text: 'First sentence.', startTime: 0, endTime: 1.5, sortOrder: 0 },
      { id: 'real_s_2', nodeId: '', text: 'Second sentence.', startTime: 1.5, endTime: 3, sortOrder: 1 },
    ])
    expect(await getSentencesByVideoId(db, video.id)).toHaveLength(2)
    expect(await getVideoById(db, video.id)).toMatchObject({ status: 'processing', stage: 'stage2' })
  })

  it('accepts an explicit ggml Whisper model path for real E2E runs', async () => {
    const db = await getDb()
    const explicitModelPath = 'D:\\models\\ggml-large-v3.bin'
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return []
      if (command === 'start_asr') return asrPayload
      throw new Error(`Unexpected command: ${command}`)
    })

    await runAsrStage({
      video,
      asrModel: { type: 'whisper-local', modelName: explicitModelPath },
      db,
      invoke,
    })

    expect(invoke).toHaveBeenNthCalledWith(2, 'start_asr', {
      videoId: video.id,
      filePath: video.filePath,
      tier: 'whisper',
      modelPath: explicitModelPath,
      language: 'zh',
    })
  })
  it('fails an import when Whisper rejects its model path', async () => {
    const db = await getDb()
    const invokeMock = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['C:\\models\\ggml-large-v3.bin']
      throw new Error('model_path is required for Whisper ASR')
    })
    const handlers = callbacks()

    await expect(runPipeline(video, llmSettings, handlers, db, asrModel, {
      invoke: invokeMock,
      callStage2: vi.fn(),
    })).rejects.toThrow('model_path is required for Whisper ASR')

    expect(await getVideoById(db, video.id)).toMatchObject({
      status: 'failed',
      stage: 'asr',
      errorMessage: 'model_path is required for Whisper ASR',
    })
    expect(await getSentencesByVideoId(db, video.id)).toEqual([])
    expect(handlers.onError).toHaveBeenCalledTimes(1)
  })

  it('never saves demo sentence IDs', async () => {
    const db = await getDb()
    const invokeMock = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['C:\\models\\ggml-large-v3.bin']
      throw new Error('Whisper unavailable')
    })

    await expect(runPipeline(video, llmSettings, callbacks(), db, asrModel, {
      invoke: invokeMock,
      callStage2: vi.fn(),
    })).rejects.toThrow()

    expect(await getSentencesByVideoId(db, video.id)).not.toContainEqual(
      expect.objectContaining({ id: expect.stringMatching(/^demo_s_/) }),
    )
  })

  it('fails closed without a real local file path', async () => {
    const db = await getDb()
    const noPath = { ...video, filePath: undefined }
    const invoke = vi.fn()

    await expect(runAsrStage({ video: noPath, asrModel, db, invoke })).rejects.toThrow(
      'requires a real local file path',
    )
    expect(invoke).not.toHaveBeenCalled()
    expect(await getVideoById(db, video.id)).toMatchObject({ status: 'failed', stage: 'asr' })
  })

  it('rejects unsupported ASR model types instead of falling back', async () => {
    const db = await getDb()

    await expect(runAsrStage({
      video,
      asrModel: { type: 'subtitle', modelName: 'subtitle' },
      db,
      invoke: vi.fn(),
    })).rejects.toThrow('Only a saved whisper-local ASR model is supported')
  })

  it('fails actionably when the exact saved model is not installed', async () => {
    const db = await getDb()
    const invoke = vi.fn().mockResolvedValue(['C:\\models\\ggml-medium.bin'])

    await expect(runAsrStage({ video, asrModel, db, invoke })).rejects.toThrow(
      'Whisper model "large-v3" is not installed',
    )
    expect(await getVideoById(db, video.id)).toMatchObject({ status: 'failed', stage: 'asr' })
  })

  it('classifies Rust cancellation separately from failure', async () => {
    const db = await getDb()
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['ggml-large-v3.bin']
      throw new Error('ASR cancelled')
    })
    const handlers = callbacks()

    await expect(runPipeline(video, llmSettings, handlers, db, asrModel, {
      invoke,
      callStage2: vi.fn(),
    })).rejects.toThrow('ASR cancelled')

    expect(await getVideoById(db, video.id)).toMatchObject({
      status: 'cancelled',
      stage: 'asr',
      errorMessage: 'ASR cancelled',
    })
    expect(handlers.onError).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an empty result', []],
    ['an empty ID', [{ id: ' ', text: 'Text', start_time: 0, end_time: 1 }]],
    ['duplicate IDs', [
      { id: 'same', text: 'One', start_time: 0, end_time: 1 },
      { id: 'same', text: 'Two', start_time: 1, end_time: 2 },
    ]],
    ['blank text', [{ id: 's1', text: ' ', start_time: 0, end_time: 1 }]],
    ['mojibake text', [{ id: 's1', text: '\u951f\u65a4\u62f7 text', start_time: 0, end_time: 1 }]],
    ['non-finite timestamps', [{ id: 's1', text: 'Text', start_time: 0, end_time: Number.POSITIVE_INFINITY }]],
    ['a negative start', [{ id: 's1', text: 'Text', start_time: -1, end_time: 1 }]],
    ['an empty range', [{ id: 's1', text: 'Text', start_time: 1, end_time: 1 }]],
    ['overlapping ranges', [
      { id: 's1', text: 'One', start_time: 0, end_time: 2 },
      { id: 's2', text: 'Two', start_time: 1, end_time: 3 },
    ]],
  ])('rejects invalid Whisper payloads: %s', async (_label, payload) => {
    const db = await getDb()
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['ggml-large-v3.bin']
      return payload
    })

    await expect(runAsrStage({ video, asrModel, db, invoke })).rejects.toThrow('Invalid Whisper ASR result')
    expect(await getSentencesByVideoId(db, video.id)).toEqual([])
    expect(await getVideoById(db, video.id)).toMatchObject({ status: 'failed', stage: 'asr' })
  })

  it('does not continue to Stage2 after ASR failure', async () => {
    const db = await getDb()
    const stage2 = vi.fn()
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['ggml-large-v3.bin']
      throw new Error('ASR failed')
    })

    await expect(runPipeline(video, llmSettings, callbacks(), db, asrModel, {
      invoke,
      callStage2: stage2,
    })).rejects.toThrow('ASR failed')
    expect(stage2).not.toHaveBeenCalled()
  })

  it('preserves an ASR persistence error when terminal-state persistence also fails', async () => {
    const db = await getDb()
    const original = new Error('ASR commit failed')
    const transition = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('state database unavailable'))
    const handlers = callbacks()

    await expect(runPipeline(video, llmSettings, handlers, db, asrModel, {
      invoke: successfulInvoke(),
      callStage2: vi.fn(),
      saveAsr: vi.fn().mockRejectedValue(original),
      transition,
    })).rejects.toBe(original)
    expect(handlers.onError).toHaveBeenCalledTimes(1)
    expect(handlers.onError).toHaveBeenCalledWith(original)
    expect(transition).toHaveBeenCalled()
  })

  it('preserves a Stage2 error when failure-state persistence rejects', async () => {
    const db = await getDb()
    const original = new Error('Stage2 original failure')
    const transition = vi.fn()
      .mockImplementationOnce(async (...args: unknown[]) => {
        const { transitionVideoImportState } = await import('@/models/database')
        return transitionVideoImportState(...args as Parameters<typeof transitionVideoImportState>)
      })
      .mockRejectedValue(new Error('cannot persist failed state'))
    const handlers = callbacks()

    await expect(runPipeline(video, llmSettings, handlers, db, asrModel, {
      invoke: successfulInvoke(),
      callStage2: vi.fn().mockRejectedValue(original),
      transition,
    })).rejects.toBe(original)
    expect(handlers.onError).toHaveBeenCalledTimes(1)
    expect(handlers.onError).toHaveBeenCalledWith(original)
    expect(await getVideoById(db, video.id)).toMatchObject({ status: 'processing', stage: 'stage2' })
  })

  it('does not let an onError callback exception replace the pipeline error', async () => {
    const db = await getDb()
    const original = new Error('Whisper primary failure')
    const handlers = callbacks()
    handlers.onError.mockImplementation(() => { throw new Error('callback failure') })
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['ggml-large-v3.bin']
      throw original
    })

    await expect(runPipeline(video, llmSettings, handlers, db, asrModel, {
      invoke,
      callStage2: vi.fn(),
    })).rejects.toBe(original)
    expect(handlers.onError).toHaveBeenCalledTimes(1)
  })
  it('fails and rethrows Stage2 call errors without a default structure', async () => {
    const db = await getDb()
    const handlers = callbacks()

    await expect(runPipeline(video, llmSettings, handlers, db, asrModel, {
      invoke: successfulInvoke(),
      callStage2: vi.fn().mockRejectedValue(new Error('Stage2 unavailable')),
    })).rejects.toThrow('Stage2 unavailable')

    expect(await getVideoById(db, video.id)).toMatchObject({
      status: 'failed',
      stage: 'stage2',
      errorMessage: 'Stage2 unavailable',
    })
    expect(handlers.onComplete).not.toHaveBeenCalled()
    expect(handlers.onError).toHaveBeenCalledTimes(1)
  })

  it('treats Stage2 validation errors as failures', async () => {
    const db = await getDb()

    await expect(runPipeline(video, llmSettings, callbacks(), db, asrModel, {
      invoke: successfulInvoke(),
      callStage2: vi.fn().mockResolvedValue({ chapters: [{ title: '', start: 1, end: 0, sections: [] }] }),
    })).rejects.toThrow('Stage2 model returned invalid structured output after 3 attempts')

    expect(await getVideoById(db, video.id)).toMatchObject({ status: 'failed', stage: 'stage2' })
  })

  it('namespaces node IDs across videos while preserving parent links', async () => {
    const db = await getDb()
    const firstHandlers = callbacks()
    await runPipeline(video, llmSettings, firstHandlers, db, asrModel, {
      invoke: successfulInvoke(),
      callStage2: vi.fn().mockResolvedValue(validStage2),
    })

    const secondVideo = { ...video, id: 'video-asr-2' }
    const secondPayload = [
      { id: 'other_s_1', text: 'Other first.', start_time: 0, end_time: 1 },
      { id: 'other_s_2', text: 'Other second.', start_time: 1, end_time: 2 },
    ]
    const secondStage2 = validStage2For(secondVideo.id, secondPayload)
    const secondInvoke = vi.fn(async (command: string) => {
      if (command === 'list_whisper_models') return ['ggml-large-v3.bin']
      if (command === 'start_asr') return secondPayload
      throw new Error(`Unexpected command: ${command}`)
    })
    const secondHandlers = callbacks()
    await insertVideo(db, secondVideo)
    await runPipeline(secondVideo, llmSettings, secondHandlers, db, asrModel, {
      invoke: secondInvoke,
      callStage2: vi.fn().mockResolvedValue(secondStage2),
    })

    const firstNodes = firstHandlers.onComplete.mock.calls[0][1] as Node[]
    const secondNodes = secondHandlers.onComplete.mock.calls[0][1] as Node[]
    const firstIds = new Set(firstNodes.map((node) => node.id))
    const secondIds = new Set(secondNodes.map((node) => node.id))
    expect([...firstIds].filter((id) => secondIds.has(id))).toEqual([])
    for (const nodes of [firstNodes, secondNodes]) {
      const ids = new Set(nodes.map((node) => node.id))
      for (const node of nodes) {
        if (node.parentId !== null) expect(ids.has(node.parentId)).toBe(true)
      }
    }
  })
  it('persists the exact success sequence and completes with real sentence IDs', async () => {
    const db = await getDb()
    const handlers = callbacks()

    await runPipeline(video, llmSettings, handlers, db, asrModel, {
      invoke: successfulInvoke(),
      callStage2: vi.fn().mockResolvedValue(validStage2),
    })

    expect(await getVideoById(db, video.id)).toMatchObject({ status: 'ready' })
    expect(await getSentencesByVideoId(db, video.id)).toEqual([
      expect.objectContaining({ id: 'real_s_1', nodeId: validStage2.nodes[2].id, sortOrder: 0 }),
      expect.objectContaining({ id: 'real_s_2', nodeId: validStage2.nodes[2].id, sortOrder: 1 }),
    ])
    expect(handlers.onComplete).toHaveBeenCalledTimes(1)
    expect(handlers.onError).not.toHaveBeenCalled()
  })
})
