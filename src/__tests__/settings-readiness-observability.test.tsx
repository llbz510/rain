import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useRainStore } from '@/store/rain-store'
import { SettingsPage } from '@/ui/components/settings'

describe('runtime settings desktop observability', () => {
  afterEach(() => cleanup())

  it('exposes whether initialization has completed on the public settings page', () => {
    act(() => useRainStore.setState({ settingsReady: false, settingsError: null }))
    render(<SettingsPage />)

    expect(screen.getByTestId('settings-page')).toHaveAttribute(
      'data-runtime-settings-status',
      'loading',
    )

    act(() => useRainStore.setState({ settingsReady: true, settingsError: null }))
    expect(screen.getByTestId('settings-page')).toHaveAttribute(
      'data-runtime-settings-status',
      'ready',
    )
  })
})
