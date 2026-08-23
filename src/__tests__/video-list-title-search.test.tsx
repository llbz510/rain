import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  delayedOldResolvers: [] as Array<(value: unknown) => void>,
  delayOldQueries: false,
  initializationFailure: null as Error | null,
  latestQueryFailure: null as Error | null,
  onChanged: null as (() => void) | null,
  queryFailure: null as Error | null,
}))

vi.mock('@/pipeline/progress-listener', () => ({
  listenProgress: vi.fn(async () => undefined),
  unlistenProgress: vi.fn(),
}))
vi.mock('@/models/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/models/database')>()
  const futureQuery = (actual as unknown as {
    queryVideos: (...arguments_: unknown[]) => Promise<unknown>
  }).queryVideos
  return {
    ...actual,
    queryVideos: async (...arguments_: unknown[]) => {
      if (mocks.queryFailure) throw mocks.queryFailure
      const query = arguments_[1] as { titleKeyword?: string } | undefined
      if (mocks.delayOldQueries && query?.titleKeyword === 'old') {
        return new Promise((resolve) => mocks.delayedOldResolvers.push(resolve))
      }
      if (mocks.latestQueryFailure && query?.titleKeyword === 'new') {
        throw mocks.latestQueryFailure
      }
      return futureQuery(...arguments_)
    },
  }
})
vi.mock('@/pipeline/video-import-controller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pipeline/video-import-controller')>()
  return {
    ...actual,
    createVideoImportController: (options: Parameters<typeof actual.createVideoImportController>[0]) => {
      mocks.onChanged = options.onChanged
      return actual.createVideoImportController(options)
    },
  }
})
vi.mock('@/models/db-singleton', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/models/db-singleton')>()
  return {
    ...actual,
    getDb: async () => {
      if (mocks.initializationFailure) throw mocks.initializationFailure
      return actual.getDb()
    },
  }
})

import { insertVideo } from '@/models/database'
import { getDb, resetDb } from '@/models/db-singleton'
import { VideoListPage } from '@/pages/VideoListPage'
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

beforeEach(() => {
  resetDb()
  mocks.delayedOldResolvers = []
  mocks.delayOldQueries = false
  mocks.initializationFailure = null
  mocks.latestQueryFailure = null
  mocks.onChanged = null
  mocks.queryFailure = null
})

afterEach(() => {
  resetDb()
  vi.restoreAllMocks()
})

describe('AC-VL-03 VideoListPage title search', () => {
  it('trims the title keyword, matches case-insensitively, and keeps the selected ordering when search is cleared', async () => {
    const db = await getDb()
    await insertVideo(db, video('z-last-studied', 'Signal Zebra', 10, 20))
    await insertVideo(db, video('a-last-studied', 'signal Alpha', 30, 40))
    const pathOnly = video('path-only', 'Other course', 40, 50)
    pathOnly.filePath = 'D:\\courses\\SIGNAL-in-file-path.mp4'
    pathOnly.errorMessage = 'SIGNAL only in an import diagnostic'
    await insertVideo(db, pathOnly)

    render(<VideoListPage />)
    const search = await screen.findByRole('textbox', { name: '搜索视频标题' })
    const sort = screen.getByRole('combobox', { name: '排序' })
    fireEvent.change(sort, { target: { value: 'title' } })
    fireEvent.change(search, { target: { value: '  SIGNAL  ' } })

    await waitFor(() => expect(screen.getAllByTestId(/^card-/).map((card) => card.getAttribute('data-testid')))
      .toEqual(['card-a-last-studied', 'card-z-last-studied']))
    expect(screen.queryByTestId('card-path-only')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '   ' } })
    await waitFor(() => expect(screen.getAllByTestId(/^card-/).map((card) => card.getAttribute('data-testid')))
      .toEqual(['card-path-only', 'card-a-last-studied', 'card-z-last-studied']))
  })

  it('shows a no-title-match state instead of the empty-library state', async () => {
    const db = await getDb()
    await insertVideo(db, video('existing', 'Existing course', 10, 10))

    render(<VideoListPage />)
    fireEvent.change(await screen.findByRole('textbox', { name: '搜索视频标题' }), { target: { value: 'absent title' } })

    expect(await screen.findByRole('status')).toHaveTextContent('没有找到匹配的视频')
    expect(screen.queryByText('导入你的第一个视频')).not.toBeInTheDocument()
  })

  it('keeps the existing empty-library prompt when there is no title query', async () => {
    render(<VideoListPage />)

    expect(await screen.findByText('导入你的第一个视频')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a query failure separately from an empty library or a no-title-match state, then clears it after a successful query', async () => {
    const db = await getDb()
    await insertVideo(db, video('existing', 'Existing course', 10, 10))
    mocks.queryFailure = new Error('数据库连接断开')

    render(<VideoListPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('无法加载视频列表：数据库连接断开')
    expect(screen.queryByText('导入你的第一个视频')).not.toBeInTheDocument()
    expect(screen.queryByText('没有找到匹配的视频')).not.toBeInTheDocument()

    mocks.queryFailure = null
    fireEvent.change(screen.getByRole('textbox', { name: '搜索视频标题' }), { target: { value: 'Existing' } })

    expect(await screen.findByTestId('card-existing')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows database initialization failures through the same visible loading-error boundary', async () => {
    mocks.initializationFailure = new Error('数据库初始化失败')

    render(<VideoListPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('无法加载视频列表：数据库初始化失败')
    expect(screen.queryByText('导入你的第一个视频')).not.toBeInTheDocument()
  })

  it('does not let a delayed import refresh overwrite a newer title-query failure', async () => {
    const db = await getDb()
    await insertVideo(db, video('old-result', 'old lesson', 10, 10))
    mocks.delayOldQueries = true

    render(<VideoListPage />)
    const search = await screen.findByRole('textbox', { name: '搜索视频标题' })
    fireEvent.change(search, { target: { value: 'old' } })
    await waitFor(() => expect(mocks.delayedOldResolvers).toHaveLength(1))
    expect(mocks.onChanged).not.toBeNull()
    await act(async () => {
      mocks.onChanged?.()
    })
    await waitFor(() => expect(mocks.delayedOldResolvers).toHaveLength(2))

    mocks.latestQueryFailure = new Error('新搜索失败')
    fireEvent.change(search, { target: { value: 'new' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('无法加载视频列表：新搜索失败')

    await act(async () => {
      for (const resolve of mocks.delayedOldResolvers) resolve([video('old-result', 'old lesson', 10, 10)])
    })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无法加载视频列表：新搜索失败'))
    expect(screen.queryByTestId('card-old-result')).not.toBeInTheDocument()
  })
})
