import type { ImportCheckpoint } from './types'
import {
  asMemoryDatabase,
  isSqlDatabase,
  type Database,
  type TableRow,
} from './database-adapter'

export async function saveImportCheckpoint(
  db: Database,
  checkpoint: ImportCheckpoint,
): Promise<void> {
  const completedBlocksJson = checkpoint.completedBlockOutputs
    ? JSON.stringify({ version: 2, blocks: checkpoint.completedBlockOutputs })
    : JSON.stringify(checkpoint.completedBlocks)
  if (isSqlDatabase(db)) {
    await db.exec(
      'INSERT INTO import_checkpoint (video_id, stage, completed_blocks_json, error_message, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(video_id) DO UPDATE SET stage = excluded.stage, completed_blocks_json = excluded.completed_blocks_json, error_message = excluded.error_message, updated_at = excluded.updated_at',
      [checkpoint.videoId, checkpoint.stage, completedBlocksJson, checkpoint.errorMessage ?? null, checkpoint.updatedAt],
    )
    return
  }

  const memDb = asMemoryDatabase(db)
  const table = memDb.readTable('import_checkpoint')
  const row = {
    video_id: checkpoint.videoId,
    stage: checkpoint.stage,
    completed_blocks_json: completedBlocksJson,
    error_message: checkpoint.errorMessage ?? null,
    updated_at: checkpoint.updatedAt,
  }
  const existingIndex = table.findIndex((item) => item.video_id === checkpoint.videoId)
  if (existingIndex >= 0) table[existingIndex] = row
  else table.push(row)
  memDb.replaceTable('import_checkpoint', table)
}

export async function getImportCheckpoint(
  db: Database,
  videoId: string,
): Promise<ImportCheckpoint | null> {
  let row: TableRow | undefined
  if (isSqlDatabase(db)) {
    row = (await db.query<TableRow>(
      'SELECT * FROM import_checkpoint WHERE video_id = $1',
      [videoId],
    ))[0]
  } else {
    row = asMemoryDatabase(db)
      .readTable('import_checkpoint')
      .find((item) => item.video_id === videoId)
  }
  if (!row) return null

  let completedBlocks: string[] = []
  let completedBlockOutputs: unknown[] | undefined
  try {
    const parsed: unknown = JSON.parse(row.completed_blocks_json)
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      completedBlocks = parsed
    } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const encoded = parsed as { version?: unknown; blocks?: unknown }
      if (encoded.version === 2 && Array.isArray(encoded.blocks)) {
        completedBlockOutputs = encoded.blocks
        completedBlocks = encoded.blocks.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return []
          const blockId = (value as { blockId?: unknown }).blockId
          return typeof blockId === 'string' ? [blockId] : []
        })
      }
    }
  } catch {
    completedBlocks = []
  }

  return {
    videoId: row.video_id,
    stage: row.stage,
    completedBlocks,
    completedBlockOutputs,
    errorMessage: row.error_message ?? undefined,
    updatedAt: row.updated_at,
  }
}
