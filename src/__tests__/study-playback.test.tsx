import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoControls, VideoZone } from '@/ui/components/video'
import { ParagraphItem } from '@/ui/components/text-zone'
import { AiAssistant } from '@/ui/components/ai-assistant'
import { TestStoreProvider } from '@/store/test-provider'
import { useRainStore } from '@/store/rain-store'

const { streamAiChat } = vi.hoisted(() => ({ streamAiChat: vi.fn() }))
vi.mock('@/llm/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/llm/client')>()), streamAiChat }))
import { StudyInterface } from '@/pages/StudyInterface'

afterEach(() => {
  cleanup()
  act(() => useRainStore.getState().reset())
  vi.restoreAllMocks()
  streamAiChat.mockReset()
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
})

function configureQwenStudy() {
  useRainStore.setState({
    currentPage: 'study',
    layoutMode: 'follow',
    aiPanelState: 'ai',
    playPosition: 1,
    modelPool: [{ id: 'qwen', alias: 'Qwen', type: 'llm', provider: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-test-secret', modelName: 'qwen3.5-omni-flash', supportsVision: true }],
    roleAssignment: { asr: null, structuring: 'qwen', assistant: 'qwen' },
    nodeTree: [{ id: 'p', videoId: 'v', parentId: null, kind: 'paragraph', title: 'P', type: 'concept', startTime: 0, endTime: 10, text: null, sortOrder: 0 }],
    sentences: [
      { id: 's', nodeId: 'p', text: 'Current transcript.', startTime: 0, endTime: 4, sortOrder: 0 },
      { id: 's-later', nodeId: 'p', text: 'Later sentence in the same paragraph.', startTime: 8, endTime: 9, sortOrder: 1 },
    ],
  })
}

describe('real study playback', () => {
  it('uses Tauri convertFileSrc for a local video and surfaces a media load failure', () => {
    ;(window as unknown as Window & { __TAURI_INTERNALS__: { convertFileSrc: (path: string) => string } }).__TAURI_INTERNALS__ = { convertFileSrc: (path) => `asset://local/${encodeURIComponent(path)}` }

    render(<TestStoreProvider><VideoZone filePath={'D:\\lectures\\signal.mp4'} /></TestStoreProvider>)

    const video = screen.getByTestId('video-player') as HTMLVideoElement
    expect(video.src).toContain('asset://local/')
    fireEvent.error(video)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the local video')
  })

  it('clears a media load failure when a different video is loaded', () => {
    const { rerender } = render(<TestStoreProvider><VideoZone filePath="https://example.test/bad.mp4" /></TestStoreProvider>)
    fireEvent.error(screen.getByTestId('video-player'))
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the local video')

    rerender(<TestStoreProvider><VideoZone filePath="https://example.test/good.mp4" /></TestStoreProvider>)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('seeks the real media to a transcript sentence start time on double click', () => {
    const seek = vi.fn()

    render(<TestStoreProvider><ParagraphItem paragraph={{ id: 'p', videoId: 'v', parentId: null, kind: 'paragraph', title: 'P', type: 'concept', startTime: 0, endTime: 10, text: null, sortOrder: 0 }} sentences={[{ id: 's', nodeId: 'p', text: 'Seek here', startTime: 12.5, endTime: 14, sortOrder: 0 }]} onSeek={seek} /></TestStoreProvider>)

    fireEvent.doubleClick(screen.getByText('Seek here'))
    expect(seek).toHaveBeenCalledWith(12.5)
  })

  it('aborts the real assistant stream and ignores tokens received after Stop', () => {
    let callbacks: { onToken: (token: string) => void } | undefined
    const cleanupStream = vi.fn()
    streamAiChat.mockImplementation((_messages, _settings, nextCallbacks) => { callbacks = nextCallbacks; return cleanupStream })
    configureQwenStudy()

    render(<StudyInterface />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Explain this' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /停止/ }))
    callbacks?.onToken('late token')

    expect(cleanupStream).toHaveBeenCalledOnce()
    expect(screen.queryByText('late token')).not.toBeInTheDocument()
  })

  it('shows current paragraph quick actions and sends one with paragraph-scoped context', () => {
    let sentMessages: Array<{ role: string; content: string }> = []
    streamAiChat.mockImplementation((messages, _settings, callbacks) => {
      sentMessages = messages
      callbacks.onToken('ok')
      callbacks.onDone()
      return vi.fn()
    })
    configureQwenStudy()

    render(<StudyInterface />)
    const quickAction = screen.getByRole('button', { name: '生成例子' })
    fireEvent.click(quickAction)

    expect(quickAction).toBeInTheDocument()
    expect(sentMessages.at(-1)).toEqual({ role: 'user', content: '生成例子' })
    expect(sentMessages[0].content).toContain('Current paragraph transcript:')
    expect(sentMessages[0].content).toContain('Current transcript.')
    expect(sentMessages[0].content).toContain('Later sentence in the same paragraph.')
  })

  it('renders inline known citations as seek controls while leaving unknown citations visible as text', () => {
    const seek = vi.fn()

    render(<AiAssistant onSeekSource={seek} messages={[{ role: 'assistant', content: 'Known [sentence:s-2 @ 3.000-6.000] and unknown [sentence:missing @ 8.000-9.000].', sources: [{ sentenceId: 's-2', nodeId: 'p-1', startTime: 3, endTime: 6, text: 'Amplitude describes signal strength.' }] }]} />)

    fireEvent.click(screen.getByRole('button', { name: /sentence:s-2 @ 3\.000-6\.000/ }))
    expect(seek).toHaveBeenCalledWith(3)
    expect(screen.getByTestId('message-assistant')).toHaveTextContent('[sentence:missing @ 8.000-9.000]')
  })

  it('leaves citations with mismatched timestamps visible but not clickable', () => {
    const seek = vi.fn()

    render(<AiAssistant onSeekSource={seek} messages={[{ role: 'assistant', content: 'Wrong time [sentence:s-2 @ 999.000-1000.000]', sources: [{ sentenceId: 's-2', nodeId: 'p-1', startTime: 3, endTime: 6, text: 'Amplitude describes signal strength.' }] }]} />)

    expect(screen.queryByRole('button', { name: /sentence:s-2/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('message-assistant')).toHaveTextContent('[sentence:s-2 @ 999.000-1000.000]')
    expect(seek).not.toHaveBeenCalled()
  })
  it('stops the active assistant stream and makes cited sources seekable', () => {
    const stop = vi.fn()
    const seek = vi.fn()

    render(<AiAssistant isStreaming onStop={stop} onSeekSource={seek} messages={[{ role: 'assistant', content: 'Answer [sentence:s-2 @ 3.000-6.000]', sources: [{ sentenceId: 's-2', nodeId: 'p-1', startTime: 3, endTime: 6, text: 'Amplitude describes signal strength.' }] }]} />)

    fireEvent.click(screen.getByRole('button', { name: /停止/ }))
    fireEvent.click(screen.getByRole('button', { name: /sentence:s-2/ }))
    expect(stop).toHaveBeenCalledOnce()
    expect(seek).toHaveBeenCalledWith(3)
  })

  it('aborts the old stream before starting another and ignores its late tokens', () => {
    const callbacks: Array<{ onToken: (token: string) => void }> = []
    const cleanups = [vi.fn(), vi.fn()]
    streamAiChat.mockImplementation((_messages, _settings, nextCallbacks) => {
      callbacks.push(nextCallbacks)
      return cleanups[callbacks.length - 1]
    })
    configureQwenStudy()

    render(<StudyInterface />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'First' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Second' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    act(() => {
      callbacks[0].onToken('old token')
      callbacks[1].onToken('new token')
    })

    expect(cleanups[0]).toHaveBeenCalledOnce()
    expect(screen.queryByText('old token')).not.toBeInTheDocument()
    expect(screen.getByText('new token')).toBeInTheDocument()
  })

  it('tracks native video play and pause events in the footer label', () => {
    render(<TestStoreProvider><VideoZone filePath="https://example.test/video.mp4" /><VideoControls /></TestStoreProvider>)

    const video = screen.getByTestId('video-player')
    fireEvent.play(video)
    expect(screen.getByRole('button', { name: /暂停/ })).toBeInTheDocument()
    fireEvent.pause(video)
    expect(screen.getByRole('button', { name: /播放/ })).toBeInTheDocument()
  })
})
