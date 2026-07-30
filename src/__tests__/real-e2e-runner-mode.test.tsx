import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

const database = vi.hoisted(() => ({
  listTables: vi.fn(),
  getTableColumns: vi.fn(),
}))

const pendingImport = vi.hoisted(() => ({
  getVideoById: vi.fn(),
  insertVideo: vi.fn(),
  listVideos: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
  tauriInvoke: tauri.invoke,
}))

vi.mock('@/models/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/models/database')>()
  return {
    ...actual,
    getVideoById: pendingImport.getVideoById,
    insertVideo: pendingImport.insertVideo,
    listVideos: pendingImport.listVideos,
  }
})

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
    pendingImport.getVideoById.mockReset()
    pendingImport.insertVideo.mockReset()
    pendingImport.listVideos.mockReset()
    delete window.__RAIN_E2E_RESULT__
    delete window.__RAIN_E2E_START__
    delete (window as Window & { __RAIN_RUNTIME_SETTINGS_SCHEMA__?: unknown })
      .__RAIN_RUNTIME_SETTINGS_SCHEMA__
    delete (window as Window & { __RAIN_PENDING_IMPORT_RECOVERY__?: unknown })
      .__RAIN_PENDING_IMPORT_RECOVERY__
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
    const pendingVideo = {
      id: 'rain-pending-import-recovery-e2e-video',
      title: 'Rain Pending Import Recovery E2E',
      source: 'local' as const,
      filePath: 'D:\\rain-e2e\\pending-import-recovery.mp4',
      thumbnail: '',
      duration: 1,
      language: '',
      status: 'pending' as const,
      createdAt: 1,
      position: 0,
      lastStudiedAt: 1,
    }
    pendingImport.getVideoById
      .mockResolvedValueOnce(null)
      .mockResolvedValue(pendingVideo)
    pendingImport.insertVideo.mockResolvedValue(undefined)
    pendingImport.listVideos.mockResolvedValue([pendingVideo])

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
    await waitFor(() => expect(pendingImport.insertVideo).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        id: 'rain-pending-import-recovery-e2e-video',
        status: 'pending',
      }),
    ))
    expect(pendingImport.insertVideo.mock.calls[0]?.[1]).not.toHaveProperty('stage')
    await waitFor(() => expect(
      (window as Window & {
        __RAIN_PENDING_IMPORT_RECOVERY__?: {
          status: string
          videoId?: string
          videoStatus?: string
          videoStage?: string | null
          matchingVideoCount?: number
          totalVideoCount?: number
        }
      }).__RAIN_PENDING_IMPORT_RECOVERY__,
    ).toEqual({
      status: 'passed',
      videoId: 'rain-pending-import-recovery-e2e-video',
      videoStatus: 'pending',
      videoStage: null,
      matchingVideoCount: 1,
      totalVideoCount: 1,
    }))
    expect(screen.queryByTestId('rain-real-e2e-status')).not.toBeInTheDocument()
    expect(window.__RAIN_E2E_RESULT__).toBeUndefined()
  })
})
