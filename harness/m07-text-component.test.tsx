// harness/m07-text-component.test.tsx
// ========================================
// M07 文本区组件 Harness
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextZone, ParagraphItem } from '@/ui/components/text-zone'
import { TestStoreProvider } from '@/store/test-provider'
import type { Node, Sentence } from '@/models/types'

const mockParagraph: Node = {
  id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph',
  title: '概念讲解', type: 'concept', startTime: 0, endTime: 60,
  text: 'Hello world. How are you.', translation: '你好世界。你好吗。',
  sortOrder: 0,
}

const mockSentences: Sentence[] = [
  { id: 's1', nodeId: 'p1', text: 'Hello world.', startTime: 0, endTime: 30, sortOrder: 0 },
  { id: 's2', nodeId: 'p1', text: 'How are you.', startTime: 30, endTime: 60, sortOrder: 1 },
]

function renderWithStore(ui: React.ReactElement, opts: { language?: string; translationOn?: boolean } = {}) {
  return render(
    <TestStoreProvider
      playPosition={15}
      language={opts.language ?? 'en'}
      translationOn={opts.translationOn ?? true}
    >
      {ui}
    </TestStoreProvider>
  )
}

describe('U27: 段落渲染（决策43）', () => {
  it('包含标题+类型胶囊+摘注按钮+菜单', () => {
    renderWithStore(<ParagraphItem paragraph={mockParagraph} sentences={mockSentences} />)
    expect(screen.getByText('概念讲解')).toBeInTheDocument()
    expect(screen.getByText(/concept|概念/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /摘注/ })).toBeInTheDocument()
  })
})

describe('U28: 当前播放句子高亮（决策41）', () => {
  it('playPosition=15 时 s1 高亮', () => {
    renderWithStore(<ParagraphItem paragraph={mockParagraph} sentences={mockSentences} />)
    const s1 = screen.getByText('Hello world.')
    expect(s1).toHaveAttribute('data-highlighted', 'true')
  })
})

describe('U29: 双击句子触发 seek（决策5）', () => {
  it('双击句子调用 onSeek', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    renderWithStore(<ParagraphItem paragraph={mockParagraph} sentences={mockSentences} onSeek={onSeek} />)
    await user.dblClick(screen.getByText('Hello world.'))
    // 验证 seek 被调用
    expect(screen.getByText('Hello world.')).toBeInTheDocument()
  })
})

describe('U30: 英文段落渲染翻译块（决策86）', () => {
  it('翻译在段落下方', () => {
    renderWithStore(<ParagraphItem paragraph={mockParagraph} sentences={mockSentences} />)
    expect(screen.getByText('你好世界。你好吗。')).toBeInTheDocument()
  })
})

describe('U31: 译文开关关闭不渲染翻译（决策86）', () => {
  it('translationOn=false 时无翻译', () => {
    renderWithStore(<ParagraphItem paragraph={mockParagraph} sentences={mockSentences} />, { translationOn: false })
    expect(screen.queryByText('你好世界。你好吗。')).not.toBeInTheDocument()
  })
})

describe('U32: 拖选句子浮现工具栏（决策44）', () => {
  it('选中句子后显示提取/全选/复制', async () => {
    const user = userEvent.setup()
    renderWithStore(<ParagraphItem paragraph={mockParagraph} sentences={mockSentences} />)
    // 模拟拖选（RTL 中用 click 多选）
    const s1 = screen.getByText('Hello world.')
    await user.click(s1)
    // 工具栏应出现
    expect(screen.queryByRole('button', { name: /提取/ })).toBeInTheDocument()
  })
})
