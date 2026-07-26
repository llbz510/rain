import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getDefaultRuntimeSettings } from '@/settings/model-pool'
import { recordCapabilityCheck } from '@/settings/model-capabilities'
import { PreflightPanel } from '@/ui/components/settings'

describe('settings preflight panel', () => {
  it('runs the preflight check and shows the user-visible readiness result', async () => {
    const onCapabilityRecords = vi.fn()
    const runCheck = vi.fn().mockResolvedValue({
      ready: true,
      checks: [
        { id: 'runtime', label: '桌面运行环境', status: 'ok', message: '桌面应用可用；Whisper 后端：cuda' },
        { id: 'whisper', label: '本地 Whisper', status: 'ok', message: '已找到 ggml-large-v3.bin' },
      ],
      capabilities: [
        {
          modelId: 'qwen-main',
          modelAlias: 'Qwen',
          role: 'structuring',
          status: 'Compatible',
          message: '结构化检查通过',
          checkedAt: 100,
          fingerprint: 'cap-v1-test',
        },
      ],
    })

    render(
      <PreflightPanel
        runtimeSettings={getDefaultRuntimeSettings()}
        runCheck={runCheck}
        onCapabilityRecords={onCapabilityRecords}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '运行自检' }))

    await waitFor(() => expect(runCheck).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent('可以处理本地视频')
    expect(screen.getByText('桌面应用可用；Whisper 后端：cuda')).toBeInTheDocument()
    expect(screen.getByText('已找到 ggml-large-v3.bin')).toBeInTheDocument()
    expect(screen.getByText('Compatible')).toBeInTheDocument()
    expect(screen.getByText('结构化 · Qwen')).toBeInTheDocument()
    expect(onCapabilityRecords).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ modelId: 'qwen-main', role: 'structuring', status: 'Compatible' }),
    ]))
  })

  it('shows a persisted capability result before another preflight run', () => {
    const runtimeSettings = getDefaultRuntimeSettings()
    const structuring = runtimeSettings.models.find((model) => model.id === 'qwen-main')!
    runtimeSettings.capabilities = [recordCapabilityCheck({
      model: structuring,
      role: 'structuring',
      ok: true,
      message: '上次结构化检查通过',
      checkedAt: 100,
    })]

    render(<PreflightPanel runtimeSettings={runtimeSettings} />)

    expect(screen.getByText('Compatible')).toBeInTheDocument()
    expect(screen.getByText('上次结构化检查通过')).toBeInTheDocument()
  })
})
