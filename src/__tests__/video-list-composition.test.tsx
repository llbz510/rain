import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  desktop: false,
  invoke: vi.fn(),
  listen: vi.fn(async () => () => undefined),
  open: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({ isTauri: () => native.desktop, tauriInvoke: native.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open }))
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}))

import App from '@/App'
import { getDb, resetDb } from '@/models/db-singleton'
import { getVideoById, insertVideo, listVideos } from '@/models/database'
import type { Video } from '@/models/types'
import { useRainStore } from '@/store/rain-store'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry, type ModelPoolEntry } from '@/settings/model-pool'

let finishAsr: (result: unknown) => void

function video(id: string, title: string, status: Video['status'], createdAt: number, lastStudiedAt: number): Video {
  return {
    id, title, status, createdAt, lastStudiedAt,
    source: 'local', filePath: `D:\\courses\\${id}.mp4`, thumbnail: '',
    duration: 60, language: 'en', position: 0,
    ...(status === 'failed' ? { stage: 'asr' as const, errorMessage: 'ASR fixture failure' } : {}),
  }
}

function cardIds(): string[] {
  return screen.queryAllByTestId(/^card-/).map((card) => card.dataset.testid!.slice('card-'.length))
}

async function openTask(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: `查看导入任务：${title}` }))
  return screen.findByRole('dialog', { name: `${title}导入任务` })
}

beforeEach(async () => {
  resetDb()
  useRainStore.getState().reset()
  native.desktop = false
  await getDb()
  native.desktop = true
  native.invoke.mockReset()
  native.open.mockReset()
  native.open.mockResolvedValue('D:\\courses\\imported.mp4')
  native.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_whisper_models') return ['D:\\models\\ggml-large-v3.bin']
    if (command === 'start_asr') return new Promise((resolve) => { finishAsr = resolve })
    if (command === 'cancel_import') return undefined
    if (command === 'check_ytdlp_command') return { available: true, version: 'fixture' }
    if (command === 'probe_video_info') return { title: 'Signal Imported', duration: 60, thumbnail: '' }
    if (command === 'generate_thumbnail') return `D:\\rain-app-data\\thumbnails\\${String(args?.videoId)}.jpg`
    if (command === 'import_online_video') return {
      title: 'Signal Online', duration: 60, thumbnail: '', filePath: 'D:\\rain-app-data\\downloads\\online.mp4',
    }
    throw new Error(`Unexpected external command: ${command}`)
  })
  const models: ModelPoolEntry[] = [
    { id: 'asr', alias: 'Whisper', type: 'whisper-local', provider: 'local', modelName: 'large-v3', supportsVision: false },
    { id: 'llm', alias: 'Structuring', type: 'llm', provider: 'fixture', modelName: 'fixture', baseUrl: 'https://example.com/v1', apiKey: 'fixture', supportsVision: false },
  ]
  useRainStore.setState({
    settingsReady: true, settingsError: null, modelPool: models,
    roleAssignment: { asr: 'asr', structuring: 'llm', assistant: 'llm' },
    capabilityRecords: models.map((model, index) => recordCapabilityCheck({
      model: runtimeModelFromPoolEntry(model), role: index === 0 ? 'asr' : 'structuring', ok: true, message: 'fixture',
    })),
    loadRuntimeSettings: async () => undefined,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetDb()
})

