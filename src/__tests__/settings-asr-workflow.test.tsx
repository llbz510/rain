import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '@/models/db-singleton'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry, type ModelPoolEntry } from '@/settings/model-pool'
import { checkAsrModelCapability } from '@/settings/asr-capability'
import { useRainStore } from '@/store/rain-store'
import { SettingsPage } from '@/ui/components/settings'

vi.mock('@/settings/asr-capability', () => ({
  checkAsrModelCapability: vi.fn(),
}))

const model: ModelPoolEntry = {
  id: 'workflow-whisper',
  alias: 'Workflow Whisper',
  type: 'whisper-local',
  provider: 'local',
  modelName: 'medium',
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

describe('AC-LV-12 settings ASR capability workflow', () => {
  it('persists a passing real-transcription check and unlocks the ASR role option', async () => {
    const record = recordCapabilityCheck({
      model: runtimeModelFromPoolEntry(model),
      role: 'asr',
      ok: true,
      message: 'ASR 能力检查通过',
      checkedAt: 100,
    })
    vi.mocked(checkAsrModelCapability).mockResolvedValue(record)
    act(() => {
      useRainStore.setState({
        modelPool: [model],
        roleAssignment: { asr: null, structuring: null, assistant: null },
        capabilityRecords: [],
      })
    })

    render(<SettingsPage />)

    const asrSelect = screen.getByLabelText('ASR 语音识别') as HTMLSelectElement
    const option = Array.from(asrSelect.options).find((candidate) => candidate.value === model.id)!
    expect(option).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: `检查 ASR ${model.alias}` }))

    await waitFor(() => expect(useRainStore.getState().capabilityRecords).toEqual([record]))
    expect(option).not.toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('ASR 能力检查通过')
  })
})
