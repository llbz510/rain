import { describe, expect, it, vi } from 'vitest'
import type { SqlDatabaseAdapter } from '@/models/database-adapter'
import {
  createDatabase,
  getNotesByVideoId,
  insertNote,
  updateNoteContent,
} from '@/models/database'
import type { Note } from '@/models/types'

function sqliteAdapter(overrides: Partial<SqlDatabaseAdapter> = {}): SqlDatabaseAdapter {
  return {
    adapterKind: 'sqlite',
    listTables: vi.fn(),
    getTableColumns: vi.fn(),
    exec: vi.fn(),
    query: vi.fn(),
    ...overrides,
  }
}

const note: Note = {
  id: 'note-1',
  videoId: 'video-1',
  content: 'Signal.',
  source: 'excerpt',
  sentenceIds: ['sentence-1', 'sentence-2'],
  createdAt: 10,
  sortOrder: 0,
}

describe('database notes persistence', () => {
  it('sends the note and all sentence references through the SQLite adapter', async () => {
    const exec = vi.fn()
    const db = sqliteAdapter({ exec })

    await insertNote(db, note)

    expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining('INSERT INTO note '),
      expect.stringContaining('INSERT INTO note_sentence'),
      expect.stringContaining('INSERT INTO note_sentence'),
    ])
  })

  it('surfaces a SQLite sentence-reference failure', async () => {
    const exec = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('duplicate reference'))
    const db = sqliteAdapter({ exec })

    await expect(insertNote(db, note)).rejects.toThrow('duplicate reference')
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining('INSERT INTO note '),
      expect.stringContaining('INSERT INTO note_sentence'),
      expect.stringContaining('INSERT INTO note_sentence'),
    ])
  })

  it('rolls back both memory tables when a duplicate reference violates the schema', async () => {
    const db = await createDatabase(':memory:')

    await expect(insertNote(db, {
      ...note,
      sentenceIds: ['sentence-1', 'sentence-1'],
    })).rejects.toThrow('Note sentence reference already exists')
    await expect(getNotesByVideoId(db, note.videoId)).resolves.toEqual([])
  })

  it('reconstructs sentence references from the SQLite association table', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        id: note.id,
        video_id: note.videoId,
        content: note.content,
        source: note.source,
        created_at: note.createdAt,
        sort_order: note.sortOrder,
      }])
      .mockResolvedValueOnce([
        { sentence_id: 'sentence-1' },
        { sentence_id: 'sentence-2' },
      ])
    const db = sqliteAdapter({ query })

    await expect(getNotesByVideoId(db, note.videoId)).resolves.toEqual([note])
  })

  it('updates note content through the selected adapter', async () => {
    const exec = vi.fn()
    const db = sqliteAdapter({ exec })

    await updateNoteContent(db, note.id, 'Updated.')

    expect(exec).toHaveBeenCalledWith(
      'UPDATE note SET content = $1 WHERE id = $2',
      ['Updated.', note.id],
    )
  })
})
