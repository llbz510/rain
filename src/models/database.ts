// src/models/database.ts
// ========================================
// 内存数据库实现（SQL-like in-memory）
// ========================================

import type { Video, Node, Sentence, Note } from './types'

export interface Database {
  listTables(): Promise<string[]>
  getTableColumns(table: string): Promise<string[]>
  exec(sql: string, params?: any[]): Promise<void>
  query<T = any>(sql: string, params?: any[]): Promise<T[]>
}

interface TableRow {
  [key: string]: any
}

// 内部使用的数据结构
class MemoryDatabase implements Database {
  private tables: Map<string, string[]> = new Map()
  private data: Map<string, TableRow[]> = new Map()

  constructor() {
    this.initSchema()
  }

  private initSchema(): void {
    this.tables.set('video', [
      'id', 'title', 'source', 'source_url', 'file_path',
      'thumbnail', 'duration', 'language', 'status', 'stage',
      'error_message', 'created_at', 'position', 'last_studied_at',
    ])
    this.tables.set('node', [
      'id', 'video_id', 'parent_id', 'kind', 'title',
      'type', 'start_time', 'end_time', 'text', 'translation',
      'sort_order',
    ])
    this.tables.set('sentence', [
      'id', 'node_id', 'text', 'start_time', 'end_time', 'sort_order',
    ])
    this.tables.set('note', [
      'id', 'video_id', 'content', 'source', 'created_at',
      'derivation_id', 'sort_order',
    ])
    this.tables.set('note_sentence', ['note_id', 'sentence_id'])
    this.tables.set('setting', ['key', 'value'])

    for (const tableName of this.tables.keys()) {
      this.data.set(tableName, [])
    }
  }

  async listTables(): Promise<string[]> {
    return Array.from(this.tables.keys())
  }

  async getTableColumns(table: string): Promise<string[]> {
    return this.tables.get(table) ?? []
  }

  async exec(sql: string, params: any[] = []): Promise<void> {
    // 不实际执行 SQL，只是占位
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return []
  }

  // 内部方法：获取表数据
  _getTable(tableName: string): TableRow[] {
    return this.data.get(tableName) ?? []
  }

  // 内部方法：设置表数据
  _setTable(tableName: string, rows: TableRow[]): void {
    this.data.set(tableName, rows)
  }
}

// 转换 Video 对象到行数据
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

// 转换行数据到 Video 对象
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

// 转换 Node 对象到行数据
function nodeToRow(node: Node): TableRow {
  return {
    id: node.id,
    video_id: node.videoId,
    parent_id: node.parentId,
    kind: node.kind,
    title: node.title,
    type: node.type,
    start_time: node.startTime,
    end_time: node.endTime,
    text: node.text,
    translation: node.translation ?? null,
    sort_order: node.sortOrder,
  }
}

// 转换行数据到 Node 对象
function rowToNode(row: TableRow): Node {
  return {
    id: row.id,
    videoId: row.video_id,
    parentId: row.parent_id,
    kind: row.kind,
    title: row.title,
    type: row.type,
    startTime: row.start_time,
    endTime: row.end_time,
    text: row.text,
    translation: row.translation ?? undefined,
    sortOrder: row.sort_order,
  }
}

// 转换 Sentence 对象到行数据
function sentenceToRow(sentence: Sentence): TableRow {
  return {
    id: sentence.id,
    node_id: sentence.nodeId,
    text: sentence.text,
    start_time: sentence.startTime,
    end_time: sentence.endTime,
    sort_order: sentence.sortOrder,
  }
}

// 转换行数据到 Sentence 对象
function rowToSentence(row: TableRow): Sentence {
  return {
    id: row.id,
    nodeId: row.node_id,
    text: row.text,
    startTime: row.start_time,
    endTime: row.end_time,
    sortOrder: row.sort_order,
  }
}

// 转换 Note 对象到行数据
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

// 转换行数据到 Note 对象
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

// ===== 导出函数 =====

export async function createDatabase(_path: string = ':memory:'): Promise<Database> {
  const db = new MemoryDatabase()
  return db as unknown as Database
}

export async function insertVideo(db: Database, video: Video): Promise<void> {
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('video')
  table.push(videoToRow(video))
  memDb._setTable('video', table)
}

export async function getVideoById(db: Database, id: string): Promise<Video | null> {
  const memDb = db as unknown as MemoryDatabase
  const row = memDb._getTable('video').find(r => r.id === id)
  return row ? rowToVideo(row) : null
}

export async function insertNodes(db: Database, nodes: Node[]): Promise<void> {
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('node')
  for (const node of nodes) {
    table.push(nodeToRow(node))
  }
  memDb._setTable('node', table)
}

export async function getNodesByVideoId(db: Database, videoId: string): Promise<Node[]> {
  const memDb = db as unknown as MemoryDatabase
  return memDb._getTable('node')
    .filter(r => r.video_id === videoId)
    .map(rowToNode)
}

export async function insertSentences(db: Database, sentences: Sentence[]): Promise<void> {
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('sentence')
  for (const sentence of sentences) {
    table.push(sentenceToRow(sentence))
  }
  memDb._setTable('sentence', table)
}

