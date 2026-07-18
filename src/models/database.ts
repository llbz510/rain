// src/models/database.ts
// ========================================
// 数据库实现：
// - Tauri 运行时 → 真实 SQLite（@tauri-apps/plugin-sql）
// - 测试/jsdom/开发（无 Tauri runtime）→ 内存 Map fallback
// 公开 API（Database 接口 + 所有导出函数签名）两种后端完全一致。
// ========================================

import type { Video, VideoStatus, Node, Sentence, Note, ImportCheckpoint } from './types'
// 仅类型引用：编译期擦除，不在 jsdom 下触发模块加载。
// 运行时通过 createDatabase 内的动态 import() 加载。
import type TauriSqlPlugin from '@tauri-apps/plugin-sql'

export interface Database {
  listTables(): Promise<string[]>
  getTableColumns(table: string): Promise<string[]>
  exec(sql: string, params?: any[]): Promise<void>
  query<T = any>(sql: string, params?: any[]): Promise<T[]>
}

interface TableRow {
  [key: string]: any
}

// ========================================
// 内存数据库实现（SQL-like in-memory）
// jsdom 测试 / 非 Tauri 开发环境的 fallback
// ========================================

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
    this.tables.set('import_checkpoint', ['video_id', 'stage', 'completed_blocks_json', 'error_message', 'updated_at'])

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
    // 内存路径不通过 SQL 操作，仅占位以实现接口
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

// ========================================
// Tauri 运行时 SQLite 实现
// 通过 @tauri-apps/plugin-sql 的 Database.load('sqlite:' + path)
// ========================================

