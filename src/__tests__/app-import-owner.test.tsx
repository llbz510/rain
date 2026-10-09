import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProgressPayload } from '@/architecture/events'

const native = vi.hoisted(() => ({
  desktop: false,
  invoke: vi.fn(),
  listen: vi.fn(),
  listeners: new Set<(event: { payload: ProgressPayload }) => void>(),
}))

vi.mock('@/lib/tauri-env', () => ({ isTauri: () => native.desktop, tauriInvoke: native.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }))

import App from '@/App'
import { getDb, resetDb } from '@/models/db-singleton'
import { getVideoById, insertVideo, listVideos, getNodesByVideoId, getSentencesByVideoId } from '@/models/database'
import { useRainStore } from '@/store/rain-store'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry, type ModelPoolEntry } from '@/settings/model-pool'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function seedTask() {
  const db = await getDb()
  await insertVideo(db, {
    id: 'owner-task', title: '后台课程', source: 'local', filePath: 'D:\\courses\\owner.mp4',
    thumbnail: '', duration: 60, language: '', status: 'pending', createdAt: 1,
    position: 0, lastStudiedAt: 1,
  })
  const models: ModelPoolEntry[] = [
    { id: 'asr', alias: 'Whisper', type: 'whisper-local', provider: 'local', modelName: 'large-v3', supportsVision: false },
    { id: 'llm', alias: '整理', type: 'llm', provider: 'test', modelName: 'test', baseUrl: 'https://example.com/v1', apiKey: 'fixture', supportsVision: false },
  ]
  useRainStore.setState({
    settingsReady: true, settingsError: null, modelPool: models,
    roleAssignment: { asr: 'asr', structuring: 'llm', assistant: 'llm' },
    capabilityRecords: models.map((model, i) => recordCapabilityCheck({
      model: runtimeModelFromPoolEntry(model), role: i === 0 ? 'asr' : 'structuring', ok: true, message: 'fixture',
    })),
    loadRuntimeSettings: async () => undefined,
  })
  native.desktop = true
  return db
}

async function openTask() {
  fireEvent.click(within(await screen.findByTestId('card-owner-task')).getByText('后台课程'))
  return screen.findByRole('dialog', { name: '后台课程导入任务' })
}

beforeEach(() => {
  resetDb()
  useRainStore.getState().reset()
  native.desktop = false
  native.invoke.mockReset()
  native.listen.mockReset()
  native.listeners.clear()
  native.listen.mockImplementation(async (_name, listener) => {
    native.listeners.add(listener)
    return () => native.listeners.delete(listener)
  })
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetDb() })

