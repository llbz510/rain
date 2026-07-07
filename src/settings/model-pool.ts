// src/settings/model-pool.ts
// ========================================
// 模型池管理（决策82）
// ========================================

export type ModelType = 'llm' | 'asr-api' | 'whisper-local' | 'subtitle'

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

// 模块级单例
const pool: Map<string, ModelPoolEntry> = new Map()
let idCounter = 0

function generateId(): string {
  idCounter++
  return `model_${Date.now()}_${idCounter}`
}

const VALID_WHISPER_SIZES = ['tiny', 'base', 'small', 'medium', 'large-v3']

export function addModelToPool(input: AddModelInput): ModelPoolEntry {
  // 自定义供应商需要 baseUrl
  if (input.provider === 'custom' && !input.baseUrl) {
    throw new Error('Custom provider requires baseUrl')
  }

  const id = generateId()
  const entry: ModelPoolEntry = {
    id,
    alias: input.alias,
    type: input.type,
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    modelName: input.modelName,
    supportsVision: input.supportsVision,
  }
  pool.set(id, entry)
  return entry
}

export function removeModelFromPool(id: string): void {
  pool.delete(id)
}

export function listModels(): ModelPoolEntry[] {
  return Array.from(pool.values())
}

export function getModelsForRole(role: 'asr' | 'structuring' | 'assistant'): ModelPoolEntry[] {
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
