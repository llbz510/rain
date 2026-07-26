// src/ui/components/text-zone.tsx
// ========================================
// M07 文本区组件（决策5/41/43/44/86）
// ========================================

import React from 'react'
import { useRainStore } from '@/store/rain-store'
import { shouldShowTranslation } from '@/ui/text-zone'
import { getCurrentHighlightedSentence } from '@/ui/text-zone'
import type { Node, Sentence } from '@/models/types'

interface ParagraphItemProps {
  paragraph: Node
  sentences: Sentence[]
  onSeek?: (time: number) => void
}

export function ParagraphItem({ paragraph, sentences, onSeek }: ParagraphItemProps) {
  const playPosition = useRainStore((s) => s.playPosition)
  const translationOn = useRainStore((s) => s.translationOn)
  const language = useRainStore((s) => s.currentVideoLanguage)

  const highlightedId = getCurrentHighlightedSentence(sentences, playPosition)
  const showTrans = shouldShowTranslation(language, translationOn)

  return (
    <div data-testid={`paragraph-${paragraph.id}`}>
      <div>
        <span data-type-badge={paragraph.type} />
        <span>{paragraph.title}</span>
      </div>
      <div>
        {sentences.map((s) => (
          <span
            key={s.id}
            data-highlighted={highlightedId === s.id ? 'true' : 'false'}
            style={{ cursor: 'pointer' }}
            onDoubleClick={() => onSeek?.(s.startTime)}
          >
            {s.text}
          </span>
        ))}
      </div>
      {showTrans && paragraph.translation && (
        <div data-testid="translation-block">{paragraph.translation}</div>
      )}
    </div>
  )
}

export function TextZone({ onSeek }: { onSeek?: (time: number) => void }) {
  const nodes = useRainStore((s) => s.nodeTree)
  const sentences = useRainStore((s) => s.sentences)

  const paragraphs = nodes.filter((n) => n.kind === 'paragraph')

  return (
    <div data-testid="text-zone">
      {paragraphs.map((p) => (
        <ParagraphItem
          key={p.id}
          paragraph={p}
          sentences={sentences.filter((s) => s.nodeId === p.id)}
          onSeek={onSeek}
        />
      ))}
    </div>
  )
}
