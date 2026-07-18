import { describe, expect, it, vi } from 'vitest'
import { testQwenConnection } from '@/llm/qwen-health'

const settings = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.5-omni-flash',
  apiKey: 'sk-test-secret',
}

describe('Qwen connection health check', () => {
  it('uses the fixed DashScope JSON request and returns a latency without the key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
    }), { status: 200 }))

    const clock = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(142)
    const result = await testQwenConnection(settings, fetcher, clock)

    expect(fetcher).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
    const request = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(request).toMatchObject({
      model: 'qwen3.5-omni-flash',
      response_format: { type: 'json_object' },
      messages: expect.arrayContaining([
        expect.objectContaining({ content: 'Return JSON only. Return {"ok":true}.' }),
      ]),
    })
    expect(result).toEqual({ ok: true, latencyMs: 42, message: '连接成功（42 ms）' })
    expect(JSON.stringify(result)).not.toContain(settings.apiKey)
  })

  it('does not disclose the saved key when HTTP or JSON validation fails', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(`bad ${settings.apiKey}`, { status: 401, statusText: 'Unauthorized' }))

    const result = await testQwenConnection(settings, fetcher, (() => 3) as () => number)

    expect(result.ok).toBe(false)
    expect(result.message).not.toContain(settings.apiKey)
    expect(result.message).toContain('连接测试失败')
  })

  it('rejects another endpoint or model before sending a request', async () => {
    const fetcher = vi.fn()
    await expect(testQwenConnection({ ...settings, model: 'other' }, fetcher)).rejects.toThrow('只能测试配置的 Qwen 连接')
    expect(fetcher).not.toHaveBeenCalled()
  })
})