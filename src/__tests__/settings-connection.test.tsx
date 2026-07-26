import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelPoolList, testSavedQwenConnection } from '@/ui/components/settings'

describe('model pool connection check', () => {
  it('tests the configured Qwen model and displays only a sanitized latency result', async () => {
    const testConnection = vi.fn().mockResolvedValue({
      ok: true,
      latencyMs: 42,
      message: '连接成功（42 ms）',
    })

    render(<ModelPoolList
      models={[{ id: 'qwen-main', alias: 'Qwen', type: 'llm', supportsVision: true, canTest: true }]}
      onTestConnection={testConnection}
    />)

    fireEvent.click(screen.getByRole('button', { name: '测试 Qwen' }))

    await waitFor(() => expect(testConnection).toHaveBeenCalledWith('qwen-main'))
    expect(screen.getByRole('status')).toHaveTextContent('连接成功（42 ms）')
    expect(screen.queryByText('sk-test-secret')).not.toBeInTheDocument()
  })

  it('passes only the saved Qwen connection into the checker without persisting it', async () => {
    const checker = vi.fn().mockResolvedValue({ ok: true, latencyMs: 7, message: '连接成功（7 ms）' })
    await expect(testSavedQwenConnection({
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      modelName: 'qwen3.5-omni-flash',
      apiKey: 'sk-test-secret',
    }, checker)).resolves.toMatchObject({ ok: true, latencyMs: 7 })
    expect(checker).toHaveBeenCalledWith({
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.5-omni-flash',
      apiKey: 'sk-test-secret',
    })
  })
  it('does not offer a Qwen connection test for a non-Qwen model', () => {
    render(<ModelPoolList models={[{ id: 'other', alias: 'Other', type: 'llm', supportsVision: false, canTest: false }]} onTestConnection={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '测试 Other' })).toBeNull()
  })

  it('offers the real structuring capability check for any LLM model', async () => {
    const checkStructuring = vi.fn().mockResolvedValue({
      ok: true,
      message: '结构化能力检查通过',
    })

    render(
      <ModelPoolList
        models={[{ id: 'other', alias: 'Other', type: 'llm', supportsVision: false, canTest: false }]}
        onCheckStructuring={checkStructuring}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '检查结构化 Other' }))

    await waitFor(() => expect(checkStructuring).toHaveBeenCalledWith('other'))
    expect(screen.getByRole('status')).toHaveTextContent('结构化能力检查通过')
  })
})
