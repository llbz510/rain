// src/models/types.ts
// ========================================
// Rain 数据模型类型定义
// ========================================

// ===== 枚举常量 =====

export const PARAGRAPH_TYPES = ['concept', 'example', 'analogy', 'transition'] as const
export type ParagraphType = typeof PARAGRAPH_TYPES[number]

export const NODE_KINDS = ['chapter', 'section', 'paragraph'] as const
export type NodeKind = typeof NODE_KINDS[number]

export const VIDEO_STATUSES = ['pending', 'processing', 'ready', 'failed', 'cancelled'] as const
export type VideoStatus = typeof VIDEO_STATUSES[number]

export const VIDEO_SOURCES = ['local', 'url'] as const
export type VideoSource = typeof VIDEO_SOURCES[number]

export const NOTE_SOURCES = ['excerpt', 'user', 'ai'] as const
export type NoteSource = typeof NOTE_SOURCES[number]

// ===== 实体类型 =====

export interface Video {
  id: string
  title: string
  source: VideoSource
  sourceUrl?: string
  filePath?: string
  thumbnail: string
  duration: number
  language: string
  status: VideoStatus
  createdAt: number
  position: number
  lastStudiedAt: number
  stage?: 'asr' | 'stage2' | 'merging'
  errorMessage?: string
}

export interface Node {
  id: string
  videoId: string
  parentId: string | null
  kind: NodeKind
  title: string
  type: ParagraphType | null
  startTime: number
  endTime: number
  text: string | null
  sortOrder: number
  translation?: string
}

export interface Sentence {
  id: string
  nodeId: string
  text: string
  startTime: number
  endTime: number
  sortOrder: number
}

export interface Note {
  id: string
  videoId: string
  content: string
  source: NoteSource
  sentenceIds: string[]
  createdAt: number
  sortOrder: number
}

// ===== AI Pipeline 输出类型 =====

export interface Stage2Sentence {
  id: string
  text: string
  start: number
  end: number
}

export interface Stage2Paragraph {
  title: string
  type: ParagraphType
  start: number
  end: number
  translation?: string
  sentences: Stage2Sentence[]
}

export interface Stage2Section {
  title: string
  start: number
  end: number
  paragraphs: Stage2Paragraph[]
}

export interface Stage2Chapter {
  title: string
  start: number
  end: number
  sections: Stage2Section[]
}

export interface Stage2Output {
  chapters: Stage2Chapter[]
}

export interface ImportCheckpoint {
  videoId: string
  stage: 'asr' | 'stage2' | 'merging'
  completedBlocks: string[]
  /** Version-2 validated Stage2 outputs. Old checkpoints contain only completedBlocks IDs. */
  completedBlockOutputs?: unknown[]
  errorMessage?: string
  updatedAt: number
}
