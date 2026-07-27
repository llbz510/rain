import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlDatabaseAdapter } from '@/models/database-adapter'
import {
  createDatabase,
  deleteVideoWithCascade,
  getImportCheckpoint,
  getNodesByVideoId,
  getNotesByVideoId,
  getSentencesByVideoId,
  getVideoById,
  insertNodes,
  insertNote,
  insertSentences,
  insertVideo,
  saveImportCheckpoint,
} from '@/models/database'
import type { Video } from '@/models/types'

const mocks = vi.hoisted(() => ({
  tauriInvoke: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  tauriInvoke: mocks.tauriInvoke,
}))

function sqliteAdapter(overrides: Partial<SqlDatabaseAdapter> = {}): SqlDatabaseAdapter {
  return {
    adapterKind: 'sqlite',
    listTables: vi.fn(),
    getTableColumns: vi.fn(),
    exec: vi.fn(),
    query: vi.fn(),
    ...overrides,
  }
}

function video(id: string): Video {
  return {
    id,
    title: id,
    source: 'local',
    thumbnail: '',
    duration: 10,
    language: 'zh',
    status: 'ready',
    createdAt: 1,
    position: 0,
    lastStudiedAt: 1,
  }
}

describe('AC-LV-13 atomic Video deletion', () => {
  beforeEach(() => {
    mocks.tauriInvoke.mockReset()
  })

  it('sends one SQLite deletion command and surfaces its failure', async () => {
    const exec = vi.fn()
    const db = sqliteAdapter({ exec })
    mocks.tauriInvoke.mockRejectedValueOnce(new Error('delete blocked'))

    await expect(deleteVideoWithCascade(db, 'video-1')).rejects.toThrow('delete blocked')
    expect(mocks.tauriInvoke).toHaveBeenCalledOnce()
    expect(mocks.tauriInvoke).toHaveBeenCalledWith('delete_video_atomically', {
      videoId: 'video-1',
    })
    expect(exec).not.toHaveBeenCalled()
  })

  it('removes every owned row while preserving another Video', async () => {
    const db = await createDatabase(':memory:')
    await insertVideo(db, video('video-1'))
    await insertVideo(db, video('video-2'))
    await insertNodes(db, [
      {
        id: 'node-1',
        videoId: 'video-1',
        parentId: null,
        kind: 'paragraph',
        title: 'One',
        type: 'concept',
        startTime: 0,
        endTime: 1,
        text: 'One',
        sortOrder: 0,
      },
      {
        id: 'node-2',
        videoId: 'video-2',
        parentId: null,
        kind: 'paragraph',
        title: 'Two',
        type: 'concept',
        startTime: 0,
        endTime: 1,
        text: 'Two',
        sortOrder: 0,
      },
    ])
    await insertSentences(db, [
      { id: 'placeholder-1', nodeId: 'video-1', text: 'ASR', startTime: 0, endTime: 1, sortOrder: 0 },
      { id: 'sentence-1', nodeId: 'node-1', text: 'One', startTime: 0, endTime: 1, sortOrder: 0 },
      { id: 'sentence-2', nodeId: 'node-2', text: 'Two', startTime: 0, endTime: 1, sortOrder: 0 },
    ])
    await insertNote(db, {
      id: 'note-1',
      videoId: 'video-1',
      content: 'One',
      source: 'excerpt',
      sentenceIds: ['sentence-1'],
      createdAt: 1,
      sortOrder: 0,
    })
    await insertNote(db, {
      id: 'note-2',
      videoId: 'video-2',
      content: 'Two',
      source: 'excerpt',
      sentenceIds: ['sentence-2'],
      createdAt: 1,
      sortOrder: 0,
    })
    await saveImportCheckpoint(db, {
      videoId: 'video-1',
      stage: 'asr',
      completedBlocks: [],
      updatedAt: 1,
    })
    await saveImportCheckpoint(db, {
      videoId: 'video-2',
      stage: 'asr',
      completedBlocks: [],
      updatedAt: 1,
    })

    await deleteVideoWithCascade(db, 'video-1')

    await expect(getVideoById(db, 'video-1')).resolves.toBeNull()
    await expect(getNodesByVideoId(db, 'video-1')).resolves.toEqual([])
    await expect(getSentencesByVideoId(db, 'video-1')).resolves.toEqual([])
    await expect(getNotesByVideoId(db, 'video-1')).resolves.toEqual([])
    await expect(getImportCheckpoint(db, 'video-1')).resolves.toBeNull()

    await expect(getVideoById(db, 'video-2')).resolves.toEqual(video('video-2'))
    await expect(getNodesByVideoId(db, 'video-2')).resolves.toHaveLength(1)
    await expect(getSentencesByVideoId(db, 'video-2')).resolves.toHaveLength(1)
    await expect(getNotesByVideoId(db, 'video-2')).resolves.toHaveLength(1)
    await expect(getImportCheckpoint(db, 'video-2')).resolves.not.toBeNull()
  })
})
