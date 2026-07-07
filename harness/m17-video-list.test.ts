// harness/m17-video-list.test.ts
// ========================================
// M17 Harness: 视频列表与管理
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import {
  getCardAction,
  buildCardDisplay,
  buildDeleteConfirmation,
  getEmptyStateMessage,
  type CardDisplay,
} from '@/ui/video-list'
import type { Video } from '@/models/types'

const readyVideo: Video = {
  id: 'v1', title: '测试视频', source: 'local', filePath: '/v.mp4',
  thumbnail: '/t.jpg', duration: 600, language: 'zh', status: 'ready',
  createdAt: 1000, position: 300, lastStudiedAt: 2000,
}

const processingVideo: Video = {
  id: 'v2', title: '处理中', source: 'url',
  sourceUrl: 'https://youtube.com/xxx', thumbnail: '/t2.jpg',
  duration: 1200, language: 'en', status: 'processing',
  createdAt: 2000, position: 0, lastStudiedAt: 0,
}

describe('M17-T01: 点 ready 卡进学习界面（决策54）', () => {
  it('ready 卡片 action=openVideo', () => {
    expect(getCardAction(readyVideo)).toBe('openVideo')
  })
})

describe('M17-T02: 点非 ready 卡打开导入框（决策62）', () => {
  it('processing 卡片 action=openImportDialog', () => {
    expect(getCardAction(processingVideo)).toBe('openImportDialog')
  })

  it('failed 卡片 action=openImportDialog', () => {
    const failedVideo = { ...readyVideo, status: 'failed' as const }
    expect(getCardAction(failedVideo)).toBe('openImportDialog')
  })
})

describe('M17-T03: 卡片显示信息（决策57）', () => {
  it('包含缩略图/标题/进度条/时长/最近学习/角标', () => {
    const card = buildCardDisplay(readyVideo)
    expect(card.thumbnail).toBe('/t.jpg')
    expect(card.title).toBe('测试视频')
    expect(card.progressPercent).toBe(50)  // 300/600 = 50%
    expect(card.durationText).toBeDefined()
    expect(card.lastStudiedText).toBeDefined()
    expect(card.badges).toBeDefined()
  })
})

describe('M17-T04: 已看完显示 ✓（决策57）', () => {
  it('position ≈ duration 时 isComplete=true', () => {
    const completedVideo = { ...readyVideo, position: 598 }  // 接近 600
    const card = buildCardDisplay(completedVideo)
    expect(card.isComplete).toBe(true)
  })
})

describe('M17-T05: 非就绪卡片状态徽章（决策57）', () => {
  it('processing 显示黄色徽章', () => {
    const card = buildCardDisplay(processingVideo)
    expect(card.statusBadge).toBeDefined()
    expect(card.statusBadge!.type).toBe('processing')
  })

  it('failed 显示红色徽章', () => {
    const failedVideo = { ...readyVideo, status: 'failed' as const }
    const card = buildCardDisplay(failedVideo)
    expect(card.statusBadge!.type).toBe('failed')
  })

  it('pending 显示灰色徽章', () => {
    const pendingVideo = { ...readyVideo, status: 'pending' as const }
    const card = buildCardDisplay(pendingVideo)
    expect(card.statusBadge!.type).toBe('pending')
  })
})

describe('M17-T06: 删除弹强确认（决策60）', () => {
  it('确认信息包含段数和笔记数', () => {
    const confirmation = buildDeleteConfirmation(readyVideo, {
      nodeCount: 25,
      noteCount: 8,
    })
    expect(confirmation.message).toContain('25')
    expect(confirmation.message).toContain('8')
    expect(confirmation.requiresConfirm).toBe(true)
  })
})

describe('M17-T07: 空状态引导（决策62）', () => {
  it('返回引导文案', () => {
    const message = getEmptyStateMessage()
    expect(message).toBeDefined()
    expect(message.length).toBeGreaterThan(0)
  })
})
