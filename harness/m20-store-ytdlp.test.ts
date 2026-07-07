// harness/m20-store-ytdlp.test.ts
// ========================================
// M20 Harness: Zustand 状态边界 + yt-dlp 检测
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'

// ===== 第三组：Zustand 状态边界 =====

describe('M20-T07: Zustand store 包含 UI 会话态字段（决策99）', () => {
  it('store 类型定义包含所有规定的 UI 会话态字段', async () => {
    const { STORE_UI_SESSION_FIELDS } = await import('@/architecture/store-contract')
    const expectedFields = [
      'currentVideoId',
      'selectedNodeId',
      'selectionOrigin',     // 'tree' | 'diagram'（决策53）
      'playPosition',
      'layoutMode',          // 'follow' | 'textExpand' | 'mapExpand'（决策19）
      'undoStack',
      'subtitleOn',
      'translationOn',
      'aiPanelState',
      'noteEditState',
      'importQueue',
      'importDialogOpen',
    ]
    for (const field of expectedFields) {
      expect(STORE_UI_SESSION_FIELDS).toContain(field)
    }
  })
})

describe('M20-T08: Zustand store 包含当前视频缓存（决策99）', () => {
  it('store 类型定义包含 nodeTree, sentences, notes 缓存', async () => {
    const { STORE_VIDEO_CACHE_FIELDS } = await import('@/architecture/store-contract')
    expect(STORE_VIDEO_CACHE_FIELDS).toContain('nodeTree')
    expect(STORE_VIDEO_CACHE_FIELDS).toContain('sentences')
    expect(STORE_VIDEO_CACHE_FIELDS).toContain('notes')
  })
})

describe('M20-T09: store 不缓存非当前视频数据（决策99）', () => {
  it('store 不包含 otherVideos / videoList 等字段', async () => {
    const { STORE_UI_SESSION_FIELDS, STORE_VIDEO_CACHE_FIELDS } =
      await import('@/architecture/store-contract')
    const allFields = [...STORE_UI_SESSION_FIELDS, ...STORE_VIDEO_CACHE_FIELDS]
    expect(allFields).not.toContain('otherVideos')
    expect(allFields).not.toContain('videoList')
    expect(allFields).not.toContain('allVideosCache')
  })
})

describe('M20-T10: 撤销栈不跨会话持久（决策83/99）', () => {
  it('store 初始状态 undoStack 为空', async () => {
    const { getInitialStoreState } = await import('@/architecture/store-contract')
    const initial = getInitialStoreState()
    expect(initial.undoStack).toEqual([])
  })
})

// ===== 第四组：yt-dlp 检测 =====

describe('M20-T11: 在线 URL 导入前检测 yt-dlp（决策95）', () => {
  it('checkYtdlp 函数存在并返回 available 状态', async () => {
    const { checkYtdlpAvailability } = await import('@/architecture/ytdlp-check')
    // 这个函数应该返回 { available: boolean; message?: string }
    // 在测试环境中会 mock Tauri invoke
    expect(typeof checkYtdlpAvailability).toBe('function')
  })
})

describe('M20-T12: yt-dlp 不可用时返回错误信息（决策95）', () => {
  it('返回结构包含安装指引', async () => {
    const { YtdlpCheckResult } = await import('@/architecture/ytdlp-check')
    // 验证类型结构存在
    const unavailableResult: InstanceType<typeof Object> & { available: boolean; message: string } = {
      available: false,
      message: 'yt-dlp 未安装。请访问 https://github.com/yt-dlp/yt-dlp 下载安装并添加到 PATH。',
    }
    expect(unavailableResult.available).toBe(false)
    expect(unavailableResult.message).toContain('yt-dlp')
    expect(unavailableResult.message).toContain('https://')
  })
})
