// harness/m04-ai-pipeline.test.ts
// ========================================
// M04 Harness: AI 处理管线（ASR 标准化 + Stage2 输出校验）
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import type { Sentence } from '@/models/types'
import {
  normalizeSubtitleToSentences,
  normalizeApiAsrToSentences,
  normalizeWhisperToSentences,
  detectLanguageFromSentences,
} from '@/pipeline/asr-normalize'
import {
  validateStage2Output,
  buildTextFromStage2Sentences,
} from '@/pipeline/stage2-validate'
import { PARAGRAPH_TYPES } from '@/models/types'

// ===== ASR 标准化 =====

describe('M04-T01: 字幕档碎片合并为 Sentence[]', () => {
  it('2-5秒碎片按句末标点切成完整句子', () => {
    const subtitleFragments = [
      { text: 'Hello world,', start: 0, end: 2 },
      { text: ' this is a test.', start: 2, end: 5 },
      { text: ' Another sentence', start: 5, end: 7 },
      { text: ' here.', start: 7, end: 9 },
    ]
    const sentences = normalizeSubtitleToSentences(subtitleFragments)
    expect(sentences).toHaveLength(2)
    expect(sentences[0].text).toBe('Hello world, this is a test.')
    expect(sentences[0].startTime).toBe(0)
    expect(sentences[0].endTime).toBe(5)
    expect(sentences[1].text).toBe('Another sentence here.')
    expect(sentences[1].startTime).toBe(5)
    expect(sentences[1].endTime).toBe(9)
  })
})

describe('M04-T02: API 档输出转为 Sentence[]', () => {
  it('保留句级时间戳', () => {
    const apiOutput = [
      { text: '第一句话。', start_time: 0, end_time: 5 },
      { text: '第二句话。', start_time: 5, end_time: 10 },
    ]
    const sentences = normalizeApiAsrToSentences(apiOutput)
    expect(sentences).toHaveLength(2)
    expect(sentences[0].text).toBe('第一句话。')
    expect(sentences[0].startTime).toBe(0)
    expect(sentences[1].startTime).toBe(5)
  })
})

describe('M04-T03: 本地 Whisper 词级→句级', () => {
  it('按标点分组为句级 Sentence[]', () => {
    const whisperWords = [
      { word: '你', start: 0, end: 0.5 },
      { word: '好', start: 0.5, end: 1 },
      { word: '。', start: 1, end: 1.2 },
      { word: '今天', start: 1.5, end: 2 },
      { word: '天气', start: 2, end: 2.5 },
      { word: '不错', start: 2.5, end: 3 },
      { word: '。', start: 3, end: 3.2 },
    ]
    const sentences = normalizeWhisperToSentences(whisperWords)
    expect(sentences).toHaveLength(2)
    expect(sentences[0].text).toBe('你好。')
    expect(sentences[0].startTime).toBe(0)
    expect(sentences[0].endTime).toBe(1.2)
    expect(sentences[1].text).toBe('今天天气不错。')
    expect(sentences[1].startTime).toBe(1.5)
    expect(sentences[1].endTime).toBe(3.2)
  })
})

describe('M04-T04: 标准化后 Sentence 字段完整', () => {
  it('每个 Sentence 都有 id, text, startTime, endTime', () => {
    const apiOutput = [
      { text: '测试。', start_time: 0, end_time: 5 },
    ]
    const sentences = normalizeApiAsrToSentences(apiOutput)
    const s = sentences[0]
    expect(s.id).toBeDefined()
    expect(typeof s.id).toBe('string')
    expect(s.id.length).toBeGreaterThan(0)
    expect(s.text).toBeDefined()
    expect(typeof s.startTime).toBe('number')
    expect(typeof s.endTime).toBe('number')
  })
})

describe('M04-T05: ASR 完成后自动检测语言（决策85）', () => {
  it('中文句子 → zh', () => {
    const sentences: Sentence[] = [
      { id: 's1', nodeId: '', text: '你好世界。', startTime: 0, endTime: 5, sortOrder: 0 },
      { id: 's2', nodeId: '', text: '今天学习编程。', startTime: 5, endTime: 10, sortOrder: 1 },
    ]
    expect(detectLanguageFromSentences(sentences)).toBe('zh')
  })

  it('英文句子 → en', () => {
    const sentences: Sentence[] = [
      { id: 's1', nodeId: '', text: 'Hello world.', startTime: 0, endTime: 5, sortOrder: 0 },
      { id: 's2', nodeId: '', text: 'How are you?', startTime: 5, endTime: 10, sortOrder: 1 },
    ]
    expect(detectLanguageFromSentences(sentences)).toBe('en')
  })
})

describe('M04-T06: language=en 时触发翻译标记（决策85）', () => {
  it('英文视频应触发翻译', () => {
    const shouldTranslate = (lang: string) => lang === 'en'
    expect(shouldTranslate('en')).toBe(true)
    expect(shouldTranslate('zh')).toBe(false)
    expect(shouldTranslate('other')).toBe(false)
  })
})

