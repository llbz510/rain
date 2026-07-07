// harness/m15-queries.test.ts
// ========================================
// M15 Harness: 视频列表查询 + 观看进度
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDatabase,
  insertVideo,
  listVideos,
  searchVideosByTitle,
  updateVideoPosition,
  updateVideoLastStudiedAt,
  getVideoById,
} from '@/models/database'

let db: Awaited<ReturnType<typeof createDatabase>>

beforeEach(async () => {
  db = await createDatabase(':memory:')
})

async function seedThreeVideos() {
  await insertVideo(db, {
    id: 'v1', title: 'Alpha 教程', source: 'local', thumbnail: '/t1.jpg',
    duration: 600, language: 'zh', status: 'ready',
    createdAt: 1000, position: 100, lastStudiedAt: 3000,
  })
  await insertVideo(db, {
    id: 'v2', title: 'Beta 进阶', source: 'url', sourceUrl: 'https://youtube.com/xxx',
    thumbnail: '/t2.jpg', duration: 1200, language: 'en', status: 'ready',
    createdAt: 2000, position: 0, lastStudiedAt: 1000,
  })
  await insertVideo(db, {
    id: 'v3', title: 'Gamma 实战', source: 'local', thumbnail: '/t3.jpg',
    duration: 900, language: 'zh', status: 'processing',
    createdAt: 3000, position: 50, lastStudiedAt: 2000,
  })
}

// ===== 第五组：视频列表查询 =====

describe('M15-T23: 按 lastStudiedAt 降序排序（默认，决策58）', () => {
  it('默认排序：最近学习的在前', async () => {
    await seedThreeVideos()
    const videos = await listVideos(db, 'lastStudied')
    expect(videos[0].id).toBe('v1')  // lastStudiedAt: 3000
    expect(videos[1].id).toBe('v3')  // lastStudiedAt: 2000
    expect(videos[2].id).toBe('v2')  // lastStudiedAt: 1000
  })
})

describe('M15-T24: 按 createdAt 降序排序（决策58）', () => {
  it('导入时间排序：最近导入的在前', async () => {
    await seedThreeVideos()
    const videos = await listVideos(db, 'createdAt')
    expect(videos[0].id).toBe('v3')  // createdAt: 3000
    expect(videos[1].id).toBe('v2')  // createdAt: 2000
    expect(videos[2].id).toBe('v1')  // createdAt: 1000
  })
})

describe('M15-T25: 按 title 升序排序（决策58）', () => {
  it('名称排序：按字母/拼音升序', async () => {
    await seedThreeVideos()
    const videos = await listVideos(db, 'title')
    expect(videos[0].id).toBe('v1')  // Alpha
    expect(videos[1].id).toBe('v2')  // Beta
    expect(videos[2].id).toBe('v3')  // Gamma
  })
})

describe('M15-T26: 标题关键词搜索（决策59）', () => {
  it('搜索关键词匹配标题', async () => {
    await seedThreeVideos()
    const results = await searchVideosByTitle(db, '进阶')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('v2')
  })

  it('搜索不匹配返回空数组', async () => {
    await seedThreeVideos()
    const results = await searchVideosByTitle(db, '不存在的关键词')
    expect(results).toEqual([])
  })

  it('搜索匹配多个视频', async () => {
    await seedThreeVideos()
    // Alpha 和 Gamma 都不含"教"... 只有 Alpha 含"教程"
    const results = await searchVideosByTitle(db, '教程')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('v1')
  })
})

// ===== 第六组：观看进度 =====

describe('M15-T27: position 单调递增（决策56）', () => {
  it('只能变大不能变小', async () => {
    await insertVideo(db, {
      id: 'v1', title: '视频', source: 'local', thumbnail: '/t.jpg',
      duration: 600, language: 'zh', status: 'ready',
      createdAt: 1000, position: 100, lastStudiedAt: 1000,
    })

    // 变大 → 成功
    await updateVideoPosition(db, 'v1', 200)
    let video = await getVideoById(db, 'v1')
    expect(video!.position).toBe(200)

    // 变小 → 不变（静默忽略或拒绝）
    await updateVideoPosition(db, 'v1', 50)
    video = await getVideoById(db, 'v1')
    expect(video!.position).toBe(200)  // 仍然是 200

    // 相等 → 不变
    await updateVideoPosition(db, 'v1', 200)
    video = await getVideoById(db, 'v1')
    expect(video!.position).toBe(200)
  })
})

describe('M15-T28: 更新 lastStudiedAt（决策56）', () => {
  it('每次打开/播放时更新', async () => {
    await insertVideo(db, {
      id: 'v1', title: '视频', source: 'local', thumbnail: '/t.jpg',
      duration: 600, language: 'zh', status: 'ready',
      createdAt: 1000, position: 0, lastStudiedAt: 1000,
    })

    await updateVideoLastStudiedAt(db, 'v1', 5000)
    const video = await getVideoById(db, 'v1')
    expect(video!.lastStudiedAt).toBe(5000)
  })
})
