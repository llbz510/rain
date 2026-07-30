import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runPipeline: vi.fn(),
  tauriInvoke: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
  tauriInvoke: mocks.tauriInvoke,
}))
vi.mock('@/pipeline/pipeline-orchestrator', () => ({
  runPipeline: mocks.runPipeline,
}))

import { createDatabase, listVideos } from '@/models/database'
import { createVideoImportController } from '@/pipeline/video-import-controller'
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
    alias: 'Structuring',
    type: 'llm',
    provider: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    modelName: 'structuring',
    supportsVision: false,
  },
]
const roles: Record<ModelRole, string | null> = {
  asr: 'asr',
  structuring: 'structuring',
  assistant: null,
}

beforeEach(() => {
  mocks.runPipeline.mockReset()
  mocks.tauriInvoke.mockReset()
  mocks.runPipeline.mockImplementation(() => new Promise<void>(() => undefined))
  mocks.tauriInvoke.mockImplementation(async (
    command: string,
    args?: Record<string, unknown>,
  ) => {
    if (command === 'probe_video_info') {
      return { title: 'Course', duration: 90, thumbnail: '' }
    }
    if (command === 'generate_thumbnail') {
      return `D:\\rain-app-data\\thumbnails\\${String(args?.videoId)}.jpg`
    }
    throw new Error(`Unexpected Tauri command: ${command}`)
  })
})

describe('local import Video ID ownership', () => {
  it('allocates different IDs across controllers before concurrent thumbnail side effects', async () => {
    const db = await createDatabase(':memory:')
    const makeController = () => createVideoImportController({
      db,
      loadRuntimeSettings: async () => ({ ready: true, error: null, models, roles }),
      onChanged: vi.fn(),
      onProgress: vi.fn(),
      now: () => 2000,
    })
    const firstController = makeController()
    const secondController = makeController()

    const [first, second] = await Promise.all([
      firstController.importLocal('D:\\courses\\first.mp4'),
      secondController.importLocal('D:\\courses\\second.mp4'),
    ])

    expect(new Set([first.id, second.id])).toHaveProperty('size', 2)
    const thumbnailCalls = mocks.tauriInvoke.mock.calls
      .filter(([command]) => command === 'generate_thumbnail')
      .map(([, args]) => args)
    expect(new Set(thumbnailCalls.map((args) => args.videoId))).toHaveProperty('size', 2)
    const persisted = await listVideos(db)
    expect(persisted).toHaveLength(2)
    expect(persisted).toEqual(expect.arrayContaining(
      [first, second].map((video) => expect.objectContaining({
        id: video.id,
        thumbnail: `D:\\rain-app-data\\thumbnails\\${video.id}.jpg`,
      })),
    ))
  })
})
