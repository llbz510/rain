import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import {
  getNotesByVideoId,
  insertNodes,
  insertSentences,
  insertVideo,
} from '@/models/database'
import type { Node, Sentence, Video } from '@/models/types'
import { StudyInterface } from '@/pages/StudyInterface'
import { useRainStore } from '@/store/rain-store'

const video: Video = {
  id: 'notes-video',
  title: 'Notes lecture',
  source: 'local',
  filePath: 'D:\\courses\\notes.mp4',
  thumbnail: '',
  duration: 60,
  language: 'en',
  status: 'ready',
  createdAt: 1,
  position: 0,
  lastStudiedAt: 1,
}

const nodes: Node[] = [
  {
    id: 'notes-chapter',
    videoId: video.id,
    parentId: null,
    kind: 'chapter',
    title: 'Chapter',
    type: null,
    startTime: 0,
    endTime: 60,
    text: null,
    sortOrder: 0,
  },
  {
    id: 'notes-paragraph',
    videoId: video.id,
    parentId: 'notes-chapter',
    kind: 'paragraph',
    title: 'Important paragraph',
    type: 'concept',
    startTime: 4,
    endTime: 20,
    text: null,
    sortOrder: 0,
  },
]

const sentences: Sentence[] = [
  {
    id: 'notes-sentence-1',
    nodeId: 'notes-paragraph',
    text: 'First sentence.',
    startTime: 4,
    endTime: 10,
    sortOrder: 0,
  },
  {
    id: 'notes-sentence-2',
    nodeId: 'notes-paragraph',
    text: 'Second sentence.',
    startTime: 10,
    endTime: 20,
    sortOrder: 1,
  },
]

async function seedStudyVideo(): Promise<void> {
  const db = await getDb()
  await insertVideo(db, video)
  await insertNodes(db, nodes)
  await insertSentences(db, sentences)
}

beforeEach(() => {
  resetDb()
  useRainStore.getState().reset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useRainStore.getState().reset()
  resetDb()
})

describe('AC-ST-06 persisted notes workflow', () => {
  it('creates a whole-paragraph excerpt and reloads it from the database', async () => {
    await seedStudyVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    const firstView = render(<StudyInterface />)

    fireEvent.click(screen.getByRole('button', { name: '摘注' }))

    await waitFor(async () => {
      expect(await getNotesByVideoId(await getDb(), video.id)).toEqual([
        expect.objectContaining({
          videoId: video.id,
          content: 'First sentence. Second sentence.',
          source: 'excerpt',
          sentenceIds: ['notes-sentence-1', 'notes-sentence-2'],
          sortOrder: 0,
        }),
      ])
      expect(useRainStore.getState().notes).toHaveLength(1)
    })

    firstView.unmount()
    useRainStore.getState().unloadVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    render(<StudyInterface />)
    fireEvent.click(screen.getByRole('button', { name: '随记' }))

    expect(await screen.findByDisplayValue('First sentence. Second sentence.')).toBeInTheDocument()
  })

  it('persists a free note and its edited content across a reload', async () => {
    await seedStudyVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    const firstView = render(<StudyInterface />)
    fireEvent.click(screen.getByRole('button', { name: '随记' }))

    fireEvent.click(screen.getByRole('button', { name: '新建随记' }))
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'A durable free note.' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(async () => {
      expect(await getNotesByVideoId(await getDb(), video.id)).toEqual([
        expect.objectContaining({
          videoId: video.id,
          content: 'A durable free note.',
          source: 'user',
          sentenceIds: [],
          sortOrder: 0,
        }),
      ])
    })

    firstView.unmount()
    useRainStore.getState().unloadVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    render(<StudyInterface />)
    fireEvent.click(screen.getByRole('button', { name: '随记' }))

    expect(await screen.findByDisplayValue('A durable free note.')).toBeInTheDocument()
  })

  it('reopens an excerpt citation and seeks the matching sentence without changing playback', async () => {
    await seedStudyVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    const firstView = render(<StudyInterface />)
    fireEvent.click(screen.getByRole('button', { name: '摘注' }))
    await waitFor(async () => {
      expect(await getNotesByVideoId(await getDb(), video.id)).toHaveLength(1)
    })

    firstView.unmount()
    useRainStore.getState().unloadVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    render(<StudyInterface />)
    const player = screen.getByTestId('video-player') as HTMLVideoElement
    player.currentTime = 0
    Object.defineProperty(player, 'paused', { configurable: true, value: false })
    const play = vi.spyOn(player, 'play')
    const pause = vi.spyOn(player, 'pause')
    fireEvent.click(screen.getByRole('button', { name: '随记' }))

    fireEvent.click(screen.getByRole('button', { name: '引用:notes-sentence-2' }))

    await waitFor(() => {
      expect(useRainStore.getState().playPosition).toBe(10)
      expect(player.currentTime).toBe(10)
    })
    expect(player.paused).toBe(false)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
  })
})
