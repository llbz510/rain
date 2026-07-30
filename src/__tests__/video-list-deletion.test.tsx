import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  afterPublish: null as null | (() => Promise<void>),
  failVideoDeletion: false,
  failVideoListRead: false,
  isTauri: false,
  runPipeline: vi.fn(),
  tauriInvoke: vi.fn(),
}))

vi.mock('@/pipeline/progress-listener', () => ({
  listenProgress: vi.fn(async () => undefined),
  unlistenProgress: vi.fn(),
}))
vi.mock('@/pipeline/pipeline-orchestrator', () => ({
  runPipeline: mocks.runPipeline,
}))
vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => mocks.isTauri,
  tauriInvoke: mocks.tauriInvoke,
}))
vi.mock('@/models/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/models/database')>()
  return {
    ...actual,
    deleteVideoWithCascade: async (...args: Parameters<typeof actual.deleteVideoWithCascade>) => {
      if (mocks.failVideoDeletion) throw new Error('删除事务失败')
      return actual.deleteVideoWithCascade(...args)
    },
    listVideos: async (...args: Parameters<typeof actual.listVideos>) => {
      const videos = await actual.listVideos(...args)
      if (mocks.failVideoListRead) throw new Error('刷新读取失败')
      return videos
    },
    publishDownloadedMedia: async (...args: Parameters<typeof actual.publishDownloadedMedia>) => {
      const published = await actual.publishDownloadedMedia(...args)
      await mocks.afterPublish?.()
      return published
    },
  }
})

