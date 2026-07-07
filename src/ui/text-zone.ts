// src/ui/text-zone.ts
// ========================================
// 文本区显示数据
// ========================================

import type { ParagraphType } from '@/models/types'

interface ParagraphInput {
  id: string
  title: string
  type: ParagraphType
  translation?: string
  sentences: { id: string; text: string; startTime: number; endTime: number; sortOrder: number; nodeId: string }[]
}

export interface ParagraphDisplay {
  title: string
  typeBadge: ParagraphType
  showExcerptButton: boolean
  showMoreMenu: boolean
  translation?: string
  translationSentences?: never
}

export function buildParagraphDisplayData(paragraph: ParagraphInput): ParagraphDisplay {
  const display: ParagraphDisplay = {
    title: paragraph.title,
    typeBadge: paragraph.type,
    showExcerptButton: true,
    showMoreMenu: true,
  }

  if (paragraph.translation !== undefined) {
    display.translation = paragraph.translation
  }

  return display
}

export function getCurrentHighlightedSentence(
  sentences: { id: string; startTime: number; endTime: number }[],
  currentTime: number
): string | null {
  for (const sentence of sentences) {
    if (currentTime >= sentence.startTime && currentTime < sentence.endTime) {
      return sentence.id
    }
  }
  return null
}

export function shouldShowTranslation(language: string, switchOn: boolean): boolean {
  // 仅英文视频显示翻译，且开关需打开
  return language === 'en' && switchOn
}
