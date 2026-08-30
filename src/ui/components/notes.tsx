// src/ui/components/notes.tsx
// ========================================
// M08 随记面板组件（决策16/18）
// ========================================

import React, { useState } from 'react'
import { useRainStore } from '@/store/rain-store'
import type { Note } from '@/models/types'

interface NotesPanelProps {
  onCreateNote?: (content: string) => boolean | Promise<boolean>
  onSaveNote?: (noteId: string, content: string) => void
  onSeekSentence?: (sentenceId: string) => void
  focusRef?: React.Ref<HTMLTextAreaElement>
}

export function NotesPanel({ onCreateNote, onSaveNote, onSeekSentence, focusRef }: NotesPanelProps = {}) {
  const notes = useRainStore((s) => s.notes)
  const [draft, setDraft] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const createDraft = async () => {
    if (isCreating || !draft.trim()) return
    setIsCreating(true)
    try {
      const created = await onCreateNote?.(draft)
      if (created !== false) setDraft('')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div data-testid="notes-panel">
      {notes.length === 0 ? (
        <div data-testid="notes-composer">
          <textarea
            ref={focusRef}
            aria-label="新随记内容"
            readOnly={isCreating}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="写下随记..."
          />
          {onCreateNote && <button disabled={isCreating} onClick={() => void createDraft()}>保存新随记</button>}
        </div>
      ) : onCreateNote && <button onClick={() => onCreateNote('')}>新建随记</button>}
      {notes.map((note, index) => (
        <NoteItem
          key={note.id}
          note={note}
          editorRef={index === 0 ? focusRef : undefined}
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
  editorRef,
}: {
  note: Note
  onSave?: (noteId: string, content: string) => void
  onSeekSentence?: (sentenceId: string) => void
  editorRef?: React.Ref<HTMLTextAreaElement>
}) {
  const [content, setContent] = useState(note.content)

  return (
    <div data-testid={`note-${note.id}`}>
      <textarea ref={editorRef} aria-label="随记内容" value={content} onChange={(e) => setContent(e.target.value)} />
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
