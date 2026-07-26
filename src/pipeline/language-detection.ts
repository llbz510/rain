import type { Sentence } from '@/models/types'

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text)
}

function isEnglish(text: string): boolean {
  return /^[A-Za-z0-9\s.,!?;:'"()-]+$/.test(text) && /[A-Za-z]/.test(text)
}

export function detectLanguageFromSentences(sentences: Sentence[]): string {
  const text = sentences.map((sentence) => sentence.text).join(' ')

  if (containsChinese(text)) return 'zh'
  if (isEnglish(text)) return 'en'
  return 'other'
}
