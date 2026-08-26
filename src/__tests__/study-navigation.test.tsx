import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry, type ModelPoolEntry } from '@/settings/model-pool'
import { useRainStore } from '@/store/rain-store'

const { streamAiChat } = vi.hoisted(() => ({ streamAiChat: vi.fn() }))
vi.mock('@/llm/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/llm/client')>()),
  streamAiChat,
}))

import { StudyInterface } from '@/pages/StudyInterface'

const originalScrollIntoView = Element.prototype.scrollIntoView

const assistantModel: ModelPoolEntry = {
  id: 'assistant',
  alias: 'Study Assistant',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'sk-test-secret',
  modelName: 'assistant-a',
  supportsVision: false,
}

function configureStudy(withAssistant = false) {
  useRainStore.setState({
    currentPage: 'study',
    currentVideoId: 'video-1',
    currentVideoFilePath: 'https://example.test/video.mp4',
    currentVideoTitle: 'Signal course',
    currentVideoLanguage: 'en',
    layoutMode: 'follow',
    playPosition: 1,
    nodeTree: [{
      id: 'paragraph-1',
      videoId: 'video-1',
      parentId: null,
      kind: 'paragraph',
      title: 'Signal strength',
      type: 'concept',
      startTime: 0,
      endTime: 20,
      text: null,
      sortOrder: 0,
    }],
    sentences: [
      { id: 'sentence-1', nodeId: 'paragraph-1', text: 'First sentence.', startTime: 0, endTime: 2, sortOrder: 0 },
      { id: 'sentence-2', nodeId: 'paragraph-1', text: 'Seek to this sentence.', startTime: 12.5, endTime: 14, sortOrder: 1 },
    ],
    modelPool: withAssistant ? [assistantModel] : [],
    roleAssignment: {
      asr: null,
      structuring: null,
      assistant: withAssistant ? assistantModel.id : null,
    },
    capabilityRecords: withAssistant
      ? [recordCapabilityCheck({
          model: runtimeModelFromPoolEntry(assistantModel),
          role: 'assistant',
          ok: true,
          message: 'Text assistant probe passed',
          checkedAt: 100,
        })]
      : [],
  })
}

function configureContainerNavigation(layoutMode: 'follow' | 'mapExpand' = 'follow') {
  configureStudy()
  useRainStore.setState({
    layoutMode,
    playPosition: 3,
    nodeTree: [
      { id: 'chapter-1', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter', type: null, startTime: 0, endTime: 30, text: null, sortOrder: 0 },
      { id: 'section-1', videoId: 'video-1', parentId: 'chapter-1', kind: 'section', title: 'Section', type: null, startTime: 0, endTime: 30, text: null, sortOrder: 0 },
      { id: 'paragraph-1', videoId: 'video-1', parentId: 'section-1', kind: 'paragraph', title: 'Earliest paragraph', type: 'concept', startTime: 12, endTime: 20, text: null, sortOrder: 0 },
      { id: 'paragraph-2', videoId: 'video-1', parentId: 'section-1', kind: 'paragraph', title: 'Later paragraph', type: 'example', startTime: 20, endTime: 30, text: null, sortOrder: 1 },
    ],
    sentences: [
      { id: 'sentence-1', nodeId: 'paragraph-1', text: 'Earliest sentence.', startTime: 12, endTime: 20, sortOrder: 0 },
      { id: 'sentence-2', nodeId: 'paragraph-2', text: 'Later sentence.', startTime: 20, endTime: 30, sortOrder: 1 },
    ],
  })
}

beforeEach(() => {
  useRainStore.getState().reset()
  streamAiChat.mockReset()
})

afterEach(() => {
  cleanup()
  act(() => useRainStore.getState().reset())
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView
  } else {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  }
})

describe('AC-ST-02 real study navigation', () => {
  it('double-clicking a sentence seeks the Store and media without changing playback state', async () => {
    configureStudy()
    render(<StudyInterface />)
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    video.currentTime = 1
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    const play = vi.spyOn(video, 'play')
    const pause = vi.spyOn(video, 'pause')

    fireEvent.doubleClick(screen.getByText('Seek to this sentence.'))

    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(12.5)
      expect(video.currentTime).toBe(12.5)
    })
    expect(video.paused).toBe(false)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
  })

  it('clicking a trusted assistant citation seeks the Store and media', async () => {
    streamAiChat.mockImplementation((_messages, _settings, callbacks) => {
      callbacks.onToken('Review [sentence:sentence-2 @ 12.500-14.000].')
      callbacks.onDone()
      return vi.fn()
    })
    configureStudy(true)
    render(<StudyInterface />)
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    video.currentTime = 1
    const play = vi.spyOn(video, 'play')
    const pause = vi.spyOn(video, 'pause')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Where is the later sentence?' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('button', { name: 'sentence:sentence-2 @ 12.500-14.000' }))

    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(12.5)
      expect(video.currentTime).toBe(12.5)
    })
    expect(video.paused).toBe(true)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
  })
})

