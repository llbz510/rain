// harness/m20-store-ytdlp.test.ts
// ========================================
// M20 Harness: actual Zustand state boundary
// URL/yt-dlp behavior is non-gating until a product AC is confirmed.
// Harness migration: 2026-07-26
// ========================================

import { beforeEach, describe, expect, it } from 'vitest'
import { useRainStore } from '@/store/rain-store'

beforeEach(() => {
  useRainStore.getState().reset()
})

describe('M20-T07: Zustand store 包含当前 UI 会话态', () => {
  it('真实 store 暴露当前页面所需字段', () => {
    const state = useRainStore.getState()
    const expectedFields = [
      'currentVideoId',
      'selectedNodeId',
      'selectionOrigin',
      'playPosition',
      'layoutMode',
      'undoStack',
      'subtitleOn',
      'translationOn',
      'aiPanelState',
      'noteEditState',
      'importQueue',
      'importDialogOpen',
    ]

    for (const field of expectedFields) {
      expect(state).toHaveProperty(field)
    }
  })
})

describe('M20-T08: Zustand 只缓存当前视频学习数据', () => {
  it('真实 store 包含 nodeTree、sentences、notes，不包含全量视频缓存', () => {
    const state = useRainStore.getState()

    expect(state).toHaveProperty('nodeTree')
    expect(state).toHaveProperty('sentences')
    expect(state).toHaveProperty('notes')
    expect(state).not.toHaveProperty('otherVideos')
    expect(state).not.toHaveProperty('videoList')
    expect(state).not.toHaveProperty('allVideosCache')
  })

  it('unloadVideo 清空当前视频缓存和选择状态', () => {
    useRainStore.setState({
      currentVideoId: 'video-1',
      selectedNodeId: 'node-1',
      selectionOrigin: 'tree',
      playPosition: 42,
      nodeTree: [{ id: 'node-1' }] as never,
      sentences: [{ id: 'sentence-1' }] as never,
      notes: [{ id: 'note-1' }] as never,
    })

    useRainStore.getState().unloadVideo()

    expect(useRainStore.getState()).toMatchObject({
      currentVideoId: null,
      selectedNodeId: null,
      selectionOrigin: null,
      playPosition: 0,
      nodeTree: [],
      sentences: [],
      notes: [],
    })
  })
})

describe('M20-T10: 撤销栈不跨会话持久', () => {
  it('reset 清空真实 store 的撤销栈和临时导入状态', () => {
    useRainStore.getState().pushUndo({ type: 'rename', nodeId: 'node-1' })
    useRainStore.setState({
      importQueue: [{ id: 'import-1' }],
      importDialogOpen: true,
    })

    useRainStore.getState().reset()

    expect(useRainStore.getState().undoStack).toEqual([])
    expect(useRainStore.getState().importQueue).toEqual([])
    expect(useRainStore.getState().importDialogOpen).toBe(false)
  })
})
