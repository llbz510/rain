// src/architecture/events.ts
// ========================================
// Tauri 事件协议（决策97）
// ========================================

export const PROGRESS_EVENT_NAME = 'progress'

export const IMPORT_COMPLETE_EVENT = 'import_complete'
export const IMPORT_FAILED_EVENT = 'import_failed'
export const IMPORT_CANCELLED_EVENT = 'import_cancelled'

export interface ProgressPayload {
  videoId: string
  stage:
    | 'download'
    | 'asr'
    | 'asr_extraction'
    | 'asr_transcription'
    | 'asr_finalization'
    | 'stage2'
    | 'merging'
  blockCurrent: number
  blockTotal: number
  percent: number
  retrying: boolean
  backend?: 'cuda' | 'cpu'
  fallbackReason?: string
}
