// src/ui/notes.ts
// ========================================
// 摘注与随记系统（决策16/18）
// ========================================

import type { Note } from '@/models/types'

let noteCounter = 0
function generateNoteId(): string {
  noteCounter++
  return `note_${Date.now()}_${noteCounter}`
}

// 内存缓存（测试环境或无 DB 时使用）
const notesCache = new Map<string, Note[]>()

/// 摘注创建（决策16：按钮/` 键创建笔记，sentenceIds = 当前段落全部句子）
export function createExcerpt(videoId: string, sentenceIds: string[]): Note {
  const note: Note = {
    id: generateNoteId(),
    videoId,
    content: '',
    source: 'excerpt',
    sentenceIds: [...sentenceIds],
    createdAt: Date.now(),
    sortOrder: 0,
  }

  // 加入缓存
  if (!notesCache.has(videoId)) {
    notesCache.set(videoId, [])
  }
  notesCache.get(videoId)!.push(note)

  return note
}

/// 更新笔记内容
export function updateNoteContent(note: Note, content: string): Note {
  const updated = { ...note, content }
  updateNoteInCache(updated)
  return updated
}

/// 添加句子引用（决策18：笔记引用句子，句子永不删）
export function addSentenceReference(note: Note, sentenceId: string): Note {
  if (note.sentenceIds.includes(sentenceId)) {
    return note
  }
  const updated = {
    ...note,
    sentenceIds: [...note.sentenceIds, sentenceId],
  }
  updateNoteInCache(updated)
  return updated
}

/// AI 回答存入笔记（决策10：AI 回答可手动存入随记）
export function saveAiResponseAsNote(videoId: string, content: string, sentenceIds: string[]): Note {
  const note: Note = {
    id: generateNoteId(),
    videoId,
    content,
    source: 'ai',
    sentenceIds: [...sentenceIds],
    createdAt: Date.now(),
    sortOrder: 0,
  }

  if (!notesCache.has(videoId)) {
    notesCache.set(videoId, [])
  }
  notesCache.get(videoId)!.push(note)

  return note
}

/// 列出视频的所有笔记（决策17：所有笔记统一在随记面板）
/// 优先从缓存读取，生产环境可从数据库查询
export function listNotesForVideo(videoId: string): Note[] {
  return notesCache.get(videoId) ?? []
}

/// 清空指定视频的笔记缓存（切换视频时调用）
export function clearNotesCache(videoId: string): void {
  notesCache.delete(videoId)
}

function updateNoteInCache(updated: Note): void {
  const videoNotes = notesCache.get(updated.videoId)
  if (videoNotes) {
    const idx = videoNotes.findIndex((n) => n.id === updated.id)
    if (idx >= 0) {
      videoNotes[idx] = updated
    }
  }
}
