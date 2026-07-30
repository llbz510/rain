import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProgressPayload } from '@/architecture/events'

let progressCallback: ((payload: ProgressPayload) => void) | undefined
const { runPipeline } = vi.hoisted(() => ({ runPipeline: vi.fn() }))

vi.mock('@/pipeline/progress-listener', () => ({
  listenProgress: vi.fn(async (callback: (payload: ProgressPayload) => void) => {
    progressCallback = callback
  }),
  unlistenProgress: vi.fn(),
}))

vi.mock('@/pipeline/pipeline-orchestrator', () => ({ runPipeline }))

import { VideoListPage } from '@/pages/VideoListPage'
import { getDb, resetDb } from '@/models/db-singleton'
import { getVideoById, insertVideo, transitionVideoImportState } from '@/models/database'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry, type ModelPoolEntry } from '@/settings/model-pool'
import { useRainStore } from '@/store/rain-store'

function failedVideo(id: string) {
  return {
    id,
    title: 'Signal',
    source: 'local' as const,
    filePath: 'D:\\signal.mp4',
    thumbnail: '',
    duration: 120,
    language: '',
    status: 'failed' as const,
    stage: 'asr' as const,
    errorMessage: '上次导入失败',
    createdAt: 1,
    position: 0,
    lastStudiedAt: 1,
  }
}

beforeEach(() => {
  resetDb()
  progressCallback = undefined
  runPipeline.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  useRainStore.getState().reset()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetDb()
})

function configureRunnableSettings() {
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
      id: 'qwen',
      alias: 'Qwen',
      type: 'llm',
      provider: 'dashscope',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'sk-test-secret',
      modelName: 'qwen3.5-omni-flash',
      supportsVision: true,
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
    roleAssignment: { asr: 'asr', structuring: 'qwen', assistant: 'qwen' },
    loadRuntimeSettings: async () => undefined,
  })
}

async function openTaskDialog(videoId: string) {
  const card = await screen.findByTestId(`card-${videoId}`)
  fireEvent.click(within(card).getByText('Signal'))
  return screen.findByRole('dialog', { name: 'Signal导入任务' })
}

describe('VideoListPage import recovery UI', () => {
  it('updates the card and dialog percentage from a desktop progress event after explicit retry', async () => {
    const db = await getDb()
    await insertVideo(db, failedVideo('progress-video'))
    configureRunnableSettings()
    runPipeline.mockImplementation(() => new Promise<void>(() => undefined))

    render(<VideoListPage />)
    const dialog = await openTaskDialog('progress-video')
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))
    await waitFor(() => expect(runPipeline).toHaveBeenCalledOnce())

    act(() => progressCallback?.({
      videoId: 'progress-video',
      stage: 'asr_transcription',
      blockCurrent: 0,
      blockTotal: 0,
      percent: 47,
      retrying: false,
    }))

    await waitFor(() => {
      expect(screen.getByTestId('import-status-progress-video')).toHaveTextContent('Whisper 转写 · 47%')
      expect(dialog).toHaveTextContent('Whisper 转写 · 47%')
    })
  })

  it('persists a capability failure only after the user explicitly retries', async () => {
    const db = await getDb()
    await insertVideo(db, failedVideo('capability-video'))
    configureRunnableSettings()
    useRainStore.setState({ capabilityRecords: [] })

    render(<VideoListPage />)
    const dialog = await openTaskDialog('capability-video')
    expect(await getVideoById(db, 'capability-video')).toMatchObject({
      errorMessage: '上次导入失败',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))

    await waitFor(async () => {
      expect(await getVideoById(db, 'capability-video')).toMatchObject({
        status: 'failed',
        errorMessage: expect.stringMatching(/^ASR 模型“Whisper”不可用：/),
      })
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/^ASR 模型“Whisper”不可用：/)
    expect(runPipeline).not.toHaveBeenCalled()
  })

  it('persists a settings failure and keeps an explicit retry available', async () => {
    const db = await getDb()
    await insertVideo(db, failedVideo('settings-video'))
    useRainStore.setState({
      settingsReady: false,
      settingsError: 'Qwen 配置不可用',
      loadRuntimeSettings: async () => undefined,
    })

    render(<VideoListPage />)
    const dialog = await openTaskDialog('settings-video')
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))

    await waitFor(async () => {
      expect(await getVideoById(db, 'settings-video')).toMatchObject({
        status: 'failed',
        stage: 'asr',
        errorMessage: 'Qwen 配置不可用',
      })
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Qwen 配置不可用')
    expect(within(dialog).getByRole('button', { name: '重试导入' })).toBeInTheDocument()
    expect(runPipeline).not.toHaveBeenCalled()
  })

  it('keeps a pipeline-persisted cancellation instead of overwriting it as failed', async () => {
    const db = await getDb()
    await insertVideo(db, failedVideo('cancelled-video'))
    configureRunnableSettings()
    runPipeline.mockImplementation(async (inputVideo, _settings, _callbacks, inputDb) => {
      await transitionVideoImportState(
        inputDb,
        inputVideo.id,
        { status: 'failed', stage: 'asr' },
        { status: 'cancelled', stage: 'asr', errorMessage: 'ASR cancelled' },
      )
      const error = new Error('ASR cancelled')
      error.name = 'AbortError'
      throw error
    })

    render(<VideoListPage />)
    const dialog = await openTaskDialog('cancelled-video')
    fireEvent.click(within(dialog).getByRole('button', { name: '重试导入' }))

    await waitFor(async () => {
      expect(await getVideoById(db, 'cancelled-video')).toMatchObject({
        status: 'cancelled',
        stage: 'asr',
        errorMessage: 'ASR cancelled',
      })
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('ASR cancelled')
    expect(within(dialog).getByRole('button', { name: '重试导入' })).toBeInTheDocument()
  })
})