// ===== Stage2 输出校验 =====

describe('M04-T07: Stage2 输出必须是合法 JSON schema', () => {
  it('合法输出通过校验', () => {
    const validOutput = {
      chapters: [{
        title: '第一章',
        start: 0, end: 100,
        sections: [{
          title: '第一节',
          start: 0, end: 100,
          paragraphs: [{
            title: '段落1',
            type: 'concept',
            start: 0, end: 50,
            sentences: [
              { id: 's1', text: '句一。', start: 0, end: 25 },
              { id: 's2', text: '句二。', start: 25, end: 50 },
            ],
          }],
        }],
      }],
    }
    const errors = validateStage2Output(validOutput)
    expect(errors).toEqual([])
  })

  it('缺少 chapters 字段 → 报错', () => {
    const errors = validateStage2Output({})
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('M04-T08: 输出不含 text 字段（Path B，决策34）', () => {
  it('段落只有 sentences 没有 text', () => {
    const output = {
      chapters: [{
        title: '章', start: 0, end: 50,
        sections: [{
          title: '节', start: 0, end: 50,
          paragraphs: [{
            title: '段', type: 'concept', start: 0, end: 50,
            text: '不应该有这个字段',  // 违规
            sentences: [{ id: 's1', text: '句。', start: 0, end: 50 }],
          }],
        }],
      }],
    }
    const errors = validateStage2Output(output)
    expect(errors.some(e => e.includes('text'))).toBe(true)
  })
})

describe('M04-T09: 从 sentences 拼接 text（决策34）', () => {
  it('中文直连', () => {
    const sentences = [
      { id: 's1', text: '你好。', start: 0, end: 5 },
      { id: 's2', text: '世界。', start: 5, end: 10 },
    ]
    expect(buildTextFromStage2Sentences(sentences, 'zh')).toBe('你好。世界。')
  })

  it('英文空格连', () => {
    const sentences = [
      { id: 's1', text: 'Hello.', start: 0, end: 5 },
      { id: 's2', text: 'World.', start: 5, end: 10 },
    ]
    expect(buildTextFromStage2Sentences(sentences, 'en')).toBe('Hello. World.')
  })
})

describe('M04-T10: 段落类型只能是 4 种之一（决策3）', () => {
  it('无效类型报错', () => {
    const output = {
      chapters: [{
        title: '章', start: 0, end: 50,
        sections: [{
          title: '节', start: 0, end: 50,
          paragraphs: [{
            title: '段', type: 'invalid_type', start: 0, end: 50,
            sentences: [{ id: 's1', text: '句。', start: 0, end: 50 }],
          }],
        }],
      }],
    }
    const errors = validateStage2Output(output)
    expect(errors.some(e => e.includes('type'))).toBe(true)
  })
})

describe('M04-T11: 输出树满足时间线不变量（决策42）', () => {
  it('兄弟段落时间重叠 → 报错', () => {
    const output = {
      chapters: [{
        title: '章', start: 0, end: 100,
        sections: [{
          title: '节', start: 0, end: 100,
          paragraphs: [
            { title: '段1', type: 'concept', start: 0, end: 60,
              sentences: [{ id: 's1', text: '句。', start: 0, end: 60 }] },
            { title: '段2', type: 'example', start: 50, end: 100,  // 重叠!
              sentences: [{ id: 's2', text: '句。', start: 50, end: 100 }] },
          ],
        }],
      }],
    }
    const errors = validateStage2Output(output)
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('M04-T12: 英文视频输出包含 translation（决策33）', () => {
  it('英文视频的段落有 translation 字段', () => {
    const output = {
      chapters: [{
        title: 'Chapter', start: 0, end: 50,
        sections: [{
          title: 'Section', start: 0, end: 50,
          paragraphs: [{
            title: 'Paragraph', type: 'concept', start: 0, end: 50,
            translation: '中文翻译',
            sentences: [{ id: 's1', text: 'Hello.', start: 0, end: 50 }],
          }],
        }],
      }],
    }
    const errors = validateStage2Output(output, 'en')
    expect(errors).toEqual([])
    expect(output.chapters[0].sections[0].paragraphs[0].translation).toBeDefined()
  })
})

describe('M04-T13: 中文视频输出不包含 translation（决策33）', () => {
  it('中文视频的段落无 translation', () => {
    const output = {
      chapters: [{
        title: '章', start: 0, end: 50,
        sections: [{
          title: '节', start: 0, end: 50,
          paragraphs: [{
            title: '段', type: 'concept', start: 0, end: 50,
            sentences: [{ id: 's1', text: '句。', start: 0, end: 50 }],
          }],
        }],
      }],
    }
    const errors = validateStage2Output(output, 'zh')
    expect(errors).toEqual([])
  })
})
