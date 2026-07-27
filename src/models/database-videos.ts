import type { Video } from './types'
import {
  asMemoryDatabase,
  isSqlDatabase,
  type Database,
  type TableRow,
} from './database-adapter'

function videoToRow(video: Video): TableRow {
  return {
    id: video.id,
    title: video.title,
    source: video.source,
    source_url: video.sourceUrl ?? null,
    file_path: video.filePath ?? null,
    thumbnail: video.thumbnail,
    duration: video.duration,
    language: video.language,
    status: video.status,
    stage: video.stage ?? null,
    error_message: video.errorMessage ?? null,
    created_at: video.createdAt,
    position: video.position,
    last_studied_at: video.lastStudiedAt,
  }
}

function rowToVideo(row: TableRow): Video {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    sourceUrl: row.source_url ?? undefined,
    filePath: row.file_path ?? undefined,
    thumbnail: row.thumbnail,
    duration: row.duration,
    language: row.language,
    status: row.status,
    stage: row.stage ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    position: row.position,
    lastStudiedAt: row.last_studied_at,
  }
}

export async function insertVideo(db: Database, video: Video): Promise<void> {
  if (isSqlDatabase(db)) {
    const row = videoToRow(video)
    await db.exec(
      'INSERT INTO video (id, title, source, source_url, file_path, thumbnail, duration, language, status, stage, error_message, created_at, position, last_studied_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
      [
        row.id,
        row.title,
        row.source,
        row.source_url,
        row.file_path,
        row.thumbnail,
        row.duration,
        row.language,
        row.status,
        row.stage,
        row.error_message,
        row.created_at,
        row.position,
        row.last_studied_at,
      ],
    )
    return
  }

  const memory = asMemoryDatabase(db)
  const rows = memory.readTable('video')
  rows.push(videoToRow(video))
  memory.replaceTable('video', rows)
}

export async function getVideoById(db: Database, id: string): Promise<Video | null> {
  if (isSqlDatabase(db)) {
    const rows = await db.query<TableRow>('SELECT * FROM video WHERE id = $1', [id])
    return rows.length > 0 ? rowToVideo(rows[0]) : null
  }

  const row = asMemoryDatabase(db).readTable('video').find((candidate) => candidate.id === id)
  return row ? rowToVideo(row) : null
}

export async function updateVideoStatus(
  db: Database,
  id: string,
  status: string,
): Promise<void> {
  if (isSqlDatabase(db)) {
    await db.exec('UPDATE video SET status = $1 WHERE id = $2', [status, id])
    return
  }

  const memory = asMemoryDatabase(db)
  const rows = memory.readTable('video')
  for (const row of rows) {
    if (row.id === id) row.status = status
  }
  memory.replaceTable('video', rows)
}

export async function listVideos(
  db: Database,
  sortBy: string = 'lastStudied',
): Promise<Video[]> {
  if (isSqlDatabase(db)) {
    let sql = 'SELECT * FROM video'
    switch (sortBy) {
      case 'lastStudied':
        sql += ' ORDER BY last_studied_at DESC'
        break
      case 'createdAt':
        sql += ' ORDER BY created_at DESC'
        break
      case 'title':
        sql += ' ORDER BY title ASC'
        break
    }
    const rows = await db.query<TableRow>(sql)
    return rows.map(rowToVideo)
  }

  const videos = asMemoryDatabase(db).readTable('video').map(rowToVideo)
  const sorted = [...videos]
  switch (sortBy) {
    case 'lastStudied':
      sorted.sort((left, right) => right.lastStudiedAt - left.lastStudiedAt)
      break
    case 'createdAt':
      sorted.sort((left, right) => right.createdAt - left.createdAt)
      break
    case 'title':
      sorted.sort((left, right) => left.title.localeCompare(right.title))
      break
  }
  return sorted
}

export async function searchVideosByTitle(
  db: Database,
  keyword: string,
): Promise<Video[]> {
  if (isSqlDatabase(db)) {
    const rows = await db.query<TableRow>(
      'SELECT * FROM video WHERE title LIKE $1',
      [`%${keyword}%`],
    )
    return rows.map(rowToVideo)
  }

  return asMemoryDatabase(db)
    .readTable('video')
    .filter((row) => row.title.includes(keyword))
    .map(rowToVideo)
}

export async function updateVideoPosition(
  db: Database,
  id: string,
  position: number,
): Promise<void> {
  if (isSqlDatabase(db)) {
    await db.exec(
      'UPDATE video SET position = $1 WHERE id = $2 AND position < $1',
      [position, id],
    )
    return
  }

  const memory = asMemoryDatabase(db)
  const rows = memory.readTable('video')
  for (const row of rows) {
    if (row.id === id && position > row.position) row.position = position
  }
  memory.replaceTable('video', rows)
}

export async function updateVideoLastStudiedAt(
  db: Database,
  id: string,
  timestamp: number,
): Promise<void> {
  if (isSqlDatabase(db)) {
    await db.exec('UPDATE video SET last_studied_at = $1 WHERE id = $2', [timestamp, id])
    return
  }

  const memory = asMemoryDatabase(db)
  const rows = memory.readTable('video')
  for (const row of rows) {
    if (row.id === id) row.last_studied_at = timestamp
  }
  memory.replaceTable('video', rows)
}
