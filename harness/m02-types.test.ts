// harness/m02-types.test.ts
// ========================================
// M02 Harness: 类型定义与枚举约束
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import type { Video, Node, Sentence, Note } from '@/models/types'
import {
  PARAGRAPH_TYPES,
  NODE_KINDS,
  VIDEO_SOURCES,
  VIDEO_STATUSES,
  NOTE_SOURCES,
} from '@/models/types'

// ===== 第一组：枚举值锁死 =====

describe('M02-T01: 段落类型恰好 4 种（决策3）', () => {
  it('包含且仅包含 concept, example, analogy, transition', () => {
    expect(PARAGRAPH_TYPES).toEqual(['concept', 'example', 'analogy', 'transition'])
    expect(PARAGRAPH_TYPES).toHaveLength(4)
  })
})

describe('M02-T02: 不包含已删除的类型（决策3）', () => {
  it('不包含渐构的 custom 和 title 类型', () => {
    expect(PARAGRAPH_TYPES).not.toContain('custom')
    expect(PARAGRAPH_TYPES).not.toContain('title')
    expect(PARAGRAPH_TYPES).not.toContain('heading')
  })
})

describe('M02-T03: 节点 kind 恰好 3 种', () => {
  it('包含且仅包含 chapter, section, paragraph', () => {
    expect(NODE_KINDS).toEqual(['chapter', 'section', 'paragraph'])
    expect(NODE_KINDS).toHaveLength(3)
  })
})

describe('M02-T04: 视频状态恰好 5 种（含 cancelled，决策83）', () => {
  it('包含且仅包含 pending, processing, ready, failed, cancelled', () => {
    expect(VIDEO_STATUSES).toEqual([
      'pending', 'processing', 'ready', 'failed', 'cancelled'
    ])
    expect(VIDEO_STATUSES).toHaveLength(5)
  })
})

describe('M02-T05: 视频来源恰好 2 种', () => {
  it('包含且仅包含 local, url', () => {
    expect(VIDEO_SOURCES).toEqual(['local', 'url'])
    expect(VIDEO_SOURCES).toHaveLength(2)
  })
})

describe('M02-T06: 笔记来源恰好 3 种（决策17）', () => {
  it('包含且仅包含 excerpt, user, ai', () => {
    expect(NOTE_SOURCES).toEqual(['excerpt', 'user', 'ai'])
    expect(NOTE_SOURCES).toHaveLength(3)
  })
})

// ===== 第二组：实体必填字段 =====

describe('M02-T07: Video 必填字段（M02+决策56）', () => {
  it('Video 对象包含所有 PRD 定义的字段', () => {
    const video: Video = {
      id: 'v1',
      title: 'Test Video',
      source: 'local',
      filePath: '/path/to/video.mp4',
      thumbnail: '/path/to/thumb.jpg',
      duration: 600,
      language: 'zh',
      status: 'ready',
      createdAt: Date.now(),
      position: 0,
      lastStudiedAt: Date.now(),
    }
    expect(video.id).toBeDefined()
    expect(video.title).toBeDefined()
    expect(video.source).toBeDefined()
    expect(video.thumbnail).toBeDefined()
    expect(video.duration).toBeGreaterThanOrEqual(0)
    expect(video.language).toBeDefined()
    expect(video.status).toBeDefined()
    expect(video.createdAt).toBeDefined()
    expect(video.position).toBeGreaterThanOrEqual(0)
    expect(video.lastStudiedAt).toBeDefined()
  })
})

describe('M02-T08: 在线视频必须有 sourceUrl', () => {
  it('source=url 时 sourceUrl 必须有值', () => {
    const video: Video = {
      id: 'v2',
      title: 'YouTube Video',
      source: 'url',
      sourceUrl: 'https://youtube.com/watch?v=xxx',
      thumbnail: '/thumb.jpg',
      duration: 1200,
      language: 'en',
      status: 'processing',
      createdAt: Date.now(),
      position: 0,
      lastStudiedAt: Date.now(),
    }
    expect(video.source).toBe('url')
    expect(video.sourceUrl).toBeDefined()
    expect(typeof video.sourceUrl).toBe('string')
    expect(video.sourceUrl!.length).toBeGreaterThan(0)
  })
})

