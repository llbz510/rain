// harness/m15-schema-crud.test.ts
// ========================================
// M15 Harness: Schema 建表 + CRUD 操作
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDatabase,
  insertVideo,
  getVideoById,
  insertNodes,
  getNodesByVideoId,
  insertSentences,
  getSentencesByNodeId,
  insertNote,
  getNotesByVideoId,
  updateVideoStatus,
  deleteVideoWithCascade,
} from '@/models/database'
import type { Video, Node, Sentence, Note } from '@/models/types'

// 每个测试前重新创建内存数据库
let db: Awaited<ReturnType<typeof createDatabase>>

beforeEach(async () => {
  db = await createDatabase(':memory:')
})

// ===== 第一组：Schema 建表 =====

describe('M15-T01: 初始化创建全部 6 张表', () => {
  it('数据库包含 video, node, sentence, note, note_sentence, setting 表', async () => {
    const tables = await db.listTables()
    expect(tables).toContain('video')
    expect(tables).toContain('node')
    expect(tables).toContain('sentence')
    expect(tables).toContain('note')
    expect(tables).toContain('note_sentence')
    expect(tables).toContain('setting')
    expect(tables.length).toBeGreaterThanOrEqual(6)
  })
})

describe('M15-T02: video 表包含全部 13 个字段', () => {
  it('video 表字段完整', async () => {
    const columns = await db.getTableColumns('video')
    const expectedColumns = [
      'id', 'title', 'source', 'source_url', 'file_path',
      'thumbnail', 'duration', 'language', 'status', 'stage',
      'error_message', 'created_at', 'position', 'last_studied_at',
    ]
    for (const col of expectedColumns) {
      expect(columns).toContain(col)
    }
  })
})

describe('M15-T03: node 表包含全部 11 个字段', () => {
  it('node 表字段完整', async () => {
    const columns = await db.getTableColumns('node')
    const expectedColumns = [
      'id', 'video_id', 'parent_id', 'kind', 'title',
      'type', 'start_time', 'end_time', 'text', 'translation',
      'sort_order',
    ]
    for (const col of expectedColumns) {
      expect(columns).toContain(col)
    }
  })
})

describe('M15-T04: sentence 表包含全部 6 个字段', () => {
  it('sentence 表字段完整', async () => {
    const columns = await db.getTableColumns('sentence')
    const expectedColumns = [
      'id', 'node_id', 'text', 'start_time', 'end_time', 'sort_order',
    ]
    for (const col of expectedColumns) {
      expect(columns).toContain(col)
    }
  })
})

describe('M15-T05: note 表包含全部 7 个字段', () => {
  it('note 表字段完整', async () => {
    const columns = await db.getTableColumns('note')
    const expectedColumns = [
      'id', 'video_id', 'content', 'source', 'created_at',
      'derivation_id', 'sort_order',
    ]
    for (const col of expectedColumns) {
      expect(columns).toContain(col)
    }
  })
})

describe('M15-T06: note_sentence 是多对多关联表', () => {
  it('note_sentence 包含 note_id 和 sentence_id', async () => {
    const columns = await db.getTableColumns('note_sentence')
    expect(columns).toContain('note_id')
    expect(columns).toContain('sentence_id')
  })
})

describe('M15-T07: setting 表是 key-value 结构', () => {
  it('setting 包含 key 和 value', async () => {
    const columns = await db.getTableColumns('setting')
    expect(columns).toContain('key')
    expect(columns).toContain('value')
  })
})

// ===== 第二组：CRUD 操作 =====

describe('M15-T08: 插入并查询 Video', () => {
  it('插入一个 Video 记录，查出来字段一致', async () => {
    const video: Video = {
      id: 'v1',
      title: '测试视频',
      source: 'local',
      filePath: '/path/to/video.mp4',
      thumbnail: '/path/to/thumb.jpg',
      duration: 600,
      language: 'zh',
      status: 'ready',
      createdAt: 1000000,
      position: 120,
      lastStudiedAt: 2000000,
    }
    await insertVideo(db, video)
    const result = await getVideoById(db, 'v1')
    expect(result).toBeDefined()
    expect(result!.id).toBe('v1')
    expect(result!.title).toBe('测试视频')
    expect(result!.source).toBe('local')
    expect(result!.filePath).toBe('/path/to/video.mp4')
    expect(result!.duration).toBe(600)
    expect(result!.language).toBe('zh')
    expect(result!.status).toBe('ready')
    expect(result!.position).toBe(120)
    expect(result!.lastStudiedAt).toBe(2000000)
  })
})

