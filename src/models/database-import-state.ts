import { tauriInvoke } from '@/lib/tauri-env'
import type { Video, VideoStatus } from './types'
import {
  asMemoryDatabase,
  isSqlDatabase,
  type Database,
} from './database-adapter'

export interface VideoImportState {
  status: VideoStatus
  stage: Video['stage'] | null
  errorMessage?: string | null
}

export type ImportRecoveryAction = 'skip_asr' | 'rerun_asr'

export async function transitionVideoImportState(
  db: Database,
  id: string,
  expected: VideoImportState,
  next: VideoImportState,
): Promise<void> {
  if (isSqlDatabase(db)) {
    await tauriInvoke<void>('transition_video_import_state', {
      videoId: id,
      expected,
      next,
    })
    return
  }

  const memory = asMemoryDatabase(db)
  const rows = memory.readTable('video')
  const row = rows.find((candidate) => candidate.id === id)
  const actualStage = row?.stage ?? null
  if (!row || row.status !== expected.status || actualStage !== expected.stage) {
    throw new Error(`Persisted import state changed for video "${id}"`)
  }

  row.status = next.status
  row.stage = next.stage
  row.error_message = next.errorMessage ?? null
  memory.replaceTable('video', rows)
}

export async function determineRecoveryAction(
  db: Database,
  videoId: string,
): Promise<ImportRecoveryAction> {
  if (isSqlDatabase(db)) {
    const rows = await db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM sentence WHERE node_id = $1 OR node_id IN (SELECT id FROM node WHERE video_id = $1)',
      [videoId],
    )
    return rows[0]?.cnt > 0 ? 'skip_asr' : 'rerun_asr'
  }

  const memory = asMemoryDatabase(db)
  const nodeIds = new Set(
    memory.readTable('node')
      .filter((row) => row.video_id === videoId)
      .map((row) => row.id),
  )
  const hasSentences = memory.readTable('sentence')
    .some((row) => row.node_id === videoId || nodeIds.has(row.node_id))

  return hasSentences ? 'skip_asr' : 'rerun_asr'
}
