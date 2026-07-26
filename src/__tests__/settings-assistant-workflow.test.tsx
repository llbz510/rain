import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '@/models/db-singleton'
import { checkAssistantModelCapability } from '@/settings/assistant-capability'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry, type ModelPoolEntry } from '@/settings/model-pool'
import { useRainStore } from '@/store/rain-store'
import { SettingsPage } from '@/ui/components/settings'

vi.mock('@/settings/assistant-capability', () => ({
  checkAssistantModelCapability: vi.fn(),
}))

const model: ModelPoolEntry = {
  id: 'workflow-assistant',
  alias: 'Workflow Assistant',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'sk-workflow-secret',
  modelName: 'assistant-a',
  supportsVision: false,
}

afterEach(() => {
  act(() => {
    useRainStore.setState({
      modelPool: [],
      roleAssignment: { asr: null, structuring: null, assistant: null },
      capabilityRecords: [],
    })
  })
  resetDb()
  vi.clearAllMocks()
})

describe('AC-LV-12 settings assistant capability workflow', () => {
  it('persists a passing text-stream check and unlocks the assistant role option', async () => {
    const record = recordCapabilityCheck({
      model: runtimeModelFromPoolEntry(model),
      role: 'assistant',
      ok: true,
      message: '文本助手能力检查通过；不包含 vision 能力。',
      checkedAt: 100,
    })
    vi.mocked(checkAssistantModelCapability).mockResolvedValue(record)
    act(() => {
      useRainStore.setState({
        modelPool: [model],
        roleAssignment: { asr: null, structuring: null, assistant: null },
        capabilityRecords: [],
      })
    })

    render(<SettingsPage />)

    const assistantSelect = screen.getByLabelText('助手 assistant') as HTMLSelectElement
    const option = Array.from(assistantSelect.options).find((candidate) => candidate.value === model.id)!
    expect(option).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: `检查助手 ${model.alias}` }))

    await waitFor(() => expect(useRainStore.getState().capabilityRecords).toEqual([record]))
    expect(option).not.toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('不包含 vision 能力')
  })
})
