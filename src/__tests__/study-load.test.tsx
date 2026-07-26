import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDb, getDb } from '@/models/db-singleton'
import { insertVideo } from '@/models/database'
import type { Video } from '@/models/types'
import { VideoListPage } from '@/pages/VideoListPage'
import { useRainStore } from '@/store/rain-store'

const incompleteReadyVideo: Video = {
  id: 'incomplete-ready-video',
  title: 'Incomplete lecture',
  source: 'local',
  filePath: 'D:\\courses\\incomplete.mp4',
  thumbnail: '',
  duration: 60,
  language: 'zh',
  status: 'ready',
  createdAt: 1,
  position: 0,
  lastStudiedAt: 1,
}

beforeEach(() => {
  resetDb()
  useRainStore.getState().reset()
})

afterEach(() => {
  cleanup()
  resetDb()
})

describe('AC-ST-01 atomic study loading', () => {
  it('rejects a missing video without changing the current page', async () => {
    const result = await useRainStore.getState().loadVideo('missing-video')

    expect(result).toEqual({ ok: false, error: '无法打开视频：视频记录不存在' })
    expect(useRainStore.getState()).toMatchObject({
      currentPage: 'list',
      currentVideoId: null,
    })
  })

  it('rejects a video that has not reached ready', async () => {
    await insertVideo(await getDb(), {
      ...incompleteReadyVideo,
      id: 'processing-video',
      status: 'processing',
      stage: 'asr',
    })

    const result = await useRainStore.getState().loadVideo('processing-video')

    expect(result).toEqual({ ok: false, error: '无法打开视频：视频尚未处理完成' })
    expect(useRainStore.getState().currentPage).toBe('list')
  })

  it('keeps the user on the list and reports an incomplete ready video', async () => {
    await insertVideo(await getDb(), incompleteReadyVideo)
    render(<VideoListPage />)

    fireEvent.click(await screen.findByText(incompleteReadyVideo.title))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('无法打开视频')
    })
    expect(useRainStore.getState()).toMatchObject({
      currentPage: 'list',
      currentVideoId: null,
      nodeTree: [],
      sentences: [],
      notes: [],
    })
  })
})
