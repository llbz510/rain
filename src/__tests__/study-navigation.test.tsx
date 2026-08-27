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

function configureTwoRowCatalog() {
  configureStudy()
  useRainStore.setState({
    nodeTree: [
      { id: 'chapter-1', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter one', type: null, startTime: 1, endTime: 30, text: null, sortOrder: 0 },
      { id: 'section-1', videoId: 'video-1', parentId: 'chapter-1', kind: 'section', title: 'Section one', type: null, startTime: 5, endTime: 30, text: null, sortOrder: 0 },
      { id: 'paragraph-1', videoId: 'video-1', parentId: 'section-1', kind: 'paragraph', title: 'Paragraph one', type: 'concept', startTime: 12, endTime: 20, text: null, sortOrder: 0 },
      { id: 'paragraph-2', videoId: 'video-1', parentId: 'section-1', kind: 'paragraph', title: 'Paragraph two', type: 'example', startTime: 20, endTime: 30, text: null, sortOrder: 1 },
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

describe('AC-SU-01 two-row study catalog', () => {
  it('keeps chapter and section above paragraphs in horizontal no-wrap rows and seeks through the production page', () => {
    configureTwoRowCatalog()
    render(<StudyInterface />)

    const catalog = screen.getByTestId('catalog-bar')
    const structureRow = catalog.querySelector<HTMLDivElement>('[data-catalog-row="structure"]')
    const paragraphRow = catalog.querySelector<HTMLDivElement>('[data-catalog-row="paragraph"]')
    const structureScrollRow = structureRow?.querySelector<HTMLDivElement>('[data-catalog-scroll-row="structure"]')
    const paragraphScrollRow = paragraphRow?.querySelector<HTMLDivElement>('[data-catalog-scroll-row="paragraph"]')

    expect(catalog.children[0]).toBe(structureRow)
    expect(catalog.children[1]).toBe(paragraphRow)
    expect(structureScrollRow).toHaveStyle({ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto' })
    expect(paragraphScrollRow).toHaveStyle({ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto' })
    const chapter = within(structureRow!).getByText('Chapter one')
    const section = within(structureRow!).getByText('Section one')
    const firstParagraph = within(paragraphRow!).getByText('Paragraph one')
    const secondParagraph = within(paragraphRow!).getByText('Paragraph two')
    for (const node of [chapter, section, firstParagraph, secondParagraph]) {
      expect(node).toHaveStyle({ flex: '0 0 auto', whiteSpace: 'nowrap' })
    }

    fireEvent.click(chapter)
    expect(useRainStore.getState().playPosition).toBe(1)
    fireEvent.click(section)
    expect(useRainStore.getState().playPosition).toBe(5)
    fireEvent.click(firstParagraph)
    expect(useRainStore.getState().playPosition).toBe(12)
  })

  it('follows the current structure and paragraph items while playing, but preserves manual position changes after pause', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    configureStudy()
    useRainStore.setState({
      nodeTree: [
        { id: 'chapter-1', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter one', type: null, startTime: 0, endTime: 10, text: null, sortOrder: 0 },
        { id: 'paragraph-1', videoId: 'video-1', parentId: 'chapter-1', kind: 'paragraph', title: 'Paragraph one', type: 'concept', startTime: 0, endTime: 10, text: null, sortOrder: 0 },
        { id: 'chapter-2', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter two', type: null, startTime: 10, endTime: 20, text: null, sortOrder: 1 },
        { id: 'section-2', videoId: 'video-1', parentId: 'chapter-2', kind: 'section', title: 'Section two', type: null, startTime: 10, endTime: 20, text: null, sortOrder: 0 },
        { id: 'paragraph-2', videoId: 'video-1', parentId: 'section-2', kind: 'paragraph', title: 'Paragraph two', type: 'example', startTime: 10, endTime: 20, text: null, sortOrder: 1 },
        { id: 'chapter-3', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter three', type: null, startTime: 20, endTime: 30, text: null, sortOrder: 2 },
        { id: 'paragraph-3', videoId: 'video-1', parentId: 'chapter-3', kind: 'paragraph', title: 'Paragraph three', type: 'transition', startTime: 20, endTime: 30, text: null, sortOrder: 2 },
      ],
    })
    render(<StudyInterface />)

    const catalog = screen.getByTestId('catalog-bar')
    const structureRow = catalog.querySelector<HTMLDivElement>('[data-catalog-row="structure"]')!
    const paragraphRow = catalog.querySelector<HTMLDivElement>('[data-catalog-row="paragraph"]')!
    const chapterOne = within(structureRow).getByText('Chapter one')
    const sectionTwo = within(structureRow).getByText('Section two')
    const chapterThree = within(structureRow).getByText('Chapter three')
    const paragraphTwo = within(paragraphRow).getByText('Paragraph two')
    const paragraphThree = within(paragraphRow).getByText('Paragraph three')
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    const expectCenteredCatalogCalls = (...nodes: Element[]) => {
      expect(nodes.map((node) => scrollIntoView.mock.calls[scrollIntoView.mock.instances.indexOf(node)])).toEqual(
        nodes.map(() => [{ block: 'nearest', inline: 'center' }]),
      )
    }

    fireEvent.play(video)
    scrollIntoView.mockClear()
    video.currentTime = 10
    fireEvent.timeUpdate(video)

    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(10)
      expect(scrollIntoView.mock.instances).toEqual(expect.arrayContaining([sectionTwo, paragraphTwo]))
    })
    expectCenteredCatalogCalls(sectionTwo, paragraphTwo)

    scrollIntoView.mockClear()
    video.currentTime = 20
    fireEvent.timeUpdate(video)
    await waitFor(() => {
      expect(scrollIntoView.mock.instances).toEqual(expect.arrayContaining([chapterThree, paragraphThree]))
    })
    expectCenteredCatalogCalls(chapterThree, paragraphThree)

    fireEvent.pause(video)
    scrollIntoView.mockClear()
    video.currentTime = 10
    fireEvent.timeUpdate(video)

    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(10)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()

    fireEvent.click(chapterOne)
    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(0)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()

    fireEvent.play(video)
    await waitFor(() => {
      expect(scrollIntoView.mock.instances).toEqual(expect.arrayContaining([chapterOne, within(paragraphRow).getByText('Paragraph one')]))
    })
    expectCenteredCatalogCalls(chapterOne, within(paragraphRow).getByText('Paragraph one'))
  })

  it('does not throw when the browser does not provide scrollIntoView', () => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    configureTwoRowCatalog()
    render(<StudyInterface />)
    const video = screen.getByTestId('video-player') as HTMLVideoElement

    expect(() => {
      fireEvent.play(video)
      video.currentTime = 12
      fireEvent.timeUpdate(video)
    }).not.toThrow()
  })

  it('shows directional, non-interactive edge fades from each production row scroll geometry', async () => {
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    const originalScrollLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollLeft')
    const widths = { structure: 300, paragraph: 300 }
    const positions = { structure: 0, paragraph: 0 }
    const geometryReads = { structure: 0, paragraph: 0 }
    const rowKey = (element: HTMLElement) => element.dataset.catalogScrollRow as keyof typeof widths | undefined
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        const key = rowKey(this)
        if (key) geometryReads[key] += 1
        return key ? 100 : originalClientWidth?.get?.call(this) ?? 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        const key = rowKey(this)
        if (key) geometryReads[key] += 1
        return key ? widths[key] : originalScrollWidth?.get?.call(this) ?? 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get() {
        const key = rowKey(this)
        return key ? positions[key] : originalScrollLeft?.get?.call(this) ?? 0
      },
      set(value: number) {
        const key = rowKey(this)
        if (key) positions[key] = value
      },
    })

    try {
      configureTwoRowCatalog()
      useRainStore.setState({
        nodeTree: [...useRainStore.getState().nodeTree,
          { id: 'chapter-2', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter two', type: null, startTime: 30, endTime: 60, text: null, sortOrder: 1 },
          { id: 'section-2', videoId: 'video-1', parentId: 'chapter-2', kind: 'section', title: 'Section two', type: null, startTime: 30, endTime: 60, text: null, sortOrder: 0 },
          { id: 'paragraph-3', videoId: 'video-1', parentId: 'section-2', kind: 'paragraph', title: 'Paragraph three', type: 'transition', startTime: 30, endTime: 40, text: null, sortOrder: 0 },
          { id: 'paragraph-4', videoId: 'video-1', parentId: 'section-2', kind: 'paragraph', title: 'Paragraph four', type: 'concept', startTime: 40, endTime: 50, text: null, sortOrder: 1 },
        ],
      })
      render(<StudyInterface />)
      const catalog = screen.getByTestId('catalog-bar')
      const structureRow = catalog.querySelector<HTMLElement>('[data-catalog-scroll-row="structure"]')!
      const paragraphRow = catalog.querySelector<HTMLElement>('[data-catalog-scroll-row="paragraph"]')!

      expect(structureRow).toHaveAttribute('data-catalog-scroll-row', 'structure')
      expect(structureRow.parentElement).toHaveAttribute('data-catalog-row', 'structure')
      expect(paragraphRow).toHaveAttribute('data-catalog-scroll-row', 'paragraph')
      expect(paragraphRow.parentElement).toHaveAttribute('data-catalog-row', 'paragraph')

      await waitFor(() => {
        expect(screen.queryByTestId('catalog-fade-left-structure')).not.toBeInTheDocument()
        expect(screen.getByTestId('catalog-fade-right-structure')).toHaveAttribute('aria-hidden', 'true')
        expect(screen.queryByTestId('catalog-fade-left-paragraph')).not.toBeInTheDocument()
        expect(screen.getByTestId('catalog-fade-right-paragraph')).toHaveAttribute('aria-hidden', 'true')
      })
      expect(screen.getByTestId('catalog-fade-right-structure')).toHaveStyle({ pointerEvents: 'none' })
      expect(screen.getByTestId('catalog-fade-right-structure').getAttribute('style')).toContain('linear-gradient(to left, var(--color-bg), transparent)')
      expect(screen.getByTestId('catalog-fade-right-paragraph').getAttribute('style')).toContain('linear-gradient(to left, var(--color-bg), transparent)')

      positions.structure = 100
      positions.paragraph = 100
      fireEvent.scroll(structureRow)
      fireEvent.scroll(paragraphRow)
      await waitFor(() => {
        expect(screen.getByTestId('catalog-fade-left-structure')).toBeInTheDocument()
        expect(screen.getByTestId('catalog-fade-right-structure')).toBeInTheDocument()
        expect(screen.getByTestId('catalog-fade-left-paragraph')).toBeInTheDocument()
        expect(screen.getByTestId('catalog-fade-right-paragraph')).toBeInTheDocument()
      })

      positions.structure = 0.25
      positions.paragraph = 0.25
      fireEvent.scroll(structureRow)
      fireEvent.scroll(paragraphRow)
      await waitFor(() => {
        expect(screen.queryByTestId('catalog-fade-left-structure')).not.toBeInTheDocument()
        expect(screen.getByTestId('catalog-fade-right-structure')).toBeInTheDocument()
        expect(screen.queryByTestId('catalog-fade-left-paragraph')).not.toBeInTheDocument()
        expect(screen.getByTestId('catalog-fade-right-paragraph')).toBeInTheDocument()
      })

      positions.structure = 199.75
      positions.paragraph = 199.75
      fireEvent.scroll(structureRow)
      fireEvent.scroll(paragraphRow)
      await waitFor(() => {
        expect(screen.getByTestId('catalog-fade-left-structure')).toBeInTheDocument()
        expect(screen.queryByTestId('catalog-fade-right-structure')).not.toBeInTheDocument()
        expect(screen.getByTestId('catalog-fade-left-paragraph')).toBeInTheDocument()
        expect(screen.queryByTestId('catalog-fade-right-paragraph')).not.toBeInTheDocument()
      })

      positions.structure = 200
      positions.paragraph = 200
      fireEvent.scroll(structureRow)
      fireEvent.scroll(paragraphRow)
      await waitFor(() => {
        expect(screen.getByTestId('catalog-fade-left-structure').getAttribute('style')).toContain('linear-gradient(to right, var(--color-bg), transparent)')
        expect(screen.queryByTestId('catalog-fade-right-structure')).not.toBeInTheDocument()
        expect(screen.getByTestId('catalog-fade-left-paragraph').getAttribute('style')).toContain('linear-gradient(to right, var(--color-bg), transparent)')
        expect(screen.queryByTestId('catalog-fade-right-paragraph')).not.toBeInTheDocument()
      })

      widths.structure = 100
      widths.paragraph = 100
      positions.structure = 0
      positions.paragraph = 0
      fireEvent.resize(window)
      await waitFor(() => {
        expect(screen.queryByTestId('catalog-fade-left-structure')).not.toBeInTheDocument()
        expect(screen.queryByTestId('catalog-fade-right-structure')).not.toBeInTheDocument()
        expect(screen.queryByTestId('catalog-fade-left-paragraph')).not.toBeInTheDocument()
        expect(screen.queryByTestId('catalog-fade-right-paragraph')).not.toBeInTheDocument()
      })

      widths.structure = 300
      widths.paragraph = 300
      act(() => {
        useRainStore.setState({
          nodeTree: [...useRainStore.getState().nodeTree, {
            id: 'paragraph-5',
            videoId: 'video-1',
            parentId: 'section-1',
            kind: 'paragraph',
            title: 'Paragraph five',
            type: 'transition',
            startTime: 30,
            endTime: 40,
            text: null,
            sortOrder: 2,
          }],
        })
      })
      await waitFor(() => {
        expect(screen.getByTestId('catalog-fade-right-structure')).toBeInTheDocument()
        expect(screen.getByTestId('catalog-fade-right-paragraph')).toBeInTheDocument()
      })

      const geometryBeforePositionChange = { ...geometryReads }
      const resizeAddsBeforePositionChange = addEventListener.mock.calls.filter(([type]) => type === 'resize').length
      const resizeRemovesBeforePositionChange = removeEventListener.mock.calls.filter(([type]) => type === 'resize').length
      act(() => useRainStore.setState({ playPosition: 6 }))
      expect(geometryReads).toEqual(geometryBeforePositionChange)
      expect(addEventListener.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(resizeAddsBeforePositionChange)
      expect(removeEventListener.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(resizeRemovesBeforePositionChange)
    } finally {
      addEventListener.mockRestore()
      removeEventListener.mockRestore()
      if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
      if (originalScrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', originalScrollWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
      if (originalScrollLeft) Object.defineProperty(HTMLElement.prototype, 'scrollLeft', originalScrollLeft)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollLeft')
    }
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
