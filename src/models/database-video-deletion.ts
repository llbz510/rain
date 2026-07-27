import {
  asMemoryDatabase,
  isSqlDatabase,
  type Database,
} from './database-adapter'

export async function deleteVideoWithCascade(
  db: Database,
  videoId: string,
): Promise<void> {
  if (isSqlDatabase(db)) {
    const { tauriInvoke } = await import('@/lib/tauri-env')
    await tauriInvoke<void>('delete_video_atomically', { videoId })
    return
  }

  const memory = asMemoryDatabase(db)
  const nodeIds = new Set(
    memory.readTable('node')
      .filter((row) => row.video_id === videoId)
      .map((row) => row.id),
  )
  const noteIds = new Set(
    memory.readTable('note')
      .filter((row) => row.video_id === videoId)
      .map((row) => row.id),
  )

  const nextTables = {
    note_sentence: memory.readTable('note_sentence')
      .filter((row) => !noteIds.has(row.note_id)),
    sentence: memory.readTable('sentence')
      .filter((row) => row.node_id !== videoId && !nodeIds.has(row.node_id)),
    note: memory.readTable('note')
      .filter((row) => row.video_id !== videoId),
    node: memory.readTable('node')
      .filter((row) => row.video_id !== videoId),
    import_checkpoint: memory.readTable('import_checkpoint')
      .filter((row) => row.video_id !== videoId),
    video: memory.readTable('video')
      .filter((row) => row.id !== videoId),
  }

  for (const [tableName, rows] of Object.entries(nextTables)) {
    memory.replaceTable(tableName, rows)
  }
}
