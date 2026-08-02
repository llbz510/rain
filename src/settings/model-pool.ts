// src/settings/model-pool.ts

import { getDb } from '@/models/db-singleton'
import {
  applySettingMutationsAtomically,
  getSetting,
  type SettingMutation,
} from '@/models/database'
import { parseCapabilityRecords, type ModelCapabilityRecord } from '@/settings/model-capabilities'
import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from '@/settings/default-runtime'

export type ModelType = 'llm' | 'asr-api' | 'whisper-local' | 'subtitle'
export type ModelRole = 'asr' | 'structuring' | 'assistant'
export type WhisperBackendPreference = 'auto' | 'cuda' | 'cpu'

export function normalizeWhisperBackendPreference(
  value: unknown,
): WhisperBackendPreference {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return normalized === 'cuda' || normalized === 'cpu' ? normalized : 'auto'
}

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
  whisperBackendPreference?: WhisperBackendPreference
}

export interface RuntimeSettings {
  models: RuntimeModel[]
  roles: Record<ModelRole, string | null>
  capabilities?: ModelCapabilityRecord[]
  whisperBackendPreference?: WhisperBackendPreference
}

export type RuntimeSettingsInitialization =
  | { ok: true; ready: true; settings: RuntimeSettings }
  | { ok: false; ready: false; error: string }

export function createRuntimeSettingsInitializer(
  loader: () => Promise<RuntimeSettings>,
): { initialize: () => Promise<RuntimeSettingsInitialization>; retry: () => Promise<RuntimeSettingsInitialization>; state: () => RuntimeSettingsInitialization | null } {
  let promise: Promise<RuntimeSettingsInitialization> | null = null
  let current: RuntimeSettingsInitialization | null = null
  const initialize = () => {
    if (!promise) {
      promise = loader()
        .then((settings) => (current = { ok: true, ready: true, settings }))
        .catch((error) => (current = { ok: false, ready: false, error: error instanceof Error ? error.message : String(error) }))
    }
    return promise
  }
  return {
    initialize,
    retry: () => { promise = null; return initialize() },
    state: () => current,
  }
}
const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  models: [
    {
      id: 'whisper-large-v3', alias: 'Whisper large-v3', model: 'large-v3',
      type: 'whisper-local', provider: 'local', supportsVision: false,
    },
    {
      id: 'qwen-main', alias: 'Qwen', baseUrl: DEFAULT_LLM_BASE_URL, model: DEFAULT_LLM_MODEL,
      type: 'llm', provider: 'dashscope', supportsVision: false,
    },
  ],
  roles: { asr: 'whisper-large-v3', structuring: 'qwen-main', assistant: 'qwen-main' },
  capabilities: [],
  whisperBackendPreference: 'auto',
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

export function runtimeModelFromPoolEntry(
  model: ModelPoolEntry,
  whisperBackendPreference: WhisperBackendPreference = 'auto',
): RuntimeModel {
  return {
    id: model.id,
    alias: model.alias,
    baseUrl: model.baseUrl,
    model: model.modelName,
    apiKey: model.apiKey,
    type: model.type,
    provider: model.provider,
    supportsVision: model.supportsVision,
    ...(model.type === 'whisper-local' ? { whisperBackendPreference } : {}),
  }
}

function cloneRuntimeSettings(settings: RuntimeSettings): RuntimeSettings {
  return {
    models: settings.models.map((model) => ({ ...model })),
    roles: { ...settings.roles },
    capabilities: settings.capabilities?.map((record) => ({ ...record })),
    whisperBackendPreference: normalizeWhisperBackendPreference(
      settings.whisperBackendPreference,
    ),
  }
}

export function replaceModelPool(entries: ModelPoolEntry[]): void {
  pool.clear()
  for (const entry of entries) {
    pool.set(entry.id, { ...entry })
  }
}

export function createModelPoolEntry(input: AddModelInput): ModelPoolEntry {
  if (input.provider === 'custom' && !input.baseUrl) {
    throw new Error('Custom provider requires baseUrl')
  }

  return { id: generateId(), ...input }
}

