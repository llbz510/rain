import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import {
  getNotesByVideoId,
  insertNote,
  insertNodes,
  insertSentences,
  insertVideo,
} from '@/models/database'
import { asMemoryDatabase } from '@/models/database-adapter'
import type { StreamCallbacks } from '@/llm/types'
import type { Node, Note, Sentence, Video } from '@/models/types'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry, type ModelPoolEntry } from '@/settings/model-pool'
import { StudyInterface } from '@/pages/StudyInterface'
import { useRainStore } from '@/store/rain-store'
import { NotesPanel } from '@/ui/components/notes'

const { streamAiChat } = vi.hoisted(() => ({ streamAiChat: vi.fn() }))
vi.mock('@/llm/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/llm/client')>()),
  streamAiChat,
}))

const video: Video = {
  id: 'notes-video',
  title: 'Notes lecture',
  source: 'local',
  filePath: 'D:\\courses\\notes.mp4',
  thumbnail: '',
  duration: 60,
  language: 'en',
  status: 'ready',
  createdAt: 1,
  position: 0,
  lastStudiedAt: 1,
}

const nodes: Node[] = [
  {
    id: 'notes-chapter',
    videoId: video.id,
    parentId: null,
    kind: 'chapter',
    title: 'Chapter',
    type: null,
    startTime: 0,
    endTime: 60,
    text: null,
    sortOrder: 0,
  },
  {
    id: 'notes-paragraph',
    videoId: video.id,
    parentId: 'notes-chapter',
    kind: 'paragraph',
    title: 'Important paragraph',
    type: 'concept',
    startTime: 4,
    endTime: 20,
    text: null,
    sortOrder: 0,
  },
]

const sentences: Sentence[] = [
  {
    id: 'notes-sentence-1',
    nodeId: 'notes-paragraph',
    text: 'First sentence.',
    startTime: 4,
    endTime: 10,
    sortOrder: 0,
  },
  {
    id: 'notes-sentence-2',
    nodeId: 'notes-paragraph',
    text: 'Second sentence.',
    startTime: 10,
    endTime: 20,
    sortOrder: 1,
  },
]

const existingNote: Note = {
  id: 'notes-existing-note',
  videoId: video.id,
  content: 'Original saved note.',
  source: 'user',
  sentenceIds: [],
  createdAt: 2,
  sortOrder: 0,
}

const streamAssistantModel: ModelPoolEntry = {
  id: 'notes-stream-assistant',
  alias: 'Notes Stream Assistant',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'sk-test-secret',
  modelName: 'assistant-a',
  supportsVision: false,
}

async function seedStudyVideo(): Promise<void> {
  const db = await getDb()
  await insertVideo(db, video)
  await insertNodes(db, nodes)
  await insertSentences(db, sentences)
}

function configureStreamAssistant(): void {
  useRainStore.setState({
    modelPool: [streamAssistantModel],
    roleAssignment: { asr: null, structuring: null, assistant: streamAssistantModel.id },
    capabilityRecords: [recordCapabilityCheck({
      model: runtimeModelFromPoolEntry(streamAssistantModel),
      role: 'assistant',
      ok: true,
      message: 'Text assistant probe passed',
      checkedAt: 100,
    })],
  })
}

beforeEach(() => {
  resetDb()
  useRainStore.getState().reset()
  streamAiChat.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useRainStore.getState().reset()
  resetDb()
})

describe('AC-ST-06 persisted notes workflow', () => {
  it('creates a whole-paragraph excerpt and reloads it from the database', async () => {
    await seedStudyVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    const firstView = render(<StudyInterface />)

    fireEvent.click(screen.getByRole('button', { name: '摘注' }))

    await waitFor(async () => {
      expect(await getNotesByVideoId(await getDb(), video.id)).toEqual([
        expect.objectContaining({
          videoId: video.id,
          content: 'First sentence. Second sentence.',
          source: 'excerpt',
          sentenceIds: ['notes-sentence-1', 'notes-sentence-2'],
          sortOrder: 0,
        }),
      ])
      expect(useRainStore.getState().notes).toHaveLength(1)
    })

    firstView.unmount()
    useRainStore.getState().unloadVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    render(<StudyInterface />)
    fireEvent.click(screen.getByRole('button', { name: '随记' }))

    expect(await screen.findByDisplayValue('First sentence. Second sentence.')).toBeInTheDocument()
  })

  it('persists a free note and its edited content across a reload', async () => {
    await seedStudyVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    const firstView = render(<StudyInterface />)
    fireEvent.click(screen.getByRole('button', { name: '随记' }))

    const editor = screen.getByRole('textbox', { name: '新随记内容' })
    fireEvent.change(editor, { target: { value: 'A durable free note.' } })
    fireEvent.click(screen.getByRole('button', { name: '保存新随记' }))

    await waitFor(async () => {
      expect(await getNotesByVideoId(await getDb(), video.id)).toEqual([
        expect.objectContaining({
          videoId: video.id,
          content: 'A durable free note.',
          source: 'user',
          sentenceIds: [],
          sortOrder: 0,
        }),
      ])
    })

    firstView.unmount()
    useRainStore.getState().unloadVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    render(<StudyInterface />)
    fireEvent.click(screen.getByRole('button', { name: '随记' }))

    expect(await screen.findByDisplayValue('A durable free note.')).toBeInTheDocument()
  })

  it('reopens an excerpt citation and seeks the matching sentence without changing playback', async () => {
    await seedStudyVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    const firstView = render(<StudyInterface />)
    fireEvent.click(screen.getByRole('button', { name: '摘注' }))
    await waitFor(async () => {
      expect(await getNotesByVideoId(await getDb(), video.id)).toHaveLength(1)
    })

    firstView.unmount()
    useRainStore.getState().unloadVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    render(<StudyInterface />)
    const player = screen.getByTestId('video-player') as HTMLVideoElement
    player.currentTime = 0
    Object.defineProperty(player, 'paused', { configurable: true, value: false })
    const play = vi.spyOn(player, 'play')
    const pause = vi.spyOn(player, 'pause')
    fireEvent.click(screen.getByRole('button', { name: '随记' }))

    fireEvent.click(screen.getByRole('button', { name: '引用:notes-sentence-2' }))

    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(10)
      expect(player.currentTime).toBe(10)
    })
    expect(player.paused).toBe(false)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
  })
})

