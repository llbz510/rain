import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

beforeEach(() => {
  useRainStore.getState().reset()
  streamAiChat.mockReset()
})

afterEach(() => {
  cleanup()
  act(() => useRainStore.getState().reset())
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
