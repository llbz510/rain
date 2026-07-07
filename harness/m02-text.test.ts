// harness/m02-text.test.ts
// ========================================
// M02 Harness: 文本拼接规则
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { buildTextFromSentences } from '@/models/text-utils'
import type { Sentence } from '@/models/types'

function makeSentences(texts: string[], startTime = 0): Sentence[] {
  let time = startTime
  return texts.map((text, i) => {
    const s: Sentence = {
      id: `s${i + 1}`,
      nodeId: 'n1',
      text,
      startTime: time,
      endTime: time + 5,
      sortOrder: i,
    }
    time += 5
    return s
  })
}

describe('M02-T22: 英文句子拼接用空格连接（M04 Path B）', () => {
  it('英文句子自带标点，用空格连接', () => {
    const sentences = makeSentences([
      'Hello world.',
      'How are you?',
      'I am fine!',
    ])
    const text = buildTextFromSentences(sentences, 'en')
    expect(text).toBe('Hello world. How are you? I am fine!')
  })
})

describe('M02-T23: 中文句子拼接直接连接（M04 Path B）', () => {
  it('中文句子自带标点，直接连接无空格', () => {
    const sentences = makeSentences([
      '你好。',
      '今天天气不错。',
      '我们出去走走吧。',
    ])
    const text = buildTextFromSentences(sentences, 'zh')
    expect(text).toBe('你好。今天天气不错。我们出去走走吧。')
  })
})

describe('M02-T44: 混合语言使用空格连接（兜底）', () => {
  it('language=other 时使用空格连接', () => {
    const sentences = makeSentences([
      'Bonjour.',
      'Comment allez-vous?',
    ])
    const text = buildTextFromSentences(sentences, 'other')
    expect(text).toBe('Bonjour. Comment allez-vous?')
  })
})
