export type ImportStage =
  | 'download'
  | 'pending'
  | 'asr'
  | 'stage2'
  | 'merging'
  | 'ready'
  | 'failed'
  | 'cancelled'

const ALLOWED_TRANSITIONS: Record<ImportStage, readonly ImportStage[]> = {
  download: ['pending', 'failed', 'cancelled'],
  pending: ['asr'],
  asr: ['stage2', 'failed', 'cancelled'],
  stage2: ['merging', 'failed', 'cancelled'],
  merging: ['ready', 'failed', 'cancelled'],
  ready: [],
  failed: [],
  cancelled: [],
}

export function assertTransition(from: ImportStage, to: ImportStage): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid import transition: ${from} -> ${to}`)
  }
}
