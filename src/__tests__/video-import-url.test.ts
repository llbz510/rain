import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tauriInvoke: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
  tauriInvoke: mocks.tauriInvoke,
}))
vi.mock('@/pipeline/progress-listener', () => ({
  listenProgress: vi.fn(async () => undefined),
  unlistenProgress: vi.fn(),
}))

import { createDatabase, getVideoById, insertVideo, listVideos } from '@/models/database'
import type { Video } from '@/models/types'
import { getDb, resetDb } from '@/models/db-singleton'
import { VideoListPage } from '@/pages/VideoListPage'
import { createVideoImportController } from '@/pipeline/video-import-controller'
import { useRainStore } from '@/store/rain-store'

const SOURCE_URL = 'https://videos.example.test/watch/lesson-1'
const LOCAL_PATH = 'D:\\Rain\\online-videos\\v_100\\video.mp4'

function successfulImport(filePath = LOCAL_PATH) {
  return {
    title: 'Signals Lesson',
    duration: 120,
    thumbnail: 'https://img.example.test/lesson.jpg',
    filePath,
  }
}

function persistedUrlVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'v_100',
    title: 'Signals Lesson',
    source: 'url',
    sourceUrl: SOURCE_URL,
    thumbnail: '',
    duration: 0,
    language: '',
    status: 'cancelled',
    stage: 'download',
    errorMessage: 'Online video download cancelled',
    createdAt: 100,
    position: 0,
    lastStudiedAt: 100,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.tauriInvoke.mockReset()
  resetDb()
  useRainStore.getState().reset()
})

afterEach(() => {
  resetDb()
})

