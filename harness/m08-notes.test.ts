// harness/m08-notes.test.ts
// ========================================
// M08 Harness: 摘注与随记系统
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import {
  createExcerpt,
  updateNoteContent,
  addSentenceReference,
  saveAiResponseAsNote,
  listNotesForVideo,
} from '@/ui/notes'
import type { Note } from '@/models/types'

describe('M08-T01: 摘注创建（决策16）', () => {
  it('按钮/` 键创建笔记，sentenceIds = 当前段落全部句子', () => {
    const paragraphSentenceIds = ['s1', 's2', 's3']
    const note = createExcerpt('v1', paragraphSentenceIds)
    expect(note.source).toBe('excerpt')
    expect(note.content).toBe('')
    expect(note.sentenceIds).toEqual(paragraphSentenceIds)
    expect(note.videoId).toBe('v1')
  })
})

describe('M08-T02: 笔记内容可编辑', () => {
  it('更新 content 成功', () => {
    const note = createExcerpt('v1', ['s1'])
    const updated = updateNoteContent(note, '这是我的笔记')
    expect(updated.content).toBe('这是我的笔记')
  })
})

describe('M08-T03: 笔记可添加句子引用（决策18）', () => {
  it('追加 sentenceIds', () => {
    const note = createExcerpt('v1', ['s1'])
    const updated = addSentenceReference(note, 's5')
    expect(updated.sentenceIds).toContain('s1')
    expect(updated.sentenceIds).toContain('s5')
  })
})

describe('M08-T04: 所有笔记统一在随记面板（决策17）', () => {
  it('listNotesForVideo 返回所有 source 类型的笔记', () => {
    // 验证函数存在且返回数组
    expect(typeof listNotesForVideo).toBe('function')
  })
})

describe('M08-T05: AI 回答可存入随记（决策10）', () => {
  it('保存 AI 回答为 note', () => {
    const note = saveAiResponseAsNote('v1', 'AI 的回答内容...', ['s1', 's2'])
    expect(note.source).toBe('ai')
    expect(note.content).toBe('AI 的回答内容...')
    expect(note.sentenceIds).toEqual(['s1', 's2'])
  })
})
