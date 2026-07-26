import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  runPipeline: vi.fn(),
  tauriInvoke: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
  tauriInvoke: mocks.tauriInvoke,
}))
vi.mock('@/pipeline/pipeline-orchestrator', () => ({ runPipeline: mocks.runPipeline }))
vi.mock('@/pipeline/progress-listener', () => ({
  listenProgress: vi.fn(async () => undefined),
  unlistenProgress: vi.fn(),
}))

import { VideoListPage } from '@/pages/VideoListPage'
import { getDb, resetDb } from '@/models/db-singleton'
import { listVideos } from '@/models/database'
import { useRainStore } from '@/store/rain-store'

function configureRunnableSettings(): void {
  useRainStore.setState({
    settingsReady: true,
    settingsError: null,
    modelPool: [
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
        apiKey: 'test-key',
        modelName: 'qwen3.5-omni-flash',
        supportsVision: true,
      },
    ],
    roleAssignment: { asr: 'asr', structuring: 'qwen', assistant: 'qwen' },
    loadRuntimeSettings: async () => undefined,
  })
}

beforeEach(() => {
  resetDb()
  useRainStore.getState().reset()
  configureRunnableSettings()
  mocks.open.mockReset()
  mocks.runPipeline.mockReset()
  mocks.tauriInvoke.mockReset()
  mocks.open.mockResolvedValue('D:\\courses\\signal.mp4')
  mocks.runPipeline.mockImplementation(() => new Promise<void>(() => undefined))
  mocks.tauriInvoke.mockImplementation(async (command: string) => {
    if (command === 'probe_video_info') {
      return { title: 'Signal Course', duration: 120, thumbnail: '' }
    }
    if (command === 'generate_thumbnail') {
      return 'D:\\courses\\signal_thumb.jpg'
    }
    throw new Error(`Unexpected Tauri command: ${command}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  resetDb()
})

describe('VideoListPage local import', () => {
  it('persists a pending local video and shows its card before processing completes', async () => {
    render(<VideoListPage />)

    const importButton = screen.getByRole('button', { name: '导入' })
    await waitFor(() => expect(importButton).toBeEnabled())
    fireEvent.click(importButton)
    fireEvent.click(screen.getByRole('button', { name: '本地文件' }))

    expect(await screen.findByText('Signal Course')).toBeInTheDocument()

    const videos = await listVideos(await getDb())
    expect(videos).toHaveLength(1)
    expect(videos[0]).toMatchObject({
      title: 'Signal Course',
      source: 'local',
      filePath: 'D:\\courses\\signal.mp4',
      status: 'pending',
    })
    await waitFor(() => expect(mocks.runPipeline).toHaveBeenCalledTimes(1))
    expect(mocks.tauriInvoke).not.toHaveBeenCalledWith('check_ytdlp_command', expect.anything())
  })
})
