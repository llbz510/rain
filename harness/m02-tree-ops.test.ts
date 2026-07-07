// harness/m02-tree-ops.test.ts
// ========================================
// M02 Harness: 结构编辑操作
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import type { Node, Sentence, Note } from '@/models/types'
import {
  splitParagraph,
  mergeNodes,
  deleteNode,
  reparentNode,
  changeNodeType,
  renameNode,
} from '@/models/tree-ops'
import { validateTree } from '@/models/validators'

// ===== 测试用的标准树 =====
// ch1 [0-300]
//   sec1 [0-120]
//     p1 [0-60]  concept  (s1, s2, s3)
//     p2 [60-120] example  (s4, s5)
//   sec2 [120-300]
//     p3 [120-200] analogy  (s6, s7)
//     p4 [200-300] transition (s8, s9, s10)

function makeStandardTree(): { nodes: Node[]; sentences: Sentence[]; notes: Note[] } {
  const nodes: Node[] = [
    { id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter', title: '第一章', type: null, startTime: 0, endTime: 300, text: null, sortOrder: 0 },
    { id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '第一节', type: null, startTime: 0, endTime: 120, text: null, sortOrder: 0 },
    { id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph', title: '段落1', type: 'concept', startTime: 0, endTime: 60, text: '句一。句二。句三。', sortOrder: 0 },
    { id: 'p2', videoId: 'v1', parentId: 'sec1', kind: 'paragraph', title: '段落2', type: 'example', startTime: 60, endTime: 120, text: '句四。句五。', sortOrder: 1 },
    { id: 'sec2', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '第二节', type: null, startTime: 120, endTime: 300, text: null, sortOrder: 1 },
    { id: 'p3', videoId: 'v1', parentId: 'sec2', kind: 'paragraph', title: '段落3', type: 'analogy', startTime: 120, endTime: 200, text: '句六。句七。', sortOrder: 0 },
    { id: 'p4', videoId: 'v1', parentId: 'sec2', kind: 'paragraph', title: '段落4', type: 'transition', startTime: 200, endTime: 300, text: '句八。句九。句十。', sortOrder: 1 },
  ]

  const sentences: Sentence[] = [
    { id: 's1', nodeId: 'p1', text: '句一。', startTime: 0, endTime: 20, sortOrder: 0 },
    { id: 's2', nodeId: 'p1', text: '句二。', startTime: 20, endTime: 40, sortOrder: 1 },
    { id: 's3', nodeId: 'p1', text: '句三。', startTime: 40, endTime: 60, sortOrder: 2 },
    { id: 's4', nodeId: 'p2', text: '句四。', startTime: 60, endTime: 90, sortOrder: 0 },
    { id: 's5', nodeId: 'p2', text: '句五。', startTime: 90, endTime: 120, sortOrder: 1 },
    { id: 's6', nodeId: 'p3', text: '句六。', startTime: 120, endTime: 160, sortOrder: 0 },
    { id: 's7', nodeId: 'p3', text: '句七。', startTime: 160, endTime: 200, sortOrder: 1 },
    { id: 's8', nodeId: 'p4', text: '句八。', startTime: 200, endTime: 230, sortOrder: 0 },
    { id: 's9', nodeId: 'p4', text: '句九。', startTime: 230, endTime: 270, sortOrder: 1 },
    { id: 's10', nodeId: 'p4', text: '句十。', startTime: 270, endTime: 300, sortOrder: 2 },
  ]

  const notes: Note[] = [
    { id: 'note1', videoId: 'v1', content: '', source: 'excerpt', sentenceIds: ['s1', 's2', 's3'], createdAt: 1000, sortOrder: 0 },
    { id: 'note2', videoId: 'v1', content: '我的笔记', source: 'user', sentenceIds: ['s6'], createdAt: 2000, sortOrder: 1 },
  ]

  return { nodes, sentences, notes }
}

// ===== 拆分 =====

describe('M02-T24: 拆分段落 — 提取连续句子为新段落（决策44）', () => {
  it('从 p1 提取 s3 为新段落', () => {
    const { nodes, sentences } = makeStandardTree()
    const result = splitParagraph(nodes, sentences, 'p1', ['s3'])

    // 原段落 p1 只保留 s1, s2
    const origSentences = result.sentences.filter(s => s.nodeId === 'p1')
    expect(origSentences.map(s => s.id)).toEqual(['s1', 's2'])

    // 新段落包含 s3
    const newParagraph = result.nodes.find(n =>
      n.kind === 'paragraph' && n.id !== 'p1' && n.id !== 'p2' && n.parentId === 'sec1'
    )
    expect(newParagraph).toBeDefined()
    const newSentences = result.sentences.filter(s => s.nodeId === newParagraph!.id)
    expect(newSentences.map(s => s.id)).toEqual(['s3'])
  })
})

describe('M02-T25: 拆分后时间范围自动重算（决策4e）', () => {
  it('原段落和新段落的时间范围根据各自句子重算', () => {
    const { nodes, sentences } = makeStandardTree()
    const result = splitParagraph(nodes, sentences, 'p1', ['s3'])

    const origParagraph = result.nodes.find(n => n.id === 'p1')!
    expect(origParagraph.startTime).toBe(0)   // s1.start
    expect(origParagraph.endTime).toBe(40)     // s2.end

    const newParagraph = result.nodes.find(n =>
      n.kind === 'paragraph' && n.id !== 'p1' && n.id !== 'p2' && n.parentId === 'sec1'
    )!
    expect(newParagraph.startTime).toBe(40)    // s3.start
    expect(newParagraph.endTime).toBe(60)      // s3.end
  })
})

describe('M02-T26: 拆分后树仍满足不变量（决策42）', () => {
  it('validateTree 不报错', () => {
    const { nodes, sentences } = makeStandardTree()
    const result = splitParagraph(nodes, sentences, 'p1', ['s3'])
    const errors = validateTree(result.nodes)
    expect(errors).toEqual([])
  })
})

// ===== 合并 =====

describe('M02-T27: 合并相邻同级段落（决策45）', () => {
  it('合并 p1 和 p2，存活者为 p1，p2 的句子并入 p1', () => {
    const { nodes, sentences } = makeStandardTree()
    const result = mergeNodes(nodes, sentences, ['p1', 'p2'], 'p1')

    // p2 不再存在
    expect(result.nodes.find(n => n.id === 'p2')).toBeUndefined()

    // p1 现在拥有 s1-s5
    const mergedSentences = result.sentences
      .filter(s => s.nodeId === 'p1')
      .sort((a, b) => a.sortOrder - b.sortOrder)
    expect(mergedSentences.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })
})

describe('M02-T28: 合并要求同级+同父+相邻（决策45）', () => {
  it('尝试合并 p1 和 p3（不同父）抛出错误', () => {
    const { nodes, sentences } = makeStandardTree()
    expect(() => mergeNodes(nodes, sentences, ['p1', 'p3'], 'p1')).toThrow()
  })
})

describe('M02-T29: 不允许跨父节点合并（决策45）', () => {
  it('尝试合并不同小节下的段落抛出错误', () => {
    const { nodes, sentences } = makeStandardTree()
    expect(() => mergeNodes(nodes, sentences, ['p2', 'p3'], 'p2')).toThrow()
  })
})

describe('M02-T30: 不允许混级合并（决策45）', () => {
  it('尝试合并小节和段落抛出错误', () => {
    const { nodes, sentences } = makeStandardTree()
    expect(() => mergeNodes(nodes, sentences, ['sec1', 'p1'], 'sec1')).toThrow()
  })
})

describe('M02-T31: 合并后时间范围自动重算（决策4e）', () => {
  it('存活者时间范围 = 两者并集', () => {
    const { nodes, sentences } = makeStandardTree()
    const result = mergeNodes(nodes, sentences, ['p1', 'p2'], 'p1')
    const survivor = result.nodes.find(n => n.id === 'p1')!
    expect(survivor.startTime).toBe(0)    // p1.start
    expect(survivor.endTime).toBe(120)    // p2.end
  })
})

// ===== 删除（内容迁移） =====

describe('M02-T32: 删段落 → 句子并入上一个兄弟段落（决策15）', () => {
  it('删除 p2，其句子（s4, s5）并入 p1', () => {
    const { nodes, sentences, notes } = makeStandardTree()
    const result = deleteNode(nodes, sentences, notes, 'p2')

    expect(result.nodes.find(n => n.id === 'p2')).toBeUndefined()
    const p1Sentences = result.sentences
      .filter(s => s.nodeId === 'p1')
      .sort((a, b) => a.sortOrder - b.sortOrder)
    expect(p1Sentences.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })
})

describe('M02-T33: 删小节 → 其下段落并入上一个兄弟小节（决策15）', () => {
  it('删除 sec2，其段落（p3, p4）并入 sec1', () => {
    const { nodes, sentences, notes } = makeStandardTree()
    const result = deleteNode(nodes, sentences, notes, 'sec2')

    expect(result.nodes.find(n => n.id === 'sec2')).toBeUndefined()
    // p3 和 p4 应该变成 sec1 的子节点
    const sec1Children = result.nodes.filter(n => n.parentId === 'sec1' && n.kind === 'paragraph')
    const childIds = sec1Children.map(n => n.id).sort()
    expect(childIds).toContain('p3')
    expect(childIds).toContain('p4')
  })
})

describe('M02-T34: 删章节 → 其下小节并入上一个兄弟章节（决策15）', () => {
  it('如果有两个章节，删第二个章节，其小节并入第一个章节', () => {
    // 构建双章节树
    const nodes: Node[] = [
      { id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter', title: '第一章', type: null, startTime: 0, endTime: 100, text: null, sortOrder: 0 },
      { id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '第一节', type: null, startTime: 0, endTime: 100, text: null, sortOrder: 0 },
      { id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph', title: '段落1', type: 'concept', startTime: 0, endTime: 100, text: '内容', sortOrder: 0 },
      { id: 'ch2', videoId: 'v1', parentId: null, kind: 'chapter', title: '第二章', type: null, startTime: 100, endTime: 200, text: null, sortOrder: 1 },
      { id: 'sec2', videoId: 'v1', parentId: 'ch2', kind: 'section', title: '第二节', type: null, startTime: 100, endTime: 200, text: null, sortOrder: 0 },
      { id: 'p2', videoId: 'v1', parentId: 'sec2', kind: 'paragraph', title: '段落2', type: 'example', startTime: 100, endTime: 200, text: '内容', sortOrder: 0 },
    ]
    const sentences: Sentence[] = [
      { id: 's1', nodeId: 'p1', text: '句一。', startTime: 0, endTime: 100, sortOrder: 0 },
      { id: 's2', nodeId: 'p2', text: '句二。', startTime: 100, endTime: 200, sortOrder: 0 },
    ]
    const result = deleteNode(nodes, sentences, [], 'ch2')

    expect(result.nodes.find(n => n.id === 'ch2')).toBeUndefined()
    // sec2 应该变成 ch1 的子节点
    const sec2 = result.nodes.find(n => n.id === 'sec2')
    expect(sec2).toBeDefined()
    expect(sec2!.parentId).toBe('ch1')
  })
})

describe('M02-T35: 首个非空子节点不可删除（决策46）', () => {
  it('删除 sec1 下的第一个段落 p1 抛出错误', () => {
    const { nodes, sentences, notes } = makeStandardTree()
    expect(() => deleteNode(nodes, sentences, notes, 'p1')).toThrow()
  })
})

describe('M02-T36: 空容器可以直接删除（决策46）', () => {
  it('删除空小节不报错', () => {
    const { nodes, sentences, notes } = makeStandardTree()
    // 先制造一个空容器
    const emptySection: Node = {
      id: 'empty_sec', videoId: 'v1', parentId: 'ch1', kind: 'section',
      title: '空小节', type: null, startTime: 300, endTime: 300,
      text: null, sortOrder: 2,
    }
    const nodesWithEmpty = [...nodes, emptySection]
    const result = deleteNode(nodesWithEmpty, sentences, notes, 'empty_sec')
    expect(result.nodes.find(n => n.id === 'empty_sec')).toBeUndefined()
  })
})

describe('M02-T37: 删除后句子永不丢失（决策15/18）', () => {
  it('删除 p2 后，总句子数不变（10个）', () => {
    const { nodes, sentences, notes } = makeStandardTree()
    const result = deleteNode(nodes, sentences, notes, 'p2')
    expect(result.sentences).toHaveLength(10)
  })
})

describe('M02-T38: 删除后笔记引用仍有效（决策18）', () => {
  it('删除 p2 后，note1 引用的 s1,s2,s3 仍然存在', () => {
    const { nodes, sentences, notes } = makeStandardTree()
    const result = deleteNode(nodes, sentences, notes, 'p2')
    const note1 = result.notes.find(n => n.id === 'note1')!
    for (const sid of note1.sentenceIds) {
      expect(result.sentences.find(s => s.id === sid)).toBeDefined()
    }
  })
})

// ===== Reparent（拖拽移动） =====

describe('M02-T39: 允许时间线一致的移动（决策42）', () => {
  it('把 p3 从 sec2 移到 sec1 末尾 — 但 p3 时间[120-200]超出 sec1[0-120]，应拒绝', () => {
    // 这个例子实际上应该拒绝，因为 p3 时间不在 sec1 范围内
    const { nodes, sentences } = makeStandardTree()
    expect(() => reparentNode(nodes, sentences, 'p3', 'sec1')).toThrow()
  })
})

describe('M02-T40: 禁止跨时间区域的移动（决策42）', () => {
  it('跨时间区域 reparent 抛出错误', () => {
    const { nodes, sentences } = makeStandardTree()
    // p1 时间[0-60] 要移到 sec2[120-300] 里 — 时间不一致
    expect(() => reparentNode(nodes, sentences, 'p1', 'sec2')).toThrow()
  })
})

describe('M02-T41: reparent 后树仍满足不变量（决策42）', () => {
  it('合法 reparent 后 validateTree 不报错', () => {
    // 构建一个可以合法移动的场景：
    // ch1 [0-300]
    //   sec1 [0-300]  (整个章节只有一个小节)
    //     p1 [0-100]
    //     p2 [100-200]
    //     p3 [200-300]
    // 将 sec1 拆成两个小节是合法的 reparent
    // 但更简单的是：在同父下调整顺序（但这受时间线约束，相邻同时间才能换）
    // 最简单的合法 reparent：把一个段落移到另一个时间匹配的父节点
    const nodes: Node[] = [
      { id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter', title: '章', type: null, startTime: 0, endTime: 200, text: null, sortOrder: 0 },
      { id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '节1', type: null, startTime: 0, endTime: 100, text: null, sortOrder: 0 },
      { id: 'sec2', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '节2', type: null, startTime: 0, endTime: 200, text: null, sortOrder: 1 },
      { id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph', title: '段1', type: 'concept', startTime: 0, endTime: 100, text: '内容', sortOrder: 0 },
      { id: 'p2', videoId: 'v1', parentId: 'sec2', kind: 'paragraph', title: '段2', type: 'example', startTime: 100, endTime: 200, text: '内容', sortOrder: 0 },
    ]
    const sentences: Sentence[] = [
      { id: 's1', nodeId: 'p1', text: '句一。', startTime: 0, endTime: 100, sortOrder: 0 },
      { id: 's2', nodeId: 'p2', text: '句二。', startTime: 100, endTime: 200, sortOrder: 0 },
    ]
    // p1[0-100] 从 sec1[0-100] 移到 sec2[0-200] — 时间线一致（p1 range ⊆ sec2 range）
    const result = reparentNode(nodes, sentences, 'p1', 'sec2')
    const errors = validateTree(result.nodes)
    expect(errors).toEqual([])
    // p1 现在是 sec2 的子节点
    const movedP1 = result.nodes.find(n => n.id === 'p1')!
    expect(movedP1.parentId).toBe('sec2')
  })
})

// ===== 改类型/重命名 =====

describe('M02-T42: 改段落类型（决策3）', () => {
  it('改为有效类型成功', () => {
    const { nodes } = makeStandardTree()
    const result = changeNodeType(nodes, 'p1', 'analogy')
    const p1 = result.find(n => n.id === 'p1')!
    expect(p1.type).toBe('analogy')
  })

  it('改为无效类型抛出错误', () => {
    const { nodes } = makeStandardTree()
    expect(() => changeNodeType(nodes, 'p1', 'invalid' as any)).toThrow()
  })

  it('容器节点不能改类型', () => {
    const { nodes } = makeStandardTree()
    expect(() => changeNodeType(nodes, 'sec1', 'concept')).toThrow()
  })
})

describe('M02-T43: 重命名节点', () => {
  it('重命名成功', () => {
    const { nodes } = makeStandardTree()
    const result = renameNode(nodes, 'p1', '新标题')
    const p1 = result.find(n => n.id === 'p1')!
    expect(p1.title).toBe('新标题')
  })

  it('空标题抛出错误', () => {
    const { nodes } = makeStandardTree()
    expect(() => renameNode(nodes, 'p1', '')).toThrow()
    expect(() => renameNode(nodes, 'p1', '   ')).toThrow()
  })
})