import { VideoListPage } from '@/pages/VideoListPage'
import { VideoCard } from '@/ui/components/video-list'
import { getDb, resetDb } from '@/models/db-singleton'
import {
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
import { useRainStore } from '@/store/rain-store'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import {
  runtimeModelFromPoolEntry,
  type ModelPoolEntry,
} from '@/settings/model-pool'

function configureRunnableSettings(): void {
  const modelPool: ModelPoolEntry[] = [
    {
      id: 'asr', alias: 'Whisper', type: 'whisper-local', provider: 'local',
      modelName: 'large-v3', supportsVision: false,
    },
    {
      id: 'structuring', alias: 'Structuring', type: 'llm', provider: 'test',
      baseUrl: 'https://example.com/v1', apiKey: 'test-key',
      modelName: 'test-model', supportsVision: false,
    },
  ]
  useRainStore.setState({
    settingsReady: true,
    settingsError: null,
    modelPool,
    capabilityRecords: [
      recordCapabilityCheck({
        model: runtimeModelFromPoolEntry(modelPool[0]), role: 'asr', ok: true,
        message: 'ASR probe passed',
      }),
      recordCapabilityCheck({
        model: runtimeModelFromPoolEntry(modelPool[1]), role: 'structuring', ok: true,
        message: 'Structuring probe passed',
      }),
    ],
    roleAssignment: { asr: 'asr', structuring: 'structuring', assistant: 'structuring' },
    loadRuntimeSettings: async () => undefined,
  })
}

beforeEach(() => {
  resetDb()
  useRainStore.getState().reset()
  mocks.afterPublish = null
  mocks.failVideoDeletion = false
  mocks.failVideoListRead = false
  mocks.isTauri = false
  mocks.runPipeline.mockReset()
  mocks.runPipeline.mockResolvedValue(undefined)
  mocks.tauriInvoke.mockReset()
  mocks.tauriInvoke.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetDb()
})

describe('AC-LV-13 production Video deletion', () => {
  it('lets the user confirm deletion and removes the Video with all owned study data', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'delete-me',
      title: '待删除课程',
      source: 'local',
      filePath: 'D:\\courses\\keep-source.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'ready',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    await insertNodes(db, [{
      id: 'paragraph-1',
      videoId: 'delete-me',
      parentId: null,
      kind: 'paragraph',
      title: '段落',
      type: 'concept',
      startTime: 0,
      endTime: 60,
      text: '内容',
      sortOrder: 0,
    }])
    await insertSentences(db, [{
      id: 'sentence-1',
      nodeId: 'paragraph-1',
      text: '内容。',
      startTime: 0,
      endTime: 1,
      sortOrder: 0,
    }])
    await insertNote(db, {
      id: 'note-1',
      videoId: 'delete-me',
      content: '随记',
      source: 'excerpt',
      sentenceIds: ['sentence-1'],
      createdAt: 1,
      sortOrder: 0,
    })
    await saveImportCheckpoint(db, {
      videoId: 'delete-me',
      stage: 'stage2',
      completedBlocks: ['block-1'],
      updatedAt: 1,
    })

    render(<VideoListPage />)

    const card = await screen.findByTestId('card-delete-me')
    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    const confirmation = await screen.findByTestId('delete-confirm')
    expect(confirmation).toHaveTextContent('1 个段落和 1 条笔记')
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(screen.queryByTestId('card-delete-me')).not.toBeInTheDocument())
    await expect(getVideoById(db, 'delete-me')).resolves.toBeNull()
    await expect(getNodesByVideoId(db, 'delete-me')).resolves.toEqual([])
    await expect(getSentencesByVideoId(db, 'delete-me')).resolves.toEqual([])
    await expect(getNotesByVideoId(db, 'delete-me')).resolves.toEqual([])
    await expect(getImportCheckpoint(db, 'delete-me')).resolves.toBeNull()
  })

  it('lets the user cancel deletion without changing the Video', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'keep-me',
      title: '保留课程',
      source: 'local',
      filePath: 'D:\\courses\\keep-me.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'ready',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })

    render(<VideoListPage />)

    const card = await screen.findByTestId('card-keep-me')
    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    fireEvent.click(within(await screen.findByTestId('delete-confirm')).getByRole('button', { name: '取消' }))

    expect(screen.queryByTestId('delete-confirm')).not.toBeInTheDocument()
    await expect(getVideoById(db, 'keep-me')).resolves.toMatchObject({ title: '保留课程' })
    expect(screen.getByTestId('card-keep-me')).toBeInTheDocument()
  })

  it('keeps the card and shows a retryable error when deletion fails', async () => {
    const onDelete = vi.fn(async () => {
      throw new Error('数据库被锁定')
    })
    render(<VideoCard
      video={{
        id: 'delete-fails',
        title: '删除失败课程',
        source: 'local',
        filePath: 'D:\\courses\\delete-fails.mp4',
        thumbnail: '',
        duration: 60,
        language: 'zh',
        status: 'ready',
        createdAt: 1,
        position: 0,
        lastStudiedAt: 1,
      }}
      nodeCount={2}
      noteCount={1}
      onDelete={onDelete}
    />)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败：数据库被锁定')
    expect(screen.getByTestId('card-delete-fails')).toBeInTheDocument()
    expect(screen.getByTestId('delete-confirm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认删除' })).toBeEnabled()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('shows an error instead of a false zero-count confirmation when deletion details cannot load', async () => {
    const onDelete = vi.fn(async () => undefined)
    render(<VideoCard
      video={{
        id: 'count-fails',
        title: '统计失败课程',
        source: 'local',
        filePath: 'D:\\courses\\count-fails.mp4',
        thumbnail: '',
        duration: 60,
        language: 'zh',
        status: 'ready',
        createdAt: 1,
        position: 0,
        lastStudiedAt: 1,
      }}
      loadDeleteInfo={async () => { throw new Error('无法读取关联数据') }}
      onDelete={onDelete}
    />)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法准备删除：无法读取关联数据')
    expect(screen.queryByTestId('delete-confirm')).not.toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('cancels and waits for an active Pipeline before deleting late checkpoint writes', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'active-import',
      title: '处理中课程',
      source: 'local',
      filePath: 'D:\\courses\\active-import.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'pending',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()

    let pipelineSignal: AbortSignal | undefined
    let releaseLateWrite: () => void = () => undefined
    mocks.runPipeline.mockImplementation(async (video, _settings, _callbacks, inputDb, _asrModel, options) => {
      pipelineSignal = options.signal
      await new Promise<void>((resolve) => {
        releaseLateWrite = resolve
      })
      await saveImportCheckpoint(inputDb, {
        videoId: video.id,
        stage: 'stage2',
        completedBlocks: ['late-block'],
        updatedAt: 2,
      })
    })

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-active-import')
    fireEvent.click(within(card).getByText('处理中课程'))
    await waitFor(() => expect(pipelineSignal).toBeDefined())
    fireEvent.click(within(card).getByText('处理中课程'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    fireEvent.click(within(await screen.findByTestId('delete-confirm')).getByRole('button', { name: '确认删除' }))

    try {
      await waitFor(() => expect(pipelineSignal?.aborted).toBe(true))
    } finally {
      releaseLateWrite()
    }
    await waitFor(() => expect(screen.queryByTestId('card-active-import')).not.toBeInTheDocument())
    await expect(getVideoById(db, 'active-import')).resolves.toBeNull()
    await expect(getImportCheckpoint(db, 'active-import')).resolves.toBeNull()
  })

  it('keeps the committed deletion visible when the post-delete list read fails', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'refresh-fails',
      title: '刷新失败课程',
      source: 'local',
      filePath: 'D:\\courses\\refresh-fails.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'ready',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-refresh-fails')
    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    const confirmation = await screen.findByTestId('delete-confirm')
    mocks.failVideoListRead = true
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认删除' }))

    await waitFor(async () => expect(await getVideoById(db, 'refresh-fails')).toBeNull())
    await waitFor(() => expect(screen.queryByTestId('card-refresh-fails')).not.toBeInTheDocument())
    expect(screen.queryByText(/删除失败/)).not.toBeInTheDocument()
  })

  it('does not expose a silent confirmation action without a deletion owner', async () => {
    render(<VideoCard
      video={{
        id: 'no-owner',
        title: '无删除 Owner',
        source: 'local',
        filePath: 'D:\\courses\\no-owner.mp4',
        thumbnail: '',
        duration: 60,
        language: 'zh',
        status: 'ready',
        createdAt: 1,
        position: 0,
        lastStudiedAt: 1,
      }}
      nodeCount={1}
      noteCount={0}
    />)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(await screen.findByTestId('delete-confirm')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument()
  })

  it('loads deletion details only once while preparation is pending', async () => {
    let resolveDeleteInfo: (value: { nodeCount: number; noteCount: number }) => void = () => undefined
    const loadDeleteInfo = vi.fn(() => new Promise<{ nodeCount: number; noteCount: number }>((resolve) => {
      resolveDeleteInfo = resolve
    }))
    render(<VideoCard
      video={{
        id: 'single-flight',
        title: '单飞计数',
        source: 'local',
        filePath: 'D:\\courses\\single-flight.mp4',
        thumbnail: '',
        duration: 60,
        language: 'zh',
        status: 'ready',
        createdAt: 1,
        position: 0,
        lastStudiedAt: 1,
      }}
      loadDeleteInfo={loadDeleteInfo}
      onDelete={async () => undefined}
    />)

    const deleteButton = screen.getByRole('button', { name: '删除' })
    fireEvent.click(deleteButton)
    fireEvent.click(deleteButton)

    expect(loadDeleteInfo).toHaveBeenCalledOnce()
    resolveDeleteInfo({ nodeCount: 1, noteCount: 0 })
    expect(await screen.findByTestId('delete-confirm')).toHaveTextContent('1 个段落和 0 条笔记')
  })

  it('does not allow a new Pipeline to start while desktop cancellation is still settling', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'slow-cancel',
      title: '慢取消课程',
      source: 'local',
      filePath: 'D:\\courses\\slow-cancel.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'pending',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    mocks.isTauri = true

    let releasePipeline: () => void = () => undefined
    let releaseDesktopCancellation: () => void = () => undefined
    mocks.runPipeline.mockImplementation(() => new Promise<void>((resolve) => {
      releasePipeline = resolve
    }))
    mocks.tauriInvoke.mockImplementation((command: string) => {
      if (command !== 'cancel_import') throw new Error(`Unexpected command: ${command}`)
      return new Promise<void>((resolve) => {
        releaseDesktopCancellation = resolve
      })
    })

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-slow-cancel')
    fireEvent.click(within(card).getByText('慢取消课程'))
    await waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledOnce())
    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    fireEvent.click(within(await screen.findByTestId('delete-confirm')).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(mocks.tauriInvoke).toHaveBeenCalledWith('cancel_import', { videoId: 'slow-cancel' }))

    await act(async () => {
      releasePipeline()
    })
    await waitFor(() => expect(within(card).getByRole('button', { name: '删除中…' })).toBeDisabled())
    fireEvent.click(within(card).getByText('慢取消课程'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    try {
      expect(mocks.runPipeline).toHaveBeenCalledOnce()
    } finally {
      await act(async () => {
        releaseDesktopCancellation()
      })
    }
    await waitFor(() => expect(screen.queryByTestId('card-slow-cancel')).not.toBeInTheDocument())
  })

  it('shows a retryable error immediately when desktop cancellation fails without deleting data', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'cancel-fails',
      title: '取消失败课程',
      source: 'local',
      filePath: 'D:\\courses\\cancel-fails.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'pending',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    mocks.isTauri = true

    let releasePipeline: () => void = () => undefined
    mocks.runPipeline.mockImplementation(() => new Promise<void>((resolve) => {
      releasePipeline = resolve
    }))
    mocks.tauriInvoke.mockRejectedValue(new Error('取消命令失败'))

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-cancel-fails')
    fireEvent.click(within(card).getByText('取消失败课程'))
    await waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledOnce())
    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    fireEvent.click(within(await screen.findByTestId('delete-confirm')).getByRole('button', { name: '确认删除' }))

    try {
      expect(await within(card).findByRole('alert', {}, { timeout: 300 })).toHaveTextContent('删除失败：取消命令失败')
      await expect(getVideoById(db, 'cancel-fails')).resolves.toMatchObject({ id: 'cancel-fails' })
      expect(within(card).getByRole('button', { name: '确认删除' })).toBeEnabled()
    } finally {
      await act(async () => {
        releasePipeline()
      })
    }
  })

  it('releases the URL handoff owner when cancellation races with publish and deletion fails', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'handoff-cancel',
      title: '交接取消课程',
      source: 'url',
      sourceUrl: 'https://example.com/video',
      filePath: 'D:\\courses\\handoff-cancel.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'failed',
      stage: 'download',
      errorMessage: '此前下载失败',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    mocks.isTauri = true
    mocks.failVideoDeletion = true

    let markPublishStarted: () => void = () => undefined
    let releasePublish: () => void = () => undefined
    const publishStarted = new Promise<void>((resolve) => {
      markPublishStarted = resolve
    })
    mocks.afterPublish = () => new Promise<void>((resolve) => {
      releasePublish = resolve
      markPublishStarted()
    })

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-handoff-cancel')
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '重试导入' }))
      await publishStarted
    })
    await waitFor(async () => expect(await getVideoById(db, 'handoff-cancel')).toMatchObject({
      status: 'pending',
      stage: undefined,
    }))

    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    fireEvent.click(within(await screen.findByTestId('delete-confirm')).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(mocks.tauriInvoke).toHaveBeenCalledWith('cancel_import', { videoId: 'handoff-cancel' }))
    await act(async () => {
      releasePublish()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(await within(card).findByRole('alert')).toHaveTextContent('删除失败：删除事务失败')

    mocks.failVideoDeletion = false
    let releaseRetry: () => void = () => undefined
    mocks.runPipeline.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseRetry = resolve
    }))
    fireEvent.click(within(card).getByText('交接取消课程'))
    await waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledOnce())
    await act(async () => {
      releaseRetry()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })
})
