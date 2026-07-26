// harness/m08-notes.test.ts
// ========================================
// M08 Harness: persisted notes and sentence references
// Harness migration: 2026-07-26
// ========================================

import { describe, expect, it } from 'vitest'
import { createDatabase, getNotesByVideoId, insertNote } from '@/models/database'
import type { Note } from '@/models/types'

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    videoId: 'video-1',
    content: '',
    source: 'excerpt',
    sentenceIds: ['s1', 's2'],
    createdAt: 1,
    sortOrder: 0,
    ...overrides,
  }
}

describe('M08: 摘注与随记持久化', () => {
  it('摘注通过真实数据库保存全部句子引用', async () => {
    const db = await createDatabase(':memory:')
    await insertNote(db, note())

    expect(await getNotesByVideoId(db, 'video-1')).toEqual([
      expect.objectContaining({
        id: 'note-1',
        source: 'excerpt',
        sentenceIds: ['s1', 's2'],
      }),
    ])
  })

  it('同一视频统一返回 excerpt、user 和 ai 来源', async () => {
    const db = await createDatabase(':memory:')
    await insertNote(db, note())
    await insertNote(db, note({
      id: 'note-2',
      source: 'user',
      content: '我的随记',
      sentenceIds: [],
      sortOrder: 1,
    }))
    await insertNote(db, note({
      id: 'note-3',
      source: 'ai',
      content: 'AI 回答',
      sentenceIds: ['s3'],
      sortOrder: 2,
    }))

    const notes = await getNotesByVideoId(db, 'video-1')
    expect(notes.map(({ source }) => source)).toEqual(['excerpt', 'user', 'ai'])
    expect(notes[2]).toMatchObject({ content: 'AI 回答', sentenceIds: ['s3'] })
  })

  it('不会把其他视频的笔记混入当前视频', async () => {
    const db = await createDatabase(':memory:')
    await insertNote(db, note())
    await insertNote(db, note({ id: 'other-note', videoId: 'video-2' }))

    expect(await getNotesByVideoId(db, 'video-1')).toHaveLength(1)
    expect(await getNotesByVideoId(db, 'video-2')).toEqual([
      expect.objectContaining({ id: 'other-note' }),
    ])
  })
})
