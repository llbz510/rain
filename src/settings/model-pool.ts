// src/settings/model-pool.ts

import { getDb } from '@/models/db-singleton'
import { deleteSetting, getSetting, setSetting } from '@/models/database'

export type ModelType = 'llm' | 'asr-api' | 'whisper-local' | 'subtitle'
export type ModelRole = 'asr' | 'structuring' | 'assistant'

export interface ModelPoolEntry {
  id: string
  alias: string
  type: ModelType
  provider: string
  baseUrl?: string
  apiKey?: string
  modelName: string
  supportsVision: boolean
}

export interface AddModelInput {
  type: ModelType
  provider: string
  baseUrl?: string
  apiKey?: string
  modelName: string
  alias: string
  supportsVision: boolean
}

export interface RuntimeModel {
  id: string
  alias: string
  baseUrl?: string
  model: string
  apiKey?: string
  type?: ModelType
  provider?: string
  supportsVision?: boolean
}

export interface RuntimeSettings {
  models: RuntimeModel[]
  roles: Record<ModelRole, string | null>
}

const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const QWEN_MODEL = 'qwen3.5-omni-flash'

const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  models: [
    {
      id: 'whisper-large-v3', alias: 'Whisper large-v3', model: 'large-v3',
      type: 'whisper-local', provider: 'local', supportsVision: false,
    },
    {
      id: 'qwen-main', alias: 'Qwen', baseUrl: QWEN_BASE_URL, model: QWEN_MODEL,
      type: 'llm', provider: 'dashscope', supportsVision: true,
    },
  ],
  roles: { asr: 'whisper-large-v3', structuring: 'qwen-main', assistant: 'qwen-main' },
}

const pool: Map<string, ModelPoolEntry> = new Map()
let idCounter = 0

function generateId(): string {
  idCounter++
  return `model_${Date.now()}_${idCounter}`
}

function toPoolEntry(model: RuntimeModel): ModelPoolEntry {
  return {
    id: model.id,
    alias: model.alias,
    type: model.type ?? (model.id === 'whisper-large-v3' ? 'whisper-local' : 'llm'),
    provider: model.provider ?? (model.id === 'whisper-large-v3' ? 'local' : 'custom'),
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    modelName: model.model,
    supportsVision: model.supportsVision ?? false,
  }
}

function toRuntimeModel(model: ModelPoolEntry): RuntimeModel {
  return {
    id: model.id,
    alias: model.alias,
    baseUrl: model.baseUrl,
    model: model.modelName,
    apiKey: model.apiKey,
    type: model.type,
    provider: model.provider,
    supportsVision: model.supportsVision,
  }
}

function cloneRuntimeSettings(settings: RuntimeSettings): RuntimeSettings {
  return {
    models: settings.models.map((model) => ({ ...model })),
    roles: { ...settings.roles },
  }
}

export function replaceModelPool(entries: ModelPoolEntry[]): void {
  pool.clear()
  for (const entry of entries) {
    pool.set(entry.id, { ...entry })
  }
}

export function addModelToPool(input: AddModelInput): ModelPoolEntry {
  if (input.provider === 'custom' && !input.baseUrl) {
    throw new Error('Custom provider requires baseUrl')
  }

  const entry: ModelPoolEntry = { id: generateId(), ...input }
  pool.set(entry.id, entry)
  return entry
}

export function removeModelFromPool(id: string): void {
  pool.delete(id)
}

export function listModels(): ModelPoolEntry[] {
  return Array.from(pool.values())
}

export function getModelsForRole(role: ModelRole): ModelPoolEntry[] {
  const models = listModels()
  switch (role) {
    case 'asr':
      return models.filter(m => ['asr-api', 'whisper-local', 'subtitle'].includes(m.type))
    case 'structuring':
      return models.filter(m => m.type === 'llm')
    case 'assistant':
      return models.filter(m => m.type === 'llm' && m.supportsVision)
  }
}

export async function saveRuntimeSettings(settings: RuntimeSettings): Promise<void> {
  const db = await getDb()
  const models = settings.models.map(({ apiKey: _apiKey, ...model }) => model)
  await setSetting(db, 'model_pool', JSON.stringify(models))
  await Promise.all(settings.models.map(async (model) => {
    if (model.apiKey) {
      await setSetting(db, `api_key.${model.id}`, model.apiKey)
    } else {
      await deleteSetting(db, `api_key.${model.id}`)
    }
  }))
  await Promise.all((Object.keys(settings.roles) as ModelRole[]).map((role) =>
    setSetting(db, `role_${role}`, settings.roles[role] ?? '')
  ))
}

export async function loadRuntimeSettings(): Promise<RuntimeSettings> {
  const db = await getDb()
  const modelJson = await getSetting(db, 'model_pool')
  let storedModels: RuntimeModel[] | null = null
  if (modelJson) {
    try {
      const parsed = JSON.parse(modelJson)
      if (Array.isArray(parsed)) storedModels = parsed
    } catch {
      storedModels = null
    }
  }

  const models = await Promise.all((storedModels ?? DEFAULT_RUNTIME_SETTINGS.models).map(async (model) => ({
    ...model,
    apiKey: (await getSetting(db, `api_key.${model.id}`)) ?? undefined,
  })))
  const roles = {} as RuntimeSettings['roles']
  for (const role of ['asr', 'structuring', 'assistant'] as const) {
    const savedRole = await getSetting(db, `role_${role}`)
    roles[role] = savedRole === null ? DEFAULT_RUNTIME_SETTINGS.roles[role] : savedRole || null
  }
  return { models, roles }
}

export function applyRuntimeSettings(settings: RuntimeSettings): ModelPoolEntry[] {
  replaceModelPool(settings.models.map(toPoolEntry))
  return listModels()
}

export function runtimeSettingsFromPool(
  roles: RuntimeSettings['roles'],
): RuntimeSettings {
  return { models: listModels().map(toRuntimeModel), roles: { ...roles } }
}

export function getDefaultRuntimeSettings(): RuntimeSettings {
  return cloneRuntimeSettings(DEFAULT_RUNTIME_SETTINGS)
}
