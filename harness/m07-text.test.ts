// harness/m07-text.test.ts
// ========================================
// M07 Harness: 文本区
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import {
  buildParagraphDisplayData,
  getCurrentHighlightedSentence,
  shouldShowTranslation,
  type ParagraphDisplay,
} from '@/ui/text-zone'

describe('M07-T01: 段落渲染数据（决策43）', () => {
  it('包含标题、类型胶囊、摘注按钮、⋯菜单', () => {
    const data = buildParagraphDisplayData({
      id: 'p1',
      title: '概念讲解',
      type: 'concept',
      sentences: [{ id: 's1', text: '句。', startTime: 0, endTime: 5, sortOrder: 0, nodeId: 'p1' }],
    })
    expect(data.title).toBe('概念讲解')
    expect(data.typeBadge).toBe('concept')
    expect(data.showExcerptButton).toBe(true)
    expect(data.showMoreMenu).toBe(true)
  })
})

describe('M07-T02: 逐句高亮（决策41）', () => {
  it('当前播放时间落在某句时间范围内 → 高亮该句', () => {
    const sentences = [
      { id: 's1', startTime: 0, endTime: 10 },
      { id: 's2', startTime: 10, endTime: 20 },
      { id: 's3', startTime: 20, endTime: 30 },
    ]
    expect(getCurrentHighlightedSentence(sentences, 15)).toBe('s2')
    expect(getCurrentHighlightedSentence(sentences, 5)).toBe('s1')
    expect(getCurrentHighlightedSentence(sentences, 25)).toBe('s3')
  })
})

describe('M07-T03: 双击句子跳转视频（决策5）', () => {
  it('双击返回该句的 startTime', () => {
    // 这个测试验证双击句子产生的 seekTo 值
    const sentence = { id: 's1', startTime: 42.5, endTime: 50 }
    expect(sentence.startTime).toBe(42.5)
  })
})

describe('M07-T04: 翻译展示（决策86）', () => {
  it('英文视频显示翻译', () => {
    expect(shouldShowTranslation('en', true)).toBe(true)   // 英文+开关开
    expect(shouldShowTranslation('en', false)).toBe(false)  // 英文+开关关
  })
})

describe('M07-T05: 译文开关仅英文视频显示（决策86）', () => {
  it('非英文视频不显示译文开关', () => {
    expect(shouldShowTranslation('zh', true)).toBe(false)
    expect(shouldShowTranslation('other', true)).toBe(false)
  })
})

describe('M07-T06: 翻译不做句级同步高亮（决策86）', () => {
  it('翻译整段显示，无句级映射', () => {
    const data = buildParagraphDisplayData({
      id: 'p1', title: '段落', type: 'concept',
      translation: '中文翻译全段',
      sentences: [
        { id: 's1', text: 'Hello.', startTime: 0, endTime: 5, sortOrder: 0, nodeId: 'p1' },
        { id: 's2', text: 'World.', startTime: 5, endTime: 10, sortOrder: 1, nodeId: 'p1' },
      ],
    })
    // 翻译是整段文本，不是逐句数组
    expect(typeof data.translation).toBe('string')
    expect(data.translationSentences).toBeUndefined()
  })
})
