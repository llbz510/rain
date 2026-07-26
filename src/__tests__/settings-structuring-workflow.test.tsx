import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '@/models/db-singleton'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry, type ModelPoolEntry } from '@/settings/model-pool'
import { checkStructuringModelCapability } from '@/settings/structuring-capability'
import { useRainStore } from '@/store/rain-store'
import { SettingsPage } from '@/ui/components/settings'

vi.mock('@/settings/structuring-capability', () => ({
  checkStructuringModelCapability: vi.fn(),
}))

const model: ModelPoolEntry = {
  id: 'workflow-llm',
  alias: 'Workflow LLM',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'sk-workflow-secret',
  modelName: 'model-a',
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

describe('AC-LV-12 settings structuring capability workflow', () => {
  it('persists a passing Stage2 check and unlocks the structuring role option', async () => {
    const record = recordCapabilityCheck({
      model: runtimeModelFromPoolEntry(model),
      role: 'structuring',
      ok: true,
      message: '结构化能力检查通过',
      checkedAt: 100,
    })
    vi.mocked(checkStructuringModelCapability).mockResolvedValue(record)
    act(() => {
      useRainStore.setState({
        modelPool: [model],
        roleAssignment: { asr: null, structuring: null, assistant: null },
        capabilityRecords: [],
      })
    })

    render(<SettingsPage />)

    const structuringSelect = screen.getByLabelText('结构化 LLM') as HTMLSelectElement
    const option = Array.from(structuringSelect.options).find((candidate) => candidate.value === model.id)!
    expect(option).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: `检查结构化 ${model.alias}` }))

    await waitFor(() => expect(useRainStore.getState().capabilityRecords).toEqual([record]))
    expect(option).not.toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('结构化能力检查通过')
  })
})
