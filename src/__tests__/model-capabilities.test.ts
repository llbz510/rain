import { describe, expect, it } from 'vitest'
import {
  assessModelCapability,
  decideModelRoleAssignment,
  mergeCapabilityRecords,
  recordCapabilityCheck,
} from '@/settings/model-capabilities'
import type { RuntimeModel } from '@/settings/model-pool'

const model: RuntimeModel = {
  id: 'assistant-main',
  alias: 'Assistant',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1/',
  model: 'model-a',
  apiKey: 'sk-capability-secret',
  supportsVision: false,
}

describe('AC-LV-12 model capability records', () => {
  it('records a successful role check as Compatible without storing the API key', () => {
    const record = recordCapabilityCheck({
      model,
      role: 'assistant',
      ok: true,
      message: 'Text request passed',
      checkedAt: 100,
    })

    expect(record).toMatchObject({
      modelId: model.id,
      role: 'assistant',
      status: 'Compatible',
      checkedAt: 100,
    })
    expect(JSON.stringify(record)).not.toContain(model.apiKey)
    expect(assessModelCapability(model, 'assistant', [record]).status).toBe('Compatible')
  })

  it('requires real evidence before a passing check can be recorded as Verified', () => {
    expect(() => recordCapabilityCheck({
      model,
      role: 'assistant',
      ok: true,
      message: 'Passed',
      checkedAt: 100,
      verified: true,
    })).toThrow(/evidence/i)

    const record = recordCapabilityCheck({
      model,
      role: 'assistant',
      ok: true,
      message: 'Full Rain E2E passed',
      checkedAt: 100,
      verified: true,
      evidenceId: 'rain-real-e2e-20260720-024848',
    })

    expect(record.status).toBe('Verified')
    expect(record.evidenceId).toBe('rain-real-e2e-20260720-024848')
  })

  it('invalidates an old result when endpoint, model name, or API key changes', () => {
    const record = recordCapabilityCheck({
      model,
      role: 'assistant',
      ok: true,
      message: 'Passed',
      checkedAt: 100,
    })

    for (const changed of [
      { ...model, baseUrl: 'https://other.example.test/v1' },
      { ...model, model: 'model-b' },
      { ...model, apiKey: 'sk-new-secret' },
    ]) {
      expect(assessModelCapability(changed, 'assistant', [record])).toMatchObject({
        status: 'Unavailable',
        stale: true,
      })
    }
  })

  it('records a failed role check as Unavailable', () => {
    const record = recordCapabilityCheck({
      model,
      role: 'assistant',
      ok: false,
      message: 'HTTP 401',
      checkedAt: 100,
    })

    expect(assessModelCapability(model, 'assistant', [record])).toMatchObject({
      status: 'Unavailable',
      stale: false,
      message: 'HTTP 401',
    })
  })

  it('replaces the checked model-role record without erasing unrelated checks', () => {
    const priorAssistant = recordCapabilityCheck({
      model,
      role: 'assistant',
      ok: false,
      message: 'Old result',
      checkedAt: 100,
    })
    const structuring = recordCapabilityCheck({
      model,
      role: 'structuring',
      ok: true,
      message: 'Keep me',
      checkedAt: 100,
    })
    const nextAssistant = recordCapabilityCheck({
      model,
      role: 'assistant',
      ok: true,
      message: 'New result',
      checkedAt: 200,
    })

    expect(mergeCapabilityRecords(
      [priorAssistant, structuring],
      [nextAssistant],
    )).toEqual([structuring, nextAssistant])
  })

  it('allows role assignment only for a current Compatible or Verified record', () => {
    expect(decideModelRoleAssignment(model, 'assistant', [])).toMatchObject({
      allowed: false,
      capability: { status: 'Unavailable' },
    })

    const compatible = recordCapabilityCheck({
      model,
      role: 'assistant',
      ok: true,
      message: 'Text role check passed',
      checkedAt: 100,
    })
    expect(decideModelRoleAssignment(model, 'assistant', [compatible])).toMatchObject({
      allowed: true,
      capability: { status: 'Compatible' },
    })

    expect(decideModelRoleAssignment(
      { ...model, apiKey: 'sk-changed-secret' },
      'assistant',
      [compatible],
    )).toMatchObject({
      allowed: false,
      capability: { status: 'Unavailable', stale: true },
    })
  })
})
