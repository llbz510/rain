import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import type { ModelPoolEntry } from '@/settings/model-pool'
import { useRainStore } from '@/store/rain-store'
import { AddModelForm, ModelPoolList, RoleSelector, SettingsPage } from '@/ui/components/settings'

const model: ModelPoolEntry = {
  id: 'llm-main',
  alias: 'Main LLM',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'dummy-key',
  modelName: 'model-a',
  supportsVision: false,
}

const originalActions = {
  addModel: useRainStore.getState().addModel,
  removeModel: useRainStore.getState().removeModel,
  setRoleModel: useRainStore.getState().setRoleModel,
  setWhisperBackendPreference: useRainStore.getState().setWhisperBackendPreference,
}

afterEach(() => {
  act(() => {
    useRainStore.setState({
      modelPool: [],
      roleAssignment: { asr: null, structuring: null, assistant: null },
      capabilityRecords: [],
      whisperBackendPreference: 'auto',
      ...originalActions,
    })
  })
})

describe('AC-LV-21 Whisper backend settings UI', () => {
  it('offers Auto, NVIDIA GPU, and CPU and reports persistence failures', async () => {
    const setWhisperBackendPreference = vi.fn(async () => ({
      ok: false as const,
      error: '保存 Whisper 后端失败：read only',
    }))
    useRainStore.setState({
      settingsReady: true,
      setWhisperBackendPreference,
    })
    render(<SettingsPage />)

    await userEvent.click(screen.getByText('高级'))
    const select = screen.getByTestId('whisper-backend-preference')
    expect(select).toHaveTextContent('自动（推荐）')
    expect(select).toHaveTextContent('NVIDIA GPU')
    expect(select).toHaveTextContent('CPU')

    await userEvent.selectOptions(select, 'cuda')

    expect(setWhisperBackendPreference).toHaveBeenCalledWith('cuda')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '保存 Whisper 后端失败：read only',
    )
  })
})

describe('AC-LV-14 settings mutation feedback', () => {
  it('keeps the add form open and shows the persistence error', async () => {
    const onClose = vi.fn()
    useRainStore.setState({
      addModel: vi.fn(async () => ({ ok: false, error: '添加模型失败：disk full' })),
    })
    render(<AddModelForm onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('模型名'), 'model-a')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('添加模型失败：disk full')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps a model visible and shows the removal persistence error', async () => {
    useRainStore.setState({
      removeModel: vi.fn(async () => ({ ok: false, error: '删除模型失败：database locked' })),
    })
    render(<ModelPoolList models={[model]} />)

    await userEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(await screen.findByRole('status')).toHaveTextContent('删除模型失败：database locked')
    expect(screen.getByText(model.alias)).toBeInTheDocument()
  })

  it('shows a role persistence error without publishing the selection', async () => {
    const capability = recordCapabilityCheck({
      model: { ...model, model: model.modelName },
      role: 'structuring',
      ok: true,
      message: 'compatible',
      checkedAt: 100,
    })
    useRainStore.setState({
      modelPool: [model],
      capabilityRecords: [capability],
      setRoleModel: vi.fn(async () => ({ ok: false, error: '保存角色选择失败：read only' })),
    })
    render(<RoleSelector models={[model]} />)

    await userEvent.selectOptions(screen.getByLabelText('结构化 LLM'), model.id)

    expect(await screen.findByRole('alert')).toHaveTextContent('保存角色选择失败：read only')
    expect(screen.getByLabelText('结构化 LLM')).toHaveValue('')
  })
})