describe('M15-T09: 插入并查询 Node 树', () => {
  it('插入章节+小节+段落树，按 videoId 查出来结构完整', async () => {
    // 先插视频
    await insertVideo(db, {
      id: 'v1', title: '视频', source: 'local', thumbnail: '/t.jpg',
      duration: 300, language: 'zh', status: 'ready',
      createdAt: 1000, position: 0, lastStudiedAt: 1000,
    })

    const nodes: Node[] = [
      { id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter', title: '第一章', type: null, startTime: 0, endTime: 300, text: null, sortOrder: 0 },
      { id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '第一节', type: null, startTime: 0, endTime: 120, text: null, sortOrder: 0 },
      { id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph', title: '段落1', type: 'concept', startTime: 0, endTime: 60, text: '文本', sortOrder: 0 },
    ]
    await insertNodes(db, nodes)
    const result = await getNodesByVideoId(db, 'v1')
    expect(result).toHaveLength(3)
    expect(result.find(n => n.id === 'ch1')).toBeDefined()
    expect(result.find(n => n.id === 'sec1')!.parentId).toBe('ch1')
    expect(result.find(n => n.id === 'p1')!.parentId).toBe('sec1')
  })
})

describe('M15-T10: 插入并查询 Sentence', () => {
  it('按 nodeId 查出来顺序正确（按 sortOrder）', async () => {
    await insertVideo(db, {
      id: 'v1', title: '视频', source: 'local', thumbnail: '/t.jpg',
      duration: 100, language: 'zh', status: 'ready',
      createdAt: 1000, position: 0, lastStudiedAt: 1000,
    })
    await insertNodes(db, [
      { id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter', title: '章', type: null, startTime: 0, endTime: 100, text: null, sortOrder: 0 },
      { id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '节', type: null, startTime: 0, endTime: 100, text: null, sortOrder: 0 },
      { id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph', title: '段', type: 'concept', startTime: 0, endTime: 100, text: '文本', sortOrder: 0 },
    ])

    const sentences: Sentence[] = [
      { id: 's3', nodeId: 'p1', text: '第三句。', startTime: 20, endTime: 30, sortOrder: 2 },
      { id: 's1', nodeId: 'p1', text: '第一句。', startTime: 0, endTime: 10, sortOrder: 0 },
      { id: 's2', nodeId: 'p1', text: '第二句。', startTime: 10, endTime: 20, sortOrder: 1 },
    ]
    await insertSentences(db, sentences)
    const result = await getSentencesByNodeId(db, 'p1')
    expect(result).toHaveLength(3)
    // 返回结果应按 sortOrder 排序
    expect(result[0].id).toBe('s1')
    expect(result[1].id).toBe('s2')
    expect(result[2].id).toBe('s3')
  })
})

describe('M15-T11: 插入并查询 Note（含 sentenceIds）', () => {
  it('Note 的 sentenceIds 通过 note_sentence 关联表正确存取', async () => {
    await insertVideo(db, {
      id: 'v1', title: '视频', source: 'local', thumbnail: '/t.jpg',
      duration: 100, language: 'zh', status: 'ready',
      createdAt: 1000, position: 0, lastStudiedAt: 1000,
    })
    await insertNodes(db, [
      { id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter', title: '章', type: null, startTime: 0, endTime: 100, text: null, sortOrder: 0 },
      { id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '节', type: null, startTime: 0, endTime: 100, text: null, sortOrder: 0 },
      { id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph', title: '段', type: 'concept', startTime: 0, endTime: 100, text: '文本', sortOrder: 0 },
    ])
    await insertSentences(db, [
      { id: 's1', nodeId: 'p1', text: '句一。', startTime: 0, endTime: 50, sortOrder: 0 },
      { id: 's2', nodeId: 'p1', text: '句二。', startTime: 50, endTime: 100, sortOrder: 1 },
    ])

    const note: Note = {
      id: 'note1', videoId: 'v1', content: '', source: 'excerpt',
      sentenceIds: ['s1', 's2'], createdAt: 3000, sortOrder: 0,
    }
    await insertNote(db, note)
    const notes = await getNotesByVideoId(db, 'v1')
    expect(notes).toHaveLength(1)
    expect(notes[0].sentenceIds).toEqual(['s1', 's2'])
  })
})

describe('M15-T12: 更新 Video status', () => {
  it('从 processing 改为 ready', async () => {
    await insertVideo(db, {
      id: 'v1', title: '视频', source: 'local', thumbnail: '/t.jpg',
      duration: 100, language: 'zh', status: 'processing',
      createdAt: 1000, position: 0, lastStudiedAt: 1000,
    })
    await updateVideoStatus(db, 'v1', 'ready')
    const video = await getVideoById(db, 'v1')
    expect(video!.status).toBe('ready')
  })
})

describe('M15-T13: 删除 Video 级联删除（决策60）', () => {
  it('删除视频时级联删除所有 node、sentence、note、note_sentence', async () => {
    // 插入完整的视频+树+句子+笔记
    await insertVideo(db, {
      id: 'v1', title: '视频', source: 'local', thumbnail: '/t.jpg',
      duration: 100, language: 'zh', status: 'ready',
      createdAt: 1000, position: 0, lastStudiedAt: 1000,
    })
    await insertNodes(db, [
      { id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter', title: '章', type: null, startTime: 0, endTime: 100, text: null, sortOrder: 0 },
      { id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '节', type: null, startTime: 0, endTime: 100, text: null, sortOrder: 0 },
      { id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph', title: '段', type: 'concept', startTime: 0, endTime: 100, text: '文本', sortOrder: 0 },
    ])
    await insertSentences(db, [
      { id: 's1', nodeId: 'p1', text: '句一。', startTime: 0, endTime: 100, sortOrder: 0 },
    ])
    await insertNote(db, {
      id: 'note1', videoId: 'v1', content: '', source: 'excerpt',
      sentenceIds: ['s1'], createdAt: 3000, sortOrder: 0,
    })

    await deleteVideoWithCascade(db, 'v1')

    // 全部清空
    expect(await getVideoById(db, 'v1')).toBeNull()
    expect(await getNodesByVideoId(db, 'v1')).toEqual([])
    expect(await getNotesByVideoId(db, 'v1')).toEqual([])
  })
})
