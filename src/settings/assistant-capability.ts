import { redactSecret, streamAiChat as defaultStreamAiChat } from '@/llm/client'
import type { ChatMessage, LlmSettings, StreamCallbacks } from '@/llm/types'
import {
  recordCapabilityCheck,
  type ModelCapabilityRecord,
} from '@/settings/model-capabilities'
import type { RuntimeModel } from '@/settings/model-pool'

export const ASSISTANT_CAPABILITY_TOKEN = 'RAIN_ASSISTANT_OK'

type AssistantStream = (
  messages: ChatMessage[],
  settings: LlmSettings,
  callbacks: StreamCallbacks,
) => () => void

interface AssistantCapabilityOptions {
  stream?: AssistantStream
  timeoutMs?: number
  checkedAt?: number
}

function validateAssistantModel(model: RuntimeModel): void {
  if (model.type !== 'llm') throw new Error('助手角色需要 LLM 模型。')
  if (!model.baseUrl?.trim()) throw new Error('助手模型 endpoint 不能为空。')
  if (!model.model.trim()) throw new Error('助手模型名称不能为空。')
  if (!model.apiKey?.trim()) throw new Error('助手模型 API Key 不能为空。')
}

function runAssistantProbe(
  model: RuntimeModel,
  stream: AssistantStream,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = ''
    let cleanup: (() => void) | null = null
    let settled = false

    const finish = (result: { ok: true; content: string } | { ok: false; error: Error }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup?.()
      if (result.ok) resolve(result.content)
      else reject(result.error)
    }

    const timer = setTimeout(() => {
      finish({ ok: false, error: new Error('助手流式能力检查超时。') })
    }, timeoutMs)

    try {
      const nextCleanup = stream(
        [
          {
            role: 'system',
            content: `Reply with exactly ${ASSISTANT_CAPABILITY_TOKEN} and nothing else.`,
          },
          { role: 'user', content: 'Run the Rain text assistant capability check.' },
        ],
        {
          baseUrl: model.baseUrl!,
          apiKey: model.apiKey!,
          model: model.model,
        },
        {
          onToken: (token) => {
            if (!settled) content += token
          },
          onDone: (fullText) => {
            finish({ ok: true, content: fullText || content })
          },
          onError: (error) => {
            finish({ ok: false, error })
          },
        },
      )
      cleanup = nextCleanup
      if (settled) cleanup()
    } catch (error) {
      finish({
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  })
}

export async function checkAssistantModelCapability(
  model: RuntimeModel,
  options: AssistantCapabilityOptions = {},
): Promise<ModelCapabilityRecord> {
  try {
    validateAssistantModel(model)
    const output = await runAssistantProbe(
      model,
      options.stream ?? defaultStreamAiChat,
      options.timeoutMs ?? 20_000,
    )
    if (output.trim() !== ASSISTANT_CAPABILITY_TOKEN) {
      throw new Error('助手没有返回能力契约要求的精确响应。')
    }
    return recordCapabilityCheck({
      model,
      role: 'assistant',
      ok: true,
      message: '文本助手能力检查通过：流式响应和指令遵循有效；不包含 vision 能力。',
      checkedAt: options.checkedAt,
    })
  } catch (error) {
    const message = redactSecret(
      error instanceof Error ? error.message : String(error),
      [model.apiKey ?? ''],
    )
    return recordCapabilityCheck({
      model,
      role: 'assistant',
      ok: false,
      message: `文本助手能力检查失败：${message || '未知错误'}`,
      checkedAt: options.checkedAt,
    })
  }
}
