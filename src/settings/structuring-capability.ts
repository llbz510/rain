import { callStage2 as defaultCallStage2, redactSecret } from '@/llm/client'
import type { Sentence } from '@/models/types'
import {
  normalizeStage2BlockOutputCandidate,
  validateStage2BlockOutput,
} from '@/pipeline/stage2-contract'
import {
  buildStage2Blocks,
  STAGE2_BLOCK_SYSTEM_PROMPT,
  type Stage2ModelCaller,
} from '@/pipeline/stage2-runner'
import { recordCapabilityCheck, type ModelCapabilityRecord } from '@/settings/model-capabilities'
import type { RuntimeModel } from '@/settings/model-pool'

const PROBE_VIDEO_ID = 'rain-structuring-capability'
const PROBE_SENTENCES: Sentence[] = [
  {
    id: 'cap-s1',
    nodeId: PROBE_VIDEO_ID,
    text: 'Rain keeps every source sentence identifiable.',
    startTime: 0,
    endTime: 1,
    sortOrder: 0,
  },
  {
    id: 'cap-s2',
    nodeId: PROBE_VIDEO_ID,
    text: 'A valid outline must cover each sentence exactly once.',
    startTime: 1,
    endTime: 2,
    sortOrder: 1,
  },
]

export interface CheckStructuringModelCapabilityOptions {
  callStage2?: Stage2ModelCaller
  checkedAt?: number
  signal?: AbortSignal
}

function modelSettings(model: RuntimeModel) {
  if (model.type && model.type !== 'llm') throw new Error('结构化角色需要 LLM 模型。')
  if (!model.baseUrl?.trim()) throw new Error('结构化模型缺少 API 地址。')
  if (!model.apiKey?.trim()) throw new Error('结构化模型缺少 API Key。')
  if (!model.model.trim()) throw new Error('结构化模型名称为空。')
  return {
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: model.model,
  }
}

export async function checkStructuringModelCapability(
  model: RuntimeModel,
  options: CheckStructuringModelCapabilityOptions = {},
): Promise<ModelCapabilityRecord> {
  try {
    const settings = modelSettings(model)
    const block = buildStage2Blocks(PROBE_VIDEO_ID, PROBE_SENTENCES)[0]
    const payload = JSON.stringify({
      blockId: block.blockId,
      videoId: block.videoId,
      sentences: block.sentences.map(({ id, startTime, endTime, text }) => ({
        id,
        startTime,
        endTime,
        text,
      })),
    })
    const caller = options.callStage2 ?? defaultCallStage2
    const output = await caller(
      STAGE2_BLOCK_SYSTEM_PROMPT,
      payload,
      settings,
      options.signal,
    )
    const normalized = normalizeStage2BlockOutputCandidate(output, block)
    const errors = validateStage2BlockOutput(block, normalized)
    if (errors.length > 0) {
      throw new Error(`Stage2 结构化契约失败：${errors.join('; ')}`)
    }
    return recordCapabilityCheck({
      model,
      role: 'structuring',
      ok: true,
      message: '结构化能力检查通过：Stage2 契约及 sentence ID 覆盖有效。',
      checkedAt: options.checkedAt,
    })
  } catch (error) {
    const message = redactSecret(
      error instanceof Error ? error.message : String(error),
      [model.apiKey ?? ''],
    )
    return recordCapabilityCheck({
      model,
      role: 'structuring',
      ok: false,
      message: `结构化能力检查失败：${message || '未知错误'}`,
      checkedAt: options.checkedAt,
    })
  }
}
