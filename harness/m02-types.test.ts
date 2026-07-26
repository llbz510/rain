import { describe, expect, it } from 'vitest'
import {
  NODE_KINDS,
  NOTE_SOURCES,
  PARAGRAPH_TYPES,
  VIDEO_SOURCES,
  VIDEO_STATUSES,
} from '@/models/types'

describe('M02: 持久化模型枚举契约', () => {
  it('节点和段落类型与 Stage2/数据库契约一致', () => {
    expect(NODE_KINDS).toEqual(['chapter', 'section', 'paragraph'])
    expect(PARAGRAPH_TYPES).toEqual(['concept', 'example', 'analogy', 'transition'])
  })

  it('视频和笔记枚举与数据库契约一致', () => {
    expect(VIDEO_SOURCES).toEqual(['local', 'url'])
    expect(VIDEO_STATUSES).toEqual(['pending', 'processing', 'ready', 'failed', 'cancelled'])
    expect(NOTE_SOURCES).toEqual(['excerpt', 'user', 'ai'])
  })
})
