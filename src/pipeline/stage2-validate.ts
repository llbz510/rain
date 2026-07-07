// src/pipeline/stage2-validate.ts
// ========================================
// Stage2 输出校验
// ========================================

import type { Stage2Output, ParagraphType } from '@/models/types'
import { PARAGRAPH_TYPES } from '@/models/types'

// 校验 Stage2 输出
export function validateStage2Output(output: any, language?: string): string[] {
  const errors: string[] = []

  // 检查顶层结构
  if (!output || typeof output !== 'object') {
    errors.push('Output must be an object')
    return errors
  }

  if (!output.chapters || !Array.isArray(output.chapters)) {
    errors.push('chapters field is required and must be an array')
    return errors
  }

  for (const chapter of output.chapters) {
    if (!chapter.title || chapter.title.trim() === '') {
      errors.push('Chapter must have non-empty title')
    }
    if (chapter.start < 0 || chapter.end <= chapter.start) {
      errors.push(`Chapter "${chapter.title}": invalid time range [${chapter.start}, ${chapter.end}]`)
    }

    for (const section of chapter.sections || []) {
      if (!section.title || section.title.trim() === '') {
        errors.push('Section must have non-empty title')
      }
      if (section.start < chapter.start || section.end > chapter.end) {
        errors.push(`Section "${section.title}": time range exceeds chapter range`)
      }

      for (const paragraph of section.paragraphs || []) {
        // 检查段落类型
        if (!paragraph.type || !PARAGRAPH_TYPES.includes(paragraph.type as ParagraphType)) {
          errors.push(`Paragraph "${paragraph.title}": invalid or missing type "${paragraph.type}"`)
        }

        // 检查段落时间范围
        if (paragraph.start < section.start || paragraph.end > section.end) {
          errors.push(`Paragraph "${paragraph.title}": time range exceeds section range`)
        }

        // 检查句子
        if (!paragraph.sentences || paragraph.sentences.length === 0) {
          errors.push(`Paragraph "${paragraph.title}": must have at least one sentence`)
        }

        for (const sentence of paragraph.sentences || []) {
          if (!sentence.id || !sentence.text) {
            errors.push(`Paragraph "${paragraph.title}": sentence missing id or text`)
          }
          if (sentence.start < paragraph.start || sentence.end > paragraph.end) {
            errors.push(`Paragraph "${paragraph.title}": sentence time range exceeds paragraph range`)
          }
        }
      }

      // 检查同级段落时间排序和重叠
      const paras = section.paragraphs || []
      for (let i = 0; i < paras.length - 1; i++) {
        const curr = paras[i]
        const next = paras[i + 1]
        if (curr.end > next.start) {
          errors.push(`Paragraphs "${curr.title}" and "${next.title}": time overlap detected`)
        }
      }
    }

    // 检查同级小节时间排序和重叠
    const secs = chapter.sections || []
    for (let i = 0; i < secs.length - 1; i++) {
      const curr = secs[i]
      const next = secs[i + 1]
      if (curr.end > next.start) {
        errors.push(`Sections "${curr.title}" and "${next.title}": time overlap detected`)
      }
    }
  }

  // 检查 text 字段不可存在（Path B，决策34）
  for (const chapter of output.chapters) {
    for (const section of chapter.sections || []) {
      for (const paragraph of section.paragraphs || []) {
        if ('text' in paragraph && paragraph.text !== undefined) {
          errors.push(`Paragraph "${paragraph.title}": text field forbidden (Path B, decision 34)`)
        }
      }
    }
  }

  return errors
}

// 从 sentences 拼接 text
export function buildTextFromStage2Sentences(
  sentences: { id: string; text: string; start: number; end: number }[],
  language: string
): string {
  if (sentences.length === 0) return ''
  
  if (language === 'zh') {
    return sentences.map(s => s.text).join('')
  } else {
    return sentences.map(s => s.text).join(' ')
  }
}