describe('AC-LV-17 online URL import handoff', () => {
  it('keeps one tracked download record and attaches the local file before Pipeline handoff', async () => {
    const db = await createDatabase()
    const onProgress = vi.fn()
    const loadRuntimeSettings = vi.fn(() => new Promise<never>(() => undefined))
    let finishDownload!: (result: ReturnType<typeof successfulImport>) => void
    const downloadResult = new Promise<ReturnType<typeof successfulImport>>((resolve) => {
      finishDownload = resolve
    })

    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') return downloadResult
      throw new Error(`Unexpected Tauri command: ${command}`)
    })

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings,
      onChanged: () => undefined,
      onProgress,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    const importing = controller.importUrl(SOURCE_URL)

    await vi.waitFor(() => {
      expect(mocks.tauriInvoke).toHaveBeenCalledWith('import_online_video', {
        videoId: 'v_100',
        sourceUrl: SOURCE_URL,
      })
    })
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      id: 'v_100',
      source: 'url',
      sourceUrl: SOURCE_URL,
      status: 'processing',
      stage: 'download',
    })
    controller.acceptProgress({
      videoId: 'v_100',
      stage: 'download',
      blockCurrent: 0,
      blockTotal: 0,
      percent: 42,
      retrying: false,
    })
    expect(onProgress).toHaveBeenCalledWith('v_100', {
      stage: 'download',
      detailStage: 'download',
      blockCurrent: 0,
      blockTotal: 0,
      percent: 42,
      retrying: false,
    })
    expect(loadRuntimeSettings).not.toHaveBeenCalled()

    finishDownload(successfulImport())
    const imported = await importing

    expect(imported).toMatchObject({
      id: 'v_100',
      source: 'url',
      sourceUrl: SOURCE_URL,
      filePath: LOCAL_PATH,
      status: 'pending',
    })
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      id: 'v_100',
      sourceUrl: SOURCE_URL,
      filePath: LOCAL_PATH,
      status: 'pending',
    })
    await vi.waitFor(() => expect(loadRuntimeSettings).toHaveBeenCalledOnce())
  })

  it('redacts a credential-bearing source URL from desktop download failures', async () => {
    const db = await createDatabase()
    const secretUrl = `${SOURCE_URL}?token=do-not-leak`
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') {
        throw new Error('download failed because token do-not-leak was rejected')
      }
      throw new Error(`Unexpected Tauri command: ${command}`)
    })

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged: () => undefined,
      onProgress: () => undefined,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    await expect(controller.importUrl(secretUrl)).rejects.not.toThrow(secretUrl)
    const persisted = await getVideoById(db, 'v_100')
    expect(persisted?.errorMessage).toContain('[REDACTED]')
    expect(persisted?.errorMessage).not.toContain(secretUrl)
    expect(persisted?.errorMessage).not.toContain('do-not-leak')
  })

  it('creates the tracked record before metadata probing and fails that record closed', async () => {
    const db = await createDatabase()
    let rejectProbe!: (error: Error) => void
    const probeResult = new Promise<never>((_resolve, reject) => {
      rejectProbe = reject
    })
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') return probeResult
      throw new Error(`Unexpected Tauri command: ${command}`)
    })

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged: () => undefined,
      onProgress: () => undefined,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    const importing = controller.importUrl(SOURCE_URL)
    await vi.waitFor(() => expect(mocks.tauriInvoke).toHaveBeenCalledWith(
      'import_online_video',
      { videoId: 'v_100', sourceUrl: SOURCE_URL },
    ))
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      title: 'videos.example.test',
      status: 'processing',
      stage: 'download',
    })

    rejectProbe(new Error('metadata probe failed'))
    await expect(importing).rejects.toThrow('metadata probe failed')
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      status: 'failed',
      stage: 'download',
      errorMessage: 'metadata probe failed',
    })
  })

  it('fails the initial tracked record closed when publishing it to the page fails', async () => {
    const db = await createDatabase()
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      throw new Error(`Unexpected Tauri command: ${command}`)
    })
    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged: () => {
        throw new Error('initial URL record refresh failed')
      },
      onProgress: () => undefined,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    await expect(controller.importUrl(SOURCE_URL)).rejects.toThrow('initial URL record refresh failed')
    expect(mocks.tauriInvoke).not.toHaveBeenCalledWith('import_online_video', expect.anything())
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      status: 'failed',
      stage: 'download',
      errorMessage: 'initial URL record refresh failed',
    })
  })

  it('uses distinct record IDs for concurrent URL submissions', async () => {
    const db = await createDatabase()
    const downloadResult = new Promise<ReturnType<typeof successfulImport>>(() => undefined)
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') return downloadResult
      throw new Error(`Unexpected Tauri command: ${command}`)
    })
    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged: () => undefined,
      onProgress: () => undefined,
      now: () => 100,
    })

    void controller.importUrl(`${SOURCE_URL}?part=1`)
    void controller.importUrl(`${SOURCE_URL}?part=2`)
    await vi.waitFor(async () => expect(await listVideos(db)).toHaveLength(2))
    const ids = (await listVideos(db)).map((video) => video.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('fails closed on the same tracked record when the desktop download fails', async () => {
    const db = await createDatabase()
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') throw new Error('yt-dlp exited with status 1')
      throw new Error(`Unexpected Tauri command: ${command}`)
    })

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged: () => undefined,
      onProgress: () => undefined,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    await expect(controller.importUrl(SOURCE_URL)).rejects.toThrow('yt-dlp exited with status 1')
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      id: 'v_100',
      sourceUrl: SOURCE_URL,
      status: 'failed',
      stage: 'download',
      errorMessage: 'yt-dlp exited with status 1',
    })
    expect((await getVideoById(db, 'v_100'))?.filePath).toBeUndefined()
  })

  it('cancels the desktop download and persists cancellation on the tracked record', async () => {
    const db = await createDatabase()
    let rejectDownload!: (error: Error) => void
    const downloadResult = new Promise<ReturnType<typeof successfulImport>>((_resolve, reject) => {
      rejectDownload = reject
    })
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') return downloadResult
      if (command === 'cancel_import') {
        rejectDownload(new Error('desktop download cancelled'))
        return undefined
      }
      throw new Error(`Unexpected Tauri command: ${command}`)
    })

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged: () => undefined,
      onProgress: () => undefined,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    const importing = controller.importUrl(SOURCE_URL)
    await vi.waitFor(() => expect(mocks.tauriInvoke).toHaveBeenCalledWith(
      'import_online_video',
      { videoId: 'v_100', sourceUrl: SOURCE_URL },
    ))

    controller.cancel('v_100')

    await expect(importing).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.tauriInvoke).toHaveBeenCalledWith('cancel_import', { videoId: 'v_100' })
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      status: 'cancelled',
      stage: 'download',
      errorMessage: 'Online video download cancelled',
    })
  })

  it('reports cancellation cleanup failure instead of claiming a clean cancellation', async () => {
    const db = await createDatabase()
    const onError = vi.fn()
    let rejectDownload!: (error: Error) => void
    const downloadResult = new Promise<ReturnType<typeof successfulImport>>((_resolve, reject) => {
      rejectDownload = reject
    })
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') return downloadResult
      if (command === 'cancel_import') {
        rejectDownload(new Error('Download cleanup error: partial directory is still locked'))
        return undefined
      }
      throw new Error(`Unexpected Tauri command: ${command}`)
    })
    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged: () => undefined,
      onProgress: () => undefined,
      onError,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    const importing = controller.importUrl(SOURCE_URL)
    await vi.waitFor(() => expect(mocks.tauriInvoke).toHaveBeenCalledWith(
      'import_online_video',
      { videoId: 'v_100', sourceUrl: SOURCE_URL },
    ))
    controller.cancel('v_100')

    await expect(importing).rejects.toThrow('Download cleanup error')
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      status: 'failed',
      stage: 'download',
      errorMessage: 'Download cleanup error: partial directory is still locked',
    })
    expect(onError).toHaveBeenCalledWith('url-import', expect.objectContaining({
      message: 'Download cleanup error: partial directory is still locked',
    }))
  })

  it('does not drop cancellation while the attached file is waiting for Pipeline handoff', async () => {
    const db = await createDatabase()
    let releaseHandoff!: () => void
    const handoffRefresh = new Promise<void>((resolve) => {
      releaseHandoff = resolve
    })
    let changedCount = 0
    const onChanged = vi.fn(() => {
      changedCount += 1
      return changedCount === 2 ? handoffRefresh : undefined
    })
    const loadRuntimeSettings = vi.fn(() => new Promise<never>(() => undefined))
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') return successfulImport()
      if (command === 'cancel_import') return undefined
      throw new Error(`Unexpected Tauri command: ${command}`)
    })

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings,
      onChanged,
      onProgress: () => undefined,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    const importing = controller.importUrl(SOURCE_URL)
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      filePath: LOCAL_PATH,
      status: 'processing',
      stage: 'download',
    })

    controller.cancel('v_100')
    releaseHandoff()

    await expect(importing).rejects.toMatchObject({ name: 'AbortError' })
    expect(loadRuntimeSettings).not.toHaveBeenCalled()
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      filePath: LOCAL_PATH,
      status: 'cancelled',
      stage: 'download',
      errorMessage: 'Online video download cancelled',
    })

    controller.start('v_100')
    await vi.waitFor(() => expect(loadRuntimeSettings).toHaveBeenCalledOnce())
    expect(mocks.tauriInvoke.mock.calls.filter(([command]) => command === 'import_online_video')).toHaveLength(1)
  })

  it('fails the download record closed when the attached-file handoff fails', async () => {
    const db = await createDatabase()
    let changedCount = 0
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') return successfulImport()
      throw new Error(`Unexpected Tauri command: ${command}`)
    })

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged: () => {
        changedCount += 1
        if (changedCount === 2) throw new Error('attached-file handoff failed')
      },
      onProgress: () => undefined,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    await expect(controller.importUrl(SOURCE_URL)).rejects.toThrow('attached-file handoff failed')
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      filePath: LOCAL_PATH,
      status: 'failed',
      stage: 'download',
      errorMessage: 'attached-file handoff failed',
    })
  })

  it('keeps a download Owner while a no-file retry is being published', async () => {
    const db = await createDatabase()
    await insertVideo(db, persistedUrlVideo())
    let releaseRefresh!: () => void
    const retryRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const onChanged = vi.fn(() => retryRefresh)
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'cancel_import') return undefined
      if (command === 'import_online_video') throw new Error('download must not start after retry cancellation')
      throw new Error(`Unexpected Tauri command: ${command}`)
    })
    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged,
      onProgress: () => undefined,
    })

    controller.start('v_100')
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    controller.cancel('v_100')
    releaseRefresh()

    await vi.waitFor(async () => expect(await getVideoById(db, 'v_100')).toMatchObject({
      status: 'cancelled',
      stage: 'download',
    }))
    expect(mocks.tauriInvoke).not.toHaveBeenCalledWith('import_online_video', expect.anything())
  })

  it('fails an attached-file retry closed when publishing it fails', async () => {
    const db = await createDatabase()
    await insertVideo(db, persistedUrlVideo({ filePath: LOCAL_PATH }))
    const loadRuntimeSettings = vi.fn(() => new Promise<never>(() => undefined))
    const controller = createVideoImportController({
      db,
      loadRuntimeSettings,
      onChanged: () => {
        throw new Error('attached retry refresh failed')
      },
      onProgress: () => undefined,
    })

    controller.start('v_100')

    await vi.waitFor(async () => expect(await getVideoById(db, 'v_100')).toMatchObject({
      filePath: LOCAL_PATH,
      status: 'failed',
      stage: 'download',
      errorMessage: 'attached retry refresh failed',
    }))
    expect(loadRuntimeSettings).not.toHaveBeenCalled()
  })

  it('persists scheduler supersession as cancellation instead of a download failure', async () => {
    const db = await createDatabase()
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') {
        throw new Error('Online video download cancelled')
      }
      throw new Error(`Unexpected Tauri command: ${command}`)
    })
    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged: () => undefined,
      onProgress: () => undefined,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    await expect(controller.importUrl(SOURCE_URL)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      status: 'cancelled',
      stage: 'download',
      errorMessage: 'Online video download cancelled',
    })
  })

  it('retries a cancelled download on the same Video record', async () => {
    const db = await createDatabase()
    let rejectFirst!: (error: Error) => void
    let finishRetry!: (result: ReturnType<typeof successfulImport>) => void
    const firstDownload = new Promise<ReturnType<typeof successfulImport>>((_resolve, reject) => {
      rejectFirst = reject
    })
    const retryDownload = new Promise<ReturnType<typeof successfulImport>>((resolve) => {
      finishRetry = resolve
    })
    let downloadCount = 0
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'import_online_video') {
        downloadCount += 1
        return downloadCount === 1 ? firstDownload : retryDownload
      }
      if (command === 'cancel_import') {
        rejectFirst(new Error('desktop download cancelled'))
        return undefined
      }
      throw new Error(`Unexpected Tauri command: ${command}`)
    })

    const controller = createVideoImportController({
      db,
      loadRuntimeSettings: () => new Promise(() => undefined),
      onChanged: () => undefined,
      onProgress: () => undefined,
      now: () => 100,
      createVideoId: () => 'v_100',
    })

    const firstAttempt = controller.importUrl(SOURCE_URL)
    await vi.waitFor(() => expect(downloadCount).toBe(1))
    controller.cancel('v_100')
    await expect(firstAttempt).rejects.toMatchObject({ name: 'AbortError' })

    controller.start('v_100')
    await vi.waitFor(() => expect(downloadCount).toBe(2))
    expect(await getVideoById(db, 'v_100')).toMatchObject({
      status: 'processing',
      stage: 'download',
    })

    finishRetry(successfulImport())
    await vi.waitFor(async () => {
      expect(await getVideoById(db, 'v_100')).toMatchObject({
        filePath: LOCAL_PATH,
        status: 'pending',
      })
    })
    expect(await listVideos(db)).toHaveLength(1)
  })

  it('lets the user start a tracked URL download from the production page', async () => {
    const downloadResult = new Promise<ReturnType<typeof successfulImport>>(() => undefined)
    mocks.tauriInvoke.mockImplementation(async (command: string) => {
      if (command === 'check_ytdlp_command') return { available: true, message: 'yt-dlp available' }
      if (command === 'import_online_video') return downloadResult
      throw new Error(`Unexpected Tauri command: ${command}`)
    })

    render(createElement(VideoListPage))
    const importButton = screen.getByRole('button', { name: '导入' })
    await waitFor(() => expect(importButton).toBeEnabled())
    fireEvent.click(importButton)
    fireEvent.click(screen.getByRole('button', { name: '在线视频' }))

    const dialog = await screen.findByRole('dialog', { name: '导入在线视频' })
    fireEvent.change(within(dialog).getByLabelText('视频 URL'), {
      target: { value: SOURCE_URL },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '导入' }))

    expect(await screen.findByText('videos.example.test')).toBeInTheDocument()
    const videos = await listVideos(await getDb())
    expect(videos).toHaveLength(1)
    expect(videos[0]).toMatchObject({
      source: 'url',
      sourceUrl: SOURCE_URL,
      status: 'processing',
      stage: 'download',
    })
  })
})