// 检测是否运行在 Tauri 环境中。
// jsdom 测试环境：window 存在但没有 '__TAURI_INTERNALS__' → 返回 false → 走内存 fallback。
// Tauri 运行时：window.__TAURI_INTERNALS__ 由 Tauri 注入 → 返回 true → 走真实 SQLite。
function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// 6 张表的建表 SQL（字段与内存版 schema 完全一致，CREATE TABLE IF NOT EXISTS 保证幂等）
const SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS video (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT,
    file_path TEXT,
    thumbnail TEXT,
    duration INTEGER,
    language TEXT,
    status TEXT,
    stage TEXT,
    error_message TEXT,
    created_at INTEGER,
    position INTEGER,
    last_studied_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS node (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    parent_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT,
    start_time INTEGER,
    end_time INTEGER,
    text TEXT,
    translation TEXT,
    sort_order INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sentence (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    text TEXT NOT NULL,
    start_time INTEGER,
    end_time INTEGER,
    sort_order INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS note (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    content TEXT,
    source TEXT,
    created_at INTEGER,
    derivation_id TEXT,
    sort_order INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS note_sentence (
    note_id TEXT NOT NULL,
    sentence_id TEXT NOT NULL,
    PRIMARY KEY (note_id, sentence_id)
  )`,
  `CREATE TABLE IF NOT EXISTS setting (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS import_checkpoint (
    video_id TEXT PRIMARY KEY,
    stage TEXT NOT NULL,
    completed_blocks_json TEXT NOT NULL,
    error_message TEXT,
    updated_at INTEGER NOT NULL
  )`,
]

class TauriSqlDatabase implements Database {
  private db: TauriSqlPlugin

  constructor(db: TauriSqlPlugin) {
    this.db = db
  }

  // 建表（在 createDatabase 中 await 调用，构造器不能 async）
  async init(): Promise<void> {
    for (const sql of SCHEMA_SQL) {
      await this.db.execute(sql)
    }
  }

  async listTables(): Promise<string[]> {
    const rows = await this.db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    return rows.map(r => r.name)
  }

  async getTableColumns(table: string): Promise<string[]> {
    // PRAGMA 不支持参数绑定标识符，校验表名后内联（仅内部受控表名）
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return []
    const rows = await this.db.select<{ name: string }[]>(`PRAGMA table_info(${table})`)
    return rows.map(r => r.name)
  }

  async exec(sql: string, params: any[] = []): Promise<void> {
    await this.db.execute(sql, params)
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return await this.db.select<T[]>(sql, params)
  }
}

// ========================================
// 行/对象转换（两种后端共用）
// ========================================

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

// 辅助：判断 Database 实例是否为 Tauri 后端
function isTauriDb(db: Database): db is TauriSqlDatabase {
  return db instanceof TauriSqlDatabase
}

// ===== 导出函数 =====

export async function createDatabase(path: string = ':memory:'): Promise<Database> {
  if (isTauriEnvironment()) {
    // 动态 import：仅在 Tauri 环境下加载，避免 jsdom 在模块加载期访问 Tauri API 报错
    const mod = await import('@tauri-apps/plugin-sql')
    const TauriDatabase = mod.default
    const raw = await TauriDatabase.load('sqlite:' + path)
    const tdb = new TauriSqlDatabase(raw)
    await tdb.init()
    return tdb
  }
  return new MemoryDatabase()
}

export async function insertVideo(db: Database, video: Video): Promise<void> {
  if (isTauriDb(db)) {
    const r = videoToRow(video)
    await db.exec(
      'INSERT INTO video (id, title, source, source_url, file_path, thumbnail, duration, language, status, stage, error_message, created_at, position, last_studied_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
      [r.id, r.title, r.source, r.source_url, r.file_path, r.thumbnail, r.duration, r.language, r.status, r.stage, r.error_message, r.created_at, r.position, r.last_studied_at]
    )
    return
  }
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('video')
  table.push(videoToRow(video))
  memDb._setTable('video', table)
}

export async function getVideoById(db: Database, id: string): Promise<Video | null> {
  if (isTauriDb(db)) {
    const rows = await db.query<TableRow>('SELECT * FROM video WHERE id = $1', [id])
    return rows.length > 0 ? rowToVideo(rows[0]) : null
  }
  const memDb = db as unknown as MemoryDatabase
  const row = memDb._getTable('video').find(r => r.id === id)
  return row ? rowToVideo(row) : null
}

export async function insertNodes(db: Database, nodes: Node[]): Promise<void> {
  if (isTauriDb(db)) {
    for (const node of nodes) {
      const r = nodeToRow(node)
      await db.exec(
        'INSERT INTO node (id, video_id, parent_id, kind, title, type, start_time, end_time, text, translation, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [r.id, r.video_id, r.parent_id, r.kind, r.title, r.type, r.start_time, r.end_time, r.text, r.translation, r.sort_order]
      )
    }
    return
  }
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('node')
  for (const node of nodes) {
    table.push(nodeToRow(node))
  }
  memDb._setTable('node', table)
}

export async function getNodesByVideoId(db: Database, videoId: string): Promise<Node[]> {
  if (isTauriDb(db)) {
    const rows = await db.query<TableRow>('SELECT * FROM node WHERE video_id = $1', [videoId])
    return rows.map(rowToNode)
  }
  const memDb = db as unknown as MemoryDatabase
  return memDb._getTable('node')
    .filter(r => r.video_id === videoId)
    .map(rowToNode)
}

function assertSentenceIdsAvailable(table: TableRow[], sentences: Sentence[]): void {
  const ids = new Set(table.map(row => row.id))
  for (const sentence of sentences) {
    if (ids.has(sentence.id)) {
      throw new Error(`Sentence already exists: ${sentence.id}`)
    }
    ids.add(sentence.id)
  }
}

export async function insertSentences(db: Database, sentences: Sentence[]): Promise<void> {
  if (isTauriDb(db)) {
    for (const sentence of sentences) {
      const r = sentenceToRow(sentence)
      await db.exec(
        'INSERT INTO sentence (id, node_id, text, start_time, end_time, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
        [r.id, r.node_id, r.text, r.start_time, r.end_time, r.sort_order]
      )
    }
    return
  }
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('sentence')
  for (const sentence of sentences) {
    table.push(sentenceToRow(sentence))
  }
  memDb._setTable('sentence', table)
}

export async function getSentencesByNodeId(db: Database, nodeId: string): Promise<Sentence[]> {
  if (isTauriDb(db)) {
    const rows = await db.query<TableRow>(
      'SELECT * FROM sentence WHERE node_id = $1 ORDER BY sort_order ASC',
      [nodeId]
    )
    return rows.map(rowToSentence)
  }
  const memDb = db as unknown as MemoryDatabase
  return memDb._getTable('sentence')
    .filter(r => r.node_id === nodeId)
    .map(rowToSentence)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function insertNote(db: Database, note: Note): Promise<void> {
  if (isTauriDb(db)) {
    const r = noteToRow(note)
    await db.exec(
      'INSERT INTO note (id, video_id, content, source, created_at, derivation_id, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [r.id, r.video_id, r.content, r.source, r.created_at, r.derivation_id, r.sort_order]
    )
    for (const sentenceId of note.sentenceIds) {
      await db.exec(
        'INSERT INTO note_sentence (note_id, sentence_id) VALUES ($1, $2)',
        [note.id, sentenceId]
      )
    }
    return
  }
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
  if (isTauriDb(db)) {
    const noteRows = await db.query<TableRow>('SELECT * FROM note WHERE video_id = $1', [videoId])
    const result: Note[] = []
    for (const row of noteRows) {
      const nsRows = await db.query<{ sentence_id: string }>(
        'SELECT sentence_id FROM note_sentence WHERE note_id = $1',
        [row.id]
      )
      result.push(rowToNote(row, nsRows.map(ns => ns.sentence_id)))
    }
    return result
  }
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
  if (isTauriDb(db)) {
    await db.exec('UPDATE video SET status = $1 WHERE id = $2', [status, id])
    return
  }
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('video')
  for (const row of table) {
    if (row.id === id) {
      row.status = status
    }
  }
  memDb._setTable('video', table)
}

export interface VideoImportState {
  status: VideoStatus
  stage: Video['stage'] | null
  errorMessage?: string | null
}

export async function transitionVideoImportState(
  db: Database,
  id: string,
  expected: VideoImportState,
  next: VideoImportState,
): Promise<void> {
  if (isTauriDb(db)) {
    const { tauriInvoke } = await import('@/lib/tauri-env')
    await tauriInvoke<void>('transition_video_import_state', {
      videoId: id,
      expected,
      next,
    })
    return
  }
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('video')
  const row = table.find((candidate) => candidate.id === id)
  const actualStage = row?.stage ?? null
  if (!row || row.status !== expected.status || actualStage !== expected.stage) {
    throw new Error(`Persisted import state changed for video "${id}"`)
  }
  row.status = next.status
  row.stage = next.stage
  row.error_message = next.errorMessage ?? null
  memDb._setTable('video', table)
}
export async function listVideos(db: Database, sortBy: string = 'lastStudied'): Promise<Video[]> {
  if (isTauriDb(db)) {
    let sql = 'SELECT * FROM video'
    switch (sortBy) {
      case 'lastStudied':
        sql += ' ORDER BY last_studied_at DESC'
        break
      case 'createdAt':
        sql += ' ORDER BY created_at DESC'
        break
      case 'title':
        sql += ' ORDER BY title ASC'
        break
    }
    const rows = await db.query<TableRow>(sql)
    return rows.map(rowToVideo)
  }
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
  if (isTauriDb(db)) {
    const rows = await db.query<TableRow>('SELECT * FROM video WHERE title LIKE $1', [`%${keyword}%`])
    return rows.map(rowToVideo)
  }
  const memDb = db as unknown as MemoryDatabase
  return memDb._getTable('video')
    .filter(r => r.title.includes(keyword))
    .map(rowToVideo)
}

export async function updateVideoPosition(db: Database, id: string, position: number): Promise<void> {
  if (isTauriDb(db)) {
    // position 单调递增：仅当新值严格大于当前值才更新（与内存版语义一致）
    await db.exec(
      'UPDATE video SET position = $1 WHERE id = $2 AND position < $1',
      [position, id]
    )
    return
  }
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
  if (isTauriDb(db)) {
    await db.exec('UPDATE video SET last_studied_at = $1 WHERE id = $2', [timestamp, id])
    return
  }
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
  if (isTauriDb(db)) {
    await db.exec(
      'INSERT INTO setting (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    )
    return
  }
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
  if (isTauriDb(db)) {
    const rows = await db.query<{ value: string }>('SELECT value FROM setting WHERE key = $1', [key])
    return rows.length > 0 ? rows[0].value : null
  }
  const memDb = db as unknown as MemoryDatabase
  const row = memDb._getTable('setting').find(r => r.key === key)
  return row ? row.value : null
}

export async function deleteSetting(db: Database, key: string): Promise<void> {
  if (isTauriDb(db)) {
    await db.exec('DELETE FROM setting WHERE key = $1', [key])
    return
  }
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('setting').filter(r => r.key !== key)
  memDb._setTable('setting', table)
}

export async function deleteVideoWithCascade(db: Database, videoId: string): Promise<void> {
  if (isTauriDb(db)) {
    // 级联删除顺序：先删依赖关联，再删主体
    await db.exec('DELETE FROM note_sentence WHERE note_id IN (SELECT id FROM note WHERE video_id = $1)', [videoId])
    await db.exec('DELETE FROM sentence WHERE node_id = $1 OR node_id IN (SELECT id FROM node WHERE video_id = $1)', [videoId])
    await db.exec('DELETE FROM note WHERE video_id = $1', [videoId])
    await db.exec('DELETE FROM node WHERE video_id = $1', [videoId])
    await db.exec('DELETE FROM import_checkpoint WHERE video_id = $1', [videoId])
    await db.exec('DELETE FROM video WHERE id = $1', [videoId])
    return
  }
  const memDb = db as unknown as MemoryDatabase

  // 获取视频关联的 nodes
  const nodeRows = memDb._getTable('node').filter(r => r.video_id === videoId)
  const nodeIds = nodeRows.map(r => r.id)

  // 获取这些 nodes 关联的 sentences
  const sentenceRows = memDb._getTable('sentence').filter(r => r.node_id === videoId || nodeIds.includes(r.node_id))
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
  memDb._setTable('import_checkpoint', memDb._getTable('import_checkpoint').filter(
    r => r.video_id !== videoId
  ))
}

export async function determineRecoveryAction(db: Database, videoId: string): Promise<'skip_asr' | 'rerun_asr'> {
  if (isTauriDb(db)) {
    const rows = await db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM sentence WHERE node_id = $1 OR node_id IN (SELECT id FROM node WHERE video_id = $1)',
      [videoId]
    )
    return rows[0]?.cnt > 0 ? 'skip_asr' : 'rerun_asr'
  }
  const memDb = db as unknown as MemoryDatabase

  // 获取视频关联的 nodes
  const nodeRows = memDb._getTable('node').filter(r => r.video_id === videoId)
  const nodeIds = nodeRows.map(r => r.id)

  // 检查是否有 sentences
  const sentenceRows = memDb._getTable('sentence').filter(r => r.node_id === videoId || nodeIds.includes(r.node_id))

  if (sentenceRows.length > 0) {
    return 'skip_asr'
  } else {
    return 'rerun_asr'
  }
}


export async function saveImportCheckpoint(db: Database, checkpoint: ImportCheckpoint): Promise<void> {
  const completedBlocksJson = checkpoint.completedBlockOutputs
    ? JSON.stringify({ version: 2, blocks: checkpoint.completedBlockOutputs })
    : JSON.stringify(checkpoint.completedBlocks)
  if (isTauriDb(db)) {
    await db.exec(
      'INSERT INTO import_checkpoint (video_id, stage, completed_blocks_json, error_message, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(video_id) DO UPDATE SET stage = excluded.stage, completed_blocks_json = excluded.completed_blocks_json, error_message = excluded.error_message, updated_at = excluded.updated_at',
      [checkpoint.videoId, checkpoint.stage, completedBlocksJson, checkpoint.errorMessage ?? null, checkpoint.updatedAt]
    )
    return
  }
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('import_checkpoint')
  const row = {
    video_id: checkpoint.videoId,
    stage: checkpoint.stage,
    completed_blocks_json: completedBlocksJson,
    error_message: checkpoint.errorMessage ?? null,
    updated_at: checkpoint.updatedAt,
  }
  const existingIndex = table.findIndex(item => item.video_id === checkpoint.videoId)
  if (existingIndex >= 0) table[existingIndex] = row
  else table.push(row)
  memDb._setTable('import_checkpoint', table)
}

export async function getImportCheckpoint(db: Database, videoId: string): Promise<ImportCheckpoint | null> {
  let row: TableRow | undefined
  if (isTauriDb(db)) {
    row = (await db.query<TableRow>('SELECT * FROM import_checkpoint WHERE video_id = $1', [videoId]))[0]
  } else {
    row = (db as unknown as MemoryDatabase)._getTable('import_checkpoint').find(item => item.video_id === videoId)
  }
  if (!row) return null
  let completedBlocks: string[] = []
  let completedBlockOutputs: unknown[] | undefined
  try {
    const parsed: unknown = JSON.parse(row.completed_blocks_json)
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      completedBlocks = parsed
    } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const encoded = parsed as { version?: unknown; blocks?: unknown }
      if (encoded.version === 2 && Array.isArray(encoded.blocks)) {
        completedBlockOutputs = encoded.blocks
        completedBlocks = encoded.blocks.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return []
          const blockId = (value as { blockId?: unknown }).blockId
          return typeof blockId === 'string' ? [blockId] : []
        })
      }
    }
  } catch {
    completedBlocks = []
  }
  return {
    videoId: row.video_id,
    stage: row.stage,
    completedBlocks,
    completedBlockOutputs,
    errorMessage: row.error_message ?? undefined,
    updatedAt: row.updated_at,
  }
}

export async function getSentencesByVideoId(db: Database, videoId: string): Promise<Sentence[]> {
  if (isTauriDb(db)) {
    const rows = await db.query<TableRow>(
      'SELECT sentence.* FROM sentence LEFT JOIN node ON sentence.node_id = node.id WHERE sentence.node_id = $1 OR node.video_id = $1 ORDER BY sentence.sort_order ASC',
      [videoId]
    )
    return rows.map(rowToSentence)
  }
  const memDb = db as unknown as MemoryDatabase
  const nodeIds = new Set(memDb._getTable('node').filter(row => row.video_id === videoId).map(row => row.id))
  return memDb._getTable('sentence')
    .filter(row => row.node_id === videoId || nodeIds.has(row.node_id))
    .map(rowToSentence)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function saveAsrAtomically(
  videoId: string,
  language: string,
  sentences: Sentence[],
  database?: Database,
): Promise<void> {
  const db = database ?? await (await import('./db-singleton')).getDb()
  if (!await getVideoById(db, videoId)) {
    throw new Error(`Video not found: ${videoId}`)
  }
  const asrSentences = sentences.map(sentence => sentence.nodeId ? sentence : { ...sentence, nodeId: videoId })
  if (isTauriDb(db)) {
    const { tauriInvoke } = await import('@/lib/tauri-env')
    await tauriInvoke<void>('save_asr_atomically', { videoId, language, sentences: asrSentences })
    return
  }

  const memDb = db as unknown as MemoryDatabase
  const sentenceRows = memDb._getTable('sentence')
  const videoRows = memDb._getTable('video')
  const sentenceBackup = sentenceRows.map(row => ({ ...row }))
  const videoBackup = videoRows.map(row => ({ ...row }))
  try {
    const video = videoRows.find(row => row.id === videoId)
    if (!video) throw new Error(`Video not found: ${videoId}`)
    if (video.status !== 'processing' || video.stage !== 'asr') {
      throw new Error(`Persisted import state changed for video "${videoId}"`)
    }
    for (const sentence of asrSentences) {
      assertSentenceIdsAvailable(sentenceRows, [sentence])
      sentenceRows.push(sentenceToRow(sentence))
    }
    video.language = language
    video.status = 'processing'
    video.stage = 'stage2'
    memDb._setTable('sentence', sentenceRows)
    memDb._setTable('video', videoRows)
  } catch (error) {
    memDb._setTable('sentence', sentenceBackup)
    memDb._setTable('video', videoBackup)
    throw error
  }
}
export async function assignAsrSentencesToNodes(
  db: Database,
  videoId: string,
  sentences: Sentence[],
): Promise<void> {
  if (isTauriDb(db)) {
    const { tauriInvoke } = await import('@/lib/tauri-env')
    await tauriInvoke<void>('assign_asr_sentences_atomically', {
      videoId,
      assignments: sentences.map((sentence) => ({
        id: sentence.id,
        nodeId: sentence.nodeId,
        sortOrder: sentence.sortOrder,
      })),
    })
    return
  }
  const memDb = db as unknown as MemoryDatabase
  const rows = memDb._getTable('sentence')
  const backup = rows.map((row) => ({ ...row }))
  const validNodeIds = new Set(
    memDb._getTable('node').filter((row) => row.video_id === videoId).map((row) => row.id),
  )
  try {
    for (const sentence of sentences) {
      if (!validNodeIds.has(sentence.nodeId)) {
        throw new Error(`Cannot assign ASR sentence "${sentence.id}" to node "${sentence.nodeId}"`)
      }
      const row = rows.find((candidate) => candidate.id === sentence.id && candidate.node_id === videoId)
      if (!row) {
        throw new Error(`Cannot assign ASR sentence "${sentence.id}" to node "${sentence.nodeId}"`)
      }
      row.node_id = sentence.nodeId
      row.sort_order = sentence.sortOrder
    }
    memDb._setTable('sentence', rows)
  } catch (error) {
    memDb._setTable('sentence', backup)
    throw error
  }
}

export async function mergeImportAtomically(
  db: Database,
  videoId: string,
  nodes: Node[],
  sentences: Sentence[],
): Promise<void> {
  const assignments = sentences.map((sentence) => ({
    id: sentence.id,
    nodeId: sentence.nodeId,
    sortOrder: sentence.sortOrder,
  }))
  if (isTauriDb(db)) {
    const { tauriInvoke } = await import('@/lib/tauri-env')
    await tauriInvoke<void>('merge_import_atomically', { videoId, nodes, assignments })
    return
  }

  const memDb = db as unknown as MemoryDatabase
  const nodeRows = memDb._getTable('node')
  const sentenceRows = memDb._getTable('sentence')
  const videoRows = memDb._getTable('video')
  const nodeBackup = nodeRows.map((row) => ({ ...row }))
  const sentenceBackup = sentenceRows.map((row) => ({ ...row }))
  const videoBackup = videoRows.map((row) => ({ ...row }))
  try {
    const video = videoRows.find((row) => row.id === videoId)
    if (!video || video.status !== 'processing' || video.stage !== 'merging') {
      throw new Error(`Persisted import state changed for video "${videoId}"`)
    }
    const submittedNodeIds = new Set(nodes.map((node) => node.id))
    if (submittedNodeIds.size !== nodes.length) throw new Error('Submitted node graph contains duplicate node IDs')
    for (const node of nodes) {
      if (node.videoId !== videoId) throw new Error(`Cannot insert import node "${node.id}"`)
      if (node.parentId !== null && !submittedNodeIds.has(node.parentId)) {
        throw new Error(`Submitted node "${node.id}" has missing parent "${node.parentId}"`)
      }
    }
    const placeholderIds = sentenceRows
      .filter((row) => row.node_id === videoId)
      .map((row) => String(row.id))
    const assignmentIds = assignments.map((assignment) => assignment.id)
    const uniqueAssignmentIds = new Set(assignmentIds)
    if (assignmentIds.length !== placeholderIds.length || uniqueAssignmentIds.size !== assignmentIds.length
      || placeholderIds.some((id) => !uniqueAssignmentIds.has(id))) {
      throw new Error('Sentence assignments must exhaust placeholder ASR sentences exactly once')
    }
    if (assignments.some((assignment) => !submittedNodeIds.has(assignment.nodeId))) {
      throw new Error('Sentence assignment targets a node outside the submitted graph')
    }

    const allNodeIds = new Set(nodeRows.map((row) => row.id))
    for (const node of nodes) {
      if (allNodeIds.has(node.id)) throw new Error(`Cannot insert import node "${node.id}"`)
      allNodeIds.add(node.id)
      nodeRows.push(nodeToRow(node))
    }
    for (const assignment of assignments) {
      const row = sentenceRows.find((candidate) =>
        candidate.id === assignment.id && candidate.node_id === videoId)
      if (!row) {
        throw new Error(`Cannot assign ASR sentence "${assignment.id}" to node "${assignment.nodeId}"`)
      }
      row.node_id = assignment.nodeId
      row.sort_order = assignment.sortOrder
    }
    video.status = 'ready'
    video.stage = null
    video.error_message = null
    memDb._setTable('node', nodeRows)
    memDb._setTable('sentence', sentenceRows)
    memDb._setTable('video', videoRows)
  } catch (error) {
    memDb._setTable('node', nodeBackup)
    memDb._setTable('sentence', sentenceBackup)
    memDb._setTable('video', videoBackup)
    throw error
  }
}
export async function atomicInsertSentences(db: Database, sentences: Sentence[]): Promise<void> {
  if (isTauriDb(db)) {
    // 原子插入：用 BEGIN/COMMIT/ROLLBACK 事务保证全部成功或全部失败
    await db.exec('BEGIN')
    try {
      for (const sentence of sentences) {
        const r = sentenceToRow(sentence)
        await db.exec(
          'INSERT INTO sentence (id, node_id, text, start_time, end_time, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
          [r.id, r.node_id, r.text, r.start_time, r.end_time, r.sort_order]
        )
      }
      await db.exec('COMMIT')
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
    return
  }
  // 原子插入：全部成功或全部失败
  const memDb = db as unknown as MemoryDatabase
  const table = memDb._getTable('sentence')
  const backup = table.map(row => ({ ...row }))

  try {
    assertSentenceIdsAvailable(table, sentences)
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
