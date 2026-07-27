import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlDatabaseAdapter } from '@/models/database-adapter'
import {
  assignAsrSentencesToNodes,
  atomicInsertSentences,
  mergeImportAtomically,
  saveAsrAtomically,
} from '@/models/database'
import type { Node, Sentence } from '@/models/types'

const mocks = vi.hoisted(() => ({
  tauriInvoke: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  tauriInvoke: mocks.tauriInvoke,
}))

function sqliteAdapter(overrides: Partial<SqlDatabaseAdapter> = {}): SqlDatabaseAdapter {
  return {
    adapterKind: 'sqlite',
    listTables: vi.fn(),
    getTableColumns: vi.fn(),
    exec: vi.fn(),
    query: vi.fn().mockResolvedValue([{ id: 'video-1' }]),
    ...overrides,
  }
}

const sentence: Sentence = {
  id: 'sentence-1',
  nodeId: '',
  text: 'Signal.',
  startTime: 0,
  endTime: 1,
  sortOrder: 0,
}

const node: Node = {
  id: 'paragraph-1',
  videoId: 'video-1',
  parentId: null,
  kind: 'paragraph',
  title: 'Signal',
  type: 'concept',
  startTime: 0,
  endTime: 1,
  text: null,
  sortOrder: 0,
}

describe('database atomic import SQLite adapter', () => {
  beforeEach(() => {
    mocks.tauriInvoke.mockReset()
  })

  it('normalizes ASR sentence ownership before invoking the Rust transaction', async () => {
    const db = sqliteAdapter()

    await saveAsrAtomically('video-1', 'en', [sentence], db)

    expect(mocks.tauriInvoke).toHaveBeenCalledWith('save_asr_atomically', {
      videoId: 'video-1',
      language: 'en',
      sentences: [{ ...sentence, nodeId: 'video-1' }],
    })
  })

  it('rejects a missing video before invoking the ASR transaction', async () => {
    const db = sqliteAdapter({ query: vi.fn().mockResolvedValue([]) })

    await expect(saveAsrAtomically('missing', 'en', [sentence], db))
      .rejects.toThrow('Video not found: missing')
    expect(mocks.tauriInvoke).not.toHaveBeenCalled()
  })

  it('sends only sentence assignment fields to the Rust transaction', async () => {
    const db = sqliteAdapter()
    const assigned = { ...sentence, nodeId: node.id, sortOrder: 4 }

    await assignAsrSentencesToNodes(db, 'video-1', [assigned])

    expect(mocks.tauriInvoke).toHaveBeenCalledWith('assign_asr_sentences_atomically', {
      videoId: 'video-1',
      assignments: [{ id: assigned.id, nodeId: node.id, sortOrder: 4 }],
    })
  })

  it('sends the validated graph inputs to the Rust merge transaction', async () => {
    const db = sqliteAdapter()
    const assigned = { ...sentence, nodeId: node.id }

    await mergeImportAtomically(db, 'video-1', [node], [assigned])

    expect(mocks.tauriInvoke).toHaveBeenCalledWith('merge_import_atomically', {
      videoId: 'video-1',
      nodes: [node],
      assignments: [{ id: assigned.id, nodeId: node.id, sortOrder: 0 }],
    })
  })

  it('commits direct SQLite sentence inserts in one transaction', async () => {
    const exec = vi.fn()
    const db = sqliteAdapter({ exec })

    await atomicInsertSentences(db, [{ ...sentence, nodeId: node.id }])

    expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO sentence'),
      'COMMIT',
    ])
  })

  it('rolls back a direct SQLite sentence transaction after an insert failure', async () => {
    const exec = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('duplicate sentence'))
      .mockResolvedValueOnce(undefined)
    const db = sqliteAdapter({ exec })

    await expect(atomicInsertSentences(db, [{ ...sentence, nodeId: node.id }]))
      .rejects.toThrow('duplicate sentence')
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO sentence'),
      'ROLLBACK',
    ])
  })
})
