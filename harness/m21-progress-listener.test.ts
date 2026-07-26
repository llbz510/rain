// harness/m21-progress-listener.test.ts
// ========================================
// M21 Harness: progress event adapter behavior
// Harness migration: 2026-07-26
// ========================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProgressPayload } from '@/architecture/events'

const mocks = vi.hoisted(() => ({
  isTauri: true,
  listen: vi.fn(),
  unlisten: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => mocks.isTauri,
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}))

import { listenProgress, unlistenProgress } from '@/pipeline/progress-listener'

const payload: ProgressPayload = {
  videoId: 'v1',
  stage: 'asr_transcription',
  blockCurrent: 1,
  blockTotal: 3,
  percent: 50,
  retrying: false,
}

beforeEach(() => {
  unlistenProgress()
  mocks.isTauri = true
  mocks.listen.mockReset()
  mocks.unlisten.mockReset()
  mocks.listen.mockResolvedValue(mocks.unlisten)
})

afterEach(() => {
  unlistenProgress()
})

describe('M21: progress 事件适配器', () => {
  it('订阅 progress 并把 Tauri payload 原样交给控制器', async () => {
    const callback = vi.fn()
    await listenProgress(callback)

    expect(mocks.listen).toHaveBeenCalledWith('progress', expect.any(Function))
    const eventHandler = mocks.listen.mock.calls[0][1]
    eventHandler({ payload })
    expect(callback).toHaveBeenCalledWith(payload)
  })

  it('重复订阅前释放旧监听器', async () => {
    await listenProgress(vi.fn())
    await listenProgress(vi.fn())

    expect(mocks.unlisten).toHaveBeenCalledTimes(1)
    expect(mocks.listen).toHaveBeenCalledTimes(2)
  })

  it('unlistenProgress 只释放当前监听器一次', async () => {
    await listenProgress(vi.fn())

    unlistenProgress()
    unlistenProgress()

    expect(mocks.unlisten).toHaveBeenCalledTimes(1)
  })

  it('非 Tauri 环境不注册桌面事件', async () => {
    mocks.isTauri = false

    await listenProgress(vi.fn())

    expect(mocks.listen).not.toHaveBeenCalled()
  })
})
