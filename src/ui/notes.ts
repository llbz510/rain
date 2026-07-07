// src/ui/notes.ts
// ========================================
// 摘注与随记系统
// ========================================

import type { Note } from '@/models/types'

let noteCounter = 0
function generateNoteId(): string {
  noteCounter++
  return `note_${Date.now()}_${noteCounter}`
}

// 摘注创建
export function createExcerpt(videoId: string, sentenceIds: string[]): Note {
  return {
    id: generateNoteId(),
    videoId,
    content: '',
    source: 'excerpt',
    sentenceIds: [...sentenceIds],
    createdAt: Date.now(),
    sortOrder: 0,
  }
}

// 更新笔记内容
export function updateNoteContent(note: Note, content: string): Note {
  return {
    ...note,
    content,
  }
}

// 添加句子引用
export function addSentenceReference(note: Note, sentenceId: string): Note {
  if (note.sentenceIds.includes(sentenceId)) {
    return note
  }
  return {
    ...note,
    sentenceIds: [...note.sentenceIds, sentenceId],
  }
}

// AI 回答存入笔记
export function saveAiResponseAsNote(videoId: string, content: string, sentenceIds: string[]): Note {
  return {
    id: generateNoteId(),
    videoId,
    content,
    source: 'ai',
    sentenceIds: [...sentenceIds],
    createdAt: Date.now(),
    sortOrder: 0,
  }
}

// 列出视频的所有笔记
export function listNotesForVideo(videoId: string): Note[] {
  // 实际实现会查数据库，这里返回空数组
  return []
}
