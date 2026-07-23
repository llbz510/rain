import type { LlmSettings } from '@/llm/types'
import { testQwenConnection, type QwenConnectionResult } from '@/llm/qwen-health'
import { tauriInvoke, isTauri as detectTauri } from '@/lib/tauri-env'
import type { RuntimeModel, RuntimeSettings } from '@/settings/model-pool'

export type PreflightStatus = 'ok' | 'warning' | 'error' | 'skipped'
export type PreflightCheckId = 'runtime' | 'roles' | 'whisper' | 'qwen' | 'assistant' | 'database' | 'ytdlp'

export interface PreflightCheck {
  id: PreflightCheckId
  label: string
  status: PreflightStatus
  message: string
}

export interface PreflightReport {
  ready: boolean
  checks: PreflightCheck[]
}

export type PreflightInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export interface RunPreflightCheckInput {
  runtimeSettings: RuntimeSettings
  isTauri?: () => boolean
  invoke?: PreflightInvoke
  testQwen?: (settings: LlmSettings) => Promise<QwenConnectionResult>
  checkDatabaseWrite?: () => Promise<void>
}

const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const QWEN_MODEL = 'qwen3.5-omni-flash'

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? '').replace(/\/+$/, '')
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function resolveInstalledWhisperModel(modelName: string, installedModels: string[]): string | null {
  const saved = modelName.trim()
  if (!saved) return null

  const exact = installedModels.find((entry) => entry === saved)
  if (exact) return exact

  const expectedFilename = /^ggml-.+\.bin$/i.test(saved) ? saved : `ggml-${saved}.bin`
  return installedModels.find((entry) => basename(entry) === expectedFilename) ?? null
}

function roleModel(settings: RuntimeSettings, role: keyof RuntimeSettings['roles']): RuntimeModel | null {
  const id = settings.roles[role]
  if (!id) return null
  return settings.models.find((model) => model.id === id) ?? null
}

function qwenSettingsFrom(model: RuntimeModel): LlmSettings {
  return {
    baseUrl: model.baseUrl ?? '',
    model: model.model,
    apiKey: model.apiKey ?? '',
  }
}

async function defaultDatabaseWriteCheck(): Promise<void> {
  const { getDb } = await import('@/models/db-singleton')
  const { deleteSetting, setSetting } = await import('@/models/database')
  const db = await getDb()
  const key = 'preflight.write_check'
  await setSetting(db, key, new Date().toISOString())
  await deleteSetting(db, key)
}

function hasBlockingError(checks: PreflightCheck[]): boolean {
  return checks.some((check) => check.status === 'error')
}

