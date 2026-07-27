import { describe, expect, it, vi } from 'vitest'
import type { SqlDatabaseAdapter } from '@/models/database-adapter'
import {
  getVideoById,
  insertVideo,
  listVideos,
  searchVideosByTitle,
  updateVideoLastStudiedAt,
  updateVideoPosition,
  updateVideoStatus,
} from '@/models/database'
import type { Video } from '@/models/types'

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

const video: Video = {
  id: 'video-1',
  title: 'Signal Course',
  source: 'local',
  filePath: 'D:\\courses\\signal.mp4',
  thumbnail: 'signal.jpg',
  duration: 120,
  language: 'en',
  status: 'processing',
  stage: 'stage2',
  errorMessage: 'retrying',
  createdAt: 10,
  position: 20,
  lastStudiedAt: 30,
}

const videoRow = {
  id: video.id,
  title: video.title,
  source: video.source,
  source_url: null,
  file_path: video.filePath,
  thumbnail: video.thumbnail,
  duration: video.duration,
  language: video.language,
  status: video.status,
  stage: video.stage,
  error_message: video.errorMessage,
  created_at: video.createdAt,
  position: video.position,
  last_studied_at: video.lastStudiedAt,
}

describe('database video persistence', () => {
  it('writes and reconstructs the complete Video record', async () => {
    const exec = vi.fn()
    const query = vi.fn().mockResolvedValue([videoRow])
    const db = sqliteAdapter({
      exec,
      query: query as unknown as SqlDatabaseAdapter['query'],
    })

    await insertVideo(db, video)
    await expect(getVideoById(db, video.id)).resolves.toEqual(video)

    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO video '),
      [
        video.id,
        video.title,
        video.source,
        null,
        video.filePath,
        video.thumbnail,
        video.duration,
        video.language,
        video.status,
        video.stage,
        video.errorMessage,
        video.createdAt,
        video.position,
        video.lastStudiedAt,
      ],
    )
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM video WHERE id = $1',
      [video.id],
    )
  })

  it('keeps the approved list orderings and title search parameterized', async () => {
    const query = vi.fn().mockResolvedValue([])
    const db = sqliteAdapter({
      query: query as unknown as SqlDatabaseAdapter['query'],
    })

    await listVideos(db, 'lastStudied')
    await listVideos(db, 'createdAt')
    await listVideos(db, 'title')
    await searchVideosByTitle(db, 'Signal')

    expect(query.mock.calls).toEqual([
      ['SELECT * FROM video ORDER BY last_studied_at DESC'],
      ['SELECT * FROM video ORDER BY created_at DESC'],
      ['SELECT * FROM video ORDER BY title ASC'],
      ['SELECT * FROM video WHERE title LIKE $1', ['%Signal%']],
    ])
  })

  it('keeps status, monotonic progress and last-studied writes distinct', async () => {
    const exec = vi.fn()
    const db = sqliteAdapter({ exec })

    await updateVideoStatus(db, video.id, 'ready')
    await updateVideoPosition(db, video.id, 45)
    await updateVideoLastStudiedAt(db, video.id, 50)

    expect(exec.mock.calls).toEqual([
      ['UPDATE video SET status = $1 WHERE id = $2', ['ready', video.id]],
      [
        'UPDATE video SET position = $1 WHERE id = $2 AND position < $1',
        [45, video.id],
      ],
      [
        'UPDATE video SET last_studied_at = $1 WHERE id = $2',
        [50, video.id],
      ],
    ])
  })
})
