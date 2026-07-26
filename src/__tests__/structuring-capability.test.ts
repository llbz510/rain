import { describe, expect, it, vi } from 'vitest'
import type { Stage2BlockOutput, Stage2InputBlock } from '@/pipeline/stage2-contract'
import { checkStructuringModelCapability } from '@/settings/structuring-capability'
import type { RuntimeModel } from '@/settings/model-pool'

const model: RuntimeModel = {
  id: 'generic-llm',
  alias: 'Generic LLM',
  type: 'llm',
  provider: 'custom',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'sk-structuring-secret',
  model: 'model-a',
  supportsVision: false,
}

function validOutput(block: Stage2InputBlock): Stage2BlockOutput {
  const first = block.sentences[0].id
  const last = block.sentences.at(-1)!.id
  const chapterId = `${block.blockId}:node:chapter`
  const sectionId = `${block.blockId}:node:section`
  return {
    blockId: block.blockId,
    nodes: [
      {
        id: chapterId,
        parentId: null,
        kind: 'chapter',
        title: 'Capability check',
        startSentenceId: first,
        endSentenceId: last,
      },
      {
        id: sectionId,
        parentId: chapterId,
        kind: 'section',
        title: 'Contract',
        startSentenceId: first,
        endSentenceId: last,
      },
      {
        id: `${block.blockId}:node:paragraph`,
        parentId: sectionId,
        kind: 'paragraph',
        title: 'Exact sentence coverage',
        type: 'concept',
        startSentenceId: first,
        endSentenceId: last,
      },
    ],
    coveredSentenceIds: block.sentences.map((sentence) => sentence.id),
  }
}

describe('AC-LV-12 structuring capability check', () => {
  it('records Compatible only after the model passes the production Stage2 contract', async () => {
    const caller = vi.fn(async (_prompt, payload) => {
      const block = JSON.parse(payload) as Stage2InputBlock
      return validOutput(block)
    })

    const record = await checkStructuringModelCapability(model, { callStage2: caller, checkedAt: 100 })

    expect(record).toMatchObject({
      modelId: model.id,
      role: 'structuring',
      status: 'Compatible',
      checkedAt: 100,
    })
    expect(caller).toHaveBeenCalledWith(
      expect.stringContaining('coveredSentenceIds'),
      expect.any(String),
      {
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        model: model.model,
      },
      undefined,
    )
    expect(JSON.stringify(record)).not.toContain(model.apiKey)
  })

  it('records Unavailable when the response does not satisfy the Stage2 schema', async () => {
    const record = await checkStructuringModelCapability(model, {
      callStage2: vi.fn().mockResolvedValue('not structured output'),
      checkedAt: 100,
    })

    expect(record).toMatchObject({
      role: 'structuring',
      status: 'Unavailable',
    })
    expect(record.message).toMatch(/Stage2|结构化/)
  })

  it('redacts the API key from capability failures', async () => {
    const record = await checkStructuringModelCapability(model, {
      callStage2: vi.fn().mockRejectedValue(new Error(`HTTP 401 ${model.apiKey}`)),
      checkedAt: 100,
    })

    expect(record.status).toBe('Unavailable')
    expect(JSON.stringify(record)).not.toContain(model.apiKey)
  })
})