describe('AC-VL-04 production App list composition', () => {
  it('keeps three sorts, title search, no-results and real failed-task retry/cancel usable in the same page', async () => {
    const db = await getDb()
    await insertVideo(db, video('pending', 'Signal Zebra', 'pending', 20, 40))
    await insertVideo(db, video('failed', 'Signal Alpha', 'failed', 30, 20))
    await insertVideo(db, video('ready', 'Other Course', 'ready', 10, 50))
    render(<App />)

    await waitFor(() => expect(cardIds()).toEqual(['ready', 'pending', 'failed']))
    const sort = screen.getByRole('combobox', { name: '排序' })
    const search = screen.getByRole('textbox', { name: '搜索视频标题' })
    expect(sort).toHaveValue('lastStudied')
    fireEvent.change(search, { target: { value: '  SIGNAL  ' } })
    await waitFor(() => expect(cardIds()).toEqual(['pending', 'failed']))
    fireEvent.change(sort, { target: { value: 'createdAt' } })
    await waitFor(() => expect(cardIds()).toEqual(['failed', 'pending']))
    fireEvent.change(sort, { target: { value: 'title' } })
    await waitFor(() => expect(cardIds()).toEqual(['failed', 'pending']))

    const pending = await openTask('Signal Zebra')
    expect(within(pending).getByRole('button', { name: '继续导入' })).toBeEnabled()
    expect(native.invoke).not.toHaveBeenCalledWith('start_asr', expect.anything())
    expect(useRainStore.getState().currentPage).toBe('list')
    fireEvent.click(within(pending).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const failed = await openTask('Signal Alpha')
    expect(within(failed).getByRole('alert')).toHaveTextContent('ASR fixture failure')
    fireEvent.click(within(failed).getByRole('button', { name: '重试导入' }))
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('start_asr', expect.objectContaining({ videoId: 'failed' })))
    await waitFor(() => expect(within(failed).getByRole('button', { name: '取消导入' })).toBeEnabled())
    fireEvent.click(within(failed).getByRole('button', { name: '取消导入' }))
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('cancel_import', { videoId: 'failed' }))
    await act(async () => finishAsr([{ id: 'late', text: 'Late result', start_time: 0, end_time: 1 }]))
    await waitFor(async () => expect(await getVideoById(db, 'failed')).toMatchObject({ status: 'cancelled', stage: 'asr' }))
    await waitFor(() => expect(within(failed).getByRole('button', { name: '重试导入' })).toBeEnabled())
    fireEvent.click(within(failed).getByRole('button', { name: '关闭' }))

    const continued = await openTask('Signal Zebra')
    fireEvent.click(within(continued).getByRole('button', { name: '继续导入' }))
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('start_asr', expect.objectContaining({ videoId: 'pending' })))
    fireEvent.click(await within(continued).findByRole('button', { name: '取消导入' }))
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('cancel_import', { videoId: 'pending' }))
    await act(async () => finishAsr([{ id: 'late', text: 'Late result', start_time: 0, end_time: 1 }]))
    await waitFor(async () => expect(await getVideoById(db, 'pending')).toMatchObject({ status: 'cancelled' }))
    fireEvent.click(within(continued).getByRole('button', { name: '关闭' }))

    fireEvent.change(search, { target: { value: 'no matching title' } })
    expect(await screen.findByRole('status')).toHaveTextContent('没有找到匹配的视频')
    expect(cardIds()).toEqual([])
    expect(screen.queryByRole('button', { name: '导入你的第一个视频' })).not.toBeInTheDocument()
    const importButton = screen.getByRole('button', { name: '导入' })
    expect(importButton).toBeEnabled()
    fireEvent.click(importButton)
    expect(screen.getByRole('button', { name: '本地文件' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '在线视频' })).toBeEnabled()
    fireEvent.click(importButton)
    fireEvent.change(search, { target: { value: '' } })
    await waitFor(() => expect(cardIds()).toEqual(['ready', 'failed', 'pending']))
    expect(sort).toHaveValue('title')
    expect(await listVideos(db)).toHaveLength(3)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('uses the same import menu from the empty-library CTA and header, then publishes and cancels an actual local import', async () => {
    const db = await getDb()
    render(<App />)
    const cta = await screen.findByRole('button', { name: '导入你的第一个视频' })
    await waitFor(() => expect(cta).toBeEnabled())
    expect(cardIds()).toEqual([])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(cta)
    expect(screen.getByRole('button', { name: '本地文件' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '在线视频' }))
    const online = await screen.findByRole('dialog', { name: '导入在线视频' })
    fireEvent.change(within(online).getByRole('textbox', { name: '视频 URL' }), { target: { value: '   ' } })
    fireEvent.click(within(online).getByRole('button', { name: '导入' }))
    expect(within(online).getByText('请输入 URL')).toBeInTheDocument()
    expect(await listVideos(db)).toEqual([])
    fireEvent.click(within(online).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '导入' }))
    fireEvent.click(screen.getByRole('button', { name: '本地文件' }))
    await screen.findByRole('button', { name: '查看导入任务：Signal Imported' })
    expect(screen.queryByRole('button', { name: '导入你的第一个视频' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '本地文件' })).not.toBeInTheDocument()
    expect(native.open).toHaveBeenCalledOnce()
    const [imported] = await listVideos(db)
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('start_asr', expect.objectContaining({ videoId: imported.id })))
    expect(await getVideoById(db, imported.id)).toMatchObject({
      title: 'Signal Imported', filePath: 'D:\\courses\\imported.mp4', status: 'processing', stage: 'asr',
    })
    const task = await openTask('Signal Imported')
    fireEvent.click(within(task).getByRole('button', { name: '取消导入' }))
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('cancel_import', { videoId: imported.id }))
    await act(async () => finishAsr([{ id: 'late', text: 'Late result', start_time: 0, end_time: 1 }]))
    await waitFor(async () => expect(await getVideoById(db, imported.id)).toMatchObject({ status: 'cancelled' }))
    await waitFor(() => expect(within(task).getByRole('button', { name: '重试导入' })).toBeEnabled())
    fireEvent.click(within(task).getByRole('button', { name: '关闭' }))
    expect(await listVideos(db)).toHaveLength(1)
    expect(useRainStore.getState().currentPage).toBe('list')
  })

  it('imports from a filtered-empty page without clearing the search or selected sort, then reveals the same tracked URL task', async () => {
    const db = await getDb()
    await insertVideo(db, video('existing', 'Existing Course', 'pending', 1, 0))
    render(<App />)
    await screen.findByTestId('card-existing')
    const sort = screen.getByRole('combobox', { name: '排序' })
    const search = screen.getByRole('textbox', { name: '搜索视频标题' })
    fireEvent.change(sort, { target: { value: 'title' } })
    fireEvent.change(search, { target: { value: 'absent' } })
    expect(await screen.findByRole('status')).toHaveTextContent('没有找到匹配的视频')
    fireEvent.click(screen.getByRole('button', { name: '导入' }))
    fireEvent.click(screen.getByRole('button', { name: '在线视频' }))
    const online = await screen.findByRole('dialog', { name: '导入在线视频' })
    fireEvent.change(within(online).getByRole('textbox', { name: '视频 URL' }), {
      target: { value: '  https://example.com/watch?v=fixture  ' },
    })
    fireEvent.click(within(online).getByRole('button', { name: '导入' }))
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('start_asr', expect.anything()))
    const rows = await listVideos(db)
    const imported = rows.find((row) => row.source === 'url')!
    expect(rows).toHaveLength(2)
    expect(imported).toMatchObject({ title: 'Signal Online', sourceUrl: 'https://example.com/watch?v=fixture', status: 'processing' })
    expect(native.invoke).toHaveBeenCalledWith('import_online_video', {
      videoId: imported.id, sourceUrl: 'https://example.com/watch?v=fixture',
    })
    expect(native.invoke).toHaveBeenCalledWith('start_asr', expect.objectContaining({
      videoId: imported.id, filePath: 'D:\\rain-app-data\\downloads\\online.mp4',
    }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(search).toHaveValue('absent')
    expect(sort).toHaveValue('title')
    expect(cardIds()).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('没有找到匹配的视频')

    fireEvent.change(search, { target: { value: '' } })
    await waitFor(() => expect(cardIds()).toEqual(['existing', imported.id]))
    const task = await openTask('Signal Online')
    fireEvent.click(within(task).getByRole('button', { name: '取消导入' }))
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('cancel_import', { videoId: imported.id }))
    await act(async () => finishAsr([{ id: 'late', text: 'Late result', start_time: 0, end_time: 1 }]))
    await waitFor(async () => expect(await getVideoById(db, imported.id)).toMatchObject({ status: 'cancelled' }))
    expect(await listVideos(db)).toHaveLength(2)
    expect(useRainStore.getState().currentPage).toBe('list')
  })
})
