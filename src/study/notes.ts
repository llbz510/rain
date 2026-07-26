import { getDb } from '@/models/db-singleton'
import { insertNote, updateNoteContent } from '@/models/database'
import type { Note } from '@/models/types'
import { useRainStore } from '@/store/rain-store'

function createNoteId(): string {
  const randomId = globalThis.crypto?.randomUUID?.()
  return randomId ? `note-${randomId}` : `note-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function createParagraphExcerpt(paragraphId: string): Promise<Note> {
  const state = useRainStore.getState()
  const videoId = state.currentVideoId
  if (!videoId) throw new Error('没有打开可摘注的视频')

  const paragraphSentences = state.sentences
    .filter((sentence) => sentence.nodeId === paragraphId)
    .sort((left, right) => left.sortOrder - right.sortOrder)
  if (paragraphSentences.length === 0) throw new Error('当前段落没有可摘注的句子')

  const note: Note = {
    id: createNoteId(),
    videoId,
    content: paragraphSentences.map((sentence) => sentence.text).join(' '),
    source: 'excerpt',
    sentenceIds: paragraphSentences.map((sentence) => sentence.id),
    createdAt: Date.now(),
    sortOrder: state.notes.reduce((highest, item) => Math.max(highest, item.sortOrder), -1) + 1,
  }

  await insertNote(await getDb(), note)
  useRainStore.setState((current) => (
    current.currentVideoId === videoId
      ? { notes: [...current.notes, note] }
      : {}
  ))
  return note
}

export async function createFreeNote(): Promise<Note> {
  const state = useRainStore.getState()
  const videoId = state.currentVideoId
  if (!videoId) throw new Error('没有打开可记录随记的视频')

  const note: Note = {
    id: createNoteId(),
    videoId,
    content: '',
    source: 'user',
    sentenceIds: [],
    createdAt: Date.now(),
    sortOrder: state.notes.reduce((highest, item) => Math.max(highest, item.sortOrder), -1) + 1,
  }

  await insertNote(await getDb(), note)
  useRainStore.setState((current) => (
    current.currentVideoId === videoId
      ? { notes: [...current.notes, note] }
      : {}
  ))
  return note
}

export async function saveNoteContent(noteId: string, content: string): Promise<void> {
  const state = useRainStore.getState()
  const note = state.notes.find((item) => item.id === noteId)
  if (!note || note.videoId !== state.currentVideoId) {
    throw new Error('当前学习会话中不存在这条笔记')
  }

  await updateNoteContent(await getDb(), noteId, content)
  useRainStore.setState((current) => ({
    notes: current.notes.map((item) => (
      item.id === noteId ? { ...item, content } : item
    )),
  }))
}
