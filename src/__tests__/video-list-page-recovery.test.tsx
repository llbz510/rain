import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let progressCallback: ((payload: { videoId: string; stage: string; percent: number }) => void) | undefined
const { runPipeline } = vi.hoisted(() => ({ runPipeline: vi.fn() }))
vi.mock('@/pipeline/progress-listener', () => ({ listenProgress: vi.fn(async (callback) => { progressCallback = callback }), unlistenProgress: vi.fn() }))
vi.mock('@/pipeline/pipeline-orchestrator', () => ({ runPipeline }))

import { VideoListPage } from '@/pages/VideoListPage'
import { getDb, resetDb } from '@/models/db-singleton'
import { getVideoById, insertVideo, transitionVideoImportState } from '@/models/database'
import { useRainStore } from '@/store/rain-store'

const video = (id: string) => ({ id, title: 'Signal', source: 'local' as const, filePath: 'D:\\signal.mp4', thumbnail: '', duration: 120, language: '', status: 'pending' as const, createdAt: 1, position: 0, lastStudiedAt: 1 })
beforeEach(() => { resetDb(); progressCallback = undefined; runPipeline.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => undefined); useRainStore.getState().reset() })
afterEach(() => { vi.restoreAllMocks(); resetDb() })
function configureRunnableSettings() { useRainStore.setState({ settingsReady: true, settingsError: null, modelPool: [{ id: 'asr', alias: 'Whisper', type: 'whisper-local', provider: 'local', modelName: 'large-v3', supportsVision: false }, { id: 'qwen', alias: 'Qwen', type: 'llm', provider: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-test-secret', modelName: 'qwen3.5-omni-flash', supportsVision: true }], roleAssignment: { asr: 'asr', structuring: 'qwen', assistant: 'qwen' }, loadRuntimeSettings: async () => undefined }) }

describe('VideoListPage import recovery UI', () => {
  it('updates the card percentage from a desktop progress event', async () => { const db = await getDb(); await insertVideo(db, video('progress-video')); configureRunnableSettings(); runPipeline.mockImplementation(() => new Promise<void>(() => undefined)); render(<VideoListPage />); await screen.findByTestId('card-progress-video'); fireEvent.click(screen.getByText('Signal')); await waitFor(() => expect(runPipeline).toHaveBeenCalled()); act(() => progressCallback!({ videoId: 'progress-video', stage: 'asr_transcription', percent: 47 })); await waitFor(() => expect(screen.getByTestId('import-status-progress-video')).toHaveTextContent('Whisper 转写 · 47%')) })
  it('persists a settings failure and renders its error with Retry', async () => { const db = await getDb(); await insertVideo(db, video('settings-video')); useRainStore.setState({ settingsReady: false, settingsError: 'Qwen 配置不可用', loadRuntimeSettings: async () => undefined }); render(<VideoListPage />); await screen.findByTestId('card-settings-video'); fireEvent.click(screen.getByText('Signal')); await waitFor(async () => expect(await getVideoById(db, 'settings-video')).toMatchObject({ status: 'failed', stage: 'asr', errorMessage: 'Qwen 配置不可用' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Qwen 配置不可用')); expect(screen.getByRole('button', { name: '重试导入' })).toBeInTheDocument(); expect(runPipeline).not.toHaveBeenCalled() })
  it('keeps a pipeline-persisted cancellation instead of overwriting it as failed', async () => { const db = await getDb(); await insertVideo(db, video('cancelled-video')); configureRunnableSettings(); runPipeline.mockImplementation(async (inputVideo, _settings, _callbacks, inputDb) => { await transitionVideoImportState(inputDb, inputVideo.id, { status: 'pending', stage: null }, { status: 'cancelled', stage: 'asr', errorMessage: 'ASR cancelled' }); const error = new Error('ASR cancelled'); error.name = 'AbortError'; throw error }); render(<VideoListPage />); await screen.findByTestId('card-cancelled-video'); fireEvent.click(screen.getByText('Signal')); await new Promise((resolve) => setTimeout(resolve, 0)); expect(await getVideoById(db, 'cancelled-video')).toMatchObject({ status: 'cancelled', stage: 'asr', errorMessage: 'ASR cancelled' }); await waitFor(() => expect(screen.getByRole('button', { name: '重试导入' })).toBeInTheDocument()) })
})
