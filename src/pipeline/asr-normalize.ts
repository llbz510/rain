// src/pipeline/asr-normalize.ts
// ========================================
// ASR 标准化（字幕/API/Whisper → Sentence[]）
// ========================================

import type { Sentence } from '@/models/types'

let sentenceCounter = 0
function generateSentenceId(): string {
  sentenceCounter++
  return `s_${Date.now()}_${sentenceCounter}`
}

// 中文字符检测
function isChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text)
}

// 英文检测
function isEnglish(text: string): boolean {
  return /^[A-Za-z0-9\s.,!?;:'"()-]+$/.test(text) && /[A-Za-z]/.test(text)
}

// 字幕档碎片合并为 Sentence[]
export function normalizeSubtitleToSentences(
  fragments: { text: string; start: number; end: number }[]
): Sentence[] {
  const sentences: Sentence[] = []
  let currentText = ''
  let currentStart = 0
  let currentEnd = 0

  for (const frag of fragments) {
    if (currentText === '') {
      currentStart = frag.start
    }
    currentText += frag.text
    currentEnd = frag.end

    // 检测句末标点
    const trimmed = currentText.trim()
    if (/[.!?。！？]\s*$/.test(trimmed)) {
      sentences.push({
        id: generateSentenceId(),
        nodeId: '',
        text: trimmed,
        startTime: currentStart,
        endTime: currentEnd,
        sortOrder: sentences.length,
      })
      currentText = ''
    }
  }

  // 处理剩余文本
  if (currentText.trim() !== '') {
    sentences.push({
      id: generateSentenceId(),
      nodeId: '',
      text: currentText.trim(),
      startTime: currentStart,
      endTime: currentEnd,
      sortOrder: sentences.length,
    })
  }

  return sentences
}

// API 档输出转为 Sentence[]
export function normalizeApiAsrToSentences(
  output: { text: string; start_time: number; end_time: number }[]
): Sentence[] {
  return output.map((item, i) => ({
    id: generateSentenceId(),
    nodeId: '',
    text: item.text,
    startTime: item.start_time,
    endTime: item.end_time,
    sortOrder: i,
  }))
}

// 本地 Whisper 词级→句级
export function normalizeWhisperToSentences(
  words: { word: string; start: number; end: number }[]
): Sentence[] {
  const sentences: Sentence[] = []
  let currentWords: typeof words = []

  for (const word of words) {
    currentWords.push(word)
    // 检测句末标点
    if (/[.!?。！？]/.test(word.word)) {
      const text = currentWords.map(w => w.word).join('').trim()
      const startTime = currentWords[0].start
      const endTime = currentWords[currentWords.length - 1].end
      sentences.push({
        id: generateSentenceId(),
        nodeId: '',
        text,
        startTime,
        endTime,
        sortOrder: sentences.length,
      })
      currentWords = []
    }
  }

  // 处理剩余词
  if (currentWords.length > 0) {
    const text = currentWords.map(w => w.word).join('').trim()
    sentences.push({
      id: generateSentenceId(),
      nodeId: '',
      text,
      startTime: currentWords[0].start,
      endTime: currentWords[currentWords.length - 1].end,
      sortOrder: sentences.length,
    })
  }

  return sentences
}

// 从句子检测语言
export function detectLanguageFromSentences(sentences: Sentence[]): string {
  const allText = sentences.map(s => s.text).join(' ')
  
  if (isChinese(allText)) {
    return 'zh'
  } else if (isEnglish(allText)) {
    return 'en'
  }
  
  return 'other'
}
