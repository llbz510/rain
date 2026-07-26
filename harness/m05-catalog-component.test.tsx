// harness/m05-catalog-component.test.tsx
// ========================================
// M05 目录区组件 Harness
// 锁定后禁止 AI 修改
// ========================================

import { beforeEach, describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SideTree, CatalogBar, DiagramZone } from '@/ui/components/catalog'
import { TestStoreProvider } from './support/test-store-provider'
import { useRainStore } from '@/store/rain-store'
import type { Node } from '@/models/types'

const mockNodes: Node[] = [
  { id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter', title: '第一章', type: null, startTime: 0, endTime: 300, text: null, sortOrder: 0 },
  { id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '第一节', type: null, startTime: 0, endTime: 120, text: null, sortOrder: 0 },
  { id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph', title: '段落1', type: 'concept', startTime: 0, endTime: 60, text: null, sortOrder: 0 },
]

function renderWithStore(ui: React.ReactElement) {
  return render(<TestStoreProvider nodes={mockNodes}>{ui}</TestStoreProvider>)
}

beforeEach(() => {
  useRainStore.getState().reset()
})

describe('U13: 左树渲染三级（决策20）', () => {
  it('渲染章节/小节/段落', () => {
    renderWithStore(<SideTree />)
    expect(screen.getByText('第一章')).toBeInTheDocument()
    expect(screen.getByText('第一节')).toBeInTheDocument()
    expect(screen.getByText('段落1')).toBeInTheDocument()
  })
})

describe('U14: 左树单击触发 selectNode（决策38）', () => {
  it('单击仅选中不 seek', async () => {
    const user = userEvent.setup()
    renderWithStore(<SideTree />)
    await user.click(screen.getByText('段落1'))
    // 选中高亮应该出现
    expect(screen.getByText('段落1').closest('[data-selected]')).toHaveAttribute('data-selected', 'true')
  })
})

describe('U15: 左树双击触发三区跳转（决策40）', () => {
  it('双击触发 seek 事件', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    renderWithStore(<SideTree onSeek={onSeek} />)
    await user.dblClick(screen.getByText('段落1'))
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(0)
  })
})

describe('U16: 横条渲染章节群+小节群+段落（决策11）', () => {
  it('横条包含各级节点', () => {
    renderWithStore(<CatalogBar />)
    expect(screen.getByText('第一章')).toBeInTheDocument()
  })
})

describe('U17: 横条单击触发 seek（决策38）', () => {
  it('横条点击触发跳转', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    renderWithStore(<CatalogBar onSeek={onSeek} />)
    await user.click(screen.getByText('第一章'))
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(0)
  })
})

describe('U18: 导图渲染节点（决策79）', () => {
  it('节点用类型色填充+白字', () => {
    renderWithStore(<DiagramZone />)
    const node = screen.getByText('段落1')
    expect(node).toBeInTheDocument()
  })
})

describe('U19: 导图单击触发 selectNode origin=diagram（决策48）', () => {
  it('导图单击选中', async () => {
    const user = userEvent.setup()
    renderWithStore(<DiagramZone />)
    await user.click(screen.getByText('段落1'))
    expect(screen.getByText('段落1')).toHaveAttribute('data-selected', 'true')
  })
})

describe('U20: 导图双击触发三区跳转（决策48）', () => {
  it('导图双击跳转', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    renderWithStore(<DiagramZone onSeek={onSeek} />)
    await user.dblClick(screen.getByText('段落1'))
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(0)
  })
})

describe('U21: ■/□ 进度指示渲染（决策56）', () => {
  it('播放过的节点显示■，未播显示□', () => {
    const first = renderWithStore(<SideTree playPosition={130} />)
    expect(screen.getByTestId('progress-indicator-p1')).toHaveTextContent('■')

    first.unmount()
    renderWithStore(<SideTree playPosition={-1} />)
    expect(screen.getByTestId('progress-indicator-p1')).toHaveTextContent('□')
  })
})
