// src/ui/components/text-zone.tsx
// ========================================
// M07 文本区组件（决策5/41/43/44/86）
// ========================================

import React, { useEffect, useRef } from 'react'
import { useRainStore } from '@/store/rain-store'
import { shouldShowTranslation } from '@/ui/text-zone'
import { getCurrentHighlightedSentence } from '@/ui/text-zone'
import { resolveNodeNavigationTarget } from '@/study/navigation'
import type { Node, Sentence } from '@/models/types'

interface ParagraphItemProps {
  paragraph: Node
  sentences: Sentence[]
  onSeek?: (time: number) => void
  scrollRequestId?: number
}

export function ParagraphItem({ paragraph, sentences, onSeek, scrollRequestId }: ParagraphItemProps) {
  const playPosition = useRainStore((s) => s.playPosition)
  const isPlaying = useRainStore((s) => s.isPlaying)
  const translationOn = useRainStore((s) => s.translationOn)
  const language = useRainStore((s) => s.currentVideoLanguage)
  const highlightedSentenceRef = useRef<HTMLSpanElement>(null)
  const paragraphRef = useRef<HTMLDivElement>(null)

  const highlightedId = getCurrentHighlightedSentence(sentences, playPosition)
  const showTrans = shouldShowTranslation(language, translationOn)

  useEffect(() => {
    if (isPlaying && highlightedId) {
      highlightedSentenceRef.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [highlightedId, isPlaying])

  useEffect(() => {
    if (scrollRequestId !== undefined) {
      paragraphRef.current?.scrollIntoView?.({ block: 'center' })
    }
  }, [scrollRequestId])

  return (
    <div ref={paragraphRef} data-testid={`paragraph-${paragraph.id}`}>
      <div>
        <span data-type-badge={paragraph.type} />
        <span>{paragraph.title}</span>
      </div>
      <div>
        {sentences.map((s) => (
          <span
            key={s.id}
            ref={highlightedId === s.id ? highlightedSentenceRef : undefined}
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

export interface TextScrollTarget {
  paragraphId: string
  requestId: number
}

export function TextZone({
  onSeek,
  scrollTarget,
}: {
  onSeek?: (time: number) => void
  scrollTarget?: TextScrollTarget | null
}) {
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
          scrollRequestId={scrollTarget?.paragraphId === p.id ? scrollTarget.requestId : undefined}
        />
      ))}
    </div>
  )
}

export function TextPreview({
  selectedNodeId,
  onSeek,
}: {
  selectedNodeId: string | null
  onSeek?: (time: number) => void
}) {
  const nodes = useRainStore((s) => s.nodeTree)
  const sentences = useRainStore((s) => s.sentences)
  const target = selectedNodeId
    ? resolveNodeNavigationTarget(nodes, sentences, selectedNodeId)
    : null
  const paragraph = target
    ? nodes.find((node) => node.id === target.paragraphId)
    : undefined

  return (
    <div data-testid="text-preview">
      {paragraph && (
        <ParagraphItem
          paragraph={paragraph}
          sentences={sentences.filter((sentence) => sentence.nodeId === paragraph.id)}
          onSeek={onSeek}
        />
      )}
    </div>
  )
}