export async function getSentencesByNodeId(db: Database, nodeId: string): Promise<Sentence[]> {
  const memDb = db as unknown as MemoryDatabase
  return memDb._getTable('sentence')
    .filter(r => r.node_id === nodeId)
    .map(rowToSentence)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function insertNote(db: Database, note: Note): Promise<void> {
  const memDb = db as unknown as MemoryDatabase
  const notesTable = memDb._getTable('note')
  notesTable.push(noteToRow(note))
  memDb._setTable('note', notesTable)

  // 插入 note_sentence 关联
  const nsTable = memDb._getTable('note_sentence')
  for (const sentenceId of note.sentenceIds) {
    nsTable.push({ note_id: note.id, sentence_id: sentenceId })
  }
  memDb._setTable('note_sentence', nsTable)
}

export async function getNotesByVideoId(db: Database, videoId: string): Promise<Note[]> {
  const memDb = db as unknown as MemoryDatabase
  const noteRows = memDb._getTable('note').filter(r => r.video_id === videoId)
  const nsTable = memDb._getTable('note_sentence')

  return noteRows.map(row => {
    const sentenceIds = nsTable
      .filter(ns => ns.note_id === row.id)
      .map(ns => ns.sentence_id)
    return rowToNote(row, sentenceIds)
  })
}

export async function updateVideoStatus(db: Database, id: string, status: string): Promise<void> {
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('video')
  for (const row of table) {
    if (row.id === id) {
      row.status = status
    }
  }
  memDb._setTable('video', table)
}

export async function listVideos(db: Database, sortBy: string = 'lastStudied'): Promise<Video[]> {
  const memDb = db as unknown as MemoryDatabase
  const videos = memDb._getTable('video').map(rowToVideo)

  const sorted = [...videos]
  switch (sortBy) {
    case 'lastStudied':
      sorted.sort((a, b) => b.lastStudiedAt - a.lastStudiedAt)
      break
    case 'createdAt':
      sorted.sort((a, b) => b.createdAt - a.createdAt)
      break
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title))
      break
  }
  return sorted
}

export async function searchVideosByTitle(db: Database, keyword: string): Promise<Video[]> {
  const memDb = db as unknown as MemoryDatabase
  return memDb._getTable('video')
    .filter(r => r.title.includes(keyword))
    .map(rowToVideo)
}

export async function updateVideoPosition(db: Database, id: string, position: number): Promise<void> {
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('video')
  for (const row of table) {
    if (row.id === id) {
      // position 单调递增：只能变大不能变小
      if (position > row.position) {
        row.position = position
      }
    }
  }
  memDb._setTable('video', table)
}

export async function updateVideoLastStudiedAt(db: Database, id: string, timestamp: number): Promise<void> {
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('video')
  for (const row of table) {
    if (row.id === id) {
      row.last_studied_at = timestamp
    }
  }
  memDb._setTable('video', table)
}

export async function setSetting(db: Database, key: string, value: string): Promise<void> {
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('setting')
  const existing = table.find(r => r.key === key)
  if (existing) {
    existing.value = value
  } else {
    table.push({ key, value })
  }
  memDb._setTable('setting', table)
}

export async function getSetting(db: Database, key: string): Promise<string | null> {
  const memDb = db as unknown as MemoryDatabase
  const row = memDb._getTable('setting').find(r => r.key === key)
  return row ? row.value : null
}

export async function deleteSetting(db: Database, key: string): Promise<void> {
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('setting').filter(r => r.key !== key)
  memDb._setTable('setting', table)
}

export async function deleteVideoWithCascade(db: Database, videoId: string): Promise<void> {
  const memDb = db as unknown as MemoryDatabase
  
  // 获取视频关联的 nodes
  const nodeRows = memDb._getTable('node').filter(r => r.video_id === videoId)
  const nodeIds = nodeRows.map(r => r.id)
  
  // 获取这些 nodes 关联的 sentences
  const sentenceRows = memDb._getTable('sentence').filter(r => nodeIds.includes(r.node_id))
  const sentenceIds = sentenceRows.map(r => r.id)
  
  // 获取视频关联的 notes
  const noteRows = memDb._getTable('note').filter(r => r.video_id === videoId)
  const noteIds = noteRows.map(r => r.id)
  
  // 删除 note_sentence 关联
  memDb._setTable('note_sentence', memDb._getTable('note_sentence').filter(
    r => !noteIds.includes(r.note_id)
  ))
  
  // 删除 sentences
  memDb._setTable('sentence', memDb._getTable('sentence').filter(
    r => !nodeIds.includes(r.node_id)
  ))
  
  // 删除 notes
  memDb._setTable('note', memDb._getTable('note').filter(
    r => r.video_id !== videoId
  ))
  
  // 删除 nodes
  memDb._setTable('node', memDb._getTable('node').filter(
    r => r.video_id !== videoId
  ))
  
  // 删除 video
  memDb._setTable('video', memDb._getTable('video').filter(
    r => r.id !== videoId
  ))
}

export async function determineRecoveryAction(db: Database, videoId: string): Promise<'skip_asr' | 'rerun_asr'> {
  const memDb = db as unknown as MemoryDatabase
  
  // 获取视频关联的 nodes
  const nodeRows = memDb._getTable('node').filter(r => r.video_id === videoId)
  const nodeIds = nodeRows.map(r => r.id)
  
  // 检查是否有 sentences
  const sentenceRows = memDb._getTable('sentence').filter(r => nodeIds.includes(r.node_id))
  
  if (sentenceRows.length > 0) {
    return 'skip_asr'
  } else {
    return 'rerun_asr'
  }
}

export async function atomicInsertSentences(db: Database, sentences: Sentence[]): Promise<void> {
  // 原子插入：全部成功或全部失败
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('sentence')
  const backup = [...table]
  
  try {
    for (const sentence of sentences) {
      table.push(sentenceToRow(sentence))
    }
    memDb._setTable('sentence', table)
  } catch (error) {
    // 回滚
    memDb._setTable('sentence', backup)
    throw error
  }
}
