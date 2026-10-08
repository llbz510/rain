import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/tauri-env', () => ({ isTauri: () => true, tauriInvoke: native.invoke }))

import { createDatabase, getVideoById, getSentencesByVideoId, insertVideo, listVideos } from '@/models/database'
import { createVideoImportController } from '@/pipeline/video-import-controller'
import type { ProgressPayload } from '@/architecture/events'

beforeEach(() => native.invoke.mockReset())
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function runningImport() {
  const db = await createDatabase()
  await insertVideo(db, {
    id: 'progress-task', title: 'Progress', source: 'local', filePath: 'D:\\course.mp4',
    thumbnail: '', duration: 60, language: '', status: 'pending', createdAt: 1,
    position: 0, lastStudiedAt: 1,
  })
  let finishAsr!: (value: unknown) => void
  const asr = new Promise<unknown>((resolve) => { finishAsr = resolve })
  native.invoke.mockImplementation(async (command) => {
    if (command === 'list_whisper_models') return ['D:\\models\\ggml-large-v3.bin']
    if (command === 'start_asr') return asr
    if (command === 'cancel_import') return undefined
    throw new Error(`Unexpected command: ${command}`)
  })
  const onProgress = vi.fn()
  const onChanged = vi.fn()
  const controller = createVideoImportController({
    db, onProgress, onChanged,
    loadRuntimeSettings: async () => ({
      ready: true, error: null,
      models: [
        { id: 'asr', alias: 'ASR', type: 'whisper-local', provider: 'local', modelName: 'large-v3', supportsVision: false },
        { id: 'llm', alias: 'LLM', type: 'llm', provider: 'fixture', modelName: 'fixture', baseUrl: 'https://example.test/v1', apiKey: 'fixture', supportsVision: false },
      ],
      roles: { asr: 'asr', structuring: 'llm', assistant: null },
    }),
  })
  controller.start('progress-task')
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith('start_asr', expect.anything()))
  return { controller, db, onProgress, onChanged, finishAsr }
}

function wire(percent: number): ProgressPayload {
  return { videoId: 'progress-task', stage: 'asr_transcription', percent, blockCurrent: 0, blockTotal: 0, retrying: false }
}

describe('AC-AR-06 Controller progress boundary', () => {
  it('keeps the real ASR percentage when a lower same-stage event arrives', async () => {
    const { controller, onProgress } = await runningImport()
    controller.acceptProgress(wire(47))
    const published = onProgress.mock.calls.length
    controller.acceptProgress(wire(12))
    expect(onProgress.mock.calls).toHaveLength(published)
    expect(onProgress.mock.lastCall?.[1]).toMatchObject({ stage: 'asr', percent: 47 })
  })

  it('publishes persisted cancellation as a terminal payload and ignores late events', async () => {
    const { controller, onProgress, finishAsr } = await runningImport()
    controller.acceptProgress(wire(47))
    controller.cancel('progress-task')
    finishAsr([{ id: 's1', text: 'Late result', start_time: 0, end_time: 1 }])
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith('progress-task', {
      videoId: 'progress-task', stage: 'terminal', status: 'cancelled',
    }))
    const published = onProgress.mock.calls.length
    controller.acceptProgress(wire(99))
    expect(onProgress.mock.calls).toHaveLength(published)
  })

  it.each([
    { stage: 'unknown' }, { percent: -1 }, { percent: 101 }, { percent: NaN },
    { backend: 'metal' }, { error: 'wrong' }, { retrying: true }, { blockCurrent: 1 },
    { stage: 'stage2', blockCurrent: 0, blockTotal: 2 },
    { stage: 'stage2', blockCurrent: 3, blockTotal: 2 },
  ])('ignores an illegal desktop event without corrupting the last actual progress: %j', async (invalid) => {
    const { controller, onProgress } = await runningImport()
    controller.acceptProgress(wire(47))
    const published = onProgress.mock.calls.length
    controller.acceptProgress({ ...wire(48), ...invalid } as ProgressPayload)
    expect(onProgress.mock.calls).toHaveLength(published)
    expect(onProgress.mock.lastCall?.[1]).toMatchObject({ stage: 'asr', percent: 47 })
  })

  it('restarts only at the persisted Stage2 checkpoint on the same record after a failed run', async () => {
    const { controller, db, onProgress, finishAsr } = await runningImport()
    let failModel!: (response: Response) => void
    const failedResponse = new Promise<Response>((resolve) => { failModel = resolve })
    const request = vi.fn().mockImplementationOnce(() => failedResponse).mockImplementation(async (_url, options: RequestInit) => {
      const input = JSON.parse(JSON.parse(String(options.body)).messages[1].content)
      const content = {
        blockId: input.blockId,
        nodes: [
          { id: 'ch', parentId: null, kind: 'chapter', title: 'Chapter', startSentenceId: 's1', endSentenceId: 's1' },
          { id: 'sec', parentId: 'ch', kind: 'section', title: 'Section', startSentenceId: 's1', endSentenceId: 's1' },
          { id: 'p', parentId: 'sec', kind: 'paragraph', title: 'Paragraph', type: 'concept', startSentenceId: 's1', endSentenceId: 's1' },
        ], coveredSentenceIds: ['s1'],
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', request)
    finishAsr([{ id: 's1', text: 'Original sentence.', start_time: 0, end_time: 1 }])
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    controller.acceptProgress({ videoId: 'progress-task', stage: 'stage2', percent: 60, blockCurrent: 1, blockTotal: 1, retrying: false })
    failModel(new Response('Model unavailable', { status: 400 }))
    await vi.waitFor(() => expect(onProgress.mock.lastCall?.[1]).toBeNull())
    expect(await getVideoById(db, 'progress-task')).toMatchObject({ status: 'failed', stage: 'stage2' })
    expect(onProgress.mock.calls.some(([, next]) => next?.stage === 'terminal' && next.status === 'failed' && typeof next.error === 'string')).toBe(true)

    const beforeRetry = onProgress.mock.calls.length
    controller.start('progress-task')
    await vi.waitFor(async () => expect(await getVideoById(db, 'progress-task')).toMatchObject({ status: 'ready' }))
    const retried = onProgress.mock.calls.slice(beforeRetry).map(([, next]) => next).filter(Boolean)
    expect(retried[0]).toEqual({ videoId: 'progress-task', stage: 'stage2', percent: 0, blockCurrent: 1, blockTotal: 1, retrying: false })
    expect(retried.some((next) => next.stage === 'asr' || next.stage === 'download')).toBe(false)
    expect(retried.at(-1)).toEqual({ videoId: 'progress-task', stage: 'terminal', status: 'ready' })
    expect(native.invoke.mock.calls.filter(([command]) => command === 'start_asr')).toHaveLength(1)
    expect(await listVideos(db)).toHaveLength(1)
    expect(await getSentencesByVideoId(db, 'progress-task')).toMatchObject([{ id: 's1', text: 'Original sentence.' }])
  })
})
