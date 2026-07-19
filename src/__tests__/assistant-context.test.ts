import { describe, expect, it } from 'vitest'
import { buildAssistantContext } from '@/ai/assistant-context'
import type { Node, Sentence } from '@/models/types'

const nodes: Node[] = [
  { id: 'chapter-1', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Signals', type: null, startTime: 0, endTime: 20, text: null, sortOrder: 0 },
  { id: 'section-1', videoId: 'video-1', parentId: 'chapter-1', kind: 'section', title: 'Basics', type: null, startTime: 0, endTime: 20, text: null, sortOrder: 0 },
  { id: 'paragraph-1', videoId: 'video-1', parentId: 'section-1', kind: 'paragraph', title: 'Signal definition', type: 'concept', startTime: 0, endTime: 20, text: null, sortOrder: 0 },
  { id: 'chapter-2', videoId: 'video-1', parentId: null, kind: 'chapter', title: 'Amplification', type: null, startTime: 21, endTime: 40, text: null, sortOrder: 1 },
  { id: 'section-2', videoId: 'video-1', parentId: 'chapter-2', kind: 'section', title: 'Gain', type: null, startTime: 21, endTime: 40, text: null, sortOrder: 0 },
  { id: 'paragraph-2', videoId: 'video-1', parentId: 'section-2', kind: 'paragraph', title: 'Amplifier', type: 'concept', startTime: 21, endTime: 40, text: null, sortOrder: 0 },
]

const sentences: Sentence[] = [
  { id: 's-1', nodeId: 'paragraph-1', text: 'A signal carries information.', startTime: 0, endTime: 3, sortOrder: 0 },
  { id: 's-2', nodeId: 'paragraph-1', text: 'Amplitude describes signal strength.', startTime: 3, endTime: 6, sortOrder: 1 },
  { id: 's-3', nodeId: 'paragraph-2', text: 'An amplifier increases amplitude.', startTime: 22, endTime: 25, sortOrder: 2 },
  { id: 's-4', nodeId: 'paragraph-2', text: '放大器的增益表示输出信号与输入信号的比例。', startTime: 25, endTime: 28, sortOrder: 3 },
]

describe('assistant context', () => {
  it('sends the current paragraph, nearby transcript and necessary recent dialogue instead of the whole video', () => {
    const context = buildAssistantContext({ nodes, sentences, playPosition: 3.5, question: 'Explain amplitude', history: [{ role: 'user', content: 'old 1' }, { role: 'assistant', content: 'old 2' }, { role: 'user', content: 'old 3' }, { role: 'assistant', content: 'old 4' }, { role: 'user', content: 'old 5' }, { role: 'assistant', content: 'old 6' }, { role: 'user', content: 'old 7' }] })

    expect(context.sources.map((source) => source.sentenceId)).toEqual(['s-1', 's-2'])
    expect(context.systemPrompt).toContain('sentence:s-2 @ 3.000-6.000')
    expect(context.systemPrompt).not.toContain('An amplifier increases amplitude.')
    expect(context.systemPrompt).not.toContain('放大器的增益表示')
    expect(context.history.map((message) => message.content)).toEqual(['old 2', 'old 3', 'old 4', 'old 5', 'old 6', 'old 7'])
  })

  it('retrieves matching transcript from another chapter only when the question needs a cross-chapter comparison', () => {
    const context = buildAssistantContext({ nodes, sentences, playPosition: 3.5, question: 'Compare amplitude across chapters', history: [] })

    expect(context.sources.map((source) => source.sentenceId)).toEqual(['s-1', 's-2', 's-3'])
    expect(context.systemPrompt).toContain('Cross-chapter retrieval')
    expect(context.systemPrompt).toContain('sentence:s-3 @ 22.000-25.000')
  })

  it.each(['比较两个章节的增益', '前面如何定义放大器', '上一节讲了什么'])('retrieves a deterministic cross-chapter source for ordinary Chinese navigation questions: %s', (question) => {
    const context = buildAssistantContext({ nodes, sentences, playPosition: 3.5, question, history: [] })

    expect(context.sources.map((source) => source.sentenceId)).toContain('s-4')
    expect(context.systemPrompt).toContain('Cross-chapter retrieval')
  })

  it.each(['Summarize this chapter', '总结本章节内容'])('does not retrieve cross-chapter context for current-chapter questions: %s', (question) => {
    const context = buildAssistantContext({ nodes, sentences, playPosition: 3.5, question, history: [] })

    expect(context.sources.map((source) => source.sentenceId)).toEqual(['s-1', 's-2'])
    expect(context.systemPrompt).not.toContain('Cross-chapter retrieval')
  })
})