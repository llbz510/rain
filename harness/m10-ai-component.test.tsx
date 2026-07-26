// harness/m10-ai-component.test.tsx
// ========================================
// M10 AI 助手组件 Harness
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiAssistant, QuickActions, ChatInput } from '@/ui/components/ai-assistant'
import { TestStoreProvider } from './support/test-store-provider'

function renderWithStore(ui: React.ReactElement) {
  return render(<TestStoreProvider>{ui}</TestStoreProvider>)
}

describe('U37: 按段落类型渲染快捷操作（决策10）', () => {
  it('concept 段落显示 7 个操作芯片', () => {
    renderWithStore(<QuickActions paragraphType="concept" />)
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(7)
  })

  it('transition 段落无快捷操作', () => {
    renderWithStore(<QuickActions paragraphType="transition" />)
    expect(screen.queryAllByRole('button').length).toBe(0)
  })
})

describe('U38: 用户消息气泡+AI回答气泡（决策80）', () => {
  it('渲染对话消息', () => {
    const messages = [
      { role: 'user' as const, content: '你好', frameImage: null },
      { role: 'assistant' as const, content: '你好！有什么可以帮你？' },
    ]
    renderWithStore(<AiAssistant messages={messages} />)
    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.getByText('你好！有什么可以帮你？')).toBeInTheDocument()
  })
})

describe('U39: 用户消息附当前帧（决策80）', () => {
  it('用户消息显示帧图片', () => {
    const messages = [
      { role: 'user' as const, content: '这段在讲什么？', frameImage: '/frame.jpg' },
    ]
    renderWithStore(<AiAssistant messages={messages} />)
    const img = screen.getByAltText(/frame|帧/)
    expect(img).toBeInTheDocument()
  })
})

describe('U40: Enter 发送，Alt+Enter 换行（决策80）', () => {
  it('Enter 触发发送', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    renderWithStore(<ChatInput onSend={onSend} />)
    const input = screen.getByRole('textbox')
    await user.type(input, '测试消息')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('测试消息')
  })

  it('Shift+Enter 不发送（换行）', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    renderWithStore(<ChatInput onSend={onSend} />)
    const input = screen.getByRole('textbox')
    await user.type(input, '测试')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('U41: 流式中停止按钮可中断（决策83）', () => {
  it('流式状态点击停止按钮触发 onStop', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    renderWithStore(<AiAssistant messages={[]} isStreaming={true} onStop={onStop} />)
    await user.click(screen.getByRole('button', { name: /停止/ }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('非流式状态无停止按钮', () => {
    renderWithStore(<AiAssistant messages={[]} isStreaming={false} />)
    expect(screen.queryByRole('button', { name: /停止/ })).not.toBeInTheDocument()
  })
})
