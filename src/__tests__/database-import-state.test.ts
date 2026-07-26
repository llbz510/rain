import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlDatabaseAdapter } from '@/models/database-adapter'
import {
  determineRecoveryAction,
  transitionVideoImportState,
} from '@/models/database'

const mocks = vi.hoisted(() => ({
  tauriInvoke: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  tauriInvoke: mocks.tauriInvoke,
}))

function sqliteAdapter(query: SqlDatabaseAdapter['query']): SqlDatabaseAdapter {
  return {
    adapterKind: 'sqlite',
    listTables: vi.fn(),
    getTableColumns: vi.fn(),
    exec: vi.fn(),
    query,
  }
}

describe('database import state SQLite adapter', () => {
  beforeEach(() => {
    mocks.tauriInvoke.mockReset()
  })

  it('delegates guarded state transitions to the Rust command', async () => {
    const db = sqliteAdapter(vi.fn())
    const expected = { status: 'pending' as const, stage: null }
    const next = { status: 'processing' as const, stage: 'asr' as const }

    await transitionVideoImportState(db, 'video-1', expected, next)

    expect(mocks.tauriInvoke).toHaveBeenCalledWith('transition_video_import_state', {
      videoId: 'video-1',
      expected,
      next,
    })
  })

  it.each([
    [2, 'skip_asr'],
    [0, 'rerun_asr'],
  ] as const)('maps persisted sentence count %i to %s', async (count, expected) => {
    const query = vi.fn().mockResolvedValue([{ cnt: count }])
    const db = sqliteAdapter(query)

    await expect(determineRecoveryAction(db, 'video-1')).resolves.toBe(expected)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT COUNT(*) as cnt FROM sentence'),
      ['video-1'],
    )
  })
})
