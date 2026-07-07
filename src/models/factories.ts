// src/models/factories.ts
// ========================================
// 实体工厂函数
// ========================================

import type { Note, NoteSource } from './types'

export function createNote(
  source: NoteSource,
  videoId: string,
  sentenceIds: string[],
  content: string = ''
): Note {
  return {
    id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    videoId,
    content,
    source,
    sentenceIds,
    createdAt: Date.now(),
    sortOrder: 0,
  }
}