export function addModelToPool(input: AddModelInput): ModelPoolEntry {
  const entry = createModelPoolEntry(input)
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
      return models.filter(m => m.type === 'llm')
  }
}

export async function saveRuntimeSettings(settings: RuntimeSettings): Promise<void> {
  const db = await getDb()
  const priorJson = await getSetting(db, 'model_pool')
  const priorIds = priorJson ? (() => {
    try {
      const parsed = JSON.parse(priorJson)
      return Array.isArray(parsed) ? parsed.map((model) => model?.id).filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  })() : []
  const models = settings.models.map(({
    apiKey: _apiKey,
    whisperBackendPreference: _whisperBackendPreference,
    ...model
  }) => model)
  const modelIds = new Set(settings.models.map(model => model.id))
  const mutations: SettingMutation[] = [
    { op: 'set', key: 'model_pool', value: JSON.stringify(models) },
    ...priorIds
      .filter((id) => !modelIds.has(id))
      .map((id): SettingMutation => ({ op: 'delete', key: `api_key.${id}` })),
    ...settings.models.map((model): SettingMutation => model.apiKey
      ? { op: 'set', key: `api_key.${model.id}`, value: model.apiKey }
      : { op: 'delete', key: `api_key.${model.id}` }),
    ...(Object.keys(settings.roles) as ModelRole[]).map((role): SettingMutation => ({
      op: 'set',
      key: `role_${role}`,
      value: settings.roles[role] ?? '',
    })),
    {
      op: 'set',
      key: 'model_capabilities',
      value: JSON.stringify(settings.capabilities ?? []),
    },
    {
      op: 'set',
      key: 'whisper_backend_preference',
      value: normalizeWhisperBackendPreference(settings.whisperBackendPreference),
    },
  ]
  await applySettingMutationsAtomically(db, mutations)
}
interface ParsedStoredModel {
  model: RuntimeModel
  embeddedApiKey?: string
  legacy: boolean
}

function parseStoredModels(modelJson: string): ParsedStoredModel[] | null {
  try {
    const parsed: unknown = JSON.parse(modelJson)
    if (!Array.isArray(parsed)) return null
    const models: ParsedStoredModel[] = []
    for (const value of parsed) {
      if (!value || typeof value !== 'object') return null
      const entry = value as Record<string, unknown>
      const id = typeof entry.id === 'string' ? entry.id : null
      const alias = typeof entry.alias === 'string' ? entry.alias : null
      const model = typeof entry.model === 'string'
        ? entry.model
        : typeof entry.modelName === 'string' ? entry.modelName : null
      if (!id || !alias || !model) return null
      models.push({
        model: {
          id,
          alias,
          model,
          baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : undefined,
          type: entry.type as ModelType | undefined,
          provider: typeof entry.provider === 'string' ? entry.provider : undefined,
          supportsVision: typeof entry.supportsVision === 'boolean' ? entry.supportsVision : undefined,
        },
        embeddedApiKey: typeof entry.apiKey === 'string' ? entry.apiKey : undefined,
        legacy: typeof entry.modelName === 'string' || Object.prototype.hasOwnProperty.call(entry, 'apiKey'),
      })
    }
    return models
  } catch {
    return null
  }
}


export interface RuntimeSettingsMigrationPlan {
  canonicalKeys: Array<{ id: string; key: string }>
  sanitizedModels: Array<Omit<RuntimeModel, 'apiKey'>>
  aliasesToDelete: string[]
}

export interface RuntimeSettingsMigrationPersistence {
  apply: (mutations: SettingMutation[]) => Promise<void>
}

export async function executeRuntimeSettingsMigration(
  plan: RuntimeSettingsMigrationPlan,
  persistence: RuntimeSettingsMigrationPersistence,
): Promise<void> {
  await persistence.apply([
    ...plan.canonicalKeys.map(({ id, key }): SettingMutation => ({
      op: 'set',
      key: `api_key.${id}`,
      value: key,
    })),
    {
      op: 'set',
      key: 'model_pool',
      value: JSON.stringify(plan.sanitizedModels),
    },
    ...plan.aliasesToDelete.map((alias): SettingMutation => ({
      op: 'delete',
      key: `api_key.${alias}`,
    })),
  ])
}
export async function loadRuntimeSettings(): Promise<RuntimeSettings> {
  const db = await getDb()
  const modelJson = await getSetting(db, 'model_pool')
  const parsedModels = modelJson ? parseStoredModels(modelJson) : null
  const loadedModels: ParsedStoredModel[] = parsedModels ?? DEFAULT_RUNTIME_SETTINGS.models.map(model => ({ model, embeddedApiKey: undefined, legacy: false }))
  const canonicalIds = new Set(loadedModels.map(({ model }) => model.id))
  const models = await Promise.all(loadedModels.map(async ({ model, embeddedApiKey, legacy }) => {
    const canonicalKey = await getSetting(db, `api_key.${model.id}`)
    const eligibleAlias = !canonicalIds.has(model.alias)
    const legacyKey = eligibleAlias ? await getSetting(db, `api_key.${model.alias}`) : null
    return {
      model: { ...model, apiKey: canonicalKey ?? embeddedApiKey ?? legacyKey ?? undefined },
      migrate: Boolean(parsedModels) && (legacy || legacyKey !== null || embeddedApiKey !== undefined),
    }
  }))

  if (parsedModels && models.some(({ migrate }) => migrate)) {
    const canonicalIds = new Set(models.map(({ model }) => model.id))
    const sanitizedModels = models.map(({ model }) => {
      const { apiKey: _apiKey, ...sanitized } = model
      return sanitized
    })
    const migrationPlan: RuntimeSettingsMigrationPlan = {
      canonicalKeys: models.flatMap(({ model }) => model.apiKey ? [{ id: model.id, key: model.apiKey }] : []),
      sanitizedModels,
      aliasesToDelete: models
        .filter(({ migrate }) => migrate)
        .map(({ model }) => model.alias)
        .filter(alias => !canonicalIds.has(alias)),
    }
    await executeRuntimeSettingsMigration(migrationPlan, {
      apply: (mutations) => applySettingMutationsAtomically(db, mutations),
    })
  }

  const roles = {} as RuntimeSettings['roles']
  for (const role of ['asr', 'structuring', 'assistant'] as const) {
    const savedRole = await getSetting(db, `role_${role}`)
    roles[role] = savedRole === null ? DEFAULT_RUNTIME_SETTINGS.roles[role] : savedRole || null
  }
  const capabilities = parseCapabilityRecords(await getSetting(db, 'model_capabilities'))
  const whisperBackendPreference = normalizeWhisperBackendPreference(
    await getSetting(db, 'whisper_backend_preference'),
  )
  return {
    models: models.map(({ model }) => model),
    roles,
    capabilities,
    whisperBackendPreference,
  }
}
export function applyRuntimeSettings(settings: RuntimeSettings): ModelPoolEntry[] {
  replaceModelPool(settings.models.map(toPoolEntry))
  return listModels()
}

export function runtimeSettingsFromPool(
  roles: RuntimeSettings['roles'],
  capabilities: ModelCapabilityRecord[] = [],
  whisperBackendPreference: WhisperBackendPreference = 'auto',
): RuntimeSettings {
  return runtimeSettingsFromEntries(
    listModels(),
    roles,
    capabilities,
    whisperBackendPreference,
  )
}

export function runtimeSettingsFromEntries(
  entries: ModelPoolEntry[],
  roles: RuntimeSettings['roles'],
  capabilities: ModelCapabilityRecord[] = [],
  whisperBackendPreference: WhisperBackendPreference = 'auto',
): RuntimeSettings {
  return {
    models: entries.map((entry) => runtimeModelFromPoolEntry(
      entry,
      whisperBackendPreference,
    )),
    roles: { ...roles },
    capabilities: capabilities.map((record) => ({ ...record })),
    whisperBackendPreference,
  }
}

export function getDefaultRuntimeSettings(): RuntimeSettings {
  return cloneRuntimeSettings(DEFAULT_RUNTIME_SETTINGS)
}
