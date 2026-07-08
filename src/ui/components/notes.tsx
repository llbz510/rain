// src/ui/components/notes.tsx
// ========================================
// M08 随记面板组件（决策16/18）
// ========================================

import React, { useState } from 'react'
import { useRainStore } from '@/store/rain-store'
import type { Note } from '@/models/types'

export function NotesPanel() {
  const notes = useRainStore((s) => s.notes)

  return (
    <div data-testid="notes-panel">
      {notes.map((note) => (
        <NoteItem key={note.id} note={note} />
      ))}
    </div>
  )
}

function NoteItem({ note }: { note: Note }) {
  const [content, setContent] = useState(note.content)

  return (
    <div data-testid={`note-${note.id}`}>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} />
      {note.sentenceIds.length > 0 && (
        <div>
          {note.sentenceIds.map((sid) => (
            <span key={sid} style={{ cursor: 'pointer', color: '#3b82f6' }}>
              引用:{sid}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

interface ExcerptButtonProps {
  paragraphId: string
  sentenceIds: string[]
  onExcerpt?: () => void
}

export function ExcerptButton({ paragraphId, sentenceIds, onExcerpt }: ExcerptButtonProps) {
  return (
    <button
      onClick={() => onExcerpt?.()}
    >
      摘注
    </button>
  )
}
