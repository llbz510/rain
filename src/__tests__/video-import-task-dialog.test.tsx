import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProgressPayload } from '@/architecture/events'
import type { Video } from '@/models/types'

const mocks = vi.hoisted(() => ({
  isTauri: false,
  progressCallback: undefined as ((payload: ProgressPayload) => void) | undefined,
  runPipeline: vi.fn(),
  tauriInvoke: vi.fn(),
}))

vi.mock('@/pipeline/progress-listener', () => ({
  listenProgress: vi.fn(async (callback: (payload: ProgressPayload) => void) => {
    mocks.progressCallback = callback
  }),
  unlistenProgress: vi.fn(),
}))

vi.mock('@/pipeline/pipeline-orchestrator', () => ({
  runPipeline: mocks.runPipeline,
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => mocks.isTauri,
  tauriInvoke: mocks.tauriInvoke,
}))

import { VideoListPage } from '@/pages/VideoListPage'
import App from '@/App'
import { getDb, resetDb } from '@/models/db-singleton'
import { getVideoById, insertVideo, listVideos, transitionVideoImportState } from '@/models/database'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import {
  runtimeModelFromPoolEntry,
  type ModelPoolEntry,
} from '@/settings/model-pool'
import { useRainStore } from '@/store/rain-store'

function configureRunnableSettings(): void {
  const modelPool: ModelPoolEntry[] = [
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
      provider: 'test',
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      modelName: 'test-model',
      supportsVision: false,
    },
  ]
  useRainStore.setState({
    settingsReady: true,
    settingsError: null,
    modelPool,
    capabilityRecords: [
      recordCapabilityCheck({
        model: runtimeModelFromPoolEntry(modelPool[0]),
        role: 'asr',
        ok: true,
        message: 'ASR probe passed',
      }),
      recordCapabilityCheck({
        model: runtimeModelFromPoolEntry(modelPool[1]),
        role: 'structuring',
        ok: true,
        message: 'Structuring probe passed',
      }),
    ],
    roleAssignment: {
      asr: 'asr',
      structuring: 'structuring',
      assistant: 'structuring',
    },
    loadRuntimeSettings: async () => undefined,
  })
}

beforeEach(() => {
  resetDb()
  useRainStore.getState().reset()
  mocks.isTauri = false
  mocks.progressCallback = undefined
  mocks.runPipeline.mockReset()
  mocks.runPipeline.mockResolvedValue(undefined)
  mocks.tauriInvoke.mockReset()
  mocks.tauriInvoke.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetDb()
})

