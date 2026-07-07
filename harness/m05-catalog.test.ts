// harness/m05-catalog.test.ts
// ========================================
// M05 Harness: 目录区交互语义
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import {
  handleTreeClick,
  handleTreeDoubleClick,
  handleBarClick,
  handleDiagramClick,
  handleDiagramDoubleClick,
  computeProgressIndicators,
  type InteractionResult,
} from '@/ui/catalog'

const mockState = {
  currentVideoId: 'v1',
  playPosition: 50,
  selectedNodeId: null as string | null,
  selectionOrigin: null as 'tree' | 'diagram' | null,
}

describe('M05-T01: 左树单击=仅选中（决策38）', () => {
  it('不 seek 视频，只更新 selectedNodeId', () => {
    const result = handleTreeClick('node1', mockState)
    expect(result.selectedNodeId).toBe('node1')
    expect(result.selectionOrigin).toBe('tree')
    expect(result.seekTo).toBeUndefined()  // 不 seek
  })
})

describe('M05-T02: 左树双击=三区跳转（决策40）', () => {
  it('seek 视频 + 更新选中', () => {
    const result = handleTreeDoubleClick('node1', mockState, { startTime: 30 })
    expect(result.seekTo).toBe(30)
    expect(result.selectedNodeId).toBe('node1')
    expect(result.scrollTextTo).toBeDefined()
  })
})

describe('M05-T03: 横条单击=跳转（决策38）', () => {
  it('直接 seek 视频', () => {
    const result = handleBarClick('node1', { startTime: 60 })
    expect(result.seekTo).toBe(60)
  })
})

describe('M05-T04: 导图单击=仅选中（决策48）', () => {
  it('不 seek 视频，只更新选中', () => {
    const result = handleDiagramClick('node1', mockState)
    expect(result.selectedNodeId).toBe('node1')
    expect(result.selectionOrigin).toBe('diagram')
    expect(result.seekTo).toBeUndefined()
  })
})

describe('M05-T05: 导图双击=三区跳转（决策48）', () => {
  it('seek 视频 + 更新选中', () => {
    const result = handleDiagramDoubleClick('node1', mockState, { startTime: 120 })
    expect(result.seekTo).toBe(120)
    expect(result.selectedNodeId).toBe('node1')
  })
})

describe('M05-T06: ■/□ 是瞬时指示（决策56）', () => {
  it('跟当前播放位置，非持久 position', () => {
    const nodes = [
      { id: 'n1', startTime: 0, endTime: 30 },
      { id: 'n2', startTime: 30, endTime: 60 },
      { id: 'n3', startTime: 60, endTime: 90 },
    ]
    const indicators = computeProgressIndicators(nodes, 45)  // 播放到 45 秒
    expect(indicators['n1']).toBe('filled')     // ■ 已播
    expect(indicators['n2']).toBe('current')    // 当前
    expect(indicators['n3']).toBe('empty')      // □ 未播
  })

  it('回退播放位置→■变□', () => {
    const nodes = [
      { id: 'n1', startTime: 0, endTime: 30 },
      { id: 'n2', startTime: 30, endTime: 60 },
    ]
    // 播到 50
    let indicators = computeProgressIndicators(nodes, 50)
    expect(indicators['n1']).toBe('filled')
    expect(indicators['n2']).toBe('current')

    // 回退到 10
    indicators = computeProgressIndicators(nodes, 10)
    expect(indicators['n1']).toBe('current')
    expect(indicators['n2']).toBe('empty')
  })
})

describe('M05-T07: 选中全局共享（决策41/48）', () => {
  it('左树选中后导图同步', () => {
    const result = handleTreeClick('node1', mockState)
    expect(result.selectedNodeId).toBe('node1')
    // 全局共享意味着同一个 state 被两个组件订阅
    // harness 验证 result 包含 selectedNodeId 即可
  })
})

describe('M05-T08: selectionOrigin 正确标记（决策53）', () => {
  it('左树选中 origin=tree', () => {
    const result = handleTreeClick('n1', mockState)
    expect(result.selectionOrigin).toBe('tree')
  })

  it('导图选中 origin=diagram', () => {
    const result = handleDiagramClick('n1', mockState)
    expect(result.selectionOrigin).toBe('diagram')
  })
})
