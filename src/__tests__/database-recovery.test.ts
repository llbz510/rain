import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb, resetDb } from '@/models/db-singleton'
import {
  getSentencesByVideoId,
  getVideoById,
  insertNodes,
  insertVideo,
  saveAsrAtomically,
} from '@/models/database'

beforeEach(() => { resetDb() })
afterEach(() => { resetDb() })

describe('ASR persistence', () => {
  it('rolls back rows and video state after a later sentence insertion fails', async () => {
    const db = await getDb()
    await insertVideo(db, {
      id: 'v1', title: 'Video', source: 'local', thumbnail: '', duration: 1,
      language: 'en', status: 'failed', stage: 'asr', createdAt: 1, position: 0, lastStudiedAt: 1,
    })
    await insertNodes(db, [{
      id: 'paragraph-1', videoId: 'v1', parentId: null, kind: 'paragraph', title: 'Paragraph',
      type: 'concept', startTime: 0, endTime: 1, text: null, sortOrder: 0,
    }])

    await expect(saveAsrAtomically('v1', 'zh', [{
      id: 'new-row', nodeId: 'paragraph-1', text: 'New', startTime: 0, endTime: 1, sortOrder: 1,
    }, {
      id: 'new-row', nodeId: 'paragraph-1', text: 'Duplicate', startTime: 0, endTime: 1, sortOrder: 2,
    }])).rejects.toThrow()

    expect(await getSentencesByVideoId(db, 'v1')).toEqual([])
    expect(await getVideoById(db, 'v1')).toMatchObject({ language: 'en', status: 'failed', stage: 'asr' })
  })
})