describe('AC-LV-19 and AC-LV-20 import task details', () => {
  it('opens and closes every non-ready state without starting a task or changing SQLite', async () => {
    const db = await getDb()
    const records: Video[] = [
      {
        id: 'pending-task',
        title: '等待课程',
        source: 'local',
        filePath: 'D:\\courses\\pending.mp4',
        thumbnail: '',
        duration: 60,
        language: 'zh',
        status: 'pending',
        createdAt: 1,
        position: 0,
        lastStudiedAt: 1,
      },
      {
        id: 'processing-task',
        title: '处理课程',
        source: 'local',
        filePath: 'D:\\courses\\processing.mp4',
        thumbnail: '',
        duration: 60,
        language: 'zh',
        status: 'processing',
        stage: 'asr',
        createdAt: 2,
        position: 0,
        lastStudiedAt: 2,
      },
      {
        id: 'failed-state-task',
        title: '失败状态课程',
        source: 'local',
        filePath: 'D:\\courses\\failed-state.mp4',
        thumbnail: '',
        duration: 60,
        language: 'zh',
        status: 'failed',
        stage: 'stage2',
        errorMessage: '结构化失败',
        createdAt: 3,
        position: 0,
        lastStudiedAt: 3,
      },
      {
        id: 'cancelled-task',
        title: '取消课程',
        source: 'local',
        filePath: 'D:\\courses\\cancelled.mp4',
        thumbnail: '',
        duration: 60,
        language: 'zh',
        status: 'cancelled',
        stage: 'asr',
        errorMessage: '用户已取消',
        createdAt: 4,
        position: 0,
        lastStudiedAt: 4,
      },
    ]
    for (const record of records) await insertVideo(db, record)
    configureRunnableSettings()

    render(<VideoListPage />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    for (const record of records) {
      const before = await getVideoById(db, record.id)
      const card = await screen.findByTestId(`card-${record.id}`)
      await act(async () => {
        fireEvent.click(within(card).getByText(record.title))
      })
      const dialog = await screen.findByRole('dialog', { name: `${record.title}导入任务` })

      expect(mocks.runPipeline).not.toHaveBeenCalled()
      expect(await getVideoById(db, record.id)).toEqual(before)

      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
      })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(await getVideoById(db, record.id)).toEqual(before)
    }
  })

  it('continues one restart-stale pending record only after an explicit single-flight action', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'stale-pending-task',
      title: '等待继续课程',
      source: 'local',
      filePath: 'D:\\courses\\stale-pending.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'pending',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    let finishPipeline: () => void = () => undefined
    const pipelineGate = new Promise<void>((resolve) => {
      finishPipeline = resolve
    })
    let pipelineSignal: AbortSignal | undefined
    mocks.runPipeline.mockImplementation(async (
      inputVideo,
      _settings,
      callbacks,
      inputDb,
      _asrModel,
      options,
    ) => {
      pipelineSignal = options.signal
      await transitionVideoImportState(
        inputDb,
        inputVideo.id,
        { status: 'pending', stage: null },
        { status: 'processing', stage: 'asr' },
      )
      callbacks.onProgress('asr', 25)
      await pipelineGate
      await transitionVideoImportState(
        inputDb,
        inputVideo.id,
        { status: 'processing', stage: 'asr' },
        {
          status: 'failed',
          stage: 'asr',
          errorMessage: '确定性测试终态',
        },
      )
    })

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-stale-pending-task')
    fireEvent.click(within(card).getByText('等待继续课程'))
    let dialog = await screen.findByRole('dialog', { name: '等待继续课程导入任务' })

    expect(mocks.runPipeline).not.toHaveBeenCalled()
    expect(await getVideoById(db, 'stale-pending-task')).toMatchObject({
      status: 'pending',
      stage: undefined,
    })

    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.runPipeline).not.toHaveBeenCalled()
    expect(await getVideoById(db, 'stale-pending-task')).toMatchObject({
      status: 'pending',
      stage: undefined,
    })

    fireEvent.click(within(card).getByText('等待继续课程'))
    dialog = await screen.findByRole('dialog', { name: '等待继续课程导入任务' })
    const continueButton = within(dialog).getByRole('button', { name: '继续导入' })
    act(() => {
      continueButton.click()
      continueButton.click()
    })

    await waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledOnce())
    await waitFor(() => expect(dialog).toHaveTextContent('Whisper 转写 · 25%'))
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect(pipelineSignal?.aborted).toBe(false)

    await act(async () => {
      finishPipeline()
      await pipelineGate
    })
    await waitFor(async () => expect(await getVideoById(db, 'stale-pending-task')).toMatchObject({
      status: 'failed',
      stage: 'asr',
      errorMessage: '确定性测试终态',
    }))
    expect((await listVideos(db, 'createdAt')).map((video) => video.id)).toEqual([
      'stale-pending-task',
    ])
    expect(mocks.runPipeline).toHaveBeenCalledOnce()
  })

  it('opens a failed task without retrying it or changing its persisted failure', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'failed-task',
      title: '失败课程',
      source: 'local',
      filePath: 'D:\\courses\\failed.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'failed',
      stage: 'stage2',
      errorMessage: '结构化服务暂时不可用',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-failed-task')
    fireEvent.click(screen.getByText('失败课程'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.runPipeline).not.toHaveBeenCalled()
    expect(await getVideoById(db, 'failed-task')).toMatchObject({
      status: 'failed',
      stage: 'stage2',
      errorMessage: '结构化服务暂时不可用',
    })
    expect(await screen.findByRole('dialog', { name: '失败课程导入任务' })).toHaveTextContent(
      '结构化服务暂时不可用',
    )
    expect(card).toBeInTheDocument()
  })

  it('starts a failed task only from the explicit dialog retry action', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'retry-task',
      title: '重试课程',
      source: 'local',
      filePath: 'D:\\courses\\retry.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'failed',
      stage: 'asr',
      errorMessage: '上次转写失败',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-retry-task')
    expect(within(card).queryByRole('button', { name: '重试导入' })).not.toBeInTheDocument()

    fireEvent.click(within(card).getByText('重试课程'))
    const dialog = await screen.findByRole('dialog', { name: '重试课程导入任务' })
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))

    await waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledOnce())
  })

  it('offers cancellation only in the dialog after an explicit retry becomes active', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'active-task',
      title: '活动课程',
      source: 'local',
      filePath: 'D:\\courses\\active.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'failed',
      stage: 'asr',
      errorMessage: '上次转写失败',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    let pipelineSignal: AbortSignal | undefined
    mocks.runPipeline.mockImplementation((...args: unknown[]) => {
      pipelineSignal = (args[5] as { signal: AbortSignal }).signal
      return new Promise<void>(() => undefined)
    })

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-active-task')
    fireEvent.click(within(card).getByText('活动课程'))
    const dialog = await screen.findByRole('dialog', { name: '活动课程导入任务' })
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))

    const cancel = await within(dialog).findByRole('button', { name: '取消导入' })
    expect(within(card).queryByRole('button', { name: '取消导入' })).not.toBeInTheDocument()
    fireEvent.click(cancel)

    expect(pipelineSignal?.aborted).toBe(true)
  })

  it('cancels a persisted processing task even when its in-memory owner is gone', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'stale-processing-task',
      title: '重启遗留课程',
      source: 'local',
      filePath: 'D:\\courses\\stale-processing.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'processing',
      stage: 'stage2',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    mocks.isTauri = true

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-stale-processing-task')
    fireEvent.click(within(card).getByText('重启遗留课程'))
    const dialog = await screen.findByRole('dialog', { name: '重启遗留课程导入任务' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消导入' }))

    await waitFor(async () => expect(await getVideoById(db, 'stale-processing-task')).toMatchObject({
      status: 'cancelled',
      stage: 'stage2',
      errorMessage: 'Import cancelled',
    }))
    expect(await within(dialog).findByRole('button', { name: '重试导入' })).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Import cancelled')
    expect(mocks.tauriInvoke).toHaveBeenCalledWith('cancel_import', {
      videoId: 'stale-processing-task',
    })
    expect(mocks.runPipeline).not.toHaveBeenCalled()
  })

  it('keeps the same Pipeline owner cancellable across a settings-page round trip', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'cross-page-task',
      title: '跨页面课程',
      source: 'local',
      filePath: 'D:\\courses\\cross-page.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'failed',
      stage: 'stage2',
      errorMessage: '上次整理失败',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    let pipelineSignal: AbortSignal | undefined
    mocks.runPipeline.mockImplementation(async (
      inputVideo,
      _settings,
      _callbacks,
      inputDb,
      _asrModel,
      options,
    ) => {
      pipelineSignal = options.signal
      await transitionVideoImportState(
        inputDb,
        inputVideo.id,
        { status: 'failed', stage: 'stage2' },
        { status: 'processing', stage: 'stage2' },
      )
      await new Promise<void>(() => undefined)
    })

    render(<App />)
    const firstCard = await screen.findByTestId('card-cross-page-task')
    fireEvent.click(within(firstCard).getByText('跨页面课程'))
    const firstDialog = await screen.findByRole('dialog', { name: '跨页面课程导入任务' })
    fireEvent.click(within(firstDialog).getByRole('button', { name: '重试导入' }))
    await waitFor(async () => expect(await getVideoById(db, 'cross-page-task')).toMatchObject({
      status: 'processing',
      stage: 'stage2',
    }))
    fireEvent.click(within(firstDialog).getByRole('button', { name: '关闭' }))

    act(() => useRainStore.setState({ currentPage: 'settings' }))
    act(() => useRainStore.setState({ currentPage: 'list' }))

    const returnedCard = await screen.findByTestId('card-cross-page-task')
    fireEvent.click(within(returnedCard).getByText('跨页面课程'))
    const returnedDialog = await screen.findByRole('dialog', { name: '跨页面课程导入任务' })
    fireEvent.click(within(returnedDialog).getByRole('button', { name: '取消导入' }))

    expect(pipelineSignal?.aborted).toBe(true)
  })

  it('keeps an active task running when its detail dialog closes', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'background-task',
      title: '后台课程',
      source: 'local',
      filePath: 'D:\\courses\\background.mp4',
      thumbnail: '',
      duration: 60,
      language: 'zh',
      status: 'failed',
      stage: 'asr',
      errorMessage: '上次转写失败',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    let pipelineSignal: AbortSignal | undefined
    let finishPipeline: () => void = () => undefined
    const pipelineGate = new Promise<void>((resolve) => {
      finishPipeline = resolve
    })
    mocks.runPipeline.mockImplementation(async (
      inputVideo,
      _settings,
      _callbacks,
      inputDb,
      _asrModel,
      options,
    ) => {
      pipelineSignal = options.signal
      await pipelineGate
      await transitionVideoImportState(
        inputDb,
        inputVideo.id,
        { status: 'failed', stage: 'asr' },
        { status: 'ready', stage: null },
      )
    })

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-background-task')
    fireEvent.click(within(card).getByText('后台课程'))
    const dialog = await screen.findByRole('dialog', { name: '后台课程导入任务' })
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))
    await waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledOnce())

    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pipelineSignal?.aborted).toBe(false)

    await act(async () => {
      finishPipeline()
      await pipelineGate
    })
    await waitFor(async () => expect(await getVideoById(db, 'background-task')).toMatchObject({
      status: 'ready',
    }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the full live progress payload for an active task', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'progress-task',
      title: '长视频课程',
      source: 'local',
      filePath: 'D:\\courses\\long.mp4',
      thumbnail: '',
      duration: 3600,
      language: 'zh',
      status: 'failed',
      stage: 'stage2',
      errorMessage: '上次整理失败',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    let reportStage2: ((
      stage: string,
      percent: number,
      details?: { blockCurrent: number; blockTotal: number; percent: number; retrying: boolean },
    ) => void) | undefined
    mocks.runPipeline.mockImplementation((...args: unknown[]) => {
      reportStage2 = (args[2] as { onProgress: typeof reportStage2 }).onProgress
      return new Promise<void>(() => undefined)
    })

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-progress-task')
    fireEvent.click(within(card).getByText('长视频课程'))
    const dialog = await screen.findByRole('dialog', { name: '长视频课程导入任务' })
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))
    await waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledOnce())

    act(() => {
      reportStage2?.('stage2', 40, {
        blockCurrent: 2,
        blockTotal: 5,
        percent: 40,
        retrying: true,
      })
    })

    expect(dialog).toHaveTextContent('整理章节 · 40%')
    expect(dialog).toHaveTextContent('分块 2 / 5')
    expect(dialog).toHaveTextContent('正在重试')
  })

  it('shows the real ASR substage instead of collapsing every event to generic transcription', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'asr-detail-task',
      title: '语音课程',
      source: 'local',
      filePath: 'D:\\courses\\speech.mp4',
      thumbnail: '',
      duration: 600,
      language: 'zh',
      status: 'failed',
      stage: 'asr',
      errorMessage: '上次转写失败',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    mocks.runPipeline.mockImplementation(() => new Promise<void>(() => undefined))

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-asr-detail-task')
    fireEvent.click(within(card).getByText('语音课程'))
    const dialog = await screen.findByRole('dialog', { name: '语音课程导入任务' })
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))
    await waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledOnce())

    act(() => {
      mocks.progressCallback?.({
        videoId: 'asr-detail-task',
        stage: 'asr_extraction',
        blockCurrent: 0,
        blockTotal: 0,
        percent: 15,
        retrying: false,
      })
    })

    expect(dialog).toHaveTextContent('提取音频 · 15%')

    act(() => {
      mocks.progressCallback?.({
        videoId: 'asr-detail-task',
        stage: 'asr_transcription',
        blockCurrent: 0,
        blockTotal: 0,
        percent: 35,
        retrying: false,
        backend: 'cpu',
        fallbackReason: 'CUDA worker is not installed',
      })
    })

    expect(dialog).toHaveTextContent('Whisper 后端：CPU')
    expect(dialog).toHaveTextContent('GPU 回退说明：CUDA worker is not installed')
  })

  it('refreshes the same task record to a visible completed state', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'completed-task',
      title: '完成课程',
      source: 'local',
      filePath: 'D:\\courses\\completed.mp4',
      thumbnail: '',
      duration: 600,
      language: 'zh',
      status: 'failed',
      stage: 'stage2',
      errorMessage: '上次整理失败',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    mocks.runPipeline.mockImplementation(async (
      inputVideo,
      _settings,
      _callbacks,
      inputDb,
    ) => {
      await transitionVideoImportState(
        inputDb,
        inputVideo.id,
        { status: 'failed', stage: 'stage2' },
        { status: 'ready', stage: null },
      )
    })

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-completed-task')
    fireEvent.click(within(card).getByText('完成课程'))
    const dialog = await screen.findByRole('dialog', { name: '完成课程导入任务' })
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))

    await waitFor(async () => expect(await getVideoById(db, 'completed-task')).toMatchObject({
      id: 'completed-task',
      status: 'ready',
    }))
    await waitFor(() => expect(dialog).toHaveTextContent('处理完成 · 100%'))
    expect(within(dialog).queryByRole('button', { name: /重试导入|取消导入/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('card-completed-task')).toBeInTheDocument()
  })

  it('replaces a stale failure with the current explicit-retry preflight error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = await getDb()
    await insertVideo(db, {
      id: 'preflight-task',
      title: '能力检查课程',
      source: 'local',
      filePath: 'D:\\courses\\preflight.mp4',
      thumbnail: '',
      duration: 600,
      language: 'zh',
      status: 'failed',
      stage: 'asr',
      errorMessage: '旧错误',
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    })
    configureRunnableSettings()
    useRainStore.setState({ capabilityRecords: [] })

    render(<VideoListPage />)
    const card = await screen.findByTestId('card-preflight-task')
    fireEvent.click(within(card).getByText('能力检查课程'))
    const dialog = await screen.findByRole('dialog', { name: '能力检查课程导入任务' })
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))

    await waitFor(async () => expect(await getVideoById(db, 'preflight-task')).toMatchObject({
      status: 'failed',
      stage: 'asr',
      errorMessage: expect.stringMatching(/^ASR 模型“Whisper”不可用：/),
    }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/^ASR 模型“Whisper”不可用：/)
    expect(mocks.runPipeline).not.toHaveBeenCalled()
  })
})
