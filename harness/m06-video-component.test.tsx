// harness/m06-video-component.test.tsx
// ========================================
// M06 视频区组件 Harness
// 锁定后禁止 AI 修改
// ========================================

import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VideoZone, VideoControls } from '@/ui/components/video'
import { TestStoreProvider } from './support/test-store-provider'
import { useRainStore } from '@/store/rain-store'

const mocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path.replaceAll('\\', '/')}`),
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: mocks.convertFileSrc,
}))
vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
}))

function renderWithStore(ui: React.ReactElement) {
  return render(<TestStoreProvider playPosition={100} subtitleOn={true}>{ui}</TestStoreProvider>)
}

beforeEach(() => {
  useRainStore.getState().reset()
  mocks.convertFileSrc.mockClear()
})

describe('U22: video src 是 convertFileSrc（决策96）', () => {
  it('Tauri 本地路径通过 convertFileSrc 传给 video', () => {
    renderWithStore(<VideoZone filePath="/path/to/video.mp4" />)
    const video = screen.getByTestId('video-player')
    expect(mocks.convertFileSrc).toHaveBeenCalledWith('/path/to/video.mp4')
    expect(video).toHaveAttribute('src', 'asset://localhost//path/to/video.mp4')
  })
})

describe('U23: 字幕叠加渲染当前句子（决策78）', () => {
  it('字幕区显示当前句子', () => {
    renderWithStore(<VideoZone filePath="/v.mp4" currentSubtitle="这是当前句子。" />)
    expect(screen.getByText('这是当前句子。')).toBeInTheDocument()
  })
})

describe('U24: 字幕开关按钮（决策91）', () => {
  it('点击字幕按钮切换显隐', async () => {
    const user = userEvent.setup()
    renderWithStore(<VideoControls />)
    const btn = screen.getByRole('button', { name: /字幕/ })
    expect(btn).toBeInTheDocument()
    await user.click(btn)
    expect(useRainStore.getState().subtitleOn).toBe(false)
    expect(screen.getByRole('button', { name: '字幕 OFF' })).toBeInTheDocument()
  })
})

describe('U25: 当前控制栏命令（M16）', () => {
  it('包含播停、字幕和两种布局展开命令', () => {
    renderWithStore(<VideoControls />)
    expect(screen.getByRole('button', { name: /播放|暂停/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /字幕/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /文本展开/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /导图展开/ })).toBeInTheDocument()
  })
})

describe('U26: 重开视频续播到 position（决策56）', () => {
  it('VideoZone 把 resumePosition 写入 currentTime', async () => {
    renderWithStore(<VideoZone filePath="/v.mp4" resumePosition={200} />)
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    await waitFor(() => expect(video.currentTime).toBe(200))
  })
})
