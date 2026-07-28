import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
  tauriInvoke: tauri.invoke,
}))

import { RealE2eRunner } from '@/e2e/real-e2e-runner'

describe('real E2E runner modes', () => {
  afterEach(() => {
    cleanup()
    tauri.invoke.mockReset()
    delete window.__RAIN_E2E_RESULT__
    delete window.__RAIN_E2E_START__
  })

  it('leaves runtime-settings desktop automation to WebDriver', async () => {
    tauri.invoke.mockResolvedValue({
      enabled: true,
      runMode: 'runtime-settings',
      databasePath: 'D:\\tmp\\runtime-settings.db',
    })

    render(<RealE2eRunner />)

    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith('get_real_e2e_config'))
    expect(screen.queryByTestId('rain-real-e2e-status')).not.toBeInTheDocument()
    expect(window.__RAIN_E2E_RESULT__).toBeUndefined()
  })
})
