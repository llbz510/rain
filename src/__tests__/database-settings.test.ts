import { describe, expect, it, vi } from 'vitest'
import type { SqlDatabaseAdapter } from '@/models/database-adapter'
import {
  deleteSetting,
  getSetting,
  setSetting,
} from '@/models/database'

function sqliteAdapter(overrides: Partial<SqlDatabaseAdapter> = {}): SqlDatabaseAdapter {
  return {
    adapterKind: 'sqlite',
    listTables: vi.fn(),
    getTableColumns: vi.fn(),
    exec: vi.fn(),
    query: vi.fn(),
    ...overrides,
  }
}

describe('database settings persistence', () => {
  it('uses parameterized SQLite upsert, read and delete operations', async () => {
    const exec = vi.fn()
    const query = vi.fn().mockResolvedValue([{ value: '' }])
    const db = sqliteAdapter({
      exec,
      query: query as unknown as SqlDatabaseAdapter['query'],
    })

    await setSetting(db, "role_'assistant", 'model-1')
    await expect(getSetting(db, "role_'assistant")).resolves.toBe('')
    await deleteSetting(db, "role_'assistant")

    expect(exec.mock.calls).toEqual([
      [
        'INSERT INTO setting (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ["role_'assistant", 'model-1'],
      ],
      ['DELETE FROM setting WHERE key = $1', ["role_'assistant"]],
    ])
    expect(query).toHaveBeenCalledWith(
      'SELECT value FROM setting WHERE key = $1',
      ["role_'assistant"],
    )
  })

  it('returns null for a missing key and surfaces adapter failures', async () => {
    const missingDb = sqliteAdapter({
      query: vi.fn().mockResolvedValue([]) as unknown as SqlDatabaseAdapter['query'],
    })
    await expect(getSetting(missingDb, 'missing')).resolves.toBeNull()

    const failedDb = sqliteAdapter({
      exec: vi.fn().mockRejectedValue(new Error('database unavailable')),
    })
    await expect(setSetting(failedDb, 'key', 'value')).rejects.toThrow('database unavailable')
  })
})
