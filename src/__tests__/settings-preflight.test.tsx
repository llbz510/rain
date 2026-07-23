import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getDefaultRuntimeSettings } from '@/settings/model-pool'
import { PreflightPanel } from '@/ui/components/settings'

describe('settings preflight panel', () => {
  it('runs the preflight check and shows the user-visible readiness result', async () => {
    const runCheck = vi.fn().mockResolvedValue({
      ready: true,
      checks: [
        { id: 'runtime', label: '桌面运行环境', status: 'ok', message: '桌面应用可用；Whisper 后端：cuda' },
        { id: 'whisper', label: '本地 Whisper', status: 'ok', message: '已找到 ggml-large-v3.bin' },
      ],
    })

    render(<PreflightPanel runtimeSettings={getDefaultRuntimeSettings()} runCheck={runCheck} />)

    fireEvent.click(screen.getByRole('button', { name: '运行自检' }))

    await waitFor(() => expect(runCheck).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent('可以处理本地视频')
    expect(screen.getByText('桌面应用可用；Whisper 后端：cuda')).toBeInTheDocument()
    expect(screen.getByText('已找到 ggml-large-v3.bin')).toBeInTheDocument()
  })
})
