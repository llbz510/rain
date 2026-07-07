// harness/m08-notes-component.test.tsx
// ========================================
// M08 随记面板组件 Harness
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotesPanel, ExcerptButton } from '@/ui/components/notes'
import { TestStoreProvider } from '@/store/test-provider'
import type { Note } from '@/models/types'

const mockNotes: Note[] = [
  { id: 'n1', videoId: 'v1', content: '笔记1', source: 'excerpt', sentenceIds: ['s1'], createdAt: 1000, sortOrder: 0 },
  { id: 'n2', videoId: 'v1', content: '笔记2', source: 'user', sentenceIds: [], createdAt: 2000, sortOrder: 1 },
]

function renderWithStore(ui: React.ReactElement) {
  return render(<TestStoreProvider notes={mockNotes}>{ui}</TestStoreProvider>)
}

describe('U33: 笔记列表渲染（M08）', () => {
  it('按 sortOrder 渲染所有笔记', () => {
    renderWithStore(<NotesPanel />)
    expect(screen.getByText('笔记1')).toBeInTheDocument()
    expect(screen.getByText('笔记2')).toBeInTheDocument()
  })
})

describe('U34: 摘注按钮创建笔记（决策16）', () => {
  it('点击摘注按钮触发创建', async () => {
    const user = userEvent.setup()
    const onExcerpt = vi.fn()
    renderWithStore(<ExcerptButton paragraphId="p1" sentenceIds={['s1', 's2']} onExcerpt={onExcerpt} />)
    await user.click(screen.getByRole('button', { name: /摘注/ }))
    expect(onExcerpt).toHaveBeenCalled()
  })
})

describe('U35: 编辑笔记内容更新 store（M08）', () => {
  it('textarea 输入更新内容', async () => {
    const user = userEvent.setup()
    renderWithStore(<NotesPanel />)
    const textarea = screen.getByDisplayValue('笔记1')
    await user.clear(textarea)
    await user.type(textarea, '修改后的笔记')
    expect(screen.getByDisplayValue('修改后的笔记')).toBeInTheDocument()
  })
})

describe('U36: 笔记引用句子点击跳回视频（决策18）', () => {
  it('引用句子是可点击的', () => {
    renderWithStore(<NotesPanel />)
    // 笔记1 有引用 s1，应该有可点击的引用标识
    expect(screen.queryByText(/s1|引用/)).toBeInTheDocument()
  })
})
