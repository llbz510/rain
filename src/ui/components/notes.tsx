// src/ui/components/notes.tsx
// ========================================
// M08 随记面板组件（决策16/18）
// ========================================

import React, { useState } from 'react'
import { useRainStore } from '@/store/rain-store'
import type { Note } from '@/models/types'

interface NotesPanelProps {
  onCreateNote?: () => void
  onSaveNote?: (noteId: string, content: string) => void
  onSeekSentence?: (sentenceId: string) => void
}

export function NotesPanel({ onCreateNote, onSaveNote, onSeekSentence }: NotesPanelProps = {}) {
  const notes = useRainStore((s) => s.notes)

  return (
    <div data-testid="notes-panel">
      {onCreateNote && <button onClick={onCreateNote}>新建随记</button>}
      {notes.map((note) => (
        <NoteItem
          key={note.id}
          note={note}
          onSave={onSaveNote}
          onSeekSentence={onSeekSentence}
        />
      ))}
    </div>
  )
}

function NoteItem({
  note,
  onSave,
  onSeekSentence,
}: {
  note: Note
  onSave?: (noteId: string, content: string) => void
  onSeekSentence?: (sentenceId: string) => void
}) {
  const [content, setContent] = useState(note.content)

  return (
    <div data-testid={`note-${note.id}`}>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} />
      {onSave && <button onClick={() => onSave(note.id, content)}>保存</button>}
      {note.sentenceIds.length > 0 && (
        <div>
          {note.sentenceIds.map((sid) => (
            <button
              key={sid}
              onClick={() => onSeekSentence?.(sid)}
              style={{ cursor: 'pointer', color: '#3b82f6' }}
            >
              引用:{sid}
            </button>
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
