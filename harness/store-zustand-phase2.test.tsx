// harness/store-zustand-phase2.test.tsx
// ========================================
// Store Harness Phase 2: persisted current-video cache behavior
// Harness migration: 2026-07-26
// ========================================

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import {
  insertNodes,
  insertNote,
  insertSentences,
  insertVideo,
} from '@/models/database'
import type { Node, Note, Sentence, Video } from '@/models/types'
import { useRainStore } from '@/store/rain-store'

const video: Video = {
  id: 'video-123',
  title: 'Signal course',
  source: 'local',
  filePath: 'D:\\courses\\signal.mp4',
  thumbnail: '',
  duration: 60,
  language: 'en',
  status: 'ready',
  createdAt: 1,
  position: 12,
  lastStudiedAt: 2,
}
const nodes: Node[] = [
  {
    id: 'chapter-1',
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
    id: 'paragraph-1',
    videoId: video.id,
    parentId: 'chapter-1',
    kind: 'paragraph',
    title: 'Paragraph',
    type: 'concept',
    startTime: 0,
    endTime: 60,
    text: null,
    sortOrder: 0,
  },
]
const sentences: Sentence[] = [
  { id: 'sentence-1', nodeId: 'paragraph-1', text: 'Hello.', startTime: 0, endTime: 2, sortOrder: 0 },
]
const notes: Note[] = [
  {
    id: 'note-1',
    videoId: video.id,
    content: 'Remember this',
    source: 'user',
    sentenceIds: ['sentence-1'],
    createdAt: 1,
    sortOrder: 0,
  },
]

beforeEach(() => {
  resetDb()
  useRainStore.getState().reset()
})

async function seedVideo(): Promise<void> {
  const db = await getDb()
  await insertVideo(db, video)
  await insertNodes(db, nodes)
  await insertSentences(db, sentences)
  await insertNote(db, notes[0])
}

describe('Store current-video cache', () => {
  it('loadVideo 从数据库填充真实视频、结构、句子、笔记和续播位置', async () => {
    await seedVideo()

    await useRainStore.getState().loadVideo(video.id)

    expect(useRainStore.getState()).toMatchObject({
      currentVideoId: video.id,
      currentPage: 'study',
      currentVideoFilePath: video.filePath,
      currentVideoTitle: video.title,
      playPosition: 12,
      nodeTree: nodes,
      sentences,
      notes,
    })
  })

  it('unloadVideo 清空所有当前视频缓存并返回列表', async () => {
    await seedVideo()
    await useRainStore.getState().loadVideo(video.id)

    useRainStore.getState().unloadVideo()

    expect(useRainStore.getState()).toMatchObject({
      currentVideoId: null,
      currentPage: 'list',
      currentVideoFilePath: '',
      currentVideoTitle: '',
      playPosition: 0,
      nodeTree: [],
      sentences: [],
      notes: [],
    })
  })

  it('setPage 只切换页面，不伪造当前视频', () => {
    useRainStore.getState().setPage('settings')
    expect(useRainStore.getState().currentPage).toBe('settings')
    expect(useRainStore.getState().currentVideoId).toBeNull()
  })
})
