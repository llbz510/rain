import React, { forwardRef, useState } from 'react'
import { getQuickActionsForType, type QuickAction } from '@/ai/assistant'
import type { AssistantSource } from '@/ai/assistant-context'
import type { ParagraphType } from '@/models/types'

interface QuickActionsProps { paragraphType: ParagraphType; onAction?: (action: QuickAction) => void }
export function QuickActions({ paragraphType, onAction }: QuickActionsProps) {
  return <div data-testid="quick-actions">{getQuickActionsForType(paragraphType).map((action) => <button key={action.id} type="button" onClick={() => onAction?.(action)}>{action.label}</button>)}</div>
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  frameImage?: string | null
  sources?: AssistantSource[]
}
interface AiAssistantProps {
  messages: ChatMessage[]
  isStreaming?: boolean
  onStop?: () => void
  onSeekSource?: (time: number) => void
}

const CITATION_PATTERN = /\[sentence:([^\]\s]+)\s*@\s*([0-9]+(?:\.[0-9]+)?)-([0-9]+(?:\.[0-9]+)?)\]/g

function renderMessageContent(message: ChatMessage, onSeekSource?: (time: number) => void) {
  const sourcesById = new Map((message.sources ?? []).map((source) => [source.sentenceId, source]))
  const parts: React.ReactNode[] = []
  let lastIndex = 0

  for (const match of message.content.matchAll(CITATION_PATTERN)) {
    const [citation, sentenceId, rawStart, rawEnd] = match
    const index = match.index ?? 0
    if (index > lastIndex) parts.push(message.content.slice(lastIndex, index))

    const source = sourcesById.get(sentenceId)
    const citedStart = Number(rawStart)
    const citedEnd = Number(rawEnd)
    const citationMatchesSource = source && Math.abs(source.startTime - citedStart) < 0.001 && Math.abs(source.endTime - citedEnd) < 0.001
    if (source && citationMatchesSource) {
      parts.push(
        <button
          key={`${sentenceId}-${index}`}
          type="button"
          aria-label={citation.slice(1, -1)}
          onClick={() => onSeekSource?.(source.startTime)}
        >
          {citation}
        </button>,
      )
    } else {
      parts.push(citation)
    }
    lastIndex = index + citation.length
  }

  if (lastIndex < message.content.length) parts.push(message.content.slice(lastIndex))
  return parts.length > 0 ? parts : message.content
}

export function AiAssistant({ messages, isStreaming = false, onStop, onSeekSource }: AiAssistantProps) {
  return <div data-testid="ai-assistant">
    {messages.map((message, index) => <div key={index} data-testid={`message-${message.role}`}>
      {message.role === 'user' && message.frameImage && <img src={message.frameImage} alt="当前帧" />}
      <span>{renderMessageContent(message, onSeekSource)}</span>
    </div>)}
    {isStreaming && <button type="button" onClick={onStop}>停止</button>}
  </div>
}

interface ChatInputProps { onSend?: (text: string) => void }
export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(function ChatInput({ onSend }, ref) {
  const [text, setText] = useState('')
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    const hasNonAltModifier = event.ctrlKey || event.metaKey || event.shiftKey
    if (event.key === 'Enter' && event.altKey && !hasNonAltModifier) {
      event.preventDefault()
      const input = event.currentTarget
      const start = input.selectionStart ?? text.length
      const end = input.selectionEnd ?? start
      const nextText = `${text.slice(0, start)}\n${text.slice(end)}`
      const cursor = start + 1
      setText(nextText)
      queueMicrotask(() => input.setSelectionRange(cursor, cursor))
      return
    }
    if (event.key === 'Enter' && !event.altKey && !hasNonAltModifier) {
      event.preventDefault()
      if (text.trim()) { onSend?.(text.trim()); setText('') }
    }
  }
  return <textarea ref={ref} aria-label="AI 输入" role="textbox" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={handleKeyDown} placeholder="输入消息..." />
})
