import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VideoCard } from '@/ui/components/video-list'
import type { Video } from '@/models/types'

const readyVideo: Video = {
  id: 'ready-video',
  title: '键盘学习视频',
  source: 'local',
  filePath: 'C:\\videos\\ready.mp4',
  thumbnail: '',
  duration: 60,
  language: 'zh',
  status: 'ready',
  createdAt: 1,
  position: 0,
  lastStudiedAt: 1,
}

const processingVideo: Video = {
  ...readyVideo,
  id: 'processing-video',
  title: '导入中的视频',
  status: 'processing',
}

describe('AC-UX-06 VideoCard keyboard primary actions', () => {
  it('opens a ready video from its named primary button with Tab and Enter', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onOpenImport = vi.fn()
    render(<VideoCard video={readyVideo} onOpen={onOpen} onOpenImport={onOpenImport} />)

    const primaryAction = screen.getByRole('button', { name: '打开视频：键盘学习视频' })
    expect(primaryAction.tagName).toBe('BUTTON')
    expect(primaryAction).toHaveAttribute('type', 'button')
    await user.tab()
    expect(primaryAction).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('ready-video')
    expect(onOpenImport).not.toHaveBeenCalled()
  })

  it('opens a non-ready import task from its named primary button with Tab and Enter', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onOpenImport = vi.fn()
    render(<VideoCard video={processingVideo} onOpen={onOpen} onOpenImport={onOpenImport} />)

    const primaryAction = screen.getByRole('button', { name: '查看导入任务：导入中的视频' })
    expect(primaryAction.tagName).toBe('BUTTON')
    expect(primaryAction).toHaveAttribute('type', 'button')
    await user.tab()
    expect(primaryAction).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onOpenImport).toHaveBeenCalledTimes(1)
    expect(onOpenImport).toHaveBeenCalledWith('processing-video')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('disables the primary action while deletion is in progress', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn(() => new Promise<void>(() => {}))
    render(<VideoCard video={readyVideo} onDelete={onDelete} />)

    const primaryAction = screen.getByRole('button', { name: '打开视频：键盘学习视频' })
    await user.click(screen.getByRole('button', { name: '删除' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    expect(primaryAction).toBeDisabled()
  })
})
