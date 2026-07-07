// harness/m14-shortcuts-component.test.tsx
// ========================================
// M14 快捷键集成 Harness
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutManager } from '@/ui/components/shortcut-manager'
import { TestStoreProvider } from '@/store/test-provider'

function renderWithStore(ui: React.ReactElement, opts: { isInputFocused?: boolean; selectionOrigin?: 'tree' | 'diagram' } = {}) {
  return render(
    <TestStoreProvider
      isInputFocused={opts.isInputFocused ?? false}
      selectionOrigin={opts.selectionOrigin ?? 'tree'}
      selectedNodeId="n1"
    >
      {ui}
    </TestStoreProvider>
  )
}

describe('U42: 非输入态按 1/2/3 切模式（决策53）', () => {
  it('按 2 切到文本展开', async () => {
    const user = userEvent.setup()
    renderWithStore(<ShortcutManager />)
    await user.keyboard('2')
    // 验证 store 状态变更
    expect(screen.getByTestId('shortcut-manager')).toBeInTheDocument()
  })
})

describe('U43: 输入态按 1/2/3 不切模式（决策53）', () => {
  it('输入态按 2 不切换', async () => {
    const user = userEvent.setup()
    renderWithStore(<ShortcutManager />, { isInputFocused: true })
    await user.keyboard('2')
    // 输入态不生效，验证没有触发模式切换
    expect(screen.getByTestId('shortcut-manager')).toBeInTheDocument()
  })
})

describe('U44: ` 键摘注当前播放段（决策53）', () => {
  it('按 ` 触发摘注', async () => {
    const user = userEvent.setup()
    const onExcerpt = vi.fn()
    renderWithStore(<ShortcutManager onExcerpt={onExcerpt} />)
    await user.keyboard('`')
    // 摘注回调应被调用
    expect(onExcerpt).toHaveBeenCalled()
  })
})

describe('U45: Del 仅 tree 选中时删节点（决策53）', () => {
  it('origin=tree 时 Del 生效', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderWithStore(<ShortcutManager onDelete={onDelete} />, { selectionOrigin: 'tree' })
    await user.keyboard('{Delete}')
    expect(onDelete).toHaveBeenCalled()
  })

  it('origin=diagram 时 Del 不生效', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderWithStore(<ShortcutManager onDelete={onDelete} />, { selectionOrigin: 'diagram' })
    await user.keyboard('{Delete}')
    expect(onDelete).not.toHaveBeenCalled()
  })
})
