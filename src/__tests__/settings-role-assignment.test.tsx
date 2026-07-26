import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import type { ModelPoolEntry, RuntimeModel } from '@/settings/model-pool'
import { useRainStore } from '@/store/rain-store'
import { RoleSelector } from '@/ui/components/settings'

const poolModel: ModelPoolEntry = {
  id: 'llm-main',
  alias: 'Main LLM',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'sk-role-secret',
  modelName: 'model-a',
  supportsVision: false,
}

const runtimeModel: RuntimeModel = {
  ...poolModel,
  model: poolModel.modelName,
}

function configureStore(capabilityRecords = useRainStore.getState().capabilityRecords) {
  act(() => {
    useRainStore.setState({
      modelPool: [poolModel],
      roleAssignment: { asr: null, structuring: null, assistant: null },
      capabilityRecords,
    })
  })
}

afterEach(() => {
  act(() => {
    useRainStore.setState({
      modelPool: [],
      roleAssignment: { asr: null, structuring: null, assistant: null },
      capabilityRecords: [],
    })
  })
})

describe('AC-LV-12 role assignment gate', () => {
  it('rejects a direct store assignment when the role capability is unavailable', () => {
    configureStore([])

    const result = useRainStore.getState().setRoleModel('structuring', poolModel.id)

    expect(result).toMatchObject({ ok: false })
    expect(useRainStore.getState().roleAssignment.structuring).toBeNull()
  })

  it('accepts a direct store assignment after the matching role check passes', () => {
    const capability = recordCapabilityCheck({
      model: runtimeModel,
      role: 'structuring',
      ok: true,
      message: 'Stage2 contract passed',
      checkedAt: 100,
    })
    configureStore([capability])

    const result = useRainStore.getState().setRoleModel('structuring', poolModel.id)

    expect(result).toMatchObject({ ok: true })
    expect(useRainStore.getState().roleAssignment.structuring).toBe(poolModel.id)
  })

  it('disables an unavailable model in the matching role selector', () => {
    configureStore([])

    render(<RoleSelector models={[poolModel]} />)

    const selector = screen.getByLabelText('结构化 LLM')
    const option = within(selector).getByRole('option', { name: poolModel.alias }) as HTMLOptionElement
    expect(option).toBeDisabled()
  })

  it('keeps a legacy assignment visible while explaining that it is unavailable', () => {
    configureStore([])
    act(() => {
      useRainStore.setState({
        roleAssignment: { asr: null, structuring: poolModel.id, assistant: null },
      })
    })

    render(<RoleSelector models={[poolModel]} />)

    expect(screen.getByText(/Unavailable.*尚未执行该角色的能力检查/)).toBeInTheDocument()
  })
})