describe('AC-SU-03 unsaved Note draft across right-panel Tabs', () => {
  it('keeps an existing Note draft through an initially hidden AI Tab without writing until explicit save', async () => {
    const user = userEvent.setup()
    await seedStudyVideo()
    const database = asMemoryDatabase(await getDb())
    await insertNote(database, existingNote)
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })

    const write = vi.spyOn(database, 'replaceTable')
    render(<StudyInterface />)

    const notesPanel = screen.getByTestId('notes-panel')
    const notesTabPanel = notesPanel.parentElement
    expect(notesTabPanel).toHaveAttribute('hidden')
    expect(screen.queryByRole('textbox', { name: '随记内容' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    expect(write).not.toHaveBeenCalled()

    const hiddenEditor = screen.getByRole('textbox', { name: '随记内容', hidden: true })
    const hiddenSave = screen.getByRole('button', { name: '保存', hidden: true })
    const chatInput = screen.getByPlaceholderText('输入消息...')
    chatInput.focus()
    await user.tab()
    expect(notesTabPanel?.contains(document.activeElement)).toBe(false)
    expect(document.activeElement).not.toBe(hiddenEditor)
    expect(document.activeElement).not.toBe(hiddenSave)

    fireEvent.click(screen.getByRole('button', { name: '随记' }))
    const editor = screen.getByRole('textbox', { name: '随记内容' })
    expect(editor).toHaveValue('Original saved note.')
    expect(write).not.toHaveBeenCalled()

    fireEvent.change(editor, { target: { value: 'Saved note.' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(async () => {
      expect(await getNotesByVideoId(database, video.id)).toEqual([
        expect.objectContaining({ content: 'Saved note.' }),
      ])
      expect(write).toHaveBeenCalledTimes(1)
    })
    write.mockClear()

    fireEvent.change(editor, { target: { value: 'Unsaved draft.' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect(notesTabPanel).toHaveAttribute('hidden')
    expect(screen.queryByRole('textbox', { name: '随记内容' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    expect(write).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '随记' }))
    expect(screen.getByRole('textbox', { name: '随记内容' })).toHaveValue('Unsaved draft.')
    expect(write).not.toHaveBeenCalled()
    expect(await getNotesByVideoId(database, video.id)).toEqual([
      expect.objectContaining({ content: 'Saved note.' }),
    ])

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(async () => {
      expect(write).toHaveBeenCalledTimes(1)
      expect(await getNotesByVideoId(database, video.id)).toEqual([
        expect.objectContaining({ content: 'Unsaved draft.' }),
      ])
    })
  })
})

describe('AC-SU-03 unsent AI draft across right-panel Tabs', () => {
  it('keeps an unsent ChatInput draft while its hidden panel stays inert and unfocusable', async () => {
    const user = userEvent.setup()
    await seedStudyVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    useRainStore.setState({ aiPanelState: 'notes' })
    render(<StudyInterface />)

    const hiddenAiInput = screen.getByPlaceholderText('输入消息...')
    const aiTabPanel = hiddenAiInput.closest('[hidden]')
    expect(aiTabPanel).not.toBeNull()
    if (!aiTabPanel) throw new Error('AI tab panel should exist')
    expect(hiddenAiInput).toHaveAttribute('aria-label', 'AI 输入')
    expect(aiTabPanel).toHaveAttribute('hidden')
    expect(screen.queryByRole('textbox', { name: 'AI 输入' })).not.toBeInTheDocument()
    expect(streamAiChat).not.toHaveBeenCalled()

    const notesTab = screen.getByRole('button', { name: '随记' })
    notesTab.focus()
    await user.tab()
    expect(aiTabPanel?.contains(document.activeElement)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect(aiTabPanel).toHaveStyle({ display: 'flex', flexDirection: 'column' })
    const aiInput = screen.getByRole('textbox', { name: 'AI 输入' })
    fireEvent.change(aiInput, { target: { value: 'Keep this unsent AI draft.' } })
    expect(streamAiChat).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '随记' }))
    expect(aiTabPanel).toHaveAttribute('hidden')
    expect(screen.queryByRole('textbox', { name: 'AI 输入' })).not.toBeInTheDocument()
    expect(streamAiChat).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect(screen.getByRole('textbox', { name: 'AI 输入' })).toHaveValue('Keep this unsent AI draft.')
    expect(streamAiChat).not.toHaveBeenCalled()
  })
})

describe('AC-SU-03 active assistant stream across right-panel Tabs', () => {
  it('keeps each visible request alive through Tabs, preserves its tokens and completion, and still ignores late tokens after stop', async () => {
    await seedStudyVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    configureStreamAssistant()

    const streams: StreamCallbacks[] = []
    const cleanups: Array<() => void> = []
    streamAiChat.mockImplementation((_messages, _settings, callbacks: StreamCallbacks) => {
      streams.push(callbacks)
      const cleanup = vi.fn()
      cleanups.push(cleanup)
      return cleanup
    })
    render(<StudyInterface />)

    const input = screen.getByRole('textbox', { name: 'AI 输入' })
    fireEvent.change(input, { target: { value: 'First question' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(streamAiChat).toHaveBeenCalledTimes(1)
    expect(streams).toHaveLength(1)

    act(() => streams[0].onToken('First '))
    fireEvent.click(screen.getByRole('button', { name: '随记' }))
    expect(cleanups[0]).not.toHaveBeenCalled()
    expect(streamAiChat).toHaveBeenCalledTimes(1)
    act(() => {
      streams[0].onToken('answer.')
      streams[0].onDone('First answer.')
    })

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect(screen.getByTestId('message-assistant')).toHaveTextContent('First answer.')
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument()

    const returnedInput = screen.getByRole('textbox', { name: 'AI 输入' })
    fireEvent.change(returnedInput, { target: { value: 'Second question' } })
    fireEvent.keyDown(returnedInput, { key: 'Enter' })
    expect(streamAiChat).toHaveBeenCalledTimes(2)
    expect(streams).toHaveLength(2)
    expect(cleanups).toHaveLength(2)
    expect(cleanups[0]).not.toHaveBeenCalled()
    act(() => {
      streams[0].onToken(' stale first token')
      streams[0].onDone('First answer.')
    })
    expect(screen.getAllByTestId('message-assistant')[0]).toHaveTextContent(/^First answer\.$/)
    expect(screen.getAllByTestId('message-assistant')[1]).toHaveTextContent(/^$/)
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()
    act(() => streams[1].onToken('Stop-ready answer.'))

    fireEvent.click(screen.getByRole('button', { name: '随记' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    expect(screen.getAllByTestId('message-assistant').at(-1)).toHaveTextContent('Stop-ready answer.')
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(cleanups[0]).not.toHaveBeenCalled()
    expect(cleanups[1]).toHaveBeenCalledTimes(1)
    act(() => streams[1].onToken(' late token'))
    expect(screen.getAllByTestId('message-assistant').at(-1)).toHaveTextContent('Stop-ready answer.')
  })
})

describe('AC-SU-07 zero-note composer persistence', () => {
  it('submits the untrimmed draft only once while a create is pending, then clears it on success', async () => {
    const user = userEvent.setup()
    let resolveCreate: ((created: boolean) => void) | undefined
    const onCreateNote = vi.fn(() => new Promise<boolean>((resolve) => { resolveCreate = resolve }))
    render(<NotesPanel onCreateNote={onCreateNote} />)

    const composer = screen.getByRole('textbox', { name: '新随记内容' })
    fireEvent.change(composer, { target: { value: '  preserve these spaces  ' } })
    const save = screen.getByRole('button', { name: '保存新随记' })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(onCreateNote).toHaveBeenCalledTimes(1)
    expect(onCreateNote).toHaveBeenCalledWith('  preserve these spaces  ')
    expect(save).toBeDisabled()
    await user.type(composer, 'must not replace the pending draft')
    expect(composer).toHaveValue('  preserve these spaces  ')

    resolveCreate?.(true)
    await waitFor(() => expect(composer).toHaveValue(''))
    expect(save).not.toBeDisabled()
  })

  it('keeps the draft after a failed explicit create', async () => {
    const onCreateNote = vi.fn().mockResolvedValue(false)
    render(<NotesPanel onCreateNote={onCreateNote} />)

    const composer = screen.getByRole('textbox', { name: '新随记内容' })
    fireEvent.change(composer, { target: { value: 'keep after failure' } })
    fireEvent.click(screen.getByRole('button', { name: '保存新随记' }))

    await waitFor(() => expect(onCreateNote).toHaveBeenCalledWith('keep after failure'))
    expect(composer).toHaveValue('keep after failure')
  })
})
