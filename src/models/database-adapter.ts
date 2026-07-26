export interface TableRow {
  [key: string]: any
}

export interface Database {
  readonly adapterKind: 'memory' | 'sqlite'
  listTables(): Promise<string[]>
  getTableColumns(table: string): Promise<string[]>
}

export interface MemoryDatabaseAdapter extends Database {
  readonly adapterKind: 'memory'
  readTable(tableName: string): TableRow[]
  replaceTable(tableName: string, rows: TableRow[]): void
}

export interface SqlDatabaseAdapter extends Database {
  readonly adapterKind: 'sqlite'
  exec(sql: string, params?: any[]): Promise<void>
  query<T = any>(sql: string, params?: any[]): Promise<T[]>
}

export function isSqlDatabase(db: Database): db is SqlDatabaseAdapter {
  return db.adapterKind === 'sqlite'
}

export function asMemoryDatabase(db: Database): MemoryDatabaseAdapter {
  if (db.adapterKind !== 'memory') {
    throw new Error('Expected the in-memory database adapter')
  }
  return db as MemoryDatabaseAdapter
}
