// harness/m02-tree.test.ts
// ========================================
// M02 Harness: 树形结构不变量
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import type { Node, Sentence } from '@/models/types'
import { validateTree } from '@/models/validators'

// 辅助函数：创建测试用的最小树
function makeTree(overrides: Partial<{ nodes: Node[]; sentences: Sentence[] }> = {}) {
  const defaultNodes: Node[] = [
    {
      id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter',
      title: '第一章', type: null, startTime: 0, endTime: 300,
      text: null, sortOrder: 0,
    },
    {
      id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section',
      title: '第一节', type: null, startTime: 0, endTime: 120,
      text: null, sortOrder: 0,
    },
    {
      id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph',
      title: '段落1', type: 'concept', startTime: 0, endTime: 60,
      text: '句子一。句子二。', sortOrder: 0,
    },
    {
      id: 'p2', videoId: 'v1', parentId: 'sec1', kind: 'paragraph',
      title: '段落2', type: 'example', startTime: 60, endTime: 120,
      text: '句子三。句子四。', sortOrder: 1,
    },
    {
      id: 'sec2', videoId: 'v1', parentId: 'ch1', kind: 'section',
      title: '第二节', type: null, startTime: 120, endTime: 300,
      text: null, sortOrder: 1,
    },
    {
      id: 'p3', videoId: 'v1', parentId: 'sec2', kind: 'paragraph',
      title: '段落3', type: 'analogy', startTime: 120, endTime: 200,
      text: '句子五。', sortOrder: 0,
    },
    {
      id: 'p4', videoId: 'v1', parentId: 'sec2', kind: 'paragraph',
      title: '段落4', type: 'transition', startTime: 200, endTime: 300,
      text: '句子六。', sortOrder: 1,
    },
  ]

  return {
    nodes: overrides.nodes ?? defaultNodes,
    sentences: overrides.sentences ?? [],
  }
}

// ===== 第四组：树形结构不变量 =====

describe('M02-T17: 段落恒为叶子（M02）', () => {
  it('段落下面不能有子节点，违反时 validateTree 报错', () => {
    const { nodes } = makeTree()
    // 给段落 p1 加一个子节点 — 违反不变量
    const badChild: Node = {
      id: 'bad', videoId: 'v1', parentId: 'p1', kind: 'paragraph',
      title: '非法子节点', type: 'concept', startTime: 0, endTime: 30,
      text: '...', sortOrder: 0,
    }
    const errors = validateTree([...nodes, badChild])
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.includes('paragraph') && e.includes('leaf'))).toBe(true)
  })

  it('合法的段落（无子节点）validateTree 不报错', () => {
    const { nodes } = makeTree()
    const errors = validateTree(nodes)
    expect(errors).toEqual([])
  })
})

describe('M02-T18: 同级兄弟按时间排序（决策42）', () => {
  it('前一个兄弟的 startTime < 后一个兄弟的 startTime', () => {
    const { nodes } = makeTree()
    // 把 p2 的 startTime 改到 p1 之前 — 违反时间排序
    const badNodes = nodes.map(n =>
      n.id === 'p2' ? { ...n, startTime: 0, endTime: 30 } : n
    )
    // p1 startTime=0, p2 startTime=0 且 sortOrder=1 — 时间不严格递增
    const errors = validateTree(badNodes)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.includes('time') && e.includes('order'))).toBe(true)
  })
})

describe('M02-T19: 同级兄弟时间不重叠（决策42）', () => {
  it('前一个兄弟的 endTime ≤ 后一个兄弟的 startTime', () => {
    const { nodes } = makeTree()
    // 让 p1 的 endTime 超过 p2 的 startTime — 重叠
    const badNodes = nodes.map(n =>
      n.id === 'p1' ? { ...n, endTime: 80 } : n  // p1 end=80 > p2 start=60
    )
    const errors = validateTree(badNodes)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.includes('overlap'))).toBe(true)
  })
})

describe('M02-T20: 子节点时间范围 ⊆ 父节点时间范围（决策42）', () => {
  it('子节点时间超出父节点范围时报错', () => {
    const { nodes } = makeTree()
    // 让 p1 的 endTime 超出 sec1 的 endTime
    const badNodes = nodes.map(n =>
      n.id === 'p1' ? { ...n, endTime: 200 } : n  // sec1.endTime=120, p1.endTime=200
    )
    const errors = validateTree(badNodes)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.includes('parent') && e.includes('range'))).toBe(true)
  })

  it('子节点时间 startTime 早于父节点也报错', () => {
    const { nodes } = makeTree()
    const badNodes = nodes.map(n =>
      n.id === 'p3' ? { ...n, startTime: 100 } : n  // sec2.startTime=120, p3.startTime=100
    )
    const errors = validateTree(badNodes)
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('M02-T21: 数据模型不限深度（决策4）', () => {
  it('4 层结构（章节>小节>子小节>段落）也是合法的', () => {
    const deepNodes: Node[] = [
      {
        id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter',
        title: '章节', type: null, startTime: 0, endTime: 100,
        text: null, sortOrder: 0,
      },
      {
        id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section',
        title: '小节', type: null, startTime: 0, endTime: 100,
        text: null, sortOrder: 0,
      },
      {
        id: 'subsec1', videoId: 'v1', parentId: 'sec1', kind: 'section',
        title: '子小节', type: null, startTime: 0, endTime: 100,
        text: null, sortOrder: 0,
      },
      {
        id: 'p1', videoId: 'v1', parentId: 'subsec1', kind: 'paragraph',
        title: '段落', type: 'concept', startTime: 0, endTime: 100,
        text: '内容', sortOrder: 0,
      },
    ]
    const errors = validateTree(deepNodes)
    expect(errors).toEqual([])
  })
})
