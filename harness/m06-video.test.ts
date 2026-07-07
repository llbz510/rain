// harness/m06-video.test.ts
// ========================================
// M06 Harness: 视频区
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import {
  createVideoController,
  type VideoController,
} from '@/ui/video'

describe('M06-T01: 播放控制', () => {
  it('支持 play, pause, seek 操作', () => {
    const ctrl = createVideoController()
    expect(typeof ctrl.play).toBe('function')
    expect(typeof ctrl.pause).toBe('function')
    expect(typeof ctrl.seek).toBe('function')
  })
})

describe('M06-T02: 字幕叠加（M13 决策78）', () => {
  it('提供字幕渲染数据', () => {
    const ctrl = createVideoController()
    expect(typeof ctrl.getCurrentSubtitle).toBe('function')
  })
})

describe('M06-T03: 字幕开关（决策91）', () => {
  it('字幕可切换显隐', () => {
    const ctrl = createVideoController()
    ctrl.setSubtitleVisible(true)
    expect(ctrl.isSubtitleVisible()).toBe(true)
    ctrl.setSubtitleVisible(false)
    expect(ctrl.isSubtitleVisible()).toBe(false)
  })
})

describe('M06-T04: 重开视频自动续播（决策56）', () => {
  it('打开视频时 seek 到 position', () => {
    const ctrl = createVideoController()
    const seekPosition = ctrl.getResumePosition(200)  // position=200
    expect(seekPosition).toBe(200)
  })
})
