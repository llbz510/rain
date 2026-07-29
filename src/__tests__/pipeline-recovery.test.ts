import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import { insertSentences, insertVideo } from '@/models/database'
import { runPipeline } from '@/pipeline/pipeline-orchestrator'
import type { Video } from '@/models/types'

afterEach(() => resetDb())

const llmSettings = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.5-omni-flash',
  apiKey: 'sk-test-secret',
}

const callbacks = () => ({ onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() })

describe('pipeline recovery', () => {
  it('retries a failed Stage2 import from persisted ASR sentences without running Whisper again', async () => {
    const db = await getDb()
    const failed: Video = {
      id: 'resume-stage2', title: 'Signal', source: 'local', filePath: 'D:\\signal.mp4',
      thumbnail: '', duration: 2, language: 'zh', status: 'failed', stage: 'stage2',
      errorMessage: 'Qwen unavailable', createdAt: 1, position: 0, lastStudiedAt: 1,
    }
    await insertVideo(db, failed)
    await insertSentences(db, [{ id: 's1', nodeId: failed.id, text: 'Signal.', startTime: 0, endTime: 1, sortOrder: 0 }])
    const invoke = vi.fn()
    const callStage2 = vi.fn().mockRejectedValue(new Error('Qwen still unavailable'))

    await expect(runPipeline(failed, llmSettings, callbacks(), db, { type: 'whisper-local', modelName: 'large-v3' }, {
      invoke,
      callStage2,
    })).rejects.toThrow('Qwen still unavailable')

    expect(invoke).not.toHaveBeenCalled()
    expect(callStage2).toHaveBeenCalled()
  })
  it.each(['failed', 'cancelled'] as const)('retries %s merging through the checkpointed Stage2 path without Whisper', async (status) => {
    const db = await getDb()
    const terminal: Video = {
      id: `resume-merging-${status}`, title: 'Signal', source: 'local', filePath: 'D:\\signal.mp4',
      thumbnail: '', duration: 2, language: 'zh', status, stage: 'merging',
      errorMessage: 'merge interrupted', createdAt: 1, position: 0, lastStudiedAt: 1,
    }
    await insertVideo(db, terminal)
    await insertSentences(db, [{ id: `s-${status}`, nodeId: terminal.id, text: 'Signal.', startTime: 0, endTime: 1, sortOrder: 0 }])
    const invoke = vi.fn()

    await expect(runPipeline(terminal, llmSettings, callbacks(), db, { type: 'whisper-local', modelName: 'large-v3' }, {
      invoke,
      callStage2: vi.fn().mockRejectedValue(new Error('checkpoint repair needed')),
    })).rejects.toThrow('checkpoint repair needed')

    expect(invoke).not.toHaveBeenCalled()
  })
})
