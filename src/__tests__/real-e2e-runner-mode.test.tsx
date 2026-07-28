import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

const database = vi.hoisted(() => ({
  listTables: vi.fn(),
  getTableColumns: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
  tauriInvoke: tauri.invoke,
}))

vi.mock('@/models/db-singleton', () => ({
  getDb: vi.fn().mockResolvedValue(database),
}))

import { RealE2eRunner } from '@/e2e/real-e2e-runner'

describe('real E2E runner modes', () => {
  afterEach(() => {
    cleanup()
    tauri.invoke.mockReset()
    database.listTables.mockReset()
    database.getTableColumns.mockReset()
    delete window.__RAIN_E2E_RESULT__
    delete window.__RAIN_E2E_START__
    delete (window as Window & { __RAIN_RUNTIME_SETTINGS_SCHEMA__?: unknown })
      .__RAIN_RUNTIME_SETTINGS_SCHEMA__
  })

  it('reports the real database schema to runtime-settings WebDriver automation', async () => {
    tauri.invoke.mockResolvedValue({
      enabled: true,
      runMode: 'runtime-settings',
      databasePath: 'D:\\tmp\\runtime-settings.db',
    })
    database.listTables.mockResolvedValue(['video', 'setting'])
    database.getTableColumns.mockImplementation(async (table: string) =>
      table === 'video' ? ['id', 'title'] : ['key', 'value'],
    )

    render(<RealE2eRunner />)

    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('get_real_e2e_config'))
    await waitFor(() =>
      expect(
        (window as Window & {
          __RAIN_RUNTIME_SETTINGS_SCHEMA__?: {
            status: string
            tables?: Record<string, string[]>
          }
        }).__RAIN_RUNTIME_SETTINGS_SCHEMA__,
      ).toEqual({
        status: 'passed',
        tables: {
          video: ['id', 'title'],
          setting: ['key', 'value'],
        },
      }),
    )
    expect(database.getTableColumns).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('rain-real-e2e-status')).not.toBeInTheDocument()
    expect(window.__RAIN_E2E_RESULT__).toBeUndefined()
  })
})
