import {
  asMemoryDatabase,
  isSqlDatabase,
  type Database,
} from './database-adapter'

export type SettingMutation =
  | { op: 'set'; key: string; value: string }
  | { op: 'delete'; key: string }

export async function applySettingMutationsAtomically(
  db: Database,
  mutations: SettingMutation[],
): Promise<void> {
  if (isSqlDatabase(db)) {
    const { tauriInvoke } = await import('@/lib/tauri-env')
    await tauriInvoke<void>('apply_settings_atomically', { mutations })
    return
  }

  const memory = asMemoryDatabase(db)
  let nextRows = memory.readTable('setting').map((row) => ({ ...row }))
  for (const mutation of mutations) {
    if (mutation.op === 'set') {
      const existing = nextRows.find((row) => row.key === mutation.key)
      if (existing) existing.value = mutation.value
      else nextRows.push({ key: mutation.key, value: mutation.value })
    } else {
      nextRows = nextRows.filter((row) => row.key !== mutation.key)
    }
  }
  memory.replaceTable('setting', nextRows)
}

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