describe('AC-AR-05 application import lifetime', () => {
  it('really unmounts the list while keeping one running task, its progress and cancellation after returning', async () => {
    const db = await seedTask()
    const asr = deferred<unknown>()
    native.invoke.mockImplementation(async (command) => {
      if (command === 'list_whisper_models') return ['D:\\models\\ggml-large-v3.bin']
      if (command === 'start_asr') return asr.promise
      return undefined
    })
    render(<App />)
    const firstCard = await screen.findByTestId('card-owner-task')
    const continueButton = within(await openTask()).getByRole('button', { name: '继续导入' })
    fireEvent.click(continueButton)
    fireEvent.click(continueButton)
    await waitFor(() => expect(native.invoke.mock.calls.filter(([command]) => command === 'start_asr')).toHaveLength(1))

    act(() => useRainStore.getState().setPage('settings'))
    expect(screen.queryByTestId('video-list-page')).not.toBeInTheDocument()
    expect(native.invoke.mock.calls.filter(([command]) => command === 'cancel_import')).toHaveLength(0)
    act(() => native.listeners.forEach((listener) => listener({ payload: {
      videoId: 'owner-task', stage: 'asr_transcription', percent: 47, backend: 'cpu',
      blockCurrent: 0, blockTotal: 0, retrying: false,
    } })))
    act(() => native.listeners.forEach((listener) => listener({ payload: {
      videoId: 'owner-task', stage: 'asr_transcription', percent: 12,
      blockCurrent: 0, blockTotal: 0, retrying: false,
    } })))
    act(() => useRainStore.getState().setPage('list'))
    const returned = await openTask()
    expect(screen.getByTestId('card-owner-task')).not.toBe(firstCard)
    expect(within(returned).getByText(/47%/)).toBeInTheDocument()
    fireEvent.click(within(returned).getByRole('button', { name: '取消导入' }))
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('cancel_import', { videoId: 'owner-task' }))
    await act(async () => asr.resolve([{ id: 'late', text: 'Late ASR', start_time: 0, end_time: 1 }]))
    await waitFor(async () => expect(await getVideoById(db, 'owner-task')).toMatchObject({ status: 'cancelled', stage: 'asr' }))
    expect(native.invoke.mock.calls.filter(([command]) => command === 'start_asr')).toHaveLength(1)
    expect(await listVideos(db)).toHaveLength(1)
    expect(native.listeners.size).toBe(1)
  })

  it('finishes the original pipeline while the list is absent and returns one ready record with its saved content', async () => {
    const db = await seedTask()
    const asr = deferred<unknown>()
    native.invoke.mockImplementation(async (command) => {
      if (command === 'list_whisper_models') return ['D:\\models\\ggml-large-v3.bin']
      if (command === 'start_asr') return asr.promise
      return undefined
    })
    const request = vi.fn(async (_url, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      const input = JSON.parse(body.messages[1].content)
      // The external model stub follows the Stage2 wire protocol; the real
      // client, validation, checkpoint and merge all run below it.
      const prefix = `${input.blockId}:node:`
      const content = {
        blockId: input.blockId,
        nodes: [
          { id: `${prefix}chapter`, parentId: null, kind: 'chapter', title: '后台章节', startSentenceId: 's1', endSentenceId: 's1' },
          { id: `${prefix}section`, parentId: `${prefix}chapter`, kind: 'section', title: '后台小节', startSentenceId: 's1', endSentenceId: 's1' },
          { id: `${prefix}paragraph`, parentId: `${prefix}section`, kind: 'paragraph', title: '后台段落', type: 'concept', startSentenceId: 's1', endSentenceId: 's1' },
        ],
        coveredSentenceIds: ['s1'],
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', request)
    const app = render(<App />)
    fireEvent.click(within(await openTask()).getByRole('button', { name: '继续导入' }))
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('start_asr', expect.objectContaining({ videoId: 'owner-task' })))
    act(() => useRainStore.getState().setPage('settings'))
    expect(screen.queryByTestId('video-list-page')).not.toBeInTheDocument()
    await act(async () => asr.resolve([{ id: 's1', text: 'Original sentence.', start_time: 0, end_time: 1 }]))
    await waitFor(async () => expect(await getVideoById(db, 'owner-task')).toMatchObject({ status: 'ready' }))
    act(() => useRainStore.getState().setPage('list'))
    const card = await screen.findByTestId('card-owner-task')
    expect(within(card).getByRole('button', { name: '打开视频：后台课程' })).toBeInTheDocument()
    expect(within(card).queryByText(/正在处理/)).not.toBeInTheDocument()
    expect(await listVideos(db)).toHaveLength(1)
    expect((await getNodesByVideoId(db, 'owner-task')).map((node) => node.title)).toEqual(['后台章节', '后台小节', '后台段落'])
    expect(await getSentencesByVideoId(db, 'owner-task')).toMatchObject([{ id: 's1', text: 'Original sentence.' }])
    expect(request).toHaveBeenCalledOnce()
    expect(native.invoke.mock.calls.filter(([command]) => command === 'start_asr')).toHaveLength(1)
    expect(native.listeners.size).toBe(1)
    app.unmount()
    expect(native.listeners.size).toBe(0)
  })
})
