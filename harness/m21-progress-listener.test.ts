// harness/m21-progress-listener.test.ts
// ========================================
// M21 Harness: 进度事件前端监听契约
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { listenProgress, unlistenProgress } from '@/pipeline/progress-listener'
import type { ProgressCallback } from '@/pipeline/progress-listener'
import {
  PROGRESS_EVENT_NAME,
  IMPORT_COMPLETE_EVENT,
  IMPORT_FAILED_EVENT,
  IMPORT_CANCELLED_EVENT,
  type ProgressPayload,
} from '@/architecture/events'

describe('M21-T09: listenProgress 函数存在', () => {
  it('listenProgress 是一个函数', () => {
    expect(typeof listenProgress).toBe('function')
  })
})

describe('M21-T10: unlistenProgress 函数存在', () => {
  it('unlistenProgress 是一个函数', () => {
    expect(typeof unlistenProgress).toBe('function')
  })
})

describe('M21-T11: ProgressCallback 接受 ProgressPayload', () => {
  it('构造合法 payload 对象可作为回调参数', () => {
    const payload: ProgressPayload = {
      videoId: 'v1',
      stage: 'asr',
      blockCurrent: 1,
      blockTotal: 3,
      percent: 50,
      retrying: false,
    }
    const callback: ProgressCallback = (p) => {
      expect(p.videoId).toBe('v1')
    }
    callback(payload)
  })
})

describe('M21-T12: 进度事件名 = progress', () => {
  it('PROGRESS_EVENT_NAME 值为 progress', () => {
    expect(PROGRESS_EVENT_NAME).toBe('progress')
  })
})

describe('M21-T13: IMPORT_COMPLETE_EVENT 存在', () => {
  it('值为 import_complete', () => {
    expect(IMPORT_COMPLETE_EVENT).toBe('import_complete')
  })
})

describe('M21-T14: IMPORT_FAILED_EVENT 存在', () => {
  it('值为 import_failed', () => {
    expect(IMPORT_FAILED_EVENT).toBe('import_failed')
  })
})

describe('M21-T15: IMPORT_CANCELLED_EVENT 存在', () => {
  it('值为 import_cancelled', () => {
    expect(IMPORT_CANCELLED_EVENT).toBe('import_cancelled')
  })
})
