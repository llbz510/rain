// harness/m07-text-component.test.tsx
// ========================================
// M07 文本区组件 Harness
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextZone, ParagraphItem } from '@/ui/components/text-zone'
import { TestStoreProvider } from './support/test-store-provider'
import { useRainStore } from '@/store/rain-store'
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
  it('包含标题和段落类型', () => {
    renderWithStore(<ParagraphItem paragraph={mockParagraph} sentences={mockSentences} />)
    expect(screen.getByText('概念讲解')).toBeInTheDocument()
    expect(screen.getByTestId('paragraph-p1').querySelector('[data-type-badge="concept"]')).not.toBeNull()
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
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(0)
  })
})

describe('U30: 英文段落渲染翻译块（决策86）', () => {
  it('翻译在段落下方', () => {
    renderWithStore(<ParagraphItem paragraph={mockParagraph} sentences={mockSentences} />)
    expect(screen.getByText('你好世界。你好吗。')).toBeInTheDocument()
  })

  it('从生产 store 读取当前视频语言，不依赖测试 Context', () => {
    useRainStore.setState({
      currentVideoLanguage: 'en',
      translationOn: true,
    })

    render(<ParagraphItem paragraph={mockParagraph} sentences={mockSentences} />)

    expect(screen.getByText('你好世界。你好吗。')).toBeInTheDocument()
  })
})

describe('U31: 译文开关关闭不渲染翻译（决策86）', () => {
  it('translationOn=false 时无翻译', () => {
    renderWithStore(<ParagraphItem paragraph={mockParagraph} sentences={mockSentences} />, { translationOn: false })
    expect(screen.queryByText('你好世界。你好吗。')).not.toBeInTheDocument()
  })
})
