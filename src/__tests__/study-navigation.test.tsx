import { readFileSync } from 'node:fs'
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
const productionStyles = readFileSync('src/index.css', 'utf8')

function keyframesInRules(rules: CSSRuleList | CSSRule[]): CSSKeyframesRule[] {
  return [...rules].flatMap((rule) => {
    if (rule.type === CSSRule.KEYFRAMES_RULE) return [rule as CSSKeyframesRule]
    if ('cssRules' in rule) return keyframesInRules((rule as CSSRule & { cssRules: CSSRuleList }).cssRules)
    return []
  })
}

function catalogStructureKeyframes(styles: string) {
  const style = document.createElement('style')
  style.textContent = styles
  document.head.append(style)
  try {
    return keyframesInRules(style.sheet!.cssRules)
      .filter((rule) => rule.name.startsWith('catalog-structure-slide-'))
      .map((rule) => ({
        name: rule.name,
        frames: [...rule.cssRules]
          .filter((frame): frame is CSSKeyframeRule => frame.type === CSSRule.KEYFRAME_RULE)
          .map((frame) => ({ keyText: frame.keyText, transform: frame.style.transform })),
      }))
  } finally {
    style.remove()
  }
}

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
  vi.unstubAllGlobals()
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

describe('AC-SU-02 structure catalog switch feedback', () => {
  it('uses adjacent Store playPosition samples for nested parent-child playback and user seek direction', async () => {
    configureStudy()
    useRainStore.setState({
      playPosition: 6,
      nodeTree: [
        { id: 'chapter-1', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter one', type: null, startTime: 0, endTime: 20, text: null, sortOrder: 0 },
        { id: 'section-1', videoId: 'video-1', parentId: 'chapter-1', kind: 'section', title: 'Section one', type: null, startTime: 5, endTime: 10, text: null, sortOrder: 0 },
        { id: 'paragraph-1', videoId: 'video-1', parentId: 'section-1', kind: 'paragraph', title: 'Paragraph one', type: 'concept', startTime: 5, endTime: 10, text: null, sortOrder: 0 },
      ],
    })
    render(<StudyInterface />)

    const structureRow = screen.getByTestId('catalog-bar').querySelector<HTMLElement>('[data-catalog-row="structure"]')!
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    expect(within(structureRow).getByText('Section one')).toHaveAttribute('data-catalog-current', 'true')

    video.currentTime = 11
    fireEvent.timeUpdate(video)
    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(11)
      expect(within(structureRow).getByText('Chapter one')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'forward')
    })
    const animationIdAtEleven = structureRow.getAttribute('data-catalog-structure-animation-id')
    const animationNameAtEleven = structureRow.style.animationName
    const animationStyleAtEleven = structureRow.getAttribute('style')

    video.currentTime = 11.05
    fireEvent.timeUpdate(video)
    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(11.05)
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'forward')
      expect(structureRow).toHaveAttribute('data-catalog-structure-animation-id', animationIdAtEleven)
      expect(structureRow.style.animationName).toBe(animationNameAtEleven)
      expect(structureRow.getAttribute('style')).toBe(animationStyleAtEleven)
    })

    video.currentTime = 6
    fireEvent.timeUpdate(video)
    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(6)
      expect(within(structureRow).getByText('Section one')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'backward')
    })
  })

  it('loads the production CSS contract for exactly one of each restartable horizontal keyframe and the sole 200ms token', () => {
    const keyframeNames = [
      'catalog-structure-slide-a',
      'catalog-structure-slide-b',
    ]
    const styleCount = document.head.querySelectorAll('style').length
    const targetRules = catalogStructureKeyframes(productionStyles)
    expect(document.head.querySelectorAll('style')).toHaveLength(styleCount)
    expect(targetRules.map(({ name }) => name)).toEqual(keyframeNames)
    expect(catalogStructureKeyframes(`${productionStyles}\n@media (min-width: 0px) { @keyframes unrelated-legal-fade { from { opacity: 0; } to { opacity: 1; } } }`).map(({ name }) => name)).toEqual(keyframeNames)
    expect(document.head.querySelectorAll('style')).toHaveLength(styleCount)
    for (const name of keyframeNames) {
      const rules = targetRules.filter((rule) => rule.name === name)
      expect(rules, `${name} must appear exactly once in the production stylesheet`).toHaveLength(1)
      expect(rules[0].frames.map((frame) => frame.keyText)).toEqual(['from', 'to'])
      expect(rules[0].frames[0].transform).toBe('translateX(var(--catalog-structure-slide-offset))')
      expect(rules[0].frames[1].transform).toBe('translateX(0)')
    }
    expect(productionStyles.match(/\b200ms\b/g)).toEqual(['200ms'])
    expect(productionStyles).toContain('--anim-base: 200ms')
  })

  it('restarts each forward and backward structure switch without remounting the horizontal scroll owner', async () => {
    configureStudy()
    useRainStore.setState({
      nodeTree: [
        { id: 'chapter-1', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter one', type: null, startTime: 0, endTime: 10, text: null, sortOrder: 0 },
        { id: 'section-1', videoId: 'video-1', parentId: 'chapter-1', kind: 'section', title: 'Section one', type: null, startTime: 5, endTime: 10, text: null, sortOrder: 0 },
        { id: 'paragraph-1', videoId: 'video-1', parentId: 'section-1', kind: 'paragraph', title: 'Paragraph one', type: 'concept', startTime: 0, endTime: 10, text: null, sortOrder: 0 },
        { id: 'chapter-2', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter two', type: null, startTime: 10, endTime: 20, text: null, sortOrder: 1 },
        { id: 'section-2', videoId: 'video-1', parentId: 'chapter-2', kind: 'section', title: 'Section two', type: null, startTime: 10, endTime: 20, text: null, sortOrder: 0 },
        { id: 'paragraph-2', videoId: 'video-1', parentId: 'section-2', kind: 'paragraph', title: 'Paragraph two', type: 'example', startTime: 10, endTime: 15, text: null, sortOrder: 1 },
        { id: 'paragraph-3', videoId: 'video-1', parentId: 'section-2', kind: 'paragraph', title: 'Paragraph three', type: 'transition', startTime: 15, endTime: 20, text: null, sortOrder: 2 },
        { id: 'chapter-3', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter three', type: null, startTime: 20, endTime: 30, text: null, sortOrder: 2 },
        { id: 'section-3', videoId: 'video-1', parentId: 'chapter-3', kind: 'section', title: 'Section three', type: null, startTime: 20, endTime: 30, text: null, sortOrder: 0 },
        { id: 'paragraph-4', videoId: 'video-1', parentId: 'section-3', kind: 'paragraph', title: 'Paragraph four', type: 'concept', startTime: 20, endTime: 30, text: null, sortOrder: 3 },
      ],
    })
    render(<StudyInterface />)

    const catalog = screen.getByTestId('catalog-bar')
    const structureRow = catalog.querySelector<HTMLElement>('[data-catalog-row="structure"]')!
    const structureScrollRow = catalog.querySelector<HTMLElement>('[data-catalog-scroll-row="structure"]')!
    const paragraphRow = catalog.querySelector<HTMLElement>('[data-catalog-row="paragraph"]')!
    const video = screen.getByTestId('video-player') as HTMLVideoElement

    expect(within(structureRow).getByText('Chapter one')).toHaveAttribute('data-catalog-current', 'true')

    video.currentTime = 10
    fireEvent.timeUpdate(video)

    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(10)
      expect(within(structureRow).getByText('Section two')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'forward')
      expect(structureRow).toHaveAttribute('data-catalog-structure-animation-id', '1')
      expect(structureRow).toHaveStyle({ animationName: 'catalog-structure-slide-a', animationDuration: 'var(--anim-base)' })
      expect(structureRow.getAttribute('style')).toContain('--catalog-structure-slide-offset: 12px')
    })

    video.currentTime = 15
    fireEvent.timeUpdate(video)

    await waitFor(() => {
      expect(within(structureRow).getByText('Section two')).toHaveAttribute('data-catalog-current', 'true')
      expect(within(paragraphRow).getByText('Paragraph three')).toHaveAttribute('data-catalog-current', 'true')
      expect(paragraphRow).toHaveStyle({ animationName: 'none', transform: 'none' })
    })

    structureScrollRow.scrollLeft = 31
    video.currentTime = 20
    fireEvent.timeUpdate(video)

    await waitFor(() => {
      expect(within(structureRow).getByText('Section three')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-animation-id', '2')
      expect(structureRow).toHaveStyle({ animationName: 'catalog-structure-slide-b', animationDuration: 'var(--anim-base)' })
      expect(structureScrollRow).toBe(catalog.querySelector('[data-catalog-scroll-row="structure"]'))
      expect(structureScrollRow.scrollLeft).toBe(31)
    })

    fireEvent.click(within(structureRow).getByText('Chapter two'))

    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(10)
      expect(within(structureRow).getByText('Section two')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'backward')
      expect(structureRow).toHaveAttribute('data-catalog-structure-animation-id', '3')
      expect(structureRow).toHaveStyle({ animationName: 'catalog-structure-slide-a', animationDuration: 'var(--anim-base)' })
      expect(structureRow.getAttribute('style')).toContain('--catalog-structure-slide-offset: -12px')
    })

    fireEvent.click(within(structureRow).getByText('Chapter one'))

    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(0)
      expect(within(structureRow).getByText('Chapter one')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-animation-id', '4')
      expect(structureRow).toHaveStyle({ animationName: 'catalog-structure-slide-b', animationDuration: 'var(--anim-base)' })
    })
  })

  it('uses time direction at equal-start parent-child boundaries', async () => {
    configureStudy()
    useRainStore.setState({
      playPosition: 1,
      nodeTree: [
        { id: 'chapter-1', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter one', type: null, startTime: 0, endTime: 10, text: null, sortOrder: 0 },
        { id: 'section-1', videoId: 'video-1', parentId: 'chapter-1', kind: 'section', title: 'Section one', type: null, startTime: 0, endTime: 5, text: null, sortOrder: 0 },
        { id: 'paragraph-1', videoId: 'video-1', parentId: 'section-1', kind: 'paragraph', title: 'Paragraph one', type: 'concept', startTime: 0, endTime: 5, text: null, sortOrder: 0 },
      ],
    })
    render(<StudyInterface />)

    const structureRow = screen.getByTestId('catalog-bar').querySelector<HTMLElement>('[data-catalog-row="structure"]')!
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    expect(within(structureRow).getByText('Section one')).toHaveAttribute('data-catalog-current', 'true')

    video.currentTime = 5
    fireEvent.timeUpdate(video)
    await waitFor(() => {
      expect(within(structureRow).getByText('Chapter one')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'forward')
    })

    video.currentTime = 4
    fireEvent.timeUpdate(video)
    await waitFor(() => {
      expect(within(structureRow).getByText('Section one')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'backward')
    })
  })

  it('cancels active displacement when reduced motion changes and resumes motion after preference is removed', async () => {
    const mediaQuery = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const matchMedia = vi.fn().mockReturnValue(mediaQuery)
    vi.stubGlobal('matchMedia', matchMedia)
    configureStudy()
    useRainStore.setState({
      nodeTree: [
        { id: 'chapter-1', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter one', type: null, startTime: 0, endTime: 10, text: null, sortOrder: 0 },
        { id: 'paragraph-1', videoId: 'video-1', parentId: 'chapter-1', kind: 'paragraph', title: 'Paragraph one', type: 'concept', startTime: 0, endTime: 10, text: null, sortOrder: 0 },
        { id: 'chapter-2', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter two', type: null, startTime: 10, endTime: 20, text: null, sortOrder: 1 },
        { id: 'section-2', videoId: 'video-1', parentId: 'chapter-2', kind: 'section', title: 'Section two', type: null, startTime: 10, endTime: 20, text: null, sortOrder: 0 },
        { id: 'paragraph-2', videoId: 'video-1', parentId: 'section-2', kind: 'paragraph', title: 'Paragraph two', type: 'example', startTime: 10, endTime: 20, text: null, sortOrder: 1 },
      ],
    })
    render(<StudyInterface />)

    const catalog = screen.getByTestId('catalog-bar')
    const structureRow = catalog.querySelector<HTMLElement>('[data-catalog-row="structure"]')!
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    video.currentTime = 10
    fireEvent.timeUpdate(video)

    await waitFor(() => {
      expect(within(structureRow).getByText('Section two')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'forward')
    })
    const changeListener = mediaQuery.addEventListener.mock.calls.find(([type]) => type === 'change')?.[1] as (() => void) | undefined
    expect(changeListener).toBeDefined()
    act(() => {
      mediaQuery.matches = true
      changeListener?.()
    })
    await waitFor(() => {
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'none')
      expect(structureRow).toHaveStyle({ animationName: 'none', transform: 'none' })
    })

    act(() => {
      mediaQuery.matches = false
      changeListener?.()
    })
    video.currentTime = 0
    fireEvent.timeUpdate(video)
    await waitFor(() => {
      expect(within(structureRow).getByText('Chapter one')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'backward')
    })
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    cleanup()
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', changeListener)
  })

  it('synchronizes the subscribed reduced-motion snapshot before a structure switch can animate', async () => {
    const initialSnapshot = { matches: false }
    const subscribedMediaQuery = {
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const matchMedia = vi.fn()
      .mockReturnValueOnce(initialSnapshot)
      .mockReturnValue(subscribedMediaQuery)
    vi.stubGlobal('matchMedia', matchMedia)
    configureStudy()
    useRainStore.setState({
      nodeTree: [
        { id: 'chapter-1', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter one', type: null, startTime: 0, endTime: 10, text: null, sortOrder: 0 },
        { id: 'paragraph-1', videoId: 'video-1', parentId: 'chapter-1', kind: 'paragraph', title: 'Paragraph one', type: 'concept', startTime: 0, endTime: 10, text: null, sortOrder: 0 },
        { id: 'chapter-2', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Chapter two', type: null, startTime: 10, endTime: 20, text: null, sortOrder: 1 },
        { id: 'paragraph-2', videoId: 'video-1', parentId: 'chapter-2', kind: 'paragraph', title: 'Paragraph two', type: 'example', startTime: 10, endTime: 20, text: null, sortOrder: 1 },
      ],
    })
    render(<StudyInterface />)

    const structureRow = screen.getByTestId('catalog-bar').querySelector<HTMLElement>('[data-catalog-row="structure"]')!
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    video.currentTime = 10
    fireEvent.timeUpdate(video)

    await waitFor(() => {
      expect(within(structureRow).getByText('Chapter two')).toHaveAttribute('data-catalog-current', 'true')
      expect(structureRow).toHaveAttribute('data-catalog-structure-switch', 'none')
      expect(structureRow).toHaveStyle({ animationName: 'none', transform: 'none' })
    })
    expect(subscribedMediaQuery.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
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
