// src/pipeline/long-video.ts
// ========================================
// 长视频分段处理
// ========================================

import type { Sentence } from '@/models/types'

// 估算 token 数（简单实现：按字符数估算）
function estimateTokens(text: string): number {
  // 中文：1 字 ≈ 1 token；英文：4 字符 ≈ 1 token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars + otherChars / 4)
}

// 判断是否需要分块
export function shouldChunk(sentences: Sentence[], windowSize: number, threshold: number): boolean {
  const totalText = sentences.map(s => s.text).join('')
  const totalTokens = estimateTokens(totalText)
  return totalTokens > windowSize * threshold
}

// 分块
export function chunkSentences(sentences: Sentence[], windowSize: number, threshold: number): Sentence[][] {
  if (!shouldChunk(sentences, windowSize, threshold)) {
    return [sentences]
  }

  // 每块目标 ≈ 窗口的 25%
  const targetChunkTokens = windowSize * 0.25
  const chunks: Sentence[][] = []
  let currentChunk: Sentence[] = []
  let currentTokens = 0

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence.text)
    
    if (currentTokens + sentenceTokens > targetChunkTokens && currentChunk.length > 0) {
      // 当前块已满，推入数组并开始新块
      chunks.push(currentChunk)
      currentChunk = []
      currentTokens = 0
    }

    currentChunk.push(sentence)
    currentTokens += sentenceTokens
  }

  // 处理剩余句子
  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

// 构建分块上下文（前情摘要）
export function buildChunkContext(previousBlockOutput: any): string {
  const parts: string[] = []
  
  for (const chapter of previousBlockOutput.chapters ?? []) {
    parts.push(chapter.title)
    for (const section of chapter.sections ?? []) {
      parts.push(section.title)
      // 包含末段信息
      for (const paragraph of section.paragraphs ?? []) {
        parts.push(paragraph.title)
      }
    }
  }

  return parts.join(' | ')
}

// 校验 JSON 完整性
export function validateChunkJsonIntegrity(jsonString: string): boolean {
  try {
    const parsed = JSON.parse(jsonString)
    // 检查必需的结构
    if (!parsed || !parsed.chapters) {
      return false
    }
    return true
  } catch (e) {
    return false
  }
}

// 处理分块失败（对半切）
export function handleChunkFailure(failedChunk: Sentence[]): Sentence[][] {
  const mid = Math.ceil(failedChunk.length / 2)
  return [
    failedChunk.slice(0, mid),
    failedChunk.slice(mid),
  ]
}

// 是否可以跳过合并
export function canSkipMerge(): boolean {
  return true
}
