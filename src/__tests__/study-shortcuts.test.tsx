import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import { getNotesByVideoId, insertNodes, insertNote, insertSentences, insertVideo } from '@/models/database'
import type { Node, Note, Sentence, Video } from '@/models/types'
import { StudyInterface } from '@/pages/StudyInterface'
import { useRainStore } from '@/store/rain-store'

const video: Video = {
  id: 'shortcut-video', title: 'Shortcut lecture', source: 'local',
  filePath: 'https://example.test/shortcuts.mp4', thumbnail: '', duration: 30,
  language: 'en', status: 'ready', createdAt: 1, position: 0, lastStudiedAt: 1,
}

const nodes: Node[] = [
  { id: 'paragraph-1', videoId: video.id, parentId: null, kind: 'paragraph', title: 'First paragraph', type: 'concept', startTime: 0, endTime: 10, text: null, sortOrder: 0 },
  { id: 'paragraph-2', videoId: video.id, parentId: null, kind: 'paragraph', title: 'Second paragraph', type: 'example', startTime: 10, endTime: 20, text: null, sortOrder: 1 },
  { id: 'paragraph-3', videoId: video.id, parentId: null, kind: 'paragraph', title: 'Last paragraph', type: 'transition', startTime: 20, endTime: 30, text: null, sortOrder: 2 },
]

const sentences: Sentence[] = nodes.map((node, index) => ({
  id: `sentence-${index + 1}`, nodeId: node.id, text: `Sentence ${index + 1}.`,
  startTime: node.startTime, endTime: node.endTime, sortOrder: index,
}))

const existingNote: Note = {
  id: 'shortcut-note', videoId: video.id, content: 'Existing note.', source: 'user',
  sentenceIds: [], createdAt: 2, sortOrder: 0,
}

const secondNote: Note = {
  id: 'shortcut-note-2', videoId: video.id, content: 'Second existing note.', source: 'user',
  sentenceIds: [], createdAt: 3, sortOrder: 1,
}

const globalCommands: Array<[string, KeyboardEventInit]> = [
  ['1', {}], ['2', {}], ['3', {}], ['`', {}], [' ', {}],
  ['ArrowLeft', {}], ['ArrowRight', {}], ['ArrowLeft', { shiftKey: true }],
  ['ArrowRight', { shiftKey: true }], ['ArrowUp', {}], ['ArrowDown', {}],
  ['n', {}], ['p', {}], ['Tab', {}], ['Delete', {}], ['Backspace', {}],
]

async function seedStudy(notesToInsert: Note[] = [existingNote]) {
  const db = await getDb()
  await insertVideo(db, video)
  await insertNodes(db, nodes)
  await insertSentences(db, sentences)
  for (const note of notesToInsert) await insertNote(db, note)
  expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
}

function key(target: EventTarget, value: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value, ...init })
  let accepted = true
  act(() => {
    accepted = target.dispatchEvent(event)
  })
  return { event, accepted }
}

beforeEach(() => {
  resetDb()
  useRainStore.getState().reset()
})

afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-study-shortcut-fixture]').forEach((element) => element.remove())
  vi.restoreAllMocks()
  useRainStore.getState().reset()
  resetDb()
})

