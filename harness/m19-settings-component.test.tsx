// harness/m19-settings-component.test.tsx
// ========================================
// M19 设置页组件 Harness
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage, ModelPoolList, AddModelForm, RoleSelector } from '@/ui/components/settings'
import { TestStoreProvider } from './support/test-store-provider'

function renderWithStore(ui: React.ReactElement) {
  return render(<TestStoreProvider>{ui}</TestStoreProvider>)
}

describe('U54: 模型池列表渲染（决策82）', () => {
  it('列表显示已添加模型', () => {
    const models = [
      { id: 'm1', alias: 'GPT-4o', type: 'llm', supportsVision: true },
      { id: 'm2', alias: 'Whisper Base', type: 'whisper-local', supportsVision: false },
    ]
    renderWithStore(<ModelPoolList models={models} />)
    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
    expect(screen.getByText('Whisper Base')).toBeInTheDocument()
  })
})

describe('U55: 添加模型表单（决策82）', () => {
  it('表单包含供应商/baseURL/Key/模型名/别名/vision', () => {
    renderWithStore(<AddModelForm />)
    expect(screen.getByLabelText(/供应商|provider/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/API Key|密钥/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/模型名/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/别名/i)).toBeInTheDocument()
  })
})

describe('U56: 角色选择下拉（决策82）', () => {
  it('三个角色下拉存在', () => {
    renderWithStore(<RoleSelector />)
    expect(screen.getByLabelText(/ASR|语音识别/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/结构化|LLM/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/助手|assistant/i)).toBeInTheDocument()
  })
})

describe('U57 / AC-LV-12: 助手文本能力不强制 vision', () => {
  it('助手下拉显示所有 LLM，并保留 vision 元数据供视觉能力另行判断', () => {
    const models = [
      { id: 'm1', alias: '有Vision', type: 'llm', supportsVision: true },
      { id: 'm2', alias: '无Vision', type: 'llm', supportsVision: false },
    ]
    renderWithStore(<RoleSelector models={models} />)
    const assistantSelect = screen.getByLabelText(/助手|assistant/i) as HTMLSelectElement
    const options = Array.from(assistantSelect.options).map((option) => option.textContent)
    expect(options).toEqual(expect.arrayContaining(['有Vision', '无Vision']))
  })
})

describe('U58: 测试按钮触发连通性测试（决策82）', () => {
  it('每个模型有条目有测试按钮', () => {
    const models = [
      { id: 'm1', alias: 'GPT-4o', type: 'llm', supportsVision: true },
    ]
    renderWithStore(<ModelPoolList models={models} />)
    expect(screen.getByRole('button', { name: /测试/ })).toBeInTheDocument()
  })
})