describe('AC-ST-03 playback synchronization', () => {
  it('drives sentence highlight, catalog state and follow scrolling from video timeupdate', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    configureStudy()
    useRainStore.setState({
      nodeTree: [
        { id: 'chapter-1', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter', type: null, startTime: 0, endTime: 20, text: null, sortOrder: 0 },
        { id: 'section-1', videoId: 'video-1', parentId: 'chapter-1', kind: 'section', title: 'Section', type: null, startTime: 0, endTime: 20, text: null, sortOrder: 0 },
        { id: 'paragraph-1', videoId: 'video-1', parentId: 'section-1', kind: 'paragraph', title: 'First paragraph', type: 'concept', startTime: 0, endTime: 10, text: null, sortOrder: 0 },
        { id: 'paragraph-2', videoId: 'video-1', parentId: 'section-1', kind: 'paragraph', title: 'Second paragraph', type: 'example', startTime: 10, endTime: 20, text: null, sortOrder: 1 },
      ],
      sentences: [
        { id: 'sentence-1', nodeId: 'paragraph-1', text: 'First sentence.', startTime: 0, endTime: 10, sortOrder: 0 },
        { id: 'sentence-2', nodeId: 'paragraph-2', text: 'Second sentence.', startTime: 10, endTime: 20, sortOrder: 1 },
      ],
    })
    render(<StudyInterface />)
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    const textZone = within(screen.getByTestId('text-zone'))

    fireEvent.play(video)
    expect(useRainStore.getState().isPlaying).toBe(true)
    scrollIntoView.mockClear()
    video.currentTime = 10
    fireEvent.timeUpdate(video)

    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(10)
      expect(textZone.getByText('First sentence.')).toHaveAttribute('data-highlighted', 'false')
      expect(textZone.getByText('Second sentence.')).toHaveAttribute('data-highlighted', 'true')
      expect(screen.getByTestId('progress-indicator-paragraph-1')).toHaveTextContent('■')
      expect(screen.getByTestId('progress-indicator-paragraph-2')).toHaveTextContent('▶')
      expect(scrollIntoView).toHaveBeenCalled()
    })

    fireEvent.pause(video)
    expect(useRainStore.getState().isPlaying).toBe(false)
    scrollIntoView.mockClear()
    video.currentTime = 5
    fireEvent.timeUpdate(video)
    await waitFor(() => {
      expect(textZone.getByText('First sentence.')).toHaveAttribute('data-highlighted', 'true')
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('AC-ST-04 directory navigation', () => {
  it('keeps single-click selection separate from a container double-click jump', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    configureContainerNavigation()
    render(<StudyInterface />)
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    video.currentTime = 3
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    const play = vi.spyOn(video, 'play')
    const pause = vi.spyOn(video, 'pause')
    const chapter = within(screen.getByTestId('side-tree')).getByText('Chapter')

    fireEvent.click(chapter)
    expect(useRainStore.getState()).toMatchObject({
      selectedNodeId: 'chapter-1',
      playPosition: 3,
    })
    expect(video.currentTime).toBe(3)

    scrollIntoView.mockClear()
    fireEvent.doubleClick(chapter)

    await waitFor(() => {
      expect(useRainStore.getState()).toMatchObject({
        selectedNodeId: 'chapter-1',
        playPosition: 12,
      })
      expect(video.currentTime).toBe(12)
      expect(scrollIntoView.mock.instances).toContain(screen.getByTestId('paragraph-paragraph-1'))
    })
    expect(video.paused).toBe(false)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
  })

  it('shows a container earliest-leaf preview after a diagram double click', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    configureContainerNavigation('mapExpand')
    render(<StudyInterface />)

    fireEvent.doubleClick(within(screen.getByTestId('diagram-zone')).getByText('Chapter'))

    await waitFor(() => {
      expect(useRainStore.getState()).toMatchObject({
        selectedNodeId: 'chapter-1',
        playPosition: 12,
      })
      expect(screen.getByTestId('progress-indicator-chapter-1')).toHaveAttribute('data-selected', 'true')
      expect(scrollIntoView.mock.instances).toContain(screen.getByTestId('progress-indicator-chapter-1'))
      expect(screen.getByTestId('text-preview')).toHaveTextContent('Earliest paragraph')
      expect(screen.getByTestId('text-preview')).toHaveTextContent('Earliest sentence.')
    })
  })
})
