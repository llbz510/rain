import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import { getNotesByVideoId, insertNote, insertNodes, insertSentences, insertVideo } from '@/models/database'
import { StudyInterface } from '@/pages/StudyInterface'
import { useRainStore } from '@/store/rain-store'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry, type ModelPoolEntry } from '@/settings/model-pool'

afterEach(() => { cleanup(); useRainStore.getState().reset(); resetDb(); vi.unstubAllGlobals() })

it('AC-SU-03 retains drafts and the real HTTP stream through Tabs without a second request or hidden save', async () => {
  resetDb()
  useRainStore.getState().reset()
  const db = await getDb()
  await insertVideo(db, { id: 'tabs-video', title: 'Tabs', source: 'local', filePath: 'https://media.example.test/tabs.mp4',
    thumbnail: '', duration: 20, language: 'en', status: 'ready', createdAt: 1, position: 6, lastStudiedAt: 1 })
  await insertNodes(db, [{ id: 'tabs-paragraph', videoId: 'tabs-video', parentId: null, kind: 'paragraph', title: 'Tabs paragraph',
    type: 'concept', startTime: 0, endTime: 20, text: null, sortOrder: 0 }])
  await insertSentences(db, [{ id: 'tabs-sentence', nodeId: 'tabs-paragraph', text: 'Tabs context.', startTime: 0, endTime: 20, sortOrder: 0 }])
  await insertNote(db, { id: 'tabs-note', videoId: 'tabs-video', content: 'Saved note', source: 'user', sentenceIds: [], createdAt: 1, sortOrder: 0 })
  expect(await useRainStore.getState().loadVideo('tabs-video')).toEqual({ ok: true })
  const model: ModelPoolEntry = { id: 'tabs-assistant', alias: 'Tabs assistant', type: 'llm', provider: 'custom',
    baseUrl: 'https://assistant.example.test/v1', apiKey: 'controlled-fixture-key', modelName: 'tabs', supportsVision: false }
  useRainStore.setState({ modelPool: [model], roleAssignment: { asr: null, structuring: null, assistant: model.id },
    capabilityRecords: [recordCapabilityCheck({ model: runtimeModelFromPoolEntry(model), role: 'assistant', ok: true,
      message: 'Controlled transport fixture', checkedAt: 1 })] })
  const streams: Array<{ controller: ReadableStreamDefaultController<Uint8Array>; signal: AbortSignal }> = []
  const fetchFixture = vi.fn(async (_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal
    const body = new ReadableStream<Uint8Array>({ start(controller) { streams.push({ controller, signal }) } })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', fetchFixture)
  const token = (text: string) => new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
  render(<StudyInterface />)
  await waitFor(() => expect(screen.getByTestId('study-interface')).toHaveAttribute('aria-busy', 'false'))
  const media = document.querySelector('video')
  expect(media).not.toBeNull()
  fireEvent.click(screen.getByTestId('side-tree').querySelector('[data-selected]')!)
  const selectedNodeId = useRainStore.getState().selectedNodeId
  expect(selectedNodeId).toBe('tabs-paragraph')
  const position = useRainStore.getState().playPosition
  fireEvent.click(screen.getByRole('button', { name: '随记' }))
  const note = screen.getByRole('textbox', { name: '随记内容' })
  fireEvent.change(note, { target: { value: 'Unsaved note draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'AI' }))
  const input = screen.getByRole('textbox', { name: 'AI 输入' })
  fireEvent.change(input, { target: { value: 'Keep the unsent draft' } })
  fireEvent.click(screen.getByRole('button', { name: '随记' }))
  expect(screen.queryByRole('textbox', { name: 'AI 输入' })).not.toBeInTheDocument()
  expect(note).toHaveValue('Unsaved note draft')
  expect(fetchFixture).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'AI' }))
  expect(screen.getByRole('textbox', { name: 'AI 输入' })).toBe(input)
  expect(input).toHaveValue('Keep the unsent draft')
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(streams).toHaveLength(1))
  act(() => streams[0].controller.enqueue(token('Visible')))
  await waitFor(() => expect(screen.getByTestId('message-assistant')).toHaveTextContent('Visible'))
  fireEvent.click(screen.getByRole('button', { name: '随记' }))
  expect(streams[0].signal.aborted).toBe(false)
  act(() => streams[0].controller.enqueue(token(' hidden')))
  await waitFor(() => expect(screen.getByTestId('message-assistant')).toHaveTextContent('Visible hidden'))
  expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument()
  expect(await getNotesByVideoId(db, 'tabs-video')).toEqual([expect.objectContaining({ content: 'Saved note' })])
  fireEvent.click(screen.getByRole('button', { name: 'AI' }))
  expect(screen.getByTestId('message-assistant')).toHaveTextContent('Visible hidden')
  act(() => streams[0].controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')))
  await waitFor(() => expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument())
  expect(fetchFixture).toHaveBeenCalledTimes(1)
  fireEvent.change(input, { target: { value: 'Second request' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(streams).toHaveLength(2))
  act(() => streams[1].controller.enqueue(token('Second')))
  await waitFor(() => expect(screen.getAllByTestId('message-assistant')[1]).toHaveTextContent('Second'))
  fireEvent.click(screen.getByRole('button', { name: '停止' }))
  expect(streams[1].signal.aborted).toBe(true)
  act(() => streams[1].controller.enqueue(token(' late')))
  await act(async () => { await Promise.resolve() })
  expect(screen.getAllByTestId('message-assistant')[1]).toHaveTextContent(/^Second$/)
  expect(document.querySelector('video')).toBe(media)
  expect(useRainStore.getState().playPosition).toBe(position)
  expect(useRainStore.getState().selectedNodeId).toBe(selectedNodeId)
  fireEvent.click(screen.getByRole('button', { name: '随记' }))
  expect(screen.getByRole('textbox', { name: '随记内容' })).toBe(note)
  expect(note).toHaveValue('Unsaved note draft')
  expect(await getNotesByVideoId(db, 'tabs-video')).toEqual([expect.objectContaining({ content: 'Saved note' })])
})
