// src/models/text-utils.ts
// ========================================
// 文本处理工具函数
// ========================================

import type { Sentence } from './types'

export function buildTextFromSentences(sentences: Sentence[], language: string): string {
  if (sentences.length === 0) return ''
  
  // 中文直接连接，英文和其他语言用空格连接
  if (language === 'zh') {
    return sentences.map(s => s.text).join('')
  } else {
    return sentences.map(s => s.text).join(' ')
  }
}