describe('M02-T09: 段落节点必须有 type 字段（4种之一）', () => {
  it('kind=paragraph 时 type 是有效的段落类型', () => {
    const paragraph: Node = {
      id: 'n1',
      videoId: 'v1',
      parentId: 'n0',
      kind: 'paragraph',
      title: '概念讲解',
      type: 'concept',
      startTime: 0,
      endTime: 30,
      text: '转录文本...',
      sortOrder: 0,
    }
    expect(paragraph.type).toBeDefined()
    expect(paragraph.type).not.toBeNull()
    expect(PARAGRAPH_TYPES).toContain(paragraph.type)
  })
})

describe('M02-T10: 容器节点 type 必须为 null', () => {
  it('kind=chapter 时 type 为 null', () => {
    const chapter: Node = {
      id: 'ch1',
      videoId: 'v1',
      parentId: null,
      kind: 'chapter',
      title: '第一章',
      type: null,
      startTime: 0,
      endTime: 300,
      text: null,
      sortOrder: 0,
    }
    expect(chapter.type).toBeNull()
  })

  it('kind=section 时 type 为 null', () => {
    const section: Node = {
      id: 'sec1',
      videoId: 'v1',
      parentId: 'ch1',
      kind: 'section',
      title: '第一节',
      type: null,
      startTime: 0,
      endTime: 120,
      text: null,
      sortOrder: 0,
    }
    expect(section.type).toBeNull()
  })
})

describe('M02-T11: 章节的 parentId 为 null（顶层节点）', () => {
  it('kind=chapter 的 parentId 必须为 null', () => {
    const chapter: Node = {
      id: 'ch1',
      videoId: 'v1',
      parentId: null,
      kind: 'chapter',
      title: '第一章',
      type: null,
      startTime: 0,
      endTime: 300,
      text: null,
      sortOrder: 0,
    }
    expect(chapter.parentId).toBeNull()
  })
})

describe('M02-T12: Sentence 必填字段', () => {
  it('Sentence 包含 id, nodeId, text, startTime, endTime, sortOrder', () => {
    const sentence: Sentence = {
      id: 's1',
      nodeId: 'n1',
      text: '这是一句话。',
      startTime: 0,
      endTime: 5,
      sortOrder: 0,
    }
    expect(sentence.id).toBeDefined()
    expect(sentence.nodeId).toBeDefined()
    expect(sentence.text).toBeDefined()
    expect(sentence.startTime).toBeDefined()
    expect(sentence.endTime).toBeDefined()
    expect(sentence.sortOrder).toBeDefined()
  })
})

describe('M02-T13: 句子的开始时间 ≤ 结束时间', () => {
  it('startTime <= endTime', () => {
    const sentence: Sentence = {
      id: 's1',
      nodeId: 'n1',
      text: '这是一句话。',
      startTime: 10,
      endTime: 15,
      sortOrder: 0,
    }
    expect(sentence.startTime).toBeLessThanOrEqual(sentence.endTime)
  })
})

// ===== 第三组：笔记初始值规则 =====

describe('M02-T14: 摘注创建的笔记（决策16）', () => {
  it('content 初始为空，sentenceIds 不为空', () => {
    const note: Note = {
      id: 'note1',
      videoId: 'v1',
      content: '',
      source: 'excerpt',
      sentenceIds: ['s1', 's2', 's3'],
      createdAt: Date.now(),
      sortOrder: 0,
    }
    expect(note.source).toBe('excerpt')
    expect(note.content).toBe('')
    expect(note.sentenceIds.length).toBeGreaterThan(0)
  })
})

describe('M02-T15: 用户手写的笔记', () => {
  it('content 初始为空，sentenceIds 为空数组', () => {
    const note: Note = {
      id: 'note2',
      videoId: 'v1',
      content: '',
      source: 'user',
      sentenceIds: [],
      createdAt: Date.now(),
      sortOrder: 0,
    }
    expect(note.source).toBe('user')
    expect(note.content).toBe('')
    expect(note.sentenceIds).toEqual([])
  })
})

describe('M02-T16: AI 回答存入的笔记', () => {
  it('content 不为空（=AI回答全文），sentenceIds 可选', () => {
    const note: Note = {
      id: 'note3',
      videoId: 'v1',
      content: 'AI 生成的回答内容...',
      source: 'ai',
      sentenceIds: ['s1'],
      createdAt: Date.now(),
      sortOrder: 0,
    }
    expect(note.source).toBe('ai')
    expect(note.content.length).toBeGreaterThan(0)
  })
})
