import { describe, expect, it, vi } from 'vitest'
import type { SqlDatabaseAdapter } from '@/models/database-adapter'
import {
  getNodesByVideoId,
  getSentencesByNodeId,
  getSentencesByVideoId,
  insertNodes,
  insertSentences,
} from '@/models/database'
import type { Node, Sentence } from '@/models/types'

function sqliteAdapter(overrides: Partial<SqlDatabaseAdapter> = {}): SqlDatabaseAdapter {
  return {
    adapterKind: 'sqlite',
    listTables: vi.fn(),
    getTableColumns: vi.fn(),
    exec: vi.fn(),
    query: vi.fn(),
    ...overrides,
  }
}

const node: Node = {
  id: 'paragraph-1',
  videoId: 'video-1',
  parentId: 'section-1',
  kind: 'paragraph',
  title: 'Signal',
  type: 'concept',
  startTime: 1,
  endTime: 2,
  text: 'Signal.',
  translation: '信号。',
  sortOrder: 3,
}

const sentence: Sentence = {
  id: 'sentence-1',
  nodeId: node.id,
  text: 'Signal.',
  startTime: 1,
  endTime: 2,
  sortOrder: 4,
}

describe('database study-content persistence', () => {
  it('writes complete Node and Sentence rows through the selected adapter', async () => {
    const exec = vi.fn()
    const db = sqliteAdapter({ exec })

    await insertNodes(db, [node])
    await insertSentences(db, [sentence])

    expect(exec).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO node '),
      [
        node.id,
        node.videoId,
        node.parentId,
        node.kind,
        node.title,
        node.type,
        node.startTime,
        node.endTime,
        node.text,
        node.translation,
        node.sortOrder,
      ],
    )
    expect(exec).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO sentence '),
      [
        sentence.id,
        sentence.nodeId,
        sentence.text,
        sentence.startTime,
        sentence.endTime,
        sentence.sortOrder,
      ],
    )
  })

  it('reconstructs content and keeps the three query scopes distinct', async () => {
    const query = vi.fn(async (sql: string) => (
      sql.includes('FROM node')
        ? [{
            id: node.id,
            video_id: node.videoId,
            parent_id: node.parentId,
            kind: node.kind,
            title: node.title,
            type: node.type,
            start_time: node.startTime,
            end_time: node.endTime,
            text: node.text,
            translation: node.translation,
            sort_order: node.sortOrder,
          }]
        : [{
            id: sentence.id,
            node_id: sentence.nodeId,
            text: sentence.text,
            start_time: sentence.startTime,
            end_time: sentence.endTime,
            sort_order: sentence.sortOrder,
          }]
    ))
    const db = sqliteAdapter({
      query: query as unknown as SqlDatabaseAdapter['query'],
    })

    await expect(getNodesByVideoId(db, node.videoId)).resolves.toEqual([node])
    await expect(getSentencesByNodeId(db, node.id)).resolves.toEqual([sentence])
    await expect(getSentencesByVideoId(db, node.videoId)).resolves.toEqual([sentence])

    expect(query.mock.calls[0]).toEqual([
      expect.stringMatching(/FROM node WHERE video_id/),
      [node.videoId],
    ])
    expect(query.mock.calls[1]).toEqual([
      expect.stringMatching(/FROM sentence WHERE node_id.*ORDER BY sort_order/),
      [node.id],
    ])
    expect(query.mock.calls[2]).toEqual([
      expect.stringMatching(/LEFT JOIN node.*node\.video_id.*ORDER BY sentence\.sort_order/),
      [node.videoId],
    ])
  })
})
