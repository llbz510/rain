import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getImportStatus } from '@/ui/video-list'
import { VideoCard } from '@/ui/components/video-list'
import type { Video } from '@/models/types'

const makeVideo = (overrides: Partial<Video>): Video => ({
  id: 'v1', title: 'Signal', source: 'local', thumbnail: '', duration: 100,
  language: '', status: 'pending', createdAt: 1, position: 25, lastStudiedAt: 1,
  ...overrides,
})

describe('video import status display', () => {
  it('shows persisted Stage2 failure details and offers retry instead of study', () => {
    expect(getImportStatus(makeVideo({ status: 'failed', stage: 'stage2', errorMessage: 'Qwen unavailable' }))).toEqual({
      stageLabel: '整理章节', percent: 67, errorMessage: 'Qwen unavailable', action: 'retry',
    })
  })

  it('shows cancel only while a persisted import is running', () => {
    expect(getImportStatus(makeVideo({ status: 'processing', stage: 'asr' }))).toMatchObject({
      stageLabel: 'Whisper 转写', percent: 10, action: 'cancel',
    })
    expect(getImportStatus(makeVideo({ status: 'ready' }))).toBeNull()
  })

  it('renders a retry action for a failed import and keeps study unavailable', () => {
    const onRetry = vi.fn()
    const onOpen = vi.fn()
    render(<VideoCard
      video={makeVideo({ status: 'failed', stage: 'stage2', errorMessage: 'Qwen unavailable' })}
      onOpen={onOpen}
      onRetryImport={onRetry}
    />)
    expect(screen.getByTestId('import-status-v1')).toHaveTextContent('整理章节 · 67%')
    expect(screen.getByText('Qwen unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试导入' }))
    expect(onRetry).toHaveBeenCalledWith('v1')
    expect(onOpen).not.toHaveBeenCalled()
  })
})