export async function runPreflightCheck(input: RunPreflightCheckInput): Promise<PreflightReport> {
  const isTauri = input.isTauri ?? detectTauri
  const invoke = input.invoke ?? tauriInvoke
  const checkDatabaseWrite = input.checkDatabaseWrite ?? defaultDatabaseWriteCheck
  const checkQwen = input.testQwen ?? testQwenConnection
  const checks: PreflightCheck[] = []

  const desktopAvailable = isTauri()
  if (!desktopAvailable) {
    checks.push({
      id: 'runtime',
      label: '桌面运行环境',
      status: 'error',
      message: '当前不是 Tauri 桌面运行环境，不能处理本地视频、Whisper 或 SQLite 桌面库。',
    })
  } else {
    try {
      const capability = await invoke('get_runtime_capability')
      const backend = typeof (capability as { whisperBackend?: unknown })?.whisperBackend === 'string'
        ? (capability as { whisperBackend: string }).whisperBackend
        : 'unknown'
      checks.push({
        id: 'runtime',
        label: '桌面运行环境',
        status: backend === 'cuda' || backend === 'cpu' ? 'ok' : 'warning',
        message: `桌面应用可用；Whisper 后端：${backend}`,
      })
    } catch (error) {
      checks.push({
        id: 'runtime',
        label: '桌面运行环境',
        status: 'error',
        message: `无法读取桌面运行能力：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  const asrModel = roleModel(input.runtimeSettings, 'asr')
  const structuringModel = roleModel(input.runtimeSettings, 'structuring')
  const assistantModel = roleModel(input.runtimeSettings, 'assistant')
  const missingRoles = [
    !asrModel ? 'ASR' : '',
    !structuringModel ? '结构化' : '',
  ].filter(Boolean)

  if (missingRoles.length > 0) {
    checks.push({
      id: 'roles',
      label: '模型角色',
      status: 'error',
      message: `缺少模型角色：${missingRoles.join('、')}。`,
    })
  } else if (asrModel?.type !== 'whisper-local') {
    checks.push({
      id: 'roles',
      label: '模型角色',
      status: 'error',
      message: '本地视频流程要求 ASR 角色使用本地 Whisper 模型。',
    })
  } else {
    checks.push({
      id: 'roles',
      label: '模型角色',
      status: 'ok',
      message: 'ASR、结构化角色都已选择。',
    })
  }

  if (!desktopAvailable) {
    checks.push({
      id: 'whisper',
      label: '本地 Whisper',
      status: 'skipped',
      message: '未在桌面环境中，跳过 Whisper 模型文件检查。',
    })
  } else if (!asrModel || asrModel.type !== 'whisper-local') {
    checks.push({
      id: 'whisper',
      label: '本地 Whisper',
      status: 'error',
      message: '没有可用的本地 Whisper ASR 模型角色。',
    })
  } else {
    try {
      const listed = await invoke('list_whisper_models')
      if (!Array.isArray(listed) || listed.some((entry) => typeof entry !== 'string')) {
        throw new Error('list_whisper_models 返回了无效数据')
      }
      const installed = resolveInstalledWhisperModel(asrModel.model, listed as string[])
      if (!installed) {
        const expected = /^ggml-.+\.bin$/i.test(asrModel.model) ? asrModel.model : `ggml-${asrModel.model}.bin`
        checks.push({
          id: 'whisper',
          label: '本地 Whisper',
          status: 'error',
          message: `没有找到 ${expected}，请先下载 Whisper 模型。`,
        })
      } else {
        checks.push({
          id: 'whisper',
          label: '本地 Whisper',
          status: 'ok',
          message: `已找到 ${basename(installed)}。`,
        })
      }
    } catch (error) {
      checks.push({
        id: 'whisper',
        label: '本地 Whisper',
        status: 'error',
        message: `Whisper 模型检查失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  const structuringQwenConfigured = Boolean(structuringModel)
    && normalizeBaseUrl(structuringModel?.baseUrl) === QWEN_BASE_URL
    && structuringModel?.model === QWEN_MODEL
  if (!structuringQwenConfigured || !structuringModel) {
    checks.push({
      id: 'qwen',
      label: 'Qwen/DashScope',
      status: 'error',
      message: `结构化模型必须使用 ${QWEN_MODEL}（${QWEN_BASE_URL}）。`,
    })
  } else if (!structuringModel.apiKey?.trim()) {
    checks.push({
      id: 'qwen',
      label: 'Qwen/DashScope',
      status: 'error',
      message: 'Qwen API Key 为空，请在模型设置中保存密钥。',
    })
  } else {
    const result = await checkQwen(qwenSettingsFrom(structuringModel))
    checks.push({
      id: 'qwen',
      label: 'Qwen/DashScope',
      status: result.ok ? 'ok' : 'error',
      message: result.message,
    })
  }

  if (!assistantModel) {
    checks.push({
      id: 'assistant',
      label: 'AI 助手',
      status: 'warning',
      message: '未选择助手模型；本地视频处理不受影响，但学习页 AI 助手可能不可用。',
    })
  } else if (normalizeBaseUrl(assistantModel.baseUrl) !== QWEN_BASE_URL || assistantModel.model !== QWEN_MODEL) {
    checks.push({
      id: 'assistant',
      label: 'AI 助手',
      status: 'warning',
      message: `助手不是 ${QWEN_MODEL}；本地视频处理不受影响，但 AI 助手可能不可用或表现不一致。`,
    })
  } else if (!assistantModel.apiKey?.trim()) {
    checks.push({
      id: 'assistant',
      label: 'AI 助手',
      status: 'warning',
      message: '助手模型没有 API Key；本地视频处理不受影响，但 AI 助手可能不可用。',
    })
  } else {
    checks.push({
      id: 'assistant',
      label: 'AI 助手',
      status: 'ok',
      message: '助手模型已配置。',
    })
  }

  try {
    await checkDatabaseWrite()
    checks.push({
      id: 'database',
      label: '数据库写入',
      status: 'ok',
      message: 'SQLite 设置表可写。',
    })
  } catch (error) {
    checks.push({
      id: 'database',
      label: '数据库写入',
      status: 'error',
      message: `数据库写入检查失败：${error instanceof Error ? error.message : String(error)}`,
    })
  }

  if (!desktopAvailable) {
    checks.push({
      id: 'ytdlp',
      label: '在线视频工具',
      status: 'skipped',
      message: '未在桌面环境中，跳过 yt-dlp 检查。',
    })
  } else {
    try {
      const result = await invoke('check_ytdlp_command')
      const available = Boolean((result as { available?: unknown })?.available)
      const version = (result as { version?: unknown })?.version
      checks.push({
        id: 'ytdlp',
        label: '在线视频工具',
        status: available ? 'ok' : 'warning',
        message: available
          ? `yt-dlp 可用${typeof version === 'string' && version ? `（${version}）` : ''}。`
          : 'yt-dlp 不可用；本地视频流程不受影响，在线视频导入会不可用。',
      })
    } catch (error) {
      checks.push({
        id: 'ytdlp',
        label: '在线视频工具',
        status: 'warning',
        message: `yt-dlp 检查失败；本地视频流程不受影响：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  return {
    ready: !hasBlockingError(checks),
    checks,
  }
}
