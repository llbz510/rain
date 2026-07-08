// src/ui/components/ai-assistant.tsx
// ========================================
// M10 AI 助手组件（决策10/80/83）
// ========================================

import React, { useState, useRef } from 'react'
import { getQuickActionsForType } from '@/ai/assistant'
import type { ParagraphType } from '@/models/types'

interface QuickActionsProps {
  paragraphType: ParagraphType
}

export function QuickActions({ paragraphType }: QuickActionsProps) {
  const actions = getQuickActionsForType(paragraphType)
  return (
    <div data-testid="quick-actions">
      {actions.map((a) => (
        <button key={a.id}>{a.label}</button>
      ))}
    </div>
  )
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  frameImage?: string | null
}

interface AiAssistantProps {
  messages: ChatMessage[]
  isStreaming?: boolean
}

export function AiAssistant({ messages, isStreaming = false }: AiAssistantProps) {
  return (
    <div data-testid="ai-assistant">
      {messages.map((msg, i) => (
        <div key={i} data-testid={`message-${msg.role}`}>
          {msg.role === 'user' && msg.frameImage && (
            <img src={msg.frameImage} alt="当前帧" />
          )}
          <span>{msg.content}</span>
        </div>
      ))}
      {isStreaming && <button>停止</button>}
    </div>
  )
}

interface ChatInputProps {
  onSend?: (text: string) => void
}

export function ChatInput({ onSend }: ChatInputProps) {
  const [text, setText] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      if (text.trim()) {
        onSend?.(text.trim())
        setText('')
      }
    }
  }

  return (
    <textarea
      role="textbox"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="输入消息..."
    />
  )
}
