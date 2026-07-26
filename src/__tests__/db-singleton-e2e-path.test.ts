import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  tauriInvoke: vi.fn(),
}))

vi.mock('@/models/database', () => ({
  createDatabase: mocks.createDatabase,
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
  tauriInvoke: mocks.tauriInvoke,
}))

describe('database singleton E2E isolation', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.createDatabase.mockReset()
    mocks.tauriInvoke.mockReset()
    mocks.createDatabase.mockResolvedValue({ kind: 'database' })
  })

  it('opens the evidence database selected by the desktop E2E config', async () => {
    mocks.tauriInvoke.mockResolvedValue({
      enabled: true,
      databasePath: 'D:\\evidence\\rain-e2e.db',
    })
    const { getDb } = await import('@/models/db-singleton')

    await getDb()

    expect(mocks.tauriInvoke).toHaveBeenCalledWith('get_real_e2e_config')
    expect(mocks.createDatabase).toHaveBeenCalledWith('D:\\evidence\\rain-e2e.db')
  })
})
