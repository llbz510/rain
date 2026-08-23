import { describe, expect, it, vi } from 'vitest'
import type { SqlDatabaseAdapter } from '@/models/database-adapter'
import {
  createDatabase,
  insertVideo,
  queryVideos,
} from '@/models/database'
import type { Video } from '@/models/types'

function video(id: string, title: string, createdAt: number, lastStudiedAt: number): Video {
  return {
    id,
    title,
    source: 'local',
    filePath: `D:\\courses\\${id}.mp4`,
    thumbnail: '',
    duration: 60,
    language: 'en',
    status: 'ready',
    createdAt,
    position: 0,
    lastStudiedAt,
  }
}

function sqliteAdapter(query: SqlDatabaseAdapter['query']): SqlDatabaseAdapter {
  return {
    adapterKind: 'sqlite',
    listTables: vi.fn(),
    getTableColumns: vi.fn(),
    exec: vi.fn(),
    query,
  }
}

function sqliteVideoRow(id: string, title: string) {
  const record = video(id, title, 10, 10)
  return {
    id: record.id,
    title: record.title,
    source: record.source,
    source_url: null,
    file_path: record.filePath,
    thumbnail: record.thumbnail,
    duration: record.duration,
    language: record.language,
    status: record.status,
    stage: null,
    error_message: null,
    created_at: record.createdAt,
    position: record.position,
    last_studied_at: record.lastStudiedAt,
  }
}

describe('AC-VL-03 title video query', () => {
  it('uses a trimmed case-insensitive title keyword and the selected ordering in the memory adapter', async () => {
    const db = await createDatabase()
    await insertVideo(db, video('early', 'Signal Basics', 10, 20))
    await insertVideo(db, video('late', 'signal Deep Dive', 30, 40))
    await insertVideo(db, video('path-only', 'Other course', 40, 50))

    await expect(queryVideos(db, { titleKeyword: '  SIGNAL  ', sortBy: 'lastStudied' }))
      .resolves.toMatchObject([
        { id: 'late', title: 'signal Deep Dive' },
        { id: 'early', title: 'Signal Basics' },
      ])
  })

  it('uses an adapter-independent title order with stable ID ties and literal SQL wildcard keywords in memory', async () => {
    const db = await createDatabase()
    await insertVideo(db, video('z-tie', 'Signal Zebra', 10, 40))
    await insertVideo(db, video('a-tie', 'signal Alpha', 20, 40))
    await insertVideo(db, video('upper-title', 'Signal', 30, 30))
    await insertVideo(db, video('lower-title', 'signal', 40, 20))
    await insertVideo(db, video('literal-percent', '100% Signal', 50, 10))
    await insertVideo(db, video('near-percent', '100x Signal', 60, 0))
    await insertVideo(db, video('literal-underscore', '101_ Signal', 70, 5))
    await insertVideo(db, video('near-underscore', '101x Signal', 80, 4))

    await expect(queryVideos(db, { titleKeyword: 'signal', sortBy: 'lastStudied' }))
      .resolves.toMatchObject([
        { id: 'a-tie' },
        { id: 'z-tie' },
        { id: 'upper-title' },
        { id: 'lower-title' },
        { id: 'literal-percent' },
        { id: 'literal-underscore' },
        { id: 'near-underscore' },
        { id: 'near-percent' },
      ])
    await expect(queryVideos(db, { titleKeyword: 'signal', sortBy: 'title' }))
      .resolves.toMatchObject([
        { id: 'literal-percent' },
        { id: 'near-percent' },
        { id: 'literal-underscore' },
        { id: 'near-underscore' },
        { id: 'upper-title' },
        { id: 'lower-title' },
        { id: 'a-tie' },
        { id: 'z-tie' },
      ])
    await expect(queryVideos(db, { titleKeyword: '100%', sortBy: 'createdAt' }))
      .resolves.toMatchObject([{ id: 'literal-percent' }])
    await expect(queryVideos(db, { titleKeyword: '101_', sortBy: 'createdAt' }))
      .resolves.toMatchObject([{ id: 'literal-underscore' }])
  })

  it('normalizes deliberately unordered SQLite rows through the same public title ordering', async () => {
    const db = sqliteAdapter(vi.fn().mockResolvedValue([
      sqliteVideoRow('han-course', '课程'),
      sqliteVideoRow('han-video', '视频'),
      sqliteVideoRow('lower-title', 'signal'),
      sqliteVideoRow('upper-title', 'Signal'),
    ]))

    await expect(queryVideos(db, { sortBy: 'title' })).resolves.toMatchObject([
      { id: 'upper-title' },
      { id: 'lower-title' },
      { id: 'han-video' },
      { id: 'han-course' },
    ])
  })

  it('uses the same normalized title query and selected ordering in the SQLite public interface', async () => {
    const query = vi.fn().mockResolvedValue([])
    const db = sqliteAdapter(query)

    await queryVideos(db, { titleKeyword: ' Signal ', sortBy: 'title' })
    await queryVideos(db, { titleKeyword: '   ', sortBy: 'createdAt' })
    await queryVideos(db, { titleKeyword: '100%', sortBy: 'lastStudied' })
    await queryVideos(db, { titleKeyword: '101_', sortBy: 'lastStudied' })

    expect(query.mock.calls).toEqual([
      ['SELECT * FROM video WHERE instr(LOWER(title), LOWER($1)) > 0 ORDER BY LOWER(title) ASC, title ASC, id ASC', ['Signal']],
      ['SELECT * FROM video ORDER BY created_at DESC, id ASC'],
      ['SELECT * FROM video WHERE instr(LOWER(title), LOWER($1)) > 0 ORDER BY last_studied_at DESC, id ASC', ['100%']],
      ['SELECT * FROM video WHERE instr(LOWER(title), LOWER($1)) > 0 ORDER BY last_studied_at DESC, id ASC', ['101_']],
    ])
  })
})
