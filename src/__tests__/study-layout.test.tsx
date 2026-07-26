import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

const assistantModel: ModelPoolEntry = {
  id: 'layout-assistant',
  alias: 'Layout Assistant',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'sk-test-secret',
  modelName: 'assistant-a',
  supportsVision: false,
}

function configureStudy(): void {
  useRainStore.setState({
    currentPage: 'study',
    currentVideoId: 'layout-video',
    currentVideoFilePath: 'https://example.test/layout.mp4',
    currentVideoTitle: 'Layout lecture',
    currentVideoLanguage: 'en',
    layoutMode: 'follow',
    aiPanelState: 'ai',
    selectedNodeId: 'layout-paragraph',
    selectionOrigin: 'tree',
    playPosition: 6,
    nodeTree: [{
      id: 'layout-paragraph',
      videoId: 'layout-video',
      parentId: null,
      kind: 'paragraph',
      title: 'Persistent paragraph',
      type: 'concept',
      startTime: 0,
      endTime: 20,
      text: null,
      sortOrder: 0,
    }],
    sentences: [{
      id: 'layout-sentence',
      nodeId: 'layout-paragraph',
      text: 'Persistent sentence.',
      startTime: 0,
      endTime: 20,
      sortOrder: 0,
    }],
    notes: [{
      id: 'layout-note',
      videoId: 'layout-video',
      content: 'Persistent note.',
      source: 'user',
      sentenceIds: [],
      createdAt: 1,
      sortOrder: 0,
    }],
    modelPool: [assistantModel],
    roleAssignment: { asr: null, structuring: null, assistant: assistantModel.id },
    capabilityRecords: [recordCapabilityCheck({
      model: runtimeModelFromPoolEntry(assistantModel),
      role: 'assistant',
      ok: true,
      message: 'Text assistant probe passed',
      checkedAt: 100,
    })],
  })
}

beforeEach(() => {
  useRainStore.getState().reset()
  streamAiChat.mockReset()
})

afterEach(() => {
  cleanup()
  act(() => useRainStore.getState().reset())
  vi.restoreAllMocks()
})

describe('AC-ST-08 production layout stability', () => {
  it('keeps the same media session and learning facts across all three layouts', () => {
    streamAiChat.mockImplementation((_messages, _settings, callbacks) => {
      callbacks.onToken('Persistent answer.')
      callbacks.onDone()
      return vi.fn()
    })
    configureStudy()
    render(<StudyInterface />)

    const originalVideo = screen.getByTestId('video-player') as HTMLVideoElement
    originalVideo.currentTime = 6
    Object.defineProperty(originalVideo, 'paused', { configurable: true, value: false })
    fireEvent.play(originalVideo)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Keep this conversation' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('Persistent answer.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '文本展开' }))

    expect(useRainStore.getState()).toMatchObject({
      currentVideoId: 'layout-video',
      selectedNodeId: 'layout-paragraph',
      playPosition: 6,
      isPlaying: true,
      layoutMode: 'textExpand',
      notes: [{ id: 'layout-note', content: 'Persistent note.' }],
    })
    expect(screen.getByTestId('video-player')).toBe(originalVideo)
    expect(screen.getByTestId('video-zone-shell')).toHaveStyle({ display: 'none' })
    expect(screen.getByText('Persistent answer.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '文本展开' }))
    fireEvent.click(screen.getByRole('button', { name: '导图展开' }))

    expect(useRainStore.getState()).toMatchObject({
      currentVideoId: 'layout-video',
      selectedNodeId: 'layout-paragraph',
      playPosition: 6,
      isPlaying: true,
      layoutMode: 'mapExpand',
      notes: [{ id: 'layout-note', content: 'Persistent note.' }],
    })
    expect(screen.getByTestId('video-player')).toBe(originalVideo)
    expect(screen.getByTestId('video-zone-shell')).toHaveStyle({ display: 'none' })
    expect(screen.getByText('Persistent answer.')).toBeInTheDocument()
  })
})
