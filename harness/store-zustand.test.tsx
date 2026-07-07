// harness/store-zustand.test.tsx
// ========================================
// Zustand Store Harness
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect, beforeEach } from 'vitest'
import { useRainStore } from '@/store/rain-store'

beforeEach(() => {
  useRainStore.getState().reset()
})

describe('U01: store 初始状态（决策99）', () => {
  it('currentVideoId 初始为 null', () => {
    expect(useRainStore.getState().currentVideoId).toBeNull()
  })

  it('layoutMode 初始为 follow', () => {
    expect(useRainStore.getState().layoutMode).toBe('follow')
  })

  it('undoStack 初始为空', () => {
    expect(useRainStore.getState().undoStack).toEqual([])
  })
})

describe('U02: selectNode 更新选中状态（决策53）', () => {
  it('更新 selectedNodeId 和 selectionOrigin', () => {
    useRainStore.getState().selectNode('node1', 'tree')
    expect(useRainStore.getState().selectedNodeId).toBe('node1')
    expect(useRainStore.getState().selectionOrigin).toBe('tree')
  })

  it('导图选中 origin=diagram', () => {
    useRainStore.getState().selectNode('node2', 'diagram')
    expect(useRainStore.getState().selectionOrigin).toBe('diagram')
  })
})

describe('U03: 选中状态全局共享（决策41）', () => {
  it('store 变更后订阅者收到更新', () => {
    useRainStore.getState().selectNode('node1', 'tree')
    // 多个组件订阅同一个 store，getState 反映最新值
    expect(useRainStore.getState().selectedNodeId).toBe('node1')
  })
})

describe('U04: 撤销栈 push/pop（决策83）', () => {
  it('pushUndo 压入逆操作', () => {
    useRainStore.getState().pushUndo({ type: 'rename', nodeId: 'n1', oldTitle: '旧标题' })
    expect(useRainStore.getState().undoStack).toHaveLength(1)
  })

  it('popUndo 弹出最近的逆操作', () => {
    useRainStore.getState().pushUndo({ type: 'rename', nodeId: 'n1', oldTitle: '旧标题' })
    const action = useRainStore.getState().popUndo()
    expect(action).toBeDefined()
    expect(action!.type).toBe('rename')
    expect(useRainStore.getState().undoStack).toHaveLength(0)
  })
})

describe('U05: 撤销栈上限 ~20 步（决策83）', () => {
  it('超过 20 步时丢弃最早的', () => {
    for (let i = 0; i < 25; i++) {
      useRainStore.getState().pushUndo({ type: 'rename', nodeId: `n${i}`, oldTitle: `标题${i}` })
    }
    expect(useRainStore.getState().undoStack.length).toBeLessThanOrEqual(20)
  })
})

describe('U06: switchLayoutMode（决策21）', () => {
  it('从 follow 切到 textExpand', () => {
    useRainStore.getState().switchLayoutMode('textExpand')
    expect(useRainStore.getState().layoutMode).toBe('textExpand')
  })

  it('展开模式再点自己 = 收回 follow', () => {
    useRainStore.getState().switchLayoutMode('textExpand')
    useRainStore.getState().switchLayoutMode('textExpand')
    expect(useRainStore.getState().layoutMode).toBe('follow')
  })
})

describe('U07: loadVideo 从 DB 填充缓存（决策99）', () => {
  it('loadVideo 是函数', () => {
    expect(typeof useRainStore.getState().loadVideo).toBe('function')
  })
})

describe('U08: unloadVideo 清空缓存（决策99）', () => {
  it('unloadVideo 是函数', () => {
    expect(typeof useRainStore.getState().unloadVideo).toBe('function')
  })
})
