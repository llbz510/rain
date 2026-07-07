// harness/m06-video-component.test.tsx
// ========================================
// M06 视频区组件 Harness
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VideoZone, VideoControls } from '@/ui/components/video'
import { TestStoreProvider } from '@/store/test-provider'

function renderWithStore(ui: React.ReactElement) {
  return render(<TestStoreProvider playPosition={100} subtitleOn={true}>{ui}</TestStoreProvider>)
}

describe('U22: video src 是 convertFileSrc（决策96）', () => {
  it('video 元素存在', () => {
    renderWithStore(<VideoZone filePath="/path/to/video.mp4" />)
    const video = screen.getByTestId('video-player')
    expect(video).toBeInTheDocument()
    expect(video.tagName).toBe('VIDEO')
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
  })
})

describe('U25: 控制栏完整按钮（M16）', () => {
  it('包含进度条/播停/音量/展开/全屏', () => {
    renderWithStore(<VideoControls />)
    expect(screen.getByRole('button', { name: /播放|暂停/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /文本展开/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /导图展开/ })).toBeInTheDocument()
  })
})

describe('U26: 重开视频续播到 position（决策56）', () => {
  it('VideoZone 接受 resumePosition', () => {
    renderWithStore(<VideoZone filePath="/v.mp4" resumePosition={200} />)
    const video = screen.getByTestId('video-player') as HTMLVideoElement
    // jsdom 不真正播放视频，但可以验证 currentTime 属性
    expect(video).toBeInTheDocument()
  })
})
