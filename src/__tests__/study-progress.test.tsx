import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import {
  getVideoById,
  insertNodes,
  insertSentences,
  insertVideo,
} from '@/models/database'
import type { Node, Sentence, Video } from '@/models/types'
import { StudyInterface } from '@/pages/StudyInterface'
import { useRainStore } from '@/store/rain-store'

const video: Video = {
  id: 'progress-video',
  title: 'Progress lecture',
  source: 'local',
  filePath: 'D:\\courses\\progress.mp4',
  thumbnail: '',
  duration: 120,
  language: 'en',
  status: 'ready',
  createdAt: 1,
  position: 5,
  lastStudiedAt: 1000,
}

const nodes: Node[] = [
  {
    id: 'progress-chapter',
    videoId: video.id,
    parentId: null,
    kind: 'chapter',
    title: 'Chapter',
    type: null,
    startTime: 0,
    endTime: 120,
    text: null,
    sortOrder: 0,
  },
  {
    id: 'progress-paragraph',
    videoId: video.id,
    parentId: 'progress-chapter',
    kind: 'paragraph',
    title: 'Paragraph',
    type: 'concept',
    startTime: 0,
    endTime: 120,
    text: null,
    sortOrder: 0,
  },
]

const sentences: Sentence[] = [
  {
    id: 'progress-sentence',
    nodeId: 'progress-paragraph',
    text: 'Track progress.',
    startTime: 0,
    endTime: 120,
    sortOrder: 0,
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

describe('AC-ST-05 study progress persistence', () => {
  it('persists the furthest media position without treating a rewind as lost progress', async () => {
    await seedStudyVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    render(<StudyInterface />)
    const player = screen.getByTestId('video-player') as HTMLVideoElement

    player.currentTime = 24
    fireEvent.timeUpdate(player)

    await waitFor(async () => {
      expect((await getVideoById(await getDb(), video.id))?.position).toBe(24)
    })

    player.currentTime = 6
    fireEvent.timeUpdate(player)

    await waitFor(async () => {
      expect(useRainStore.getState().playPosition).toBe(6)
      expect((await getVideoById(await getDb(), video.id))?.position).toBe(24)
    })
  })

  it('restores persisted progress and refreshes the recent-study time when reopened', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(5000)
    await seedStudyVideo()
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    const firstView = render(<StudyInterface />)
    const firstPlayer = screen.getByTestId('video-player') as HTMLVideoElement

    await waitFor(async () => {
      expect((await getVideoById(await getDb(), video.id))?.lastStudiedAt).toBe(5000)
    })

    firstPlayer.currentTime = 31
    fireEvent.timeUpdate(firstPlayer)
    await waitFor(async () => {
      expect((await getVideoById(await getDb(), video.id))?.position).toBe(31)
    })

    firstView.unmount()
    useRainStore.getState().unloadVideo()
    now.mockReturnValue(7000)
    expect(await useRainStore.getState().loadVideo(video.id)).toEqual({ ok: true })
    render(<StudyInterface />)

    await waitFor(async () => {
      const reopened = await getVideoById(await getDb(), video.id)
      expect(reopened).toMatchObject({
        position: 31,
        lastStudiedAt: 7000,
      })
      expect(useRainStore.getState().playPosition).toBe(31)
      expect((screen.getByTestId('video-player') as HTMLVideoElement).currentTime).toBe(31)
    })
  })
})
