// harness/store-zustand-phase2.test.tsx
// ========================================
// Store Harness Phase 2: loadVideo / unloadVideo 真值断言
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect, beforeEach } from 'vitest'
import { useRainStore } from '@/store/rain-store'

beforeEach(() => {
  useRainStore.getState().reset()
})

describe('U09: loadVideo 后 currentVideoId 更新', () => {
  it('loadVideo 设置 currentVideoId 为传入值', async () => {
    await useRainStore.getState().loadVideo('video-123')
    expect(useRainStore.getState().currentVideoId).toBe('video-123')
  })
})

describe('U10: loadVideo 后 currentPage = study', () => {
  it('loadVideo 切换页面到 study', async () => {
    await useRainStore.getState().loadVideo('video-123')
    expect(useRainStore.getState().currentPage).toBe('study')
  })
})

describe('U11: loadVideo 后 playPosition = 0', () => {
  it('loadVideo 重置播放进度', async () => {
    await useRainStore.getState().loadVideo('video-123')
    expect(useRainStore.getState().playPosition).toBe(0)
  })
})

describe('U12: unloadVideo 后 currentVideoId = null', () => {
  it('unloadVideo 清空当前视频', async () => {
    await useRainStore.getState().loadVideo('video-123')
    useRainStore.getState().unloadVideo()
    expect(useRainStore.getState().currentVideoId).toBeNull()
  })
})

describe('U13: unloadVideo 后 currentPage = list', () => {
  it('unloadVideo 回到列表页', async () => {
    await useRainStore.getState().loadVideo('video-123')
    useRainStore.getState().unloadVideo()
    expect(useRainStore.getState().currentPage).toBe('list')
  })
})

describe('U14: unloadVideo 后数据缓存清空', () => {
  it('nodeTree / sentences / notes 长度为 0', async () => {
    await useRainStore.getState().loadVideo('video-123')
    useRainStore.getState().unloadVideo()
    const state = useRainStore.getState()
    expect(state.nodeTree).toHaveLength(0)
    expect(state.sentences).toHaveLength(0)
    expect(state.notes).toHaveLength(0)
  })
})

describe('U15: setPage 设置 currentPage', () => {
  it('setPage 切换到 settings', () => {
    useRainStore.getState().setPage('settings')
    expect(useRainStore.getState().currentPage).toBe('settings')
  })
})

describe('U16: loadVideo 接受字符串参数不抛错', () => {
  it('传入任意字符串不抛异常', async () => {
    await expect(
      useRainStore.getState().loadVideo('video-abc')
    ).resolves.not.toThrow()
  })
})
