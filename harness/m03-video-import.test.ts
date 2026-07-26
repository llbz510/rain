// harness/m03-video-import.test.ts
// ========================================
// M03 Harness: 本地视频导入公开行为
// Harness migration: 2026-07-26
// ========================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runPipeline: vi.fn(),
  tauriInvoke: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => false,
  tauriInvoke: mocks.tauriInvoke,
}))
vi.mock('@/pipeline/pipeline-orchestrator', () => ({
  runPipeline: mocks.runPipeline,
}))

import { createVideoImportController } from '@/pipeline/video-import-controller'
import {
  createDatabase,
  getVideoById,
  insertVideo,
  listVideos,
  transitionVideoImportState,
  type Database,
} from '@/models/database'
import type { ModelPoolEntry, ModelRole } from '@/settings/model-pool'
import type { Video } from '@/models/types'
import { assertTransition } from '@/pipeline/import-state'

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
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'test-key',
    modelName: 'qwen3.5-omni-flash',
    supportsVision: true,
  },
]
const roles: Record<ModelRole, string | null> = {
  asr: 'asr',
  structuring: 'structuring',
  assistant: null,
}

function pendingVideo(id: string): Video {
  return {
    id,
    title: id,
    source: 'local',
    filePath: `D:\\courses\\${id}.mp4`,
    thumbnail: '',
    duration: 120,
    language: '',
    status: 'pending',
    createdAt: 1,
    position: 0,
    lastStudiedAt: 1,
  }
}

async function makeHarness(db?: Database) {
  const database = db ?? await createDatabase(':memory:')
  const onChanged = vi.fn()
  const onProgress = vi.fn()
  const onError = vi.fn()
  const controller = createVideoImportController({
    db: database,
    loadRuntimeSettings: async () => ({ ready: true, error: null, models, roles }),
    onChanged,
    onProgress,
    onError,
    now: () => 1000,
  })
  return { controller, db: database, onChanged, onProgress, onError }
}

beforeEach(() => {
  mocks.runPipeline.mockReset()
  mocks.tauriInvoke.mockReset()
  mocks.tauriInvoke.mockImplementation(async (command: string) => {
    if (command === 'probe_video_info') {
      return { title: 'Signal Course', duration: 120, thumbnail: '' }
    }
    if (command === 'generate_thumbnail') {
      return 'D:\\courses\\signal_thumb.jpg'
    }
    throw new Error(`Unexpected Tauri command: ${command}`)
  })
  mocks.runPipeline.mockImplementation(() => new Promise<void>(() => undefined))
})

describe('M03 / AC-LV-02: 本地文件形成可追踪记录', () => {
  it('通过真实导入控制器写入 pending Video，并且不检查 yt-dlp', async () => {
    const { controller, db, onChanged } = await makeHarness()

    const video = await controller.importLocal('D:\\courses\\signal.mp4')
    const persisted = await getVideoById(db, video.id)

    expect(persisted).toMatchObject({
      id: 'v_1000',
      title: 'Signal Course',
      source: 'local',
      filePath: 'D:\\courses\\signal.mp4',
      status: 'pending',
    })
    expect(onChanged).toHaveBeenCalled()
    expect(mocks.tauriInvoke).not.toHaveBeenCalledWith('check_ytdlp_command', expect.anything())
    await vi.waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledTimes(1))
  })
})

describe('M03 / AC-LV-06: 状态只能沿批准路径变化', () => {
  it('Pipeline 的持久化状态依次经过 asr、stage2、merging、ready', async () => {
    const db = await createDatabase(':memory:')
    mocks.runPipeline.mockImplementation(async (video: Video, _settings, _callbacks, inputDb: Database) => {
      await transitionVideoImportState(inputDb, video.id, { status: 'pending', stage: null }, { status: 'processing', stage: 'asr' })
      await transitionVideoImportState(inputDb, video.id, { status: 'processing', stage: 'asr' }, { status: 'processing', stage: 'stage2' })
      await transitionVideoImportState(inputDb, video.id, { status: 'processing', stage: 'stage2' }, { status: 'processing', stage: 'merging' })
      await transitionVideoImportState(inputDb, video.id, { status: 'processing', stage: 'merging' }, { status: 'ready', stage: null })
    })
    const { controller } = await makeHarness(db)

    const imported = await controller.importLocal('D:\\courses\\signal.mp4')

    await vi.waitFor(async () => {
      expect(await getVideoById(db, imported.id)).toMatchObject({ status: 'ready', stage: undefined })
    })
  })

  it('状态机拒绝 pending 直接跳到 ready', async () => {
    const db = await createDatabase(':memory:')
    const video = pendingVideo('invalid-transition')
    await insertVideo(db, video)

    expect(() => assertTransition('pending', 'ready')).toThrow(/invalid import transition/i)
    expect(await getVideoById(db, video.id)).toMatchObject({ status: 'pending', stage: undefined })
  })
})

describe('M03 / AC-LV-03: 失败关闭', () => {
  it('Pipeline 抛错后持久化 failed 和原始错误', async () => {
    mocks.runPipeline.mockRejectedValue(new Error('ASR 模型加载失败'))
    const { controller, db, onError } = await makeHarness()

    const imported = await controller.importLocal('D:\\courses\\signal.mp4')

    await vi.waitFor(async () => {
      expect(await getVideoById(db, imported.id)).toMatchObject({
        status: 'failed',
        stage: 'asr',
        errorMessage: 'ASR 模型加载失败',
      })
    })
    expect(onError).toHaveBeenCalledWith('pipeline', expect.objectContaining({ message: 'ASR 模型加载失败' }))
  })
})

describe('M03 / AC-LV-07: 取消真正传入当前工作', () => {
  it('cancel 中止 Pipeline，并保留 Pipeline 已持久化的 cancelled 终态', async () => {
    mocks.runPipeline.mockImplementation((video: Video, _settings, _callbacks, db: Database, _model, options) =>
      new Promise<void>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          void transitionVideoImportState(
            db,
            video.id,
            { status: 'pending', stage: null },
            { status: 'cancelled', stage: 'asr', errorMessage: 'ASR cancelled' },
          ).then(() => {
            const error = new Error('ASR cancelled')
            error.name = 'AbortError'
            reject(error)
          })
        }, { once: true })
      }))
    const { controller, db } = await makeHarness()
    const imported = await controller.importLocal('D:\\courses\\signal.mp4')
    await vi.waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledTimes(1))

    controller.cancel(imported.id)

    await vi.waitFor(async () => {
      expect(await getVideoById(db, imported.id)).toMatchObject({
        status: 'cancelled',
        stage: 'asr',
        errorMessage: 'ASR cancelled',
      })
    })
  })
})

describe('M03 / AC-LV-10: 持久化记录是 UI 恢复依据', () => {
  it('控制器完成回调后数据库仍可列出导入记录', async () => {
    mocks.runPipeline.mockResolvedValue(undefined)
    const { controller, db, onChanged } = await makeHarness()

    await controller.importLocal('D:\\courses\\signal.mp4')

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    expect(await listVideos(db)).toHaveLength(1)
  })
})
