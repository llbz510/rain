import type { ModelRole, RuntimeModel } from '@/settings/model-pool'

export type ModelCapabilityStatus = 'Compatible' | 'Verified' | 'Unavailable'

export interface ModelCapabilityRecord {
  modelId: string
  modelAlias: string
  role: ModelRole
  status: ModelCapabilityStatus
  message: string
  checkedAt: number
  fingerprint: string
  evidenceId?: string
}

export interface ModelCapabilityAssessment extends ModelCapabilityRecord {
  stale: boolean
}

export interface ModelRoleAssignmentDecision {
  allowed: boolean
  capability: ModelCapabilityAssessment
}

export interface RecordCapabilityCheckInput {
  model: RuntimeModel
  role: ModelRole
  ok: boolean
  message: string
  checkedAt?: number
  verified?: boolean
  evidenceId?: string
}

const MODEL_ROLES: ModelRole[] = ['asr', 'structuring', 'assistant']
const CAPABILITY_STATUSES: ModelCapabilityStatus[] = ['Compatible', 'Verified', 'Unavailable']

function isCapabilityRecord(value: unknown): value is ModelCapabilityRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.modelId === 'string'
    && typeof record.modelAlias === 'string'
    && MODEL_ROLES.includes(record.role as ModelRole)
    && CAPABILITY_STATUSES.includes(record.status as ModelCapabilityStatus)
    && typeof record.message === 'string'
    && typeof record.checkedAt === 'number'
    && Number.isFinite(record.checkedAt)
    && record.checkedAt >= 0
    && typeof record.fingerprint === 'string'
    && (record.evidenceId === undefined || typeof record.evidenceId === 'string')
    && (record.status !== 'Verified' || Boolean((record.evidenceId as string | undefined)?.trim()))
  )
}

export function parseCapabilityRecords(value: string | null): ModelCapabilityRecord[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCapabilityRecord).map((record) => ({ ...record }))
  } catch {
    return []
  }
}

export function mergeCapabilityRecords(
  current: ModelCapabilityRecord[],
  updates: ModelCapabilityRecord[],
): ModelCapabilityRecord[] {
  const updatedKeys = new Set(updates.map((record) => `${record.modelId}:${record.role}`))
  return [
    ...current
      .filter((record) => !updatedKeys.has(`${record.modelId}:${record.role}`))
      .map((record) => ({ ...record })),
    ...updates.map((record) => ({ ...record })),
  ]
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalizedBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

export function capabilityFingerprint(model: RuntimeModel, role: ModelRole): string {
  const material = JSON.stringify({
    role,
    type: model.type ?? '',
    provider: model.provider ?? '',
    baseUrl: normalizedBaseUrl(model.baseUrl),
    model: model.model.trim(),
    apiKey: model.apiKey ?? '',
    supportsVision: model.supportsVision ?? false,
  })
  return `cap-v1-${stableHash(material)}`
}

export function recordCapabilityCheck(input: RecordCapabilityCheckInput): ModelCapabilityRecord {
  if (input.verified && !input.ok) {
    throw new Error('A failed capability check cannot be Verified')
  }
  if (input.verified && !input.evidenceId?.trim()) {
    throw new Error('Verified capability requires an evidence ID')
  }

  return {
    modelId: input.model.id,
    modelAlias: input.model.alias,
    role: input.role,
    status: input.ok ? (input.verified ? 'Verified' : 'Compatible') : 'Unavailable',
    message: input.message,
    checkedAt: input.checkedAt ?? Date.now(),
    fingerprint: capabilityFingerprint(input.model, input.role),
    ...(input.verified ? { evidenceId: input.evidenceId!.trim() } : {}),
  }
}

export function assessModelCapability(
  model: RuntimeModel,
  role: ModelRole,
  records: ModelCapabilityRecord[],
): ModelCapabilityAssessment {
  const currentFingerprint = capabilityFingerprint(model, role)
  const record = records
    .filter((candidate) => candidate.modelId === model.id && candidate.role === role)
    .sort((left, right) => right.checkedAt - left.checkedAt)[0]

  if (!record) {
    return {
      modelId: model.id,
      modelAlias: model.alias,
      role,
      status: 'Unavailable',
      message: '尚未执行该角色的能力检查。',
      checkedAt: 0,
      fingerprint: currentFingerprint,
      stale: false,
    }
  }

  if (record.fingerprint !== currentFingerprint) {
    return {
      modelId: model.id,
      modelAlias: model.alias,
      role,
      status: 'Unavailable',
      message: '模型配置已变化，需要重新执行能力检查。',
      checkedAt: record.checkedAt,
      fingerprint: currentFingerprint,
      stale: true,
    }
  }

  return {
    ...record,
    modelAlias: model.alias,
    stale: false,
  }
}

export function decideModelRoleAssignment(
  model: RuntimeModel,
  role: ModelRole,
  records: ModelCapabilityRecord[],
): ModelRoleAssignmentDecision {
  const capability = assessModelCapability(model, role, records)
  return {
    allowed: capability.status === 'Compatible' || capability.status === 'Verified',
    capability,
  }
}
