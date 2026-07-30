// harness/m21-import-controller.test.ts
// ========================================
// M21 Harness: 本地导入桌面命令适配器
// Harness migrations: 2026-07-26, 2026-07-30 thumbnail ownership
// ========================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isTauri: true,
  runPipeline: vi.fn(),
  tauriInvoke: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => mocks.isTauri,
  tauriInvoke: mocks.tauriInvoke,
}))
vi.mock('@/pipeline/pipeline-orchestrator', () => ({
  runPipeline: mocks.runPipeline,
}))

import { createVideoImportController } from '@/pipeline/video-import-controller'
import { createDatabase, listVideos } from '@/models/database'
import type { ModelPoolEntry, ModelRole } from '@/settings/model-pool'

const models: ModelPoolEntry[] = [
  {
    id: 'asr',
    alias: 'Whisper',
    type: 'whisper-local',
    provider: 'local',
    modelName: 'large-v3',
    supportsVision: false,
  },
  {
    id: 'structuring',
    alias: 'Qwen',
    type: 'llm',
    provider: 'dashscope',
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    modelName: 'qwen',
    supportsVision: false,
  },
]
const roles: Record<ModelRole, string | null> = {
  asr: 'asr',
  structuring: 'structuring',
  assistant: null,
}

async function makeHarness() {
  const db = await createDatabase(':memory:')
  const onWarning = vi.fn()
  const onError = vi.fn()
  const controller = createVideoImportController({
    db,
    loadRuntimeSettings: async () => ({ ready: true, error: null, models, roles }),
    onChanged: vi.fn(),
    onProgress: vi.fn(),
    onWarning,
    onError,
    now: () => 2000,
  })
  return { controller, db, onWarning, onError }
}

beforeEach(() => {
  mocks.isTauri = true
  mocks.runPipeline.mockReset()
  mocks.tauriInvoke.mockReset()
  mocks.runPipeline.mockImplementation(() => new Promise<void>(() => undefined))
  mocks.tauriInvoke.mockImplementation(async (command: string) => {
    if (command === 'probe_video_info') {
      return { title: 'Course', duration: 90, thumbnail: 'probe-thumb.jpg' }
    }
    if (command === 'generate_thumbnail') return 'D:\\rain-app-data\\thumbnails\\v_2000.jpg'
    if (command === 'cancel_import') return undefined
    throw new Error(`Unexpected Tauri command: ${command}`)
  })
})

describe('M21 / AC-LV-02 / AC-LV-18: 桌面探测和缩略图命令', () => {
  it('使用真实命令名和参数，并持久化探测结果', async () => {
    const { controller, db } = await makeHarness()

    await controller.importLocal('D:\\courses\\course.mp4')

    expect(mocks.tauriInvoke).toHaveBeenNthCalledWith(1, 'probe_video_info', {
      filePath: 'D:\\courses\\course.mp4',
      sourceUrl: null,
    })
    expect(mocks.tauriInvoke).toHaveBeenNthCalledWith(2, 'generate_thumbnail', {
      filePath: 'D:\\courses\\course.mp4',
      videoId: 'v_2000',
      timestamp: 1,
    })
    expect(await listVideos(db)).toEqual([
      expect.objectContaining({
        title: 'Course',
        thumbnail: 'D:\\rain-app-data\\thumbnails\\v_2000.jpg',
        status: 'pending',
      }),
    ])
  })

  it('缩略图失败只产生警告，仍然使用探测缩略图导入', async () => {
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'probe_video_info') {
        return { title: 'Course', duration: 90, thumbnail: 'probe-thumb.jpg' }
      }
      if (command === 'generate_thumbnail') throw new Error('ffmpeg failed')
      throw new Error(`Unexpected Tauri command: ${command}`)
    })
    const { controller, db, onWarning } = await makeHarness()

    await controller.importLocal('D:\\courses\\course.mp4')

    expect(onWarning).toHaveBeenCalledWith('缩略图生成失败，继续导入', expect.objectContaining({ message: 'ffmpeg failed' }))
    expect(await listVideos(db)).toEqual([
      expect.objectContaining({ thumbnail: 'probe-thumb.jpg', status: 'pending' }),
    ])
  })

  it('视频探测失败时不写入半成品记录', async () => {
    mocks.tauriInvoke.mockRejectedValue(new Error('unsupported video'))
    const { controller, db, onError } = await makeHarness()

    await expect(controller.importLocal('D:\\courses\\broken.mp4')).rejects.toThrow('unsupported video')

    expect(await listVideos(db)).toEqual([])
    expect(onError).toHaveBeenCalledWith('local-import', expect.objectContaining({ message: 'unsupported video' }))
    expect(mocks.runPipeline).not.toHaveBeenCalled()
  })
})

describe('M21 / AC-LV-07: 桌面取消命令', () => {
  it('同时中止前端 Pipeline 并调用 cancel_import', async () => {
    let pipelineSignal: AbortSignal | undefined
    mocks.runPipeline.mockImplementation((_video, _settings, _callbacks, _db, _model, options) => {
      pipelineSignal = options.signal
      return new Promise<void>(() => undefined)
    })
    const { controller } = await makeHarness()
    const imported = await controller.importLocal('D:\\courses\\course.mp4')
    await vi.waitFor(() => expect(pipelineSignal).toBeDefined())

    controller.cancel(imported.id)

    expect(pipelineSignal?.aborted).toBe(true)
    await vi.waitFor(() => {
      expect(mocks.tauriInvoke).toHaveBeenCalledWith('cancel_import', { videoId: imported.id })
    })
  })
})
