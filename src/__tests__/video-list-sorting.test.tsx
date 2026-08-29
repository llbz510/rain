import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlDatabaseAdapter } from '@/models/database-adapter'
import { createDatabase, insertVideo, queryVideos } from '@/models/database'
import { getDb, resetDb } from '@/models/db-singleton'
import type { Video } from '@/models/types'
import { VideoListPage } from '@/pages/VideoListPage'

vi.mock('@/pipeline/progress-listener', () => ({
  listenProgress: vi.fn(async () => undefined),
  unlistenProgress: vi.fn(),
}))

const fixture = [
  video('z-tie', 'Shared course', 30, 80),
  video('a-tie', 'Shared course', 30, 80),
  video('import-new', 'Middle', 50, 10),
  video('import-old', 'Course', 10, 20),
]

const expectedOrders = {
  lastStudied: ['a-tie', 'z-tie', 'import-old', 'import-new'],
  createdAt: ['import-new', 'a-tie', 'z-tie', 'import-old'],
  title: ['import-old', 'import-new', 'a-tie', 'z-tie'],
} as const

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

function sqliteAdapter(rows: Video[]): SqlDatabaseAdapter {
  return {
    adapterKind: 'sqlite',
    listTables: vi.fn(),
    getTableColumns: vi.fn(),
    exec: vi.fn(),
    query: vi.fn().mockResolvedValue(rows.map((record) => ({
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
    }))),
  }
}

function cardIds(): string[] {
  return screen.getAllByTestId(/^card-/).map((card) => card.dataset.testid!.replace('card-', ''))
}

describe('AC-VL-02 Video list sorting', () => {
  beforeEach(() => resetDb())
  afterEach(() => resetDb())

  it('returns the same stable three-order result through the public memory and SQLite adapter seams', async () => {
    const memory = await createDatabase()
    for (const record of fixture) await insertVideo(memory, record)
    const sqlite = sqliteAdapter([...fixture].reverse())

    for (const [sortBy, expected] of Object.entries(expectedOrders)) {
      const query = { sortBy: sortBy as keyof typeof expectedOrders }
      const memoryResult = await queryVideos(memory, query)
      const sqliteResult = await queryVideos(sqlite, query)
      expect(memoryResult.map((record) => record.id)).toEqual(expected)
      expect(sqliteResult.map((record) => record.id)).toEqual(expected)
    }
  })

  it('defaults to recent study and exposes the three confirmed sort choices in the production page', async () => {
    const db = await getDb()
    for (const record of fixture) await insertVideo(db, record)

    render(<VideoListPage />)

    const sort = await screen.findByRole('combobox', { name: '排序' })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '最近学习',
      '导入时间',
      '名称',
    ])
    await waitFor(() => expect(cardIds()).toEqual(expectedOrders.lastStudied))

    fireEvent.change(sort, { target: { value: 'createdAt' } })
    await waitFor(() => expect(cardIds()).toEqual(expectedOrders.createdAt))

    fireEvent.change(sort, { target: { value: 'title' } })
    await waitFor(() => expect(cardIds()).toEqual(expectedOrders.title))
  })
})
