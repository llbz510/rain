import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runPipeline: vi.fn(),
}))

vi.mock('@/pipeline/pipeline-orchestrator', () => ({
  runPipeline: mocks.runPipeline,
}))

import { createDatabase, getVideoById, insertVideo } from '@/models/database'
import type { Video } from '@/models/types'
import { createVideoImportController } from '@/pipeline/video-import-controller'
import {
  recordCapabilityCheck,
  type ModelCapabilityRecord,
} from '@/settings/model-capabilities'
import {
  runtimeModelFromPoolEntry,
  type ModelPoolEntry,
  type ModelRole,
} from '@/settings/model-pool'

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
    apiKey: 'sk-runtime-secret',
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

function compatibleCapabilities(
  sourceModels: ModelPoolEntry[] = models,
): ModelCapabilityRecord[] {
  return [
    recordCapabilityCheck({
      model: runtimeModelFromPoolEntry(sourceModels[0]),
      role: 'asr',
      ok: true,
      message: 'ASR probe passed',
      checkedAt: 100,
    }),
    recordCapabilityCheck({
      model: runtimeModelFromPoolEntry(sourceModels[1]),
      role: 'structuring',
      ok: true,
      message: 'Structuring probe passed',
      checkedAt: 100,
    }),
  ]
}

beforeEach(() => {
  mocks.runPipeline.mockReset()
  mocks.runPipeline.mockResolvedValue(undefined)
})

describe('AC-LV-12 runtime capability gate', () => {
  it('blocks import before Pipeline when the ASR role has no current capability record', async () => {
    const db = await createDatabase(':memory:')
    const video = pendingVideo('missing-asr-capability')
    const onError = vi.fn()
    await insertVideo(db, video)

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: async () => ({
        ready: true,
        error: null,
        models,
        roles,
        capabilities: [],
      }),
      onChanged: vi.fn(),
      onProgress: vi.fn(),
      onError,
    })
    controller.start(video.id)

    await vi.waitFor(async () => {
      expect(await getVideoById(db, video.id)).toMatchObject({
        status: 'failed',
        stage: 'asr',
        errorMessage: expect.stringMatching(/^ASR 模型“Whisper”不可用：/),
      })
    })
    expect(mocks.runPipeline).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(
      'pipeline',
      expect.objectContaining({ message: expect.stringMatching(/^ASR 模型“Whisper”不可用：/) }),
    )
  })

  it('invalidates a prior check when the selected ASR configuration has changed', async () => {
    const db = await createDatabase(':memory:')
    const video = pendingVideo('stale-asr-capability')
    const changedModels = models.map((model) => ({ ...model }))
    changedModels[0].modelName = 'large-v3-turbo'
    await insertVideo(db, video)

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: async () => ({
        ready: true,
        error: null,
        models: changedModels,
        roles,
        capabilities: compatibleCapabilities(),
      }),
      onChanged: vi.fn(),
      onProgress: vi.fn(),
    })
    controller.start(video.id)

    await vi.waitFor(async () => {
      expect(await getVideoById(db, video.id)).toMatchObject({
        status: 'failed',
        errorMessage: expect.stringMatching(/^ASR 模型“Whisper”不可用：/),
      })
    })
    expect(mocks.runPipeline).not.toHaveBeenCalled()
  })

  it('blocks an unavailable structuring model without exposing its API key', async () => {
    const db = await createDatabase(':memory:')
    const video = pendingVideo('unavailable-structuring')
    const capabilities = compatibleCapabilities()
    capabilities[1] = recordCapabilityCheck({
      model: runtimeModelFromPoolEntry(models[1]),
      role: 'structuring',
      ok: false,
      message: 'HTTP 401: credential sk-runtime-secret rejected',
      checkedAt: 200,
    })
    await insertVideo(db, video)

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: async () => ({
        ready: true,
        error: null,
        models,
        roles,
        capabilities,
      }),
      onChanged: vi.fn(),
      onProgress: vi.fn(),
    })
    controller.start(video.id)

    await vi.waitFor(async () => {
      const persisted = await getVideoById(db, video.id)
      expect(persisted).toMatchObject({
        status: 'failed',
        errorMessage: '结构化模型“Qwen”不可用：HTTP 401: credential [REDACTED] rejected',
      })
      expect(persisted?.errorMessage).not.toContain('sk-runtime-secret')
    })
    expect(mocks.runPipeline).not.toHaveBeenCalled()
  })

  it('runs with the compatible startup snapshot even if later settings change', async () => {
    const db = await createDatabase(':memory:')
    const video = pendingVideo('compatible-snapshot')
    const currentModels = models.map((model) => ({ ...model }))
    const currentCapabilities = compatibleCapabilities(currentModels)
    await insertVideo(db, video)

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: async () => ({
        ready: true,
        error: null,
        models: currentModels.map((model) => ({ ...model })),
        roles: { ...roles },
        capabilities: currentCapabilities.map((record) => ({ ...record })),
      }),
      onChanged: vi.fn(),
      onProgress: (_videoId, progress) => {
        if (!progress) return
        currentModels[1].modelName = 'changed-after-start'
        currentModels[1].apiKey = 'sk-changed-after-start'
        currentCapabilities.length = 0
      },
    })
    controller.start(video.id)

    await vi.waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledTimes(1))
    expect(mocks.runPipeline).toHaveBeenCalledWith(
      video,
      expect.objectContaining({
        apiKey: 'sk-runtime-secret',
        model: 'qwen3.5-omni-flash',
      }),
      expect.any(Object),
      db,
      expect.objectContaining({ modelName: 'large-v3' }),
      expect.any(Object),
    )
  })
})
