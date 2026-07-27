// src/models/database.ts
// ========================================
// 数据库实现：
// - Tauri 运行时 → 真实 SQLite（@tauri-apps/plugin-sql）
// - 测试/jsdom/开发（无 Tauri runtime）→ 内存 Map fallback
// 公开 API（Database 接口 + 所有导出函数签名）两种后端完全一致。
// ========================================

import {
  isSqlDatabase,
  type Database,
  type MemoryDatabaseAdapter,
  type SqlDatabaseAdapter,
  type TableRow,
} from './database-adapter'
import {
  DATABASE_SCHEMA_SQL,
  getDatabaseTableColumns,
  listDatabaseTableNames,
} from './database-schema'
// 仅类型引用：编译期擦除，不在 jsdom 下触发模块加载。
// 运行时通过 createDatabase 内的动态 import() 加载。
import type TauriSqlPlugin from '@tauri-apps/plugin-sql'

export type { Database } from './database-adapter'
export { getImportCheckpoint, saveImportCheckpoint } from './database-checkpoints'
export {
  determineRecoveryAction,
  transitionVideoImportState,
  type ImportRecoveryAction,
  type VideoImportState,
} from './database-import-state'
export {
  assignAsrSentencesToNodes,
  atomicInsertSentences,
  mergeImportAtomically,
  saveAsrAtomically,
} from './database-import-atomic'
export {
  getNodesByVideoId,
  getSentencesByNodeId,
  getSentencesByVideoId,
  insertNodes,
  insertSentences,
} from './database-content'
export {
  getNotesByVideoId,
  insertNote,
  updateNoteContent,
} from './database-notes'
export {
  getVideoById,
  insertVideo,
  listVideos,
  searchVideosByTitle,
  updateVideoLastStudiedAt,
  updateVideoPosition,
  updateVideoStatus,
} from './database-videos'

// ========================================
// 内存数据库实现（SQL-like in-memory）
// jsdom 测试 / 非 Tauri 开发环境的 fallback
// ========================================

class MemoryDatabase implements MemoryDatabaseAdapter {
  readonly adapterKind = 'memory'
  private tables: Map<string, string[]> = new Map()
  private data: Map<string, TableRow[]> = new Map()

  constructor() {
    this.initSchema()
  }

  private initSchema(): void {
    for (const tableName of listDatabaseTableNames()) {
      this.tables.set(tableName, getDatabaseTableColumns(tableName))
      this.data.set(tableName, [])
    }
  }

  async listTables(): Promise<string[]> {
    return Array.from(this.tables.keys())
  }

  async getTableColumns(table: string): Promise<string[]> {
    return this.tables.get(table) ?? []
  }

  readTable(tableName: string): TableRow[] {
    return this.data.get(tableName) ?? []
  }

  replaceTable(tableName: string, rows: TableRow[]): void {
    this.data.set(tableName, rows)
  }

  _getTable(tableName: string): TableRow[] {
    return this.readTable(tableName)
  }

  _setTable(tableName: string, rows: TableRow[]): void {
    this.replaceTable(tableName, rows)
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

class TauriSqlDatabase implements SqlDatabaseAdapter {
  readonly adapterKind = 'sqlite'
  private db: TauriSqlPlugin

  constructor(db: TauriSqlPlugin) {
    this.db = db
  }

  // 建表（在 createDatabase 中 await 调用，构造器不能 async）
  async init(): Promise<void> {
    for (const sql of DATABASE_SCHEMA_SQL) {
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

function isTauriDb(db: Database): db is SqlDatabaseAdapter {
  return isSqlDatabase(db)
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
