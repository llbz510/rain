// harness/m02-notes.test.ts
// ========================================
// M02 Harness: 笔记引用完整性
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import type { Note, Sentence } from '@/models/types'
import { createNote } from '@/models/factories'
import { validateNoteReferences } from '@/models/validators'

describe('M02-T14b: createNote(excerpt) 行为（决策16）', () => {
  it('摘注创建笔记：自动填充被摘注段落的全部句子 id', () => {
    const paragraphSentenceIds = ['s1', 's2', 's3']
    const note = createNote('excerpt', 'v1', paragraphSentenceIds)
    expect(note.source).toBe('excerpt')
    expect(note.content).toBe('')
    expect(note.sentenceIds).toEqual(paragraphSentenceIds)
    expect(note.id).toBeDefined()
    expect(note.videoId).toBe('v1')
    expect(note.createdAt).toBeDefined()
  })
})

describe('M02-T15b: createNote(user) 行为', () => {
  it('用户手写笔记：sentenceIds 为空数组', () => {
    const note = createNote('user', 'v1', [])
    expect(note.source).toBe('user')
    expect(note.content).toBe('')
    expect(note.sentenceIds).toEqual([])
  })
})

describe('M02-T16b: createNote(ai) 行为', () => {
  it('AI 回答存入：content 由调用者提供', () => {
    const note = createNote('ai', 'v1', ['s1'], 'AI 回答的内容...')
    expect(note.source).toBe('ai')
    expect(note.content).toBe('AI 回答的内容...')
    expect(note.sentenceIds).toEqual(['s1'])
  })
})

describe('M02-Notes: 笔记引用完整性（决策18）', () => {
  const allSentences: Sentence[] = [
    { id: 's1', nodeId: 'p1', text: '句子一。', startTime: 0, endTime: 5, sortOrder: 0 },
    { id: 's2', nodeId: 'p1', text: '句子二。', startTime: 5, endTime: 10, sortOrder: 1 },
    { id: 's3', nodeId: 'p2', text: '句子三。', startTime: 10, endTime: 15, sortOrder: 0 },
  ]

  it('引用存在的句子 — 无错误', () => {
    const note: Note = {
      id: 'note1', videoId: 'v1', content: '', source: 'excerpt',
      sentenceIds: ['s1', 's2'], createdAt: Date.now(), sortOrder: 0,
    }
    const errors = validateNoteReferences([note], allSentences)
    expect(errors).toEqual([])
  })

  it('引用不存在的句子 — 报错', () => {
    const note: Note = {
      id: 'note2', videoId: 'v1', content: '', source: 'excerpt',
      sentenceIds: ['s1', 's999'], createdAt: Date.now(), sortOrder: 0,
    }
    const errors = validateNoteReferences([note], allSentences)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.includes('s999'))).toBe(true)
  })

  it('空 sentenceIds 是合法的（用户手写笔记）', () => {
    const note: Note = {
      id: 'note3', videoId: 'v1', content: '随笔', source: 'user',
      sentenceIds: [], createdAt: Date.now(), sortOrder: 0,
    }
    const errors = validateNoteReferences([note], allSentences)
    expect(errors).toEqual([])
  })
})
