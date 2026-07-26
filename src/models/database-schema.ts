interface DatabaseColumnDefinition {
  name: string
  sql: string
}

interface DatabaseTableDefinition {
  name: string
  columns: readonly DatabaseColumnDefinition[]
  constraints?: readonly string[]
}

const DATABASE_SCHEMA: readonly DatabaseTableDefinition[] = [
  {
    name: 'video',
    columns: [
      { name: 'id', sql: 'TEXT PRIMARY KEY' },
      { name: 'title', sql: 'TEXT NOT NULL' },
      { name: 'source', sql: 'TEXT NOT NULL' },
      { name: 'source_url', sql: 'TEXT' },
      { name: 'file_path', sql: 'TEXT' },
      { name: 'thumbnail', sql: 'TEXT' },
      { name: 'duration', sql: 'INTEGER' },
      { name: 'language', sql: 'TEXT' },
      { name: 'status', sql: 'TEXT' },
      { name: 'stage', sql: 'TEXT' },
      { name: 'error_message', sql: 'TEXT' },
      { name: 'created_at', sql: 'INTEGER' },
      { name: 'position', sql: 'INTEGER' },
      { name: 'last_studied_at', sql: 'INTEGER' },
    ],
  },
  {
    name: 'node',
    columns: [
      { name: 'id', sql: 'TEXT PRIMARY KEY' },
      { name: 'video_id', sql: 'TEXT NOT NULL' },
      { name: 'parent_id', sql: 'TEXT' },
      { name: 'kind', sql: 'TEXT NOT NULL' },
      { name: 'title', sql: 'TEXT NOT NULL' },
      { name: 'type', sql: 'TEXT' },
      { name: 'start_time', sql: 'INTEGER' },
      { name: 'end_time', sql: 'INTEGER' },
      { name: 'text', sql: 'TEXT' },
      { name: 'translation', sql: 'TEXT' },
      { name: 'sort_order', sql: 'INTEGER' },
    ],
  },
  {
    name: 'sentence',
    columns: [
      { name: 'id', sql: 'TEXT PRIMARY KEY' },
      { name: 'node_id', sql: 'TEXT NOT NULL' },
      { name: 'text', sql: 'TEXT NOT NULL' },
      { name: 'start_time', sql: 'INTEGER' },
      { name: 'end_time', sql: 'INTEGER' },
      { name: 'sort_order', sql: 'INTEGER' },
    ],
  },
  {
    name: 'note',
    columns: [
      { name: 'id', sql: 'TEXT PRIMARY KEY' },
      { name: 'video_id', sql: 'TEXT NOT NULL' },
      { name: 'content', sql: 'TEXT' },
      { name: 'source', sql: 'TEXT' },
      { name: 'created_at', sql: 'INTEGER' },
      { name: 'derivation_id', sql: 'TEXT' },
      { name: 'sort_order', sql: 'INTEGER' },
    ],
  },
  {
    name: 'note_sentence',
    columns: [
      { name: 'note_id', sql: 'TEXT NOT NULL' },
      { name: 'sentence_id', sql: 'TEXT NOT NULL' },
    ],
    constraints: ['PRIMARY KEY (note_id, sentence_id)'],
  },
  {
    name: 'setting',
    columns: [
      { name: 'key', sql: 'TEXT PRIMARY KEY' },
      { name: 'value', sql: 'TEXT' },
    ],
  },
  {
    name: 'import_checkpoint',
    columns: [
      { name: 'video_id', sql: 'TEXT PRIMARY KEY' },
      { name: 'stage', sql: 'TEXT NOT NULL' },
      { name: 'completed_blocks_json', sql: 'TEXT NOT NULL' },
      { name: 'error_message', sql: 'TEXT' },
      { name: 'updated_at', sql: 'INTEGER NOT NULL' },
    ],
  },
]

export const DATABASE_SCHEMA_SQL: readonly string[] = DATABASE_SCHEMA.map((table) => {
  const columnsAndConstraints = [
    ...table.columns.map((column) => `${column.name} ${column.sql}`),
    ...(table.constraints ?? []),
  ]
    .join(',\n    ')
  return `CREATE TABLE IF NOT EXISTS ${table.name} (\n    ${columnsAndConstraints}\n  )`
})

export function listDatabaseTableNames(): string[] {
  return DATABASE_SCHEMA.map((table) => table.name)
}

export function getDatabaseTableColumns(tableName: string): string[] {
  const table = DATABASE_SCHEMA.find((candidate) => candidate.name === tableName)
  return table?.columns.map((column) => column.name) ?? []
}
