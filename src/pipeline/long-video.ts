// src/pipeline/long-video.ts
// ========================================
// 长视频分段处理
// ========================================

import type { Sentence } from '@/models/types'

// 估算 token 数（简单实现：按字符数估算）
export function estimateTokens(text: string): number {
  // 中文：1 字 ≈ 1 token；英文：4 字符 ≈ 1 token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars + otherChars / 4)
}

export function estimateStage2SentenceTokens(sentence: Sentence): number {
  return estimateTokens(sentence.text) + 12
}
