// harness/m17-video-list-component.test.tsx
// ========================================
// M17 视频列表组件 Harness
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VideoList, VideoCard } from '@/ui/components/video-list'
import { TestStoreProvider } from './support/test-store-provider'
import type { Video } from '@/models/types'

const readyVideo: Video = {
  id: 'v1', title: '测试视频', source: 'local', filePath: '/v.mp4',
  thumbnail: '/t.jpg', duration: 600, language: 'zh', status: 'ready',
  createdAt: 1000, position: 300, lastStudiedAt: 2000,
}

const processingVideo: Video = {
  id: 'v2', title: '处理中视频', source: 'url', sourceUrl: 'https://youtube.com/xxx',
  thumbnail: '/t2.jpg', duration: 1200, language: 'en', status: 'processing',
  createdAt: 2000, position: 0, lastStudiedAt: 0,
}

function renderWithStore(ui: React.ReactElement) {
  return render(<TestStoreProvider>{ui}</TestStoreProvider>)
}

describe('U46: ready 卡片渲染（决策57）', () => {
  it('显示缩略图+标题+进度条', () => {
    renderWithStore(<VideoCard video={readyVideo} />)
    expect(screen.getByText('测试视频')).toBeInTheDocument()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
})

describe('U47: 非 ready 卡片渲染蒙层+徽章（决策57）', () => {
  it('processing 卡片显示处理中徽章', () => {
    renderWithStore(<VideoCard video={processingVideo} />)
    expect(screen.getByText('处理中视频')).toBeInTheDocument()
    // 应该有徽章元素
    expect(screen.queryByText(/处理中|排队|失败/)).toBeInTheDocument()
  })
})

describe('U48: 点 ready 卡触发 openVideo（决策54）', () => {
  it('点击 ready 卡片', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    renderWithStore(<VideoCard video={readyVideo} onOpen={onOpen} />)
    await user.click(screen.getByText('测试视频'))
    expect(onOpen).toHaveBeenCalledWith('v1')
  })
})

describe('U49: 点非 ready 卡触发 openImportDialog（决策62）', () => {
  it('点击 processing 卡片', async () => {
    const user = userEvent.setup()
    const onOpenImport = vi.fn()
    renderWithStore(<VideoCard video={processingVideo} onOpenImport={onOpenImport} />)
    await user.click(screen.getByText('处理中视频'))
    expect(onOpenImport).toHaveBeenCalledWith('v2')
  })
})

describe('U50: 排序选择器切换（决策58）', () => {
  it('排序下拉存在', () => {
    renderWithStore(<VideoList videos={[readyVideo, processingVideo]} />)
    expect(screen.getByRole('combobox', { name: /排序/ })).toBeInTheDocument()
  })
})

describe('U51: 搜索框输入触发搜索（决策59）', () => {
  it('搜索框存在', async () => {
    const user = userEvent.setup()
    renderWithStore(<VideoList videos={[readyVideo, processingVideo]} />)
    const search = screen.getByPlaceholderText(/搜索|标题/)
    await user.type(search, '测试')
    expect(search).toHaveValue('测试')
  })
})

describe('U52: 删除按钮弹强确认（决策60）', () => {
  it('点击删除弹出确认', async () => {
    const user = userEvent.setup()
    renderWithStore(<VideoCard video={readyVideo} nodeCount={25} noteCount={8} />)
    const deleteBtn = screen.getByRole('button', { name: /删除/ })
    await user.click(deleteBtn)
    // 确认弹窗显示段数与笔记数。
    // 这里**必须**整句精确断言，不能用 getByText(/25/) 这类"文本含 25 即命中"的宽松匹配：
    // 卡片上的「最近学习」会渲染 `${天数} 天前`，当天的天数一旦含 "25"（例如 2026-09-29 的
    // "20725 天前"）就会同时命中两个元素，用例按日期发作变红（2026-09-29 的真实事故）。
    // 精确断言严格更强：它同时钉住段数、笔记数与整句文案，而不是"存在一个含数字的元素"。
    expect(await screen.findByTestId('delete-confirm')).toHaveTextContent(
      '删除视频「测试视频」将永久删除 25 个段落和 8 条笔记，不可恢复。',
    )
  })
})

describe('U53: 空状态显示引导（决策62）', () => {
  it('空列表显示引导文案', () => {
    renderWithStore(<VideoList videos={[]} />)
    expect(screen.getByText(/导入|第一个视频/)).toBeInTheDocument()
  })
})
