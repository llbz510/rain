import type { Note } from './types'
import {
  asMemoryDatabase,
  isSqlDatabase,
  type Database,
  type TableRow,
} from './database-adapter'

function noteToRow(note: Note): TableRow {
  return {
    id: note.id,
    video_id: note.videoId,
    content: note.content,
    source: note.source,
    created_at: note.createdAt,
    derivation_id: null,
    sort_order: note.sortOrder,
  }
}

function rowToNote(row: TableRow, sentenceIds: string[]): Note {
  return {
    id: row.id,
    videoId: row.video_id,
    content: row.content,
    source: row.source,
    sentenceIds,
    createdAt: row.created_at,
    sortOrder: row.sort_order,
  }
}

export async function insertNote(db: Database, note: Note): Promise<void> {
  const row = noteToRow(note)
  if (isSqlDatabase(db)) {
    await db.exec(
      'INSERT INTO note (id, video_id, content, source, created_at, derivation_id, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [row.id, row.video_id, row.content, row.source, row.created_at, row.derivation_id, row.sort_order],
    )
    for (const sentenceId of note.sentenceIds) {
      await db.exec(
        'INSERT INTO note_sentence (note_id, sentence_id) VALUES ($1, $2)',
        [note.id, sentenceId],
      )
    }
    return
  }

  const memory = asMemoryDatabase(db)
  const notes = memory.readTable('note')
  const references = memory.readTable('note_sentence')
  const notesBackup = notes.map((candidate) => ({ ...candidate }))
  const referencesBackup = references.map((candidate) => ({ ...candidate }))
  try {
    if (notes.some((candidate) => candidate.id === note.id)) {
      throw new Error(`Note already exists: ${note.id}`)
    }
    notes.push(row)

    const referenceKeys = new Set(
      references.map((candidate) => `${candidate.note_id}\u0000${candidate.sentence_id}`),
    )
    for (const sentenceId of note.sentenceIds) {
      const key = `${note.id}\u0000${sentenceId}`
      if (referenceKeys.has(key)) {
        throw new Error(`Note sentence reference already exists: ${note.id}/${sentenceId}`)
      }
      referenceKeys.add(key)
      references.push({ note_id: note.id, sentence_id: sentenceId })
    }

    memory.replaceTable('note', notes)
    memory.replaceTable('note_sentence', references)
  } catch (error) {
    memory.replaceTable('note', notesBackup)
    memory.replaceTable('note_sentence', referencesBackup)
    throw error
  }
}

export async function getNotesByVideoId(db: Database, videoId: string): Promise<Note[]> {
  if (isSqlDatabase(db)) {
    const noteRows = await db.query<TableRow>('SELECT * FROM note WHERE video_id = $1', [videoId])
    const result: Note[] = []
    for (const row of noteRows) {
      const referenceRows = await db.query<{ sentence_id: string }>(
        'SELECT sentence_id FROM note_sentence WHERE note_id = $1',
        [row.id],
      )
      result.push(rowToNote(row, referenceRows.map((reference) => reference.sentence_id)))
    }
    return result
  }

  const memory = asMemoryDatabase(db)
  const noteRows = memory.readTable('note').filter((row) => row.video_id === videoId)
  const references = memory.readTable('note_sentence')
  return noteRows.map((row) => rowToNote(
    row,
    references
      .filter((reference) => reference.note_id === row.id)
      .map((reference) => reference.sentence_id),
  ))
}

export async function updateNoteContent(
  db: Database,
  noteId: string,
  content: string,
): Promise<void> {
  if (isSqlDatabase(db)) {
    await db.exec('UPDATE note SET content = $1 WHERE id = $2', [content, noteId])
    return
  }

  const memory = asMemoryDatabase(db)
  const rows = memory.readTable('note')
  for (const row of rows) {
    if (row.id === noteId) row.content = content
  }
  memory.replaceTable('note', rows)
}
