import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://local/${encodeURIComponent(path)}`),
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: mocks.convertFileSrc,
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
}))

import { VideoCard } from '@/ui/components/video-list'

const video = {
  id: 'thumbnail-video',
  title: '缩略图课程',
  source: 'local' as const,
  filePath: 'D:\\courses\\lesson.mp4',
  thumbnail: 'D:\\rain-data\\thumbnails\\thumbnail-video.jpg',
  duration: 60,
  language: 'zh',
  status: 'ready' as const,
  createdAt: 1,
  position: 0,
  lastStudiedAt: 1,
}

beforeEach(() => {
  mocks.convertFileSrc.mockClear()
})

describe('AC-LV-18 production thumbnail rendering', () => {
  it('renders an app-owned Windows thumbnail through the Tauri asset bridge', () => {
    render(<VideoCard video={video} />)

    expect(mocks.convertFileSrc).toHaveBeenCalledWith(video.thumbnail)
    expect(screen.getByRole('img', { name: video.title })).toHaveAttribute(
      'src',
      `asset://local/${encodeURIComponent(video.thumbnail)}`,
    )
  })

  it('renders a stable placeholder instead of an image with an empty source', () => {
    render(<VideoCard video={{ ...video, thumbnail: '' }} />)

    expect(screen.queryByRole('img', { name: video.title })).not.toBeInTheDocument()
    expect(screen.getByText('暂无缩略图')).toBeInTheDocument()
  })

  it('keeps an HTTP thumbnail URL without routing it through the local asset bridge', () => {
    const remoteThumbnail = 'https://images.example.test/course.jpg'
    render(<VideoCard video={{ ...video, thumbnail: remoteThumbnail }} />)

    expect(mocks.convertFileSrc).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: video.title })).toHaveAttribute(
      'src',
      remoteThumbnail,
    )
  })
})
