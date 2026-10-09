import type { ProgressPayload } from '@/architecture/events'

export type ActiveImportStage = 'download' | 'asr' | 'stage2' | 'merging'
export type ImportProgress =
  | { videoId: string; stage: 'download'; percent: number; bytes?: number }
  | { videoId: string; stage: 'asr'; substage: 'extraction' | 'transcription' | 'finalization'; percent: number; backend?: 'cuda' | 'cpu'; fallbackReason?: string }
  | { videoId: string; stage: 'stage2'; percent: number; blockCurrent: number; blockTotal: number; retrying: boolean }
  | { videoId: string; stage: 'merging'; percent: number }
  | { videoId: string; stage: 'terminal'; status: 'ready' | 'cancelled' }
  | { videoId: string; stage: 'terminal'; status: 'failed'; error: string }

const stages: ActiveImportStage[] = ['download', 'asr', 'stage2', 'merging']

/** The domain boundary rejects field combinations which cannot describe a task. */
export function isImportProgress(value: unknown): value is ImportProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Record<string, unknown>
  if (typeof p.videoId !== 'string' || !p.videoId) return false
  let fields: string[]
  switch (p.stage) {
    case 'download':
      fields = ['percent', 'bytes']
      if (p.bytes !== undefined && (typeof p.bytes !== 'number' || !Number.isFinite(p.bytes) || p.bytes < 0)) return false
      break
    case 'asr':
      fields = ['percent', 'substage', 'backend', 'fallbackReason']
      if (typeof p.substage !== 'string' || !['extraction', 'transcription', 'finalization'].includes(p.substage)) return false
      if (p.backend !== undefined && p.backend !== 'cuda' && p.backend !== 'cpu') return false
      if (p.fallbackReason !== undefined && typeof p.fallbackReason !== 'string') return false
      break
    case 'stage2':
      fields = ['percent', 'blockCurrent', 'blockTotal', 'retrying']
      if (typeof p.blockCurrent !== 'number' || typeof p.blockTotal !== 'number'
        || !Number.isInteger(p.blockCurrent) || !Number.isInteger(p.blockTotal)
        || p.blockCurrent < 1 || p.blockCurrent > p.blockTotal || typeof p.retrying !== 'boolean') return false
      break
    case 'merging':
      fields = ['percent']
      break
    case 'terminal':
      fields = p.status === 'failed' ? ['status', 'error'] : ['status']
      if (p.status !== 'ready' && p.status !== 'failed' && p.status !== 'cancelled') return false
      if (p.status === 'failed' && typeof p.error !== 'string') return false
      break
    default:
      return false
  }
  if (p.stage !== 'terminal' && (typeof p.percent !== 'number' || !Number.isFinite(p.percent) || p.percent < 0 || p.percent > 100)) return false
  return Object.keys(p).every((key) => key === 'videoId' || key === 'stage' || fields.includes(key))
}

/** The locked desktop wire protocol stays at the adapter, never in UI/domain state. */
export function adaptProgressEvent(payload: ProgressPayload | ImportProgress): ImportProgress | null {
  if (isImportProgress(payload)) return payload
  if (!payload || typeof payload !== 'object') return null
  const p = payload as ProgressPayload
  if (Object.keys(p).some((key) => !['videoId', 'stage', 'percent', 'blockCurrent', 'blockTotal', 'retrying', 'backend', 'fallbackReason'].includes(key))) return null
  let progress: ImportProgress
  switch (p.stage) {
    case 'asr':
    case 'asr_extraction':
    case 'asr_transcription':
    case 'asr_finalization':
      if (p.blockCurrent !== 0 || p.blockTotal !== 0 || p.retrying !== false) return null
      progress = {
        videoId: p.videoId, stage: 'asr', percent: p.percent,
        substage: p.stage === 'asr_extraction' ? 'extraction' : p.stage === 'asr_finalization' ? 'finalization' : 'transcription',
        ...(p.backend === undefined ? {} : { backend: p.backend }),
        ...(p.fallbackReason === undefined ? {} : { fallbackReason: p.fallbackReason }),
      }
      break
    case 'stage2':
      if (p.backend !== undefined || p.fallbackReason !== undefined) return null
      progress = { videoId: p.videoId, stage: 'stage2', percent: p.percent, blockCurrent: p.blockCurrent, blockTotal: p.blockTotal, retrying: p.retrying }
      break
    case 'download':
    case 'merging':
      if (p.blockCurrent !== 0 || p.blockTotal !== 0 || p.retrying !== false || p.backend !== undefined || p.fallbackReason !== undefined) return null
      progress = { videoId: p.videoId, stage: p.stage, percent: p.percent }
      break
    default:
      return null
  }
  return isImportProgress(progress) ? progress : null
}

/** One session belongs to one Controller run; only persisted retry creates another. */
export function createImportProgressSession(videoId: string, startStage: ActiveImportStage) {
  let current: ImportProgress | null = null
  return {
    accept(value: unknown): ImportProgress | null {
      if (!isImportProgress(value) || value.videoId !== videoId || current?.stage === 'terminal') return null
      if (value.stage !== 'terminal') {
        const previousStage = current?.stage ?? startStage
        const distance = stages.indexOf(value.stage) - stages.indexOf(previousStage)
        if (distance < 0 || distance > 1 || (!current && distance !== 0)) return null
        if (current && current.stage === value.stage && value.percent < current.percent) return null
      }
      const next = current?.stage === 'asr' && value.stage === 'asr'
        ? { ...current, ...value }
        : { ...value }
      current = next
      return { ...next }
    },
  }
}
