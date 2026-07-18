import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import { insertVideo } from '@/models/database'
import { runAsrStage } from '@/pipeline/asr-runner'

afterEach(() => resetDb())

describe('ASR cancellation', () => {
  it('does not invoke Whisper after the import signal is already aborted', async () => {
    const db = await getDb()
    const video = { id: 'cancel-asr', title: 'Video', source: 'local' as const, filePath: 'D:\\video.mp4', thumbnail: '', duration: 1, language: '', status: 'pending' as const, createdAt: 1, position: 0, lastStudiedAt: 1 }
    await insertVideo(db, video)
    const controller = new AbortController()
    controller.abort()
    const invoke = vi.fn()

    await expect(runAsrStage({ video, asrModel: { type: 'whisper-local', modelName: 'large-v3' }, db, invoke, signal: controller.signal } as never)).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).not.toHaveBeenCalled()
  })
})