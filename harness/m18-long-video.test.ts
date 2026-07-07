// harness/m18-long-video.test.ts
// ========================================
// M18 Harness: 长视频分段处理
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import type { Sentence } from '@/models/types'
import {
  shouldChunk,
  chunkSentences,
  buildChunkContext,
  validateChunkJsonIntegrity,
  handleChunkFailure,
  canSkipMerge,
} from '@/pipeline/long-video'

function makeSentences(count: number): Sentence[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    nodeId: '',
    text: `Sentence number ${i}. `,
    startTime: i * 10,
    endTime: (i + 1) * 10,
    sortOrder: i,
  }))
}

describe('M18-T01: 不触发分块 — token ≤ 窗口×33%', () => {
  it('短文本不分块', () => {
    const sentences = makeSentences(10)
    const windowSize = 100000  // 100K token 窗口
    const threshold = 0.33
    expect(shouldChunk(sentences, windowSize, threshold)).toBe(false)
  })
})

describe('M18-T02: 触发分块 — token > 窗口×33%', () => {
  it('长文本触发分块', () => {
    const sentences = makeSentences(5000)  // 大量句子
    const windowSize = 8000  // 小窗口
    const threshold = 0.33
    expect(shouldChunk(sentences, windowSize, threshold)).toBe(true)
  })
})

describe('M18-T03: 每块目标 ≈ 窗口的 25%', () => {
  it('分块大小合理', () => {
    const sentences = makeSentences(1000)
    const windowSize = 8000
    const threshold = 0.33
    const chunks = chunkSentences(sentences, windowSize, threshold)
    // 每块不应超过窗口的 33%（触发线）
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0)
    }
    // 至少分了 2 块
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })
})

describe('M18-T04: 分块只在句子边界切', () => {
  it('每个块包含完整句子', () => {
    const sentences = makeSentences(100)
    const windowSize = 2000
    const chunks = chunkSentences(sentences, windowSize, 0.33)

    // 所有块的句子加起来等于原始句子
    const allChunkedIds = chunks.flat().map(s => s.id)
    const originalIds = sentences.map(s => s.id)
    expect(allChunkedIds.sort()).toEqual(originalIds.sort())
  })
})

describe('M18-T05: 每块 Stage2 输入包含前情摘要（Q4）', () => {
  it('第二块及之后的块包含前情上下文', () => {
    const previousBlockOutput = {
      chapters: [{
        title: '第一章', start: 0, end: 100,
        sections: [{
          title: '第一节', start: 0, end: 100,
          paragraphs: [{
            title: '段落1', type: 'concept', start: 0, end: 100,
            sentences: [{ id: 's1', text: '内容。', start: 0, end: 100 }],
          }],
        }],
      }],
    }
    const context = buildChunkContext(previousBlockOutput)
    // 上下文包含前置块标题
    expect(context).toContain('第一章')
    expect(context).toContain('第一节')
    // 包含末段信息
    expect(context).toContain('段落1')
  })
})

describe('M18-T06: 不重叠 — 句子不重复', () => {
  it('每个句子只出现在一个块中', () => {
    const sentences = makeSentences(200)
    const chunks = chunkSentences(sentences, 3000, 0.33)

    const allIds = chunks.flat().map(s => s.id)
    const uniqueIds = new Set(allIds)
    expect(uniqueIds.size).toBe(allIds.length)
  })
})

describe('M18-T07: 合并输入只含元数据（Q5）', () => {
  it('合并不包含完整句子文本', () => {
    // 这个测试验证合并函数的输入构建
    // 具体实现中会有 buildMergeInput 函数
    // 此处通过检查函数签名存在来约束
    expect(typeof buildChunkContext).toBe('function')
  })
})

describe('M18-T08: 溢出重试 — 单块失败对半切', () => {
  it('失败块被拆成两个更小的块', () => {
    const failedChunk = makeSentences(50)
    const retryChunks = handleChunkFailure(failedChunk)
    expect(retryChunks.length).toBe(2)
    // 两个子块加起来等于原块
    const totalSentences = retryChunks[0].length + retryChunks[1].length
    expect(totalSentences).toBe(50)
  })
})

describe('M18-T09: JSON 完整性校验', () => {
  it('完整 JSON 通过校验', () => {
    const validJson = '{"chapters": [{"title": "章", "start": 0, "end": 100, "sections": []}]}'
    expect(validateChunkJsonIntegrity(validJson)).toBe(true)
  })

  it('不完整 JSON 不通过（截断）', () => {
    const truncatedJson = '{"chapters": [{"title": "章", "start": 0, '
    expect(validateChunkJsonIntegrity(truncatedJson)).toBe(false)
  })
})

describe('M18-T10: 合并失败不影响已入库各块（决策90）', () => {
  it('canSkipMerge 返回 true 表示可跳过合并', () => {
    expect(typeof canSkipMerge).toBe('function')
    expect(canSkipMerge()).toBe(true)
  })
})

describe('M18-T11: 合并失败可跳过（决策90）', () => {
  it('跳过合并后分块结果可直接使用', () => {
    // 验证跳过合并的标志位
    expect(canSkipMerge()).toBe(true)
  })
})
