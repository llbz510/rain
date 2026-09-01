import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/pipeline/progress-listener', () => ({
  listenProgress: vi.fn(async () => undefined),
  unlistenProgress: vi.fn(),
}))

import { VideoListPage } from '@/pages/VideoListPage'
import { resetDb } from '@/models/db-singleton'
import { useRainStore } from '@/store/rain-store'

beforeEach(() => {
  resetDb()
  useRainStore.getState().reset()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetDb()
})

describe('AC-VL-04 empty library import call to action', () => {
  it('opens the existing import menu from the empty-library call to action', async () => {
    render(<VideoListPage />)

    const callToAction = await screen.findByRole('button', { name: '导入你的第一个视频' })
    expect(callToAction.tagName).toBe('BUTTON')
    expect(callToAction).toHaveAttribute('type', 'button')
    await waitFor(() => expect(callToAction).toBeEnabled())
    expect(screen.queryByRole('button', { name: '本地文件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '在线视频' })).not.toBeInTheDocument()

    fireEvent.click(callToAction)

    expect(screen.getByRole('button', { name: '本地文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '在线视频' })).toBeInTheDocument()
  })
})
