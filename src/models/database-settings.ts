import {
  asMemoryDatabase,
  isSqlDatabase,
  type Database,
} from './database-adapter'

export async function setSetting(
  db: Database,
  key: string,
  value: string,
): Promise<void> {
  if (isSqlDatabase(db)) {
    await db.exec(
      'INSERT INTO setting (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    )
    return
  }

  const memory = asMemoryDatabase(db)
  const rows = memory.readTable('setting')
  const existing = rows.find((row) => row.key === key)
  if (existing) existing.value = value
  else rows.push({ key, value })
  memory.replaceTable('setting', rows)
}

export async function getSetting(
  db: Database,
  key: string,
): Promise<string | null> {
  if (isSqlDatabase(db)) {
    const rows = await db.query<{ value: string }>(
      'SELECT value FROM setting WHERE key = $1',
      [key],
    )
    return rows.length > 0 ? rows[0].value : null
  }

  const row = asMemoryDatabase(db)
    .readTable('setting')
    .find((candidate) => candidate.key === key)
  return row ? row.value : null
}

export async function deleteSetting(
  db: Database,
  key: string,
): Promise<void> {
  if (isSqlDatabase(db)) {
    await db.exec('DELETE FROM setting WHERE key = $1', [key])
    return
  }

  const memory = asMemoryDatabase(db)
  memory.replaceTable(
    'setting',
    memory.readTable('setting').filter((row) => row.key !== key),
  )
}