describe('AC-SU-07 production study shortcuts and focus gate', () => {
  it('maps every non-input command to the shared media, selection, preview, layout, and panel facts', async () => {
    await seedStudy()
    render(<StudyInterface />)

    const player = screen.getByTestId('video-player') as HTMLVideoElement
    Object.defineProperty(player, 'paused', { configurable: true, value: true })
    Object.defineProperty(player, 'volume', { configurable: true, writable: true, value: 0.5 })
    Object.defineProperty(player, 'duration', { configurable: true, value: 30 })
    const play = vi.spyOn(player, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(player, 'pause').mockImplementation(() => undefined)

    expect(key(window, '1').accepted).toBe(false)
    expect(useRainStore.getState().layoutMode).toBe('follow')
    expect(key(window, '2').accepted).toBe(false)
    expect(useRainStore.getState().layoutMode).toBe('textExpand')
    expect(key(window, '2').accepted).toBe(false)
    expect(useRainStore.getState().layoutMode).toBe('textExpand')
    expect(key(window, '3').accepted).toBe(false)
    expect(useRainStore.getState().layoutMode).toBe('mapExpand')
    expect(key(window, '1').accepted).toBe(false)
    expect(useRainStore.getState().layoutMode).toBe('follow')

    expect(key(window, ' ').accepted).toBe(false)
    expect(play).toHaveBeenCalledTimes(1)
    Object.defineProperty(player, 'paused', { configurable: true, value: false })
    expect(key(window, ' ').accepted).toBe(false)
    expect(pause).toHaveBeenCalledTimes(1)

    player.currentTime = 12
    expect(key(window, 'ArrowLeft').accepted).toBe(false)
    expect(player.currentTime).toBe(7)
    expect(key(window, 'ArrowRight').accepted).toBe(false)
    expect(player.currentTime).toBe(12)
    expect(key(window, 'ArrowLeft', { shiftKey: true }).accepted).toBe(false)
    expect(player.currentTime).toBe(2)
    expect(key(window, 'ArrowRight', { shiftKey: true }).accepted).toBe(false)
    expect(player.currentTime).toBe(12)
    player.currentTime = 2
    expect(key(window, 'ArrowLeft', { shiftKey: true }).accepted).toBe(false)
    expect(player.currentTime).toBe(0)
    player.currentTime = 29
    expect(key(window, 'ArrowRight', { shiftKey: true }).accepted).toBe(false)
    expect(player.currentTime).toBe(30)
    Object.defineProperty(player, 'duration', { configurable: true, value: Number.NaN })
    player.currentTime = 29
    expect(key(window, 'ArrowRight').accepted).toBe(false)
    expect(player.currentTime).toBe(34)
    expect(key(window, 'ArrowUp').accepted).toBe(false)
    expect(player.volume).toBeCloseTo(0.6)
    expect(key(window, 'ArrowDown').accepted).toBe(false)
    expect(player.volume).toBeCloseTo(0.5)
    player.volume = 0
    expect(key(window, 'ArrowDown').accepted).toBe(false)
    expect(player.volume).toBe(0)
    player.volume = 1
    expect(key(window, 'ArrowUp').accepted).toBe(false)
    expect(player.volume).toBe(1)

    act(() => {
      player.currentTime = 1
      useRainStore.setState({ playPosition: 1 })
    })
    expect(key(window, 'n').accepted).toBe(false)
    await waitFor(() => {
      expect(useRainStore.getState()).toMatchObject({ selectedNodeId: 'paragraph-2', playPosition: 10 })
    })
    expect(key(window, '3').accepted).toBe(false)
    expect(screen.getByTestId('text-preview')).toHaveTextContent('Second paragraph')
    expect(key(window, 'p').accepted).toBe(false)
    await waitFor(() => expect(useRainStore.getState()).toMatchObject({ selectedNodeId: 'paragraph-1', playPosition: 0 }))
    expect(key(window, 'p').accepted).toBe(false)
    expect(useRainStore.getState()).toMatchObject({ selectedNodeId: 'paragraph-1', playPosition: 0 })
    expect(key(window, 'n').accepted).toBe(false)
    expect(key(window, 'n').accepted).toBe(false)
    await waitFor(() => expect(useRainStore.getState()).toMatchObject({ selectedNodeId: 'paragraph-3', playPosition: 20 }))
    expect(key(window, 'n').accepted).toBe(false)
    expect(useRainStore.getState()).toMatchObject({ selectedNodeId: 'paragraph-3', playPosition: 20 })

    expect(key(window, 'Tab').accepted).toBe(false)
    expect(useRainStore.getState().aiPanelState).toBe('ai')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'AI 输入' }))
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(key(window, 'Tab').accepted).toBe(false)
    expect(useRainStore.getState().aiPanelState).toBe('notes')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '随记内容', hidden: true }))
  })

  it('creates an excerpt for the real current paragraph and keeps delete keys inert', async () => {
    await seedStudy()
    render(<StudyInterface />)
    act(() => useRainStore.setState({ playPosition: 12, selectedNodeId: 'paragraph-1', selectionOrigin: 'tree' }))

    expect(key(window, '`').accepted).toBe(false)
    await waitFor(async () => {
      expect(await getNotesByVideoId(await getDb(), video.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'excerpt', content: 'Sentence 2.', sentenceIds: ['sentence-2'] }),
      ]))
    })

    for (const selectionOrigin of ['tree', 'diagram'] as const) {
      act(() => useRainStore.setState({ selectedNodeId: 'paragraph-2', selectionOrigin }))
      const before = useRainStore.getState()
      expect(key(window, 'Delete').accepted).toBe(false)
      expect(key(window, 'Backspace').accepted).toBe(false)
      expect(useRainStore.getState()).toMatchObject({
        selectedNodeId: before.selectedNodeId, playPosition: before.playPosition, nodeTree: before.nodeTree,
      })
    }
  })

  it('blocks every global command from each real editor while preserving ChatInput Enter send and Alt+Enter newline', async () => {
    const user = userEvent.setup()
    await seedStudy()
    render(<StudyInterface />)
    const aiInput = screen.getByRole('textbox', { name: 'AI 输入' })
    const noteTab = screen.getByRole('button', { name: '随记' })

    const assertInputGate = (input: HTMLElement) => {
      ;(input as HTMLElement).focus()
      const before = useRainStore.getState()
      for (const [value, init] of globalCommands) {
        expect(key(input, value, init).accepted).toBe(true)
      }
      expect(useRainStore.getState()).toMatchObject({
        layoutMode: before.layoutMode, playPosition: before.playPosition, selectedNodeId: before.selectedNodeId,
      })
    }

    assertInputGate(aiInput)
    fireEvent.click(noteTab)
    assertInputGate(screen.getByRole('textbox', { name: '随记内容' }))

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    const activeAiInput = screen.getByRole('textbox', { name: 'AI 输入' }) as HTMLTextAreaElement
    await user.click(activeAiInput)
    await user.keyboard('keep')
    activeAiInput.setSelectionRange(2, 2)
    await user.keyboard('{Alt>}{Enter}{/Alt}')
    expect(activeAiInput).toHaveValue('ke\nep')
    expect(activeAiInput.selectionStart).toBe(3)
    expect(activeAiInput.selectionEnd).toBe(3)
    await user.keyboard('newline')
    expect(activeAiInput).toHaveValue('ke\nnewlineep')

    for (const modifiers of [
      { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
      { altKey: true, ctrlKey: true }, { altKey: true, metaKey: true }, { altKey: true, shiftKey: true },
      { ctrlKey: true, metaKey: true }, { ctrlKey: true, shiftKey: true }, { metaKey: true, shiftKey: true },
      { altKey: true, ctrlKey: true, metaKey: true }, { altKey: true, ctrlKey: true, shiftKey: true },
      { altKey: true, metaKey: true, shiftKey: true }, { ctrlKey: true, metaKey: true, shiftKey: true },
      { altKey: true, ctrlKey: true, metaKey: true, shiftKey: true },
    ]) {
      const before = activeAiInput.value
      expect(key(activeAiInput, 'Enter', modifiers).accepted).toBe(true)
      expect(activeAiInput).toHaveValue(before)
    }
    const composingBefore = activeAiInput.value
    expect(key(activeAiInput, 'Enter', { altKey: true, isComposing: true }).accepted).toBe(true)
    expect(activeAiInput).toHaveValue(composingBefore)
    await user.clear(activeAiInput)
    await user.type(activeAiInput, 'send me{Enter}')
    await waitFor(() => {
      expect(screen.getByTestId('message-user')).toHaveTextContent('send me')
      expect(screen.getByTestId('message-assistant')).toHaveTextContent('请先在设置中配置')
    })
  })

  it('keeps generic native editing targets as focus-policy fixtures without claiming they are Study production controls', async () => {
    await seedStudy()
    render(<StudyInterface />)
    const input = document.body.appendChild(document.createElement('input'))
    input.dataset.studyShortcutFixture = 'true'
    const select = document.body.appendChild(document.createElement('select'))
    select.dataset.studyShortcutFixture = 'true'
    select.innerHTML = '<option>fixture</option>'
    const editable = document.body.appendChild(document.createElement('div'))
    editable.dataset.studyShortcutFixture = 'true'
    editable.contentEditable = 'true'
    const plaintext = document.body.appendChild(document.createElement('div'))
    plaintext.dataset.studyShortcutFixture = 'true'
    plaintext.setAttribute('contenteditable', 'plaintext-only')
    const inherited = document.body.appendChild(document.createElement('div'))
    inherited.dataset.studyShortcutFixture = 'true'
    inherited.setAttribute('contenteditable', 'true')
    const inheritedChild = inherited.appendChild(document.createElement('span'))
    inheritedChild.tabIndex = 0
    const explicitlyFalse = document.body.appendChild(document.createElement('div'))
    explicitlyFalse.dataset.studyShortcutFixture = 'true'
    explicitlyFalse.setAttribute('contenteditable', 'false')
    explicitlyFalse.tabIndex = 0

    for (const target of [input, select, editable, plaintext, inheritedChild]) {
      target.focus()
      for (const [value, init] of globalCommands) {
        expect(key(target, value, init).accepted).toBe(true)
      }
    }
    explicitlyFalse.focus()
    expect(key(explicitlyFalse, '1').accepted).toBe(false)
    expect(useRainStore.getState().layoutMode).toBe('follow')
  })

  it('leaves Ctrl, Meta, Alt, and non-arrow Shift combinations to the platform without executing a Study command', async () => {
    await seedStudy()
    render(<StudyInterface />)
    const target = screen.getByTestId('study-interface')
    const player = screen.getByTestId('video-player') as HTMLVideoElement
    Object.defineProperty(player, 'paused', { configurable: true, value: true })
    Object.defineProperty(player, 'volume', { configurable: true, writable: true, value: 0.5 })
    player.currentTime = 12
    const play = vi.spyOn(player, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(player, 'pause').mockImplementation(() => undefined)
    const before = useRainStore.getState()
    const beforeNotes = await getNotesByVideoId(await getDb(), video.id)
    const beforeMedia = { currentTime: player.currentTime, volume: player.volume }
    const modifiers: KeyboardEventInit[] = [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]

    for (const modifier of modifiers) {
      for (const [value, init] of globalCommands) {
        expect(key(target, value, { ...init, ...modifier }).accepted).toBe(true)
      }
    }
    for (const [value, init] of globalCommands.filter(([value]) => value !== 'ArrowLeft' && value !== 'ArrowRight')) {
      expect(key(target, value, { ...init, shiftKey: true }).accepted).toBe(true)
    }
    expect(useRainStore.getState()).toMatchObject({
      layoutMode: before.layoutMode,
      playPosition: before.playPosition,
      selectedNodeId: before.selectedNodeId,
      selectionOrigin: before.selectionOrigin,
      aiPanelState: before.aiPanelState,
      isPlaying: before.isPlaying,
    })
    expect(player.currentTime).toBe(beforeMedia.currentTime)
    expect(player.volume).toBe(beforeMedia.volume)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(await getNotesByVideoId(await getDb(), video.id)).toEqual(beforeNotes)
  })

  it('handles Tab from focusable production and generic focus targets, and focuses a zero-note composer without implicit persistence', async () => {
    await seedStudy([])
    render(<StudyInterface />)
    const notesTab = screen.getByRole('button', { name: '随记' })
    const link = document.body.appendChild(document.createElement('a'))
    link.href = '#shortcut-fixture'
    link.dataset.studyShortcutFixture = 'true'
    const tabStop = document.body.appendChild(document.createElement('div'))
    tabStop.tabIndex = 0
    tabStop.dataset.studyShortcutFixture = 'true'

    notesTab.focus()
    expect(key(notesTab, 'Tab').accepted).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'AI 输入' }))
    ;(document.activeElement as HTMLElement).blur()
    link.focus()
    expect(key(link, 'Tab').accepted).toBe(false)
    const composer = screen.getByRole('textbox', { name: '新随记内容', hidden: true })
    expect(document.activeElement).toBe(composer)
    expect(await getNotesByVideoId(await getDb(), video.id)).toEqual([])
    const beforeComposerCommands = useRainStore.getState()
    for (const [value, init] of globalCommands) {
      expect(key(composer, value, init).accepted).toBe(true)
    }
    expect(useRainStore.getState()).toMatchObject({
      layoutMode: beforeComposerCommands.layoutMode,
      playPosition: beforeComposerCommands.playPosition,
      selectedNodeId: beforeComposerCommands.selectedNodeId,
    })
    fireEvent.change(composer, { target: { value: 'Only explicit save persists.' } })
    expect(await getNotesByVideoId(await getDb(), video.id)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '保存新随记' }))
    await waitFor(async () => expect(await getNotesByVideoId(await getDb(), video.id)).toEqual([
      expect.objectContaining({ source: 'user', content: 'Only explicit save persists.' }),
    ]))

    ;(document.activeElement as HTMLElement).blur()
    tabStop.focus()
    expect(key(tabStop, 'Tab').accepted).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'AI 输入' }))
  })

  it('uses the first current Note editor as the single deterministic Notes focus owner across reorder and removal', async () => {
    await seedStudy([existingNote, secondNote])
    render(<StudyInterface />)
    const enterAndToggleToNotes = () => {
      expect(key(window, 'Tab').accepted).toBe(false)
      ;(document.activeElement as HTMLElement).blur()
      expect(key(window, 'Tab').accepted).toBe(false)
    }

    enterAndToggleToNotes()
    expect(document.activeElement).toBe(screen.getAllByRole('textbox', { name: '随记内容', hidden: true })[0])
    act(() => useRainStore.setState({ notes: [secondNote, existingNote] }))
    ;(document.activeElement as HTMLElement).blur()
    expect(key(window, 'Tab').accepted).toBe(false)
    ;(document.activeElement as HTMLElement).blur()
    expect(key(window, 'Tab').accepted).toBe(false)
    expect(document.activeElement).toBe(screen.getAllByRole('textbox', { name: '随记内容', hidden: true })[0])
    expect(document.activeElement).toHaveValue('Second existing note.')
    act(() => useRainStore.setState({ notes: [existingNote] }))
    ;(document.activeElement as HTMLElement).blur()
    expect(key(window, 'Tab').accepted).toBe(false)
    ;(document.activeElement as HTMLElement).blur()
    expect(key(window, 'Tab').accepted).toBe(false)
    expect(document.activeElement).toHaveValue('Existing note.')
  })
})
